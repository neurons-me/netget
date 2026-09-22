# The gateway is an execution route, not a second entry

Design for review, 2026-09-22. Nothing here is implemented. Extends
[GatewayAccessContract.md](./GatewayAccessContract.md) — specifically open decision 6 ("`ROLE` still reads the
hostname") and order §11 step 6 ("the document a door renders comes from the resolved mount reference's node,
never from the hostname") — one layer *below* what that document closes: not which bundle a door renders, but
which **server** answers at all.

## 1. The gap, verified against the running config, not assumed

`setNginxConfigRoutes.ts` generates one `server{}` block, aliased under five names:

```
server_name local.netget local.host local.cleaker <hostname>.netget localhost 127.0.0.1;
```

Every admin route in that block (`/setup/*`, `/admin-session/*`, `/domains`, `/gateway-admin/*`, the rest of
`GatewayAccessContract.md` §5's table) resolves through one fixed `resolveGatewayUpstream()`:

```ts
const fallback = 'http://127.0.0.1:3000';
```

— netget's own Express process (`backend/proxy.js`, confirmed running on port 3000 this session), serving its
own separately-bundled React app ("Netget-REACT"). This never touches `surface_proxy.lua`, `apps.json`, or any
monad. It is a **second, parallel entry point** into this machine's `.me` state, reached by a completely
different mechanism than every other namespace on the box.

Contrast with `{handle}.<hostname>`, which already resolves the way NRP says everything should (Rule 1: *"Hosts,
ports, URLs, gateway routes, and monad process names are execution details"*; Rule 2: *"Monads Are Invisible
Execution Routes"*): `surface_proxy.lua` looks up `apps.json`, picks the freshest registered monad, proxies to
it. The gateway's own admin surface is the one namespace on this machine that does not go through that path.

## 2. The correction this design is built on: one mechanism, not one tree

Not "everything is one namespace." Each identity keeps its own `.me` kernel — its own tree, its own secrets,
untouched by any of this. What is singular is the **resolution mechanism**: the `me://namespace[selector]/path`
grammar, `surface_proxy.lua`'s lookup, `resolveSelfDispatch`'s "should I answer this" check, the `MountReference`
a page resolves itself against. One mechanism that can anchor into *any* tree — never a second tree, never a
namespace that owns a domain.

`netget` — the module, the process, the OpenResty config it writes — has no more claim to being a
special case than any other caller of that mechanism. Its job, per `CLAUDE.md`'s own description, is exactly
"OpenResty config generation. Routes hostnames → monads via `surface_proxy.lua`." Nothing about serving its own
admin content is in that description; that content ended up parallel to the mechanism because bootstrapping had
to work before anything was registered in the mesh, not because the gateway is supposed to be a second kind of
thing.

## 3. What already exists, reused, not rebuilt

Four pieces this design does not invent:

- **`resolveSelfDispatch`** (`monad/Typescript/src/http/selfMapping.ts`) — already answers "should I, this
  monad, serve this namespace" (`mode: 'local'` when no selector and the namespace matches `self.identity`;
  `'foreign'`/`'remote'`/`'unscoped'` otherwise). Already load-bearing for `{handle}.<hostname>`.
- **`MountReference`** (`namespace + nodePath`, GUI branch `feat/document-left-bar`,
  `feat/mount-reference-node-path`) — a page resolves *where it is mounted* without ever reading a hostname,
  injected or fetched via `GET /__provider`. Verified end to end already (`GatewayAccessContract.md` §7).
- **The shared `GUI.document.json` shell**, with netget's Dashboard/Domains/Logs as its own document extension
  merged onto the base document — not a hand-written admin UI. Also already shipped (`GatewayAccessContract.md`
  §7, "Doors migration step 3, closed").
- **`UNCONFIGURED_DEFAULT_NAMESPACE = 'local.cleaker'`** (`monad/Typescript/src/kernel/netgetMonadProcess.ts`) —
  already the documented default for a monad with nothing else configured, with its own comment already stating
  the reasoning this design needs: *"This monad is a separate process/port/kernel from any other monad on the
  machine, so reusing the same namespace string isn't a collision — nothing else routes traffic to it by that
  name."*

The only genuinely new piece is connecting the OpenResty block for the local-admin aliases to
`surface_proxy.lua`'s mesh proxy instead of the fixed `gatewayUpstream`, and retiring the Express process that
fixed target pointed at.

## 4. The model

`local.host` (and its aliases) stop being a hardcoded `proxy_pass` target and become **a namespace resolved the
same way as any other**:

```
local.host request → surface_proxy.lua → apps.json lookup → freshest registered monad
                                                            → resolveSelfDispatch: mode 'local'
                                                            → serves GUI.document.json + netget's extension
                                                            → reached via /netget, like any other route
```

netget's role narrows to exactly its documented one: generate the config that routes a hostname into the mesh.
Whether `backend/proxy.js` shrinks to nothing or survives as a thin, optional bootstrap shim is the open
question in §6 — either way, it stops being *the* answer for the local admin surface and becomes, at most, a
fallback for when nothing else is running.

## 5. What this does not solve — named, not implied by silence

- **§10 open decision 6, not closed by this alone.** `frontendRole({host: window.location.hostname, boot})`
  still exists client-side, deciding which document extension to merge. This design supplies the missing
  *server-side* piece that decision needs (every door now resolves through the same mechanism, so there is no
  remaining reason for the client to branch on hostname) — but retiring the hostname read itself is a separate,
  follow-up change to `App.jsx`, not automatic from this one.
- **Inherits `surface_proxy.lua`'s existing gap, does not add a new one.** `CLAUDE.md` gap 2: routing is by
  trust-tier + recency, not verified claims. Routing the gateway's own admin surface through this same
  mechanism means it inherits that same limitation — contained today only because exploiting it needs code
  execution on the same machine (per that gap's own containment note). Worth stating plainly before this
  pattern is ever used beyond one local machine.
- **Bootstrapping is a real open question, not a detail.** Today, something always answers `local.host` because
  netget's Express process is always running. Under this design, if no monad is currently registered, the mesh
  lookup finds nothing. §6 below names this as the first thing to settle, not something this design quietly
  assumes away.
- **Production (`cleaker.me`/`netget.site`) is out of scope here.** They are already two separate doors by
  design (`GatewayAccessContract.md` §1), not aliases the way the local names are — this design only closes the
  local-alias case, and does not claim the same collapse should happen in production.

## 6. Open decisions

1. **Which literal namespace represents the local admin surface.** Reuse `local.cleaker` (already the
   documented unconfigured default, already namespace-string-safe to share per its own header comment), or
   introduce a distinct reserved name (`local.host` itself, or something new) so "the admin surface" and "an
   unconfigured user namespace" are not the same string for two different reasons.
2. **The bootstrap answer.** Whether netget's own process launches or bundles a minimal monad instance whose
   only job is to self-dispatch for the local admin namespace (making netget's "admin backend" literally *a
   monad*, not a separate stack) — or whether some other always-available fallback is kept. This is real
   packaging/process-lifecycle work, not a routing decision.
3. **Whether closing §10 open decision 6 (retiring `frontendRole`'s hostname read) rides on the same change or
   ships as its own, later step.** Leaning toward later, per this session's own standing preference for one
   proven step before the next.

## 7. Order — minimal step first, on disposable infrastructure only

Per this session's standing rule: never against the real ambient gateway.

1. Confirm `resolveSelfDispatch` already returns `mode: 'local'` correctly for a namespace with no selector
   matching `self.identity` — check existing coverage before writing anything new.
2. On a disposable OpenResty + a real monad: change **one** alias (`local.host` only, not all five) to proxy
   through `surface_proxy.lua`'s mesh location instead of the fixed `gatewayUpstream`.
3. Start a real monad configured with the chosen local-admin namespace (open decision 1); confirm it
   self-dispatches and serves the shared document + netget's extension, reached at `/netget`, end to end.
4. Only then: fold in the remaining aliases, decide the bootstrap answer (open decision 2), and retire or
   shrink `backend/proxy.js`.

Not started. Sequenced after this design is reviewed, per this session's own pattern — a real recorded grant on
one node before scaling to the gateway guard applies here too: a real resolved request on one alias before
touching the rest.
