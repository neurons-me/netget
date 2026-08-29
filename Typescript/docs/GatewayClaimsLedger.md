# Gateway Claims Ledger

**Status: Built (2026-08-29).** `GatewayClaimsManager` mutations write the
semantic ledger first and then materialize `gateway-claims.json` for nginx Lua.
The legacy `/me/claim` Lua handler now verifies the signed proof and delegates
state mutation to the ledger-backed backend instead of writing JSON directly.
This note mirrors the shape of
[DomainStoreSplitBrain.md](./DomainStoreSplitBrain.md), but for `gateway-claims.json`.

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

The important invariant:

```txt
semantic ledger is authoritative
gateway-claims.json is materialized
Lua consumes the materialized view
```

---

## Related

- [DomainStoreSplitBrain.md](./DomainStoreSplitBrain.md) - the already-fixed
  version of this same split-brain pattern for domain routing.
- [GatewayCapabilityModel.md](./GatewayCapabilityModel.md) - signed capability
  checks that currently consume `gateway-claims.json`.
- [EncryptedAudienceCapabilityTests.md](./EncryptedAudienceCapabilityTests.md) -
  the live proof that `A`, auth, and `C` stay separate for gateway writes.
