#!/usr/bin/env node
/**
 * Renders the demo symbol's rig-ready PARTS (cel-shaded vector art, ART_BIBLE palette and
 * outline weights) with @resvg/resvg-js, and writes parts.json the way the split stage
 * (tools/split, PIPELINE 3.1) would: one trimmed PNG per part on the 360x360 @2x canvas,
 * 4 px transparent padding, bbox + joint (+ tip) in canvas image space (y down).
 *
 *   node tools/spine/examples/demo_symbol/make_parts.mjs [--out <dir>] [--help]
 *
 * Output (default: next to this file): images/sym_demo/<part>.png, parts.json.
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
const outDir = path.resolve(argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : HERE);
const SYM = 'sym_demo';
const CANVAS = 360;
const PAD = 4;

// ART_BIBLE palette (art/bible/artbible.json)
const C = {
  ink: '#000000',
  plum: '#4B283D',
  plumLight: '#6B3A57',
  gold: '#FFC629',
  goldShade: '#E2861A',
  goldDeep: '#9A4A0C',
  goldLight: '#FFF0A0',
  spec: '#FFFFFF',
  cone: '#3B1A33',
  coneRing: '#6B3A57',
  socket: '#1A0812',
  window: '#2A0F22',
  sclera: '#FFFFFF',
  scleraShade: '#E6D6CF',
  glow: '#FFD54A',
};
const OUT = 9; // outer outline @2x (ART_BIBLE outline.symbolOuter.at2x)
const INN = 5; // interior lines @2x

// ---------------------------------------------------------------- geometry (canvas px, y down)
const body = { x: 72, y: 164, w: 216, h: 148, r: 30 };
const ext = 9; // plum extrusion toward the lower right
const speakers = { speaker_R: [126, 272], speaker_L: [234, 272] }; // character's own L/R
const SPK = 32; // speaker rim radius
const eyes = { eye_R: [162, 209], eye_L: [198, 209] };
const EYE = [15, 19]; // sclera radii
const antenna = { base: [252, 186], joint: [256, 164], mid: [262, 125], tip: [268, 86], ball: 13 };
const glowC = [180, 226];

const rrect = (b, extra = '') =>
  `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="${b.r}" ${extra}/>`;

const partsSvg = {
  fx_glow: () => `
    <defs><filter id="g" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="16"/></filter></defs>
    <ellipse cx="${glowC[0]}" cy="${glowC[1]}" rx="116" ry="104" fill="${C.glow}" filter="url(#g)"/>`,

  antenna: () => {
    const [bx, by] = antenna.base;
    const [tx, ty] = antenna.tip;
    return `
    <line x1="${bx}" y1="${by}" x2="${tx}" y2="${ty}" stroke="${C.ink}" stroke-width="${10 + 2 * INN}" stroke-linecap="round"/>
    <line x1="${bx}" y1="${by}" x2="${tx}" y2="${ty}" stroke="${C.goldShade}" stroke-width="10" stroke-linecap="round"/>
    <line x1="${bx - 2}" y1="${by - 4}" x2="${tx - 3}" y2="${ty + 6}" stroke="${C.goldLight}" stroke-width="3" stroke-linecap="round"/>
    <circle cx="${tx}" cy="${ty}" r="${antenna.ball}" fill="${C.ink}" stroke="${C.ink}" stroke-width="${INN + 2}"/>
    <clipPath id="ball"><circle cx="${tx}" cy="${ty}" r="${antenna.ball}"/></clipPath>
    <g clip-path="url(#ball)">
      <circle cx="${tx}" cy="${ty}" r="${antenna.ball}" fill="${C.goldShade}"/>
      <circle cx="${tx - 4}" cy="${ty - 4}" r="${antenna.ball}" fill="${C.gold}"/>
    </g>
    <circle cx="${tx}" cy="${ty}" r="${antenna.ball}" fill="none" stroke="${C.ink}" stroke-width="${INN + 2}"/>
    <ellipse cx="${tx - 5}" cy="${ty - 6}" rx="3.5" ry="2.4" fill="${C.spec}" transform="rotate(-35 ${tx - 5} ${ty - 6})"/>`;
  },

  body: () => {
    const b = body;
    const shade = `M ${b.x} ${b.y + 124} L ${b.x + b.w} ${b.y + 104} L ${b.x + b.w} ${b.y + b.h} L ${b.x} ${b.y + b.h} Z
                   M ${b.x + b.w - 40} ${b.y} L ${b.x + b.w} ${b.y} L ${b.x + b.w} ${b.y + b.h} L ${b.x + b.w - 52} ${b.y + b.h} Z`;
    const deep = `M ${b.x} ${b.y + b.h - 16} L ${b.x + b.w} ${b.y + b.h - 26} L ${b.x + b.w} ${b.y + b.h} L ${b.x} ${b.y + b.h} Z`;
    const sockets = Object.values(speakers)
      .map(([cx, cy]) => `<circle cx="${cx}" cy="${cy}" r="${SPK + 2}" fill="${C.socket}" stroke="${C.ink}" stroke-width="${INN}"/>`)
      .join('');
    return `
    <defs><clipPath id="bodyClip">${rrect(b)}</clipPath></defs>
    <!-- carry handle -->
    <path d="M 120 176 C 120 120 240 120 240 176" fill="none" stroke="${C.ink}" stroke-width="${14 + 2 * OUT}" stroke-linecap="round"/>
    <path d="M 120 176 C 120 120 240 120 240 176" fill="none" stroke="${C.goldShade}" stroke-width="14" stroke-linecap="round"/>
    <path d="M 128 168 C 130 132 196 126 218 136" fill="none" stroke="${C.gold}" stroke-width="7" stroke-linecap="round"/>
    <!-- plum extrusion, lower right -->
    ${rrect({ ...b, x: b.x + ext, y: b.y + ext }, `fill="${C.plum}" stroke="${C.ink}" stroke-width="${OUT}"`)}
    <!-- body -->
    ${rrect(b, `fill="${C.gold}"`)}
    <g clip-path="url(#bodyClip)">
      <path d="${shade}" fill="${C.goldShade}"/>
      <path d="${deep}" fill="${C.goldDeep}"/>
      <path d="M ${b.x + 22} ${b.y + 58} L ${b.x + 22} ${b.y + 30} Q ${b.x + 22} ${b.y + 16} ${b.x + 38} ${b.y + 16} L ${b.x + 120} ${b.y + 16}"
            fill="none" stroke="${C.goldLight}" stroke-width="9" stroke-linecap="round"/>
    </g>
    ${rrect(b, `fill="none" stroke="${C.ink}" stroke-width="${OUT}"`)}
    <line x1="${b.x + 22}" y1="${b.y + 80}" x2="${b.x + 22}" y2="${b.y + 66}" stroke="${C.spec}" stroke-width="7" stroke-linecap="round"/>
    <!-- cassette window (the face plate) -->
    <rect x="128" y="184" width="104" height="50" rx="17" fill="${C.window}" stroke="${C.ink}" stroke-width="${INN}"/>
    <path d="M 138 194 L 152 194" stroke="${C.plumLight}" stroke-width="4" stroke-linecap="round"/>
    <!-- speaker sockets (speakers are separate parts that pump) -->
    ${sockets}
    <!-- deck buttons -->
    <rect x="166" y="247" width="28" height="11" rx="5.5" fill="${C.goldDeep}" stroke="${C.ink}" stroke-width="${INN}"/>
    <rect x="166" y="267" width="28" height="11" rx="5.5" fill="${C.goldDeep}" stroke="${C.ink}" stroke-width="${INN}"/>`;
  },

  ...Object.fromEntries(
    Object.entries(speakers).map(([name, [cx, cy]]) => [
      name,
      () => `
    <clipPath id="rim"><circle cx="${cx}" cy="${cy}" r="${SPK}"/></clipPath>
    <g clip-path="url(#rim)">
      <circle cx="${cx}" cy="${cy}" r="${SPK}" fill="${C.goldShade}"/>
      <circle cx="${cx - 4}" cy="${cy - 4}" r="${SPK - 1}" fill="${C.gold}"/>
    </g>
    <circle cx="${cx}" cy="${cy}" r="${SPK}" fill="none" stroke="${C.ink}" stroke-width="${INN + 2}"/>
    <circle cx="${cx}" cy="${cy}" r="${SPK - 9}" fill="${C.cone}" stroke="${C.ink}" stroke-width="${INN}"/>
    <circle cx="${cx}" cy="${cy}" r="${SPK - 17}" fill="none" stroke="${C.coneRing}" stroke-width="4"/>
    <clipPath id="cap"><circle cx="${cx}" cy="${cy}" r="10"/></clipPath>
    <g clip-path="url(#cap)">
      <circle cx="${cx}" cy="${cy}" r="10" fill="${C.goldShade}"/>
      <circle cx="${cx - 3}" cy="${cy - 3}" r="10" fill="${C.gold}"/>
    </g>
    <circle cx="${cx}" cy="${cy}" r="10" fill="none" stroke="${C.ink}" stroke-width="4"/>
    <ellipse cx="${cx - 3.5}" cy="${cy - 4}" rx="2.6" ry="1.8" fill="${C.spec}"/>
    <path d="M ${cx - 22} ${cy - 12} A 26 26 0 0 1 ${cx - 10} ${cy - 23}" fill="none" stroke="${C.goldLight}" stroke-width="4" stroke-linecap="round"/>`,
    ]),
  ),

  ...Object.fromEntries(
    Object.entries(eyes).map(([name, [cx, cy]]) => [
      name,
      () => `
    <clipPath id="sc"><ellipse cx="${cx}" cy="${cy}" rx="${EYE[0]}" ry="${EYE[1]}"/></clipPath>
    <g clip-path="url(#sc)">
      <ellipse cx="${cx}" cy="${cy}" rx="${EYE[0]}" ry="${EYE[1]}" fill="${C.scleraShade}"/>
      <ellipse cx="${cx - 3}" cy="${cy - 4}" rx="${EYE[0]}" ry="${EYE[1]}" fill="${C.sclera}"/>
    </g>
    <ellipse cx="${cx}" cy="${cy}" rx="${EYE[0]}" ry="${EYE[1]}" fill="none" stroke="${C.ink}" stroke-width="${INN}"/>
    <ellipse cx="${cx + 1.5}" cy="${cy + 3}" rx="7.5" ry="9.5" fill="${C.ink}"/>
    <circle cx="${cx - 1.5}" cy="${cy - 1}" r="3" fill="${C.spec}"/>`,
    ]),
  ),
};

// z order (back -> front), bones, joints/tips (canvas image space)
const PLAN = [
  { name: 'fx_glow', z: 0, bone: 'fx_glow', parent: 'root', joint: glowC, blend: 'additive', color: 'ffffff00', fixedBox: [12, 70, 336, 312] },
  { name: 'antenna', z: 1, bone: 'phys_antenna_1', parent: 'phys_jelly', joint: antenna.joint, tip: antenna.mid },
  { name: 'body', z: 2, bone: 'body' },
  { name: 'speaker_R', z: 3, bone: 'face_speaker_R', parent: 'body', joint: speakers.speaker_R },
  { name: 'speaker_L', z: 4, bone: 'face_speaker_L', parent: 'body', joint: speakers.speaker_L },
  { name: 'eye_R', z: 5, bone: 'face_eye_R', parent: 'phys_jelly', joint: eyes.eye_R },
  { name: 'eye_L', z: 6, bone: 'face_eye_L', parent: 'phys_jelly', joint: eyes.eye_L },
];

const svgDoc = (inner, box) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${box[2]}" height="${box[3]}" viewBox="${box.join(' ')}">${inner}</svg>`;

const render = (inner, box) => new Resvg(svgDoc(inner, box), { fitTo: { mode: 'original' }, shapeRendering: 2 }).render();

const alphaBox = (img) => {
  const { width, height } = img;
  const px = img.pixels;
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
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

const imgDir = path.join(outDir, 'images', SYM);
fs.mkdirSync(imgDir, { recursive: true });
const parts = [];
for (const p of PLAN) {
  const inner = partsSvg[p.name]();
  let box;
  if (p.fixedBox) box = p.fixedBox;
  else {
    const full = render(inner, [0, 0, CANVAS, CANVAS]);
    const ab = alphaBox(full);
    if (!ab) throw new Error(`part ${p.name} rendered empty`);
    box = [ab[0] - PAD, ab[1] - PAD, ab[2] - ab[0] + 2 * PAD, ab[3] - ab[1] + 2 * PAD];
  }
  const png = render(inner, box).asPng();
  fs.writeFileSync(path.join(imgDir, `${p.name}.png`), png);
  const entry = { name: p.name, bbox: box, z: p.z, bone: p.bone };
  if (p.parent) entry.parent = p.parent;
  if (p.joint) entry.joint = p.joint;
  if (p.tip) entry.tip = p.tip;
  if (p.blend) entry.blend = p.blend;
  if (p.color) entry.color = p.color;
  parts.push(entry);
  console.log(`make_parts: ${p.name.padEnd(10)} bbox ${box.join(',')}`);
}
const doc = {
  $comment: 'Written by make_parts.mjs (stand-in for tools/split). Coordinates: 360x360 @2x canvas, image space (y down). make_blur.py adds blur entries.',
  symbol: 'demo',
  canvas: [CANVAS, CANVAS],
  images: 'images',
  parts,
};
fs.writeFileSync(path.join(outDir, 'parts.json'), `${JSON.stringify(doc, null, 2)}\n`);
console.log(`make_parts: wrote ${path.relative(process.cwd(), path.join(outDir, 'parts.json'))}`);
