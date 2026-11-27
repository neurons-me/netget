# The namespace and its gateway

This is the target model for one namespace, `cleaker.me`, and netget as its gateway. It is the shape to build toward, not a log of how we got here. Section 8 records the gap with the code as it runs today.

The word **gateway** stays: netget is the gateway of this namespace. The name of the branch, and of the URL, is **`netget`**, not `get`. So `suign.cleaker.me/netget` is `@suign.netget`.

---

## 1. One tree

There is one namespace: `cleaker.me`. Its owner holds the root key. Handles are not other namespaces; `<handle>.<root>` is the same as `cleaker.me/@handle`, an entrance into the node `@handle`. What is unique to a handle is its identity and its keys.

There is no separate registry of "gateways". Any node may have a `netget` branch, and that branch is simply part of the tree. The same four children — `domains`, `apps`, `logs`, `hosts` — sit under every `netget`.

```
cleaker.me                     ← the root; its owner holds the root key
├── netget                     ← the gateway of the root
│   ├── domains                  (direct or mesh)
│   ├── apps
│   ├── logs
│   └── hosts                    (which monads serve this node)
├── @suign                     ← the handle's node; its owner holds its keys
│   ├── netget
│   │   ├── domains
│   │   ├── apps
│   │   ├── logs
│   │   └── hosts
│   └── … (the rest of suign)
└── @jabellae
    └── netget
        ├── domains
        ├── apps
        ├── logs
        └── hosts
```

Netget is the program that runs on the monads: it reads the tree and operates nginx, certificates, and routes. It is not a node of its own. `cleaker.me/netget` is simply the root's `netget`.

The files netget keeps on the machine today, such as `domain-map.json` and `gateway-claims.json`, become **caches generated from the tree**, so nginx does not have to read the tree on every request. Sqlite goes away.

---

## 2. Entries only say where you land

An entry (a domain or a path) grants no permission. It only places you at a point in the tree. What you can do comes from who you are at that point.

| Entry | Lands at |
|---|---|
| `cleaker.me` | the root |
| `cleaker.me/netget`, `netget.site` | `cleaker.me.netget` |
| `suign.cleaker.me` | `@suign` (`<handle>.<root>` ≡ `cleaker.me/@handle`) |
| `suign.cleaker.me/netget` | `@suign.netget` |
| a domain of one's own, e.g. `suign.com` | whatever `@suign.netget.domains` says |

`netget.site` is only a pointer to the internal netget at `cleaker.me/netget`.

---

## 3. What you see depends on who you are

At any node:

- **A visitor** sees the namespace as in Storybook example 1 (Getting Started / Namespace → 1 · Namespace only).
- **The owner of the node**, at `/netget`, sees their panel: their domains, their apps, and their logs.
- **The owner of the root**, on `@suign.netget`:
  - may view;
  - may **suspend** only what belongs to their machine (the nginx route, the certificate) — they turn the entry off, and they do not touch the `@suign.netget` tree;
  - may not edit or sign as suign.

There is no separate "gateway admin" permission. Being the owner of the node **is** the permission. In the shell, `gateway:admin` is computed from that (the HTTP name is unchanged for now; see section 8).

**Who owns a handle.** Today a handle becomes someone's with the first signed claim (`claimNamespace` in `modules/monad/Typescript/src/claim/records.ts`: if a claim already exists, the answer is `NAMESPACE_TAKEN`). Whether anyone may create a handle under `cleaker.me`, or that is a rule of the root's owner, is still open (section 11).


### The namespace's own keys (`keys.namespace`)

The keyring belongs to the namespace, at the root: `cleaker.me/keys.namespace`. It is not in the owner's vault (`suign.cleaker.me/keys.namespace`). The owner gets access to that part of the tree without absorbing it into their own `.me`. A change of owner does not move the keys; they are re-encrypted for the new owner. Each person's own keys stay in their own `.keys`.

```
cleaker.me
└── keys
    └── namespace              ← the namespace's own keyring, not the owner's vault
        ├── meta.app           App ID, Secret, redirect (this namespace's Facebook app)
        └── netget             the gateway's own material; out of login
```

- The netget key stays out of login: it is opened only when the root needs it, the same rule as today's `keys.netget`.
- What the server must use alone (the Meta App Secret) is stored in that same branch, also encrypted for the server key, so the monad can do the token exchange when the root is not online. That encryption uses the hosting permission of section 4. It is not built yet.
- Custody is still open. `.me` never writes `_()` values to disk, so someone has to supply the `keys.namespace` secret every time the process starts. For the Facebook exchange, today only the environment variables `META_APP_ID` and `META_APP_SECRET` work. Those are a temporary stand-in, not the official copy. The official copy is `keys.namespace.meta.app`.
- The Keys card can already type those fields, but the save stays in the browser vault. It does not reach the server. netget reads the public App ID from `keys.namespace.meta.app.id` on the tree (else `META_APP_ID`); the App Secret stays in `META_APP_SECRET`. The HTTP routes are mounted, with a public policy. Do not deploy them to the VM until the monad's `keys.*` reservation is there. See [Connect with Facebook](./facebook-connect.md).

---

## 4. A public axis, and two keys

The namespace is a **public constant axis**. Its seed is its public name (`cleaker.me`); from that name comes the `identityHash`, the same for everyone. It never rotates, because it protects nothing. Everything around it is the mechanism that can rotate: declared secrets, the owner's keys, the server key, and who can open each audience.

A public seed opens nothing secret. In v3, the key for a secret branch is built from labels, paths, and the value declared with `_()`, not from the seed. v4 does not use the seed either: it uses the random identity root, wrapped with a password. Knowing the name does not open `keys.namespace`, or any other root secret.

**Authority never comes from the seed.** `prove()` signs with a key derived from the seed: it calls `deriveBranchProofSeed` in `me/Typescript/src/me.ts` (line 683); that function is defined in `me/Typescript/src/crypto.ts` (line 1259). Nothing that governs may be accepted as a `prove()` signature from a public seed: being the owner, handing over the root, signing `netget.hosts`, granting permissions. If any of that came from the seed, anyone who knows the name could sign it, and the signature would be indistinguishable from the real owner's.

Today the monad already keeps that line for writes: they are authorized by the public key registered at the first claim. `isNamespaceWriteAuthorized` is defined in `modules/monad/Typescript/src/claim/replay.ts` (line 433); the write check that calls it is in `modules/monad/Typescript/src/handlers/commandHandler.ts`. The monad's `SEED` is not involved. Mesh announcements are signed with the server key (`MONAD_PRIVATE_KEY`), which is random.

A person's seed (the 12 words) is different: it must stay secret. If it were public, anyone could `prove()` as that person.

The public `identityHash` is not authority either. That is the same principle. The fix now on origin binds each `identityHash` to its own claim, and gateway authority to the namespace where that identity is anchored (monad `cda690a3`, `4501dd0d`, `b2581b4b`; cleaker `54d571b`).

The server still needs a key that lives **on the server**, to work alone around the clock: it answers requests, renews certificates, writes routes, signs its messages to the mesh.

Today the two keys already exist, and they are not bound to each other. Gateway authority is the key of the anchored identity's claim (for example jabellae's), which comes from that person's 12 words, not from the VM's `SEED`. Where that key is held today was not checked. So the remaining work in section 9, step 3, is likely smaller than it first looked: what is missing is the hosting signature that binds the server key to the owner, not a move of "the owner key off the VM" as if that key were the `SEED`.

- **Server key: already random, already on the machine.** In `modules/monad/Typescript/src/http/selfMapping.ts`, `ensureCleakerIdentityConfig` generates an Ed25519 keypair per monad (`crypto.generateKeyPairSync("ed25519")`) and persists it to `self.keys.json` (`chmod 0600`). The comment in that function says it is never derived from `SEED` / `NAMESPACE_SEED`, so as not to mix "authority over the namespace" with "identity of this process." (An older `deriveEd25519KeyPairFromSeed` is still in the file and has no callers in `src/`.)
- **Owner key: the key of the anchored claim**, from the owner's 12 words, never from the public seed. The target is that it lives in the owner's `.me`, off the VM. The monad's `SEED` (the kernel root, `new ME(seed)`; `getKernel()` reads `process.env.SEED` or `ME_SEED` once) may be the namespace name: that is fine as the public axis, and it opens nothing secret. A `prove()` signature from that seed must not be accepted as owner authority.
- **What is missing is the signature that binds them:** "this server key serves me."

The target, at its minimum, is therefore:

| | Owner key | Server key |
|---|---|---|
| Whose | the owner of `cleaker.me` (or of a node) | the monad, the process on the machine |
| How it is made | at random, never from the public seed (the random root already available in `.me`) | already random, already created (see above) |
| Where it lives | in the owner's `.me`, on their device or vault, **off the VM** | in `self.keys.json` **on the VM** |
| What it is for | rarely: grant or revoke permissions, hand over the namespace | constantly: operate |

Plus **one signature** from the owner key: "this server key serves me." The server accepts work for `cleaker.me` only when it has that signature.

This is the same split already used for domains: the registrar account for `cleaker.me` is the owner's and is not on the server; the SSL certificate's private key sits in nginx, on the VM. If the VM is compromised, the certificate is revoked and reissued; the domain is not lost. Nobody would say the domain and the certificate are the same thing, even though both "are `cleaker.me`". These two keys are that, applied to the namespace.

The problem to close is not that the namespace seed is guessable — it can be the public name. The problem is any authority derived from it. If the owner key is off the VM, stealing the VM yields only the server key; the owner withdraws that server key, stands up another, and remains the owner. The public name stays what it is. Where the anchored claim key (jabellae's) is held today was not checked.

### The hosting signature is already designed

This signature is not something to invent now. It is already designed in `modules/cleaker/Typescript/typedocs/Surface-Identity-Claims.md` (status DESIGN, verified against the code on 2026-08-28; not implemented). That document already records that the surface keypair exists (`ensureCleakerIdentityConfig` / `self.keys.json`) and that the gap is the claim that binds it to a namespace. For a surface serving a namespace it does not own (this VM serving `cleaker.me`), that is not a self-claim: the namespace's claim holder must delegate the right to serve. The branch designed there is `<namespace>.netget.delegates`.

This model's `netget.hosts` is that same signature ("this server key serves me"). The path name differs. We follow that design rather than inventing a new form; the name (`hosts` versus `delegates`) is reconciled when the exact form is specified.

### The hosting signature is a security boundary

Today the monad decides what is "its own" from the namespace it booted with. In `modules/monad/Typescript/src/claim/gatewayAuthority.ts`, `isNamespaceLocalToThisInstallation` uses `isRecognizedOwnRootConstant` (`kernel/manager.ts`), fixed at process start from `getRootNamespace()` (`ME_NAMESPACE` first) and `MONAD_SELF_IDENTITY` — not from anything a request can supply. Two guards depend on it and reject foreign namespaces:

- claims, with `FOREIGN_NAMESPACE_REJECTED` (`appendSemanticMemory` in `claim/memoryStore.ts`, when `isForeignNamespaceCollapsingToRoot` is true);
- the keyring (`writeKeyRecord` in `claim/keychain.ts`, which writes through that same guard).

`bootstrapGatewayAuthority` checks `isNamespaceLocalToThisInstallation` again.

Once the monad's identity is no longer the namespace, "accept what hangs off me" no longer works, because "me" is no longer `cleaker.me`. The question becomes: "does this hang off a namespace that signed a hosting contract with me?" Those guards must then come from **which namespaces this monad is authorized to serve** — the hosting signature above. That signature is a security boundary, not merely a record. A forged contract would let someone register a foreign namespace.

Trust comes from the **signature**, verified against the namespace's public owner key, not from where the contract is stored. The contract can live in the tree the monad serves (this model's `netget.hosts`, or `<namespace>.netget.delegates` as already designed).

The delicate part is the first install (a chicken-and-egg): the server key already exists, but the owner, with their `.me` unlocked, must place `pub(owner)` in the monad's configuration and sign the first hosting entry, at a moment when the monad still has no contract to consult. How that first receipt works is an open decision (section 11).

---

## 5. Change of owner

The current owner signs the handover of the root (or of a node) to the new owner's key. This is **root rotation**, already kept distinct from changing a secret. The tree stays where it is; earlier signatures remain valid; from then on the new key is in charge. That node's `netget` is included, because it is part of the tree.

- **What the new owner inherits:** the whole tree, its `netget`, and the list of monads that serve it.
- **What they do not inherit:** the monads themselves. The server key stays on the machine; monads belong to a person's `.me`, not to the namespace.

Because earlier signatures remain valid, the hosting permission stays in force automatically. **Path 1 is the default:** the previous owner keeps hosting, as a service in the new owner's name. The new owner must **revoke** that permission if they want to leave. The other side can end it too: the owner of the monad can stop hosting.

Copying the tree onto the new owner's own monads (path 2) is not designed here; see section 10.

---

## 6. A handle on another machine

If suign brings their own monad, the `@suign` tree is the same. The only change is who hosts it. The root no longer approves that handle's domains, because they no longer use the root's nginx. The rules "the root approves and may suspend" are **hosting rules**, not namespace rules: they apply only while that handle is hosted on the root's machine (approval of a handle's domains, when it is, is in addition to proof of DNS).

---

## 7. Logs

Lines that carry a host are tagged host → node, so each owner sees only their own. Nginx errors that belong to no host stay visible only to the root.

---

## 8. Current state, against this model

HTTP routes and capability names (`/gateway-identity`, `gateway:admin`, `gateway:logs`, and the other `gateway:*` scopes) stay as they are for now.

| Area | Today | This model |
|---|---|---|
| Identity | The server key already exists and is random (`self.keys.json`, `ensureCleakerIdentityConfig`). The namespace seed may be the public name: that is the axis, and it opens nothing secret (v3 secret branches come from `_()`, not the seed; v4 uses the random identity root). Writes are authorized by the key registered at the claim (`isNamespaceWriteAuthorized`), not by the monad's `SEED`. Mesh announcements use `MONAD_PRIVATE_KEY`. `isNamespaceLocalToThisInstallation` / `isRecognizedOwnRootConstant` still accept only what hangs off the boot identity. There is no signature binding the server key to the namespace. A public `identityHash` is not authority (fix on origin: monad `cda690a3`, `4501dd0d`, `b2581b4b`; cleaker `54d571b`). | The public name remains the constant axis. Owner authority is a random key, off the VM, never a `prove()` signature from the public seed. Server key stays as it is. Guards come from the hosting signature (section 4; already designed in Surface-Identity-Claims.md). |
| Gateway authority | A separate claim: `daemon.gateways.<gatewayId>` in `modules/monad/Typescript/src/claim/gatewayAuthority.ts`, and `netget.owner.*` in `GatewayClaimsManager.ts`, materialized as `gateway-claims.json`. `/check-auth` sets `isOwner` when the identity is that single `claims.owner`. | The owner of the node is the owner of its `/netget`. No separate gateway claim. `gateway:admin` is computed from node ownership. `gateway-claims.json` remains only as a cache derived from the tree, for Lua (`me_sig.lua`, `operator_access.lua`, `auth.lua`). |
| Domains | Stored under `users.<owner>.domains["example.com"].…` in `kernel/domainStore.ts`, with an index at `users.netget.domainIndex`. `GET /domains` returns the **whole** list (`getDomains()`). On the VM, rows from the old sqlite table were never migrated into the tree. `type: 'direct' \| 'mesh'` is not implemented. | `@<owner>.netget.domains`. The API returns only the node of this session. Sqlite is migrated into the tree; `direct` / `mesh` exist; `domain-map.json` is generated from the tree. |
| Apps | A machine file, `~/.get/runtime/apps.json`, not owned by a node. | `<node>.netget.apps`. `/apps/report` writes to the node it is told to. |
| Logs | Nginx files on the machine, not split by handle. | `<node>.netget.logs`, tagged as in section 7. |
| Handle entries | `resolveEntry` (in `session/entryContext.js`, via `rootNamespaceOf`) places a handle at the **root** (`namespace: cleaker.me`, `semanticPath: '/'`). | `suign.cleaker.me` lands at `@suign`; `/netget` on that entry is `@suign.netget`. |
| Who sees the panel | After `f04947d` (now on `main`), a visitor on any entry sees Storybook example 1. The panel is offered at the `/netget` pointer to whoever passes the **root** `gateway:admin` check. On `suign.cleaker.me/netget` that panel is still the **root** gateway's (unscoped `/domains`, `/apps`, `/logs`), not `@suign`'s. `netget.site` already behaves as a pointer to `cleaker.me/netget`. | The panel at `@suign.netget` is the gateway suign administers, scoped to that node, and only its owner (or the root, with the narrow hosting rights in section 3) can use it. |
| Sqlite | Still in the tree: `src/sqlite/*`, `netget.cli.ts`, `localNetget.js`. | Removed. |
| Namespace keys | There is still no server-readable `keys.namespace` branch at the root. The Keys card lets the owner type `keys.namespace.meta.app` (id, secret, redirect), but that save stays in the browser's encrypted vault and does not reach the server. A user-level `.keys.meta.app` may still exist; Connect no longer uses it. The exchange module (`facebookExchange.ts`) prefers a tree reader that is not implemented, then `META_APP_ID` / `META_APP_SECRET`. The HTTP routes `/oauth/facebook/app` and `/oauth/facebook/exchange` are mounted and public; the public App ID is read from `keys.namespace.meta.app.id` (else `META_APP_ID`), and the App Secret stays in `META_APP_SECRET`. Do not deploy this to the VM until the monad's `keys.*` reservation is there. See [Connect with Facebook](./facebook-connect.md). `keys.netget` is excluded from login. `.me` never writes `_()` values to disk, so the server cannot yet open a tree secret at start. | The namespace's own keyring, `cleaker.me/keys.namespace`, not in the owner's vault. The owner gets access without absorbing it; a change of owner re-encrypts for the new owner. Netget stays out of login. Server-usable entries are encrypted for the server key (section 4). Someone must still supply the `_()` secret at each server start. Env vars are only the interim fallback. |

The UI now on `main` (the .GUI without the Facebook production hook, and netget `c13be4e` + `f04947d`) does not show the handle panel to a visitor, and does not invent a per-handle scope. It does not yet implement this model.

The Facebook connect button itself is now in the published .GUI (PKCE in the browser; public App ID from `GET /oauth/facebook/app`). netget mounts those routes and reads the public App ID from the tree. That work must stay off the VM until the monad's `keys.*` reservation is deployed. See [Connect with Facebook](./facebook-connect.md).

---

## 9. Order of work

Each phase is tested on disposable infrastructure. Any phase that touches production needs Sui's approval. The rotation plan depends on where the hosts signature lives, which this model fixes, so the model is agreed **before** the root-key work.

1. **Phase 0 — done.** The UI is on `main` and applied on the VM (build `D4-FoTtX`): the .GUI (five commits without Facebook) and netget `c13be4e` + `f04947d`.
2. **Agree this document** as the model, before further code.
3. **Owner authority and monad identity.** The server key already exists; this step does not create it. The public seed stays the axis (it can be the name; it opens nothing secret). Today's gateway authority is already the key of the anchored identity's claim (for example jabellae's), from their 12 words, not the VM's `SEED` — so this step is likely smaller than it first looked (section 4). What remains is to put the first hosting signature in place (already designed in Surface-Identity-Claims.md) and to confirm where that claim key is held (not checked). This still needs its own plan and Sui's approval, before step 4. Existing handle claims on the VM must stay valid (`reRootNamespaceClaims` in `claim/records.ts` already re-issues claims under a new root, and the plan has to use or match something of that kind). Custody of declared secrets (`keys.namespace`) remains open (section 11): `.me` never writes `_()` values to disk, so each start someone must supply that secret.
4. **Authority from the tree.** `daemon.gateways` and `netget.owner.*` cease to be the source. `gateway:admin` means "owns the node at this pointer". `gateway-claims.json` is only a cache for Lua.
5. **Move the rest of the gateway into the tree, per node.** Domains (`users.<owner>.domains` → `@<owner>.netget.domains`; migrate the VM's old sqlite; add `direct` / `mesh`; generate `domain-map.json` from the tree), then apps, then logs.
6. **Entries per node.** `suign.cleaker.me` lands at `@suign`. Each node has its `/netget`. `netget.site` remains a pointer to `cleaker.me/netget`.

---

## 10. Later, comes for free

A hosting marketplace, selling the namespace, several machines, or copying the tree between monads are not reasons to build more than section 4 today. They fall out later, if they are ever needed, because the two keys are already separate. Putting them in the core design now would complicate it without need.

When a new owner wants to revoke hosting and bring their own monads, the tree has to be copied onto those monads. That copy does not exist yet (tree sync, phase 3 of the mesh roadmap). Until it is built, a change of owner can only keep the previous owner hosting (section 5).

---

## 11. Open decisions

The shape above is agreed. What this document does not specify, and should be decided before the phase that needs it:

- The exact signed form of the hosting signature. Follow `modules/cleaker/Typescript/typedocs/Surface-Identity-Claims.md` rather than designing a new one; reconcile this model's `netget.hosts` with the `<namespace>.netget.delegates` branch designed there.
- How the monad first receives `pub(owner)` and the first signed hosting entry at install, when it still has no contract to consult (section 4).
- **Custody of `keys.namespace`.** `.me` never writes `_()` values to disk. Every time the server starts, someone has to supply that secret (for the Facebook exchange, among other uses). Today only the environment variable works. How a `keys.namespace` entry is also encrypted for the server key, and how the monad receives that secret at start, depends on the hosting permission (section 4).
- Whether anything still accepts a seed-derived `prove()` signature as root authority. Writes on the monad already use the claim key, not the `SEED`. Lua (`me_sig.lua`, `auth.lua`) was not checked. If something does accept a seed-derived signature, that is the risk this model forbids.
- **`keys.*` is not reserved the way `keychain.*` is.** `isKeychainReservedPath` in `modules/monad/Typescript/src/claim/keychain.ts` (line 179) only reserves `keychain` and `keychain.*`. An unclaimed namespace accepts unsigned writes on the rest: in `handlers/commandHandler.ts` the claim check is skipped when there is no claim; `daemon.*`, `netget.*`, and the routing records are protected, `keys.*` is not. So if the `cleaker.me` root has no claim, anyone could write their own `keys.namespace`, for example their own Facebook App ID. This was read from the code, not tested, and whether the root already has a claim on the VM was not checked. Two options: reserve `keys.namespace` the same way as `keychain.*`, or require the root to be claimed before it accepts writes.
- The procedure for the production change of owner authority (section 9, step 3): how the VM is cut over, and how existing handle claims (e.g. jabellae's on the VM) stay valid with the new owner key. The public axis is not rotated. That is its own plan.
- Whether anyone may create a handle under `cleaker.me`, or that is a rule of the root's owner (section 3).
- The mapping used to migrate today's `users.<owner>.domains` records and the VM sqlite rows onto `@<owner>.netget.domains`.
- How a host-less nginx error is distinguished from a line that should be tagged to a node (section 7).
- How a copy of the tree between monads is requested, authorized, and verified (section 10) — not needed for the core design.
