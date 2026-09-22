# The gateway is an execution route, not a second entry

Design for review, revised 2026-09-22 (v2 — corrected after user review; nothing implemented in either
version). Extends [GatewayAccessContract.md](./GatewayAccessContract.md) — specifically open decision 6 (`ROLE`
still reads the hostname) — one layer *below* what that document closes: not which document a door renders, but
which **server** answers at all. §11 step 6's own wording ("the document a door renders comes from the resolved
mount reference's node") is the OLDER phrasing that §8's later two-layer correction already superseded; this
document follows §8's corrected model (§4 below), not that older sentence.

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
untouched by any of this. What is singular is the **resolution mechanism** — one thing that can anchor into
*any* tree, never a second tree, never a namespace that owns a domain:

```
Document (the app — including netget's own admin panel)
        ↓
Mount reference: namespace + node
        ↓
NRP resolution → available transport → a runtime that can legitimately serve it
        ↓
Content and operations, per the identity and the grants it holds
```

`netget` connects these pieces. It does not decide your identity, does not change which tree you are on, and
does not need a second, parallel administration system. Its own admin panel can be *a document like any other*;
its operations run through whichever runtime is actually authorized — never through a bespoke stack that
answers on its own authority.

**Causality matters, and the first draft of this design got it backwards.** The document is not something
namespace resolution *produces*. Which document loads (netget's admin bundle vs. any other) is a fact of which
app this is — authored, fixed, decided by which entry point was opened — exactly `GatewayAccessContract.md` §8's
own corrected model: *"Document — authored, fixed, decided by which bundle/entry point this is... Namespace — a
CONNECTION the document makes, a parameter."* What this design's mesh resolution decides is only the middle two
layers of the diagram above — which transport, which runtime — never the top layer. A document does not have to
be a *result* of resolution, but it can also be stored and obtained from the tree — that storage question is
separate from the point being made here: independence means the CONNECTED context never automatically redefines
which app this is, not a claim about where a document's bytes happen to live.

`netget`'s job, per `CLAUDE.md`'s own description, stays exactly "OpenResty config generation. Routes hostnames
→ monads via `surface_proxy.lua`." Its admin content ended up parallel to that mechanism because bootstrapping
had to work before anything was registered in the mesh — not because the gateway is a second kind of thing.

## 3. Four limits, named precisely — not solved by wiring alone

**3.1 Recency chooses among validated candidates; it is not the validation.** `surface_proxy.lua` today picks
the freshest registered monad for a namespace. That is a legitimate tiebreaker *once* a candidate is confirmed
to actually serve the requested namespace — it is not itself proof of that, and a restart must never be able to
move a caller onto a different tree just because something newer happens to answer to the same label.

**3.2 A repeated label is not a repeated namespace.** Verified live, this session: two real monads
(`netget`, `netget-claim-harness-dev`) both fell through to `UNCONFIGURED_DEFAULT_NAMESPACE = 'local.cleaker'`
and ended up sharing one `identity_hash` — not because anyone asked for that, but because neither had a
persisted `SEED` (no `env.json` ever existed for either). `netgetMonadProcess.ts`'s own comment — *"reusing the
same namespace string isn't a collision — nothing else routes traffic to it by that name"* — is true only
because NOTHING resolves that name via the mesh today. The moment this design makes `local.host` resolve via
`surface_proxy.lua`, that comment's premise no longer holds: the design must not cite it as justification for
sharing a label once traffic actually depends on it.

**3.3 A self-declared `identityHash` is a configuration check, not an authorization proof.** Comparing two
monads' `identityHash` catches a misconfiguration (two things that should be the same silently aren't) — it does
not prove either one is the *legitimate* destination for the namespace, because nothing stops a server from
declaring any `identityHash` it wants (`CLAUDE.md` gap 1: surface identity is unclaimed; nothing cryptographically
binds a keypair to the namespace it claims to serve). `resolveSelfDispatch` checks whether a monad believes it
should answer — a self-assertion, never a cryptographic claim check. Until that gap is closed elsewhere, this
design does not present mesh selection as *verified* — the walkthrough in §5 uses an explicitly pinned test
destination instead of relying on recency to find the right one.

**3.4 Same `identityHash` proves the same seed-derived identity, not the same up-to-date state.** Two processes
agreeing on `identityHash` only shows they share a `SEED`; it says nothing about whether they hold the same
data right now. Proving continuity across a restart needs a second, independent check: a known, persisted datum
read back with the same value — not identity alone.

## 4. What already exists, reused, not rebuilt

Three pieces this design does not invent:

- **`resolveSelfDispatch`** (`monad/Typescript/src/http/selfMapping.ts`) — already answers "should I, this
  monad, serve this namespace" (`mode: 'local'` when no selector and the namespace matches `self.identity`;
  `'foreign'`/`'remote'`/`'unscoped'` otherwise). Already load-bearing for `{handle}.<hostname>`. Per §3.3, this
  is the self-assertion check, not a legitimacy proof — reused as what it actually is, not overstated.
- **`MountReference`** (`namespace + nodePath`, GUI branch `feat/document-left-bar`,
  `feat/mount-reference-node-path`) — a document resolves *where it connects* without ever reading a hostname,
  injected or fetched via `GET /__provider`. Verified end to end already (`GatewayAccessContract.md` §7).
- **The shared `GUI.document.json` shell**, with netget's Dashboard/Domains/Logs as its own document extension
  — a document decision, unconditional on which app this is, never on what the connection resolves to (§8's
  corrected model, §2 above). Already shipped (`GatewayAccessContract.md` §7, "Doors migration step 3, closed").

The only genuinely new piece is connecting the OpenResty block for the local-admin aliases to
`surface_proxy.lua`'s mesh proxy instead of the fixed `gatewayUpstream`, and retiring the Express process that
fixed target pointed at.

## 5. What this does not solve — named, not implied by silence

- **§10 open decision 6, not closed by this alone.** `frontendRole({host: window.location.hostname, boot})`
  still exists client-side, deciding which document extension to merge. This design supplies the missing
  *server-side* piece that decision needs — but retiring the hostname read itself is a separate, follow-up
  change to `App.jsx`, not automatic from this one.
- **Inherits `surface_proxy.lua`'s existing gap (§3.1-§3.3), does not add a new one and does not close it.**
  Routing the gateway's own admin surface through this same mechanism means it inherits the same
  trust-tier-not-verified-claim limitation (`CLAUDE.md` gap 2) — contained today only because exploiting it
  needs code execution on the same machine. Worth stating plainly before this pattern is ever used beyond one
  local machine.
- **Bootstrapping without a monad already has a partial answer — this is not an open question.**
  `GatewayAccessContract.md` §8's local-first model already covers it: without a resolved connection, the
  document still renders its own local structure and pages; only the parts that genuinely need a connection show
  an explicit "not available" state. Starting a runtime is an *additional* operation on top of that, never a
  reason to keep a second, parallel administration stack as "the" answer to bootstrapping.
- **Production (`cleaker.me`/`netget.site`) is out of scope here.** They are already two separate doors by
  design (`GatewayAccessContract.md` §1), not aliases the way the local names are — this design only closes the
  local-alias case, and does not claim the same collapse should happen in production.

## 6. Open decisions

1. **Resolved: the local admin surface gets its own explicitly configured namespace and an explicitly
   generated, persisted `SEED`** (via `monads env <name> SEED=...` — closing, for this one instance, the same
   `env.json` gap that produced §3.2's real collision) — never `UNCONFIGURED_DEFAULT_NAMESPACE`'s shared
   fallback, precisely because §3.2 shows that fallback is unsafe once traffic depends on the label.
2. **Whether netget's own process launches or bundles a minimal monad instance for this namespace, or some
   other always-available fallback is kept.** Real packaging/process-lifecycle work, not a routing decision, and
   not a bootstrapping *requirement* per §5's own point — the local-first document renders with no runtime at
   all.
3. **Whether closing §10 open decision 6 (retiring `frontendRole`'s hostname read) rides on the same change or
   ships as its own, later step.** Leaning toward later, per this session's own standing preference for one
   proven step before the next.

## 7. Order — one walkthrough, on disposable infrastructure only, proving continuity without conflating label,
identity, state and transport

Per this session's standing rule: never against the real ambient gateway.

1. **Dedicated namespace.** Configure one explicit, non-default namespace for this test alone (open decision 1)
   — never a value anything else on the machine could also fall back to.
2. **Explicitly generated and persisted `SEED`.** Written to that monad's `env.json` before its first start, so
   every subsequent start/restart reuses it deliberately, never by shell-environment accident.
3. **Independent document.** The document served is netget's own admin bundle, chosen because it's the app that
   was opened — not derived from which namespace resolved (§2's corrected causality).
4. **A known read, before and after a restart.** Write one real, known value into that namespace's tree; read it
   back; restart the monad; read it back again. Passing means the SAME persisted datum came back (§3.4) — not
   merely that the same `identityHash` or the same label answered.
5. **Local render with the runtime off.** Stop the monad; confirm the document still renders its own local
   structure (§5's already-existing local-first answer), with an explicit "not connected" state, never blank and
   never fabricated data.

This proves what actually matters: the connection can change without changing what you are anchored to. It does
not require resolving the whole mesh, verifying anyone's cryptographic legitimacy (§3.3, explicitly still open),
or retiring any of the existing paths yet.

### Walkthrough executed, 2026-09-22 — on disposable infrastructure, real evidence, cleaned up after

A dedicated `MONADS_HOME` (never the ambient `~/.monad/monads` registry), namespace `gwroute-test.local`,
`SEED` generated with `openssl rand -hex 32` and written to `env.json` via `monads env` before the first
`monads start` — steps 1-2, real.

- **Namespace, before and after restart**: `GET /__provider` → `provider.namespace === "gwroute-test.local"`
  both times.
- **Identity, both markers, before and after restart**: kernel `identity_hash` (`monad.json`,
  SEED-derived) identical across a real `monads restart` (new PID, same port, same value); surface
  `surfaceEntry.monadId` (the monad's own Ed25519-derived id, §3.3's self-declared marker) also identical —
  `self.keys.json` persists in the runtime dir, a restart never regenerates it.
- **Persisted state, not just identity (§3.4)**: wrote `walkthrough.marker` with a timestamped value via
  `POST /`, read it back via `GET /__provider/resolve?path=walkthrough.marker` (the same load-bearing read
  path `GatewayAccessContract.md` §7 documents), restarted, read it again — identical value both times.
- **Local render signal with the runtime off**: stopped the monad (`monads stop`, port confirmed unreachable),
  then ran the ACTUAL shipped `fetchMountReference()` (GUI branch `feat/document-left-bar`, not a
  reimplementation) against the dead endpoint — returned `{ status: 'unresolved', reason: 'FETCH_FAILED' }`,
  the exact explicit state `GatewayMountBoundary` already renders a local document from. Only the underlying
  signal was re-confirmed here for this specific disposable instance; the React-level rendering of that state
  was already verified end to end in an earlier pass (`GatewayAccessContract.md` §7/§8) and was not re-run —
  netget's actual admin bundle was not started for this walkthrough, so step 3 ("independent document")
  is proven at the mechanism level (the mount reference a document would resolve), not by visually confirming
  netget's own bundle rendering it.

Cleaned up after: `monads delete`, temp `MONADS_HOME` and scratch files removed, no disposable process or
state left running. Nothing in this walkthrough touched the real ambient gateway, monad registry, or any
existing namespace.

**What this does and does not prove, precisely**: mounting and continuity survive a restart without conflating
label, identity, state and transport, on one explicitly-pinned destination. It does not demonstrate safe
selection among several candidate monads, nor a hot namespace change on an already-open connection — both stay
later steps, not attempted here.
