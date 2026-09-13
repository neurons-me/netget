# Gateway Claims Ledger

**Status: Superseded entirely by the E+A signed-delegation mechanism
(2026-09-13).** Everything this doc describes below — the `netget.*`
semantic ledger model, `writeToMonad()`-based mutation, the whole
"ledger is authoritative" invariant — was the OLD design for
`bootstrapOwner()`/`grantAdmin()`/`revokeAdmin()`/`transferOwner()`, and it
is now confirmed BROKEN for a namespace-derived gateway: those methods
wrote an UNSIGNED `writeToMonad()` call, which a monad holding a real
`.me` claim correctly rejects (`NAMESPACE_WRITE_FORBIDDEN` —
`commandHandler.ts`'s `isNamespaceWriteAuthorized()` gate). Proven live in
`modules/netget/Typescript/tests/gateway-claims-live-write-integration.test.ts`'s
own history (it originally caught this failing, before the fix below).

**The real model now**: canonical owner/admins/grants state lives in
`.me` itself, in monad.ai's new `claim/gatewayAuthority.ts` — a kernel-root,
namespace-**independent** branch (`daemon.gateways.<gatewayId>`,
deliberately not nested under any user's `users.<handle>` tree, so
transferring ownership never requires moving state into a different
user's personal branch), mutated only via SIGNED grant/revoke/transfer/
bootstrap calls, each independently re-verified by whichever monad holds
that branch (never trusting netget's own prior check). Two checks per
mutation, never conflated: "vigencia" (is the signing keychain key
currently active — `getKeychainKey`) and "autorización" (does that
identity currently hold gateway authority, per the branch's OWN
`admins` map — never the keychain's own `admin` bit, which means
something narrower: "can administer THAT keychain," not "can administer
this gateway"). `GatewayClaimsManager.materializeFromGatewayAuthority()`
is netget's ONLY remaining role: a plain, unauthenticated read that
refreshes the local `gateway-claims.json` cache — netget needs read
access here, never write permission.

`bootstrapOwner()`/`grantAdmin()`/`revokeAdmin()`/`transferOwner()` (the
methods this whole doc originally described) are kept, doc-commented
LEGACY in `GatewayClaimsManager.ts`, for `gateway-claims.test.ts`'s own
self-owned-ledger model coverage only (a real, distinct scenario: netget
exclusively owning an unclaimed monad) — not the real namespace-derived
flow anymore. `materializeFromNamespaceClaim()` (the base-claim-only,
local-file-only method the 2026-09-12 revision of this doc described) is
similarly superseded in the real flow by a real bootstrap call to
`claim/gatewayAuthority.ts`'s own endpoint.

**Behavior change worth knowing**: deleting `gateway-claims.json` locally
no longer means "unbound" (true under the OLD local-file-only base-claim
model, and under this doc's OLD ledger model too) — the canonical branch
on the monad is the real source of truth now, and survives a local cache
wipe. See `gateway-setup-session.test.ts`'s case 7h.

See session memory `project_mesh_announce_trust_hardening.md`'s "RESOLVED"
section for the full design rationale (options A-E considered, why E+A was
chosen over a local-file bridge or a daemon-held delegation key), and
`claim/gatewayAuthority.ts`'s own header comment for the mechanism itself.
Everything below this point describes the OLD, now-replaced ledger model —
kept for historical context, not as current guidance.

---

## The model

Netget runs over a designated `.me` namespace. The host is only the surface that
accepted the connection; the namespace is the semantic context where durable paths
live.

That means gateway authorization should be rooted in the same monad namespace that
netget already uses for domain records:

```txt
NETGET_MONAD_NAMESPACE
  -> xConfig.mainServerName
  -> local.cleaker
```

`seed` and `namespace` stay separate:

- `seed` is the gateway monad's cryptographic identity.
- `namespace` is the semantic context where writes land.

`GatewayClaimsManager` should not need its own namespace resolver. If it writes to
netget's own monad through `monadHttpClient.ts`, the monad process already decides
the namespace because it was started with `getGatewayRootNamespace()`.

---

## The gap

Historically, `GatewayClaimsManager.ts` treated the local JSON snapshot as the
real source of truth:

```txt
~/.get/runtime/gateway-claims.json
~/.get/runtime/gateway-claims.version
```

That JSON file is important and should stay, because nginx Lua reads it on the hot
path for `X-Me-Proof` verification and scope lookup. Lua needs a local, synchronous,
cheap materialized view.

The problem was that the JSON was not only a materialized view. It was the
authoritative store. The mutation methods:

```txt
bootstrapOwner()
grantAdmin()
revokeAdmin()
transferOwner()
```

mutated the JSON directly and never wrote to `.me` semantic memory. That made
`gateway-claims.json` a second ledger parallel to the kernel.

The `GatewayClaimsManager` path is now corrected: those four methods write
`netget.*` semantic paths first and then refresh the local snapshot from that
ledger. The legacy browser signup path is corrected too: `claim_identity.lua`
still verifies nonce/timestamp/signature at the OpenResty edge, but delegates
the mutation through an internal backend route that calls
`GatewayClaimsManager.registerIdentity()`.

This is the same class of failure that the domain store migration closed: a local
file exists for speed, but it must not be the durable source of truth.

---

## Target paths

Gateway authorization should live under netget's namespace as ordinary semantic
paths:

```txt
netget.owner.identityHash       -> identityHash
netget.owner.username           -> username
netget.admins.<identityHash>    -> true
netget.grants.<identityHash>    -> GatewayScope[]
netget.pubkeys.<identityHash>   -> Ed25519 public key
netget.usernames.<identityHash> -> username
```

These paths are intentionally not rooted in a physical hostname. They belong to the
designated namespace, for example `local.cleaker` locally or `cleaker.me` when the
operator chooses a public namespace.

---

## Materialized snapshot

`gateway-claims.json` remains the file Lua consumes:

```txt
.me semantic memory -> GatewayClaimsManager materialization -> gateway-claims.json -> Lua
```

The JSON shape should remain flat:

```json
{
  "gatewayId": "suis-macbook-air.local",
  "owner": "...",
  "admins": {},
  "grants": {},
  "pubkeys": {},
  "usernames": {},
  "version": "...",
  "updatedAt": 1780000000000
}
```

Lua should not call the monad per request. The monad is the source; the JSON is the
cache.

---

## Migration plan

1. ✅ Add semantic write helpers to `GatewayClaimsManager` using `writeToMonad()`
   and `readFromMonad()` from `src/kernel/monadHttpClient.ts`.
2. ✅ Change the four mutation methods so they first update the semantic ledger,
   then regenerate and flush the local JSON snapshot.
3. ✅ Add `migrateGatewayClaimsToMonad.ts` to import an existing
   `gateway-claims.json` into the semantic ledger once.
4. ✅ Keep all read-side Lua behavior pointed at the JSON snapshot.
5. ✅ Add tests proving both layers stay aligned for `GatewayClaimsManager`.
6. ✅ Move legacy `/me/claim` off direct JSON writes: `claim_identity.lua`
   verifies the proof and delegates to `GatewayClaimsManager.registerIdentity()`.
7. ✅ Close monad `/api/v1/commit`: external semantic commits require a real
   claim signature and honest attribution.

The synchronous read API is preserved. The mutation API is now async because monad
writes are HTTP calls.

---

## Required tests

The migration should not be considered closed until these pass:

- Bootstrap writes `netget.owner.identityHash`, `netget.admins.<owner>`,
  `netget.grants.<owner>`, and the JSON snapshot.
- `grantAdmin()` writes semantic memory and updates the JSON snapshot.
- `revokeAdmin()` tombstones the semantic admin/grant/pubkey/username paths and
  removes them from the JSON snapshot.
- The owner cannot be revoked.
- `transferOwner()` changes `netget.owner.identityHash` without deleting the previous owner's
  admin grant.
- A regenerated snapshot from semantic memory matches the current JSON shape.
- Lua-visible auth still reads only `gateway-claims.json`.
- `reset()` tombstones owner/admin/grant/pubkey/username paths instead of only
  deleting the local JSON snapshot.

The important invariant (as originally written — still true for
`grantAdmin`/`revokeAdmin`/`transferOwner`; **not** how the base claim
works anymore, see the status note at the top of this file):

```txt
semantic ledger is authoritative
gateway-claims.json is materialized
Lua consumes the materialized view
```

For the base claim specifically, the invariant is now:

```txt
namespace's own .me claim is authoritative (verified via live keychain +
  Ed25519 signature at claim time, not stored again by netget)
gateway-claims.json is a local cache of that verification's result —
  losing it is a real local reset (another identity CAN then bind), not a
  silently-recoverable cache miss
Lua consumes the same materialized view, unchanged
```

---

## Related

- [DomainStoreSplitBrain.md](./DomainStoreSplitBrain.md) - the already-fixed
  version of this same split-brain pattern for domain routing.
- [GatewayCapabilityModel.md](./GatewayCapabilityModel.md) - signed capability
  checks that currently consume `gateway-claims.json`.
- [EncryptedAudienceCapabilityTests.md](./EncryptedAudienceCapabilityTests.md) -
  the live proof that `A`, auth, and `C` stay separate for gateway writes.
