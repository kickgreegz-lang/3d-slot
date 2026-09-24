import { type Graphics, GraphicsPath, type Renderer, type Texture } from 'pixi.js';
import { SYMBOLS } from '../../config/game';
import { CelCanvas, at, shape, sparkle, streak } from './cel';
import { GOLD, INK, Light, OUTLINE, PLUM, WHITE, mix } from './palette';
import { blob, capsule, roundedPoly } from './shapes';

/**
 * High-pay placeholders (Swamp Funk): H1 Golden Boombox, H2 Vinyl Record,
 * H3 Crawfish, H4 Hot Sauce. Authored upright on the 180 design-px canvas —
 * the symbol view applies SYMBOLS[id].restAngle, and each Light is counter-rotated
 * so extrusion/shadows still read lower-right after that rotation.
 */

const extOf = (deep: number): number => mix(deep, PLUM, 0.5);
const GOLD_EXT = extOf(GOLD.deep);
const DARK = { base: 0x46355e, shade: 0x2b1f3d, light: 0x6c5a8c };

// ---------------------------------------------------------------------------
// H1 — Golden Boombox

export const buildBoombox = (renderer: Renderer, size: number): Texture => {
  const c = new CelCanvas(new Light(SYMBOLS.H1.restAngle), size);
  const y = 6;
  const handle = roundedPoly([
    [44, 70 + y, 0],
    [44, 26 + y, 16],
    [136, 26 + y, 16],
    [136, 70 + y, 0],
    [123, 70 + y, 0],
    [123, 39 + y, 8],
    [57, 39 + y, 8],
    [57, 70 + y, 0],
  ]);
  const lugs = new GraphicsPath().roundRect(37, 50 + y, 26, 18, 6).roundRect(117, 50 + y, 26, 18, 6);
  const body = new GraphicsPath().roundRect(14, 60 + y, 152, 84, 22);
  const feet = new GraphicsPath().roundRect(30, 138 + y, 28, 12, 5).roundRect(122, 138 + y, 28, 12, 5);

  c.body([handle, lugs, body, feet], 8, OUTLINE, GOLD_EXT);
  c.part({ shape: feet, fill: DARK.base, shade: DARK.shade, shadeOff: 3 });
  c.part({
    shape: handle,
    fill: DARK.base,
    shade: DARK.shade,
    shadeOff: 4,
    rim: DARK.light,
    rimOff: 3,
    paint: (g) => streak(g, 62, 30 + y, 90, 27 + y, 118, 30 + y, 1.6),
  });
  c.part({ shape: lugs, fill: GOLD.base, shade: GOLD.shade, shadeOff: 4 });
  c.part({
    shape: body,
    fill: GOLD.base,
    shade: GOLD.shade,
    shadeOff: 10,
    shadeShrink: 0.03,
    rim: GOLD.light,
    rimOff: 5,
    paint: (g) => {
      streak(g, 34, 66 + y, 70, 62 + y, 108, 65 + y, 2.4);
      streak(g, 20, 84 + y, 17, 102 + y, 20, 122 + y, 2.2);
    },
  });

  // tape deck with piano keys (recessed: shadow falls top-left)
  const deck = new GraphicsPath().roundRect(60, 66 + y, 60, 18, 6);
  c.part({
    shape: deck,
    fill: DARK.base,
    shade: DARK.shade,
    shadeOff: -4,
    paint: (g) => {
      const keys = [0xe9e0f5, 0xe9e0f5, 0xff3fa8, 0xe9e0f5];
      keys.forEach((k, i) => {
        const x = 65 + i * 13.2;
        const pressed = i === 2;
        g.roundRect(x, 70 + y + (pressed ? 3 : 0), 10.5, 11, 2.5).fill(mix(k, 0x5a3d7a, 0.35));
        g.roundRect(x, 70 + y + (pressed ? 3 : 0), 10.5, 8, 2.5).fill(k);
        g.roundRect(x, 70 + y + (pressed ? 3 : 0), 10.5, 11, 2.5).stroke({ width: 1.6, color: INK });
      });
    },
  });

  // speakers
  for (const [sx, sy] of [
    [50, 110 + y],
    [130, 110 + y],
  ] as const) {
    c.part({
      shape: new GraphicsPath().circle(sx, sy, 29),
      fill: GOLD.base,
      shade: GOLD.shade,
      shadeOff: 5,
      rim: GOLD.light,
      rimOff: 3,
    });
    c.part({
      shape: new GraphicsPath().circle(sx, sy, 22.5),
      fill: DARK.base,
      shade: DARK.shade,
      shadeOff: -5,
      paint: (g) => {
        g.circle(sx, sy, 15).stroke({ width: 2, color: DARK.shade });
        g.arc(sx, sy, 19, 0.1, 1.4).stroke({ width: 2.2, color: DARK.light, cap: 'round' });
      },
    });
    c.part({
      shape: new GraphicsPath().circle(sx, sy, 8),
      fill: GOLD.base,
      shade: GOLD.shade,
      shadeOff: 3,
      paint: (g) => g.circle(sx - 2.6, sy - 2.8, 2.2).fill(WHITE),
    });
    // bezel screws
    c.ink((g) => {
      for (const a of [0.8, 2.4, 3.9, 5.5]) g.circle(sx + Math.cos(a) * 26, sy + Math.sin(a) * 26, 1.5).fill(DARK.shade);
    });
  }

  // EQ meter between the speakers
  const eq = new GraphicsPath().roundRect(82.5, 90 + y, 15, 40, 4);
  c.part({
    shape: eq,
    fill: 0x1a1024,
    paint: (g) => {
      const bars: [number, number][] = [
        [0xff3fa8, 26],
        [0x35f2e0, 34],
        [0xb6f23a, 20],
      ];
      bars.forEach(([col, h], i) => {
        g.rect(85 + i * 3.6, 90 + y + 38 - h, 2.6, h).fill(col);
      });
    },
  });

  return c.bake(renderer);
};

// ---------------------------------------------------------------------------
// H2 — Vinyl Record

export const buildVinyl = (renderer: Renderer, size: number): Texture => {
  const c = new CelCanvas(new Light(SYMBOLS.H2.restAngle), size);
  const cx = 88;
  const cy = 88;
  const R = 68;
  const disc = new GraphicsPath().circle(cx, cy, R);
  const VINYL = { base: 0x2a2334, shade: 0x141019, groove: 0x3e3550, sheen: 0x564a6e };
  c.body([disc], 8, OUTLINE, PLUM);
  c.part({
    shape: disc,
    fill: VINYL.base,
    shade: VINYL.shade,
    shadeOff: 8,
    shadeShrink: 0.02,
    paint: (g) => {
      // two opposing sheen wedges (the classic record reflection)
      const wedge = (a0: number, a1: number, col: number) =>
        g
          .moveTo(cx, cy)
          .lineTo(cx + Math.cos(a0) * 90, cy + Math.sin(a0) * 90)
          .lineTo(cx + Math.cos(a1) * 90, cy + Math.sin(a1) * 90)
          .closePath()
          .fill(col);
      wedge(3.55, 4.05, VINYL.sheen);
      wedge(0.41, 0.8, mix(VINYL.sheen, VINYL.base, 0.45));
      for (const r of [61, 54, 47, 40]) g.circle(cx, cy, r).stroke({ width: 1.3, color: VINYL.groove });
      // crisp rim-light streak along the top-left edge
      g.arc(cx, cy, R - 6, 3.3, 4.2).stroke({ width: 3.4, color: WHITE, cap: 'round' });
      g.arc(cx, cy, R - 6, 4.38, 4.55).stroke({ width: 3.4, color: WHITE, cap: 'round' });
    },
  });
  // label
  const PINK = { base: 0xff3fa8, shade: 0xc81f7c, light: 0xff8fcf };
  const label = new GraphicsPath().circle(cx, cy, 27);
  c.part({
    shape: label,
    fill: PINK.base,
    shade: PINK.shade,
    shadeOff: 4,
    rim: PINK.light,
    rimOff: 2.5,
    paint: (g) => {
      g.circle(cx, cy, 19).stroke({ width: 1.6, color: PINK.shade });
      // lightning-bolt label mark
      g.poly([cx - 3, cy - 17, cx + 7, cy - 17, cx + 2, cy - 7, cx + 9, cy - 7, cx - 5, cy + 12, cx - 1, cy - 2, cx - 8, cy - 2], true)
        .fill(0xffe34a)
        .stroke({ width: 1.6, color: INK, join: 'round' });
    },
  });
  c.part({ shape: new GraphicsPath().circle(cx, cy, 4.5), fill: 0x0c0810, line: 1.5 });
  c.ink((g) => sparkle(g, cx - 44, cy - 50, 9, 0.2));
  return c.bake(renderer);
};

// ---------------------------------------------------------------------------
// H3 — Crawfish (cartoon, claws raised)

export const buildCrawfish = (renderer: Renderer, size: number): Texture => {
  const c = new CelCanvas(new Light(SYMBOLS.H3.restAngle), size);
  const RED = { base: 0xff5a2a, shade: 0xc9321c, light: 0xff9a5c, deep: 0x7a1a0e };
  const EXT = extOf(RED.deep);

  // claw, authored pointing up with the wrist at the origin; outer side = -x
  const clawLocal = blob([-13, 2, -22, -16, -20, -38, -8, -52, -2, -42, 2, -30, 6, -36, 13, -44, 19, -32, 17, -12, 12, 2], 0.9);
  const clawL = shape(clawLocal, at(40, 64, -14, 1.02));
  const clawR = shape(clawLocal, at(140, 64, 14, -1.02, 1.02));
  const armL = capsule(66, 92, 44, 70, 7.5);
  const armR = capsule(114, 92, 136, 70, 7.5);
  const legs = new GraphicsPath();
  for (const [x0, y0, x1, y1] of [
    [64, 108, 44, 118],
    [66, 116, 48, 130],
    [116, 108, 136, 118],
    [114, 116, 132, 130],
  ]) {
    capsule(x0, y0, x1, y1, 3.6, legs);
  }
  const tail = new GraphicsPath()
    .roundRect(69, 124, 42, 16, 7)
    .roundRect(72, 136, 36, 14, 6)
    .roundRect(75, 147, 30, 12, 5);
  const fan = blob([90, 154, 100, 158, 108, 168, 99, 174, 90, 170, 81, 174, 72, 168, 80, 158], 0.9);
  const shell = blob([90, 52, 110, 58, 121, 80, 119, 104, 108, 124, 90, 130, 72, 124, 61, 104, 59, 80, 70, 58], 1);
  const stalks = capsule(100, 62, 106, 44, 4, capsule(80, 62, 74, 44, 4));
  const eyeL = new GraphicsPath().circle(72, 38, 11);
  const eyeR = new GraphicsPath().circle(108, 38, 11);

  c.body([legs, armL, armR, clawL, clawR, fan, tail, shell, stalks, eyeL, eyeR], 7, OUTLINE, EXT);
  c.part({ shape: legs, fill: RED.shade, shade: RED.deep, shadeOff: 2 });
  c.part({ shape: fan, fill: RED.base, shade: RED.shade, shadeOff: 4, paint: (g) => {
    g.moveTo(90, 158).lineTo(90, 170).stroke({ width: 1.6, color: RED.deep });
  } });
  c.part({ shape: tail, fill: RED.base, shade: RED.shade, shadeOff: 4, rim: RED.light, rimOff: 2.5 });
  c.ink((g) => {
    g.moveTo(72, 137).lineTo(108, 137).stroke({ width: 2, color: INK });
    g.moveTo(75, 148).lineTo(105, 148).stroke({ width: 2, color: INK });
  });
  for (const arm of [armL, armR]) c.part({ shape: arm, fill: RED.base, shade: RED.shade, shadeOff: 4 });
  for (const [claw, mirror] of [
    [clawL, 1],
    [clawR, -1],
  ] as const) {
    c.part({
      shape: claw,
      fill: RED.base,
      shade: RED.shade,
      shadeOff: 7,
      shadeShrink: 0.04,
      rim: RED.light,
      rimOff: 4,
      paint: (g) => {
        const x = mirror === 1 ? 40 : 140;
        g.circle(x - 6 * mirror, 52, 3).fill(RED.deep);
        g.circle(x - 2 * mirror, 40, 2.2).fill(RED.deep);
        streak(g, x - 16 * mirror, 56, x - 17 * mirror, 40, x - 9 * mirror, 24, 2.2);
      },
    });
  }
  c.part({
    shape: shell,
    fill: RED.base,
    shade: RED.shade,
    shadeOff: 8,
    shadeShrink: 0.04,
    rim: RED.light,
    rimOff: 5,
    paint: (g) => {
      g.circle(78, 86, 3).fill(RED.shade);
      g.circle(101, 80, 2.4).fill(RED.shade);
      g.circle(104, 92, 3.2).fill(RED.shade);
      streak(g, 68, 96, 66, 76, 78, 62, 2.6);
    },
  });
  // grin + carapace seam
  c.ink((g) => {
    g.moveTo(77, 101).quadraticCurveTo(90, 114, 104, 100).stroke({ width: 3, color: INK, cap: 'round' });
    g.moveTo(98, 107).lineTo(100, 111.5).lineTo(103, 106).fill(WHITE);
    g.moveTo(66, 118).quadraticCurveTo(90, 128, 114, 118).stroke({ width: 2, color: INK, cap: 'round' });
  });
  c.part({ shape: stalks, fill: RED.base, shade: RED.shade, shadeOff: 2 });
  // eyes: white with half-closed "cool" lids
  for (const [ex, px] of [
    [72, 75],
    [108, 105],
  ] as const) {
    c.part({
      shape: new GraphicsPath().circle(ex, 38, 11),
      fill: WHITE,
      shade: 0xd8d0e8,
      shadeOff: 3,
      line: OUTLINE * 0.7,
      paint: (g: Graphics) => {
        g.circle(px, 41, 5.2).fill(INK);
        g.circle(px - 1.6, 39.2, 1.7).fill(WHITE);
        // eyelid
        g.rect(ex - 14, 20, 28, 15).fill(RED.base);
        g.rect(ex - 14, 32.5, 28, 2.5).fill(RED.shade);
        g.moveTo(ex - 12, 35).lineTo(ex + 12, 35).stroke({ width: 2.4, color: INK });
      },
    });
  }
  // antennae
  c.ink((g) => {
    g.moveTo(84, 54).bezierCurveTo(80, 30, 66, 14, 44, 12).stroke({ width: 2.6, color: INK, cap: 'round' });
    g.moveTo(96, 54).bezierCurveTo(100, 30, 114, 14, 136, 12).stroke({ width: 2.6, color: INK, cap: 'round' });
  });
  return c.bake(renderer);
};

// ---------------------------------------------------------------------------
// H4 — Hot Sauce bottle

export const buildHotSauce = (renderer: Renderer, size: number): Texture => {
  const c = new CelCanvas(new Light(SYMBOLS.H4.restAngle), size);
  const RED = { base: 0xe8262e, shade: 0xa3141d, light: 0xff6b5e, deep: 0x5c0b10 };
  const CAP = { base: 0x7bd62e, shade: 0x3f9a1c, light: 0xc4f56a };
  const CREAM = { base: 0xfff0cf, shade: 0xecc68a };
  const EXT = extOf(RED.deep);

  const cap = new GraphicsPath().roundRect(71, 12, 38, 26, 7);
  const neck = new GraphicsPath().rect(79, 34, 22, 26);
  const ring = new GraphicsPath().roundRect(75, 42, 30, 10, 4);
  const bottle = new GraphicsPath()
    .moveTo(79, 56)
    .lineTo(101, 56)
    .bezierCurveTo(101, 70, 125, 72, 125, 92)
    .lineTo(125, 152)
    .bezierCurveTo(125, 162, 117, 166, 107, 166)
    .lineTo(73, 166)
    .bezierCurveTo(63, 166, 55, 162, 55, 152)
    .lineTo(55, 92)
    .bezierCurveTo(55, 72, 79, 70, 79, 56)
    .closePath();
  const label = new GraphicsPath()
    .moveTo(56, 98)
    .bezierCurveTo(74, 104, 106, 104, 124, 98)
    .lineTo(124, 142)
    .bezierCurveTo(106, 148, 74, 148, 56, 142)
    .closePath();

  c.body([cap, neck, bottle], 8, OUTLINE, EXT);
  c.part({
    shape: neck,
    fill: RED.base,
    shade: RED.shade,
    shadeOff: 5,
    paint: (g) => g.rect(83, 36, 3, 22).fill(WHITE),
  });
  c.part({
    shape: bottle,
    fill: RED.base,
    shade: RED.shade,
    shadeOff: 10,
    shadeShrink: 0.03,
    rim: RED.light,
    rimOff: 4,
    paint: (g) => {
      streak(g, 63, 90, 60, 122, 63, 156, 3.2);
      streak(g, 70, 150, 70, 156, 72, 160, 1.4);
      g.moveTo(84, 62).quadraticCurveTo(76, 74, 64, 82).stroke({ width: 3, color: WHITE, cap: 'round' });
    },
  });
  c.part({
    shape: label,
    fill: CREAM.base,
    shade: CREAM.shade,
    shadeOff: 8,
    paint: (g) => {
      // chili pepper icon
      const chili = blob([72, 112, 84, 108, 98, 112, 108, 120, 112, 132, 104, 130, 94, 124, 82, 122, 72, 120], 0.9);
      g.path(chili).fill(RED.base);
      g.moveTo(80, 120).quadraticCurveTo(94, 122, 108, 130).stroke({ width: 3, color: RED.shade, cap: 'round' });
      g.path(chili).stroke({ width: 1.8, color: INK, join: 'round' });
      g.moveTo(78, 114).quadraticCurveTo(88, 111, 96, 114).stroke({ width: 1.8, color: WHITE, cap: 'round' });
      g.path(blob([68, 110, 72, 106, 76, 110, 74, 116, 70, 116], 0.9)).fill(CAP.base).stroke({ width: 1.6, color: INK });
      g.moveTo(71, 108).quadraticCurveTo(68, 102, 72, 99).stroke({ width: 2.2, color: CAP.shade, cap: 'round' });
      // flames
      for (const [fx, fh] of [
        [88, 10],
        [98, 13],
        [108, 9],
      ] as const) {
        g.moveTo(fx - 4, 108).quadraticCurveTo(fx - 5, 108 - fh * 0.6, fx, 108 - fh).quadraticCurveTo(fx + 5, 108 - fh * 0.5, fx + 4, 108).closePath()
          .fill(0xffa51a)
          .stroke({ width: 1.4, color: INK, join: 'round' });
      }
      // faux copy lines (no readable text)
      g.roundRect(70, 134, 26, 4, 2).fill(RED.shade);
      g.roundRect(99, 134, 12, 4, 2).fill(RED.shade);
    },
  });
  c.part({ shape: ring, fill: GOLD.base, shade: GOLD.shade, shadeOff: 3, paint: (g) => g.rect(78, 44, 8, 2).fill(WHITE) });
  c.part({
    shape: cap,
    fill: CAP.base,
    shade: CAP.shade,
    shadeOff: 5,
    rim: CAP.light,
    rimOff: 3,
    paint: (g) => {
      for (let x = 78; x <= 104; x += 6.5) g.moveTo(x, 18).lineTo(x, 36).stroke({ width: 1.6, color: CAP.shade });
      g.rect(74, 14, 32, 3).fill(CAP.light);
    },
  });
  return c.bake(renderer);
};
