import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { rgsMockPlugin } from './mock/rgsMockPlugin';

/**
 * Stake approval scans the build for absolute URLs. A few library strings contain
 * URLs that are never requested (Pixi's hello banner, the KTX/Basis transcoder CDN
 * defaults — we ship no compressed textures —, a GSAP warning, a three.js shader
 * comment). Neutralise them so the scan stays clean; xmlns URIs are left alone.
 */
const LIBRARY_URLS = /https?:\/\/(?:www\.pixijs\.com|gsap\.com|jcgt\.org|cdn\.jsdelivr\.net)[^"'`\s)]*/g;
const stripLibraryUrls = (): Plugin => ({
  name: 'strip-library-urls',
  apply: 'build',
  renderChunk: (code) => {
    const out = code.replace(LIBRARY_URLS, '');
    return out === code ? null : { code: out, map: null };
  },
});

/** Dev-only public assets (the demo Spine rig) never ship in dist/. */
const DEV_ONLY_PUBLIC = ['assets/spine/demo'];
const dropDevOnlyAssets = (): Plugin => {
  let outDir = 'dist';
  return {
    name: 'drop-dev-only-assets',
    apply: 'build',
    configResolved: (c) => {
      outDir = resolve(c.root, c.build.outDir);
    },
    closeBundle: () => {
      for (const p of DEV_ONLY_PUBLIC) rmSync(resolve(outDir, p), { recursive: true, force: true });
    },
  };
};

// Stake Engine serves the build as static files from a CDN sub-path,
// so every asset URL must be relative (base: './').
export default defineConfig({
  base: './',
  // DEV-only (apply: 'serve'): mock Stake RGS at /__rgs backed by mock/books fixtures.
  plugins: [rgsMockPlugin(), stripLibraryUrls(), dropDevOnlyAssets()],
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
