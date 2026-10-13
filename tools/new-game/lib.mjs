/**
 * Shared helpers for tools/new-game (scaffold.mjs, kit-check.mjs). No side effects on import.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** The game tsconfig.json maps to (the "default" game): read from its @game path. */
export const defaultGame = () => {
  const m = readFileSync(resolve(ROOT, 'tsconfig.json'), 'utf8').match(/"@game\/\*":\s*\["\.\/src\/games\/([^/]+)\/\*"\]/);
  return m ? m[1] : 'swamp-funk';
};
export const tsconfigFor = (game) => (game === defaultGame() ? 'tsconfig.json' : `tsconfig.${game}.json`);

/**
 * Skip a string literal or comment starting at `i` (or return i when there is none).
 * Enough of a tokenizer for config object literals: '..', "..", `..` (no nested ${}), //, /* *\/.
 */
const skipNoise = (t, i) => {
  const c = t[i];
  if (c === "'" || c === '"' || c === '`') {
    for (let j = i + 1; j < t.length; j++) {
      if (t[j] === '\\') j++;
      else if (t[j] === c) return j + 1;
    }
    return t.length;
  }
  if (c === '/' && t[i + 1] === '/') {
    const j = t.indexOf('\n', i);
    return j < 0 ? t.length : j;
  }
  if (c === '/' && t[i + 1] === '*') {
    const j = t.indexOf('*/', i + 2);
    return j < 0 ? t.length : j + 2;
  }
  return i;
};

/** Top-level `key: value` entries of the object literal opening at `open` (index of its `{`). */
const objectEntries = (t, open) => {
  const entries = [];
  let depth = 0;
  let valueStart = -1;
  let key = null;
  for (let i = open; i < t.length; ) {
    const j = skipNoise(t, i);
    if (j !== i) {
      i = j;
      continue;
    }
    const c = t[i];
    if (c === '{' || c === '(' || c === '[') depth++;
    else if (c === '}' || c === ')' || c === ']') {
      depth--;
      if (depth === 0) {
        if (key !== null) entries.push({ key, value: t.slice(valueStart, i).trim() });
        return entries;
      }
    } else if (depth === 1 && c === ',' && key !== null) {
      entries.push({ key, value: t.slice(valueStart, i).trim() });
      key = null;
    } else if (depth === 1 && key === null) {
      const m = /^\s*['"]?([A-Za-z0-9_]+)['"]?\s*:/.exec(t.slice(i));
      if (m) {
        key = m[1];
        i += m[0].length;
        valueStart = i;
        continue;
      }
    }
    i++;
  }
  return entries;
};

const quoted = "['\"]([A-Za-z0-9_]+)['\"]";

/**
 * Symbols of a game config: [{id, kind}] in declaration order. Reads the `SYMBOLS` object literal
 * entry by entry (any field order, either quote style, comments allowed); entries built by a helper
 * such as `royal('L1', ...)` take the kind the helper's body declares. Entries whose id or kind
 * cannot be read are returned with kind null (kit-check fails on them instead of skipping them).
 */
export const parseSymbols = (configText) => {
  const t = configText;
  const decl = /export const SYMBOLS\b[^=]*=\s*\{/.exec(t);
  if (!decl) return [];
  const helpers = {};
  for (const h of t.matchAll(/const\s+(\w+)\s*=\s*\([^)]*\)\s*:\s*SymbolDef\s*=>\s*\(\{([\s\S]*?)\}\);/g)) {
    const k = new RegExp(`\\bkind:\\s*${quoted}`).exec(h[2]);
    if (k) helpers[h[1]] = k[1];
  }
  const out = [];
  for (const { key, value } of objectEntries(t, decl.index + decl[0].length - 1)) {
    if (value.startsWith('{')) {
      const id = new RegExp(`\\bid:\\s*${quoted}`).exec(value)?.[1] ?? key;
      const kind = new RegExp(`\\bkind:\\s*${quoted}`).exec(value)?.[1] ?? null;
      out.push({ id, kind });
    } else {
      const call = new RegExp(`^(\\w+)\\(\\s*${quoted}`).exec(value);
      out.push({ id: call?.[2] ?? key, kind: call ? (helpers[call[1]] ?? null) : null });
    }
  }
  return out;
};

const TIER_OF = { high: 'premium', royal: 'low' };
export const tierOf = (kind) => TIER_OF[kind] ?? 'special';

/**
 * The default technique per tier and state (ANIMATION_STATES.md §2.2). status:
 *   placeholder = the runtime already plays it procedurally or from a placeholder texture
 *   todo        = production asset or engine delta still to build
 */
export const PLAN = {
  premium: {
    spin: { tech: 'texture', asset: '_blur', status: 'placeholder' },
    land: { tech: 'spine', clip: 'land', status: 'todo' },
    miss: { tech: 'procedural', status: 'placeholder', note: 'FEATURES.missState: deflate + sink + dim (SYMBOL_TIMING.miss); tune in the lab' },
    connect: { tech: 'spine', clip: 'win', loop: 'win_loop', status: 'todo' },
    explode: { tech: 'spine', clip: 'explode', status: 'todo' },
    idle: { tech: 'spine', clip: 'idle', status: 'todo' },
  },
  special: {
    spin: { tech: 'texture', asset: '_blur', status: 'placeholder' },
    land: { tech: 'spine', clip: 'land', status: 'todo' },
    miss: { tech: 'spine', clip: 'miss', status: 'todo', note: 'tease-fail / shrug: Spine miss needs E5; until then the procedural miss plays' },
    connect: { tech: 'spine', clip: 'win', loop: 'win_loop', status: 'todo' },
    explode: { tech: 'spine', clip: 'explode', status: 'todo' },
    idle: { tech: 'spine', clip: 'idle', status: 'todo' },
    anticipation: { tech: 'spine', clip: 'anticipation', status: 'todo' },
  },
  low: {
    spin: { tech: 'texture', asset: '_blur', status: 'placeholder' },
    land: { tech: 'procedural', status: 'placeholder', note: 'squash spring + jelly mesh; per-royal land weight' },
    miss: { tech: 'procedural', status: 'placeholder', note: 'FEATURES.missState: deflate + sink + dim (SYMBOL_TIMING.miss)' },
    connect: { tech: 'spine', clip: 'win', loop: 'win_loop', status: 'todo', note: 'low kind rig (engine delta E4)' },
    explode: { tech: 'spine', clip: 'explode', status: 'todo', note: 'low kind rig + shards in the royal colour' },
  },
};

export const ENV_STATES = ['idle', 'spin', 'land', 'miss', 'connect', 'explode', 'anticipation', 'bigwin', 'feature'];

export const ENV_PLAN = Object.fromEntries(
  ENV_STATES.map((s) => [
    s,
    { tech: 'layered', status: 'placeholder', note: 'LayeredEnvironment; production plates pending' },
  ]),
);

export const animationStates = (game, symbols) => ({
  $comment:
    'Source of truth for which animation covers each symbol and background state (docs/new-slot/ANIMATION_STATES.md). ' +
    'tech: spine | procedural | texture | shader | flipbook | particles | video | layered. status: todo | placeholder | done. ' +
    'Checked by `pnpm kit:check <game>` (release mode needs every status done).',
  game,
  symbolStates: ['spin', 'land', 'miss', 'connect', 'explode'],
  symbols: Object.fromEntries(
    symbols.map(({ id: sid, kind }) => {
      const tier = tierOf(kind);
      return [sid, { kind, tier, states: structuredClone(PLAN[tier]) }];
    }),
  ),
  environment: { states: ENV_PLAN },
});
