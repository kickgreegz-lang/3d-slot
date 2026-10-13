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

/** Symbols of a game config: [{id, kind}] in declaration order (regex, like the pipeline tools). */
export const parseSymbols = (configText) => {
  const out = [];
  const seen = new Set();
  for (const m of configText.matchAll(/id:\s*'([A-Za-z0-9_]+)',\s*kind:\s*'([a-z]+)'/g)) {
    if (!seen.has(m[1])) out.push({ id: m[1], kind: m[2] }), seen.add(m[1]);
  }
  // helper constructors such as royal('L1', ...): the helper body declares the kind
  for (const h of configText.matchAll(/const\s+(\w+)\s*=\s*\([^)]*\)\s*:\s*SymbolDef\s*=>\s*\(\{[\s\S]*?kind:\s*'([a-z]+)'/g)) {
    for (const m of configText.matchAll(new RegExp(`${h[1]}\\(\\s*'([A-Za-z0-9_]+)'`, 'g'))) {
      if (!seen.has(m[1])) out.push({ id: m[1], kind: h[2] }), seen.add(m[1]);
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
    miss: { tech: 'procedural', status: 'todo', note: 'engine delta E1 (SymbolView.miss)' },
    connect: { tech: 'spine', clip: 'win', loop: 'win_loop', status: 'todo' },
    explode: { tech: 'spine', clip: 'explode', status: 'todo' },
    idle: { tech: 'spine', clip: 'idle', status: 'todo' },
  },
  special: {
    spin: { tech: 'texture', asset: '_blur', status: 'placeholder' },
    land: { tech: 'spine', clip: 'land', status: 'todo' },
    miss: { tech: 'spine', clip: 'miss', status: 'todo', note: 'tease-fail / shrug; engine delta E1' },
    connect: { tech: 'spine', clip: 'win', loop: 'win_loop', status: 'todo' },
    explode: { tech: 'spine', clip: 'explode', status: 'todo' },
    idle: { tech: 'spine', clip: 'idle', status: 'todo' },
    anticipation: { tech: 'spine', clip: 'anticipation', status: 'todo' },
  },
  low: {
    spin: { tech: 'texture', asset: '_blur', status: 'placeholder' },
    land: { tech: 'procedural', status: 'placeholder', note: 'squash spring + jelly mesh; per-royal land weight' },
    miss: { tech: 'procedural', status: 'todo', note: 'engine delta E1 (SymbolView.miss)' },
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
