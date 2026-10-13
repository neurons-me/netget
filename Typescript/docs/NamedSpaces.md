# Named spaces: `<name>.localhost`

Status: **built and tested on disposable infrastructure; not installed, not in any release.** Activating it is a
configuration change (one more server block, a reload), separate from everything activated so far.

## What it is

An address is one thing, whether something exists behind it is another, and a claim is a third. Opening
`whatever.localhost` must not require that anything was created, and visiting it must not create anything.

For a host `<name>.<root>` the gateway decides in this order:

| # | Case | What answers |
| --- | --- | --- |
| 1 | The operator **declared** a route for that host (patch bay: domain -> app, folder, service, a surface) | that destination. A declared destination that is down is "not available"; it never falls back to the root. |
| 2 | No route, a monad **declares** the host as its own (its namespace, or a name it lists) | that monad. Two identities that do: a conflict, not resolved by recency. |
| 3 | No route, nobody declares it, a monad **is the nearest enclosing root** of the address (`localhost` for `whatever.localhost` and `a.b.localhost`) | that root monad, handed the request **as it came** (the `Host` is not rewritten to the root's own). It resolves the address with its full context and answers per what it discloses. |
| 4 | No monad is root for the address at all | a neutral shell: HTTP 404, `Sin contenido disponible para esta dirección.` (JSON: `{"ok":false,"error":"no_content_available"}`). It states nothing about whether the name is claimed or exists, and writes nothing. |

If the nearest root is registered but not live, the answer is 503 (a state of the machine), not "no content".

What a name never gets:

* **The gateway's admin surface.** The admin block is the exact names `localhost` / `127.0.0.1`; `*.localhost` is another
  server block. `GET /domains` or `POST /add-domain` under a name are handed to the root monad like any other path.
* **The root's own surface or data in place of the address.** The root is asked about the address; it is not asked to
  show itself.
* **A peer that is not on this machine.** The `*.localhost` block allows loopback peers only: a name under `.localhost`
  means "on this machine".

## Where it lives

* `lua/handlers/surface_proxy.lua`: steps 1-4. The nearest enclosing root is the longest monad namespace that is a proper
  suffix of the host **on a label boundary** (`evillocalhost` is not under `localhost`). It replaces the old rule that
  only knew roots with two or more labels (which is why `whatever.localhost` was a 503: its "root" was itself).
* `setNginxConfigRoutes.ts`: the `*.localhost` server block (port 80 only, loopback peers only, no https redirect).
* Tests: `tests/surface-proxy-selection.test.ts` (section 9, the decision), `tests/named-spaces-localhost.test.ts`
  (through a disposable OpenResty: declared route, root attends with the Host unchanged, neutral shell, root not live,
  no root, nothing written by visiting, never the admin API, non-loopback peer refused). Both are red against the previous
  selector and generator. `NAMED_SPACE_REAL_MONAD=1` runs the second against a disposable real monad as the root.

## Limits, stated

* **Certificate.** The machine's mkcert certificate names `localhost`, `*.<machine>.local` and `local.netget/host/cleaker`,
  not `*.localhost`. The block therefore serves `http://` and does not redirect; `https://whatever.localhost` would fail the
  name check in a browser. A certificate with `*.localhost` is a separate, explicit step.
* **What a root makes of the address is the monad's.** With the release's monad, `whatever.localhost` is resolved as the
  namespace `whatever.localhost` (an empty tree, 404 for any path under it, an HTML shell titled with the address). A
  **nested** name (`a.b.localhost`) reaches the root with its Host intact but the monad resolves it as `unknown`. That is a
  gap of the monad's resolver (one handle under a root), recorded by the test, not of the routing.
* **The root's `GET /` carries the root's public user directory.** For any address the monad answers `/` with its
  `users` list (usernames and identity hashes of the root) next to that address's own blocks. That is how the monad
  reports a namespace's root today; if an address should not show it, that is a change in the monad.
* **Browser origins.** Each name is its own origin: the panel's session (in `localhost`) is not shared with
  `whatever.localhost`. That isolation is intended; the admin panel stays on `localhost`.
* **Canonical spelling.** `<name>.<machine>.local` is the same root spelled canonically; this change does not cover it.
  Its handle block is answered only by a monad whose namespace is that machine root, and the gateway's own monad is
  `localhost`, so those handles are still 503. Treating the two spellings as one root is a separate decision.
* **Claiming and creating** are separate, explicit actions that come after opening an address. Nothing here does either.
