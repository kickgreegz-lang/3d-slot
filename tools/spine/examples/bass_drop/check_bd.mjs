#!/usr/bin/env node
/**
 * Bass Drop rig checks that tools/spine/validate.mjs does not make yet (CR-8 is not in tools/spine/contract.json).
 * The rules are read from docs/games/bass-drop/ANIMATION_SET.md itself, so there is no second copy of the contract:
 *   - section 12 JSON block: the CR-8 animation rules (windows, loop, required events, event frames, endsAt,
 *     endsAtSetup, the drop_impact squash gate, cellOverflow), the new kinds' budgets, requiredEmptySlots;
 *   - section 2.0 / 2.6 tables: the exact per-symbol clip lengths and event frames (H1..H4, W);
 *   - section 3 table: the Groove Meter clip list (track, frames, loop, events, the pose it must end on);
 *   - section 10 table: budgets per rig.
 * Overlays (`overlay` in the rules, e.g. bass_react on track 1) are played additively, so their first and last
 * pose must be the setup pose (a non-zero delta would stick).
 *
 *   node tools/spine/examples/bass_drop/check_bd.mjs <skeleton.json> [--kind auto|wild|high|ui] [--cell 300]
 *        [--report out.json] [--strict] [--quiet]
 *
 * Runs on the official runtime (@esotericsoftware/spine-core 4.3.13), stepping with physics at 60 Hz like
 * validate.mjs. Exit 0 = pass, 1 = failure (with --strict warnings fail too), 2 = usage.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as spine from '@esotericsoftware/spine-core';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../../..');
const DOC = path.join(REPO, 'docs/games/bass-drop/ANIMATION_SET.md');
const FPS = 30;
const argv = process.argv.slice(2);
const opt = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const flag = (n) => argv.includes(`--${n}`);
if (!argv.length || flag('help')) {
  const src = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8');
  console.log(src.slice(src.indexOf('/**') + 3, src.indexOf('*/')).replace(/^ \* ?/gm, '').trim());
  process.exit(argv.length ? 0 : 2);
}
const file = argv.find((a, i) => !a.startsWith('--') && !(i > 0 && ['kind', 'cell', 'report'].includes(argv[i - 1].slice(2))));
const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
const skel = path.basename(file).replace(/\.json$/, '');
let kind = opt('kind', 'auto');
if (kind === 'auto') kind = skel === 'sym_W' ? 'wild' : /^ui_/.test(skel) ? 'ui' : 'high';
const cell = Number(opt('cell', 300));
const errors = [];
const warnings = [];
const info = [];
const err = (m) => errors.push(m);
const warn = (m) => warnings.push(m);

// ------------------------------------------------------------------------- rules from ANIMATION_SET.md
const md = fs.readFileSync(DOC, 'utf8');
const sec12 = md.slice(md.indexOf('## 12. Contract deltas'));
const cr8 = JSON.parse(sec12.slice(sec12.indexOf('```json') + 7, sec12.indexOf('```', sec12.indexOf('```json') + 7)));
const tableRows = (start, end) => {
  const s = md.indexOf(start);
  const e = end ? md.indexOf(end, s + start.length) : md.length;
  return md.slice(s, e).split('\n').filter((l) => /^\|/.test(l) && !/^\|\s*-/.test(l)).map((l) => l.split('|').slice(1, -1).map((c) => c.trim()));
};
const clean = (c) => c.replace(/\*\*/g, '').replace(/`/g, '').trim();
const evList = (c) => {
  // "`drop_release` f2" | "`win_peak` f8" | "`pump_hit` f0, f18, f36" | "`explode_burst` f2, `explode_done` f13" | "—"
  const out = [];
  let cur = null;
  for (const tok of c.replace(/\*\*/g, '').split(/[,\s]+/)) {
    const n = tok.match(/^`([a-z_]+)`$/);
    const f = tok.match(/^f(\d+)$/);
    if (n) cur = n[1];
    else if (f && cur) out.push({ name: cur, frame: Number(f[1]) });
  }
  return out;
};
// 2.0: per-symbol frames table
const perSymbol = {};
{
  const rows = tableRows('| Anim | H1 | H2 | H3 | H4 |', '### 2.1');
  const head = rows[0].map(clean);
  for (const r of rows.slice(1)) {
    const anim = clean(r[0]).split(' ')[0];
    head.slice(1, 5).forEach((sym, i) => {
      const f = Number(clean(r[1 + i]).split(' ')[0]);
      (perSymbol[sym] ??= {})[anim] = { frames: f, events: evList(r[6] ?? '') };
    });
  }
}
// 2.6: W animations table
{
  const rows = tableRows('| Anim | f | Loop | Events | Motion |', 'New mixes');
  for (const r of rows.slice(1)) {
    const anim = clean(r[0]);
    (perSymbol.W ??= {})[anim] = { frames: Number(clean(r[1])), loop: /yes/.test(r[2]), events: evList(r[3]) };
  }
}
// 3: meter clips
const meter = {};
{
  const rows = tableRows('| Anim | Track | f | Loop | Events | Notes |', 'Runtime timeScale');
  for (const r of rows.slice(1)) {
    const name = clean(r[0]);
    const notes = r[5];
    const m = notes.match(/[Ee]nds? (?:on|in) (?:the )?`([a-z_]+)` pose|last frame = `([a-z_]+)` f0 pose/);
    meter[name] = { track: Number(clean(r[1])), frames: Number(clean(r[2])), loop: /yes/.test(r[3]), events: evList(r[4]), endsAt: m ? m[1] ?? m[2] : null, optional: /P2/.test(notes) };
  }
}
// 10: budgets
const budgets = {};
for (const r of tableRows('| Rig (kind) | Bones | Slots | Mesh verts | Physics | Atlas |', '**Texture pages**').slice(1)) {
  const n = (c) => Number(clean(c).replace(/[≤,\s]/g, '').split('/')[0]);
  const ids = [...r[0].matchAll(/`([a-zA-Z_.0-9]+)`/g)].map((x) => x[1]);
  for (const id of ids) budgets[id] = { bones: n(r[1]), slots: n(r[2]), meshVertices: n(r[3]), physics: n(r[4]) };
}
const symId = skel.replace(/^sym_/, '');
const budget = budgets[skel] ?? (kind === 'high' ? budgets['sym_H1..H4'] : kind === 'wild' ? budgets.sym_W : cr8.kinds[kind]?.budgets);
info.push(`rules: ANIMATION_SET 12 (${Object.keys(cr8.animations).length} CR-8 animations), ${kind === 'ui' ? `3 (${Object.keys(meter).length} meter clips)` : `2.0/2.6 (${Object.keys(perSymbol[symId] ?? {}).length} clips for ${symId})`}, 10 budgets ${JSON.stringify(budget)}`);

// ------------------------------------------------------------------------- static
const bones = raw.bones ?? [];
const slots = raw.slots ?? [];
let meshVerts = 0;
for (const skin of raw.skins ?? []) for (const ent of Object.values(skin.attachments ?? {})) for (const a of Object.values(ent)) if (a.type === 'mesh') meshVerts += a.uvs.length / 2;
const nPhys = (raw.constraints ?? []).filter((c) => c.type === 'physics').length;
if (budget) {
  for (const [k, v] of [['bones', bones.length], ['slots', slots.length], ['meshVertices', meshVerts], ['physics', nPhys]])
    if (budget[k] !== undefined && v > budget[k]) err(`budget: ${k} ${v} > ${budget[k]} (ANIMATION_SET 10)`);
  info.push(`budget use: bones ${bones.length}/${budget.bones}, slots ${slots.length}/${budget.slots}, mesh vertices ${meshVerts}/${budget.meshVertices}, physics ${nPhys}/${budget.physics}`);
}
const emptyReq = cr8.kinds[kind]?.requiredEmptySlots ?? [];
if (kind === 'ui') emptyReq.push(...['txt_count', 'led_arc', 'fx_blast'].filter((n) => !emptyReq.includes(n)));
for (const n of emptyReq) {
  const s = slots.find((x) => x.name === n);
  if (!s) err(`required empty slot "${n}" missing`);
  else {
    if (s.attachment) err(`slot "${n}" must be empty at setup (runtime ${n.startsWith('txt_') ? 'BitmapText' : 'display'} via addSlotObject), has "${s.attachment}"`);
    for (const skin of raw.skins ?? []) if (skin.attachments?.[n]) err(`slot "${n}" must carry no attachment (skin ${skin.name})`);
  }
}
if (kind === 'wild') for (const sk of ['default', 'mult', 'sticky']) if (!(raw.skins ?? []).some((s) => s.name === sk)) err(`skin "${sk}" missing (ANIMATION_SET 2.6)`);
if (kind === 'ui') for (const sk of ['base', 'jukejam', 'megamix', 'bare']) if (!(raw.skins ?? []).some((s) => s.name === sk)) err(`skin "${sk}" missing (ANIMATION_SET 3)`);

// ------------------------------------------------------------------------- runtime
class FakeTexture extends spine.Texture {
  setFilters() {}
  setWraps() {}
  dispose() {}
}
const regions = new Map();
for (const skin of raw.skins ?? []) for (const ent of Object.values(skin.attachments ?? {})) for (const [n, a] of Object.entries(ent)) {
  if (['region', 'mesh', 'linkedmesh', undefined].includes(a.type)) regions.set(a.path ?? n, { w: Math.max(1, Math.round(a.width ?? 32)), h: Math.max(1, Math.round(a.height ?? 32)) });
}
const atlasText = ['synthetic.png', 'size: 8192,8192', 'filter: Linear,Linear', 'pma: true', ...[...regions].flatMap(([p, { w, h }]) => [p, `bounds: 0,0,${w},${h}`])].join('\n') + '\n';
const atlas = new spine.TextureAtlas(atlasText);
for (const page of atlas.pages) page.setTexture(new FakeTexture({ width: page.width, height: page.height }));
const data = new spine.SkeletonJson(new spine.AtlasAttachmentLoader(atlas)).readSkeletonData(raw);
const tmp = new Float32Array(4096);
const isFx = (slot) => slot.bone.data.name.startsWith('fx_');
const worldBounds = (sk) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const slot of sk.slots) {
    const pose = slot.appliedPose;
    const att = pose.attachment;
    if (!att || isFx(slot) || pose.color.a < 0.02) continue;
    let n = 0;
    if (att instanceof spine.RegionAttachment) {
      att.computeWorldVertices(slot, att.getOffsets(pose), tmp, 0, 2);
      n = 8;
    } else if (att instanceof spine.MeshAttachment) {
      n = att.worldVerticesLength;
      att.computeWorldVertices(sk, slot, 0, n, tmp, 0, 2);
    } else continue;
    for (let i = 0; i < n; i += 2) {
      x0 = Math.min(x0, tmp[i]);
      x1 = Math.max(x1, tmp[i]);
      y0 = Math.min(y0, tmp[i + 1]);
      y1 = Math.max(y1, tmp[i + 1]);
    }
  }
  return { x0, y0, x1, y1 };
};
const snap = (s) => {
  const v = [];
  for (const b of s.bones) {
    const p = b.appliedPose;
    v.push(p.worldX, p.worldY, p.a * 100, p.b * 100, p.c * 100, p.d * 100);
  }
  const atts = [];
  for (const sl of s.slots) {
    const p = sl.appliedPose;
    v.push(p.color.r * 255, p.color.g * 255, p.color.b * 255, p.color.a * 255);
    atts.push(p.attachment ? p.attachment.name : null);
  }
  return { v, atts };
};
const diff = (a, b) => {
  if (a.atts.join('|') !== b.atts.join('|')) {
    const i = a.atts.findIndex((x, k) => x !== b.atts[k]);
    return { d: Infinity, why: `slot ${data.slots[i].name}: ${a.atts[i]} vs ${b.atts[i]}` };
  }
  let d = 0, at = -1;
  for (let i = 0; i < a.v.length; i++) if (Math.abs(a.v[i] - b.v[i]) > d) [d, at] = [Math.abs(a.v[i] - b.v[i]), i];
  const nb = data.bones.length * 6;
  if (at < 0) return { d, why: '' };
  return { d, why: at < nb ? `bone ${data.bones[Math.floor(at / 6)].name}` : `slot ${data.slots[Math.floor((at - nb) / 4)]?.name} colour` };
};
const sample = (anim, t, skin) => {
  const s = new spine.Skeleton(data);
  if (skin) s.setSkin(skin);
  s.setupPose();
  if (anim) anim.apply(s, t, t, false, null, 1, spine.MixFrom.setup, false, false, false);
  s.updateWorldTransform(spine.Physics.none);
  return s;
};
const TOL = 0.02;
const wildSkin = kind === 'wild' ? 'sticky' : kind === 'ui' ? 'base' : null;
const setupSnap = snap(sample(null, 0, wildSkin));
const rest = worldBounds(sample(null, 0, null));

// which rules apply
const rules = {};
if (kind === 'ui') {
  for (const [n, r] of Object.entries(meter)) rules[n] = { loop: r.loop, frames: [r.frames, r.frames], events: r.events.map((e) => e.name), exact: r.events, endsAt: r.endsAt, overlay: r.track > 0 ? r.track : undefined, optional: r.optional };
} else {
  for (const [n, r] of Object.entries(cr8.animations)) {
    const req = r.required.includes(kind) || (kind === 'wild' && r.required.includes('special'));
    rules[n] = { ...r, optional: !req };
  }
  for (const [n, r] of Object.entries(perSymbol[symId] ?? {})) {
    rules[n] = { ...(rules[n] ?? { loop: r.loop ?? /loop|idle|blur/.test(n), events: r.events.map((e) => e.name), optional: false }), exactFrames: r.frames, exact: r.events };
    if (rules[n].optional === undefined) rules[n].optional = false;
  }
  if (rules.bass_react) rules.bass_react.zeroEnds = true;
}
const report = { file, kind, errors, warnings, info, clips: {} };
for (const [name, r] of Object.entries(rules)) {
  const anim = data.findAnimation(name);
  if (!anim) {
    (r.optional ? (m) => info.push(m) : err)(`${r.optional ? 'optional' : 'required'} clip "${name}" missing`);
    continue;
  }
  const frames = Math.round(anim.duration * FPS * 1000) / 1000;
  const rep = { frames, loop: r.loop, events: [] };
  report.clips[name] = rep;
  if (r.frames && (frames < r.frames[0] - 1e-3 || frames > r.frames[1] + 1e-3)) err(`${name}: ${frames} frames outside ${r.frames.join('-')}`);
  if (r.exactFrames !== undefined && Number.isFinite(r.exactFrames) && Math.abs(frames - r.exactFrames) > 1e-3) {
    // blur may be 1 or 2 frames long (the contract window), everything else is exact
    (name === 'blur' ? warn : err)(`${name}: ${frames} f, ANIMATION_SET table says ${r.exactFrames} f`);
  }
  // events (stepped at 60 Hz, 2 frames past the end)
  const sk = new spine.Skeleton(data);
  if (wildSkin) sk.setSkin(wildSkin);
  sk.setupPose();
  sk.updateWorldTransform(spine.Physics.reset);
  const st = new spine.AnimationState(new spine.AnimationStateData(data));
  const fired = [];
  st.addListener({ event: (_e, ev) => fired.push({ name: ev.data.name, frame: Math.round(ev.time * FPS * 100) / 100 }) });
  st.setAnimation(0, name, false);
  let ext = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  let nan = false;
  for (let i = 0; i <= Math.ceil((anim.duration + 2 / FPS) * 60) + 1; i++) {
    const d = i === 0 ? 0 : 1 / 60;
    st.update(d);
    sk.update(d);
    st.apply(sk);
    sk.updateWorldTransform(spine.Physics.update);
    const wb = worldBounds(sk);
    if (![wb.x0, wb.y0, wb.x1, wb.y1].every(Number.isFinite) && sk.slots.some((s) => s.appliedPose.attachment)) nan = nan || Object.values(wb).some(Number.isNaN);
    if (i / 60 <= anim.duration + 1e-6) ext = { x0: Math.min(ext.x0, wb.x0), y0: Math.min(ext.y0, wb.y0), x1: Math.max(ext.x1, wb.x1), y1: Math.max(ext.y1, wb.y1) };
  }
  if (nan) err(`${name}: NaN in the pose`);
  rep.events = fired;
  rep.extent = Object.fromEntries(Object.entries(ext).map(([k, v]) => [k, Math.round(v * 10) / 10]));
  for (const ev of r.events ?? []) if (!fired.some((f) => f.name === ev)) err(`${name}: required event "${ev}" did not fire`);
  for (const ex of r.exact ?? []) {
    const f = fired.filter((x) => x.name === ex.name);
    if (f.length && !f.some((x) => Math.abs(x.frame - ex.frame) <= 1e-3)) {
      // ANIMATION_SET tables name exact frames; the contract's fromEnd rule for explode_done tolerates the last frames
      const soft = ex.name === 'explode_done' && Math.abs(f[0].frame - frames) <= 2;
      (soft ? warn : err)(`${name}: ${ex.name} on frame ${f.map((x) => x.frame).join(',')}, ANIMATION_SET says f${ex.frame}`);
    }
  }
  for (const [ev, spec] of Object.entries(r.eventFrames ?? {})) {
    const f = fired.find((x) => x.name === ev);
    if (f && spec.target && (f.frame < spec.target[0] - 1e-3 || f.frame > spec.target[1] + 1e-3)) {
      const hard = spec.hard && (f.frame < spec.hard[0] - 1e-3 || f.frame > spec.hard[1] + 1e-3);
      (hard ? err : warn)(`${name}: ${ev} on frame ${f.frame}, target ${spec.target.join('-')}`);
    }
  }
  const first = snap(sample(anim, 0, wildSkin));
  const last = snap(sample(anim, anim.duration, wildSkin));
  if (r.loop && anim.duration > 0) {
    const d = diff(first, last);
    rep.seam = Math.round(d.d * 1000) / 1000;
    if (d.d > TOL) err(`${name}: loop seam differs by ${d.d.toFixed(3)} (${d.why})`);
  }
  if (r.endsAtSetup || r.zeroEnds) {
    const d = diff(last, setupSnap);
    if (d.d > TOL) err(`${name}: does not end on the setup pose (${d.d.toFixed(3)}, ${d.why})`);
  }
  if (r.zeroEnds) {
    const d = diff(first, setupSnap);
    if (d.d > TOL) err(`${name}: additive overlay must start on the setup pose (${d.d.toFixed(3)}, ${d.why})`);
  }
  if (r.endsAt) {
    const to = data.findAnimation(r.endsAt);
    if (!to) warn(`${name}: ends on "${r.endsAt}", which is missing`);
    else {
      const d = diff(last, snap(sample(to, 0, wildSkin)));
      rep.endsAt = Math.round(d.d * 1000) / 1000;
      if (d.d > TOL) err(`${name}: last pose != first pose of ${r.endsAt} (${d.d.toFixed(3)}, ${d.why}); the mix must be able to be 0`);
    }
  }
  if (r.squash) {
    const q = r.squash;
    let peak = { sy: Infinity, sx: 1, frame: 0 };
    for (let i = 0; i <= Math.ceil(anim.duration * 60); i++) {
      const t = Math.min(anim.duration, i / 60);
      const p = sample(anim, t, null).findBone(q.bone).pose;
      if (p.scaleY < peak.sy) peak = { sy: p.scaleY, sx: p.scaleX, frame: Math.round(t * FPS * 100) / 100 };
    }
    rep.squash = peak;
    const out = (rg) => peak.sy < rg[0] - 1e-3 || peak.sy > rg[1] + 1e-3;
    if (out(q.gate)) err(`${name}: peak squash sy ${peak.sy.toFixed(3)} outside the gate ${q.gate.join('-')}`);
    else if (out(q.sy)) warn(`${name}: peak squash sy ${peak.sy.toFixed(3)} outside ${q.sy.join('-')}`);
    const vol = 1 / Math.sqrt(peak.sy);
    if (Math.abs(peak.sx - vol) > q.volumeTol) warn(`${name}: squash sx ${peak.sx.toFixed(3)} != 1/sqrt(sy) ${vol.toFixed(3)}`);
  }
  if (r.cellOverflow !== undefined) {
    const half = cell / 2;
    const over = Math.max(ext.x1 - half, -half - ext.x0, ext.y1 - half, -half - ext.y0);
    rep.overflow = Math.round((over / cell) * 1000) / 10;
    if (over > r.cellOverflow * cell + 1) err(`${name}: spills ${over.toFixed(1)} units outside the ${cell} cell (> ${r.cellOverflow * 100}%)`);
  }
}
if (kind !== 'ui') {
  for (const a of data.animations) if (!rules[a.name] && !['anticipation', 'anticipation_intro', 'anticipation_out', 'blink', 'dim'].includes(a.name)) info.push(`clip ${a.name}: no Bass Drop rule (contract-only, see validate.mjs)`);
} else for (const a of data.animations) if (!rules[a.name]) warn(`clip "${a.name}" is not in ANIMATION_SET 3`);
info.push(`rest bounds x ${rest.x0.toFixed(1)}..${rest.x1.toFixed(1)} y ${rest.y0.toFixed(1)}..${rest.y1.toFixed(1)}`);

const ok = !errors.length && (!flag('strict') || !warnings.length);
report.ok = ok;
const rp = opt('report', null);
if (rp) {
  fs.mkdirSync(path.dirname(path.resolve(rp)), { recursive: true });
  fs.writeFileSync(rp, `${JSON.stringify(report, null, 1)}\n`);
}
if (!flag('quiet') || !ok) {
  const L = [`check_bd ${file}  (kind ${kind}, cell ${cell})`];
  for (const i of info) L.push(`  info  ${i}`);
  for (const [n, r] of Object.entries(report.clips))
    L.push(`  clip  ${n.padEnd(17)} ${String(r.frames).padStart(4)} f ${r.loop ? 'loop' : '    '}${r.seam !== undefined ? ` seam ${r.seam}` : ''}${r.endsAt !== undefined ? ` end~next ${r.endsAt}` : ''}${r.squash ? ` squash sy ${r.squash.sy.toFixed(3)} sx ${r.squash.sx.toFixed(3)} @${r.squash.frame}` : ''}${r.overflow !== undefined ? ` spill ${r.overflow}%` : ''}  ${r.events.map((e) => `${e.name}@${e.frame}`).join(' ')}`);
  for (const w of warnings) L.push(`  WARN  ${w}`);
  for (const e of errors) L.push(`  FAIL  ${e}`);
  L.push(ok ? `PASS (${warnings.length} warning${warnings.length === 1 ? '' : 's'})` : `FAIL (${errors.length} error${errors.length === 1 ? '' : 's'})`);
  (ok ? console.log : console.error)(L.join('\n'));
}
process.exit(ok ? 0 : 1);
