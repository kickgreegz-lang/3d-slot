#!/usr/bin/env node
/**
 * Negative tests for `tools/spine/validate.mjs --kind character`: each case mutates a known-good
 * character skeleton JSON (the Gumbo demo) and expects exit 1 with a specific message; the untouched
 * file must PASS.
 *
 *   node tools/spine/test/validate_character.test.mjs <good chr_gumbo.json>
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
  console.log('usage: node tools/spine/test/validate_character.test.mjs <good chr_gumbo.json>');
  process.exit(good ? 0 : 2);
}
const base = JSON.parse(fs.readFileSync(good, 'utf8'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'spine-validate-chr-'));
const clone = () => JSON.parse(JSON.stringify(base));

const run = (doc, name) => {
  // keep the chr_gumbo file name: the rig spec (clip lengths, events) is looked up by skeleton name
  const dir = path.join(tmp, name);
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, 'chr_gumbo.json');
  fs.writeFileSync(f, JSON.stringify(doc));
  const r = spawnSync(process.execPath, [VALIDATE, f, '--kind', 'character'], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
};
const lastKey = (keys) => keys[keys.length - 1];

const cases = [
  ['missing required clip', (d) => { delete d.animations.fs_end; }, /missing required clip "fs_end"/],
  ['clip length != ANIMATION_SET', (d) => { for (const k of Object.values(d.animations.blink.slots)) for (const t of Object.values(k)) lastKey(t).time = 0.3; }, /blink: 9 frames, ANIMATION_SET says 5/],
  ['event off its frame', (d) => { d.animations.win_big.events.find((e) => e.name === 'sfx').time = 20 / 30; }, /event sfx:cooler_slam on frame 20, ANIMATION_SET says 24/],
  ['event missing', (d) => { d.animations.fs_trigger.events = []; }, /fs_trigger: event sfx:cooler_slam did not fire/],
  ['loop seam', (d) => { lastKey(d.animations.idle.bones.hips.translate).y = 4; }, /idle: loop seam differs/],
  ['overlay not a zero delta', (d) => { lastKey(d.animations.wild_land_react.bones.head.translate).y = -6; }, /additive overlay last frame is not a zero delta/],
  ['child-coded head', (d) => { const h = d.bones.find((b) => b.name === 'head'); h.scaleX = 1.5; h.scaleY = 1.5; }, /proportions: head is .*% of the height > 27%/],
  ['look constraint missing', (d) => { d.constraints = d.constraints.filter((c) => c.name !== 'look'); }, /transform constraint "look"/],
  ['eye state missing', (d) => { delete d.skins[0].attachments.eye_L.wide; }, /slot "eye_L": eye states wide missing/],
  ['per-rig attachment missing', (d) => { delete d.skins[0].attachments.mouth.roar; }, /slot "mouth": attachment\(s\) roar missing/],
  ['IK setup pops', (d) => { const c = d.constraints.find((x) => x.name === 'ik_foot_L'); c.bendPositive = !(c.bendPositive ?? true); }, /IK "ik_foot_L": the setup pose moves/],
  ['root keyed', (d) => { d.animations.idle.bones.root = { rotate: [{ value: 0 }, { time: 5.6, value: 0 }] }; }, /idle: keys the root bone/],
  ['physics limit', (d) => { d.constraints.find((c) => c.type === 'physics').limit = 4000; }, /limit 4000 < 6000/],
  ['physics budget', (d) => {
    for (let i = 1; i <= 3; i++) {
      d.bones.push({ name: `phys_tail_x${i}`, parent: 'hips', length: 20 });
      d.constraints.push({ type: 'physics', name: `phys_tail_x${i}`, bone: `phys_tail_x${i}`, rotate: 1, limit: 6000, fps: 60, inertia: 0.5, strength: 355, damping: 0.88 });
    }
  }, /budget: 13 physics constraints > 12/],
  ['bone budget', (d) => { for (let i = 0; i < 40; i++) d.bones.push({ name: `fx_extra_${i}`, parent: 'root' }); }, /budget: 84 bones > 80/],
  ['slot budget', (d) => { for (let i = 0; i < 6; i++) d.slots.push({ name: `extra${i}`, bone: 'hips' }); }, /budget: 42 slots > 40/],
  ['additive outside fx_', (d) => { d.slots.find((s) => s.name === 'torso').blend = 'additive'; }, /only allowed on fx_/],
  ['IK curve arity', (d) => { const k = d.animations.win_big.ik.ik_hand_L.find((x) => Array.isArray(x.curve)); k.curve = k.curve.slice(0, 4); }, /ik\/ik_hand_L key \d+: curve has 4 numbers, expected 8/],
  ['bad sfx id', (d) => { d.animations.react_small.events = [{ time: 0.1, name: 'sfx', string: 'boing' }]; }, /not an SfxId/],
];

let failures = 0;
const ok = run(clone(), 'good');
if (ok.code !== 0) {
  console.error(`FAIL baseline should pass:\n${ok.out}`);
  failures++;
} else console.log('ok   baseline passes');
for (const [name, mutate, re] of cases) {
  const d = clone();
  mutate(d);
  const r = run(d, name.replace(/\W+/g, '_'));
  if (r.code === 1 && re.test(r.out)) console.log(`ok   ${name}`);
  else {
    failures++;
    console.error(`FAIL ${name}: exit ${r.code}, expected 1 matching ${re}\n${r.out.split('\n').filter((l) => /FAIL|WARN|Error/.test(l)).join('\n')}`);
  }
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log(failures ? `${failures} character validator test(s) failed` : `all ${cases.length + 1} character validator tests passed`);
process.exit(failures ? 1 : 0);
