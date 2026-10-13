#!/usr/bin/env node
/**
 * Build every game: `pnpm build:all` (root README "Multi-game layout").
 *
 *   node tools/build/all.mjs [--only a,b] [--skip-typecheck]
 *
 * A game is any src/games/<id>/ with a config.ts and a meta.json. Each one is type-checked against
 * its own tsconfig (tsconfig.json for the game it maps @game to, tsconfig.<id>.json for the others)
 * and built with GAME=<id> into dist/<id>/ — upload the CONTENTS of that folder to Stake.
 * Stops at the first failure (exit 1); a missing tsconfig is a failure, not a skip.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const onlyAt = args.indexOf('--only');
const only = onlyAt >= 0 ? (args[onlyAt + 1] ?? '').split(',').filter(Boolean) : null;
const skipTypecheck = args.includes('--skip-typecheck');

const defaultGame =
  readFileSync(resolve(ROOT, 'tsconfig.json'), 'utf8').match(/"@game\/\*":\s*\["\.\/src\/games\/([^/]+)\/\*"\]/)?.[1] ?? 'swamp-funk';
const games = readdirSync(resolve(ROOT, 'src/games'))
  .filter((g) => existsSync(resolve(ROOT, 'src/games', g, 'config.ts')) && existsSync(resolve(ROOT, 'src/games', g, 'meta.json')))
  .filter((g) => !only || only.includes(g))
  .sort();
if (only) {
  const unknown = only.filter((g) => !games.includes(g));
  if (unknown.length) {
    console.error(`unknown game(s): ${unknown.join(', ')}`);
    process.exit(2);
  }
}

const bin = (name) => resolve(ROOT, 'node_modules/.bin', name);
const run = (label, cmd, argv, env = {}) => {
  console.log(`\n▶ ${label}`);
  const r = spawnSync(cmd, argv, { cwd: ROOT, stdio: 'inherit', env: { ...process.env, ...env } });
  if (r.status !== 0) {
    console.error(`✖ ${label} failed (exit ${r.status ?? r.signal})`);
    process.exit(1);
  }
};

for (const g of games) {
  const tsconfig = g === defaultGame ? 'tsconfig.json' : `tsconfig.${g}.json`;
  if (!skipTypecheck) {
    if (!existsSync(resolve(ROOT, tsconfig))) {
      console.error(`✖ ${g}: ${tsconfig} is missing (tools/new-game/scaffold.mjs creates it)`);
      process.exit(1);
    }
    run(`${g}: typecheck (${tsconfig})`, bin('tsc'), ['--noEmit', '-p', tsconfig]);
  }
  run(`${g}: vite build -> dist/${g}/`, bin('vite'), ['build'], { GAME: g });
}
console.log(`\n✔ built ${games.length} game(s): ${games.map((g) => `dist/${g}/`).join(', ')}`);
