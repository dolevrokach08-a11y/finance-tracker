import { defineConfig } from 'vite';

// Keeps your existing multi-page HTML app; no bundling step required for dev.
export default defineConfig({
  server: {
    port: 5500,
    strictPort: true,
    open: '/login.html',
  },
  // No `public/` folder in this repo — disable so Vite does not warn.
  publicDir: false,
});
