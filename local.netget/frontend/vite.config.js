// frontend/vite.config.js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist", // Carpeta de salida
    minify: "terser", // Minificar el código
    terserOptions: {
      compress: {
        drop_console: true, // Eliminar console.log
      },
    },
  },
  // server: {
  //     port: 5173

  // },
  
});