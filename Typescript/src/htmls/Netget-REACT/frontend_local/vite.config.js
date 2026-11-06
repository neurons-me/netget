import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { thisGuiSourceAliases } from './thisGuiSource.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Resolve netget.gui source directly — no need to build the lib package for dev.
// Subpath aliases MUST come before the root alias (Vite does prefix matching).
const NETGET_GUI = path.resolve(__dirname, '../../../../gui/src');

// This app's own copy of an @emotion package, else the one hoisted to
// netget/Typescript's node_modules.
function emotionDir(name) {
  const own = path.resolve(__dirname, 'node_modules/@emotion', name);
  const hoisted = path.resolve(__dirname, '../../../../node_modules/@emotion', name);
  return fs.existsSync(own) ? own : hoisted;
}

// Where the dev server proxies the API (netget's Express backend). Default: the real one on :3000.
// NETGET_BACKEND points it elsewhere (a disposable backend, or a dead port for checks that must not write).
const BACKEND = process.env.NETGET_BACKEND || 'http://127.0.0.1:3000';

// all.this/ (this file is at all.this/modules/netget/Typescript/src/htmls/Netget-REACT/frontend_local/).
// ALL_THIS overrides it for a checkout of netget outside all.this (a worktree elsewhere).
const ALL_THIS = process.env.ALL_THIS ? path.resolve(process.env.ALL_THIS) : path.resolve(__dirname, '../../../../../../../');

// The @mui/system this app's @mui/material resolves (nested under it, or hoisted next to it).
function muiSystemDir() {
  const nested = path.resolve(__dirname, 'node_modules/@mui/material/node_modules/@mui/system');
  return fs.existsSync(nested) ? nested : path.resolve(__dirname, 'node_modules/@mui/system');
}

export default defineConfig(({ command }) => {
  // `vite` (serve) compiles this.gui from its source (thisGuiSource.js); `vite build` keeps its package (dist).
  const guiSource = command === 'serve' && process.env.THIS_GUI !== 'dist' ? thisGuiSourceAliases(ALL_THIS) : null;
  if (guiSource) console.log(`[this.gui] source: ${guiSource.guiRoot} (${guiSource.version}); THIS_GUI=dist serves the build`);
  return {
  plugins: [react(), ...(guiSource ? [guiSource.plugin] : [])],

  ...(guiSource ? { define: { __GUI_VERSION__: JSON.stringify(guiSource.version) } } : {}),

  resolve: {
    // Force single copies of shared deps regardless of where the symlinked source resolves them.
    // react-router/react-router-dom included: without dedupe, this.gui's own
    // copy and this app's own copy resolve to two separate module instances
    // in a production (rollup) build — router hooks from one can't see the
    // <BrowserRouter> context from the other, throwing "Cannot destructure
    // property 'basename' of ... useContext(...) as it is null" at runtime.
    dedupe: ['react', 'react-dom', 'react/jsx-runtime', 'react-router', 'react-router-dom', 'this.gui', '@mui/material', '@emotion/react', '@emotion/styled'],
    alias: [
      ...(guiSource ? guiSource.aliases : []),
      { find: 'netget.gui/compounds', replacement: path.join(NETGET_GUI, 'compounds/index.ts') },
      { find: 'netget.gui/molecules', replacement: path.join(NETGET_GUI, 'molecules/index.ts') },
      { find: 'netget.gui/atoms',     replacement: path.join(NETGET_GUI, 'atoms/index.ts') },
      { find: 'netget.gui',           replacement: path.join(NETGET_GUI, 'index.ts') },
      // `dedupe` alone does NOT converge these on Vite's dev server: this.gui
      // is a symlinked package resolving @mui/material and friends through
      // the pnpm monorepo's own store, while this app has its own plain
      // `npm install`-ed copy — two different files on disk, so two separate
      // module instances with two separate React Context objects. A `<Card>`
      // imported directly here (as Domains.jsx/Logs.jsx do) never saw the
      // this.gui `<Theme>`'s ThemeContext.Provider this way and silently fell
      // back to MUI's bare default theme (white Paper, default text color) —
      // confirmed via two different `.vite/deps/@mui_material.js` bundle
      // hashes loaded simultaneously. Pinning both to this app's own
      // installed copy makes every `@mui/material` import — from this app's
      // own code and from this.gui's symlinked source alike — resolve to the
      // exact same file, and therefore the exact same ThemeContext.
      { find: '@mui/material', replacement: path.resolve(__dirname, 'node_modules/@mui/material') },
      { find: '@mui/icons-material', replacement: path.resolve(__dirname, 'node_modules/@mui/icons-material') },
      // GUI's source imports @mui/system directly: the copy this app's @mui/material uses, not GUI's own.
      ...(guiSource ? [{ find: /^@mui\/system(?=\/|$)/, replacement: muiSystemDir() }] : []),
      // and one @emotion/cache: @mui/styled-engine reached this app's copy while @emotion/react reached the hoisted one.
      ...(guiSource ? [{ find: /^@emotion\/cache$/, replacement: emotionDir('cache') }] : []),
      // One copy of Emotion for everyone. This app declares it (so a clean
      // `npm install` here has it); on a machine where an older install hoisted
      // it to netget/Typescript's node_modules instead, that copy is used.
      { find: '@emotion/react', replacement: emotionDir('react') },
      { find: '@emotion/styled', replacement: emotionDir('styled') },
    ],
  },

  build: {
    // The canonical production build location — this *is* what
    // `mainServerFrontendMode: 'package-dist'`/`'local-dist'` serve
    // (getPackageMainServerUiDistDir() in mainServerFrontend.ts), and what
    // package.json's `files` list publishes. Used to point at "../dist"
    // (Netget-REACT/dist), a location nothing else ever read — this app's
    // own production build was silently never reaching either frontend
    // mode. gui/src/app.tsx used to be the real source for this path; that
    // was a second, unrelated admin app (no Domains/Logs/WelcomeNetget,
    // none of this app's theme/inspector work) — retired in favor of this
    // one build producing both dev and production.
    outDir: "../../../../assets/main-server-ui/dist",
    emptyOutDir: true,
    minify: "terser",
    terserOptions: {
      compress: { drop_console: true },
    },
  },

  // Dev server: proxy API routes to the Express backend so `API = ""`
  // (same-origin) works without nginx.
  server: {
    port: 5173,
    // Explicit IPv4 loopback: nginx's proxy_pass target for this dev server
    // (mainServerFrontend.ts DEFAULT_DEV_URL) is the IPv4 literal
    // http://127.0.0.1:5173. Without this, vite's default host resolution
    // can bind IPv6-only ([::1]:5173) on machines that prefer IPv6 for
    // "localhost", leaving 127.0.0.1 unreachable and nginx's proxy_pass 502ing.
    host: '127.0.0.1',
    allowedHosts: ['local.netget', 'local.host', 'local.cleaker', 'suis-macbook-air.local', 'suis-macbook-air.netget'],
    fs: {
      // Vite's default fs.allow root is wherever it detects THIS project's
      // workspace boundary (nearest package.json/lockfile upward) — for
      // this dev server that stops at modules/netget, a SIBLING of
      // packages/GUI/Typescript, not an ancestor. `this.gui` resolves
      // through a symlink into that sibling directory (confirmed live:
      // every /@fs/.../packages/GUI/Typescript/dist/* request 404'd even
      // though the files existed on disk — Vite blocked serving them as
      // outside the allowed root, not a missing-file 404). Allowing the
      // whole monorepo root once here covers this.gui's dist AND any
      // other cross-package dev import the same way.
      // all.this (this.gui and its sources), and netget's own Typescript/ (this app, netget.gui, hoisted deps): the same
      // directory when netget is checked out inside all.this, two when it is not.
      allow: [ALL_THIS, path.resolve(__dirname, '../../../../')],
    },
    proxy: {
      '/gateway-identity':      BACKEND,
      '/setup':                 BACKEND,
      '/main-server-namespace': BACKEND,
      '/apps':             BACKEND,
      '/logs':             BACKEND,
      '/ip-info':          BACKEND,
      '/port-info':        BACKEND,
      '/healthcheck':      BACKEND,
      '/openresty-status':  BACKEND,
      '/openresty-restart': BACKEND,
      '/openresty-stop':    BACKEND,
      '/frontend-mode':     BACKEND,
      // Domains.jsx + WelcomeNetget.jsx — added late (this allowlist wasn't
      // updated when those pages/fetches were added), so these fell through
      // to Vite's own SPA fallback (index.html, not JSON) whenever this dev
      // server was hit directly instead of through netget's real gateway.
      '/entrypoints':      BACKEND,
      '/surfaces':         BACKEND,
      '/domains':          BACKEND,
      '/add-domain':       BACKEND,
      '/update-domain':    BACKEND,   // the panel's "Cambiar destino"
      '/delete-domain':    BACKEND,
      '/provision-cert':   BACKEND,
      '/check-auth':       BACKEND,
      '/explain':          BACKEND,
      '/inspect':          BACKEND,
      '/cleaker':          BACKEND,
      // Real NRP-style addresses (typed straight into the browser's URL
      // bar, e.g. local.netget/@someuser/profile) need this so the backend
      // resolves them instead of falling through to the SPA shell — but a
      // bare "/@" prefix match ALSO swallows Vite's OWN reserved internal
      // paths, which share that exact prefix: /@vite/client (its HMR
      // client), /@fs/... (cross-package file serving — this.gui's dist,
      // symlinked from packages/GUI/Typescript), /@id/..., /@react-refresh.
      // Proxying those to the Express backend instead of letting Vite
      // serve them itself is what was producing a fully blank page —
      // confirmed live: the backend's own NRP resolver 404'd every one of
      // them (reinterpreting e.g. "@vite/client" as the NRP address
      // "vite.local.cleaker:read/client"), so none of this.gui's ESM
      // imports (mount, Theme, styles.css, the runtime/react/devtools
      // subpaths) ever actually loaded.
      '/@': {
        target: BACKEND,
        bypass(req) {
          if (/^\/@(vite|fs|id|react-refresh)\b/.test(req.url)) return req.url;
        },
      },
    },
  },
  };
});
