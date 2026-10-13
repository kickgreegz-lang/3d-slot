#!/usr/bin/env node
/**
 * New-game scaffold (docs/new-slot/WORKFLOW.md phase A step 1). One command wires a new game into the
 * multi-game engine exactly the way the root README describes, so it runs, type-checks and builds
 * before a single design decision is made:
 *
 *   node tools/new-game/scaffold.mjs <id> --title "Game Title" [--from swamp-funk] [--rgs-game-id <id>] [--dry-run]
 *   node tools/new-game/scaffold.mjs --remove <id> --yes        undo a scaffold (only what it created)
 *
 * Creates:
 *   src/games/<id>/            copy of the template game (--from, default swamp-funk) with
 *                              meta.json, modules.ts (LayeredEnvironment, no 3D mascots),
 *                              environment.ts (placeholder BG layers) and FEATURES.missState
 *   mock/games/<id>/           mock RGS bet modes + the template game's fixture books (same grid)
 *   tsconfig.<id>.json         @game -> src/games/<id>; every other tsconfig excludes the folder
 *   package.json               dev:<id> build:<id> preview:<id> lab:<id> gallery:<id>; typecheck covers it
 *   docs/games/<id>/           DESIGN / ANIMATION_SET / MATH_BRIEF / scorecard + animation-states.json
 *                              (generated from the copied SYMBOLS) + hf/x01.spec.json
 *   src/games/<id>/.scaffold.json   marker listing what was created (written first, updated per
 *                              step; used by --remove and by the automatic rollback on failure)
 *
 * Exit: 0 ok · 1 refused (exists, bad id or title, missing template, script collision) or rolled back · 2 usage.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { ROOT, animationStates, parseSymbols } from './lib.mjs';

const TEMPLATE = resolve(ROOT, 'tools/new-game/template');
const DOC_TEMPLATES = resolve(ROOT, 'docs/new-slot/templates');
const GAMES = resolve(ROOT, 'src/games');
const MOCK = resolve(ROOT, 'mock/games');
const BANNED_TITLE = /\b(megaways|x\s*ways|stake|kick)\b/i;
const DOC_FILES = ['DESIGN.md', 'ANIMATION_SET.md', 'MATH_BRIEF.md', 'scorecard.json', 'art-plan.spec.json'];
const GAME_TEMPLATES = ['game/modules.ts', 'game/environment.ts'];

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
const refuse = (msg) => {
  console.error(`refused: ${msg}`);
  process.exit(1);
};
if (!/^[a-z][a-z0-9-]{2,39}$/.test(id)) refuse(`id "${id}" must be 3-40 chars of a-z 0-9 - and start with a letter (it becomes a folder, GAME=, dist/<id>)`);

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

/** Add or remove exactly this game's five scripts (never any other script) and its typecheck step. */
const editPackage = (game, add) => {
  const file = resolve(ROOT, 'package.json');
  const pkg = readJson(file);
  const own = scriptsFor(game);
  if (add) {
    // keep the game's scripts next to each other, after the last per-game build script
    const entries = Object.entries(pkg.scripts).filter(([k]) => !(k in own));
    const at = entries.findLastIndex(([k]) => /^build:[a-z0-9-]+$/.test(k) && k !== 'build:all') + 1;
    entries.splice(at || entries.length, 0, ...Object.entries(own));
    pkg.scripts = Object.fromEntries(entries);
    if (!pkg.scripts.typecheck.includes(`tsconfig.${game}.json`)) pkg.scripts.typecheck += typecheckPart(game);
  } else {
    for (const k of Object.keys(own)) if (pkg.scripts[k] === own[k]) delete pkg.scripts[k];
    pkg.scripts.typecheck = pkg.scripts.typecheck.replace(typecheckPart(game), '');
  }
  if (dryRun) return console.log(`  edit    package.json (${add ? 'add' : 'remove'} ${Object.keys(own).join(', ')}; typecheck)`);
  writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
};

/** Undo a scaffold: the created paths (inside the repo only), the tsconfig excludes, the scripts. */
const undo = (game, created) => {
  for (const p of created) {
    const abs = resolve(ROOT, p);
    if (!abs.startsWith(`${ROOT}/`) || abs === ROOT) continue;
    if (dryRun) console.log(`  delete  ${p}`);
    else rmSync(abs, { recursive: true, force: true });
  }
  for (const f of otherTsconfigs(game)) editExclude(f, game, false);
  editPackage(game, false);
};

// =====================================================================================  remove
if (removeId) {
  const marker = resolve(GAMES, id, '.scaffold.json');
  if (!existsSync(marker)) refuse(`${rel(marker)} not found: only games created by this scaffold can be removed with it. If src/games/${id} `
      + `was deleted by hand, remove the rest by hand: mock/games/${id}, tsconfig.${id}.json, docs/games/${id}, the `
      + `*:${id} scripts and typecheck entry in package.json, and the src/games/${id} excludes in the other tsconfigs`);
  const made = readJson(marker);
  console.log(`remove ${id}: ${made.created.join(', ')}`);
  if (!yes && !dryRun) refuse('pass --yes to delete these paths (or --dry-run to preview)');
  undo(id, made.created);
  console.log(dryRun ? 'dry run: nothing changed' : `removed ${id}`);
  process.exit(0);
}

// =====================================================================================  pre-checks
// everything that could stop the scaffold is checked before the first write
if (!title) usage('missing --title "Game Title"');
if (BANNED_TITLE.test(title)) refuse(`title "${title}" uses a word Stake rejects or reserves (Megaways, Xways, Stake, Kick)`);
if (/[\u0000-\u001f\u007f]|\*\//.test(title) || title.length > 60) refuse('title must be one line of at most 60 characters without "*/"');
const src = resolve(GAMES, from);
const dst = resolve(GAMES, id);
for (const [p, what] of [
  [resolve(src, 'config.ts'), `template game src/games/${from}`],
  [resolve(MOCK, from, 'mock.json'), `mock/games/${from}/mock.json`],
  ...GAME_TEMPLATES.map((f) => [resolve(TEMPLATE, f), `tools/new-game/template/${f}`]),
  ...DOC_FILES.map((f) => [resolve(DOC_TEMPLATES, f), `docs/new-slot/templates/${f}`]),
]) {
  if (!existsSync(p)) refuse(`${what} not found`);
}
// the template modules.ts imports game-local files (./scene/Frame ...): the --from game must have them
const templateModules = readFileSync(resolve(TEMPLATE, 'game/modules.ts'), 'utf8');
for (const m of templateModules.matchAll(/from '\.\/([^']+)'/g)) {
  if (m[1] === 'environment') continue; // written by the scaffold
  if (!existsSync(resolve(src, `${m[1]}.ts`))) refuse(`the template's modules.ts imports ./${m[1]}, which src/games/${from} does not have (scaffold from a game that has it, e.g. swamp-funk)`);
}
for (const p of [dst, resolve(MOCK, id), resolve(ROOT, `tsconfig.${id}.json`), resolve(ROOT, 'docs/games', id)]) {
  if (existsSync(p)) refuse(`${rel(p)} already exists`);
}
const pkgScripts = readJson(resolve(ROOT, 'package.json')).scripts;
const clash = Object.keys(scriptsFor(id)).filter((k) => k in pkgScripts);
if (clash.length) refuse(`package.json already has ${clash.join(', ')} (pick another id)`);
const prefix = id.replace(/-/g, '');
for (const g of readdirSync(GAMES)) {
  const meta = resolve(GAMES, g, 'meta.json');
  if (!existsSync(meta)) continue;
  const m = readJson(meta);
  if (m.storagePrefix === prefix) refuse(`storagePrefix "${prefix}" is already used by ${g}`);
  if (m.title?.toLowerCase() === title.toLowerCase()) refuse(`title "${title}" is already used by ${g}`);
}

/** Template text for one target: JSON strings, TS comments / literals and Markdown each get their own escaping. */
const fill = (text, kind) => {
  const t = kind === 'json' ? JSON.stringify(title).slice(1, -1) : title;
  return text
    .replaceAll('__TITLE_LITERAL__', JSON.stringify(title.toUpperCase()))
    .replaceAll('__ID__', id)
    .replaceAll('__TITLE__', t)
    .replaceAll('{{ID}}', id)
    .replaceAll('{{TITLE}}', t);
};

// =====================================================================================  create
console.log(`${dryRun ? 'dry run: ' : ''}scaffold ${id} ("${title}") from ${from}`);
const created = [];
const marker = resolve(dst, '.scaffold.json');
const mark = (p) => {
  created.push(p);
  if (!dryRun) writeFileSync(marker, `${JSON.stringify({ id, title, from, created }, null, 2)}\n`);
};

try {
  // 1. game folder: copy the template game, minus its Background module (LayeredEnvironment replaces it;
  //    scene/background/ stays: the Frame borrows its paint helpers). The marker goes in first.
  const skip = new Set(['scene/Background.ts', '.scaffold.json']);
  if (dryRun) console.log(`  copy    src/games/${from} -> ${rel(dst)} (without ${[...skip].join(', ')})`);
  else cpSync(src, dst, { recursive: true, filter: (p) => !skip.has(relative(src, p)) });
  mark(rel(dst));
  write(
    resolve(dst, 'meta.json'),
    `${JSON.stringify({ id, title, rgsGameId: rgsGameId ?? id, storagePrefix: prefix, publicExclude: ['assets/characters'] }, null, 2)}\n`,
  );
  write(resolve(dst, 'modules.ts'), fill(templateModules, 'ts'));
  write(resolve(dst, 'environment.ts'), fill(readFileSync(resolve(TEMPLATE, 'game/environment.ts'), 'utf8'), 'ts'));
  if (!dryRun) {
    // new games play the `miss` state on losing symbols (FEATURES.missState, ANIMATION_STATES.md §1);
    // the match stays inside the FEATURES literal (one nesting level allowed)
    const cfgPath = resolve(dst, 'config.ts');
    const cfg = readFileSync(cfgPath, 'utf8');
    const m = /export const FEATURES: GameFeatures = \{((?:[^{}]|\{[^{}]*\})*)\};/.exec(cfg);
    if (!m) console.warn('  warn    FEATURES literal not found in config.ts: add `missState: true` by hand');
    else if (!/\bmissState\s*:/.test(m[1])) {
      const body = m[1].replace(/\s+$/, '');
      const sep = body.trim() && !body.trim().endsWith(',') ? ',' : '';
      const line = '  /** losing symbols deflate + sink while wins show (docs/new-slot/ANIMATION_STATES.md §1) */\n  missState: true,';
      writeFileSync(cfgPath, cfg.replace(m[0], `export const FEATURES: GameFeatures = {${body}${sep}\n${line}\n};`));
    }
    // the template game's own name in the rules footer
    const info = resolve(dst, 'gameInfo.ts');
    if (existsSync(info)) writeFileSync(info, readFileSync(info, 'utf8').replace(/copyrightHolder:\s*'[^']*'/, `copyrightHolder: ${JSON.stringify(title)}`));
  }

  // 2. mock RGS: same bet modes + fixture books (they match the copied grid)
  if (dryRun) console.log(`  copy    mock/games/${from} -> mock/games/${id}`);
  else cpSync(resolve(MOCK, from), resolve(MOCK, id), { recursive: true });
  mark(`mock/games/${id}`);

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
  mark(`tsconfig.${id}.json`);
  for (const f of otherTsconfigs(id)) editExclude(f, id, true);

  // 4. npm scripts (only this game's five keys; collisions were refused above)
  editPackage(id, true);

  // 5. docs/games/<id>: templates + generated animation-states.json + the first Higgsfield spec
  const docs = resolve(ROOT, 'docs/games', id);
  mark(`docs/games/${id}`);
  for (const f of ['DESIGN.md', 'ANIMATION_SET.md', 'MATH_BRIEF.md']) write(resolve(docs, f), fill(readFileSync(resolve(DOC_TEMPLATES, f), 'utf8'), 'md'));
  write(resolve(docs, 'scorecard.json'), fill(readFileSync(resolve(DOC_TEMPLATES, 'scorecard.json'), 'utf8'), 'json'));
  write(resolve(docs, 'hf/x01.spec.json'), fill(readFileSync(resolve(DOC_TEMPLATES, 'art-plan.spec.json'), 'utf8'), 'json'));
  const symbols = parseSymbols(readFileSync(resolve(src, 'config.ts'), 'utf8'));
  write(resolve(docs, 'animation-states.json'), `${JSON.stringify(animationStates(id, symbols), null, 2)}\n`);
  if (!dryRun) for (const f of ['scorecard.json', 'hf/x01.spec.json', 'animation-states.json']) JSON.parse(readFileSync(resolve(docs, f), 'utf8'));
} catch (err) {
  console.error(`error: ${err instanceof Error ? err.message : String(err)}\nrolling back ${id} ...`);
  if (!dryRun) undo(id, created.length ? created : [rel(dst)]);
  process.exit(1);
}

console.log(`\n${dryRun ? 'would create' : 'created'}: ${created.join(', ')}
next:
${[
  ['pnpm typecheck', `every game, ${id} included`],
  [`pnpm dev:${id}`, 'http://localhost:5173/  (mock RGS, ?book=<fixture>)'],
  [`pnpm kit:check ${id}`, 'kit gates: wiring, docs, symbol + background state coverage'],
  [`pnpm build:${id} && GAME=${id} pnpm qa:approval`, ''],
].map(([cmd, why]) => `  ${why ? cmd.padEnd(30) + '# ' + why : cmd}`).join('\n')}
then follow docs/new-slot/WORKFLOW.md (phase A: design the mechanic in docs/games/${id}/DESIGN.md).
Per-game art goes in public/assets/${id}/ (other games' builds strip it).`);
