#!/usr/bin/env node
/**
 * Spine 4.3 symbol-skeleton contract validator (ANIMATION_CONTRACT sections 2-4), on the
 * OFFICIAL runtime @esotericsoftware/spine-core 4.3.13 — the same code the game ships.
 *
 *   node tools/spine/validate.mjs <skeleton.json> [--atlas <file.atlas>] [--kind auto|high|special|any]
 *        [--cell 300] [--kick 26] [--report <out.json>] [--strict] [--quiet] [--help]
 *
 * Static checks (raw JSON): 4.3 header + unified root `constraints[]` in IK -> transform ->
 *   (path) -> physics -> slider order (a 4.2-format file loads with every constraint
 *   silently DROPPED), bone names/prefixes/hierarchy, phys_* bone <-> physics constraint
 *   pairing, physics limit/params, budgets (<= 30 bones, <= 250 mesh vertices, <= 8 slots,
 *   no clipping), no sequence attachments, region names without extensions, additive blend
 *   only on fx_* slots, weighted vertices (>= 1 bone, weights sum to 1), curve arity
 *   (4 numbers per channel), sfx/vfx payload ids.
 * Runtime checks (spine-core SkeletonJson + AtlasAttachmentLoader; a synthetic atlas when
 *   --atlas is not given): every contract animation present for the kind, frame windows,
 *   NaN in bones/slots/vertices while stepping with physics at 60 Hz until 2 frames past the
 *   end (last-frame events fire on the next update), required events fired, event frames,
 *   loop seams sampled with loop=false (first pose == last pose), win end == win_loop start,
 *   land/appear/anticipation_out end on the setup pose, explode ends at alpha 0, and `land`
 *   stays inside the cell (+-cell/2 skeleton units) with the runtime's physics kick applied.
 * --kind auto: sym_W / sym_S -> special, other sym_H* -> high, sym_L* -> royal (nothing
 *   required), anything else -> special (strictest). Exit 0 = pass (warnings allowed unless
 *   --strict), 1 = contract failure, 2 = usage / unreadable input.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as spine from '@esotericsoftware/spine-core';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const CONTRACT = JSON.parse(fs.readFileSync(path.join(HERE, 'contract.json'), 'utf8'));
const FPS = CONTRACT.fps;

// ------------------------------------------------------------------------------------ args
const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def;
};
const flag = (name) => argv.includes(`--${name}`);
if (flag('help') || flag('h') || argv.length === 0) {
  const src = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8');
  console.log(src.split('*/')[0].replace(/^\/\*\*?\n?|^ \* ?/gm, '').trim());
  process.exit(argv.length === 0 ? 2 : 0);
}
const optNames = new Set(['atlas', 'kind', 'cell', 'kick', 'report']);
const positional = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && optNames.has(argv[i - 1].slice(2))));
const jsonPath = positional[0];
const atlasPath = opt('atlas', null);
const cell = Number(opt('cell', CONTRACT.cellPx));
const kick = Number(opt('kick', CONTRACT.timing.runtimeKick));
const strict = flag('strict');
const quiet = flag('quiet');
const reportPath = opt('report', null);

const errors = [];
const warnings = [];
const info = [];
const err = (m) => errors.push(m);
const warn = (m) => warnings.push(m);

let raw;
try {
  raw = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
} catch (e) {
  console.error(`validate: cannot read ${jsonPath}: ${e.message}`);
  process.exit(2);
}
const skelName = path.basename(jsonPath).replace(/\.json$/, '');
let kind = opt('kind', 'auto');
if (kind === 'auto') {
  const id = skelName.replace(/^sym_/, '');
  kind = CONTRACT.symbolKinds[id] ?? 'special';
}
if (!['high', 'special', 'royal', 'any'].includes(kind)) {
  console.error(`validate: --kind must be auto|high|special|royal|any`);
  process.exit(2);
}

// ---------------------------------------------------------------------- static JSON checks
const sk = raw.skeleton ?? {};
if (!String(sk.spine ?? '').startsWith('4.3')) err(`skeleton.spine is "${sk.spine}", expected 4.3.x`);
if (sk.fps !== undefined && sk.fps !== FPS) err(`skeleton.fps ${sk.fps} != ${FPS}`);
if (sk.fps === undefined) warn(`skeleton.fps missing (contract: ${FPS})`);
for (const legacy of ['ik', 'transform', 'path', 'physics']) {
  if (raw[legacy] !== undefined)
    err(`root "${legacy}" array found: 4.2 constraint format. spine-core 4.3 silently DROPS these; use one root "constraints" array`);
}
const bones = raw.bones ?? [];
const boneByName = new Map(bones.map((b) => [b.name, b]));
const boneRe = new RegExp(CONTRACT.boneNames.pattern);
for (const req of ['root', 'squash', 'body']) if (!boneByName.has(req)) err(`bone "${req}" missing (ANIMATION_CONTRACT 2.3)`);
if (boneByName.get('squash')?.parent !== 'root') err('bone squash must be a child of root');
if (boneByName.get('body')?.parent !== 'squash') err('bone body must be a child of squash');
if (bones[0]?.name !== 'root') err('first bone must be root');
for (const b of bones) {
  if (!boneRe.test(b.name)) err(`bone "${b.name}": not snake_case`);
  if (!CONTRACT.boneNames.fixed.includes(b.name) && !CONTRACT.boneNames.prefixes.some((p) => b.name.startsWith(p)))
    warn(`bone "${b.name}": no contract prefix (${CONTRACT.boneNames.prefixes.join(' ')})`);
  if (b.name.startsWith('fx_') && b.parent !== 'root') err(`bone "${b.name}": fx_* bones must be children of root`);
}
if (bones.length > CONTRACT.budgets.bones) err(`budget: ${bones.length} bones > ${CONTRACT.budgets.bones}`);

const cons = raw.constraints ?? [];
const order = ['ik', 'transform', 'path', 'physics', 'slider'];
let lastRank = -1;
for (const c of cons) {
  const r = order.indexOf(c.type);
  if (r < 0) err(`constraint "${c.name}": unknown type "${c.type}"`);
  if (r < lastRank) err(`constraint "${c.name}" (${c.type}) is out of order: evaluation order must be IK -> transform -> physics`);
  lastRank = Math.max(lastRank, r);
}
const phys = cons.filter((c) => c.type === 'physics');
for (const c of phys) {
  if (c.name !== c.bone) err(`physics "${c.name}": must have the same name as its bone "${c.bone}"`);
  if (!String(c.bone).startsWith('phys_')) err(`physics "${c.name}": bone must be phys_*`);
  const limit = c.limit ?? 5000;
  if (limit < CONTRACT.physics.minLimit) err(`physics "${c.name}": limit ${limit} < ${CONTRACT.physics.minLimit} (drop speed would be clipped)`);
  const strength = c.strength ?? 100;
  const damping = c.damping ?? 0.85;
  const mass = c.mass ?? 1;
  if (strength === CONTRACT.physics.editorDefault.strength && damping === CONTRACT.physics.editorDefault.damping)
    warn(`physics "${c.name}": editor default 100/0.85 (~1.6 Hz, floaty); use f/zeta presets`);
  const w = Math.sqrt(strength / mass);
  const zeta = (-Math.log(damping) * 60) / (2 * w);
  info.push(`physics ${c.name}: ${(w / (2 * Math.PI)).toFixed(2)} Hz, zeta ${zeta.toFixed(2)}, inertia ${c.inertia ?? 0.5}, limit ${limit}`);
  if ((c.fps ?? 60) !== 60) warn(`physics "${c.name}": fps ${c.fps} (contract 60)`);
  if (c.rotate && !(boneByName.get(c.bone)?.length > 0)) err(`physics "${c.name}": rotate physics on a zero-length bone does nothing`);
}
const physBones = bones.filter((b) => b.name.startsWith('phys_')).map((b) => b.name);
for (const b of physBones) if (!phys.some((c) => c.bone === b)) err(`bone "${b}" is phys_* but has no physics constraint`);

const slots = raw.slots ?? [];
if (slots.length > CONTRACT.budgets.slots) err(`budget: ${slots.length} slots > ${CONTRACT.budgets.slots}`);
for (const s of slots) {
  if ((s.blend ?? 'normal') !== 'normal' && !String(s.bone).startsWith('fx_'))
    err(`slot "${s.name}": blend "${s.blend}" only allowed on fx_* slots`);
}
const extRe = /\.(png|jpe?g|webp|ktx2|basis|avif)$/i;
let meshVerts = 0;
const regionPaths = new Map(); // path -> {w,h}
for (const skin of raw.skins ?? []) {
  for (const [slotName, entries] of Object.entries(skin.attachments ?? {})) {
    for (const [name, a] of Object.entries(entries)) {
      const type = a.type ?? 'region';
      const where = `skin ${skin.name}/${slotName}/${name}`;
      if (type === 'clipping') err(`${where}: clipping attachment (contract: none; the board is masked in Pixi)`);
      if (a.sequence) err(`${where}: sequence attachment (not allowed until spine-pixi-v8 >= 4.3.14 ships fix #3162)`);
      const p = a.path ?? a.name ?? name;
      if (extRe.test(p) || extRe.test(name)) err(`${where}: region name "${p}" has a file extension`);
      if (type === 'region' || type === 'mesh' || type === 'linkedmesh') {
        if (!regionPaths.has(p)) regionPaths.set(p, { w: Math.max(1, Math.round(a.width ?? 32)), h: Math.max(1, Math.round(a.height ?? 32)) });
        if (/^sym_/.test(skelName) && !p.startsWith(`${skelName}/`)) warn(`${where}: path "${p}" is not under "${skelName}/"`);
      }
      if (type === 'mesh') {
        const nv = a.uvs.length / 2;
        meshVerts += nv;
        if (!Number.isInteger(nv)) err(`${where}: odd uvs length`);
        if ((a.hull ?? 0) > nv || (a.hull ?? 0) < 3) err(`${where}: hull ${a.hull} invalid for ${nv} vertices`);
        if (a.triangles.some((t) => t < 0 || t >= nv)) err(`${where}: triangle index out of range`);
        if (a.triangles.length % 3) err(`${where}: triangles not a multiple of 3`);
        if (a.vertices.length !== a.uvs.length) {
          // weighted: [n, bone, x, y, w]*
          let i = 0;
          let v = 0;
          while (i < a.vertices.length) {
            const n = a.vertices[i++];
            if (!(n >= 1)) {
              err(`${where}: vertex ${v} has ${n} bones (every weighted vertex needs >= 1)`);
              break;
            }
            let sum = 0;
            for (let k = 0; k < n; k++, i += 4) {
              if (!(a.vertices[i] >= 0 && a.vertices[i] < bones.length)) err(`${where}: vertex ${v} bone index ${a.vertices[i]} out of range`);
              sum += a.vertices[i + 3];
            }
            if (Math.abs(sum - 1) > 2e-3) err(`${where}: vertex ${v} weights sum to ${sum.toFixed(4)}`);
            v++;
          }
          if (v !== nv) err(`${where}: ${v} weighted vertices but ${nv} uvs`);
        }
      }
    }
  }
}
if (meshVerts > CONTRACT.budgets.meshVertices) err(`budget: ${meshVerts} mesh vertices > ${CONTRACT.budgets.meshVertices}`);

// curve arity
const BONE_CH = { rotate: 1, translate: 2, translatex: 1, translatey: 1, scale: 2, scalex: 1, scaley: 1, shear: 2, shearx: 1, sheary: 1 };
const SLOT_CH = { alpha: 1, rgba: 4, rgb: 3, rgba2: 7, rgb2: 6 };
const checkCurves = (keys, ch, where) => {
  if (!Array.isArray(keys)) return;
  keys.forEach((k, i) => {
    if (Array.isArray(k.curve) && k.curve.length !== 4 * ch)
      err(`${where} key ${i}: curve has ${k.curve.length} numbers, expected ${4 * ch} (4 per channel)`);
    if (Array.isArray(k.curve) && i === keys.length - 1) warn(`${where}: curve on the last key is ignored`);
  });
};
let sfxIds = null;
try {
  const ev = fs.readFileSync(path.join(REPO, 'src/game/events.ts'), 'utf8');
  const m = ev.match(/export type SfxId =([\s\S]*?);/);
  if (m) sfxIds = new Set([...m[1].matchAll(/'([a-z0-9_]+)'/g)].map((x) => x[1]));
} catch {
  /* runtime source not present: skip the SfxId check */
}
for (const [aname, a] of Object.entries(raw.animations ?? {})) {
  for (const [b, tls] of Object.entries(a.bones ?? {}))
    for (const [t, keys] of Object.entries(tls)) checkCurves(keys, BONE_CH[t] ?? 1, `${aname}/bones/${b}/${t}`);
  for (const [s, tls] of Object.entries(a.slots ?? {}))
    for (const [t, keys] of Object.entries(tls)) if (t !== 'attachment') checkCurves(keys, SLOT_CH[t] ?? 1, `${aname}/slots/${s}/${t}`);
  for (const [c, tls] of Object.entries(a.physics ?? {}))
    for (const [t, keys] of Object.entries(tls)) if (t !== 'reset') checkCurves(keys, 1, `${aname}/physics/${c}/${t}`);
  for (const [c, keys] of Object.entries(a.ik ?? {})) checkCurves(keys, 2, `${aname}/ik/${c}`);
  for (const [c, keys] of Object.entries(a.transform ?? {})) checkCurves(keys, 6, `${aname}/transform/${c}`);
  for (const [skin, sl] of Object.entries(a.attachments ?? {}))
    for (const [s, atts] of Object.entries(sl))
      for (const [att, tls] of Object.entries(atts)) {
        if (tls.sequence) err(`${aname}: sequence timeline on ${skin}/${s}/${att}`);
        checkCurves(tls.deform, 1, `${aname}/deform/${s}/${att}`);
      }
  for (const e of a.events ?? []) {
    if (e.name === 'sfx' && sfxIds && !sfxIds.has(e.string)) err(`${aname}: sfx event "${e.string}" is not an SfxId (src/game/events.ts)`);
    if (e.name === 'vfx' && !CONTRACT.fxIds.includes(e.string)) err(`${aname}: vfx event "${e.string}" is not an FX id (ANIMATION_CONTRACT 8.2)`);
    if (e.name === 'shake' && !(e.float > 0 && e.float <= 1)) err(`${aname}: shake event float ${e.float} not in (0, 1]`);
  }
}

// --------------------------------------------------------------------------- load in runtime
class FakeTexture extends spine.Texture {
  setFilters() {}
  setWraps() {}
  dispose() {}
}
let atlasText;
if (atlasPath) {
  try {
    atlasText = fs.readFileSync(atlasPath, 'utf8');
  } catch (e) {
    console.error(`validate: cannot read atlas ${atlasPath}: ${e.message}`);
    process.exit(2);
  }
} else {
  // synthetic atlas: one region per attachment path (sizes from the JSON)
  const lines = ['synthetic.png', 'size: 8192,8192', 'filter: Linear,Linear', 'pma: true'];
  for (const [p, { w, h }] of regionPaths) lines.push(p, `bounds: 0,0,${w},${h}`);
  atlasText = `${lines.join('\n')}\n`;
}
let data;
let atlas;
try {
  atlas = new spine.TextureAtlas(atlasText);
  for (const page of atlas.pages) page.setTexture(new FakeTexture({ width: page.width, height: page.height }));
  if (atlasPath) {
    for (const page of atlas.pages) if (!page.pma) warn(`atlas page ${page.name}: pma false (contract: premultiplied alpha)`);
    for (const r of atlas.regions) if (extRe.test(r.name)) err(`atlas region "${r.name}" has a file extension`);
  }
  data = new spine.SkeletonJson(new spine.AtlasAttachmentLoader(atlas)).readSkeletonData(raw);
} catch (e) {
  err(`spine-core 4.3.13 failed to load the skeleton: ${e.message}`);
}

const report = { file: jsonPath, kind, spine: sk.spine, errors, warnings, info, animations: {} };

if (data) {
  // constraint drop check: every JSON constraint must exist after parsing
  if (data.constraints.length !== cons.length) err(`${cons.length} constraints in JSON but ${data.constraints.length} loaded`);
  info.push(`loaded: ${data.bones.length} bones, ${data.slots.length} slots, ${data.constraints.length} constraints, ${meshVerts} mesh vertices, ${data.animations.length} animations`);

  const half = cell / 2;
  const tmp = new Float32Array(4096);
  const isFx = (slot) => slot.bone.data.name.startsWith('fx_');
  const nan = (v) => !Number.isFinite(v);

  const worldBounds = (skeleton, { includeFx = false, minAlpha = 0.02 } = {}) => {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    let bad = false;
    for (const slot of skeleton.slots) {
      const pose = slot.appliedPose;
      const att = pose.attachment;
      if (!att || !slot.bone.active) continue;
      if (!includeFx && isFx(slot)) continue;
      if (pose.color.a * skeleton.color.a < minAlpha) continue;
      let n = 0;
      if (att instanceof spine.RegionAttachment) {
        att.computeWorldVertices(slot, att.getOffsets(pose), tmp, 0, 2);
        n = 8;
      } else if (att instanceof spine.MeshAttachment) {
        n = att.worldVerticesLength;
        att.computeWorldVertices(skeleton, slot, 0, n, tmp, 0, 2);
      } else continue;
      for (let i = 0; i < n; i += 2) {
        const x = tmp[i];
        const y = tmp[i + 1];
        if (nan(x) || nan(y)) bad = true;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    return { x0, y0, x1, y1, bad };
  };

  const poseSnapshot = (skeleton) => {
    const out = [];
    for (const b of skeleton.bones) {
      const p = b.appliedPose;
      out.push(p.worldX, p.worldY, p.a * 100, p.b * 100, p.c * 100, p.d * 100);
    }
    const atts = [];
    for (const s of skeleton.slots) {
      const p = s.appliedPose;
      out.push(p.color.r * 255, p.color.g * 255, p.color.b * 255, p.color.a * 255);
      atts.push(p.attachment ? p.attachment.name : null);
      for (const d of p.deform ?? []) out.push(d);
    }
    return { v: out, atts };
  };
  const poseDiff = (a, b) => {
    if (a.atts.join('|') !== b.atts.join('|')) return { d: Infinity, why: `attachments ${a.atts.join(',')} vs ${b.atts.join(',')}` };
    let d = 0;
    let at = -1;
    for (let i = 0; i < a.v.length; i++) {
      const x = Math.abs(a.v[i] - b.v[i]);
      if (x > d) {
        d = x;
        at = i;
      }
    }
    return { d, why: `value #${at}` };
  };
  /** Pose of `anim` at time t sampled from the setup pose, loop=false, no physics. */
  const sample = (anim, t) => {
    const s = new spine.Skeleton(data);
    s.setupPose();
    if (anim) anim.apply(s, t, t, false, null, 1, spine.MixFrom.setup, false, false, false);
    s.updateWorldTransform(spine.Physics.none);
    return poseSnapshot(s);
  };
  const setupSnap = sample(null, 0);
  const TOL = 0.02; // px / 0.01 matrix units / colour steps

  const required = Object.entries(CONTRACT.animations)
    .filter(([, r]) => r.required.includes(kind))
    .map(([n]) => n);
  for (const n of required) if (!data.findAnimation(n)) err(`missing required animation "${n}" (kind ${kind})`);
  for (const a of data.animations) if (!(a.name in CONTRACT.animations) && !Object.keys(CONTRACT.runtimeAliases.animations).includes(a.name)) {
    if (!/^(reveal|expand|sticky_lock|upgrade)$/.test(a.name)) warn(`animation "${a.name}" is not in the contract`);
  }

  for (const anim of data.animations) {
    const rule = CONTRACT.animations[anim.name] ?? CONTRACT.animations[CONTRACT.runtimeAliases.animations[anim.name]] ?? { loop: false, frames: [0, 1e9], events: [] };
    const frames = Math.round(anim.duration * FPS * 1000) / 1000;
    const rep = { frames, loop: rule.loop, events: [], maxExtent: null };
    report.animations[anim.name] = rep;
    const [fmin, fmax] = rule.frames;
    if (frames < fmin - 1e-3 || frames > fmax + 1e-3) err(`${anim.name}: ${frames} frames outside the contract window ${fmin}-${fmax}`);
    if (Math.abs(frames - Math.round(frames)) > 0.02) warn(`${anim.name}: duration ${anim.duration}s is not a whole number of ${FPS} fps frames`);
    if (anim.name === 'win' && anim.duration * 1000 > CONTRACT.timing.winAnimDurationMs + 1)
      err(`win: ${Math.round(anim.duration * 1000)} ms > TIMING.win.winAnimDuration ${CONTRACT.timing.winAnimDurationMs} ms`);

    // step with physics like the runtime (Spine.update: state.update, skeleton.update, apply, UWT(update)).
    // `land` runs once per kick sign (the runtime sign is still being settled, ANIMATION_CONTRACT 10.4).
    const kicks = anim.name === 'land' && kick ? [kick, -kick] : [0];
    let fired = [];
    let ext = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    let nanAt = -1;
    for (const k of kicks) {
    const skel = new spine.Skeleton(data);
    skel.setupPose();
    skel.updateWorldTransform(spine.Physics.reset);
    const state = new spine.AnimationState(new spine.AnimationStateData(data));
    fired = [];
    state.addListener({ event: (_e, ev) => fired.push({ name: ev.data.name, frame: Math.round(ev.time * FPS * 100) / 100, string: ev.stringValue }) });
    state.setAnimation(0, anim.name, rule.loop);
    const dt = 1 / 60;
    const steps = Math.ceil((anim.duration + 2 / FPS) / dt) + 1;
    for (let i = 0; i <= steps; i++) {
      const d = i === 0 ? 0 : dt;
      state.update(d);
      skel.update(d);
      state.apply(skel);
      if (i === 1 && k) skel.physicsTranslate(0, -k); // runtime y-down physicsTranslate(0, k) == (0, -k) in this y-up skeleton
      skel.updateWorldTransform(spine.Physics.update);
      let bad = false;
      for (const b of skel.bones) {
        const p = b.appliedPose;
        if (nan(p.worldX) || nan(p.worldY) || nan(p.a) || nan(p.b) || nan(p.c) || nan(p.d)) bad = true;
      }
      for (const s of skel.slots) {
        const c = s.appliedPose.color;
        if (nan(c.r) || nan(c.g) || nan(c.b) || nan(c.a)) bad = true;
      }
      const wb = worldBounds(skel);
      if (wb.bad) bad = true;
      if (bad && nanAt < 0) nanAt = i;
      if (i * dt <= anim.duration + 1e-6) {
        ext = { x0: Math.min(ext.x0, wb.x0), y0: Math.min(ext.y0, wb.y0), x1: Math.max(ext.x1, wb.x1), y1: Math.max(ext.y1, wb.y1) };
      }
    }
    }
    if (nanAt >= 0) err(`${anim.name}: NaN in the pose at step ${nanAt} (60 Hz)`);
    rep.events = fired;
    rep.maxExtent = Object.fromEntries(Object.entries(ext).map(([k, v]) => [k, Math.round(v * 10) / 10]));
    for (const ev of rule.events) if (!fired.some((f) => f.name === ev)) err(`${anim.name}: required event "${ev}" did not fire (stepped 2 frames past the end)`);
    for (const [ev, spec] of Object.entries(rule.eventFrames ?? {})) {
      const f = fired.find((x) => x.name === ev);
      if (!f) continue;
      if (spec.target && (f.frame < spec.target[0] - 1e-3 || f.frame > spec.target[1] + 1e-3)) {
        const hard = spec.hard && (f.frame < spec.hard[0] - 1e-3 || f.frame > spec.hard[1] + 1e-3);
        (hard ? err : warn)(`${anim.name}: ${ev} on frame ${f.frame}, target ${spec.target.join('-')}`);
      }
      if (spec.fromEnd !== undefined && frames - f.frame > spec.fromEnd + 1e-3) warn(`${anim.name}: ${ev} on frame ${f.frame}, more than ${spec.fromEnd} frames before the end (${frames})`);
    }
    if (rule.inCell) {
      const over = Math.max(ext.x1 - half, -half - ext.x0, ext.y1 - half, -half - ext.y0);
      if (over > 1) err(`${anim.name}: leaves the ${cell}x${cell} cell by ${over.toFixed(1)} units (extent x ${ext.x0.toFixed(1)}..${ext.x1.toFixed(1)}, y ${ext.y0.toFixed(1)}..${ext.y1.toFixed(1)}, physics kick +-${kick})`);
    }

    // seams / end poses (keyed pose only: physics is not part of the animation)
    const first = sample(anim, 0);
    const last = sample(anim, anim.duration);
    if (rule.loop && anim.duration > 0) {
      const d = poseDiff(first, last);
      rep.seam = Math.round(d.d * 1000) / 1000;
      if (d.d > TOL) err(`${anim.name}: loop seam differs by ${d.d.toFixed(3)} (${d.why}); first and last key must match`);
    }
    if (rule.endsAtSetup) {
      const d = poseDiff(last, setupSnap);
      if (d.d > TOL) err(`${anim.name}: does not end on the setup pose (diff ${d.d.toFixed(3)}, ${d.why})`);
    }
    if (rule.endsAt && data.findAnimation(rule.endsAt)) {
      const d = poseDiff(last, sample(data.findAnimation(rule.endsAt), 0));
      if (d.d > TOL) err(`${anim.name}: last pose != first pose of ${rule.endsAt} (diff ${d.d.toFixed(3)}, ${d.why}); the mix must be able to be 0`);
    }
    if (rule.endsAlpha0) {
      const s = new spine.Skeleton(data);
      s.setupPose();
      anim.apply(s, anim.duration, anim.duration, false, null, 1, spine.MixFrom.setup, false, false, false);
      s.updateWorldTransform(spine.Physics.none);
      const visible = s.slots.filter((sl) => sl.appliedPose.attachment && sl.appliedPose.color.a * s.color.a > 0.01).map((sl) => sl.data.name);
      if (visible.length) err(`${anim.name}: must end at alpha 0, still visible: ${visible.join(', ')}`);
    }
  }
}

// -------------------------------------------------------------------------------- report
const ok = errors.length === 0 && (!strict || warnings.length === 0);
report.ok = ok;
if (reportPath) {
  fs.mkdirSync(path.dirname(path.resolve(reportPath)), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}
if (!quiet || !ok) {
  const lines = [`validate ${jsonPath}  (kind ${kind}, spine ${sk.spine}, cell ${cell}, kick ${kick})`];
  for (const i of info) lines.push(`  info  ${i}`);
  for (const [n, r] of Object.entries(report.animations)) {
    const ev = r.events.map((e) => `${e.name}@${e.frame}${e.string ? `(${e.string})` : ''}`).join(' ');
    const e = r.maxExtent;
    lines.push(`  anim  ${n.padEnd(19)} ${String(r.frames).padStart(5)} f ${r.loop ? 'loop' : '    '}${r.seam !== undefined ? ` seam ${r.seam}` : ''}  x ${e.x0}..${e.x1} y ${e.y0}..${e.y1}${ev ? `  events ${ev}` : ''}`);
  }
  for (const w of warnings) lines.push(`  WARN  ${w}`);
  for (const e of errors) lines.push(`  FAIL  ${e}`);
  lines.push(ok ? `PASS (${warnings.length} warning${warnings.length === 1 ? '' : 's'})` : `FAIL (${errors.length} error${errors.length === 1 ? '' : 's'}${strict && warnings.length ? `, ${warnings.length} warnings in --strict` : ''})`);
  (ok ? console.log : console.error)(lines.join('\n'));
}
process.exit(ok ? 0 : 1);
