import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The Vite dev server proxies /api/* to the Express identity server on :3001.
// Run `cd Server && node server.js` first (or use `npm start`).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
