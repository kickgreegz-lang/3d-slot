#!/usr/bin/env node
/**
 * New-game scaffold (docs/new-slot/WORKFLOW.md phase 0). One command wires a new game into the
 * multi-game engine exactly the way the root README describes, so it runs, type-checks and builds
 * before a single design decision is made:
 *
 *   node tools/new-game/scaffold.mjs <id> --title "Game Title" [--from swamp-funk] [--rgs-game-id <id>] [--dry-run]
 *   node tools/new-game/scaffold.mjs --remove <id> --yes        undo a scaffold (only what it created)
 *
 * Creates:
 *   src/games/<id>/            copy of the template game (--from, default swamp-funk) with
 *                              meta.json, modules.ts (LayeredEnvironment, no 3D mascots) and
 *                              environment.ts (placeholder BG layers) from tools/new-game/template
 *   mock/games/<id>/           mock RGS bet modes + the template game's fixture books (same grid)
 *   tsconfig.<id>.json         @game -> src/games/<id>; every other tsconfig excludes the folder
 *   package.json               dev:<id> build:<id> preview:<id> lab:<id> gallery:<id>; typecheck covers it
 *   docs/games/<id>/           DESIGN / ANIMATION_SET / MATH_BRIEF / scorecard + animation-states.json
 *                              (generated from the copied SYMBOLS) + hf/x01.spec.json
 *   .scaffold.json             marker listing what was created (used by --remove)
 *
 * Exit: 0 ok · 1 refused (exists, bad id, missing template) · 2 usage.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { animationStates, parseSymbols } from './lib.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const TEMPLATE = resolve(ROOT, 'tools/new-game/template');
const DOC_TEMPLATES = resolve(ROOT, 'docs/new-slot/templates');
const GAMES = resolve(ROOT, 'src/games');
const MOCK = resolve(ROOT, 'mock/games');
const BANNED_TITLE = /\b(megaways|x\s*ways|stake|kick)\b/i;

const usage = (msg) => {
  if (msg) console.error(`error: ${msg}`);
  console.error('usage: node tools/new-game/scaffold.mjs <id> --title "Title" [--from swamp-funk] [--rgs-game-id <id>] [--dry-run]\n' +
    '       node tools/new-game/scaffold.mjs --remove <id> --yes');
  process.exit(2);
};

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  if (v === undefined || v.startsWith('--')) usage(`${name} needs a value`);
  args.splice(i, 2);
  return v;
};
const flag = (name) => {
  const i = args.indexOf(name);
  if (i < 0) return false;
  args.splice(i, 1);
  return true;
};

const removeId = opt('--remove');
const title = opt('--title');
const from = opt('--from') ?? 'swamp-funk';
const rgsGameId = opt('--rgs-game-id');
const dryRun = flag('--dry-run');
const yes = flag('--yes');
const id = removeId ?? args.shift();
if (args.length) usage(`unexpected argument(s): ${args.join(' ')}`);
if (!id) usage('missing <id>');
if (!/^[a-z][a-z0-9-]{2,39}$/.test(id)) {
  console.error(`refused: id "${id}" must be 3-40 chars of a-z 0-9 - and start with a letter (it becomes a folder, GAME=, dist/<id>)`);
  process.exit(1);
}

const rel = (p) => relative(ROOT, p);
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const write = (p, text) => {
  if (dryRun) return console.log(`  write   ${rel(p)}`);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, text);
};

const otherTsconfigs = (game) =>
  readdirSync(ROOT)
    .filter((f) => /^tsconfig(\.[a-z0-9-]+)?\.json$/.test(f) && f !== `tsconfig.${game}.json`)
    .map((f) => resolve(ROOT, f));

/** Add or remove `src/games/<game>` in a tsconfig's "exclude" array, keeping the file's layout. */
const editExclude = (file, game, add) => {
  const text = readFileSync(file, 'utf8');
  const m = text.match(/"exclude":\s*\[([^\]]*)\]/);
  const entry = `src/games/${game}`;
  const items = m ? [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]) : [];
  const has = items.includes(entry);
  if (add === has) return false;
  const next = add ? [...items, entry] : items.filter((x) => x !== entry);
  const arr = `"exclude": [${next.map((x) => JSON.stringify(x)).join(', ')}]`;
  const out = m ? text.replace(m[0], arr) : text.replace(/\n}\s*$/, `,\n  ${arr}\n}\n`);
  if (dryRun) console.log(`  edit    ${rel(file)} (${add ? 'exclude' : 'un-exclude'} ${entry})`);
  else writeFileSync(file, out);
  return true;
};

const scriptsFor = (game) => ({
  [`dev:${game}`]: `GAME=${game} vite`,
  [`build:${game}`]: `tsc --noEmit -p tsconfig.${game}.json && GAME=${game} vite build`,
  [`preview:${game}`]: `GAME=${game} vite preview`,
  [`lab:${game}`]: `GAME=${game} vite --open "/?dev=lab"`,
  [`gallery:${game}`]: `GAME=${game} vite --open "/?dev=gallery"`,
});
const typecheckPart = (game) => ` && tsc --noEmit -p tsconfig.${game}.json`;

const editPackage = (game, add) => {
  const file = resolve(ROOT, 'package.json');
  const pkg = readJson(file);
  const scripts = pkg.scripts;
  if (add) {
    // keep the game's scripts next to each other, after the last per-game build script
    const entries = Object.entries(scripts).filter(([k]) => !k.endsWith(`:${game}`));
    const at = entries.findLastIndex(([k]) => /^build:[a-z0-9-]+$/.test(k) && k !== 'build:all') + 1;
    entries.splice(at || entries.length, 0, ...Object.entries(scriptsFor(game)));
    pkg.scripts = Object.fromEntries(entries);
    if (!pkg.scripts.typecheck.includes(`tsconfig.${game}.json`)) pkg.scripts.typecheck += typecheckPart(game);
  } else {
    for (const k of Object.keys(scriptsFor(game))) delete scripts[k];
    scripts.typecheck = scripts.typecheck.replace(typecheckPart(game), '');
  }
  if (dryRun) return console.log(`  edit    package.json (${add ? 'add' : 'remove'} ${Object.keys(scriptsFor(game)).join(', ')}; typecheck)`);
  writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
};

const fill = (text) =>
  text
    .replaceAll('__TITLE_LITERAL__', JSON.stringify((title ?? id).toUpperCase()))
    .replaceAll('__ID__', id).replaceAll('__TITLE__', title ?? id).replaceAll('{{ID}}', id).replaceAll('{{TITLE}}', title ?? id);

// =====================================================================================  remove
if (removeId) {
  const gameDir = resolve(GAMES, id);
  const marker = resolve(gameDir, '.scaffold.json');
  if (!existsSync(marker)) {
    console.error(`refused: ${rel(marker)} not found — only games created by this scaffold can be removed with it`);
    process.exit(1);
  }
  const made = readJson(marker);
  console.log(`remove ${id}: ${made.created.join(', ')}`);
  if (!yes && !dryRun) {
    console.error('refused: pass --yes to delete these paths (or --dry-run to preview)');
    process.exit(1);
  }
  for (const p of made.created) {
    const abs = resolve(ROOT, p);
    if (!abs.startsWith(`${ROOT}/`) || abs === ROOT) continue;
    if (dryRun) console.log(`  delete  ${p}`);
    else rmSync(abs, { recursive: true, force: true });
  }
  for (const f of otherTsconfigs(id)) editExclude(f, id, false);
  editPackage(id, false);
  console.log(dryRun ? 'dry run: nothing changed' : `removed ${id}`);
  process.exit(0);
}

// =====================================================================================  create
if (!title) usage('missing --title "Game Title"');
if (BANNED_TITLE.test(title)) {
  console.error(`refused: title "${title}" uses a word Stake rejects or reserves (Megaways, Xways, Stake, Kick)`);
  process.exit(1);
}
const src = resolve(GAMES, from);
const dst = resolve(GAMES, id);
for (const [p, what] of [
  [resolve(src, 'config.ts'), `template game src/games/${from}`],
  [resolve(MOCK, from, 'mock.json'), `mock/games/${from}/mock.json`],
  [resolve(TEMPLATE, 'game/modules.ts'), 'tools/new-game/template/game/modules.ts'],
  [DOC_TEMPLATES, 'docs/new-slot/templates'],
]) {
  if (!existsSync(p)) {
    console.error(`refused: ${what} not found`);
    process.exit(1);
  }
}
for (const p of [dst, resolve(MOCK, id), resolve(ROOT, `tsconfig.${id}.json`), resolve(ROOT, 'docs/games', id)]) {
  if (existsSync(p)) {
    console.error(`refused: ${rel(p)} already exists`);
    process.exit(1);
  }
}
const prefix = id.replace(/-/g, '');
for (const g of readdirSync(GAMES)) {
  const meta = resolve(GAMES, g, 'meta.json');
  if (!existsSync(meta)) continue;
  const m = readJson(meta);
  if (m.storagePrefix === prefix) {
    console.error(`refused: storagePrefix "${prefix}" is already used by ${g}`);
    process.exit(1);
  }
  if (m.title?.toLowerCase() === title.toLowerCase()) {
    console.error(`refused: title "${title}" is already used by ${g}`);
    process.exit(1);
  }
}

console.log(`${dryRun ? 'dry run: ' : ''}scaffold ${id} ("${title}") from ${from}`);
const created = [];

// 1. game folder: copy the template game, minus its Background module (LayeredEnvironment replaces it;
//    scene/background/ stays: the Frame borrows its paint helpers)
const skip = new Set(['scene/Background.ts', '.scaffold.json']);
if (dryRun) console.log(`  copy    src/games/${from} -> ${rel(dst)} (without ${[...skip].join(', ')})`);
else
  cpSync(src, dst, {
    recursive: true,
    filter: (p) => !skip.has(relative(src, p)),
  });
created.push(rel(dst));
write(
  resolve(dst, 'meta.json'),
  `${JSON.stringify({ id, title, rgsGameId: rgsGameId ?? id, storagePrefix: prefix, publicExclude: ['assets/characters'] }, null, 2)}\n`,
);
write(resolve(dst, 'modules.ts'), fill(readFileSync(resolve(TEMPLATE, 'game/modules.ts'), 'utf8')));
write(resolve(dst, 'environment.ts'), fill(readFileSync(resolve(TEMPLATE, 'game/environment.ts'), 'utf8')));
// the template game's own name in the rules footer
const info = resolve(dst, 'gameInfo.ts');
if (!dryRun && existsSync(info)) {
  writeFileSync(info, readFileSync(info, 'utf8').replace(/copyrightHolder:\s*'[^']*'/, `copyrightHolder: ${JSON.stringify(title)}`));
}

// 2. mock RGS: same bet modes + fixture books (they match the copied grid)
if (dryRun) console.log(`  copy    mock/games/${from} -> mock/games/${id}`);
else cpSync(resolve(MOCK, from), resolve(MOCK, id), { recursive: true });
created.push(`mock/games/${id}`);

// 3. TypeScript project for the game + exclude it everywhere else
const tsconfig = {
  $comment: `Type-checks the engine against ${id} (@game -> src/games/${id}); scaffolded by tools/new-game/scaffold.mjs. \`pnpm typecheck\` runs every game.`,
  extends: './tsconfig.json',
  compilerOptions: { paths: { '@game/*': [`./src/games/${id}/*`] } },
  include: ['src', 'vite.config.ts'],
  exclude: readdirSync(GAMES)
    .filter((g) => g !== id && existsSync(resolve(GAMES, g, 'config.ts')))
    .map((g) => `src/games/${g}`),
};
const tsText = `${JSON.stringify(tsconfig, null, 2)}\n`.replace(/"exclude": \[\n\s+([\s\S]*?)\n\s+\]/, (_, inner) => `"exclude": [${inner.split(/,\n\s+/).join(', ')}]`);
write(resolve(ROOT, `tsconfig.${id}.json`), tsText);
created.push(`tsconfig.${id}.json`);
for (const f of otherTsconfigs(id)) editExclude(f, id, true);

// 4. npm scripts
editPackage(id, true);

// 5. docs/games/<id>: templates + generated animation-states.json + the first Higgsfield spec
const docs = resolve(ROOT, 'docs/games', id);
for (const f of ['DESIGN.md', 'ANIMATION_SET.md', 'MATH_BRIEF.md', 'scorecard.json']) {
  write(resolve(docs, f), fill(readFileSync(resolve(DOC_TEMPLATES, f), 'utf8')));
}
write(resolve(docs, 'hf/x01.spec.json'), fill(readFileSync(resolve(DOC_TEMPLATES, 'art-plan.spec.json'), 'utf8')));
const symbols = parseSymbols(readFileSync(resolve(src, 'config.ts'), 'utf8'));
write(resolve(docs, 'animation-states.json'), `${JSON.stringify(animationStates(id, symbols), null, 2)}\n`);
created.push(`docs/games/${id}`);

write(resolve(dst, '.scaffold.json'), `${JSON.stringify({ id, title, from, created }, null, 2)}\n`);

console.log(`\n${dryRun ? 'would create' : 'created'}: ${created.join(', ')}
next:
  pnpm typecheck                         # every game, ${id} included
  pnpm dev:${id}                         # http://localhost:5173/  (mock RGS, ?book=<fixture>)
  pnpm kit:check ${id}                   # kit gates: wiring, docs, symbol + background state coverage
  pnpm build:${id} && GAME=${id} pnpm qa:approval
then follow docs/new-slot/WORKFLOW.md from phase 1 (design the mechanic in docs/games/${id}/DESIGN.md).
Per-game art goes in public/assets/${id}/ (other games' builds strip it).`);
