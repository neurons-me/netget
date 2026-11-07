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
npm run dev             # this app's dev server (:5173), this.gui as a package (its build)
npm run dev:gui-source  # the same, with this.gui compiled from GUI's source (for working on GUI inside this app)
npm run build           # production build (build.outDir: the folder the main server serves -- see vite.config.js)
```

`npm run dev` is what `mainServerFrontendMode: "dev"` points nginx at (`mainServerFrontendDevUrl`,
default `http://127.0.0.1:5173`). Running it does **not** make this visible at `local.netget` by
itself — the mode has to be switched too; otherwise nginx keeps serving whichever build
`local-dist`/`package-dist` currently point at.

### Three ways of working, each with its own dev mode

| Work | Where | Command |
|---|---|---|
| GUI on its own (components, themes, pages, its shell) | GUI's repo | Storybook and GUI's demo |
| **This app** (its pages, Domains, Logs) | here | **`npm run dev`**: `this.gui` as a package, as any app consumes it |
| GUI inside this app (seeing a GUI change with the whole stack) | here | `npm run dev:gui-source` (optional) |

- **`npm run dev` and `npm run build` use `this.gui`'s package, i.e. GUI's built `dist/`.** This app is an app: it does
  not compile GUI. A GUI change shows here after GUI is rebuilt (`npm run build` in `packages/GUI/Typescript`), or,
  later, after a published version is installed -- what any other app would see. **A passing build here does not
  show that recent GUI changes are in it**: rebuild GUI first.
- **`npm run dev:gui-source`** (`THIS_GUI=source`) compiles `this.gui` from GUI's source (`packages/GUI/Typescript`),
  through [`thisGuiSource.js`](thisGuiSource.js): `this.gui` and every subpath it exports resolve to source files, and
  GUI's own private `@/...` paths resolve only for files inside GUI. A GUI edit shows here live (HMR), with no GUI
  build and no publish. It is a tool for working on GUI, not this app's normal mode, and never what a build uses.
- **One copy each of React, React Router, MUI and Emotion**, this app's own, in dev and in the build: `dedupe` and the
  aliases in [`vite.config.js`](vite.config.js) pin them, `@mui/system` and `@emotion/cache` included. (GUI's dist
  imports `@mui/system` as an external; unpinned, the build took it from GUI's own install: a second `@mui/system`,
  `@mui/styled-engine` and `@mui/utils`.)
- **`NETGET_BACKEND`** points the dev server's API proxy elsewhere (default: the real backend, `http://127.0.0.1:3000`).
  Before anything in the browser can write, make sure it is not the real one.

**Check:** `npm run check:gui-source` ([`scripts/check-gui-source.mjs`](scripts/check-gui-source.mjs)) starts the dev
server in source mode (`dev:gui-source`) and then in dist mode (`dev`), with the API proxy on a dead port and every request outside the dev server
aborted by the browser, so nothing reaches a real service. Through two doors of the shell (`127.0.0.1`, and
`local.cleaker` mapped to `127.0.0.1` inside that browser only), it checks:
- where `this.gui` came from;
- one copy of each shared dependency;
- that every route loads directly (the same as a reload);
- client-side navigation and Back;
- in source mode, that a GUI source edit reaches the open page.

Then it runs each mode again against **the test backend** ([`scripts/testBackend.mjs`](scripts/testBackend.mjs)), a
stand-in for netget's backend and its monad with controlled answers: who `/check-auth` recognizes is a scenario (no
session, owner with logs-read, admin without it, signed in but neither), signatures are not checked, and a write is
answered, recorded and never applied (the check asserts there was none). Through the real sign-in and the real
capability resolvers it checks that Domains and Logs are offered exactly to whom they should be, that their pages show
the backend's data, navigation and Back across them, Sign out, and a reload. It does not prove what a real backend
authorizes: that is the backend's own tests.

**React Router:** one version for this app and GUI, the major GUI declares (`react-router-dom` 7; `netget.gui`
declares the same). The check asserts it.

**A production build:** `npm run check:gui-source -- --build <dir>` serves a build (`vite preview`, the API proxied to
the dead port and then to the test backend) and runs the same checks on it, plus: the copy of each shared package
**in the bundle**, read from its sourcemaps, and that its GUI pages are today's GUI. Build it with `--sourcemap`, into a
directory of its own, never the one nginx serves (`build.outDir` is that one), e.g.:

```bash
# GUI's library, into a temporary package (GUI's own dist/ is not touched)
(cd <all.this>/packages/GUI/Typescript && npx vite build --outDir /tmp/gui-check/this.gui/dist --emptyOutDir)
cp <all.this>/packages/GUI/Typescript/package.json /tmp/gui-check/this.gui/
ln -s <all.this>/packages/GUI/Typescript/node_modules /tmp/gui-check/this.gui/node_modules
# this app against it (node_modules/this.gui pointed at it for the build, then pointed back)
npx vite build --outDir /tmp/gui-check/app --emptyOutDir --sourcemap
npm run check:gui-source -- --build /tmp/gui-check/app
```

The browser stops every request and WebSocket outside the dev server (the dev server's own HMR socket aside) and counts
them; none is sent.

It needs Playwright with Chromium, taken from `packages/GUI/Typescript`. For a netget checkout outside `all.this`, set
`ALL_THIS` to the `all.this` directory (the dev server reads it too). Install such a checkout with
`npm install --no-save --no-package-lock "this.gui@file:<all.this>/packages/GUI/Typescript"`: the `file:` path in
`package.json` is relative to `all.this`. It exits 1 on any `FAIL`. `KNOWN` lines are the
gaps below.

`KNOWN` is narrow: in dist mode, only the absence of a GUI page (`/GUI` and its pages) that GUI's committed `dist/`
predates; in any mode, only `/users` and `/monad` offered disabled because they need a monad. A page error, a broken
route, any other missing link or a duplicated package fails in every mode.

**Known gaps:**
- **`/domains` and `/logs` loaded directly on the dev server with no backend** go to the API proxy (the same paths).
  With the test backend they are covered: it answers a page load with the app, as nginx does.
- **A page load signs out:** the session is not kept across a reload today, so a bookmarked `/logs` comes up signed out.
  The check asserts that it does so cleanly, not that it should.

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
