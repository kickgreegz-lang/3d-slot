#!/usr/bin/env node
/**
 * Kit gates for one game (docs/new-slot/WORKFLOW.md, AGENTS.md `qa-verifier`):
 *
 *   node tools/new-game/kit-check.mjs <game> [--release] [--strict] [--json <file>]
 *   pnpm kit:check <game> [--release]
 *
 *   wiring     meta.json, required game files, tsconfig + excludes, npm scripts, mock RGS bet modes
 *   docs       docs/games/<game>/DESIGN.md + ANIMATION_SET.md present; TODO count
 *   states     docs/games/<game>/animation-states.json covers EVERY symbol in config.ts with the five core
 *              states (spin, land, miss, connect, explode; + anticipation for specials) and the nine
 *              background states; Spine techniques name clips that exist in the built skeleton
 *   env        LayeredEnvironment wired with environment.ts; production plates set (release)
 *
 * --release: every state must be `done`, no placeholder background layer, no TODO left in the docs.
 * --init-states: write docs/games/<game>/animation-states.json with the default plan when it is missing
 *   (for games that predate the kit), then exit.
 * --strict: warnings fail too. Exit 0 pass · 1 fail · 2 usage.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve, sep } from 'node:path';
import { ENV_STATES, ROOT, animationStates, defaultGame, parseSymbols, tierOf, tsconfigFor } from './lib.mjs';

const args = process.argv.slice(2);
const take = (name) => {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const has = (name) => {
  const i = args.indexOf(name);
  if (i >= 0) args.splice(i, 1);
  return i >= 0;
};
const jsonOut = take('--json');
const release = has('--release');
const strict = has('--strict');
const initStates = has('--init-states');
const game = args.shift();
// --json writes a report: only into build/, qa/, screenshots/ or the temp dir (never over a source file)
if (jsonOut) {
  const abs = resolve(jsonOut);
  const okRoots = ['build', 'qa', 'screenshots'].map((d) => resolve(ROOT, d) + sep).concat(resolve(tmpdir()) + sep);
  if (!okRoots.some((r) => abs.startsWith(r)) || !abs.endsWith('.json')) {
    console.error(`refused: --json must be a .json path under build/, qa/, screenshots/ or ${tmpdir()} (got ${jsonOut})`);
    process.exit(2);
  }
}
if (!game || args.length) {
  console.error('usage: node tools/new-game/kit-check.mjs <game> [--release] [--strict] [--json <file>] | <game> --init-states');
  process.exit(2);
}

const results = [];
const add = (level, code, msg) => results.push({ level, code, msg });
const pass = (code, msg) => add('pass', code, msg);
const warn = (code, msg) => add(release ? 'fail' : 'warn', code, msg);
const fail = (code, msg) => add('fail', code, msg);
const read = (p) => readFileSync(p, 'utf8');
const readJson = (p) => JSON.parse(read(p));

const gameDir = resolve(ROOT, 'src/games', game);
if (!existsSync(resolve(gameDir, 'config.ts'))) {
  console.error(`no game "${game}" (src/games/${game}/config.ts not found)`);
  process.exit(2);
}
const isDefault = game === defaultGame();

if (initStates) {
  const out = resolve(ROOT, 'docs/games', game, 'animation-states.json');
  if (existsSync(out)) {
    console.error(`refused: ${out.replace(`${ROOT}/`, '')} already exists`);
    process.exit(1);
  }
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(animationStates(game, parseSymbols(readFileSync(resolve(gameDir, 'config.ts'), 'utf8'))), null, 2)}\n`);
  console.log(`wrote ${out.replace(`${ROOT}/`, '')}: review every technique and status`);
  process.exit(0);
}

// ------------------------------------------------------------------------------------- wiring
const REQUIRED = ['meta.json', 'config.ts', 'layout.ts', 'modules.ts', 'book.ts', 'events.ts', 'gameInfo.ts', 'i18n.ts', 'art.ts'];
const missing = REQUIRED.filter((f) => !existsSync(resolve(gameDir, f)));
if (missing.length) fail('W2', `game files missing: ${missing.join(', ')}`);
else pass('W2', `game files present (${REQUIRED.length})`);

let meta = {};
try {
  meta = readJson(resolve(gameDir, 'meta.json'));
  const probs = [];
  if (meta.id !== game) probs.push(`id "${meta.id}" != folder "${game}"`);
  for (const k of ['title', 'rgsGameId', 'storagePrefix']) if (!meta[k]) probs.push(`${k} missing`);
  if (/\b(megaways|x\s*ways|stake|kick)\b/i.test(meta.title ?? '')) probs.push(`title "${meta.title}" uses a word Stake rejects or reserves`);
  for (const g of readdirSync(resolve(ROOT, 'src/games'))) {
    const mp = resolve(ROOT, 'src/games', g, 'meta.json');
    if (g === game || !existsSync(mp)) continue;
    const m = readJson(mp);
    if (m.storagePrefix === meta.storagePrefix) probs.push(`storagePrefix "${meta.storagePrefix}" also used by ${g}`);
    if (m.title && meta.title && m.title.toLowerCase() === meta.title.toLowerCase()) probs.push(`title also used by ${g}`);
  }
  if (probs.length) fail('W1', `meta.json: ${probs.join('; ')}`);
  else pass('W1', `meta.json: "${meta.title}" (${meta.rgsGameId}, prefix ${meta.storagePrefix})`);
} catch (e) {
  fail('W1', `meta.json unreadable: ${e.message}`);
}

const tsName = tsconfigFor(game);
const tsPath = resolve(ROOT, tsName);
if (!existsSync(tsPath)) fail('W3', `${tsName} missing (scaffold creates it)`);
else {
  const ts = read(tsPath);
  if (!ts.includes(`./src/games/${game}/*`)) fail('W3', `${tsName} does not map @game/* to src/games/${game}`);
  else {
    const leaks = readdirSync(ROOT)
      .filter((f) => /^tsconfig(\.[a-z0-9-]+)?\.json$/.test(f) && f !== tsName)
      .filter((f) => !read(resolve(ROOT, f)).includes(`"src/games/${game}"`));
    if (leaks.length) fail('W3', `${leaks.join(', ')} do not exclude src/games/${game} (its scene events would leak into other games' typecheck)`);
    else pass('W3', `${tsName} maps @game; every other tsconfig excludes the folder`);
  }
}

const pkg = readJson(resolve(ROOT, 'package.json'));
const want = isDefault ? ['dev', 'build'] : [`dev:${game}`, `build:${game}`];
const missingScripts = want.filter((k) => !pkg.scripts[k]);
const tcOk = isDefault || pkg.scripts.typecheck.includes(`tsconfig.${game}.json`);
if (missingScripts.length || !tcOk) fail('W4', `package.json: ${[...missingScripts.map((k) => `no "${k}"`), ...(tcOk ? [] : ['typecheck does not cover the game'])].join('; ')}`);
else pass('W4', `npm scripts ${want.join(', ')}; typecheck covers the game`);

const config = read(resolve(gameDir, 'config.ts'));
const modeKeys = [...(config.match(/export const BET_MODES[\s\S]*?\n};/)?.[0] ?? '').matchAll(/^\s*([A-Z][A-Z0-9_]*):\s*\{\s*key:/gm)].map((m) => m[1]);
const mockPath = resolve(ROOT, 'mock/games', game, 'mock.json');
if (!existsSync(mockPath)) fail('W5', `mock/games/${game}/mock.json missing`);
else {
  const mock = readJson(mockPath);
  const mockKeys = Object.keys(mock.betModes ?? {});
  const books = existsSync(resolve(ROOT, 'mock/games', game, 'books')) ? readdirSync(resolve(ROOT, 'mock/games', game, 'books')).filter((f) => f.endsWith('.json')) : [];
  const probs = [];
  if (!mockKeys.includes('BASE')) probs.push('no BASE mode');
  const onlyConfig = modeKeys.filter((k) => !mockKeys.includes(k));
  const onlyMock = mockKeys.filter((k) => !modeKeys.includes(k));
  if (onlyConfig.length) probs.push(`BET_MODES not in mock.json: ${onlyConfig.join(', ')}`);
  if (onlyMock.length) probs.push(`mock.json modes not in BET_MODES: ${onlyMock.join(', ')}`);
  if (!books.length) probs.push('no fixture books');
  if (probs.length) fail('W5', `mock RGS: ${probs.join('; ')}`);
  else pass('W5', `mock RGS: modes ${mockKeys.join(', ')} match BET_MODES; ${books.length} book file(s)`);
}

// ------------------------------------------------------------------------------------- docs
const docs = resolve(ROOT, 'docs/games', game);
for (const f of ['DESIGN.md', 'ANIMATION_SET.md']) {
  const p = resolve(docs, f);
  if (!existsSync(p)) {
    fail('D1', `docs/games/${game}/${f} missing`);
    continue;
  }
  const todos = (read(p).match(/\bTODO\b/g) ?? []).length;
  if (todos) warn('D1', `docs/games/${game}/${f}: ${todos} TODO(s) left`);
  else pass('D1', `docs/games/${game}/${f} complete`);
}

// ------------------------------------------------------------------------------------- states
const CORE = ['spin', 'land', 'miss', 'connect', 'explode'];
const TECH = new Set(['spine', 'procedural', 'texture', 'shader', 'flipbook', 'particles', 'video', 'layered']);
const STATUS = new Set(['todo', 'placeholder', 'done']);
const statesPath = resolve(docs, 'animation-states.json');
const symbols = parseSymbols(config);
const coverage = { done: 0, placeholder: 0, todo: 0 };

/**
 * Built skeleton JSON for a symbol. Symbol ids (H1, W, L1 ...) repeat across games, so the game's own
 * paths win; the shared build/spine/ and public/assets/spine/ copies may belong to another game and
 * are only accepted with a warning (and never in --release).
 */
const skeletonFor = (sid) => {
  const own = [resolve(ROOT, `public/assets/${game}/spine/sym_${sid}.json`), resolve(ROOT, `build/spine/${game}/sym_${sid}.json`)].find((p) => existsSync(p));
  if (own) return { path: own, shared: false };
  const shared = [resolve(ROOT, `build/spine/sym_${sid}.json`), resolve(ROOT, `public/assets/spine/sym_${sid}.json`)].find((p) => existsSync(p));
  return shared ? { path: shared, shared: true } : null;
};

if (!existsSync(statesPath)) fail('A1', `docs/games/${game}/animation-states.json missing (scaffold generates it from config.ts)`);
else {
  let st;
  try {
    st = readJson(statesPath);
  } catch (e) {
    fail('A1', `animation-states.json unreadable: ${e.message}`);
  }
  if (st) {
    const listed = Object.keys(st.symbols ?? {});
    const notListed = symbols.map((s) => s.id).filter((id) => !listed.includes(id));
    const stale = listed.filter((id) => !symbols.some((s) => s.id === id));
    const unreadable = symbols.filter((x) => !x.kind).map((x) => x.id);
    if (unreadable.length) fail('A1', `SYMBOLS entries without a readable kind: ${unreadable.join(', ')} (use a literal or a helper whose body sets kind)`);
    if (!symbols.length) fail('A1', 'no SYMBOLS object found in config.ts');
    else if (notListed.length || stale.length)
      fail('A1', `animation-states.json out of sync with SYMBOLS: ${[notListed.length ? `missing ${notListed.join(', ')}` : '', stale.length ? `stale ${stale.join(', ')}` : ''].filter(Boolean).join('; ')}`);
    else pass('A1', `animation-states.json lists all ${symbols.length} symbols`);

    for (const { id: sid, kind } of symbols) {
      const entry = st.symbols?.[sid];
      if (!entry) continue;
      const need = tierOf(kind) === 'special' ? [...CORE, 'anticipation'] : CORE;
      const states = entry.states ?? {};
      const absent = need.filter((s) => !states[s]);
      if (absent.length) fail('A2', `${sid}: no plan for ${absent.join(', ')}`);
      const bad = Object.entries(states).filter(([, v]) => !TECH.has(v.tech) || !STATUS.has(v.status));
      if (bad.length) fail('A2', `${sid}: unknown tech/status in ${bad.map(([k]) => k).join(', ')}`);
      for (const v of Object.values(states)) if (STATUS.has(v.status)) coverage[v.status]++;

      const spineStates = Object.entries(states).filter(([, v]) => v.tech === 'spine');
      if (spineStates.length) {
        const skel = skeletonFor(sid);
        if (!skel) {
          const done = spineStates.filter(([, v]) => v.status === 'done').map(([k]) => k);
          if (done.length) fail('A3', `${sid}: ${done.join(', ')} marked done but no built skeleton (public/assets/${game}/spine/ or build/spine/${game}/sym_${sid}.json)`);
          else warn('A3', `${sid}: Spine rig not built yet (${spineStates.map(([k]) => k).join(', ')})`);
        } else {
          const where = skel.path.replace(`${ROOT}/`, '');
          if (skel.shared) warn('A3', `${sid}: only a shared skeleton (${where}) exists; it may be another game's rig: build this game's into build/spine/${game}/`);
          const anims = Object.keys(readJson(skel.path).animations ?? {});
          const lacking = spineStates.flatMap(([k, v]) => [v.clip, v.loop].filter(Boolean).filter((c) => !anims.includes(c)).map((c) => `${k}:${c}`));
          if (lacking.length) fail('A3', `${sid}: skeleton ${where} lacks ${lacking.join(', ')}`);
          else if (!skel.shared) pass('A3', `${sid}: skeleton has every planned clip`);
        }
      }
      if (!absent.length && !bad.length) pass('A2', `${sid} (${tierOf(kind)}): ${need.length} states planned`);
    }

    const env = st.environment?.states ?? {};
    const envAbsent = ENV_STATES.filter((s) => !env[s]);
    if (envAbsent.length) fail('A4', `background states not planned: ${envAbsent.join(', ')}`);
    else pass('A4', `background: all ${ENV_STATES.length} states planned`);
    for (const v of Object.values(env)) if (STATUS.has(v.status)) coverage[v.status]++;

    const open = coverage.todo + coverage.placeholder;
    if (open) warn('A5', `coverage: ${coverage.done} done, ${coverage.placeholder} placeholder, ${coverage.todo} todo`);
    else pass('A5', `coverage: all ${coverage.done} states done`);
  }
}

// ------------------------------------------------------------------------------------- environment
const modules = existsSync(resolve(gameDir, 'modules.ts')) ? read(resolve(gameDir, 'modules.ts')) : '';
if (modules.includes('LayeredEnvironment')) {
  const envPath = resolve(gameDir, 'environment.ts');
  if (!existsSync(envPath)) fail('E1', 'modules.ts uses LayeredEnvironment but environment.ts is missing');
  else {
    const env = read(envPath);
    const live = env
      .split('\n')
      .filter((l) => !/^\s*(\/\/|\*)/.test(l))
      .join('\n');
    const layers = (live.match(/\brole:\s*'(plate|light)'/g) ?? []).length;
    const srcs = (live.match(/\bsrc:\s*\{/g) ?? []).length;
    if (!srcs) warn('E1', `background: ${layers} layer(s), all procedural placeholders (no production plate src yet)`);
    else if (srcs < layers) warn('E1', `background: ${srcs}/${layers} layers have production plates`);
    else pass('E1', `background: all ${layers} layers have production plates`);
  }
} else {
  pass('E1', 'bespoke background module (not LayeredEnvironment): its states are reviewed through animation-states.json');
}

// ------------------------------------------------------------------------------------- report
const fails = results.filter((r) => r.level === 'fail').length;
const warns = results.filter((r) => r.level === 'warn').length;
for (const r of results) console.log(`${r.level.toUpperCase().padEnd(4)}  ${r.code}  ${r.msg}`);
console.log(`\nkit:check ${game}${release ? ' --release' : ''}: ${fails} fail, ${warns} warn, ${results.length - fails - warns} pass`);
if (jsonOut) writeFileSync(jsonOut, `${JSON.stringify({ game, release, strict, coverage, results }, null, 2)}\n`);
process.exit(fails || (strict && warns) ? 1 : 0);
