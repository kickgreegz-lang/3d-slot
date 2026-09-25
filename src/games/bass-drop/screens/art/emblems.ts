import { Container, Graphics } from 'pixi.js';
import { GOLD, METER_SEGMENT_COLORS, METER_UNLIT, PINK, TEAL } from '../../timing';
import { INK, PLUM } from '../look';

/**
 * EMBLEM placeholders (ART_BIBLE cel language: pure-black outlines, one flat base + a hard
 * shadow band + a light band, plum extrusion to the lower right, key light top-left, no baked
 * glow). Each builder returns a Container in local design px around (0, 0); ScreenArt bakes
 * it once per resolution. The Spine rigs replace them slot for slot:
 *   jukebox()      `ui_feature_intro` skin jukejam `emblem` / `art_jukejam` / `art_jukejam_buy`
 *   speakerStack() `ui_feature_intro` skin megamix `emblem` / `art_megamix` / `art_megamix_buy`
 *   woofer()       `art_meter` (the Groove Meter card)
 * Glows live in separate additive sprites (fx slots), never in these textures.
 */

const OUT = 6;
const GOLDM = { base: GOLD, shade: 0xe2861a, deep: 0x9a4a0c, light: 0xfff0a0 };
const GLASS = 0x1b0f33;

/** Arch silhouette: straight sides from `bottom` up to `cy`, a half circle of radius `r` on top. */
const arch = (g: Graphics, r: number, cy: number, bottom: number, dx = 0, dy = 0): Graphics =>
  g
    .moveTo(-r + dx, bottom + dy)
    .lineTo(-r + dx, cy + dy)
    .arc(dx, cy + dy, r, Math.PI, Math.PI * 2)
    .lineTo(r + dx, bottom + dy)
    .closePath();

/** Round-capped neon tube with a black casing and a hot core. */
const tube = (g: Graphics, path: (g: Graphics) => Graphics, color: number, width: number): void => {
  path(g).stroke({ width: width + 8, color: INK, cap: 'round', join: 'round' });
  path(g).stroke({ width, color, cap: 'round', join: 'round' });
  path(g).stroke({ width: Math.max(2, width * 0.28), color: 0xffffff, alpha: 0.8, cap: 'round', join: 'round' });
};

/** Vinyl record (black disc, grooves, coloured label, specular streak). */
const vinyl = (g: Graphics, x: number, y: number, r: number, label: number): void => {
  g.circle(x, y, r).fill(0x14101c).stroke({ width: 4, color: INK });
  for (const k of [0.82, 0.66]) g.circle(x, y, r * k).stroke({ width: 2, color: 0x3a3150 });
  g.circle(x, y, r * 0.36).fill(label).stroke({ width: 3, color: INK });
  g.circle(x, y, r * 0.07).fill(GOLDM.light).stroke({ width: 1.5, color: INK });
  g.moveTo(x + Math.cos(Math.PI * 1.12) * r * 0.9, y + Math.sin(Math.PI * 1.12) * r * 0.9)
    .arc(x, y, r * 0.9, Math.PI * 1.12, Math.PI * 1.38)
    .stroke({ width: 4, color: 0xffffff, alpha: 0.55, cap: 'round' });
};

/**
 * JUKEBOX (Juke Jam emblem): gold arched cabinet with a teal neon bubble tube, a record behind
 * the dome glass, a selector strip and a slatted speaker grille on a plum plinth.
 * Local box ~ (-170, -215) .. (180, 212).
 */
export const jukebox = (): Container => {
  const root = new Container({ label: 'jukebox' });
  const g = new Graphics();
  const R = 150;
  const top = -60;
  const bottom = 172;
  // plinth extrusion + body extrusion (plum, lower right)
  g.roundRect(-160 + 10, bottom - 4 + 12, 320, 34, 12).fill(PLUM).stroke({ width: OUT, color: INK });
  arch(g, R, top, bottom, 10, 12).fill(PLUM).stroke({ width: OUT, color: INK });
  // cabinet: shade base, lit face inset from the right (hard cel band), light rim top-left
  arch(g, R, top, bottom).fill(GOLDM.shade);
  g.moveTo(-R + 5, bottom - 5)
    .lineTo(-R + 5, top)
    .arc(-14, top, R - 19, Math.PI, Math.PI * 1.97)
    .lineTo(R - 34, bottom - 5)
    .closePath()
    .fill(GOLDM.base);
  g.moveTo(-R + 12, bottom - 30)
    .lineTo(-R + 12, top)
    .arc(0, top, R - 12, Math.PI, Math.PI * 1.36)
    .stroke({ width: 9, color: GOLDM.light, cap: 'round' });
  arch(g, R, top, bottom).stroke({ width: OUT, color: INK, join: 'round' });
  // neon bubble tube around the dome, down both sides
  const tubePath = (t: Graphics): Graphics =>
    t.moveTo(-128, 46).lineTo(-128, top).arc(0, top, 128, Math.PI, Math.PI * 2).lineTo(128, 46);
  tube(g, tubePath, TEAL, 14);
  for (let i = 0; i < 9; i++) {
    const a = Math.PI + (i + 0.5) * (Math.PI / 9);
    g.circle(Math.cos(a) * 128, top + Math.sin(a) * 128, 3.2).fill({ color: 0xffffff, alpha: 0.85 });
  }
  // dome window with the record
  const win = (t: Graphics): Graphics =>
    t.moveTo(-104, -8).lineTo(-104, top).arc(0, top, 104, Math.PI, Math.PI * 2).lineTo(104, -8).closePath();
  win(g).fill(GLASS);
  g.moveTo(-104, -8)
    .lineTo(-104, top)
    .arc(0, top, 104, Math.PI, Math.PI * 1.5)
    .lineTo(0, -8)
    .closePath()
    .fill({ color: 0x2a1850 });
  vinyl(g, 0, top - 4, 64, PINK);
  win(g).stroke({ width: 5, color: INK, join: 'round' });
  g.moveTo(Math.cos(Math.PI * 1.1) * 92, top + Math.sin(Math.PI * 1.1) * 92)
    .arc(0, top, 92, Math.PI * 1.1, Math.PI * 1.34)
    .stroke({ width: 6, color: 0xffffff, alpha: 0.4, cap: 'round' });
  // selector strip
  g.roundRect(-104, 2, 208, 34, 10).fill(0x2b1e36).stroke({ width: 4, color: INK });
  const keys = [PINK, TEAL, GOLDM.light, PINK, TEAL, GOLDM.light];
  keys.forEach((c, i) => {
    const x = -88 + i * 30;
    g.roundRect(x, 10, 24, 18, 5).fill(c).stroke({ width: 2.5, color: INK });
    g.rect(x + 3, 12, 18, 4).fill({ color: 0xffffff, alpha: 0.45 });
  });
  // speaker grille with gold slats and a medallion
  g.roundRect(-112, 46, 224, 110, 14).fill(0x3a1f10).stroke({ width: 5, color: INK });
  for (let i = 0; i < 7; i++) {
    const x = -93 + i * 31;
    g.roundRect(x, 56, 12, 90, 5).fill(GOLDM.shade).stroke({ width: 2.5, color: INK });
    g.rect(x + 2.5, 59, 3.5, 82).fill(GOLDM.light);
  }
  g.circle(0, 101, 30).fill(GOLDM.base).stroke({ width: 4.5, color: INK });
  g.circle(0, 101, 15).fill(PINK).stroke({ width: 3, color: INK });
  g.circle(-5, 96, 4.5).fill({ color: 0xffffff, alpha: 0.75 });
  // plinth
  g.roundRect(-160, bottom - 4, 320, 34, 12).fill(0x5a2a6a).stroke({ width: OUT, color: INK });
  g.roundRect(-152, bottom + 1, 304, 8, 4).fill(0x8a4a9a);
  root.addChild(g);
  return root;
};

/** One speaker cabinet with a woofer (and an optional tweeter) centred at (0, 0). */
const cabinet = (g: Graphics, x: number, y: number, w: number, h: number, woofer: number, tweeter: boolean): void => {
  const x0 = x - w / 2;
  const y0 = y - h / 2;
  g.roundRect(x0 + 9, y0 + 11, w, h, 18).fill(PLUM).stroke({ width: OUT, color: INK });
  g.roundRect(x0, y0, w, h, 18).fill(0x8c1356);
  g.roundRect(x0 + 5, y0 + 5, w - 28, h - 18, 14).fill(0xd8237f);
  g.roundRect(x0 + 8, y0 + 7, w - 36, 9, 4).fill(0xff6fbd);
  g.roundRect(x0 + 8, y0 + 7, 9, h - 30, 4).fill(0xff6fbd);
  g.roundRect(x0, y0, w, h, 18).stroke({ width: OUT, color: INK });
  // gold corner protectors
  const c = 26;
  for (const [sx, sy] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ] as const) {
    const cx = sx < 0 ? x0 - 3 : x0 + w + 3;
    const cy = sy < 0 ? y0 - 3 : y0 + h + 3;
    g.poly([cx, cy, cx - sx * c, cy, cx, cy - sy * c], true)
      .fill(sx + sy > 0 ? GOLDM.shade : GOLDM.base)
      .stroke({ width: 3.5, color: INK, join: 'round' });
  }
  // woofer: surround, cone (lit top-left / hard shadow crescent), gold dust cap
  const wy = tweeter ? y + h * 0.1 : y;
  g.circle(x, wy, woofer).fill(0x1a1024).stroke({ width: 5, color: INK });
  g.circle(x, wy, woofer * 0.8).fill(0x3a2d52).stroke({ width: 3, color: INK });
  g.moveTo(x + woofer * 0.8, wy)
    .arc(x, wy, woofer * 0.8, 0, Math.PI * 0.75)
    .arc(x + woofer * 0.12, wy + woofer * 0.1, woofer * 0.66, Math.PI * 0.75, 0, true)
    .closePath()
    .fill({ color: INK, alpha: 0.35 });
  g.circle(x, wy, woofer * 0.32).fill(GOLDM.base).stroke({ width: 4, color: INK });
  g.circle(x - woofer * 0.1, wy - woofer * 0.1, woofer * 0.09).fill({ color: 0xffffff, alpha: 0.8 });
  if (tweeter) {
    const ty = y0 + h * 0.2;
    g.circle(x, ty, woofer * 0.22).fill(0x1a1024).stroke({ width: 3.5, color: INK });
    g.circle(x, ty, woofer * 0.11).fill(TEAL).stroke({ width: 2.5, color: INK });
  }
};

/** Five-point gold crown with gem tips, tilted for attitude. */
const crown = (): Graphics => {
  const g = new Graphics();
  const pts = [-92, 18, -100, -52, -58, -14, -30, -74, 0, -24, 30, -74, 58, -14, 100, -52, 92, 18];
  g.poly(pts.map((v, i) => v + (i % 2 ? 9 : 7)), true).fill(PLUM).stroke({ width: OUT, color: INK, join: 'round' });
  g.poly(pts, true).fill(GOLDM.shade);
  g.poly([-86, 12, -93, -40, -56, -6, -30, -62, -4, -18, -4, 12], true).fill(GOLDM.base);
  g.poly(pts, true).stroke({ width: OUT, color: INK, join: 'round' });
  // band
  g.roundRect(-96, 4, 192, 28, 8).fill(GOLDM.base).stroke({ width: 5, color: INK });
  g.roundRect(-90, 8, 184, 6, 3).fill(GOLDM.light);
  const gems = [PINK, TEAL, PINK];
  gems.forEach((c, i) => {
    const x = -54 + i * 54;
    g.ellipse(x, 18, 11, 8).fill(c).stroke({ width: 3, color: INK });
    g.circle(x - 3, 15, 2.5).fill({ color: 0xffffff, alpha: 0.85 });
  });
  // tip gems
  for (const [x, y, c] of [
    [-100, -52, TEAL],
    [-30, -74, PINK],
    [30, -74, PINK],
    [100, -52, TEAL],
  ] as const) {
    g.circle(x, y, 10).fill(c).stroke({ width: 3.5, color: INK });
    g.circle(x - 3, y - 3, 3).fill({ color: 0xffffff, alpha: 0.85 });
  }
  g.rotation = -0.12;
  return g;
};

/**
 * CROWNED SPEAKER STACK (Mega Mix emblem): two hot-pink cabinets with gold corners and dust
 * caps, a gold crown on top. Local box ~ (-160, -250) .. (170, 215).
 */
export const speakerStack = (): Container => {
  const root = new Container({ label: 'speakerStack' });
  const g = new Graphics();
  cabinet(g, 0, 112, 290, 190, 70, false);
  cabinet(g, -6, -60, 236, 160, 50, true);
  root.addChild(g);
  const c = crown();
  c.position.set(-4, -168);
  root.addChild(c);
  return root;
};

/**
 * WOOFER (Groove Meter card art): bezel with a two-thirds lit LED ring in the meter palette,
 * a dark cone and a gold dust cap. Radius `r`.
 */
export const woofer = (r = 120): Container => {
  const root = new Container({ label: 'woofer' });
  const g = new Graphics();
  g.circle(10, 12, r).fill(PLUM).stroke({ width: OUT, color: INK });
  g.circle(0, 0, r).fill(0x28223d);
  g.moveTo(-r + 5, 0)
    .arc(0, 0, r - 5, Math.PI, Math.PI * 1.62)
    .stroke({ width: 8, color: 0x8d86ad, cap: 'round' });
  g.circle(0, 0, r).stroke({ width: OUT, color: INK });
  // LED ring: 30 ticks, the first 20 lit through the segment colours
  const n = 30;
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
    const lit = i < 20;
    const color = lit ? METER_SEGMENT_COLORS[Math.min(5, Math.floor((i / 20) * 6))] : METER_UNLIT;
    const r0 = r * 0.76;
    const r1 = r * 0.9;
    g.moveTo(Math.cos(a) * r0, Math.sin(a) * r0)
      .lineTo(Math.cos(a) * r1, Math.sin(a) * r1)
      .stroke({ width: 7, color: INK, cap: 'round' });
    g.moveTo(Math.cos(a) * r0, Math.sin(a) * r0)
      .lineTo(Math.cos(a) * r1, Math.sin(a) * r1)
      .stroke({ width: 3.5, color, cap: 'round' });
  }
  g.circle(0, 0, r * 0.7).fill(0x1a1024).stroke({ width: 4, color: INK });
  g.circle(0, 0, r * 0.58).fill(0x3a2d52).stroke({ width: 3, color: INK });
  g.moveTo(r * 0.58, 0)
    .arc(0, 0, r * 0.58, 0, Math.PI * 0.8)
    .arc(r * 0.08, r * 0.08, r * 0.48, Math.PI * 0.8, 0, true)
    .closePath()
    .fill({ color: INK, alpha: 0.35 });
  g.circle(0, 0, r * 0.24).fill(GOLDM.base).stroke({ width: 4, color: INK });
  g.circle(-r * 0.07, -r * 0.07, r * 0.07).fill({ color: 0xffffff, alpha: 0.8 });
  // bezel bolts
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    const bx = Math.cos(a) * r * 0.95;
    const by = Math.sin(a) * r * 0.95;
    g.circle(bx, by, 6).fill(GOLDM.light).stroke({ width: 2, color: INK });
    g.moveTo(bx - 3, by - 3).lineTo(bx + 3, by + 3).stroke({ width: 1.6, color: INK });
  }
  root.addChild(g);
  return root;
};

/** Gold corner clamp bracket (Mega Mix sticky wilds), drawn for the top-left corner; rotate per corner. */
export const clamp = (): Graphics => {
  const g = new Graphics();
  const pts = [0, 0, 34, 0, 34, 11, 11, 11, 11, 34, 0, 34];
  g.poly(pts.map((v) => v + 3), true).fill(PLUM).stroke({ width: 3.5, color: INK, join: 'miter' });
  g.poly(pts, true).fill(GOLDM.base).stroke({ width: 3.5, color: INK, join: 'miter' });
  g.rect(3, 3, 26, 3).fill(GOLDM.light);
  g.circle(5.5, 5.5, 2.2).fill(INK);
  return g;
};
