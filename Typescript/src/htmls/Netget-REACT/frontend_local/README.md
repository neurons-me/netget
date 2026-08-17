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
| `/domains` | `Domains` | CRUD over the domain→target routing table; `/domains`, `/add-domain`, `/delete-domain`, `/provision-cert` |
| `/logs` | `Logs` | Nginx log viewer; optional client-side auto-refresh |
| `/terms-and-conditions`, `/privacy-policy` | static content pages | |

`/home`, `/domains`, `/logs` are wrapped in `this.gui`'s `SpecBoundary` so they register into the Semantic
Inspector graph (visible via the Dev Tools bubble in the `LeftBar` footer) — each shows up as one
provenance-tagged node. Their internal content stays plain React/REST (`fetch`, polling); there's no `.me`
kernel binding here, so this is instrumentation parity (the Inspector can say "this page came from here"),
not the live-binding semantic parity `this.gui`'s CLI template gets from `.me`.

## Dev server

```bash
npm run dev     # Vite dev server, default :5173
npm run build   # → dist/
```

This is what `mainServerFrontendMode: "dev"` points nginx at (`mainServerFrontendDevUrl`, default
`http://127.0.0.1:5173`). Running `npm run dev` does **not** make this visible at `local.netget` by
itself — the mode has to be switched too; otherwise nginx keeps serving the separately-built Main Server UI.
