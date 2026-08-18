# Signed Gateway Capability Tests

This is the test contract for netget's first working **capability-separation** slice, inspired by
and scoped toward the
[Algebra of Encrypted Audiences](https://suign.github.io/EncryptedAudiences.html)
(`Island = (path, ciphertext, T, A, C)` — see the design decisions in
[GatewayCapabilityModel.md](./GatewayCapabilityModel.md)). What this suite proves today is the
`A`/auth/`C` separation on real requests — not encrypted audience with real key-wrapping, which is
still future work (see "Scope of what's proven" below). This doc exists to freeze what the model
claims, which endpoint proves it, and what each test in the permanent suite actually checks — so
the claim lives in one documented place, not scattered across code comments and conversation.

**Suite**: `tests/gateway-capability-model.test.ts` · **Run**: `npm run test:capability-model`
**Requires**: a live, already-reloaded gateway (OpenResty + the `netget-proxy-dev` daemon). Not
part of `npm test` — same reason `test:nrp:curl` isn't: it depends on live infrastructure, not
just source.

---

## Vocabulary, mapped to what's actually running

| Algebra term | In netget, concretely |
|---|---|
| `A` — audience | Who is anchored to this control scope today — an identity in `gateway-claims.json`'s `pubkeys` map, proven per-request via signature. Not yet real decrypt-based audience (that's a plain claims list, not wrapped ciphertext — see "Scope of what's proven"). Whatever form it takes, `A` says nothing about what that identity may *change*. |
| `auth` | `X-Me-Proof`: a base64url-encoded, Ed25519-signed proof. The signed challenge is `{ method, path, bodyHash, nonce, timestamp }` (canonical JSON, sorted keys) — bound to *this exact request*, not just "this identity, at some point." Verified by `lua/middleware/me_sig.lua`. |
| `C` — capability | A specific, explicitly granted string in `gateway-claims.json`'s `grants[identityHash]` array — e.g. `gateway:write:domain-metadata`. Never inferred from `A`, from owner status, or from admin status. |

The endpoint that proves the separation: **`POST /domains/metadata`**.

**What it writes, on success**: one field (`description`) for one domain, into a sidecar file —
`runtime/domain-metadata.json` — keyed by domain, with `updatedBy`/`updatedAt`. Nothing else.

**What it never touches**: `domains.db` (routing/target/sslMode — the table that actually decides
where a hostname's traffic goes) and `runtime/domain-map.json`/`.version` (the generated routing
table). This is deliberate: the capability under test is real, but scoped low-stakes on purpose —
a denied or buggy write here cannot reroute traffic.

**What it audits**: every decision, allowed or denied, appended as one JSON line to
`runtime/audit.log` — `{ action, identity, domain, outcome, at, ...reason/description }`.

---

## The jewel

> `valid signed proof + authenticated/admin identity − explicit capability ⇒ 403`

This is the one test that proves the algebra rather than just the endpoint. It says, in code: an
identity that can prove who it is — even an identity marked admin — is not automatically an
identity permitted to cause this specific side effect. `A` (and even admin status layered on `A`)
and `C` are two different, separately-granted things. If this test alone regressed, the model
collapsed back into "authenticated ⇒ can write," which is exactly the failure mode the algebra
exists to rule out.

**Proven twice, two different ways:**

1. **Automated** — category 2, table below, row "No capability (the jewel)". Runs on every
   `npm run test:capability-model` invocation, against a disposable, self-cleaning test identity.
2. **UI** — netget's local admin panel (`Domains.jsx`), the same invariant with a real browser in
   the loop instead of a Node test runner. See "UI-level confirmation" below.

Both exercise the exact same server-side code path (`me_sig.lua` → `localNetget.js`'s
`/domains/metadata` handler) — the UI proof isn't a separate implementation being separately
trusted, it's the same one, reached a different way.

---

## Every test, and what it expects

### 1. Payload-bound proof

The signed challenge covers the whole request, not just "this identity called this endpoint at
some point." Each of these tampers with one field after signing and expects the mismatch to be
caught — proving the binding is real, not just present.

| Test | Setup | Expects |
|---|---|---|
| Valid proof passes | Correctly signed `GET /check-auth` | `200`, `authenticated: true` |
| Body tampered | `POST /domains/metadata`, `bodyHash` signed for a different body than the one actually sent | `401 ME_PROOF_BODY_MISMATCH` |
| Method tampered | Signed for `POST /domains/metadata`, request actually sent as `GET` | `401 ME_PROOF_METHOD_MISMATCH` |
| Path tampered | Signed for `/domains/metadata`, request actually sent to `/check-auth` | `401 ME_PROOF_PATH_MISMATCH` |
| Stale timestamp | Signed with a timestamp 120s in the past (outside the ±60s window) | `401 ME_PROOF_EXPIRED` |
| Reused nonce | Same nonce sent twice | 1st: `200`. 2nd (replay): `401 ME_PROOF_REPLAY` |

### 2. Capability separation

All four requests come from the *same* test identity, with `X-Me-Proof` always valid — only the
identity's anchored admin/grant state in `gateway-claims.json` changes between them. Isolates the
capability decision from the proof-verification decision above.

| Test | Setup | Expects |
|---|---|---|
| **No capability (the jewel)** | Authenticated identity, no grants at all | `403 CAPABILITY_DENIED` |
| Admin alone isn't enough | Same identity marked `admin: true`, still no grants | `403 CAPABILITY_DENIED` |
| Unrelated scope isn't enough | Admin + granted `domains:read` (a real, existing scope — just not this one) | `403 CAPABILITY_DENIED` |
| Explicit grant succeeds | Admin + granted `gateway:write:domain-metadata` | `200`, `ok: true` |

### 3. Side-effect safety

The capability is real, but its blast radius must stay exactly as small as designed.

| Test | Setup | Expects |
|---|---|---|
| Successful write is scoped | After a `200` write from category 2 | `domain-metadata.json` updated; `domains.db` row for that domain and `domain-map.version` both unchanged (still absent / still the same, respectively) |
| Denied write leaves no trace | A `403` write attempt | No entry — partial or otherwise — appears in `domain-metadata.json` for that domain |

### 4. Audit

Both outcomes must be independently reconstructable later, not just returned in the HTTP response.

| Test | Setup | Expects |
|---|---|---|
| Complete audit trail | One denied + one allowed request, same identity/domain (from category 2) | Both appear in `runtime/audit.log`; each has `action: "gateway:write:domain-metadata"`, the identity hash, the target domain, and a parseable `at` timestamp; the denied entry additionally carries a `reason` |

### 5. Lua boundary

The capability *decision* must live only in the daemon — Lua's job is verify-and-forward, nothing
more. Both directions of that boundary are tested.

| Test | Setup | Expects |
|---|---|---|
| Lua rejects before the daemon sees it | `POST /domains/metadata` with no `X-Me-Proof` header at all | `401 ME_PROOF_REQUIRED`, in Lua's `deny()` response shape (`{error, message}` — no `required` field, distinguishing it from the daemon's own denial shape) |
| Daemon refuses independently | The daemon (`localNetget.js`) hit directly on its own port, bypassing nginx/Lua entirely — no identity header present | `401 IDENTITY_REQUIRED` — the daemon does not trust an absent identity as license to proceed; defense in depth, not reliance on Lua alone |

---

## UI-level confirmation (manual)

Not part of `npm run test:capability-model` — this is the same jewel invariant, confirmed by hand
through a real browser, against the live gateway, so the claim isn't just "the API proves it" but
"the thing an operator actually clicks proves it too." Client: `Domains.jsx`'s **Unlock .me Proof**
control (`src/htmls/Netget-REACT/frontend_local/src/pages/Domains.jsx` —
see its README for how the signing identity is derived).

| Test | Setup | Expects | Confirmed |
|---|---|---|---|
| UI jewel test | Real browser, `local.netget`/`127.0.0.1`. **Unlock .me Proof** with a disposable, non-admin, no-grant identity. Edit-description on a real domain row, Save. | Dialog shows the server's own `CAPABILITY_DENIED — required: gateway:write:domain-metadata` verbatim — not a generic error, not a client-side guess, not a crash. | 2026-08-17 |

What this rules out that the automated suite alone can't: any bug specific to the browser-side
signing path (`this.gui/cleaker`'s `signedRequest`/`deriveCleakerNode`, extracted from
`useCleakerAuth.ts`), and any temptation to gate the UI's edit control on displayed scopes instead
of on whether a signing identity is loaded at all — confirmed the control disables only for the
latter, and always lets a real attempt through to get the server's real answer.

---

## A bug this suite already earned its keep on

The `/domains/metadata` nginx location originally ran `me_sig.lua` via `dofile()` inside
`access_by_lua_block`. That crashed the connection (reset, no HTTP response at all) any time a
proof was actually *rejected* on that route — `dofile()`'s own C call frame blocks the
`ngx.exit()` yield that a rejection needs. Manual testing never exercised a rejected proof on this
specific route, so it went unnoticed until category 1's tampering tests hit it directly. Fixed by
`loadfile()()` instead of `dofile()`. Full detail in
[GatewayCapabilityModel.md](./GatewayCapabilityModel.md#phase-1--built). This is the concrete
argument for keeping this suite permanent rather than reverting to one-off manual checks: the
manual script proved the happy path and the one denial-by-scope path; it never proved a rejected
signature, and that's exactly where the real bug was.

---

## Test identity hygiene

The suite creates one dedicated identity (`gateway-capability-suite-test`, from a fixed
username+secret) per run, anchors only that identity's pubkey/grants in `gateway-claims.json`, and
removes it in a `finally` block — verified at the end of the run. No real admin's grants are ever
read, changed, or depended on.

---

## Scope of what's proven

This suite proves **capability separation** — `A`/auth/`C` did not collapse — for one narrow,
low-stakes capability (`gateway:write:domain-metadata`, one field, one sidecar file). It does
**not** prove real encrypted audience: `A` today is `gateway-claims.json`'s plain claims list, not
key-wrapped ciphertext, so no test here exercises decrypt-based access. That's not a gap in the
underlying theory — `.me`'s kernel already implements real key-wrapped `A` for its own scope
secrets (see [Algebra of Contexts](https://neurons-me.github.io/.me/Typescript/typedocs/Algebra-of-Contexts.html)
and [The Algebra of Encrypted Audiences](https://suign.github.io/EncryptedAudiences.html)'s
implementation status). It's a gap in *this suite's coverage*: nothing here yet exercises
`gateway-claims.json` adopting that mechanism, because that adoption hasn't been built. See
[GatewayCapabilityModel.md](./GatewayCapabilityModel.md#what-this-is-a-proof-of-concept-of) for the
full scope caveat.

It also does **not** yet prove anything about `domains:write` (real routing), `routes:write`, or
`gateway:write` (restart/cert provisioning) — those still run on the legacy JWT/cookie path in
`domains.lua` (`auth_required()`), unchanged. Widening the capability model to those is future,
separately-scoped work — deliberately not attempted here, per the same reasoning that kept Phase 1
to one field.
