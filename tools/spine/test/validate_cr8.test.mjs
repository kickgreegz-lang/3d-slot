#!/usr/bin/env node
/**
 * CR-8 tests for tools/spine/validate.mjs (docs/games/bass-drop/ANIMATION_SET.md 10 / 12): the `wild`, `ui`
 * and `env` kinds, the Bass Drop animation rules (drop_* / sticky_* / mult_up / bass_react), `overlay`,
 * `cellOverflow`, the drop_impact squash gate, required empty txt_* slots and skins, part bones.
 * A known-good symbol skeleton (the demo) is turned into a minimal wild; each case mutates it and expects
 * exit 1 with a specific message; the untouched wild (and a ui skeleton) must PASS.
 *
 *   node tools/spine/test/validate_cr8.test.mjs <good-symbol-skeleton.json>
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VALIDATE = path.join(HERE, '..', 'validate.mjs');
const good = process.argv[2];
if (!good || process.argv.includes('--help')) {
  console.log('usage: node tools/spine/test/validate_cr8.test.mjs <good-symbol-skeleton.json>');
  process.exit(good ? 0 : 2);
}
const demo = JSON.parse(fs.readFileSync(good, 'utf8'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'spine-cr8-'));
const F = (f) => Math.round((f / 30) * 1e5) / 1e5;
const sq = (keys) => ({ bones: { squash: { scale: keys.map(([f, x, y]) => ({ ...(f ? { time: F(f) } : {}), x, y })) } } });

/** The demo symbol + the CR-8 wild additions (minimal, but every rule satisfied). */
const makeWild = () => {
  const d = JSON.parse(JSON.stringify(demo));
  d.bones.push({ name: 'txt_wild', parent: 'body' }, { name: 'txt_mult', parent: 'body', y: -120 });
  d.slots.push({ name: 'txt_wild', bone: 'txt_wild' }, { name: 'txt_mult', bone: 'txt_mult' });
  d.skins.push({ name: 'mult', attachments: {} }, { name: 'sticky', attachments: {} });
  const A = d.animations;
  A.bass_react = sq([[0, 1, 1], [1, 1.03, 0.95], [4, 0.99, 1.03], [8, 1, 1]]);
  A.drop_launch = { ...sq([[0, 1.15, 0.8], [2, 0.86, 1.25], [8, 0.953, 1.1]]), events: [{ time: F(2), name: 'drop_release' }] };
  A.drop_fall = sq([[0, 0.953, 1.1], [6, 0.937, 1.14], [12, 0.953, 1.1]]);
  A.drop_impact = { ...sq([[0, 0.953, 1.1], [1, 1.18, 0.72], [5, 0.95, 1.1], [9, 1.015, 0.97], [15, 1, 1]]), events: [{ name: 'land_impact' }] };
  A.sticky_idle = sq([[0, 1, 1], [30, 0.994, 1.012], [60, 1, 1]]);
  A.sticky_lock = { ...sq([[0, 1, 1], [6, 1.04, 0.93], [12, 1, 1]]), events: [{ time: F(6), name: 'lock_snap' }] };
  A.mult_up = { ...sq([[0, 1, 1], [5, 1.02, 0.98], [12, 1, 1]]), events: [{ time: F(4), name: 'mult_swap' }] };
  A.sticky_unlock = sq([[0, 1, 1], [9, 1, 1]]);
  for (const n of ['drop_release', 'lock_snap', 'mult_swap']) d.events[n] = {};
  return d;
};
const base = makeWild();
const clone = () => JSON.parse(JSON.stringify(base));

const run = (doc, name, args) => {
  const f = path.join(tmp, `${name}.json`);
  fs.writeFileSync(f, JSON.stringify(doc));
  const r = spawnSync(process.execPath, [VALIDATE, f, ...args], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
};
const W = ['--kind', 'wild'];

const cases = [
  ['drop_impact squash too deep (own gate)', W, (d) => { d.animations.drop_impact.bones.squash.scale[1] = { time: F(1), x: 1.25, y: 0.6 }; }, /drop_impact: peak squash sy 0\.600 .*feel gate 0\.68-0\.78/],
  ['drop_impact squash too shallow', W, (d) => { d.animations.drop_impact.bones.squash.scale[1] = { time: F(1), x: 1.08, y: 0.85 }; }, /drop_impact: peak squash sy 0\.850/],
  ['drop_impact spills > 20 %', W, (d) => { d.animations.drop_impact.bones.body = { translate: [{ x: 0, y: 0 }, { time: F(3), x: 0, y: 160 }, { time: F(15), x: 0, y: 0 }] }; }, /drop_impact: spills .*allowed 20%/],
  ['drop_impact not ending on setup', W, (d) => { const k = d.animations.drop_impact.bones.squash.scale; k[k.length - 1].y = 1.05; }, /drop_impact: does not end on the setup pose/],
  ['drop_release off its hard window', W, (d) => { d.animations.drop_launch.events[0].time = F(5); }, /drop_launch: drop_release on frame 5, target 2-2/],
  ['drop_launch end != drop_fall start', W, (d) => { const k = d.animations.drop_launch.bones.squash.scale; k[k.length - 1].y = 1.2; }, /drop_launch: last pose != first pose of drop_fall/],
  ['drop_fall loop seam', W, (d) => { const k = d.animations.drop_fall.bones.squash.scale; k[k.length - 1].y = 1.14; }, /drop_fall: loop seam/],
  ['lock_snap missing', W, (d) => { d.animations.sticky_lock.events = []; }, /sticky_lock: required event "lock_snap"/],
  ['mult_up end != sticky_idle start', W, (d) => { const k = d.animations.mult_up.bones.squash.scale; k[k.length - 1].x = 1.1; }, /mult_up: last pose != first pose of sticky_idle/],
  ['missing wild animation', W, (d) => { delete d.animations.drop_fall; }, /missing required animation "drop_fall" \(kind wild\)/],
  ['wild still needs the special set', W, (d) => { delete d.animations.anticipation; }, /missing required animation "anticipation" \(kind wild\)/],
  ['bass_react overlay sticks', W, (d) => { const k = d.animations.bass_react.bones.squash.scale; k[k.length - 1].y = 1.03; }, /bass_react: additive overlay \(track 1\) must end on the setup pose/],
  ['bass_react overlay jumps in', W, (d) => { d.animations.bass_react.bones.squash.scale[0].y = 0.9; }, /bass_react: additive overlay \(track 1\) must start on the setup pose/],
  ['bass_react too long', W, (d) => { d.animations.bass_react.bones.squash.scale.push({ time: F(14), x: 1, y: 1 }); }, /bass_react: 14 frames outside the contract window 6-10/],
  ['txt_mult not empty', W, (d) => { d.slots.find((s) => s.name === 'txt_mult').attachment = 'eye_L'; }, /slot "txt_mult" must be empty at setup/],
  ['txt_wild missing', W, (d) => { d.slots = d.slots.filter((s) => s.name !== 'txt_wild'); }, /required empty slot "txt_wild" missing/],
  ['sticky skin missing', W, (d) => { d.skins = d.skins.filter((s) => s.name !== 'sticky'); }, /skin "sticky" missing \(kind wild\)/],
  ['wild slot budget 12', W, (d) => { for (let i = 0; i < 4; i++) d.slots.push({ name: `extra${i}`, bone: 'body' }); }, /slots > 12/],
  ['wild physics budget 4', W, (d) => { for (let i = 0; i < 3; i++) { d.bones.push({ name: `phys_x${i}`, parent: 'body', length: 10 }); d.constraints.push({ type: 'physics', name: `phys_x${i}`, bone: `phys_x${i}`, rotate: 1, limit: 12000, strength: 484, damping: 0.833, inertia: 0.6 }); } }, /physics constraints > 4/],
  ['part bone without art (strict)', [...W, '--strict'], (d) => { d.bones.push({ name: 'helper', parent: 'body' }); }, /bone "helper": no contract prefix .* no art/],
  ['ui budget 30 slots', ['--kind', 'ui'], (d) => { for (let i = 0; i < 22; i++) d.slots.push({ name: `extra${i}`, bone: 'body' }); }, /slots > 30/],
];

let failures = 0;
const expectPass = (doc, name, args) => {
  const r = run(doc, name, args);
  if (r.code !== 0) {
    failures++;
    console.error(`FAIL ${name} should pass:\n${r.out}`);
  } else console.log(`ok   ${name} passes`);
};
expectPass(clone(), 'baseline wild', [...W, '--strict']);
// ui: budgets + static checks only, so a skeleton without the symbol clips passes
// (ui budgets allow no physics: the demo's spring bones become plain part bones)
const ui = JSON.parse(JSON.stringify(clone()).replace(/"phys_/g, '"part_'));
delete ui.constraints;
for (const n of ['idle', 'land', 'win', 'win_loop', 'explode', 'blur', 'anticipation']) delete ui.animations[n];
expectPass(ui, 'ui kind without symbol clips', ['--kind', 'ui', '--strict']);
for (const [name, args, mutate, re] of cases) {
  const d = clone();
  mutate(d);
  const r = run(d, name.replace(/\W+/g, '_'), args);
  if (r.code === 1 && re.test(r.out)) console.log(`ok   ${name}`);
  else {
    failures++;
    console.error(`FAIL ${name}: exit ${r.code}, expected 1 matching ${re}\n${r.out.split('\n').filter((l) => /FAIL|WARN/.test(l)).join('\n')}`);
  }
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log(failures ? `${failures} CR-8 validator test(s) failed` : `all ${cases.length + 2} CR-8 validator tests passed`);
process.exit(failures ? 1 : 0);
