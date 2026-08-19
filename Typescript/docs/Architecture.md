# Architecture

---

## What each layer owns

| Layer | Owns |
|---|---|
| `.me` | Seed derivation, semantic tree, reactivity, memory |
| `cleaker` | Namespace binding, surface fallback, triad verification |
| `monad.ai` | HTTP surface, kernel exposure, mesh announce/discover |
| `netget` | Physical routing, domain → port mapping, SSL, monad placement |

---

## The node

A node is *a machine running netget.* It is the physical boundary of the stack:

```
hostname.local ← node hostname
  port 80/443 → netget ← entry point
  port 8161 → monad ← suign.cleaker.me kernel
  port 3000 → any service  ← additional processes
  ~/.get/html/ → landing page ← node identity page
```

When you visit `hostname.local`, you reach the node's gateway. NetGet reads `~/.get/runtime/domain-map.json` and routes the request to the correct destination.

---

## Frontends

Two separate React apps can answer `local.netget` — never both at once. Which one is live is a config
switch (`mainServerFrontendMode` in `xConfig.json`), not a matter of which files are newest.

| | Main Server UI | Local Dev Admin |
|---|---|---|
| Source | `gui/app.tsx` | `src/htmls/Netget-REACT/frontend_local/` |
| Stack | `this.gui` `Theme`/`Layout`, `Cleaker`, `Monad` — no router, one screen | `this.gui` `Theme`/`Layout`/`LeftBar` + React Router, full nav |
| Views | `.me` identity orb (expands into Cleaker) + `MonadNamespaceCard` (mesh/claims) | `/` welcome, `/home` (`GatewayDashboard`), `/domains` (CRUD), `/logs` |
| Built by | `gui/vite.app.config.ts` → `assets/main-server-ui/dist/` | `npm run dev` (`:5173`, for `dev` mode) or `npm run build` → copy to `~/.get/dist` (for `local-dist` mode) |

`mainServerFrontendMode` (`src/modules/NetGetX/OpenResty/mainServerFrontend.ts`) has three values, generated
into the nginx `location /` block by `setNginxConfigRoutes.ts`:

- **`package-dist`** (default) — nginx serves the built Main Server UI directly: `root $distRoot; try_files $uri /index.html;`.
- **`local-dist`** — same, but from a locally-built copy at `~/.get/dist` instead of the packaged one.
- **`dev`** — nginx instead `proxy_pass`es `/` to a live Vite dev server (`mainServerFrontendDevUrl`, default `http://127.0.0.1:5173`) — i.e. Local Dev Admin, reached live through the gateway instead of a build.

`syncMainServerFrontendToHtmlRoot()` mirrors whichever build is active into `~/.get/html/` — the directory
this doc's node diagram calls "landing page" above — so netget always has its own `index.html` there,
independent of whatever else is registered in the domain map for `local.netget`/`localhost`/`127.0.0.1`.

Both apps share netget's own compound library (`gui/src/{atoms,molecules,compounds}` — `GatewayDashboard`,
`MonadMesh`, `GatewayCard`, etc.), so they're different shells around overlapping parts, not unrelated
codebases. A third app, `frontend_remote`, existed alongside these but was never wired into the mode switch
above or any build/deploy path — confirmed unreferenced anywhere except a stale `tsconfig.json` exclude
entry pointing at a path that no longer existed — and was removed (2026-08-16).

---

## Hot-reload architecture

```
~/.get/runtime/domain-map.json    ← written by netget CLI / generate-domain-map
~/.get/runtime/domain-map.version ← bumped on every write

OpenResty Lua timer (1s):
  read version → if changed → reload domain-map → update _G.DOMAIN_MAP

Result: routing changes take effect in under 1 second, no nginx restart needed.
```

---

## Domain store: one path, not two

`domain-map.json` above is generated exclusively from `kernel/domainStore.ts` (`.me`-kernel-backed).
The HTTP admin API behind `Domains.jsx` (`/domains`, `/add-domain`, `/update-domain`,
`/delete-domain`, `/domains/:parent/subdomains`, `/provision-cert`) goes through the same store now
— nginx `proxy_pass`es each of those to the daemon (`localNetget.js`), which calls `domainStore.ts`
directly, same shape as `/domains/metadata`. Used to write to a separate, legacy SQLite database
(`~/.get/domains.db`) that nothing regenerated `domain-map.json` from — a domain added through the
admin API could report success while staying invisible to real routing. Fixed 2026-08-17; full
history in [DomainStoreSplitBrain.md](./DomainStoreSplitBrain.md).

---

## NRP integration (2026-05-08)

| Feature | Status |
|---|---|
| Domain → static routing | ✅ |
| Domain → proxy routing | ✅ |
| Hot-reload via Lua timer | ✅ |
| Node landing page (main-server/index.html) | ✅ |
| `netget reload` CLI (no nginx in PATH needed) | ✅ |
| `netget generate-domain-map` | ✅ |
| SSL via Let's Encrypt | ✅ |
| Dynamic SSL per domain (Lua) | ✅ |
| Monad mesh routing (`.mesh/monads`) | 🔲 planned |
| `netget://device/monad` resolution | 🔲 planned |
