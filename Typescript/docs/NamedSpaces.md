# Named spaces: `<name>.localhost`

Status: **built and tested on disposable infrastructure; not installed, not in any release; do not activate until the monad isolation fix runs.** Activating it is a
configuration change (one more server block, a reload), separate from everything activated so far.

## What it is

An address is one thing, whether something exists behind it is another, and a claim is a third. Opening
`whatever.localhost` must not require that anything was created, and visiting it must not create anything.

For a host `<name>.<root>` the gateway decides in this order:

| # | Case | What answers |
| --- | --- | --- |
| 1 | The operator **declared** a route for that host (patch bay: domain -> app, folder, service, a surface) | that destination. A declared destination that is down is "not available"; it never falls back to the root. |
| 2 | No route, a monad **declares** the host as its own (its namespace, or a name it lists) | that monad. Two identities that do: a conflict, not resolved by recency. |
| 3 | No route, nobody declares it, and the address sits under a root that is **authorized** (see "Authorized roots") | the monad of the nearest authorized root **whose identity is the authorized one**, handed the request **as it came** (the `Host` is not rewritten to the root's own). It resolves the address with its full context and answers per what it discloses. |
| 4 | No authorized root for the address (including: a monad announced itself as its root, but nothing authorizes it) | a neutral shell: HTTP 404, `Sin contenido disponible para esta dirección.` (JSON: `{"ok":false,"error":"no_content_available"}`). It states nothing about whether the name is claimed or exists, and writes nothing. |

If the authorized root is registered under its identity but not live, the answer is 503 (a state of the machine), not
"no content". A live monad that announces the same namespace under another identity is never asked.

What a name never gets:

* **The gateway's admin surface.** The admin block is the exact names `localhost` / `127.0.0.1`; `*.localhost` is another
  server block. `GET /domains` or `POST /add-domain` under a name are handed to the root monad like any other path.
* **The root's own surface or data in place of the address.** The root is asked about the address; it is not asked to
  show itself.
* **A peer that is not on this machine.** The `*.localhost` block allows loopback peers only: a name under `.localhost`
  means "on this machine".

## Where it lives

* `lua/handlers/surface_proxy.lua`: steps 1-4. The nearest enclosing authorized root is the longest root that is a proper
  suffix of the host **on a label boundary** (`evillocalhost` is not under `localhost`). It replaces the old rule that
  only knew roots with two or more labels (which is why `whatever.localhost` was a 503: its "root" was itself) and the
  rule that took ANY registered monad's namespace as a root.
* `runtime/authorizedRoots.ts` + `runtime/domainMap.ts`: the projection of the installation's root into
  `domain-map.json` (`roots`), bound to the identity of the monad netget started. `kernel/domainStore.ts` refuses a
  wildcard route of any other shape (`WILDCARD_SHAPE`).
* `setNginxConfigRoutes.ts`: the `*.localhost` server block (port 80 only, loopback peers only, no https redirect).
* Tests: `tests/surface-proxy-selection.test.ts` (section 9, the decision), `tests/authorized-roots.test.ts` (the
  projection), `tests/standalone-backend-gate.test.ts` (the real backend writes `roots` bound to its monad's identity and
  refuses malformed wildcards), `tests/named-spaces-localhost.test.ts` (through a disposable OpenResty: declared route and
  wildcard route, root attends with the Host unchanged, an announced-but-unauthorized root gets the neutral shell, an
  impostor identity is not asked, root not live, nothing written by visiting, never the admin API, non-loopback peer
  refused). They are red against the previous selector and generator. `NAMED_SPACE_REAL_MONAD=1` runs the second against a disposable real monad as the root.

## Contract between registry, netget and monad (2026-10-14; a draft to review, not built)

Three things that were being carried by one name, kept apart:

| | What it is | Changes when the machine or IP changes? |
| --- | --- | --- |
| **Identity of the space** | which space it is, and which authority controls it (a namespace under a declared root, its keys) | no. A legitimate move must not look like another space |
| **Observed environment** | which monad, machine and address attend it NOW (host, port, process, address) | yes. It can be fingerprinted to notice a change; it is evidence, not identity |
| **Authorization** | the evidence that lets THAT monad serve THAT space | only by a new, verifiable statement |

A hash binds data together; it does not say who authorized a relation (anyone can compute `hash(parent, name, key)` from
public data). A parent authorizing a child needs a verifiable statement of the parent -- a signed delegation -- and a
trustworthy reference to the parent's authority. `this.env` (`packages/env`) is, today, a design: its notes define an
environment seal over origin/metadata/instance, and the code is a stub; its crate even carries its own
`extract_root_domain` (the last two labels), one more place that deduces a root by counting dots. It is not part of this
contract.

### Roles

* **Registry** -- announces capabilities and availability (`roots` the monad says it can resolve, with the aliases the
  monad itself resolved). It grants no ownership of any name. An announcement that is not authorized is ignored and
  logged; it never selects a monad.
* **Netget** -- applies the operator's explicit connections first; otherwise compares the address, as a plain suffix
  match, against the roots that are AUTHORIZED, and hands the request to the monad authorized for that root, with the host
  and path unchanged. It does not interpret the namespace, does not resolve aliases, and does not choose between
  authorized monads: two identities authorized for one root is a rejection.
* **Monad / `.me` resolver** -- interprets the requested namespace and answers inside that context. `resolve(address)`
  has two outcomes, `resolved` or `unresolved(reason)`; an unresolved address gets the default surface for THAT address
  (empty, with the address), never another context's data, and creates nothing.

### Order for an address

1. A connection the operator declared (patch bay) -- always first. Down means "not available"; it never falls back.
2. A monad that declares the exact host and is authorized for it.
3. The authorized monad of the nearest enclosing authorized root, handed the request as it came.
4. Nothing authorized for the address: the neutral shell (404), asserting nothing about claims.

### Authorized roots (built, 2026-10-14; on disposable infrastructure only)

A root is a name this gateway may hand an address to. Where it comes from, in order of authority, and nothing else:

1. **The operator's wildcard route.** `*.<suffix>` (and only that shape: one leading `*` label, then literal labels) is a
   route like any other, written through the same gate (`/add-domain`: owner session or a capability) and visible in the
   patch bay. It wins over everything that is not an exact route, longest suffix first. A wildcard names a destination;
   it does not create an owner of anything under it.
2. **The installation's own root.** The root this installation is configured with (`getGatewayRootNamespace()`, the one
   `isNamespaceLocalToThisInstallation` recognizes), bound to the `identity_hash` of the monad netget itself started. The
   projection writes `roots[<namespace>] = { app, identity, source: "installation" }` into `domain-map.json`; the Lua
   selector serves a root only from a registration whose identity IS that identity and whose app is that app.

What cannot widen it: a monad's announcement (`namespace`, `claimed_namespaces`, aliases). It is capability: a live
announcement under another identity is ignored (503 while the authorized one is down, never "the impostor answers"), and
an announcement that no authorization names selects nothing (404). The same app name held by two identities is a conflict
page, not recency. Aliases are authorized only as operator routes; step 2 (a monad declaring the exact host as its own)
remains local-registration trust and is NOT an authorization of a root.

Reuse of the gateway's signed authority record (`daemon.gateways.<gatewayId>`, owner-only, "vigencia" + "autorización")
for declaring additional roots remains the intended next step; today the operator's route store is the declaration, and
it is the same owner-gated surface.

### Not included, on purpose

`this.env`; multi-level inheritance or delegation between names (`taller.equipo.localhost` is a NAME with levels, not an
heir of `equipo.localhost`, until a delegation is declared and signed); a second authority registry; a certificate for
`*.localhost`. The firma of what a client signs stays verified over the bytes it sent (`signedNamespaceSpelling`): the
normalization used to RESOLVE an address is a lookup concern and must never alter what was signed.

### What was proven (point 3)

Full context through the root (one level), conflicts rejected without choosing, announced-but-unauthorized roots ignored
(404), an impostor identity not asked, an authorized root that is down is 503, the operator's connections first, a
wildcard declared by the operator wins over the installation's default, the suffix boundary, and the signature checks
unchanged (the selector never touches what a client signed). Not proven here, deliberately: aliases as a separate record,
mesh trust across hosts, certificates, delegation between names.

## Limits, stated

* **Certificate.** The machine's mkcert certificate names `localhost`, `*.<machine>.local` and `local.netget/host/cleaker`,
  not `*.localhost`. The block therefore serves `http://` and does not redirect; `https://whatever.localhost` would fail the
  name check in a browser. A certificate with `*.localhost` is a separate, explicit step.
* **What a root makes of the address is the monad's.** With the release's monad, `whatever.localhost` is resolved as the
  namespace `whatever.localhost` (an empty tree, 404 for any path under it, an HTML shell titled with the address). A
  **nested** name (`a.b.localhost`) reaches the root with its Host intact but the monad resolves it as `unknown`. That is a
  gap of the monad's resolver (one handle under a root), recorded by the test, not of the routing.
* **The root's data used to be delivered under any name. That was a defect, fixed in the monad (branch
  `fix/namespace-root-isolation`, `fc5e4630` and `860a95e5`; not merged, not in any release).** The cause: a host the
  monad does not serve resolves to `unknown`, and the kernel maps every namespace it does not know onto its own root's
  storage. Two deliveries followed: the directory of users in `GET /` (any name listed everyone under the root), and any
  datum read by path (`/profile/motto` under `whatever.localhost`, or `/@root/profile/motto`, whose observer segment made a
  foreign constant that also collapsed onto the root). Now:
  * the directory is shown only to the root's own address and to a read by network address; an address that is one user
    receives that user's own row; any other name, none;
  * a path read under a name that resolves to `unknown`, or under a foreign constant that would collapse onto the root, is
    404 (`isForeignNamespaceReadCollapsingToRoot`), not the root's value;
  * the whole `GET /` response was checked (users, blocks, the datum, other users' names), not only the `users` field.
  Measured with the release's resolver: `localhost` and the IP -> `[alice, bob]`; `alice.localhost` -> `[alice]`;
  `whatever.localhost` and `a.b.localhost` -> `[]`. Named spaces are NOT to be activated before this monad change is part
  of what runs.
* **The view by network address is a public view, not an exception to permissions.** A request that arrives by an IP
  literal with no forwarded name (the GUI's users table, an operator's `curl 127.0.0.1`) names no space; the monad answers
  as itself, with what its root already publishes. It grants no privilege: a write by address passes the same signature,
  claim and reserved-path guards as any other (tested: `users.<handle>.*` and `daemon.gateways.*` are refused), and what a
  path discloses is decided per path as for any read.
* **A nested name (`a.b.localhost`) is not multi-level resolution.** It no longer leaks data (it resolves to `unknown`
  and receives nothing of the root), and it reaches the root with its Host intact, but the monad does not yet resolve it
  as a space of its own. That is the resolver's job, not routing, and no inheritance between levels is implied.
* **Browser origins.** Each name is its own origin: the panel's session (in `localhost`) is not shared with
  `whatever.localhost`. That isolation is intended; the admin panel stays on `localhost`.
* **Canonical spelling.** `<name>.<machine>.local` is the same root spelled canonically; this change does not cover it.
  Its handle block is answered only by a monad whose namespace is that machine root, and the gateway's own monad is
  `localhost`, so those handles are still 503. Treating the two spellings as one root is a separate decision.
* **Claiming and creating** are separate, explicit actions that come after opening an address. Nothing here does either.
