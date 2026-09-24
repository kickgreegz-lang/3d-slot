import { defineConfig } from 'vite';

// Stake Engine serves the build as static files from a CDN sub-path,
// so every asset URL must be relative (base: './').
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 2048,
  },
  server: { host: true, port: 5173 },
  preview: { host: true, port: 4173 },
});
