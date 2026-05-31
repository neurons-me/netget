import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { renameSync, existsSync } from 'fs';

// Rename app.html → index.html after build so nginx finds it at root.
function renameHtmlPlugin(): Plugin {
  return {
    name: 'rename-html',
    closeBundle() {
      const src  = resolve(__dirname, '../assets/main-server-ui/dist/app.html');
      const dest = resolve(__dirname, '../assets/main-server-ui/dist/index.html');
      if (existsSync(src)) renameSync(src, dest);
    },
  };
}

// netget admin app build
// Produces a self-contained SPA served at local.netget.
// Output: ../assets/main-server-ui/dist/index.html
export default defineConfig({
  plugins: [react(), renameHtmlPlugin()],
  build: {
    outDir: resolve(__dirname, '../assets/main-server-ui/dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, 'app.html'),
      output: {
        // Split heavy deps into cacheable vendor chunks
        manualChunks(id) {
          if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/') || id.includes('node_modules/react-router-dom/')) {
            return 'vendor-react';
          }
          if (id.includes('node_modules/@mui/') || id.includes('node_modules/@emotion/') || id.includes('node_modules/@floating-ui/')) {
            return 'vendor-mui';
          }
          if (id.includes('node_modules/@lexical/') || id.includes('node_modules/lexical/')) {
            return 'vendor-lexical';
          }
          if (id.includes('node_modules/this.gui/')) {
            return 'vendor-gui';
          }
        },
      },
    },
  },
});
