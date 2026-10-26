#!/usr/bin/env node
/**
 * Magpie Heist: owned-code vector stand-ins for the symbols the Higgsfield batch `mh_c01` has not
 * produced yet (the account's daily cap): H2 Jeweled Egg, H3 Pocket Watch, H4 Ruby Chalice,
 * H5 Key Ring, S Safe. Drawn in formula M's rules (art/bible/artbible.json -> magpieHeist): a bold
 * single-weight black outline around the silhouette, thinner interior lines, hard cel shadows away
 * from an upper-left key light, glossy highlights and white specular hotspots, the game palette.
 *
 *   node tools/mhart/vector/standins.mjs [--out art/_work/magpie-heist/vector] [ID ...]
 *
 * Writes <ID>.svg and <ID>.png (1024 x 1024, transparent, @resvg/resvg-js) per symbol; then
 * `tools/.venv/bin/python tools/mhart/build_art.py standins` fits them on the 360 @2x canvas, makes
 * the _blur / _glow variants and records the owned-code provenance rows. Deterministic (no fonts,
 * no randomness). Replaced by the generated art once mh_c01 runs (ART_PLAN §3).
 */
import fs from 'node:fs';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';

const argv = process.argv.slice(2);
const outIdx = argv.indexOf('--out');
const OUT_DIR = path.resolve(outIdx >= 0 ? argv[outIdx + 1] : 'art/_work/magpie-heist/vector');
const only = argv.filter((a, i) => !a.startsWith('--') && (outIdx < 0 || i !== outIdx + 1));

const N = 1024; // master canvas
const INK = '#170C1C';
const OUT = 17; // visible outer outline beyond the shape edge (master px)
const INN = 10; // interior line width (master px)
const f = (v) => Math.round(v * 100) / 100;

// ------------------------------------------------------------------------------------------ palette
const PAL = {
  gold: ['#FFF6BE', '#FFDA4F', '#F7AE26', '#C7700F'],
  goldDeep: '#9C4E0B',
  goldShade: '#B8620E',
  silver: ['#FFFFFF', '#E3EAF2', '#A9B6C8', '#66738A'],
  silverShade: '#5F6C84',
  bronze: ['#FFD9B0', '#E9954F', '#B05A22', '#6E3210'],
  bronzeShade: '#7A3812',
  blue: ['#9CC3FF', '#3D7BFF', '#1C43C2', '#0E2273'],
  blueShade: '#0F1F66',
  crimson: ['#FF8A96', '#E0303F', '#A3132B', '#5E0716'],
  crimsonShade: '#6A0A1C',
  ruby: ['#FFC2CC', '#FF3355', '#B0062A', '#5A0014'],
  wine: ['#E23154', '#A0102D', '#5C0619'],
  pearl: ['#FFFFFF', '#FFF4DC', '#E2CDA6'],
  cream: ['#FFFEF6', '#FBF1D6', '#E8D7AE'],
  iron: ['#A9B2CC', '#5B6280', '#2A2E44', '#161827'],
};

// ------------------------------------------------------------------------------------------ geometry
const circ = (cx, cy, r) => ell(cx, cy, r, r);
function ell(cx, cy, rx, ry, rot = 0) {
  if (!rot) return `M${f(cx - rx)},${f(cy)}A${f(rx)},${f(ry)} 0 1 0 ${f(cx + rx)},${f(cy)}A${f(rx)},${f(ry)} 0 1 0 ${f(cx - rx)},${f(cy)}Z`;
  return poly(Array.from({ length: 96 }, (_, i) => {
    const t = (i / 96) * Math.PI * 2;
    const c = Math.cos((rot * Math.PI) / 180);
    const s = Math.sin((rot * Math.PI) / 180);
    const x = rx * Math.cos(t);
    const y = ry * Math.sin(t);
    return [cx + x * c - y * s, cy + x * s + y * c];
  }));
}
function rrect(x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  return `M${f(x + r)},${f(y)}H${f(x + w - r)}A${f(r)},${f(r)} 0 0 1 ${f(x + w)},${f(y + r)}V${f(y + h - r)}` +
    `A${f(r)},${f(r)} 0 0 1 ${f(x + w - r)},${f(y + h)}H${f(x + r)}A${f(r)},${f(r)} 0 0 1 ${f(x)},${f(y + h - r)}` +
    `V${f(y + r)}A${f(r)},${f(r)} 0 0 1 ${f(x + r)},${f(y)}Z`;
}
const poly = (pts, close = true) => 'M' + pts.map(([x, y]) => `${f(x)},${f(y)}`).join('L') + (close ? 'Z' : '');
/** Closed Catmull-Rom spline through pts as cubic beziers. */
function smooth(pts, close = true, k = 1 / 6) {
  const n = pts.length;
  const P = (i) => (close ? pts[(i + n) % n] : pts[Math.max(0, Math.min(n - 1, i))]);
  let d = `M${f(pts[0][0])},${f(pts[0][1])}`;
  const last = close ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    d += `C${f(p1[0] + (p2[0] - p0[0]) * k)},${f(p1[1] + (p2[1] - p0[1]) * k)} ` +
      `${f(p2[0] - (p3[0] - p1[0]) * k)},${f(p2[1] - (p3[1] - p1[1]) * k)} ${f(p2[0])},${f(p2[1])}`;
  }
  return d + (close ? 'Z' : '');
}
/** Polar closed shape r(theta) around (cx, cy). */
const polar = (cx, cy, rf, n = 120, rot = 0) => poly(Array.from({ length: n }, (_, i) => {
  const t = (i / n) * Math.PI * 2 + rot;
  const r = rf(t);
  return [cx + r * Math.cos(t), cy + r * Math.sin(t)];
}));
const rot = (x, y, cx, cy, deg) => {
  const a = (deg * Math.PI) / 180;
  const dx = x - cx, dy = y - cy;
  return [cx + dx * Math.cos(a) - dy * Math.sin(a), cy + dx * Math.sin(a) + dy * Math.cos(a)];
};

// ------------------------------------------------------------------------------------------ picture
class Pic {
  constructor() {
    this.defs = [];
    this.parts = [];
    this.n = 0;
    this.part('main');
  }

  /** Start a named layer (a rig part). Each layer carries its own outline, so the composite (layers stacked back
   *  to front) is exactly what a rig shows at rest. `meta.joint` is the pivot in master px. */
  part(name, meta = {}) {
    const P = { name, meta, sil: [], body: [] };
    if (this.parts.length === 1 && this.parts[0].name === 'main' && !this.parts[0].body.length) this.parts.pop();
    this.parts.push(P);
    this.sil = P.sil;
    this.body = P.body;
    return P;
  }

  uid(p) {
    return `${p}${++this.n}`;
  }

  /** 4-stop body gradient lit from the upper left (objectBoundingBox). */
  lin(stops, x1 = 0.25, y1 = 0, x2 = 0.75, y2 = 1, at = [0, 0.32, 0.72, 1]) {
    const id = this.uid('g');
    const s = stops.map((c, i) => `<stop offset="${at[Math.min(i, at.length - 1)]}" stop-color="${c}"/>`).join('');
    this.defs.push(`<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${s}</linearGradient>`);
    return `url(#${id})`;
  }

  rad(stops, cx = 0.36, cy = 0.3, r = 0.8, at) {
    const id = this.uid('r');
    const offs = at ?? stops.map((_, i) => i / (stops.length - 1));
    const s = stops.map((c, i) => `<stop offset="${offs[i]}" stop-color="${c}"/>`).join('');
    this.defs.push(`<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="${r}" fx="${cx}" fy="${cy}">${s}</radialGradient>`);
    return `url(#${id})`;
  }

  /** A filled shape: silhouette outline + fill + interior line (o.line: false = no interior line,
   *  the silhouette then carries the full width). o.rule: 'evenodd'. */
  fill(d, paint, o = {}) {
    const rule = o.rule ? ` fill-rule="${o.rule}"` : '';
    const line = o.line ?? INN;
    if (o.sil !== false) {
      const w = 2 * OUT + (line ? 0 : INN);
      this.sil.push(`<path d="${d}"${rule} fill="${INK}" stroke="${INK}" stroke-width="${w}" stroke-linejoin="round"/>`);
    }
    const st = line ? ` stroke="${INK}" stroke-width="${line}" stroke-linejoin="round"` : '';
    this.body.push(`<path d="${d}"${rule} fill="${paint}"${st}/>`);
    return d;
  }

  /** An open stroked line with its own ink casing (filigree, chain, hands). */
  line(d, paint, w, o = {}) {
    // a bbox gradient on a horizontal / vertical line has a zero-size box and paints nothing
    if (paint.startsWith('url(') && /^M[\d.,-]+L[\d.,-]+$/.test(d)) {
      const [, x0, y0, x1, y1] = d.match(/^M([\d.-]+),([\d.-]+)L([\d.-]+),([\d.-]+)$/).map(Number);
      if (Math.abs(x1 - x0) < 1 || Math.abs(y1 - y0) < 1) paint = o.solid ?? '#F7B52E';
    }
    if (o.sil) this.sil.push(`<path d="${d}" fill="none" stroke="${INK}" stroke-width="${w + 2 * OUT}" stroke-linecap="round" stroke-linejoin="round"/>`);
    this.body.push(`<path d="${d}" fill="none" stroke="${INK}" stroke-width="${w + (o.casing ?? INN)}" stroke-linecap="round" stroke-linejoin="round"/>`);
    this.body.push(`<path d="${d}" fill="none" stroke="${paint}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`);
  }

  /** Hard cel shadow inside `d`: everything but `d` shifted toward the light. */
  shade(d, color, dx, dy, op = 1, rule) {
    const c = this.uid('c');
    const m = this.uid('m');
    const r = rule ? ` fill-rule="${rule}" clip-rule="${rule}"` : '';
    this.defs.push(`<clipPath id="${c}"><path d="${d}"${r}/></clipPath>`);
    this.defs.push(`<mask id="${m}" maskUnits="userSpaceOnUse" x="${-N}" y="${-N}" width="${3 * N}" height="${3 * N}">` +
      `<rect x="${-N}" y="${-N}" width="${3 * N}" height="${3 * N}" fill="#fff"/><path d="${d}"${r} transform="translate(${dx} ${dy})" fill="#000"/></mask>`);
    this.body.push(`<g clip-path="url(#${c})"><rect x="${-N}" y="${-N}" width="${3 * N}" height="${3 * N}" fill="${color}" opacity="${op}" mask="url(#${m})"/></g>`);
  }

  /** Raw svg clipped to `d` (glosses, engravings, glare). */
  clip(d, inner, rule) {
    const c = this.uid('c');
    const r = rule ? ` clip-rule="${rule}"` : '';
    this.defs.push(`<clipPath id="${c}"><path d="${d}"${r}/></clipPath>`);
    this.body.push(`<g clip-path="url(#${c})">${inner}</g>`);
  }

  raw(svg) {
    this.body.push(svg);
  }

  /** White specular hotspot: a soft oval with a bright core. */
  spec(cx, cy, rx, ry, rotDeg = -35, op = 0.95) {
    this.body.push(`<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${f(rx)}" ry="${f(ry)}" transform="rotate(${rotDeg} ${f(cx)} ${f(cy)})" fill="#fff" opacity="${op}"/>`);
  }

  /** Four-point twinkle (gems). */
  twinkle(cx, cy, r, op = 1) {
    const k = r * 0.22;
    this.body.push(`<path d="M${f(cx)},${f(cy - r)}Q${f(cx + k)},${f(cy - k)} ${f(cx + r)},${f(cy)}Q${f(cx + k)},${f(cy + k)} ${f(cx)},${f(cy + r)}` +
      `Q${f(cx - k)},${f(cy + k)} ${f(cx - r)},${f(cy)}Q${f(cx - k)},${f(cy - k)} ${f(cx)},${f(cy - r)}Z" fill="#fff" opacity="${op}"/>`);
  }

  svg(only = null) {
    const layers = this.parts.filter((P) => !only || only.includes(P.name))
      .map((P) => `<g id="${P.name}"><g>${P.sil.join('')}</g><g>${P.body.join('')}</g></g>`).join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${N}" height="${N}" viewBox="0 0 ${N} ${N}">` +
      `<defs>${this.defs.join('')}</defs>${layers}</svg>`;
  }
}

// ------------------------------------------------------------------------------------------ shared parts
/** A cabochon gem (oval) with a gold bezel and four prongs. */
function gem(p, cx, cy, rx, ry, colors, o = {}) {
  const bez = ell(cx, cy, rx + 14, ry + 14);
  p.fill(bez, p.lin(PAL.gold), { sil: o.sil });
  p.shade(bez, PAL.goldShade, -6, -8, 0.7);
  const g = ell(cx, cy, rx, ry);
  p.fill(g, p.rad(colors, 0.38, 0.32, 0.75, [0, 0.35, 0.78, 1]), { line: 7, sil: false });
  p.shade(g, colors[3], -0.28 * rx, -0.3 * ry, 0.55);
  p.spec(cx - rx * 0.32, cy - ry * 0.36, rx * 0.34, ry * 0.2, -35);
  p.spec(cx + rx * 0.35, cy + ry * 0.4, rx * 0.1, ry * 0.08, 0, 0.75);
  if (o.prongs !== false) {
    for (const [ax, ay] of [[-0.72, -0.72], [0.72, -0.72], [-0.72, 0.72], [0.72, 0.72]]) {
      const pr = circ(cx + ax * (rx + 6), cy + ay * (ry + 6), Math.max(6, Math.min(rx, ry) * 0.17));
      p.fill(pr, p.lin(PAL.gold), { line: 6, sil: false });
    }
  }
}

/** Gold metal fill with cel shadow and an optional highlight streak. */
function gold(p, d, o = {}) {
  p.fill(d, p.lin(o.stops ?? PAL.gold, o.x1, o.y1, o.x2, o.y2), o);
  if (o.shade !== false) p.shade(d, o.shadeColor ?? PAL.goldShade, o.dx ?? -16, o.dy ?? -22, o.op ?? 0.62, o.rule);
  return d;
}

// ================================================================================================ H2 egg
function egg() {
  const p = new Pic();
  const cx = 512, cy = 468, a = 262, b = 290, k = 0.16;
  const T = (t) => cy + b * t;
  const W = (t) => a * Math.sqrt(Math.max(0, 1 - t * t)) * (1 + k * t);
  const contour = (t0, t1, n = 60) => Array.from({ length: n + 1 }, (_, i) => t0 + ((t1 - t0) * i) / n);
  const shell = poly([...contour(-1, 1, 160).map((t) => [cx + W(t), T(t)]), ...contour(1, -1, 160).map((t) => [cx - W(t), T(t)])]);
  /** A band of the shell between t0 and t1, edges bowing down by c (seen from slightly above). */
  const band = (t0, t1, c0, c1 = c0) => {
    const top = contour(-1, 1, 40).map((u) => [cx + u * W(t0), T(t0) + c0 * (1 - u * u)]);
    const right = contour(t0, t1, 20).map((t) => [cx + W(t), T(t)]);
    const bot = contour(1, -1, 40).map((u) => [cx + u * W(t1), T(t1) + c1 * (1 - u * u)]);
    const left = contour(t1, t0, 20).map((t) => [cx - W(t), T(t)]);
    return poly([...top, ...right, ...bot, ...left]);
  };
  const along = (t, c, u) => [cx + u * W(t), T(t) + c * (1 - u * u)];
  const bottom = T(1);

  p.part('stand', { joint: [cx, bottom + 4] });
  // ---- stand (behind the egg): a collar with three scroll legs and ball feet
  for (const sx of [-1, 1]) {
    const L = [[cx + sx * 60, bottom - 30], [cx + sx * 130, bottom + 4], [cx + sx * 186, bottom + 62], [cx + sx * 196, bottom + 118], [cx + sx * 178, bottom + 150]];
    p.line(smooth(L, false), p.lin(PAL.gold), 30, { sil: true });
  }
  p.line(`M${cx},${bottom - 10}L${cx},${bottom + 136}`, p.lin(PAL.gold), 32, { sil: true });
  for (const [x, y] of [[cx - 176, bottom + 160], [cx + 176, bottom + 160], [cx, bottom + 160]]) {
    const ball = circ(x, y, 30);
    gold(p, ball, { dx: -9, dy: -11 });
    p.spec(x - 10, y - 12, 9, 5);
  }
  const collar = ell(cx, bottom + 4, 96, 26);
  gold(p, collar, { dx: -10, dy: -10 });

  // ---- shell
  p.part('shell', { joint: [cx, cy] });
  p.fill(shell, p.rad(PAL.blue, 0.36, 0.3, 0.85, [0, 0.38, 0.8, 1]));
  p.shade(shell, PAL.blueShade, -50, -34, 0.55);

  // shell gloss (window highlight + hotspots)
  p.clip(shell, `<ellipse cx="${cx - 150}" cy="${cy - 20}" rx="34" ry="110" transform="rotate(18 ${cx - 150} ${cy - 20})" fill="#fff" opacity="0.38"/>`);
  p.spec(cx - 176, cy + 6, 13, 34, 18, 0.9);

  // Faberge lattice between the lid and the pearl band (angles on the sphere, so it wraps)
  const tm = -0.27;
  const lat = [];
  const famPts = (j, sgn) => {
    const pts = [];
    for (let i = 0; i <= 60; i++) {
      const t = -0.62 + (0.7 * i) / 60;
      const phi = j * 0.36 + sgn * 1.25 * (t - tm);
      if (Math.abs(phi) > Math.PI / 2) continue;
      pts.push(along(t, 32, Math.sin(phi)));
    }
    return pts;
  };
  for (let j = -6; j <= 6; j++) {
    for (const sgn of [-1, 1]) {
      const pts = famPts(j, sgn);
      if (pts.length > 1) lat.push(poly(pts, false));
    }
  }
  p.clip(shell, lat.map((d) => `<path d="${d}" fill="none" stroke="${INK}" stroke-width="${11 + 7}" stroke-linecap="round"/>`).join('') +
    lat.map((d) => `<path d="${d}" fill="none" stroke="#FFD24A" stroke-width="11" stroke-linecap="round"/>`).join(''));
  const studs = [];
  for (let r = -1; r <= 1; r++) {
    const t = tm + r * 0.144;
    for (let m = -8; m <= 8; m++) {
      if ((m - r) % 2 !== 0) continue;
      const phi = m * 0.18;
      if (Math.abs(phi) > 1.2) continue;
      studs.push({ t, phi, ruby: r === 0 });
    }
  }
  studs.sort((q, r) => Math.cos(q.phi) - Math.cos(r.phi));
  for (const st of studs) {
    const s = Math.cos(st.phi);
    const [x, y] = along(st.t, 32, Math.sin(st.phi));
    if (st.ruby) gem(p, x, y, 13 * s + 4, 16, PAL.ruby, { prongs: false, sil: false });
    else {
      const d = ell(x, y, 9 * s + 3, 11);
      p.fill(d, p.rad(PAL.pearl, 0.35, 0.3, 0.8), { line: 5, sil: false });
    }
  }
  // lower swags between the pearl band and the lower band
  const swag = [];
  for (const [u0, u1] of [[-0.95, -0.32], [-0.32, 0.32], [0.32, 0.95]]) {
    const p0 = along(0.16, 34, u0), p1 = along(0.16, 34, u1);
    const pm = along(0.42, 30, (u0 + u1) / 2);
    swag.push(`M${f(p0[0])},${f(p0[1])}Q${f(pm[0])},${f(pm[1] + 30)} ${f(p1[0])},${f(p1[1])}`);
  }
  p.clip(shell, swag.map((d) => `<path d="${d}" fill="none" stroke="${INK}" stroke-width="${14 + INN}" stroke-linecap="round"/><path d="${d}" fill="none" stroke="#FFD24A" stroke-width="14" stroke-linecap="round"/>`).join(''));
  for (const u of [-0.32, 0.32]) {
    const [x, y] = along(0.16, 34, u);
    const drop = ell(x, y + 42, 12, 16);
    p.fill(drop, p.rad(PAL.ruby), { line: 6, sil: false });
    p.spec(x - 3, y + 36, 3, 5, 0, 0.9);
  }

  // ---- pearl band
  const pb = band(0.02, 0.14, 34, 36);
  gold(p, pb, { dx: -18, dy: -8 });
  const pearls = [];
  for (let i = -5; i <= 5; i++) {
    const phi = (i / 5.4) * (Math.PI / 2);
    const [x, y] = along(0.08, 35, Math.sin(phi));
    pearls.push({ x, y, s: Math.pow(Math.cos(phi), 0.6), z: Math.cos(phi) });
  }
  pearls.sort((q, r) => q.z - r.z);
  for (const q of pearls) {
    const d = ell(q.x, q.y, 21 * q.s + 4, 23);
    p.fill(d, p.rad(PAL.pearl, 0.35, 0.3, 0.8), { line: 7, sil: false });
    p.shade(d, '#CDB58A', -8 * q.s, -9, 0.65);
    p.spec(q.x - 6 * q.s, q.y - 8, 5 * q.s + 1, 4, -30);
  }
  const lb = band(0.5, 0.57, 30, 30);
  gold(p, lb, { dx: -18, dy: -8 });

  // ---- lid
  const lidT = -0.6;
  p.part('lid', { joint: [cx - W(lidT), T(lidT)] });
  const lidD = poly([
    ...contour(-1, lidT, 60).map((t) => [cx - W(t), T(t)]),
    ...contour(-1, 1, 40).map((u) => [cx + u * W(lidT), T(lidT) + 30 * (1 - u * u)]),
    ...contour(lidT, -1, 60).map((t) => [cx + W(t), T(t)]),
  ]);
  gold(p, lidD, { dx: -30, dy: -24 });
  p.clip(lidD, [-0.62, -0.2, 0.2, 0.62].map((u) => {
    const [x0, y0] = along(lidT, 30, u);
    return `<path d="M${f(x0)},${f(y0)}Q${f(cx + u * 70)},${f(T(-0.88))} ${cx},${f(T(-1) + 4)}" fill="none" stroke="${PAL.goldDeep}" stroke-width="7" opacity="0.6"/>`;
  }).join(''));
  p.clip(lidD, `<ellipse cx="${cx - 70}" cy="${T(-0.8)}" rx="16" ry="38" transform="rotate(38 ${cx - 70} ${T(-0.8)})" fill="#fff" opacity="0.85"/>`);
  const lip = band(lidT - 0.01, lidT + 0.075, 30, 32);
  gold(p, lip, { stops: ['#FFF2A8', '#FFD24A', '#E8961C', '#A85A0A'], dx: -22, dy: -8 });


  p.part('cradle', { joint: [cx, T(0.86)] });
  // ---- cradle: scalloped gold cup hugging the bottom of the shell
  const ct = 0.74;
  const cradle = poly([
    ...contour(-1, 1, 80).map((u) => [cx + u * W(ct), T(ct) + 26 * (1 - u * u) - 14 * Math.abs(Math.sin(3.5 * Math.PI * u))]),
    ...contour(ct, 1, 40).map((t) => [cx + W(t), T(t)]),
    ...contour(1, ct, 40).map((t) => [cx - W(t), T(t)]),
  ]);
  gold(p, cradle, { dx: -24, dy: -20 });
  p.clip(cradle, `<ellipse cx="${cx - 110}" cy="${T(0.86)}" rx="12" ry="30" transform="rotate(58 ${cx - 110} ${T(0.86)})" fill="#fff" opacity="0.8"/>`);
  for (const u of [-0.5, 0, 0.5]) {
    const [x, y] = along(0.86, 14, u);
    const bead = ell(x, y, 12 * Math.sqrt(1 - u * u) + 4, 13);
    p.fill(bead, p.rad(PAL.blue), { line: 6, sil: false });
    p.spec(x - 4, y - 5, 4, 3, -30);
  }

  // ---- finial: collar + big ruby
  p.part('finial', { joint: [cx, T(-1) + 4] });
  const col = ell(cx, T(-1) + 4, 50, 17);
  gold(p, col, { dx: -8, dy: -6 });
  const stem = rrect(cx - 22, T(-1) - 28, 44, 34, 12);
  gold(p, stem, { dx: -8, dy: -4 });
  gem(p, cx, T(-1) - 70, 48, 48, PAL.ruby);
  p.part('sparkle', { fx: true });
  p.twinkle(cx - 19, T(-1) - 87, 13);
  p.twinkle(cx - 226, cy - 60, 22);
  return p;
}

// ================================================================================================ H3 watch
function watch() {
  const p = new Pic();
  const cx = 548, cy = 560, R = 286;
  p.part('chain', { joint: [cx + 70, 112] });
  // chain (behind the bow): links along a quadratic curve to the right
  const q = (t) => {
    const P0 = [cx + 70, 112], P1 = [cx + 250, 40], P2 = [cx + 320, 230];
    const x = (1 - t) * (1 - t) * P0[0] + 2 * (1 - t) * t * P1[0] + t * t * P2[0];
    const y = (1 - t) * (1 - t) * P0[1] + 2 * (1 - t) * t * P1[1] + t * t * P2[1];
    const dx = 2 * (1 - t) * (P1[0] - P0[0]) + 2 * t * (P2[0] - P1[0]);
    const dy = 2 * (1 - t) * (P1[1] - P0[1]) + 2 * t * (P2[1] - P1[1]);
    return [x, y, (Math.atan2(dy, dx) * 180) / Math.PI];
  };
  for (let i = 0; i < 6; i++) {
    const [x, y, a] = q(0.1 + i * 0.17);
    if (i % 2 === 0) {
      const outer = ell(x, y, 34, 22, a);
      const inner = ell(x, y, 18, 8, a);
      gold(p, outer + inner, { rule: 'evenodd', dx: -6, dy: -8, line: 7 });
    } else {
      const d = ell(x, y, 34, 10, a);
      gold(p, d, { dx: -4, dy: -6, line: 7 });
    }
  }
  p.part('lid', { joint: [cx - R - 4, cy] });
  // opened lid on the left (behind the case)
  const lidC = [cx - R + 18, cy + 8];
  const lidOuter = ell(lidC[0] - 70, lidC[1], 122, R - 4, -4);
  gold(p, lidOuter, { dx: -18, dy: -10 });
  const lidInner = ell(lidC[0] - 62, lidC[1] + 2, 90, R - 40, -4);
  p.fill(lidInner, p.lin(['#C47A14', '#F5B232', '#FFE07A', '#FFF3BE'], 0.2, 0, 0.8, 1), { line: 7, sil: false });
  // engraved star burst on the inside of the lid
  p.clip(lidInner, Array.from({ length: 12 }, (_, i) => {
    const t = (i / 12) * Math.PI * 2;
    const x0 = lidC[0] - 62, y0 = lidC[1] + 2;
    return `<line x1="${f(x0 + 18 * Math.cos(t))}" y1="${f(y0 + 50 * Math.sin(t))}" x2="${f(x0 + 70 * Math.cos(t))}" y2="${f(y0 + 200 * Math.sin(t))}" stroke="${PAL.goldDeep}" stroke-width="6" stroke-linecap="round" opacity="0.6"/>`;
  }).join('') + `<ellipse cx="${lidC[0] - 62}" cy="${lidC[1] + 2}" rx="26" ry="70" fill="none" stroke="${PAL.goldDeep}" stroke-width="7" opacity="0.6"/>`);
  p.spec(lidC[0] - 96, lidC[1] - 150, 12, 40, 4, 0.8);
  // hinge
  const hinge = rrect(cx - R - 30, cy - 46, 52, 92, 20);
  gold(p, hinge, { dx: -6, dy: -8 });

  // stem, crown and bow
  p.part('bow', { joint: [cx, 150] });
  const bowO = ell(cx, 108, 80, 66);
  const bowI = ell(cx, 104, 46, 34);
  gold(p, bowO + bowI, { rule: 'evenodd', dx: -12, dy: -14 });
  p.spec(cx - 50, 80, 9, 18, 40, 0.85);
  p.part('crown', { joint: [cx, 286] });
  const stemD = rrect(cx - 30, 222, 60, 70, 10);
  gold(p, stemD, { dx: -8, dy: -4 });
  const crown = rrect(cx - 66, 160, 132, 82, 26);
  gold(p, crown, { dx: -14, dy: -12 });
  p.clip(crown, Array.from({ length: 9 }, (_, i) => `<line x1="${cx - 52 + i * 13}" y1="166" x2="${cx - 52 + i * 13}" y2="238" stroke="${PAL.goldDeep}" stroke-width="5" opacity="0.75"/>`).join(''));
  p.spec(cx - 40, 178, 18, 6, 0, 0.85);

  // case + bezel + face
  p.part('case', { joint: [cx, cy] });
  const caseD = circ(cx, cy, R);
  gold(p, caseD, { dx: -34, dy: -40 });
  p.clip(caseD, `<circle cx="${cx}" cy="${cy}" r="${R - 12}" fill="none" stroke="#FFF6C8" stroke-width="10" opacity="0.55" stroke-dasharray="320 1600" transform="rotate(170 ${cx} ${cy})"/>`);
  const bezel = circ(cx, cy, R - 40);
  p.fill(bezel, p.lin(['#C06A10', '#F2A62A', '#FFDA55', '#FFF4C0'], 0.25, 0, 0.75, 1), { line: 8, sil: false });
  const face = circ(cx, cy, R - 66);
  p.fill(face, p.rad(PAL.cream, 0.4, 0.35, 0.75), { line: 8, sil: false });
  p.shade(face, '#D8C091', 18, 22, 0.55);
  p.raw(`<circle cx="${cx}" cy="${cy}" r="${R - 98}" fill="none" stroke="${INK}" stroke-width="4" opacity="0.8"/>`);
  // hour marks (no numbers)
  for (let i = 0; i < 12; i++) {
    const t = (i / 12) * Math.PI * 2 - Math.PI / 2;
    const main = i % 3 === 0;
    const r0 = R - 150, r1 = R - 104;
    const [x0, y0] = [cx + r0 * Math.cos(t), cy + r0 * Math.sin(t)];
    const [x1, y1] = [cx + r1 * Math.cos(t), cy + r1 * Math.sin(t)];
    if (main) {
      const w = 15;
      const nx = -Math.sin(t) * w, ny = Math.cos(t) * w;
      const xm = (x0 + x1) / 2, ym = (y0 + y1) / 2;
      p.raw(`<path d="${poly([[x0, y0], [xm + nx, ym + ny], [x1, y1], [xm - nx, ym - ny]])}" fill="${INK}"/>`);
    } else {
      const r2 = R - 132;
      p.raw(`<line x1="${f(cx + r2 * Math.cos(t))}" y1="${f(cy + r2 * Math.sin(t))}" x2="${f(x1)}" y2="${f(y1)}" stroke="${INK}" stroke-width="11" stroke-linecap="round"/>`);
    }
  }
  // hands at 10:10, spade tips
  const hand = (ang, len, w, tip) => {
    const t = ((ang - 90) * Math.PI) / 180;
    const ux = Math.cos(t), uy = Math.sin(t), nx = -uy, ny = ux;
    const at = (s, n) => [cx + ux * s + nx * n, cy + uy * s + ny * n];
    return poly([at(-30, -w * 0.6), at(len - tip * 1.6, -w * 0.5), at(len - tip * 1.9, -tip), at(len - tip * 0.6, -tip * 0.7), at(len, 0),
      at(len - tip * 0.6, tip * 0.7), at(len - tip * 1.9, tip), at(len - tip * 1.6, w * 0.5), at(-30, w * 0.6)]);
  };
  p.part('hand_hour', { joint: [cx, cy] });
  p.raw(`<path d="${hand(-62, 118, 14, 22)}" fill="${INK}" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>`);
  p.part('hand_min', { joint: [cx, cy] });
  p.raw(`<path d="${hand(58, 172, 11, 18)}" fill="${INK}" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>`);
  p.part('cap', { joint: [cx, cy] });
  const cap = circ(cx, cy, 22);
  p.fill(cap, p.lin(PAL.gold), { line: 7, sil: false });
  p.spec(cx - 6, cy - 7, 6, 4);
  // glass glare
  p.part('glass', { joint: [cx, cy] });
  p.clip(face, `<path d="M${cx - 230},${cy - 40}Q${cx - 120},${cy - 210} ${cx + 60},${cy - 236}L${cx + 40},${cy - 196}Q${cx - 110},${cy - 170} ${cx - 196},${cy - 20}Z" fill="#fff" opacity="0.42"/>` +
    `<path d="M${cx + 150},${cy + 120}Q${cx + 110},${cy + 170} ${cx + 40},${cy + 196}" fill="none" stroke="#fff" stroke-width="12" stroke-linecap="round" opacity="0.35"/>`);
  p.spec(cx - 150, cy - 128, 30, 10, -40, 0.95);
  // case hotspots
  p.spec(cx - 196, cy - 196, 30, 12, -45, 0.9);
  p.part('sparkle', { fx: true });
  p.twinkle(cx - 214, cy - 214, 22);
  return p;
}

// ================================================================================================ H4 chalice
function chalice() {
  const p = new Pic();
  const cx = 512, rimY = 292, rx = 300, ry = 74;
  // foot
  p.part('foot', { joint: [cx, 852] });
  const footRim = ell(cx, 864, 214, 56);
  gold(p, footRim, { dx: -10, dy: -30 });
  const footTop = ell(cx, 850, 196, 44);
  p.fill(footTop, p.lin(['#FFF6BE', '#FFDA4F', '#F2A424', '#C7700F'], 0.3, 0, 0.7, 1), { line: 7, sil: false });
  const dome = smooth([[cx - 44, 752], [cx - 70, 800], [cx - 150, 836], [cx - 178, 852], [cx, 872], [cx + 178, 852], [cx + 150, 836], [cx + 70, 800], [cx + 44, 752]], true, 1 / 7);
  gold(p, dome, { dx: -24, dy: -10 });
  p.spec(cx - 100, 834, 30, 8, -12, 0.85);
  // stem + knot
  p.part('stem', { joint: [cx, 760] });
  const stem = rrect(cx - 26, 600, 52, 170, 18);
  gold(p, stem, { dx: -10, dy: 0 });
  const knot = ell(cx, 680, 66, 48);
  gold(p, knot, { dx: -18, dy: -16 });
  p.spec(cx - 26, 664, 16, 9, -25);
  const collar = ell(cx, 612, 78, 22);
  gold(p, collar, { dx: -10, dy: -8 });
  // bowl
  p.part('bowl', { joint: [cx, rimY + 316] });
  const bowl = `M${cx - rx},${rimY}C${cx - rx},${rimY + 196} ${cx - 160},${rimY + 316} ${cx},${rimY + 316}C${cx + 160},${rimY + 316} ${cx + rx},${rimY + 196} ${cx + rx},${rimY}Z`;
  gold(p, bowl, { dx: -40, dy: -30 });
  // decorative band with three rubies
  /** Half-width of the bowl at height y (the right-hand bezier, sampled). */
  const xAt = (y) => {
    const P = [[cx + rx, rimY], [cx + rx, rimY + 196], [cx + 160, rimY + 316], [cx, rimY + 316]];
    let best = null;
    for (let i = 0; i <= 400; i++) {
      const t = i / 400;
      const mt = 1 - t;
      const x = mt ** 3 * P[0][0] + 3 * mt * mt * t * P[1][0] + 3 * mt * t * t * P[2][0] + t ** 3 * P[3][0];
      const yy = mt ** 3 * P[0][1] + 3 * mt * mt * t * P[1][1] + 3 * mt * t * t * P[2][1] + t ** 3 * P[3][1];
      if (!best || Math.abs(yy - y) < Math.abs(best.y - y)) best = { x: x - cx, y: yy };
    }
    return best.x;
  };
  // bowl gloss (under the jewel band)
  p.clip(bowl, `<path d="M${cx - 252},${rimY + 50}Q${cx - 236},${rimY + 170} ${cx - 140},${rimY + 252}" fill="none" stroke="#fff" stroke-width="24" stroke-linecap="round" opacity="0.6"/>`);
  p.spec(cx - 246, rimY + 76, 11, 26, 8, 0.95);
  const bandY0 = rimY + 110, bandY1 = rimY + 178, c = 46;
  const w0 = xAt(bandY0), w1 = xAt(bandY1);
  const bandD = poly([
    ...Array.from({ length: 41 }, (_, i) => { const u = -1 + i / 20; return [cx + u * w0, bandY0 + c * (1 - u * u)]; }),
    ...Array.from({ length: 41 }, (_, i) => { const u = 1 - i / 20; return [cx + u * w1, bandY1 + c * (1 - u * u)]; }),
  ]);
  gold(p, bandD, { stops: ['#FFE98C', '#F7B52E', '#D9861A', '#9C4E0B'], dx: -20, dy: -6 });
  for (const u of [-0.66, 0.66, 0]) {
    const s = Math.sqrt(1 - u * u);
    const yb = (bandY0 + bandY1) / 2 + c * (1 - u * u);
    gem(p, cx + u * (w0 + w1) * 0.5 * 0.98, yb, 44 * s + 4, 50, PAL.ruby, { sil: false });
  }
  // rim + wine
  const rim = ell(cx, rimY, rx, ry);
  gold(p, rim, { dx: -10, dy: 14, shadeColor: PAL.goldDeep, op: 0.5 });
  p.part('wine', { joint: [cx, rimY + 4] });
  const wine = ell(cx, rimY + 4, rx - 32, ry - 20);
  p.fill(wine, p.rad(PAL.wine, 0.42, 0.62, 0.7), { line: 8, sil: false });
  p.shade(wine, '#4A0414', 0, 22, 0.55);
  p.raw(`<ellipse cx="${cx - 90}" cy="${rimY - 8}" rx="120" ry="16" fill="#fff" opacity="0.42"/>`);
  p.spec(cx - 150, rimY - 10, 30, 7, 0, 0.95);
  p.spec(cx + 120, rimY + 18, 14, 4, 0, 0.6);
  p.part('drip', { joint: [cx + 96, rimY + ry - 14] });
  // a drip over the front rim, between the centre and right rubies
  const dx0 = cx + 96, dy0 = rimY + ry - 14;
  const drip = `M${dx0 - 13},${dy0}C${dx0 - 13},${dy0 + 26} ${dx0 - 17},${dy0 + 40} ${dx0 - 14},${dy0 + 56}C${dx0 - 11},${dy0 + 76} ${dx0 + 15},${dy0 + 76} ${dx0 + 16},${dy0 + 54}C${dx0 + 17},${dy0 + 38} ${dx0 + 12},${dy0 + 24} ${dx0 + 13},${dy0}Z`;
  p.fill(drip, p.lin(PAL.wine, 0.3, 0, 0.7, 1, [0, 0.5, 1]), { line: 7, sil: false });
  p.spec(dx0 - 5, dy0 + 52, 4, 8, 0, 0.9);
  p.part('sparkle', { fx: true });
  p.spec(cx - 230, rimY - 30, 26, 8, -10, 0.95);
  p.twinkle(cx - 262, rimY - 26, 26);
  return p;
}

// ================================================================================================ H5 keys
function keys() {
  const p = new Pic();
  const ringC = [512, 232], Ro = 156, Ri = 116;
  const key = (px, py, ang, metal, shadeC, bow) => {
    const g = (x, y) => rot(x, y, px, py, ang);
    const P = (pts) => pts.map(([x, y]) => g(x, y));
    const len = 470;
    // bit (teeth) at the bottom, on the right of the shaft
    const by = py + len;
    const bit = poly(P([[px + 16, by - 100], [px + 92, by - 100], [px + 92, by - 72], [px + 66, by - 72], [px + 66, by - 52], [px + 92, by - 52], [px + 92, by - 18], [px + 50, by - 18], [px + 50, by - 6], [px + 16, by - 6]]));
    p.fill(bit, p.lin(metal), {});
    p.shade(bit, shadeC, -10, -12, 0.6);
    // shaft
    const shaft = poly(P([[px - 22, py + 120], [px + 22, py + 120], [px + 22, by - 8], [px + 12, by + 8], [px - 12, by + 8], [px - 22, by - 8]]));
    p.fill(shaft, p.lin(metal, 0, 0.3, 1, 0.7), {});
    p.shade(shaft, shadeC, -16, 0, 0.6);
    const sh = P([[px - 10, py + 140], [px - 10, by - 30]]);
    p.raw(`<path d="M${f(sh[0][0])},${f(sh[0][1])}L${f(sh[1][0])},${f(sh[1][1])}" stroke="#fff" stroke-width="9" stroke-linecap="round" opacity="0.7"/>`);
    // collars
    for (const yy of [py + 150, py + 188]) {
      const c = poly(P([[px - 36, yy - 12], [px + 36, yy - 12], [px + 36, yy + 12], [px - 36, yy + 12]]));
      p.fill(c, p.lin(metal, 0, 0.2, 1, 0.8), {});
      p.shade(c, shadeC, -10, -6, 0.6);
    }
    // bow
    const [bx, byy] = g(px, py + 52);
    let outer;
    let hole;
    if (bow === 'trefoil') {
      outer = polar(bx, byy, (t) => 92 * (0.8 + 0.2 * Math.pow(Math.abs(Math.cos(1.5 * (t - (ang * Math.PI) / 180 + Math.PI / 2))), 0.7)), 180);
      hole = polar(bx, byy, (t) => 34 * (0.85 + 0.15 * Math.cos(3 * (t - (ang * Math.PI) / 180 + Math.PI / 2))), 90);
    } else if (bow === 'quatrefoil') {
      outer = polar(bx, byy, (t) => 86 * (0.82 + 0.18 * Math.pow(Math.abs(Math.cos(2 * (t - (ang * Math.PI) / 180))), 0.8)), 180);
      hole = polar(bx, byy, (t) => 36 / Math.pow(Math.pow(Math.abs(Math.cos(t - (ang * Math.PI) / 180 + Math.PI / 4)), 1.4) + Math.pow(Math.abs(Math.sin(t - (ang * Math.PI) / 180 + Math.PI / 4)), 1.4), 1 / 1.4), 90);
    } else {
      outer = polar(bx, byy, (t) => 84 * (1 + 0.07 * Math.cos(10 * t)), 200);
      hole = circ(bx, byy, 40);
    }
    p.fill(outer + hole, p.lin(metal), { rule: 'evenodd' });
    p.shade(outer + hole, shadeC, -18, -20, 0.6, 'evenodd');
    p.spec(bx - 50, byy - 46, 18, 8, -40, 0.9);
    return [bx, byy];
  };
  // keys hang from the bottom of the ring: side keys first (behind)
  p.part('key_silver', { joint: [410, 352] });
  key(410, 352, 24, PAL.silver, PAL.silverShade, 'quatrefoil');
  p.part('key_bronze', { joint: [614, 352] });
  key(614, 352, -24, PAL.bronze, PAL.bronzeShade, 'ring');
  p.part('key_gold', { joint: [512, 372] });
  key(512, 372, 0, PAL.gold, PAL.goldShade, 'trefoil');
  // iron ring over the bows
  p.part('ring', { joint: ringC });
  const ring = circ(ringC[0], ringC[1], Ro) + circ(ringC[0], ringC[1], Ri);
  p.fill(ring, p.lin(PAL.iron, 0.2, 0, 0.8, 1), { rule: 'evenodd' });
  p.shade(ring, '#0E1020', -20, -26, 0.6, 'evenodd');
  p.clip(ring, `<circle cx="${ringC[0]}" cy="${ringC[1]}" r="${(Ro + Ri) / 2 + 6}" fill="none" stroke="#DDE6FF" stroke-width="12" stroke-linecap="round" stroke-dasharray="190 2000" transform="rotate(178 ${ringC[0]} ${ringC[1]})" opacity="0.85"/>` +
    `<circle cx="${ringC[0]}" cy="${ringC[1]}" r="${Ri + 6}" fill="none" stroke="#8FA2E0" stroke-width="6" stroke-dasharray="120 2000" transform="rotate(20 ${ringC[0]} ${ringC[1]})" opacity="0.7"/>`, 'evenodd');
  p.spec(ringC[0] - 112, ringC[1] - 70, 9, 20, 30, 0.9);
  p.part('sparkle', { fx: true });
  p.twinkle(ringC[0] - 14, 856, 24);
  return p;
}

// ================================================================================================ S safe
function safe() {
  const p = new Pic();
  const x0 = 206, y0 = 230, w = 560, h = 560, d = 64;
  // feet (back right foot first)
  p.part('foot_back', { joint: [x0 + w + d - 46, y0 + h - d + 6] });
  const foot = (x, y, s = 1) => rrect(x - 44 * s, y, 88 * s, 58 * s, 22 * s);
  for (const [x, y, s] of [[x0 + w + d - 46, y0 + h - d + 6, 0.8]]) gold(p, foot(x, y, s), { dx: -8, dy: -10 });
  // body: side + top faces, then the front
  p.part('body', { joint: [x0 + w / 2, y0 + h] });
  const side = poly([[x0 + w - 4, y0 + 24], [x0 + w + d - 4, y0 - d + 24], [x0 + w + d, y0 + h - d - 20], [x0 + w, y0 + h - 4]]);
  p.fill(side, p.lin(['#C21A34', '#8E0E24', '#5E0716', '#3C040E'], 0, 0, 1, 1), {});
  const top = poly([[x0 + 24, y0], [x0 + d + 24, y0 - d], [x0 + w + d - 10, y0 - d], [x0 + w, y0 + 4]]);
  p.fill(top, p.lin(['#FF9AA5', '#EE4256', '#C21A34', '#9C1029'], 0, 0, 1, 1), {});
  const front = rrect(x0, y0, w, h, 56);
  p.fill(front, p.rad(PAL.crimson, 0.32, 0.25, 0.95, [0, 0.36, 0.78, 1]), {});
  p.shade(front, PAL.crimsonShade, -26, -30, 0.5);
  // gold trim on the edges
  for (const [a, b] of [[[x0 + 46, y0 - 2], [x0 + w - 30, y0 - 2]], [[x0 + w + 2, y0 + 40], [x0 + w + 2, y0 + h - 40]]]) {
    p.line(`M${a[0]},${a[1]}L${b[0]},${b[1]}`, p.lin(PAL.gold), 12, { casing: 8 });
  }
  p.line(`M${x0 + w + 14},${y0 + 4}L${x0 + w + d - 6},${y0 - d + 22}`, p.lin(PAL.gold), 12, { casing: 8 });
  // door panel with gold frame
  const door = rrect(x0 + 50, y0 + 50, w - 100, h - 100, 34);
  p.fill(door, p.lin(['#FFE68A', '#FFC93F', '#E8961C', '#A85A0A'], 0.2, 0, 0.8, 1), { sil: false, line: INN });
  const panel = rrect(x0 + 72, y0 + 72, w - 144, h - 144, 22);
  p.fill(panel, p.rad(['#F2525F', '#C8203A', '#94122B', '#5E0716'], 0.35, 0.3, 0.9, [0, 0.4, 0.8, 1]), { sil: false, line: 8 });
  p.shade(panel, PAL.crimsonShade, 18, 22, 0.45);
  // rivets on the door frame
  for (const [rx, ry] of [[x0 + 61, y0 + 61], [x0 + w - 61, y0 + 61], [x0 + 61, y0 + h - 61], [x0 + w - 61, y0 + h - 61],
    [x0 + w / 2, y0 + 61], [x0 + w / 2, y0 + h - 61], [x0 + 61, y0 + h / 2], [x0 + w - 61, y0 + h / 2]]) {
    const r = circ(rx, ry, 11);
    p.fill(r, p.rad(['#FFF6C8', '#FFC93F', '#B8620E'], 0.35, 0.3, 0.8), { line: 5, sil: false });
  }
  // hinges on the left edge
  for (const hy of [y0 + 120, y0 + h - 190]) {
    const hg = rrect(x0 - 26, hy, 44, 72, 16);
    gold(p, hg, { dx: -6, dy: -8 });
    p.spec(x0 - 12, hy + 16, 5, 12, 0, 0.85);
  }
  // glossy paint highlights
  p.clip(front, `<path d="M${x0 + 26},${y0 + 150}Q${x0 + 26},${y0 + 30} ${x0 + 150},${y0 + 26}" fill="none" stroke="#fff" stroke-width="18" stroke-linecap="round" opacity="0.7"/>`);
  p.spec(x0 + 70, y0 + 40, 24, 9, -30, 0.9);
  // combination dial
  const dc = [x0 + w * 0.42, y0 + h * 0.5];
  p.part('dial', { joint: dc });
  const dialO = circ(dc[0], dc[1], 132);
  gold(p, dialO, { dx: -22, dy: -26 });
  const dialRing = circ(dc[0], dc[1], 104);
  p.fill(dialRing, p.lin(['#C06A10', '#F2A62A', '#FFDA55', '#FFF4C0'], 0.25, 0, 0.75, 1), { sil: false, line: 7 });
  for (let i = 0; i < 40; i++) {
    const t = (i / 40) * Math.PI * 2;
    const r0 = i % 5 === 0 ? 76 : 86, r1 = 98;
    p.raw(`<line x1="${f(dc[0] + r0 * Math.cos(t))}" y1="${f(dc[1] + r0 * Math.sin(t))}" x2="${f(dc[0] + r1 * Math.cos(t))}" y2="${f(dc[1] + r1 * Math.sin(t))}" stroke="${INK}" stroke-width="${i % 5 === 0 ? 7 : 4}" stroke-linecap="round"/>`);
  }
  const knob = polar(dc[0], dc[1], (t) => 64 * (1 + 0.06 * Math.cos(16 * t)), 200);
  gold(p, knob, { dx: -14, dy: -16 });
  const knobTop = circ(dc[0], dc[1], 40);
  p.fill(knobTop, p.rad(['#FFF8D0', '#FFD84D', '#E39A22'], 0.35, 0.3, 0.8), { sil: false, line: 7 });
  p.spec(dc[0] - 14, dc[1] - 16, 12, 6, -35);
  p.spec(dc[0] - 70, dc[1] - 92, 26, 10, -40, 0.85);
  // pointer above the dial
  p.part('pointer', { joint: [dc[0], dc[1] - 134] });
  p.fill(poly([[dc[0] - 18, dc[1] - 146], [dc[0] + 18, dc[1] - 146], [dc[0], dc[1] - 122]]), PAL.gold[1], { sil: false, line: 7 });
  // spoked lever wheel
  const hc = [x0 + w * 0.8, y0 + h * 0.5];
  p.part('wheel', { joint: hc });
  for (const a of [90, 210, 330]) {
    const t = (a * Math.PI) / 180;
    const ex = hc[0] + 82 * Math.cos(t), ey = hc[1] + 82 * Math.sin(t);
    p.line(`M${f(hc[0])},${f(hc[1])}L${f(ex)},${f(ey)}`, p.lin(PAL.gold), 22);
    const ball = circ(ex, ey, 20);
    gold(p, ball, { dx: -6, dy: -7, line: 7 });
    p.spec(ex - 6, ey - 7, 6, 4);
  }
  const hub = circ(hc[0], hc[1], 34);
  gold(p, hub, { dx: -10, dy: -10, line: 8 });
  p.spec(hc[0] - 10, hc[1] - 11, 9, 5);
  // front feet
  p.part('feet', { joint: [x0 + w / 2, y0 + h + 20] });
  for (const fx of [x0 + 86, x0 + w - 86]) {
    const ft = foot(fx, y0 + h - 14);
    gold(p, ft, { dx: -10, dy: -14 });
    p.spec(fx - 22, y0 + h + 2, 12, 5, 0, 0.85);
  }
  p.part('sparkle', { fx: true });
  p.twinkle(x0 + 30, y0 - 10, 26);
  return p;
}

// ------------------------------------------------------------------------------------------ main
const BUILDERS = { H2: egg, H3: watch, H4: chalice, H5: keys, S: safe };
const png = (svg) => new Resvg(svg, { fitTo: { mode: 'original' }, background: 'rgba(0,0,0,0)' }).render().asPng();
fs.mkdirSync(OUT_DIR, { recursive: true });
for (const id of only.length ? only : Object.keys(BUILDERS)) {
  const p = BUILDERS[id]();
  const svg = p.svg();
  fs.writeFileSync(path.join(OUT_DIR, `${id}.svg`), svg);
  fs.writeFileSync(path.join(OUT_DIR, `${id}.png`), png(svg));
  // one 1024 px layer per part (the rig cut: tools/mhart/rigs/cut_vector.py) + the part list with pivots
  const dir = path.join(OUT_DIR, id);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const parts = p.parts.map((P, z) => {
    fs.writeFileSync(path.join(dir, `${P.name}.png`), png(p.svg([P.name])));
    return { name: P.name, z, ...P.meta };
  });
  fs.writeFileSync(path.join(OUT_DIR, `${id}.parts.json`), JSON.stringify({ symbol: id, master: 1024, parts }, null, 1) + '\n');
  console.log(`${id}: ${parts.map((q) => q.name).join(', ')}`);
}
