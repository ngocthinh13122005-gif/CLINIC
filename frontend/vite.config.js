import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8000',
      '/media': 'http://127.0.0.1:8000',
    },
  },
  build: {
    outDir: 'dist', sourcemap: false,
    rollupOptions: {
      output: {
        // Shared icons otherwise become dozens of tiny requests on a cold page load.
        manualChunks(id) {
          if (id.includes('/node_modules/@mui/icons-material/')) return 'icons';
        },
      },
    },
  },
});
