// frontend/vite.config.js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "../dist", 
    minify: "terser",
    terserOptions: {
      compress: {
        drop_console: true,
      },
    },
  },
});