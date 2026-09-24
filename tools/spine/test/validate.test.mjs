#!/usr/bin/env node
/**
 * Negative tests for tools/spine/validate.mjs: each case mutates a known-good skeleton JSON
 * and expects exit 1 with a specific message; the untouched file must PASS.
 *
 *   node tools/spine/test/validate.test.mjs <good-skeleton.json> [--atlas <atlas>]
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
  console.log('usage: node tools/spine/test/validate.test.mjs <good-skeleton.json>');
  process.exit(good ? 0 : 2);
}
const base = JSON.parse(fs.readFileSync(good, 'utf8'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'spine-validate-'));
const clone = () => JSON.parse(JSON.stringify(base));

const run = (doc, name) => {
  const f = path.join(tmp, `${name}.json`);
  fs.writeFileSync(f, JSON.stringify(doc));
  const r = spawnSync(process.execPath, [VALIDATE, f, '--kind', 'special'], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
};

const cases = [
  ['4.2 constraint format', (d) => { d.physics = d.constraints; delete d.constraints; }, /4\.2 constraint format/],
  ['constraint order', (d) => { d.constraints.unshift({ type: 'transform', name: 'tc', bones: ['face_eye_L'], source: 'body' }); d.constraints.push({ type: 'ik', name: 'ik1', bones: ['face_eye_R'], target: 'body' }); }, /out of order/],
  ['curve arity', (d) => { d.animations.land.bones.squash.scale[0].curve = d.animations.land.bones.squash.scale[0].curve.slice(0, 4); }, /expected 8/],
  ['missing event', (d) => { d.animations.land.events = d.animations.land.events.filter((e) => e.name !== 'land_impact'); }, /land_impact/],
  ['loop seam', (d) => { const k = d.animations.idle.bones.squash.scale; k[k.length - 1].y = 1.05; }, /loop seam/],
  ['land squash too shallow', (d) => { for (const k of d.animations.land.bones.squash.scale) { delete k.curve; if ((k.y ?? 1) < 1) k.y = 0.95; } }, /peak squash sy 0\.950 .*feel gate/],
  ['land squash too deep', (d) => { for (const k of d.animations.land.bones.squash.scale) { delete k.curve; if ((k.y ?? 1) < 0.9) k.y = 0.7; } }, /peak squash sy 0\.700 .*feel gate/],
  ['out of cell', (d) => { for (const k of d.animations.land.bones.squash.scale) k.y = Math.max(k.y ?? 1, 1.25); }, /leaves the 300x300 cell/],
  ['missing required animation', (d) => { delete d.animations.win_loop; }, /missing required animation "win_loop"/],
  ['win too long', (d) => { const k = d.animations.win.bones.body.scale; k[k.length - 1].time = 1.0; }, /frames outside the contract window|TIMING\.win/],
  ['win end != win_loop start', (d) => { const k = d.animations.win.bones.body.scale; k[k.length - 1].x = 1.3; k[k.length - 1].y = 1.3; }, /first pose of win_loop/],
  ['explode not alpha 0', (d) => { for (const t of Object.values(d.animations.explode.slots)) { const k = t.alpha; k[k.length - 1].value = 0.5; } }, /must end at alpha 0/],
  ['clipping attachment', (d) => { d.skins[0].attachments.body.clip = { type: 'clipping', vertexCount: 3, vertices: [0, 0, 10, 0, 0, 10] }; }, /clipping attachment/],
  ['sequence attachment', (d) => { d.skins[0].attachments.eye_L.eye_L.sequence = { count: 2 }; }, /sequence attachment/],
  ['slot budget', (d) => { for (let i = 0; i < 3; i++) d.slots.push({ name: `extra${i}`, bone: 'body' }); }, /slots > 8/],
  ['phys bone without constraint', (d) => { d.constraints = d.constraints.filter((c) => c.bone !== 'phys_antenna_2'); }, /phys_antenna_2" is phys_\* but has no physics constraint/],
  ['physics limit too low', (d) => { d.constraints[0].limit = 5000; }, /limit 5000/],
  ['additive outside fx_', (d) => { d.slots.find((s) => s.name === 'body').blend = 'additive'; }, /only allowed on fx_/],
  ['region extension', (d) => { d.skins[0].attachments.eye_L.eye_L.path = 'sym_demo/eye_L.png'; }, /file extension/],
  ['bad sfx id', (d) => { d.animations.land.events.push({ name: 'sfx', string: 'boing' }); }, /not an SfxId/],
  ['NaN value', (d) => { d.animations.win.bones.body.scale[1].x = null; d.animations.win.bones.body.scale[1].curve = [0, 'x', 0, 0, 0, 0, 0, 0]; }, /NaN|failed to load/],
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
    console.error(`FAIL ${name}: exit ${r.code}, expected 1 matching ${re}\n${r.out.split('\n').filter((l) => /FAIL|WARN/.test(l)).join('\n')}`);
  }
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log(failures ? `${failures} validator test(s) failed` : `all ${cases.length + 1} validator tests passed`);
process.exit(failures ? 1 : 0);
