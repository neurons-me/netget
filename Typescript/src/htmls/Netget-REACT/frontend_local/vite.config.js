import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Resolve netget.gui source directly — no need to build the lib package for dev.
// Subpath aliases MUST come before the root alias (Vite does prefix matching).
const NETGET_GUI = path.resolve(__dirname, '../../../../gui/src');

export default defineConfig({
  plugins: [react()],

  resolve: {
    // Force single copies of shared deps regardless of where the symlinked source resolves them.
    // react-router/react-router-dom included: without dedupe, this.gui's own
    // copy and this app's own copy resolve to two separate module instances
    // in a production (rollup) build — router hooks from one can't see the
    // <BrowserRouter> context from the other, throwing "Cannot destructure
    // property 'basename' of ... useContext(...) as it is null" at runtime.
    dedupe: ['react', 'react-dom', 'react/jsx-runtime', 'react-router', 'react-router-dom', 'this.gui', '@mui/material', '@emotion/react', '@emotion/styled'],
    alias: [
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
      // Not installed directly under frontend_local/ — both hoist to
      // netget/Typescript's own node_modules (confirmed via require.resolve,
      // including from @mui/material's own internal resolution), so that's
      // the one real copy to pin everyone to.
      { find: '@emotion/react', replacement: path.resolve(__dirname, '../../../../node_modules/@emotion/react') },
      { find: '@emotion/styled', replacement: path.resolve(__dirname, '../../../../node_modules/@emotion/styled') },
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
    proxy: {
      '/gateway-identity': 'http://127.0.0.1:3000',
      '/apps':             'http://127.0.0.1:3000',
      '/logs':             'http://127.0.0.1:3000',
      '/ip-info':          'http://127.0.0.1:3000',
      '/port-info':        'http://127.0.0.1:3000',
      '/healthcheck':      'http://127.0.0.1:3000',
      '/openresty-status':  'http://127.0.0.1:3000',
      '/openresty-restart': 'http://127.0.0.1:3000',
      '/openresty-stop':    'http://127.0.0.1:3000',
      '/frontend-mode':     'http://127.0.0.1:3000',
      // Domains.jsx + WelcomeNetget.jsx — added late (this allowlist wasn't
      // updated when those pages/fetches were added), so these fell through
      // to Vite's own SPA fallback (index.html, not JSON) whenever this dev
      // server was hit directly instead of through netget's real gateway.
      '/entrypoints':      'http://127.0.0.1:3000',
      '/surfaces':         'http://127.0.0.1:3000',
      '/domains':          'http://127.0.0.1:3000',
      '/add-domain':       'http://127.0.0.1:3000',
      '/delete-domain':    'http://127.0.0.1:3000',
      '/provision-cert':   'http://127.0.0.1:3000',
      '/check-auth':       'http://127.0.0.1:3000',
      '/explain':          'http://127.0.0.1:3000',
      '/inspect':          'http://127.0.0.1:3000',
      '/cleaker':          'http://127.0.0.1:3000',
      '/@':                'http://127.0.0.1:3000',
    },
  },
});
