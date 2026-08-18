# Local Dev Admin

netget's full-navigation admin app — routing table CRUD, gateway dashboard, log viewer. See
`../../../../docs/Architecture.md#frontends` for how this relates to the other netget frontend
(`gui/app.tsx`, the "Main Server UI" that's actually live at `local.netget` by default) and how the switch
between them works.

## Routes

| Path | Renders | Notes |
|---|---|---|
| `/` | `WelcomeNetget` | Standalone landing page, no `Layout`/`LeftBar` |
| `/home` | `GatewayDashboard` (from `netget.gui/compounds`) | Polls `/gateway-identity`, `/apps` |
| `/domains` | `Domains` | CRUD over the domain→target routing table (`/domains`, `/add-domain`, `/delete-domain`, `/provision-cert` — legacy session auth, see [DomainStoreSplitBrain.md](../../../../docs/DomainStoreSplitBrain.md)); also **Unlock .me Proof** → `POST /domains/metadata`, the one real signed-capability write, see [GatewayCapabilityModel.md](../../../../docs/GatewayCapabilityModel.md) |
| `/logs` | `Logs` | Nginx log viewer; optional client-side auto-refresh |
| `/terms-and-conditions`, `/privacy-policy` | static content pages | |

`/home`, `/domains`, `/logs` are wrapped in `this.gui`'s `SpecBoundary` so they register into the Semantic
Inspector graph (visible via the Dev Tools bubble in the `LeftBar` footer) — each shows up as one
provenance-tagged node. Their internal content stays plain React/REST (`fetch`, polling) — this is
instrumentation parity (the Inspector can say "this page came from here"), not the live-binding
semantic parity `this.gui`'s CLI template gets from `.me`.

**Exception**: `/domains`'s **Unlock .me Proof** control does have real `.me`/Cleaker binding — not
a declarative read/write binding like the CLI template, but an imperative one: it derives a
`.me` identity from a username+secret (`ME_RESEED` + `cleaker(me, hostname)`, via
`this.gui/cleaker`'s `deriveCleakerNode`/`signedRequest`), held in page-local React state only,
never persisted, cleared on reload. That signed identity is what lets this page produce a real
`X-Me-Proof` for `POST /domains/metadata`. See
[GatewayCapabilityModel.md](../../../../docs/GatewayCapabilityModel.md) for what that endpoint
proves.

## Dev server

```bash
npm run dev     # Vite dev server, default :5173
npm run build   # → ../dist (i.e. src/htmls/Netget-REACT/dist)
```

`npm run dev` is what `mainServerFrontendMode: "dev"` points nginx at (`mainServerFrontendDevUrl`,
default `http://127.0.0.1:5173`). Running it does **not** make this visible at `local.netget` by
itself — the mode has to be switched too; otherwise nginx keeps serving whichever build
`local-dist`/`package-dist` currently point at.

## Static (production-shaped) closure

```bash
npm run build              # → ../dist
cp -R ../dist/* ~/.get/dist/
# then switch mainServerFrontendMode to "local-dist" in xConfig.json and
# regenerate + reload the gateway config (includeNetgetAppConf(), then
# `sudo openresty -s reload`) — see docs/Architecture.md#frontends
```

Once on `local-dist`, nginx serves `~/.get/dist` directly (`root` + `try_files`) — no Vite process,
no HMR websocket, no runtime dependency on `:5173` at all. Verified working end to end (2026-08-17).

**One build-only gotcha, already fixed but worth knowing if it recurs**: this app's production
build must dedupe `react-router`/`react-router-dom` against `this.gui`'s own copy
(`vite.config.js`'s `resolve.dedupe`) — without it, two separate router module instances end up in
the bundle and the app renders a blank page with `Cannot read properties of undefined (reading
'basename')`-style errors at runtime. Vite's dev server doesn't hit this; it only showed up once
this app was actually built for static serving. If a *new* shared dependency ever shows the same
symptom, add it to that same `dedupe` list first.
