# Gateway access contract (doors migration)

Draft for review, 2026-09-21. Nothing here is implemented. It is the access part of the doors migration already
agreed (see [Front-end navigation](./FrontEndNavigation)): `netget.site` and `cleaker.me` are two doors onto one
namespace.

Legend: **[code]** read in the repository, **[conf]** the VM's installed nginx configuration, **[live]** observed on
the public hosts on 2026-09-21 (read-only requests; the only POSTs were empty-body ones that no handler could act on).

## 1. The rule

> Same proven identity, path, operation, state **and capabilities granted to the caller** → same result,
> whichever door the request came through.

- The door carries the request. **The state of the tree decides** what an identity may read or write.
- "Caller" is the page (or program) making the request. The doors `netget.site` and `cleaker.me` do not change what
  you may do; but an external page does not inherit everything you can do either: it has only what you granted it.
- Without a session, both doors receive an anonymous request and apply the same rules.
- Having an account is not enough: **each request must prove the identity** it acts as. A browser session is not
  shared automatically between domains (section 2 says where the identity lives instead).

## 2. Where identity lives

- The namespace, the identity and the session belong to the **running (local) monad**, not to a page and not to an
  origin. Pages on different domains connect to that one context; changing domain does not mean signing in again.
- Authenticating and authorizing a page are different things: it is still the same person, and each site can use
  only the capabilities that person granted it.
- The present implementation keeps sessions and vaults **per origin** (browser storage). That is a limitation of the
  implementation, not the behaviour sought. This contract only requires that the proof, and the capabilities granted
  to the calling page, arrive with the request.

Two separate pieces of work, not to be merged:

| | Local runtime | Vault B |
|---|---|---|
| What it does | Keeps namespace, identity and session; offers each page the capabilities granted to it | Recovers encrypted material to open a session where you do not have one yet |
| Needed to keep moving between domains with an already-authenticated local monad | **Yes** | **No** |
| Where it is specified | the runtime migration (this contract only depends on its outcome) | `identity-vault-design.md` (monad, branch `design/identity-vault`) |

Connecting a page to the local monad's session is therefore not part of Vault B.

## 3. What a door may and may not do

| A door may (transport) | A door may not |
|---|---|
| TLS termination, HSTS | decide what the tree lets an identity read or write |
| Origin validation for browser calls (it stops another site's page from using a grant; it never grants) | treat "same machine", loopback, `Host: localhost` or any header as permission |
| Rate and size limits | change the answer for the same proven identity and state |
| Select the namespace a request names | hold a second copy of the rules (Lua and the monad today) |

## 4. The machine is an identity with declared capabilities

Today `x-monad-internal-token` marks the machine's own callers [code: `monad/src/http/internalToken.ts`], and the
gate treats an internal request as authorized for everything that is not public [code: `adminGate.mjs`]. A local
caller is not thereby unlimited.

- Define which identity the token represents (a machine identity of this monad) and give it **explicit capabilities**,
  each tied to a real caller: e.g. register a monad in the app registry (heartbeat), write gateway routing records,
  run OpenResty control (netget CLI / operator).
- No capability is granted because a request is local. The list of callers and the minimum each needs is an inventory
  still to be made (open, section 7).

## 5. Routes: today and under the contract

"Today" columns are what each door does now. Under the contract every row has one rule: **the datum's path in the tree
plus the caller's proven identity decide**; the last column says what that means, and what is known about the datum.

| Route | Op | Today: cleaker.me (monad gate) | Today: netget.site | Datum / decided by |
|---|---|---|---|---|
| `/gateway-identity` | read | public [live] | public, same answer since 2026-09-21 [live] | `daemon.gateways.<gatewayId>` (owner, admins) |
| `/main-server-namespace`, `/cleaker/resolve` | read | public | public | tree; unchanged |
| `/domains`, `/domains/:parent/subdomains` | read | public, **includes certificate paths** [live] | public [live] | `users.netget.domains…` (in the tree); fields that are server internals closed by default |
| `/apps` | read | public, **includes each monad's working directory** [live] | **403** from Lua (loopback only) [live] | apps registry (`apps.json`, a file, not in the tree) |
| `/openresty-status` | read | public, **includes the binary path** [live] | **401** from Lua [live] | server status; internals closed by default |
| `/frontend-mode`, `/apps/:name/frontend-mode` | read | public, **includes directory roots** [live] | no nginx location for `/frontend-mode` (falls to the static SPA); `/apps/:name/__frontend-mode` is proxied [conf] | as above |
| `/ip-info`, `/port-info`, `/healthcheck` | read | public | public | tree/none |
| `/logs` | read | own auth: bearer session [live 401 without] | 401 [live] | log read capability for the identity |
| `/setup/*` | write | own auth: signed setup | proxied | unchanged: signed by the claiming identity |
| `/admin-session/*` | write | own auth | proxied | unchanged: challenge signed by the identity |
| `/gateway-admin/{grant,revoke,transfer}` | write | own auth: signed | **no nginx location** (falls to the static SPA) [conf] | `daemon.gateways.<gatewayId>` authority, checked by the monad |
| `/add-domain`, `/update-domain`, `/delete-domain`, `/provision-cert`, `/domains/metadata` | write | **401** without a session with `gateway:write` (owner has it) [live] | **403 from nginx** (`limit_except GET HEAD OPTIONS { allow 127.0.0.1; deny all }`) before the monad can look at any session [conf, live] | write on the domain's path; owner/admin from `daemon.gateways.<id>` |
| `/openresty-restart`, `/openresty-stop` | write | as above (session or internal) | Lua: loopback only | OpenResty control capability |
| `/frontend-mode`, `/apps/:name/frontend-mode` | write | as above | no nginx location for `/frontend-mode` [conf]; the `__frontend-mode` variant is proxied | as above |
| `/apps/report`, `/apps/release`, catalog routes | write | internal token (not a person) | Lua: loopback only | machine identity capability (section 4) |
| `/__gateway/claim` | write | internal token | — | machine identity capability |
| `/openresty/install*` | read/write | default `trusted` [code] | — | OpenResty control capability |

Two rows break the rule today for a reason the person cannot influence: an authorized identity gets **403 at
netget.site** and would succeed at cleaker.me, and the same anonymous read of `/apps` is 403 in one door and 200 in
the other.

## 6. Equivalence tests

A table-driven test on disposable infrastructure (a monad, a real generated OpenResty as in `gateway-edge-access`,
two or more hostnames). For every route of section 5:

- identities: anonymous · non-admin identity · admin with `gateway:write` · owner · revoked admin · machine identity
  (each capability, and one without it);
- doors: netget-shaped host, cleaker-shaped host, `www`, a handle host;
- assert the **same status and the same body shape** across doors for each identity. Known-red today: `/apps`,
  `/openresty-status` (anonymous), every write with a valid session (netget.site);
- assert that spoofing a door changes nothing: `Host: localhost`, `X-Forwarded-Host`, a loopback peer address, a
  forged internal-token header sent from outside;
- assert that a page **without a grant** does not inherit the identity's capabilities: the same identity, same route,
  same operation, called from a page that was granted less (or nothing) gets the result for what it was granted;
- assert that transport protections still hold and decide nothing else: a foreign-origin browser call is refused for
  every identity; TLS/redirect behaviour is unchanged; a session presented from an origin that was not granted the
  capability is refused (this last case depends on the runtime side of section 2).

## 7. Mount reference: how a standalone file ties to `.me`

A page is self-contained without any of this — it can render with no connection. What ties it to `.me` is a
**mount reference**: `namespace + node path` (an empty path means the namespace's own root). It says where in the
tree this interface is mounted; it is not the node itself, and **it grants no identity and no permission** —
resolving where you are and being authorized to act there stay two separate steps (sections 1, 4).

- **Common description, two paths to it.** The monad describes a mount reference as `NamespaceProviderBoot` [code:
  `monad/src/http/provider.ts`], now carrying `nodePath` (empty = the namespace's own root, a slash-form path = an
  interior node). A page gets this same description one of two ways: **injected** — the monad writes it into the
  HTML it serves (confirmed live on cleaker.me) — or **fetched** — the same shape read over HTTP, `GET /__provider`
  [code: `providerSurface.ts`], which now accepts `?nodePath=`.
- **Transport is separate from the reference.** Where you ask the provider (which origin, which proxy path) is not
  the same fact as where the reference says you are mounted. `netget.site`'s own `/apps/<name>/...` proxy forwards
  any tail to that monad [conf, confirmed: `location ~ ^/apps/([^/]+)(/.*)?$`], so `GET /apps/netget/__provider`
  reaches it — but `netget` there is THIS installation's own monad name, a fact of how this gateway is configured.
  `fetchMountReference(providerOrigin, …)` [code: `this.gui/runtime/mountReference.ts`], the general resolver, takes
  that origin as a plain parameter and never reads `window.location` or hardcodes an app name. The concrete caller
  (netget's own `App.jsx`) still supplies `"/apps/netget"` as a literal, the same way it already hardcodes
  `cleakerEndpoint="http://local.cleaker"` for local dev — **still open**: parametrizing this installation's own
  boot (so the literal moves to configuration netget.site is served with, not source) is not done.
- **Injection and discovery describe the same thing, including an interior node.** Both paths accept the same
  `?nodePath=`: `GET /?nodePath=…` (or any unmatched path, netget's catchAll) injects it, `GET
  /__provider?nodePath=…` [code: `providerSurface.ts`] discovers it — a page the monad serves is not limited to
  describing its own root the way a standalone file fetching it is not either.
- **`nodePath` is load-bearing for reads, not a label.** `GET /__provider/resolve?path=…&nodePath=…` composes the
  read UNDER the node — `path=title` at `nodePath=dashboard/status` reads `dashboard/status/title`, never the
  namespace's own root `title` — so two different real values at the root and at an interior node read back
  correctly from each, and a value that exists only at one 404s through the other.

**Both original gaps closed, and the two the first pass left open also closed — implemented and verified, not yet
merged to `main` or deployed:**

1. `NamespaceProviderBoot.nodePath`, carried by both injection and discovery, and load-bearing for reads (monad
   branch `feat/mount-reference-node-path`) — verified against a real monad: an injected boot and a discovered one
   agree at a namespace root, at a handle host, AND at the same interior node; a relative read composes under that
   node with real, different data proving it.
2. `netget.site`'s standalone `index.html` now resolves its mount reference before rendering the gateway shell
   (GUI branch `feat/document-left-bar`'s `mountReference.ts`; netget branch `feat/mount-reference-gate`'s
   `GatewayMountBoundary` in `App.jsx`) instead of silently assuming it from the host. An unresolved reference shows
   an explicit state (with a reason) rather than a silently-rendered shell — verified end to end: a disposable static
   build behind a proxy that mirrors nginx's real `/apps/<name>/(.*)` passthrough, against a real monad; killing the
   monad and reloading shows the explicit state.

Still open: parametrizing THIS installation's own boot configuration (the `/apps/netget` literal above).

**Doors migration step 3, closed:** once a mount reference is resolved (by either path above), netget's own
`App.jsx` now renders the SAME document-driven shell `cleaker.me`'s door already used (`CleakerLanding`), with
Dashboard/Domains/Logs added as this app's own document extension — not a second, hand-written admin UI (netget
branch `feat/gateway-uses-root-shell`). `/netget` (status + claim) needed no new wiring: it already exists in the
base document. Disclosed, not hidden, behaviour changes this causes: `/` now renders the base document's Landing on
every door alike (mergeGuiDocument refuses to let an extension override a route the base already serves — the
status/claim screen moves to `/netget`, matching cleaker.me, rather than being lost); Users/Blockchain/URL now also
read from this gateway's own monad, previously absent here; the `.me` launcher hardcoded to `local.cleaker`
(FrontEndNavigation.md's flagged contradiction) is gone with the shell that carried it. Verified end to end:
`/dashboard`, `/domains`, `/logs`, `/netget` each render their real, distinct content through the merged document.

Not part of this: unifying the rest of the administrative routes (section 5), any encrypted/portable app storage
(a related idea under discussion, not this contract), and none of this was deployed to the VM.

**Correction (2026-09-22, user review) — step 3 as shipped contradicts section 1.** `GATEWAY_DOCUMENT_EXTENSION` is
merged in `App.jsx` because `frontendRole({host, boot})` says `ROLE === 'gateway'` — a decision made from the
HOSTNAME, not from the resolved mount reference. Section 1's rule is explicit: which door a request came through
never decides what an identity may see. If both doors resolve to the SAME node with the same identity and
capabilities, Dashboard/Domains/Logs should be available on BOTH; if they resolve to DIFFERENT nodes, a different
interface is legitimate, but that difference must come from the mount reference (namespace + node path, section 7)
and the document it selects, never from `window.location.hostname`. The right shape: the gateway's admin pages are
the document a specific NODE declares (e.g. an admin-app node under the installation's own branch), and whichever
door's resolved mount reference points at that node renders them — cleaker.me's door would too, if it ever resolved
there. **Not fixed. Tracked here as its own open item (below), related to but not solved by the access guard.**

**Doors migration step 4, done, scope corrected (2026-09-22, user review): equivalence of the SHARED DEFINITIONS,
not closure of the migration.** `gatewayDoorEquivalence.test.ts` (netget branch `test/gateway-door-equivalence`)
imports the REAL objects both doors render from — `GUI_DOCUMENT` unmerged (cleaker.me) and netget's own
`GATEWAY_DOCUMENT_EXTENSION` merged on top (netget.site), the extension itself pulled out of `App.jsx` into a plain,
JSX-free `gatewayDocument.js` so the test can import it directly rather than a copy. What it shows: every
route/sidebar item the base document declares keeps the identical component, id and label whether read unmerged or
merged; the dynamic layer (what a namespace itself declares or hides, `resolveSidebarComposition`) composes the
same way regardless of which door's builtin layer it lands on. What it does **not** show, stated explicitly rather
than implied by the passing result: that a browser actually mounts the named component correctly (same component
NAME is not proof of correct mounting — only this session's separate, uncommitted, manual Playwright checks touched
real rendering); anything about the COMPILED package the app consumes (`this.gui/runtime`'s dist stays unverified —
this test had to import GUI package SOURCE directly because the dist doesn't run under plain Node, see below); real
reads, real permissions, or equivalence through nginx (the dynamic-layer check runs on a hand-built fixture, no live
monad, no HTTP/proxy layer). Call this "equivalence of the shared definitions" — a real, useful, permanent
regression check — not proof the doors are equivalent in section 1's sense. Wired into `npm test`.

Found while writing this test, recorded, not fixed: the published `this.gui/runtime` dist bundle does not run under
plain Node/tsx (bundles unrelated MUI-touching chunks into the same import even for MUI-free functions) — worth its
own fix so a future consumer isn't forced to import from source across the repo boundary the way this test does.

## 8. The document-by-host contradiction, closed

The problem, as first reported below and corrected by the user: netget's own admin pages
(Dashboard/Domains/Logs) were merged because `frontendRole({host, boot})` said `ROLE === 'gateway'` — a
hostname decision, exactly what section 1 rules out. The model, precisely: a door is an entry into a
tree. Knowing what you can navigate needs your **mount reference** — which tree you belong to (the
namespace's stable identity) and where within it (the node path, section 7) — never the door's own
hostname. Mounting at a node (e.g. `apps/netget`) makes a relative route compose under it; it neither
creates a second tree nor erases the reference to the root, and other routes of the SAME tree stay
reachable, subject to permissions. In THIS deployment both doors mount the SAME namespace at its own
root (empty node path) — the simple case: both enter the root, netget.site may open an admin screen
FIRST, but that initial screen must never limit navigation to the rest of the tree.

**Two layers, composed, never conflated — the corrected model (user, 2026-09-22):**

- **Document** — "I am this app, with this structure, these pages, my own content." Authored, fixed,
  decided by which bundle/entry point this is. Loads and renders the same regardless of whether it ever
  connects to anything.
- **Namespace** — "this is the context I offer: data, identity, permissions, extensions." A CONNECTION
  the document makes, a parameter, not a fact about which document it is. `documento autocontenido +
  contexto conectado = app en ejecución`. The same document connected to namespace A shows A's data and
  capabilities; connected to B, B's; unconnected, its own local content. Authorship of the document and
  the namespace chosen to connect it to do not have to coincide, and in principle the connection can
  change at runtime (needs per-context data/request/subscription isolation and re-resolved permissions
  on switch — not built).

**First fix attempt (netget branch `fix/document-by-mount-reference-not-host`) still conflated the two
layers, just more subtly:** it gated `extensionApplies` on `isGatewayMonad && nodePath === ''` — i.e. on
whether the CONNECTED namespace happened to be "this gateway's own root". That is the same class of bug
as the original `ROLE`/hostname gate: the document was still being decided by a fact about the
connection, not by which app this is.

**Fixed properly (netget branch `fix/document-is-authored-not-connection-decided`, on top of the above):**
netget's own pages (Dashboard/Domains/Logs) exist because this bundle IS netget's admin app
(`ROLE === 'gateway'`, unconditional — a fact of which entry point this is, never of what a namespace
connection resolves to). A `cleaker` door — even one that resolves the very SAME monad netget.site does —
correctly does NOT carry netget's document; it is a different, separately authored app. `useMountReference()`
now only describes the connection (namespace + node); nothing about which document/pages exist reads
`isGatewayMonad` any more. `GatewayMountBoundary` stays non-blocking (local-first, from the first fix):
without a confirmed connection the document still renders its own structure and local pages; only the
parts that genuinely need the connection (MainServerView, the base document's namespace-declared sidebar
layer, GatewayDashboard's own fetches) show their own "not available" state, never fabricating data.

**Verified, real browser + real monad**, corrected once more after a real gap in the verification itself:
the first pass addressed the injected-boot door by a bare IP (`127.0.0.1:<port>`), which silently fails
`frontendRole`'s own `hostIsNamespace` check and falls through to the gateway role — masking exactly the
bug being fixed. Re-addressed as `cleaker.me` (matching how `frontendRole` actually decides), confirmed:
the cleaker-door never shows netget's nav items and `/dashboard` there falls back to the base Landing, not
`GatewayDashboard` — even though it resolves the identical monad netget.site uses. The gateway-door still
always carries its own document, connected or not; `/dashboard`, `/domains`, `/logs` reachable by direct
navigation, and disconnecting the provider still renders the local shell and the visited page's own
structure, never blank or a full-screen block.

**Not done by this fix, named explicitly rather than implied by it passing:** the deeper equivalence this
enables — that both doors resolve the SAME STABLE NAMESPACE IDENTITY (not just the same name, HTML or
menu), and that the same route then returns the same node with the same authorization, through a live
monad and real nginx (not the shared-definitions test of section 6/7, which stays a logic-only check) —
is the equivalence test still owed. Namespace as a person-changeable runtime parameter, with isolation
across contexts, is a distinct, larger feature, not started.

## 9. The access guard: first piece done, not wired in, necessary but not sufficient on its own

Neither Lua's loopback check nor `adminGate.mjs`'s single coarse `gateway:write` scope is what section 1 requires:
the first ignores identity and capabilities entirely; the second checks identity but collapses every write into one
undifferentiated scope, and only cleaker.me's door ever reaches it. **Moving Lua's rule list into a JavaScript list
would repeat the same mistake in a different language — the fix is both doors consulting the same tree-derived
answer, not a second hardcoded list anywhere.**

That tree-derived answer already exists, mostly unused: `daemon.gateways.<gatewayId>` (`gatewayAuthority.ts`) is
real, signed, kernel-backed state with `owner`, `admins` and `grants` (opaque scope strings per identity — "never a
netget-specific type", the file's own words). `capabilitiesOf`/`hasGatewayCapability` (monad branch
`feat/gateway-capabilities`, `claim/gatewayCapabilities.ts`) is the single question every route's own check should
reduce to: what does THIS identity hold, per THIS record — the owner unconditionally (`'all'`; confirmed real that
`bootstrapGatewayAuthority` leaves the owner's own `grants` entry empty, so owner authority is never expressed as a
grant), an admin exactly the scopes in `grants[identityHash]`, anyone else nothing. Verified against a real,
signed record produced by the actual bootstrap/grant/revoke HTTP + Ed25519 flow (`gatewayCapabilities.test.ts`), not
a hand-typed fixture: owner keeps `'all'` even with an empty grants array; a granted admin has exactly what was
granted, nothing more; a revoked admin has nothing, immediately; an unrelated identity or an unbootstrapped gateway
fails closed rather than throwing. `readGatewayAuthority`/`GatewayAuthorityRecord` are newly exported from the
package's public surface so `netget/gateway` — mounted INTO the same monad process — can consult canonical state
directly, in-process, instead of through its own materialized cache (`GatewayClaimsManager`) the way
`adminGate.mjs`'s current `isOwner` check does today.

**Correction (2026-09-22, user review) — necessary, not sufficient.** "The owner has 'all'" describes only the
IDENTITY's own standing on the gateway. A page or program acting nominally as the owner does not thereby inherit
everything the owner can do: section 1's own rule is capabilities granted to the CALLER, never assumed from who is
behind it. That second, caller-level grant (what THIS page was itself given, separate from what the identity holds)
is a distinct mechanism this primitive does not provide and does not exist anywhere in this codebase yet — it
belongs with the runtime/session work section 2 already defers to. A route guard built on `hasGatewayCapability`
alone is real progress, not the complete answer to section 1.

**This is the primitive, not the guard.** Still needed, none of it done here:

1. Reclassify every route in section 5's table onto a NAMED capability (`domains:write`, `openresty:control`,
   `apps:report`, …) instead of one coarse `gateway:write` — a real design pass over the actual route table, not
   invented in passing.
2. Wire `adminGate.mjs` to call `hasGatewayCapability` per the route's own named capability instead of its current
   single-scope check.
3. `netget.site` sends these routes to the monad (section 9's own step 3, already planned) so Lua stops deciding
   anything and the SAME check governs both doors — not a second implementation of the same idea in Lua.
4. The machine identity (section 4) becomes a REAL identity with its OWN `grants` entry in this same record (a
   synthetic identityHash, each capability tied to a real caller: heartbeat, netget CLI, `monads` CLI) instead of
   `isInternalRequest`'s blanket bypass — "local" stops being a capability in itself.

**The document-by-host contradiction above is a separate, related problem this guard does not fix.** The guard
governs WHO may do WHAT; it says nothing about WHICH document a door renders. Both need the same underlying idea
(decide from the resolved reference — namespace/node for the document, identity/capability for the guard — never
from the door), but closing one does not close the other.

## 10. Open decisions

1. **Default disclosure.** Which fields of the public reads are closed to an anonymous identity by default
   (certificate paths, working directories, binary and directory paths are the candidates). Written as tree state,
   not as a filter in code.
2. **Machine capabilities.** The exact list, from an inventory of the internal callers (monad heartbeat, netget CLI,
   Lua handlers, `monads` CLI).
3. **Apps registry.** Move `apps.json` into the tree, or expose it as a view whose read rule is a tree path.
4. **Session holder without a local runtime** (another device). A different scenario from the one this contract
   defines (an already-authenticated local runtime); it belongs to Vault B and does not block this contract.
5. ~~Document-by-host contradiction.~~ **Closed, section 8.**

## 11. Order after acceptance (not started)

1. Inventory the data and the internal callers; fill section 5's last column with real paths.
2. One guard, a function of (proven identity, path, operation, **capability**) over tree state, used by both doors --
   `capabilitiesOf`/`hasGatewayCapability` (section 8) is the first piece; still needed: the per-route capability
   table, wiring `adminGate.mjs` to it, and the machine identity as a real granted identity.
3. `netget.site` sends these routes to the monad (as `/gateway-identity` already does) and stops deciding in Lua; keep
   the nginx loopback limits on destructive routes as a second layer until the equivalence tests pass.
4. The dashboard presents the proof it has instead of calling routes that cannot authorize it.
5. The equivalence tests become part of `npm test` (the shared-definitions test, section 6/7, already is; the
   identity/capability equivalence table of section 6 is not).
6. Separately: the document a door renders comes from the resolved mount reference's node, never from the hostname
   (open decision 5) -- needed before netget.site's admin pages stop being a host-based special case.
