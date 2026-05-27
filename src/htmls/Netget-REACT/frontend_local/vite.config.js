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
    dedupe: ['react', 'react-dom', 'react/jsx-runtime', 'this.gui', '@mui/material', '@emotion/react', '@emotion/styled'],
    alias: [
      { find: 'netget.gui/compounds', replacement: path.join(NETGET_GUI, 'compounds/index.ts') },
      { find: 'netget.gui/molecules', replacement: path.join(NETGET_GUI, 'molecules/index.ts') },
      { find: 'netget.gui/atoms',     replacement: path.join(NETGET_GUI, 'atoms/index.ts') },
      { find: 'netget.gui',           replacement: path.join(NETGET_GUI, 'index.ts') },
    ],
  },

  build: {
    outDir: "../dist",
    minify: "terser",
    terserOptions: {
      compress: { drop_console: true },
    },
  },

  // Dev server: proxy API routes to the Express backend so `API = ""`
  // (same-origin) works without nginx.
  server: {
    port: 5173,
    proxy: {
      '/gateway-identity': 'http://127.0.0.1:3000',
      '/apps':             'http://127.0.0.1:3000',
      '/logs':             'http://127.0.0.1:3000',
      '/ip-info':          'http://127.0.0.1:3000',
      '/port-info':        'http://127.0.0.1:3000',
      '/healthcheck':      'http://127.0.0.1:3000',
    },
  },
});
