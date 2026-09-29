import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { env } from 'node:process';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { rgsMockPlugin } from './mock/rgsMockPlugin';

/**
 * MULTI-GAME: one engine, one folder per game under src/games/<id>/. The GAME env var
 * (default 'swamp-funk') picks the game at build time: `@game/*` resolves to its folder,
 * `__GAME_ID__` is defined, index.html gets its title, the mock RGS serves
 * mock/games/<id>/, and builds go to dist/<id>/ (self-contained, relative URLs).
 *   GAME=bass-drop vite          dev        (pnpm dev:bass-drop)
 *   GAME=bass-drop vite build    build      (pnpm build:bass-drop; pnpm build:all = every game)
 */
const ROOT = dirname(fileURLToPath(import.meta.url));
const GAMES_DIR = resolve(ROOT, 'src/games');
const GAME = env.GAME?.trim() || 'swamp-funk';
if (!existsSync(resolve(GAMES_DIR, GAME, 'config.ts'))) {
  const known = readdirSync(GAMES_DIR).filter((d) => existsSync(resolve(GAMES_DIR, d, 'config.ts')));
  throw new Error(`Unknown GAME "${GAME}" (src/games/${GAME}/config.ts not found). Known games: ${known.join(', ')}`);
}
const GAME_META = JSON.parse(readFileSync(resolve(GAMES_DIR, GAME, 'meta.json'), 'utf8')) as { title?: string; publicExclude?: string[] };

/** index.html <title> per game. */
const gameHtml = (): Plugin => ({
  name: 'game-html',
  transformIndexHtml: (html) =>
    html.replace(/<title>[^<]*<\/title>/, `<title>${(GAME_META.title ?? GAME).replace(/[<&]/g, '')}</title>`),
});

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

/**
 * public/ paths that never ship in this game's dist/ (tools/licence/public-scope.json, also read by
 * `licence:audit --game`): the DEV-only assets (the demo Spine rig), every OTHER game's
 * assets/<id>/ folder (a game never carries another game's art or its licences), and this
 * game's meta.json `publicExclude` (shared assets it never loads).
 */
const PUBLIC_POLICY = JSON.parse(readFileSync(resolve(ROOT, 'tools/licence/public-scope.json'), 'utf8')) as { devOnly: string[] };
const OTHER_GAMES = readdirSync(GAMES_DIR).filter((d) => d !== GAME && existsSync(resolve(GAMES_DIR, d, 'config.ts')));
const UNSHIPPED_PUBLIC = [...PUBLIC_POLICY.devOnly, ...OTHER_GAMES.map((g) => `assets/${g}`), ...(GAME_META.publicExclude ?? [])];
const dropUnshippedPublic = (): Plugin => {
  let outDir = 'dist';
  return {
    name: 'drop-unshipped-public',
    apply: 'build',
    configResolved: (c) => {
      outDir = resolve(c.root, c.build.outDir);
    },
    closeBundle: () => {
      for (const p of UNSHIPPED_PUBLIC) {
        const abs = resolve(outDir, p);
        rmSync(abs, { recursive: true, force: true });
        // and the folders that leaves empty (assets/spine/ once the demo rig is gone)
        for (let d = dirname(abs); d.startsWith(`${outDir}/`) && existsSync(d) && readdirSync(d).length === 0; d = dirname(d)) rmSync(d, { recursive: true });
      }
    },
  };
};

// Stake Engine serves the build as static files from a CDN sub-path,
// so every asset URL must be relative (base: './').
export default defineConfig({
  base: './',
  // per-game dependency-optimizer cache: `define` differs per game, so a shared cache would
  // make two dev servers (dev + dev:bass-drop) re-optimize each other's deps forever
  cacheDir: resolve(ROOT, 'node_modules/.vite', GAME),
  resolve: {
    alias: { '@game': resolve(GAMES_DIR, GAME) },
  },
  define: {
    __GAME_ID__: JSON.stringify(GAME),
  },
  // DEV-only (apply: 'serve'): mock Stake RGS at /__rgs backed by mock/games/<GAME>/books.
  plugins: [gameHtml(), rgsMockPlugin({ game: GAME }), stripLibraryUrls(), dropUnshippedPublic()],
  build: {
    outDir: `dist/${GAME}`,
    emptyOutDir: true,
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
