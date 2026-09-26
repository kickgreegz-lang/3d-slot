#!/usr/bin/env node
/**
 * Procedural PLACEHOLDER parts for the two Bass Drop mascots (chr_gumbo, chr_croak): cel-shaded
 * vector art (ART_BIBLE palette, pure-black 8-unit outlines, top-left key light, 1 base + 2 hard
 * shadow tones + 1 specular), rendered with @resvg/resvg-js and written the way the split stage
 * must deliver real Higgsfield part sheets (tools/spine/README.md, "Character parts contract"):
 *   <char>/images/chr_<id>/<slot>.png            single-attachment slot
 *   <char>/images/chr_<id>/<slot>/<variant>.png  attachment variants (eye states, mouths, hands)
 *   <char>/parts.json                            canvas, anchor, landmarks, parts (bbox, z, bone, joint, tip)
 * Every piece is complete (overlap caps where it joins its parent), trimmed to its alpha + 4 px,
 * positioned on the character canvas at 2x the landscape design rect (Gumbo 868x992, Croak 720x1260,
 * root = feet point at the bottom centre).
 *
 *   node tools/spine/examples/character_demo/make_parts.mjs [--out <dir>] [--only gumbo|croak] [--help]
 *
 * Deterministic: fixed geometry, integer crop boxes, resvg rendering (no fonts, no randomness).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
if (argv.includes('--help') || argv.includes('-h')) {
  const src = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8');
  console.log(src.slice(src.indexOf('/**') + 3, src.indexOf('*/')).replace(/^ \* ?/gm, '').trim());
  process.exit(0);
}
const outRoot = path.resolve(argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : HERE);
const only = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : null;
const PAD = 4;
const OUT = 8; // character outline at 2x (ANIMATION_SET 5: 6-8 units)
const INK = '#000000';
const SPEC = '#FFFFFF';

// ------------------------------------------------------------------------------ geometry helpers
const r1 = (v) => Math.round(v * 10) / 10;
const P = (arr) => arr.map(([x, y]) => `${r1(x)},${r1(y)}`);
const poly = (arr) => `M ${P(arr).join(' L ')} Z`;

/** Tapered capsule (round overlap caps) from p0 (radius a) to p1 (radius b). */
function capsule(p0, p1, a, b, n = 18) {
  const dx = p1[0] - p0[0];
  const dy = p1[1] - p0[1];
  const L = Math.hypot(dx, dy);
  const ux = dx / L;
  const uy = dy / L;
  const ang = Math.atan2(uy, ux);
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = ang - Math.PI / 2 + (Math.PI * i) / n;
    pts.push([p1[0] + b * Math.cos(t), p1[1] + b * Math.sin(t)]);
  }
  for (let i = 0; i <= n; i++) {
    const t = ang + Math.PI / 2 + (Math.PI * i) / n;
    pts.push([p0[0] + a * Math.cos(t), p0[1] + a * Math.sin(t)]);
  }
  return poly(pts);
}

const bez = (p0, p1, p2, p3, t) => {
  const u = 1 - t;
  return [
    u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
    u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
  ];
};

/** Tapered tube along a cubic bezier (tails, cables), width w0 -> w1, round caps. */
function tube(c, w0, w1, n = 40) {
  const left = [];
  const right = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const p = bez(...c, t);
    const q = bez(...c, Math.min(1, t + 0.01));
    const o = bez(...c, Math.max(0, t - 0.01));
    const dx = q[0] - o[0];
    const dy = q[1] - o[1];
    const L = Math.hypot(dx, dy);
    const w = (w0 + (w1 - w0) * t) / 2;
    left.push([p[0] - (dy / L) * w, p[1] + (dx / L) * w]);
    right.push([p[0] + (dy / L) * w, p[1] - (dx / L) * w]);
  }
  const end = bez(...c, 1);
  const cap = [];
  const a = Math.atan2(right[n][1] - end[1], right[n][0] - end[0]);
  for (let i = 1; i < 10; i++) cap.push([end[0] + (w1 / 2) * Math.cos(a - (Math.PI * i) / 10), end[1] + (w1 / 2) * Math.sin(a - (Math.PI * i) / 10)]);
  const st = bez(...c, 0);
  const cap0 = [];
  const a0 = Math.atan2(left[0][1] - st[1], left[0][0] - st[0]);
  for (let i = 1; i < 10; i++) cap0.push([st[0] + (w0 / 2) * Math.cos(a0 - (Math.PI * i) / 10), st[1] + (w0 / 2) * Math.sin(a0 - (Math.PI * i) / 10)]);
  return poly([...right, ...cap, ...left.reverse(), ...cap0]);
}

const ell = (cx, cy, rx, ry) => `M ${r1(cx - rx)},${r1(cy)} A ${rx} ${ry} 0 1 0 ${r1(cx + rx)},${r1(cy)} A ${rx} ${ry} 0 1 0 ${r1(cx - rx)},${r1(cy)} Z`;

let uid = 0;
/** Cel-shaded filled shape: deep / shade / base by offsetting the shape toward the key light
 * (top-left), a specular streak inside, then the black outline on top. */
function cel(d, pal, { d1 = 6, d2 = 16, out = OUT, extra = '', spec = null } = {}) {
  const id = `c${uid++}`;
  const s = spec ? `<path d="${spec}" fill="none" stroke="${SPEC}" stroke-width="5" stroke-linecap="round"/>` : '';
  return `<clipPath id="${id}"><path d="${d}"/></clipPath>
  <g clip-path="url(#${id})"><path d="${d}" fill="${pal.deep}"/>
  <path d="${d}" fill="${pal.shade}" transform="translate(${-d1 * 0.8},${-d1})"/>
  <path d="${d}" fill="${pal.base}" transform="translate(${-d2 * 0.8},${-d2})"/>${extra}${s}</g>
  <path d="${d}" fill="none" stroke="${INK}" stroke-width="${out}" stroke-linejoin="round"/>`;
}
const line = (d, w = 5, col = INK) => `<path d="${d}" fill="none" stroke="${col}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
const fill = (d, col) => `<path d="${d}" fill="${col}"/>`;

// ------------------------------------------------------------------------------ hands
/** A hand at wrist w pointing along dir (unit) with palm width s; variants share the wrist pivot. */
function hand(kind, w, dir, s, pal, { claws = false, pads = false, fingers = 4 } = {}) {
  const [dx, dy] = dir;
  const nx = -dy;
  const ny = dx; // perpendicular
  const at = (a, b) => [w[0] + dx * a + nx * b, w[1] + dy * a + ny * b];
  let g = '';
  const palm = capsule(at(s * 0.05, 0), at(s * 0.55, 0), s * 0.42, s * 0.46);
  const finger = (base, ang, len, wid) => {
    const c = Math.cos(ang);
    const sn = Math.sin(ang);
    const fd = [dx * c + nx * sn, dy * c + ny * sn]; // positive angle turns toward the +n side (fingers fan out)
    const tip = [base[0] + fd[0] * len, base[1] + fd[1] * len];
    let f = cel(capsule(base, tip, wid, wid * 0.85), pal, { d1: 2, d2: 4, out: 6 });
    if (claws) f += fill(capsule(tip, [tip[0] + fd[0] * wid * 1.2, tip[1] + fd[1] * wid * 1.2], wid * 0.45, 1.5), '#F4EBD0') + line(capsule(tip, [tip[0] + fd[0] * wid * 1.2, tip[1] + fd[1] * wid * 1.2], wid * 0.45, 1.5), 3);
    if (pads) f += fill(ell(tip[0], tip[1], wid * 0.95, wid * 0.95), pal.base) + line(ell(tip[0], tip[1], wid * 0.95, wid * 0.95), 5);
    return f;
  };
  const spread = (i, n, a) => (n === 1 ? 0 : -a + (2 * a * i) / (n - 1));
  if (kind === 'open' || kind === 'lean' || kind === 'press') {
    const a = kind === 'open' ? 0.3 : kind === 'press' ? 0.42 : 0.06;
    const len = kind === 'lean' ? s * 0.85 : s * 0.8;
    for (let i = 0; i < fingers; i++) g += finger(at(s * 0.7, spread(i, fingers, s * 0.3)), spread(i, fingers, a), len, s * 0.19);
    g += cel(palm, pal, { d1: 4, d2: 10, out: 7 });
    g += finger(at(s * 0.32, s * 0.36), kind === 'lean' ? 0.5 : 1.0, s * 0.45, s * 0.2); // thumb
  } else if (kind === 'fist' || kind === 'point' || kind === 'fader' || kind === 'scratch') {
    const fist = capsule(at(s * 0.05, 0), at(s * 0.6, 0), s * 0.46, s * 0.52);
    if (kind === 'point') g += finger(at(s * 0.8, -s * 0.22), -0.05, s * 0.95, s * 0.19);
    if (kind === 'scratch') for (let i = 0; i < fingers; i++) g += finger(at(s * 0.8, spread(i, fingers, s * 0.3)), 0.9 + spread(i, fingers, 0.2), s * 0.42, s * 0.19);
    g += cel(fist, pal, { d1: 4, d2: 10, out: 7 });
    for (let i = 1; i < 4; i++) {
      const k = at(s * 1.02, -s * 0.42 + i * s * 0.22);
      const k2 = at(s * 0.74, -s * 0.42 + i * s * 0.22);
      g += line(`M ${P([k2, k]).join(' L ')}`, 4);
    }
    if (kind === 'fader') {
      const knob = at(s * 1.18, s * 0.05);
      g += cel(capsule([knob[0] - 14, knob[1]], [knob[0] + 14, knob[1]], 9, 9), { base: '#E8E8E8', shade: '#9A9AA8', deep: '#5A5A68' }, { d1: 2, d2: 5, out: 5 });
      g += finger(at(s * 0.9, -s * 0.2), 0.35, s * 0.5, s * 0.19);
    }
    g += finger(at(s * 0.4, s * 0.42), 1.3, s * 0.42, s * 0.2); // thumb over the fist
  }
  return g;
}

// ------------------------------------------------------------------------------ Gumbo
const GUMBO = (() => {
  const skin = { base: '#3F9D3A', shade: '#2B6B2A', deep: '#1F4527' };
  const skinD = { base: '#35852F', shade: '#265E24', deep: '#1B3D22' };
  const belly = { base: '#EEE0AB', shade: '#CDB77E', deep: '#9E8452' };
  const tank = { base: '#B8323C', shade: '#86202E', deep: '#561426' };
  const gold = { base: '#FFC629', shade: '#E2861A', deep: '#9A4A0C' };
  const cooler = { base: '#D8283A', shade: '#A01A2C', deep: '#6A1030' };
  const lid = { base: '#F2E6C8', shade: '#D2C29A', deep: '#A8946A' };
  const iris = { base: '#F2C230', shade: '#C99A1E', deep: '#8A5A12' };
  const tooth = { base: '#FFF6D8', shade: '#E0D2B0', deep: '#B8A57E' };
  const L = {
    hips: [420, 628], spine: [424, 525], chest: [430, 420], neck: [452, 338], head: [458, 292], head_top: [452, 128],
    jaw: [458, 276], chin: [690, 296],
    shoulder_R: [332, 376], elbow_R: [300, 530], wrist_R: [322, 668], hand_R: [332, 748],
    shoulder_L: [510, 372], elbow_L: [566, 520], wrist_L: [588, 648], hand_L: [598, 726],
    hip_R: [370, 652], knee_R: [398, 808], ankle_R: [366, 950], toe_R: [446, 980],
    hip_L: [476, 648], knee_L: [512, 802], ankle_L: [498, 946], toe_L: [578, 972],
  };
  const dirOf = (a, b) => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l = Math.hypot(dx, dy);
    return [dx / l, dy / l];
  };
  const scales = (pts, col) => pts.map(([x, y, r]) => fill(ell(x, y, r, r * 0.7), col)).join('');
  const torsoD = 'M 345 345 C 305 370 288 440 292 520 C 296 600 318 668 372 700 C 410 718 470 718 510 708 C 560 690 584 628 580 548 C 576 468 560 398 528 360 C 494 328 390 322 345 345 Z';
  const tankD = 'M 330 372 L 342 338 L 384 336 C 392 400 410 428 448 430 C 486 430 506 400 512 338 L 546 342 L 552 404 C 570 470 570 560 552 626 C 505 660 440 690 385 690 C 340 684 312 650 305 600 C 298 520 306 430 330 372 Z';
  const bellyD = 'M 430 640 C 470 632 530 614 560 592 C 582 630 578 680 544 700 C 504 716 452 716 420 704 C 410 682 412 656 430 640 Z';
  const headD = 'M 408 298 C 384 262 382 200 414 162 C 440 130 505 122 548 134 C 582 146 604 172 640 190 C 676 204 704 216 708 240 C 712 262 696 276 664 280 L 480 286 C 450 294 424 304 408 298 Z';
  const jawD = 'M 438 274 C 520 278 620 278 684 282 C 702 286 704 304 684 314 C 610 330 510 336 456 326 C 428 318 420 288 438 274 Z';
  const tailC = [[352, 646], [250, 650], [170, 790], [88, 948]];
  const eye = (cx, cy, rx, ry, state) => {
    if (state === 'closed') {
      return cel(ell(cx, cy + 2, rx, ry * 0.75), skin, { d1: 3, d2: 7, out: 6 }) + line(`M ${cx - rx + 4} ${cy + 4} Q ${cx} ${cy + 12} ${cx + rx - 4} ${cy + 4}`, 5);
    }
    const k = state === 'wide' ? 1.18 : 1;
    let g = cel(ell(cx, cy, rx * k, ry * k), iris, { d1: 3, d2: 7, out: 6 });
    g += fill(ell(cx - rx * 0.35, cy - ry * 0.4, 4.5, 3.2), SPEC);
    if (state === 'half') {
      g += fill(ell(cx + 1, cy + 5, 4, 9), INK);
      g += cel(`M ${cx - rx - 3} ${cy + 1} C ${cx - rx} ${cy - ry - 8} ${cx + rx} ${cy - ry - 8} ${cx + rx + 3} ${cy + 1} Z`, skin, { d1: 2, d2: 6, out: 6 });
    }
    return g;
  };
  const mouths = {
    closed_pick: line('M 446 286 C 458 296 474 297 490 288', 6),
    grin: `${fill('M 446 280 C 462 304 500 306 524 284 C 500 294 468 294 446 280 Z', tooth.base)}${line('M 446 280 C 462 304 500 306 524 284', 6)}${line('M 452 286 C 472 296 500 296 520 288', 3)}`,
    open: `${line('M 446 286 C 454 304 466 314 484 318', 6)}${line('M 448 292 L 440 300', 5)}`,
    roar: `${line('M 442 284 C 448 318 470 338 500 342', 7)}${line('M 444 290 L 432 296', 5)}${line('M 440 280 C 436 272 438 264 446 260', 5)}`,
  };
  const parts = [
    { slot: 'tail', z: 0, bone: 'phys_tail_1', svg: () => {
      const d = tube(tailC, 110, 16);
      const spikes = [0.18, 0.32, 0.46, 0.6, 0.74].map((t) => {
        const p = bez(...tailC, t);
        const w = (110 + (16 - 110) * t) / 2;
        return capsule([p[0] + w * 0.3, p[1] - w * 0.75], [p[0] + w * 0.1, p[1] - w * 1.05], 9, 2);
      });
      return spikes.map((s) => cel(s, skinD, { d1: 2, d2: 5, out: 5 })).join('') + cel(d, skin, { d1: 8, d2: 20, spec: 'M 300 652 C 270 656 250 670 236 690' });
    } },
    { slot: 'thigh_L', z: 1, svg: () => cel(capsule(L.hip_L, L.knee_L, 56, 45), skinD, { d1: 6, d2: 14 }) },
    { slot: 'shin_L', z: 2, svg: () => cel(capsule(L.knee_L, L.ankle_L, 44, 33), skinD, { d1: 5, d2: 12 }) },
    { slot: 'foot_L', z: 3, svg: () => cel('M 470 930 C 462 950 452 970 456 980 L 596 982 C 610 978 606 962 592 956 C 560 944 530 934 506 926 Z', skinD, { d1: 4, d2: 10 }) + [0, 1, 2].map((i) => fill(capsule([590 - i * 16, 976], [604 - i * 16, 984], 6, 2), '#F4EBD0')).join('') },
    { slot: 'upper_arm_L', z: 4, svg: () => cel(capsule(L.shoulder_L, L.elbow_L, 46, 38), skinD, { d1: 5, d2: 13 }) },
    { slot: 'forearm_L', z: 5, svg: () => cel(capsule(L.elbow_L, L.wrist_L, 38, 30), skinD, { d1: 5, d2: 12 }) },
    ...['open', 'fist', 'point', 'lean'].map((v) => ({ slot: 'hand_L', attachment: v, z: 6, svg: () => hand(v, L.wrist_L, dirOf(L.wrist_L, L.hand_L), 62, skinD, { claws: true }) })),
    { slot: 'torso', z: 7, bone: 'spine', svg: () => cel(torsoD, skin, { d1: 8, d2: 22, extra: scales([[330, 470, 9], [322, 560, 8], [340, 640, 9]], skin.shade) }) },
    { slot: 'tank_top', z: 8, bone: 'spine', svg: () => cel(tankD, tank, { d1: 8, d2: 22, spec: 'M 336 420 C 330 450 328 480 330 510' }) + line('M 312 612 C 380 640 480 640 548 612', 4, tank.deep) },
    { slot: 'belly', z: 9, bone: 'phys_belly', svg: () => cel(bellyD, belly, { d1: 6, d2: 14, extra: [652, 672, 692].map((y) => line(`M ${430} ${y} C 480 ${y + 6} 530 ${y - 4} 570 ${y - 18}`, 4, belly.deep)).join('') }) },
    { slot: 'chain', z: 10, bone: 'phys_chain_1', svg: () => {
      const d = 'M 398 350 C 408 422 440 470 470 472 C 500 472 526 422 532 352';
      return line(d, 20) + `<path d="${d}" fill="none" stroke="${gold.shade}" stroke-width="12" stroke-linecap="round"/>` + `<path d="${d}" fill="none" stroke="${gold.base}" stroke-width="7" stroke-dasharray="10 7" stroke-linecap="round"/>`;
    } },
    { slot: 'neck', z: 11, svg: () => cel('M 402 352 C 396 322 408 292 430 280 L 494 274 C 510 294 516 330 508 358 C 482 372 428 372 402 352 Z', skin, { d1: 5, d2: 14 }) },
    { slot: 'jaw', z: 12, svg: () => fill('M 452 284 L 474 238 L 656 226 L 690 262 L 688 292 L 462 300 Z', '#3A0F24') + fill(ell(600, 284, 50, 10), '#C74A5A') + cel(jawD, skin, { d1: 5, d2: 12 }) + cel('M 470 300 C 540 306 620 304 676 298 C 662 312 560 322 480 316 Z', belly, { d1: 2, d2: 5, out: 4 }) },
    { slot: 'teeth_lower', z: 13, bone: 'jaw', svg: () => [0, 1, 2, 3, 4, 5, 6].map((i) => cel(poly([[500 + i * 26, 284], [512 + i * 26, 262], [524 + i * 26, 284]]), tooth, { d1: 1, d2: 3, out: 4 })).join('') },
    { slot: 'head', z: 14, svg: () => cel(headD, skin, { d1: 8, d2: 22, extra: scales([[440, 200, 8], [470, 230, 7], [610, 226, 6], [650, 236, 6], [560, 206, 7]], skin.shade), spec: 'M 430 186 C 448 160 476 146 506 142' }) + line('M 560 176 C 600 190 640 206 690 222', 4, skin.deep) },
    { slot: 'teeth_upper', z: 15, bone: 'head', svg: () => [0, 1, 2, 3, 4, 5, 6, 7].map((i) => cel(poly([[486 + i * 26, 280], [498 + i * 26, 304], [510 + i * 26, 280]]), tooth, { d1: 1, d2: 3, out: 4 })).join('') },
    { slot: 'gold_tooth', z: 16, bone: 'head', svg: () => cel(poly([[584, 279], [598, 312], [612, 279]]), gold, { d1: 2, d2: 4, out: 5 }) + fill(ell(594, 288, 2.5, 4), SPEC) },
    { slot: 'nostrils', z: 17, bone: 'snout', parent: 'head', joint: [684, 214], svg: () => cel(ell(672, 212, 18, 11), skin, { d1: 2, d2: 5, out: 5 }) + fill(ell(678, 212, 5, 3.5), INK) + cel(ell(698, 216, 12, 9), skin, { d1: 2, d2: 4, out: 5 }) + fill(ell(700, 216, 3.5, 3), INK) },
    ...['open', 'half', 'closed', 'wide'].map((v) => ({ slot: 'eye_L', attachment: v, z: 18, bone: 'face_eye_L', parent: 'head', joint: [566, 150], svg: () => eye(566, 150, 20, 17, v) })),
    ...['open', 'half', 'closed', 'wide'].map((v) => ({ slot: 'eye_R', attachment: v, z: 19, bone: 'face_eye_R', parent: 'head', joint: [506, 156], svg: () => eye(506, 156, 25, 21, v) })),
    { slot: 'pupil_L', z: 20, bone: 'face_pupil_L', parent: 'face_eye_L', joint: [567, 151], svg: () => fill(ell(567, 151, 4.5, 12), INK) + fill(ell(565, 146, 1.6, 2.5), SPEC) },
    { slot: 'pupil_R', z: 21, bone: 'face_pupil_R', parent: 'face_eye_R', joint: [508, 157], svg: () => fill(ell(508, 157, 5.5, 15), INK) + fill(ell(506, 151, 2, 3), SPEC) },
    { slot: 'brow_L', z: 22, bone: 'face_brow_L', parent: 'head', joint: [566, 132], svg: () => cel('M 542 140 C 550 127 582 124 594 134 C 586 139 560 141 542 140 Z', skinD, { d1: 2, d2: 5, out: 6 }) },
    { slot: 'brow_R', z: 23, bone: 'face_brow_R', parent: 'head', joint: [506, 136], svg: () => cel('M 476 146 C 484 130 524 124 540 136 C 530 143 498 146 476 146 Z', skinD, { d1: 2, d2: 5, out: 6 }) },
    ...Object.keys(mouths).map((v) => ({ slot: 'mouth', attachment: v, z: 24, bone: 'head', svg: () => mouths[v] })),
    { slot: 'toothpick', z: 25, bone: 'phys_toothpick', svg: () => cel(capsule([470, 290], [556, 322], 5, 4), { base: '#F2DDA0', shade: '#C9A864', deep: '#8A6A34' }, { d1: 1, d2: 3, out: 4 }) },
    { slot: 'jowl', z: 26, bone: 'phys_jowl_1', svg: () => cel('M 424 304 C 444 318 482 326 516 324 C 506 336 470 340 442 334 C 424 328 414 318 424 304 Z', skin, { d1: 3, d2: 8, out: 6 }) },
    { slot: 'thigh_R', z: 27, svg: () => cel(capsule(L.hip_R, L.knee_R, 60, 48), skin, { d1: 6, d2: 16, spec: 'M 336 690 C 340 720 348 750 356 770' }) },
    { slot: 'shin_R', z: 28, svg: () => cel(capsule(L.knee_R, L.ankle_R, 46, 35), skin, { d1: 5, d2: 13 }) },
    { slot: 'foot_R', z: 29, svg: () => cel('M 340 932 C 330 952 318 974 322 986 L 470 988 C 484 984 480 968 466 960 C 432 948 400 936 380 928 Z', skin, { d1: 4, d2: 11 }) + [0, 1, 2].map((i) => fill(capsule([462 - i * 17, 982], [477 - i * 17, 990], 6, 2), '#F4EBD0')).join('') },
    { slot: 'upper_arm_R', z: 30, svg: () => cel(capsule(L.shoulder_R, L.elbow_R, 52, 43), skin, { d1: 6, d2: 16, spec: 'M 300 390 C 294 420 292 450 294 480' }) },
    { slot: 'forearm_R', z: 31, svg: () => cel(capsule(L.elbow_R, L.wrist_R, 42, 33), skin, { d1: 5, d2: 13 }) },
    ...['open', 'fist', 'point'].map((v) => ({ slot: 'hand_R', attachment: v, z: 32, svg: () => hand(v, L.wrist_R, dirOf(L.wrist_R, L.hand_R), 68, skin, { claws: true }) })),
    { slot: 'cooler_body', z: 33, bone: 'cooler', parent: 'root', joint: [662, 988], tip: [662, 800], svg: () => cel('M 576 812 L 748 812 C 756 812 760 818 760 826 L 758 974 C 758 984 750 988 740 988 L 584 988 C 574 988 568 984 568 974 L 566 826 C 566 818 570 812 576 812 Z', cooler, { d1: 6, d2: 18, extra: fill('M 560 880 L 770 880 L 770 902 L 560 902 Z', '#F2E6C8'), spec: 'M 584 836 L 584 866' }) + line('M 566 880 L 760 880 M 566 902 L 760 902', 4) },
    { slot: 'cooler_lid', z: 34, bone: 'cooler_lid', parent: 'cooler', joint: [662, 792], tip: [760, 792], svg: () => cel('M 570 780 C 570 772 576 768 584 768 L 742 768 C 752 768 758 772 758 780 L 762 804 C 762 812 756 816 748 816 L 576 816 C 568 816 562 812 562 804 Z', lid, { d1: 4, d2: 10, spec: 'M 590 778 L 680 778' }) + cel(capsule([630, 762], [694, 762], 7, 7), lid, { d1: 2, d2: 4, out: 5 }) },
  ];
  // part bones for body pieces come from the template (slot name = bone name) unless set above
  return {
    id: 'gumbo', skeleton: 'chr_gumbo', canvas: [868, 992], landmarks: L, parts,
    extraSvgBones: {},
  };
})();

// ------------------------------------------------------------------------------ Croak
const CROAK = (() => {
  const skin = { base: '#8FBF3A', shade: '#5F8A26', deep: '#3E5E1E' };
  const skinD = { base: '#7FAE32', shade: '#557D22', deep: '#36541B' };
  const belly = { base: '#F2E79A', shade: '#D2C272', deep: '#A89650' };
  const pink = { base: '#FF5FA2', shade: '#D63A7E', deep: '#9A2458' };
  const gold = { base: '#FFC629', shade: '#E2861A', deep: '#9A4A0C' };
  const phone = { base: '#3A3548', shade: '#262233', deep: '#16131F' };
  const iris = { base: '#F2C230', shade: '#C99A1E', deep: '#8A5A12' };
  const L = {
    hips: [385, 700], spine: [378, 600], chest: [368, 495], neck: [352, 408], head: [346, 384], head_top: [338, 176],
    shoulder_L: [430, 450], elbow_L: [458, 622], wrist_L: [440, 790], hand_L: [430, 860],
    shoulder_R: [305, 440], elbow_R: [266, 610], wrist_R: [252, 778], hand_R: [243, 848],
    hip_L: [425, 735], knee_L: [398, 968], ankle_L: [432, 1212], toe_L: [348, 1242],
    hip_R: [348, 728], knee_R: [318, 962], ankle_R: [345, 1206], toe_R: [262, 1236],
  };
  const dirOf = (a, b) => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l = Math.hypot(dx, dy);
    return [dx / l, dy / l];
  };
  const eye = (cx, cy, rx, ry, state) => {
    if (state === 'closed') return cel(ell(cx, cy + 3, rx, ry * 0.8), skin, { d1: 3, d2: 7, out: 6 }) + line(`M ${cx - rx + 5} ${cy + 6} Q ${cx} ${cy + 16} ${cx + rx - 5} ${cy + 6}`, 5);
    const k = state === 'wide' ? 1.15 : 1;
    let g = cel(ell(cx, cy, rx * k, ry * k), iris, { d1: 3, d2: 8, out: 6 });
    g += fill(ell(cx - rx * 0.4, cy - ry * 0.4, 6, 4), SPEC);
    if (state === 'half') {
      g += fill(ell(cx, cy + 7, 12, 6), INK);
      g += cel(`M ${cx - rx - 3} ${cy + 2} C ${cx - rx} ${cy - ry - 10} ${cx + rx} ${cy - ry - 10} ${cx + rx + 3} ${cy + 2} Z`, skin, { d1: 2, d2: 6, out: 6 });
    }
    return g;
  };
  const mouthLine = 'M 206 334 C 262 354 352 364 428 352';
  const mouths = {
    closed: line(mouthLine, 7) + line('M 420 350 C 428 344 432 338 432 330', 5),
    smile: line('M 206 332 C 262 358 360 368 432 338', 7) + line('M 426 342 C 436 336 440 328 438 320', 5),
    open: fill('M 206 332 C 262 352 360 362 430 350 C 402 398 302 412 240 392 C 216 380 206 358 206 332 Z', '#3A0F24') + fill(ell(300, 386, 44, 12), pink.base) + line('M 206 332 C 262 352 360 362 430 350 C 402 398 302 412 240 392 C 216 380 206 358 206 332 Z', 7),
    O: fill(ell(246, 350, 26, 24), '#3A0F24') + fill(ell(248, 360, 14, 7), pink.base) + line(ell(246, 350, 26, 24), 7) + line('M 272 352 C 320 362 380 362 428 352', 6),
  };
  const parts = [
    { slot: 'cup_R', z: 0, bone: 'cup_R', parent: 'band', joint: [232, 290], svg: () => cel(ell(228, 292, 30, 40), phone, { d1: 3, d2: 8 }) + cel(ell(222, 292, 18, 28), pink, { d1: 2, d2: 6, out: 6 }) },
    { slot: 'upper_arm_R', z: 1, svg: () => cel(capsule(L.shoulder_R, L.elbow_R, 29, 23), skinD, { d1: 4, d2: 10 }) },
    { slot: 'forearm_R', z: 2, svg: () => cel(capsule(L.elbow_R, L.wrist_R, 23, 19), skinD, { d1: 4, d2: 9 }) },
    ...['open', 'point', 'fist', 'scratch', 'press'].map((v) => ({ slot: 'hand_R', attachment: v, z: 3, svg: () => hand(v, L.wrist_R, dirOf(L.wrist_R, L.hand_R), 58, skinD, { pads: true }) })),
    { slot: 'mic', z: 4, bone: 'mic', parent: 'hand_R', joint: [248, 812], hidden: true, svg: () => cel(capsule([248, 800], [238, 880], 11, 9), phone, { d1: 2, d2: 5, out: 6 }) + cel(ell(236, 904, 26, 28), gold, { d1: 3, d2: 8, out: 6, extra: [890, 902, 914].map((y) => line(`M 214 ${y} L 258 ${y}`, 3, gold.deep)).join('') }) },
    { slot: 'thigh_R', z: 5, svg: () => cel(capsule(L.hip_R, L.knee_R, 34, 26), skinD, { d1: 4, d2: 10 }) },
    { slot: 'shin_R', z: 6, svg: () => cel(capsule(L.knee_R, L.ankle_R, 26, 19), skinD, { d1: 4, d2: 9 }) },
    { slot: 'foot_R', z: 7, svg: () => cel('M 364 1196 C 372 1216 368 1240 352 1244 L 226 1246 C 210 1242 214 1228 230 1224 C 262 1216 318 1204 338 1192 Z', skinD, { d1: 3, d2: 9 }) },
    { slot: 'thigh_L', z: 8, svg: () => cel(capsule(L.hip_L, L.knee_L, 36, 28), skin, { d1: 4, d2: 11 }) },
    { slot: 'shin_L', z: 9, svg: () => cel(capsule(L.knee_L, L.ankle_L, 28, 20), skin, { d1: 4, d2: 10 }) },
    { slot: 'foot_L', z: 10, svg: () => cel('M 452 1202 C 460 1226 455 1250 440 1254 L 302 1256 C 286 1252 290 1236 306 1232 C 342 1224 400 1212 422 1198 Z', skin, { d1: 3, d2: 9 }) + [0, 1, 2].map((i) => line(`M ${318 + i * 26} 1252 L ${330 + i * 26} 1236`, 4, skin.deep)).join('') },
    { slot: 'torso', z: 11, bone: 'spine', svg: () => cel('M 322 420 C 300 480 298 600 312 700 C 330 745 420 750 458 718 C 470 620 470 510 450 435 C 420 405 350 405 322 420 Z', skin, { d1: 6, d2: 16, extra: fill('M 360 420 L 392 520 L 424 420 Z', belly.base) }) },
    { slot: 'shirt', z: 12, bone: 'spine', svg: () => cel('M 316 432 C 298 500 296 610 310 704 C 334 744 420 748 458 716 C 470 620 470 520 454 440 L 424 424 L 394 512 L 360 426 Z', pink, { d1: 6, d2: 16, extra: [[340, 560], [420, 600], [360, 660], [430, 680], [330, 470]].map(([x, y]) => fill(ell(x, y, 9, 7), pink.shade)).join(''), spec: 'M 326 470 C 320 500 318 530 318 560' }) + cel('M 360 426 L 394 512 L 372 470 L 338 452 Z', pink, { d1: 2, d2: 5, out: 6 }) + cel('M 424 424 L 394 512 L 414 468 L 446 450 Z', pink, { d1: 2, d2: 5, out: 6 }) },
    { slot: 'chain', z: 13, bone: 'phys_chain_1', svg: () => {
      const d = 'M 348 426 C 356 480 380 522 394 524 C 408 522 424 480 432 426';
      return line(d, 18) + `<path d="${d}" fill="none" stroke="${gold.shade}" stroke-width="11" stroke-linecap="round"/>` + `<path d="${d}" fill="none" stroke="${gold.base}" stroke-width="6" stroke-dasharray="9 6" stroke-linecap="round"/>`;
    } },
    { slot: 'pouch', z: 14, bone: 'phys_pouch_1', svg: () => cel('M 226 378 C 212 420 238 466 288 472 C 334 476 356 442 348 398 C 322 410 262 404 226 378 Z', belly, { d1: 4, d2: 11, spec: 'M 242 404 C 246 424 256 440 270 450' }) },
    { slot: 'head', z: 15, svg: () => cel('M 470 332 C 480 272 450 222 395 207 C 345 194 280 198 235 227 C 195 252 178 302 190 342 C 200 382 250 407 320 412 C 390 416 460 392 470 332 Z', skin, { d1: 8, d2: 20, extra: [[420, 300, 9], [380, 270, 7], [445, 350, 7]].map(([x, y, r]) => fill(ell(x, y, r, r * 0.8), skin.shade)).join(''), spec: 'M 228 262 C 246 240 272 228 300 222' }) },
    { slot: 'band', z: 16, bone: 'band', parent: 'head', joint: [340, 180], svg: () => line('M 230 262 C 228 170 300 122 348 124 C 400 126 462 170 460 272', 30) + `<path d="M 230 262 C 228 170 300 122 348 124 C 400 126 462 170 460 272" fill="none" stroke="${phone.base}" stroke-width="18" stroke-linecap="round"/>` + `<path d="M 262 180 C 290 146 320 136 348 136" fill="none" stroke="#6A6380" stroke-width="5" stroke-linecap="round"/>` },
    { slot: 'eye_bulge_R', z: 17, bone: 'face_bulge_R', parent: 'head', joint: [290, 204], svg: () => cel(ell(290, 204, 50, 44), skin, { d1: 4, d2: 12 }) },
    { slot: 'eye_bulge_L', z: 18, bone: 'face_bulge_L', parent: 'head', joint: [398, 214], svg: () => cel(ell(398, 214, 58, 50), skin, { d1: 5, d2: 14, spec: 'M 360 190 C 368 176 380 170 392 168' }) },
    ...['open', 'half', 'closed', 'wide'].map((v) => ({ slot: 'eye_R', attachment: v, z: 19, bone: 'face_eye_R', parent: 'face_bulge_R', joint: [292, 196], svg: () => eye(292, 196, 30, 28, v) })),
    ...['open', 'half', 'closed', 'wide'].map((v) => ({ slot: 'eye_L', attachment: v, z: 20, bone: 'face_eye_L', parent: 'face_bulge_L', joint: [400, 206], svg: () => eye(400, 206, 36, 33, v) })),
    { slot: 'pupil_R', z: 21, bone: 'face_pupil_R', parent: 'face_eye_R', joint: [290, 198], svg: () => fill(ell(290, 198, 13, 7), INK) + fill(ell(286, 195, 2.5, 1.8), SPEC) },
    { slot: 'pupil_L', z: 22, bone: 'face_pupil_L', parent: 'face_eye_L', joint: [398, 208], svg: () => fill(ell(398, 208, 15, 8), INK) + fill(ell(393, 205, 3, 2), SPEC) },
    { slot: 'lid_R', z: 23, bone: 'face_lid_R', parent: 'face_eye_R', joint: [292, 172], svg: () => cel('M 258 182 C 266 160 318 158 326 182 C 312 176 272 176 258 182 Z', pink, { d1: 2, d2: 4, out: 5 }) },
    { slot: 'lid_L', z: 24, bone: 'face_lid_L', parent: 'face_eye_L', joint: [400, 178], svg: () => cel('M 360 190 C 370 164 430 162 440 190 C 424 182 376 182 360 190 Z', pink, { d1: 2, d2: 4, out: 5 }) },
    ...Object.keys(mouths).map((v) => ({ slot: 'mouth', attachment: v, z: 25, bone: 'head', svg: () => mouths[v] })),
    { slot: 'cup_L', z: 26, bone: 'cup_L', parent: 'band', joint: [462, 300], svg: () => cel(ell(466, 300, 36, 46), phone, { d1: 4, d2: 10 }) + cel(ell(474, 300, 20, 32), pink, { d1: 2, d2: 6, out: 6 }) },
    { slot: 'cable', z: 27, bone: 'phys_cable_1', svg: () => {
      const d = 'M 462 344 C 470 400 500 430 492 480 C 486 520 470 540 480 580';
      return line(d, 14) + `<path d="${d}" fill="none" stroke="${phone.base}" stroke-width="7" stroke-linecap="round"/>` + `<path d="${d}" fill="none" stroke="#6A6380" stroke-width="3" stroke-dasharray="5 6"/>`;
    } },
    { slot: 'upper_arm_L', z: 28, svg: () => cel(capsule(L.shoulder_L, L.elbow_L, 31, 25), skin, { d1: 4, d2: 11, spec: 'M 418 470 C 422 500 428 530 434 556' }) },
    { slot: 'forearm_L', z: 29, svg: () => cel(capsule(L.elbow_L, L.wrist_L, 25, 20), skin, { d1: 4, d2: 10 }) },
    ...['open', 'point', 'fist', 'fader'].map((v) => ({ slot: 'hand_L', attachment: v, z: 30, svg: () => hand(v, L.wrist_L, dirOf(L.wrist_L, L.hand_L), 62, skin, { pads: true }) })),
    { slot: 'fx_note', z: 31, bone: 'fx_note', parent: 'root', joint: [200, 300], blend: 'additive', color: 'ffffff00', svg: () => `${fill(ell(190, 316, 14, 10), '#FFFFFF')}${line('M 202 314 L 202 272 L 226 280', 6, '#FFFFFF')}` },
  ];
  return { id: 'croak', skeleton: 'chr_croak', canvas: [720, 1260], landmarks: L, parts };
})();

// ------------------------------------------------------------------------------ render
const svgDoc = (inner, box) => `<svg xmlns="http://www.w3.org/2000/svg" width="${box[2]}" height="${box[3]}" viewBox="${box.join(' ')}">${inner}</svg>`;
const render = (inner, box) => new Resvg(svgDoc(inner, box), { fitTo: { mode: 'original' }, shapeRendering: 2 }).render();
const alphaBox = (img) => {
  const { width, height } = img;
  const px = img.pixels;
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (px[(y * width + x) * 4 + 3] > 0) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  return x1 < 0 ? null : [x0, y0, x1 + 1, y1 + 1];
};

for (const ch of [GUMBO, CROAK]) {
  if (only && only !== ch.id) continue;
  const dir = path.join(outRoot, ch.id);
  const imgRoot = path.join(dir, 'images', ch.skeleton);
  fs.rmSync(imgRoot, { recursive: true, force: true });
  fs.mkdirSync(imgRoot, { recursive: true });
  const [W, H] = ch.canvas;
  const parts = [];
  const slotSeen = new Set();
  for (const p of ch.parts) {
    uid = 0;
    const inner = p.svg();
    const full = render(inner, [0, 0, W, H]);
    const ab = alphaBox(full);
    if (!ab) throw new Error(`${ch.id}: part ${p.slot}/${p.attachment ?? ''} rendered empty`);
    const box = [ab[0] - PAD, ab[1] - PAD, ab[2] - ab[0] + 2 * PAD, ab[3] - ab[1] + 2 * PAD];
    const png = render(inner, box).asPng();
    const rel = p.attachment ? path.join(p.slot, `${p.attachment}.png`) : `${p.slot}.png`;
    fs.mkdirSync(path.dirname(path.join(imgRoot, rel)), { recursive: true });
    fs.writeFileSync(path.join(imgRoot, rel), png);
    const e = { slot: p.slot };
    if (p.attachment) e.attachment = p.attachment;
    e.bbox = box;
    // slot-level fields once per slot (all variants share them)
    if (!slotSeen.has(p.slot)) {
      e.z = p.z;
      e.bone = p.bone ?? p.slot;
      for (const k of ['parent', 'joint', 'tip', 'blend', 'color', 'hidden']) if (p[k] !== undefined) e[k] = p[k];
      slotSeen.add(p.slot);
    }
    parts.push(e);
  }
  const doc = {
    $comment: `Written by tools/spine/examples/character_demo/make_parts.mjs (procedural placeholder; stands in for the split stage). Canvas ${W}x${H} @2x, image space (y down); root = anchor (feet point).`,
    skeleton: ch.skeleton,
    kind: 'character',
    canvas: [W, H],
    anchor: [0.5, 1.0],
    images: 'images',
    landmarks: ch.landmarks,
    parts,
  };
  fs.writeFileSync(path.join(dir, 'parts.json'), `${JSON.stringify(doc, null, 1)}\n`);
  console.log(`make_parts: ${ch.skeleton}: ${parts.length} parts (${slotSeen.size} slots) -> ${path.relative(process.cwd(), path.join(dir, 'parts.json'))}`);
}
