import { defineConfig } from 'vite';
import { rgsMockPlugin } from './mock/rgsMockPlugin';

// Stake Engine serves the build as static files from a CDN sub-path,
// so every asset URL must be relative (base: './').
export default defineConfig({
  base: './',
  // DEV-only (apply: 'serve'): mock Stake RGS at /__rgs backed by mock/books fixtures.
  plugins: [rgsMockPlugin()],
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 2048,
    rolldownOptions: {
      output: {
        // Stake approval: zero console output. (esbuild.drop is ignored by Vite 8's Oxc minifier.)
        minify: { compress: { dropConsole: true, dropDebugger: true }, mangle: true },
      },
    },
  },
  server: { host: true, port: 5173 },
  preview: { host: true, port: 4173 },
});
