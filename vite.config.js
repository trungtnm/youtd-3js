// The game is served by Vite in development; /api goes to the local Worker
// (`npm run api:dev`, port 8787) so online features work on the dev server too.
import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    proxy: { '/api': { target: 'http://127.0.0.1:8787', changeOrigin: false } },
  },
});
