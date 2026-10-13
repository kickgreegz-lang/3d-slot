// tools/new-game/lib.mjs: symbol parsing against the real game configs and the default state plan.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { ENV_STATES, ROOT, animationStates, parseSymbols, tierOf } from '../lib.mjs';

const cfg = (g) => readFileSync(resolve(ROOT, 'src/games', g, 'config.ts'), 'utf8');

test('parses literal symbols and helper-built royals (swamp-funk)', () => {
  const s = parseSymbols(cfg('swamp-funk'));
  assert.deepEqual(
    s.map((x) => `${x.id}:${x.kind}`),
    ['H1:high', 'H2:high', 'H3:high', 'H4:high', 'W:wild', 'S:scatter', 'L1:royal', 'L2:royal', 'L3:royal', 'L4:royal', 'L5:royal'],
  );
});

test('parses bass-drop (no scatter)', () => {
  const ids = parseSymbols(cfg('bass-drop')).map((x) => x.id);
  assert.equal(ids.length, 10);
  assert.ok(!ids.includes('S'));
});

test('default plan: five core states for every symbol, anticipation for specials, nine background states', () => {
  const plan = animationStates('x', parseSymbols(cfg('swamp-funk')));
  for (const [id, e] of Object.entries(plan.symbols)) {
    for (const st of ['spin', 'land', 'miss', 'connect', 'explode']) assert.ok(e.states[st], `${id} ${st}`);
    if (tierOf(e.kind) === 'special') assert.ok(e.states.anticipation, `${id} anticipation`);
  }
  assert.deepEqual(Object.keys(plan.environment.states), ENV_STATES);
  // plans are independent copies (editing one symbol never edits another)
  plan.symbols.H1.states.land.status = 'done';
  assert.equal(plan.symbols.H2.states.land.status, 'todo');
});
