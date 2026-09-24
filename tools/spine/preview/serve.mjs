#!/usr/bin/env node
/**
 * Minimal static server for the Spine preview page (no Vite, no bundler): serves the repo
 * root read-only so the page can import pixi.js / spine-pixi-v8 ESM builds straight from
 * node_modules (import map in tools/spine/preview/index.html) and load skeletons from
 * public/assets/** or build/**. Binds 127.0.0.1 only.
 *
 *   node tools/spine/preview/serve.mjs [--port 5231] [--root <dir>]
 *   open http://127.0.0.1:5231/tools/spine/preview/index.html?skel=/public/assets/spine/demo/sym_demo.json&atlas=/public/assets/spine/demo/sym_demo.atlas
 *
 * import { startServer } from './serve.mjs'  ->  const { url, close } = await startServer({ port: 0 })
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.atlas': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.skel': 'application/octet-stream',
  '.map': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};

export const startServer = ({ port = 5231, root = REPO, extraRoots = {} } = {}) =>
  new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        const u = new URL(req.url, 'http://x');
        let rel = decodeURIComponent(u.pathname);
        let base = root;
        for (const [prefix, dir] of Object.entries(extraRoots)) {
          if (rel.startsWith(prefix)) {
            base = dir;
            rel = rel.slice(prefix.length - 1);
          }
        }
        const file = path.resolve(base, `.${rel}`);
        if (file !== path.resolve(base) && !file.startsWith(path.resolve(base) + path.sep)) {
          res.writeHead(403).end();
          return;
        }
        const st = fs.statSync(file, { throwIfNoEntry: false });
        if (!st || !st.isFile()) {
          res.writeHead(404, { 'content-type': 'text/plain' }).end(`not found: ${rel}`);
          return;
        }
        res.writeHead(200, {
          'content-type': MIME[path.extname(file)] ?? 'application/octet-stream',
          'cache-control': 'no-store',
        });
        fs.createReadStream(file).pipe(res);
      } catch (e) {
        res.writeHead(500).end(String(e));
      }
    });
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const addr = server.address();
      resolve({ url: `http://127.0.0.1:${addr.port}`, port: addr.port, close: () => new Promise((r) => server.close(r)) });
    });
  });

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0].replace(/^\/\*\*?\n?|^ \* ?/gm, '').trim());
    process.exit(0);
  }
  const port = Number(args.includes('--port') ? args[args.indexOf('--port') + 1] : 5231);
  const root = args.includes('--root') ? path.resolve(args[args.indexOf('--root') + 1]) : REPO;
  const { url } = await startServer({ port, root });
  console.log(`spine preview: ${url}/tools/spine/preview/index.html?skel=/public/assets/spine/demo/sym_demo.json&atlas=/public/assets/spine/demo/sym_demo.atlas`);
}
