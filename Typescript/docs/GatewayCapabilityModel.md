# Gateway Capability Model

Phase 0 design doc. Four decisions, made before any code changes.

See [Signed Gateway Capabilities](https://neurons-me.github.io/netget/docs/signed-gateway-capabilities.html)
for the short, product-level version of what this is. What follows is the design and
implementation detail.

**Where the `A`/`T`/`C` framing comes from**:
[Digital Space Algebra](https://suign.github.io/DigitalSpaceAlgebra.html) is the theoretical
anchor — the `Island = (path, ciphertext, T, A, C)` model this borrows its vocabulary from.
[The Algebra of Encrypted Audiences](https://suign.github.io/EncryptedAudiences.html) is the
specific essay this doc's decisions are scoped from — it also states, precisely, which parts of
`A`/`T`/`C` are already real elsewhere in this system and which aren't (see decision 1 below).
[`.me`'s Algebra of Contexts](https://neurons-me.github.io/.me/Typescript/typedocs/Algebra-of-Contexts.html)
is the same `A`/`T`/`C` set framing at the kernel-implementation level — where `A` *is* already
cryptographically real, via scope-secret key-wrapping. This doc is about extending that same
model to gateway control, not inventing a second one.

---

## What this is a proof of concept of

This is not a proof of concept of "an endpoint for editing metadata." The endpoint is
deliberately the least interesting part of it — one field, one sidecar file, chosen precisely
because it's low-stakes enough to prove the model on without also having to trust the model with
something that matters yet.

What it's actually a proof of concept of is this claim: **authority does not live in a session or
a global role; it lives in an explicit, per-request signed capability, kept separate from
audience.**

Concretely, netget can now demonstrate three separate things about a single request, independently:

- **`A`** — who can belong to / see the control scope (audience). The theoretical model behind
  this is decrypt-based; what's anchored and checked today is a plain claims list, not
  key-wrapped ciphertext — see the caveat below.
- **auth** — who actually signed *this* request, right now, bound to its exact method, path, and
  body (see `X-Me-Proof` below) — not "who is logged in."
- **`C`** — what specific action that identity is explicitly permitted to cause.

In practice: an identity can be an admin, can be authenticated, can belong to the correct
audience — and still be refused a write, because none of those imply the one thing that
was actually checked: does this identity hold *this* capability. That's what the central test
(below) proves, and it's why it's the one to protect above all the others in this suite — it's not
proving "this is secure" in general, it's proving the algebraic shape held: `A`, auth, and `C` did
not collapse into each other.

This replaces the usual shortcut — *if you're an admin, you can do anything* — with a stricter
claim: *you can do exactly what your signed capability permits, nothing that your identity or role
alone would suggest.*

Zoomed out, this is the first real bridge between
[`.me`'s theoretical model](https://neurons-me.github.io/.me/Typescript/typedocs/Algebra-of-Contexts.html)
and a working piece of infrastructure outside the kernel itself. The gateway stops behaving like
"an app behind a login" and starts behaving like a space where audience, identity, and action are
genuinely separate dimensions — checked separately, because collapsing any two of them is exactly
the failure mode this model exists to rule out.

**This is a first functional core, not the finished model.** Specifically still missing:
cryptographically real `A` via key-wrapping (today `A` is sourced from a plain claims list, not
wrapped ciphertext — see decision 1 below); more than one capability; revocation and delegation of
a granted capability; and audit logs that are born encrypted rather than plain JSON lines. Each of
those is separately-scoped future work, not implied or promised by what's built today.

---

## 1. `A` means decrypt audience only

`A` is who can read gateway control state. Today it is represented by a plain claims list —
`gateway-claims.json`'s `owner`/`admins` — checked by a gate, not yet wrapped ciphertext. Making
it cryptographically real via `.me` scope-secret key-wrap (ECDH-ES) is future work, not yet built
(see the scope note below) — but it is not hypothetical: `.me`'s kernel already implements exactly
this for its own scope secrets (`me.path["_"]("key")`, HKDF-SHA-256 + AES-256-GCM, per
[The Algebra of Encrypted Audiences](https://suign.github.io/EncryptedAudiences.html#sharing-key-wrapping)'s
implementation status). Netget's future work is adopting that existing mechanism for
`gateway-claims.json`, not designing a new one. Whatever form `A` takes, the decision that doesn't
change: `A` proves nothing about what its members are allowed to *change*.

## 2. `C` means signed capability for one side effect

`C` is never inferred from membership in `A`. A capability is a signed, scoped intent, checked
independently at the point of the write. Holding decrypt access to the control scope and holding
a specific write capability are two different, separately-granted things — collapsing them is the
god-mode failure mode this model exists to avoid.

## 3. `X-Me-Proof` is accepted as the signed intent envelope, with one noted gap

**Audit finding** (traced end to end, not assumed):

- Client — `useCleakerAuth.ts` (`packages/GUI/Typescript/src/gui/All.This/Cleaker/hooks/`):
  `signedFetch` builds `challenge = canonicalJson({ method, nonce, path, timestamp })`, signs it
  with an Ed25519 key derived from `ME_RESEED(username, secret)` via Cleaker's `node.prove()`.
- Server — `lua/middleware/me_sig.lua`: verifies method+path match the actual request, timestamp
  within ±60s, nonce not reused (`ngx.shared.gateway_nonces`, 120s TTL), Ed25519 signature against
  the identity's pubkey anchored in `gateway-claims.json`. On success sets
  `ngx.ctx.me_scopes = claims.grants[hash]` — a per-identity capability grant list, already
  distinct from `me_is_owner`/`me_is_admin`.

This is a genuine signed-intent primitive, not just signed identity. **Decision: accept it as the
envelope.** Do not build a second one.

**Current gap, and current reality — both matter for scoping Phase 1:**

- At the time of this audit, the signed challenge covered `method + path + nonce + timestamp`,
  **not the request body** — it proved "this identity authorized a POST to this path right now,"
  not "authorized this specific value." Not acceptable to build any write capability on unmodified.
  **Phase 1 closed this gap** (see below): the challenge now includes `bodyHash`, and this applies
  to every request through `me_sig.lua`, not just the one new endpoint. This subsection is left as
  the original audit finding, on purpose — it's the reasoning for why payload binding had to come
  first in the build order, not a description of the current envelope shape.
- `me_scopes` is populated and reported back to the client (`auth.lua`, `/check-auth` — the scope
  chips already visible in the UI) but **nothing enforces it today**. `domains.lua` — the actual
  add/delete/provision-cert handler — has zero references to `me_scopes`, and is still wired to
  the *other*, legacy path (`require "resty.jwt"` / `require "resty.cookie"`, its own comment:
  `"legacy — will migrate to Ed25519 proof auth"`) — the exact broken dependency found yesterday.
  Phase 1's job is this enforcement wiring, not inventing the envelope.

## 4. Lua verifies the proof; Lua never decides the capability

Signature/replay/freshness verification is cheap, stateless, and correctly belongs at the nginx
edge — `me_sig.lua` already does this well and stays as-is. What must not live in Lua is the
capability *decision* ("do this identity's granted scopes satisfy what this write requires") as
ad hoc per-handler string matching. That decision, and its audit trail, belongs in a narrow daemon
surface — reusing `monad.ai`'s existing role as netget's HTTP-surface/kernel-exposure layer
(`docs/Architecture.md`) rather than inventing a fourth pattern. Lua's job stops at: proof valid →
forward `me_identity` + `me_scopes` downstream. The downstream daemon's job: given those, decide
whether *this* write is permitted, and log that it did.

---

## Phase 1 — built

One capability, `gateway:write:domain-metadata`, gated on a single non-routing field (a domain's
`description`). Not `target`/`type`/`sslMode`, not restart, not cert provisioning, not logs.

**Payload binding** (`me_sig.lua`, `useCleakerAuth.ts`): the signed challenge is now
`{ method, path, bodyHash, nonce, timestamp }` — `bodyHash` = sha256(exact request body, or `""`
for no body), hex, verified server-side via `resty.sha256` (bundled, no new dependency). Applies
to every request through `me_sig.lua`, not just this one endpoint — `/check-auth` included.

**The vertical slice**:
- `POST /domains/metadata` (new `location` block, `setNginxConfigRoutes.ts`) — `me_sig.lua`
  verifies the proof, an `access_by_lua_block` bridges `ngx.ctx.me_identity`/`me_scopes` into
  nginx variables, `proxy_pass`es to the daemon with them as `X-Netget-Identity`/`X-Netget-Scopes`.
  No business logic in Lua — verify and forward only, per decision 4.
- `POST /domains/metadata` in `localNetget.js` (the daemon) — reads those two headers, checks
  `me_scopes` includes `gateway:write:domain-metadata`, writes to a new sidecar file
  (`runtime/domain-metadata.json`, separate from `domains.db` — cannot affect routing regardless
  of what's written), and appends every decision (allowed or denied) to `runtime/audit.log`.

**To run the negative test**: grant `gateway:write:domain-metadata` to one admin's entry in
`gateway-claims.json`'s `grants` map (a real permissions change — deliberately left as a manual
step, not automated). Then:
- Same admin, without the grant → `403 CAPABILITY_DENIED`, audit entry `outcome: "denied"`.
- Same admin, with the grant → `200`, audit entry `outcome: "allowed"`, `domain-metadata.json` updated.
- Confirms `A` (a verified, anchored identity) and `C` (this specific grant) did not collapse.

**Automated, permanent proof**: see
[EncryptedAudienceCapabilityTests.md](./EncryptedAudienceCapabilityTests.md) for the full test
contract — every category, every test, its exact setup and expectation. Summary:
`npm run test:capability-model` (`tests/gateway-capability-model.test.ts`)
runs the same proof end to end against the live gateway, using a dedicated, self-cleaning test
identity — never a real admin's grants. Five categories: payload-bound proof (tamper each of
body/method/path/timestamp/nonce, each independently rejected), capability separation (the jewel:
`valid signed proof + authenticated identity - explicit capability => 403`, plus admin-alone and
unrelated-scope don't satisfy it either), side-effect safety (`domains.db`/routing untouched,
denied writes leave no partial state), audit (both outcomes fully recorded), and the Lua boundary
(Lua verifies-and-forwards only; the daemon independently refuses a request with no forwarded
identity, e.g. if hit directly). Requires a running, already-reloaded gateway — not run in `npm test`.

**Bug this suite found and fixed**: the `/domains/metadata` location ran `me_sig.lua` via
`dofile()` inside `access_by_lua_block` (needed because `access_by_lua_file` and
`access_by_lua_block` occupy the same nginx directive slot). `dofile()` executes the loaded chunk
while still on `dofile`'s own C call frame; `me_sig.lua`'s `deny()` calls `ngx.exit()`, which needs
to yield — yielding across that C boundary aborted the connection ("attempt to yield across C-call
boundary" in `netget_error.log`) any time a proof was actually rejected on this route. `/check-auth`
never hit this, since it uses `access_by_lua_file` directly. Only the payload-tampering tests in
this suite exercise a rejected proof on `/domains/metadata`, which is exactly why manual testing
(always used a valid proof for both the negative-by-scope and positive cases) never caught it.
Fixed by `loadfile()()` instead of `dofile()` — `loadfile` only compiles and returns a function,
so invoking it is a plain Lua call with no C frame in between.
