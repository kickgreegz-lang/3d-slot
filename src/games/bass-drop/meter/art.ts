import { Container, Graphics, Rectangle, type Renderer, type Texture } from 'pixi.js';
import type { Rect } from '../../../config/layout';
import { canvasToTexture, createCanvas } from '../../../fx/textures';
import { GOLD, PINK, TEAL } from '../timing';
import { GEOM, type NotchKind, R_REF, polar } from './geometry';

/**
 * GROOVE METER placeholder art: every static part of the `ui_groove_meter` rig drawn in
 * code in the ART_BIBLE cel language (pure-black outlines, one flat base + hard shadow /
 * light bands, plum extrusion to the lower right, key light top-left, no baked glow) and
 * baked to textures at display resolution (the app runs without MSAA; Graphics are baked
 * with `antialias: true`, as the Swamp Funk frame does). Soft additive glows (rim glow,
 * swirl, sound-wave ring, orb core) are Canvas2D FX textures, which ANIMATION_SET §0
 * allows in `fx_*` slots only.
 *
 * Everything is in RIG units (R = R_REF, ring centre at 0,0). When the Spine rig lands,
 * the rig-dependent textures here go away; the code-drawn parts (LED tick, notch icons for
 * the chip, orb, wave ring) stay (ANIMATION_SET §8).
 */
const INK = 0x000000;
const PLUM = 0x4b283d;
const R = R_REF;
const rad = (deg: number): number => ((deg - 90) * Math.PI) / 180;

const CAB = { face: 0x2c1636, light: 0x4b2858, shade: 0x1a0b21, grill: 0x2b1e36, hole: 0x0b0511, mount: 0x1b0e24 };
const METAL = { base: 0x4a4466, light: 0x8d86ad, shade: 0x28223d, bolt: 0xcfc8df };
const GOLDM = { base: GOLD, shade: 0xe2861a, deep: 0x9a4a0c, light: 0xfff0a0 };

/**
 * Arc path starting with a moveTo its first point (Graphics.arc() otherwise connects from the
 * previous path point, which draws a stray line). Angles in radians (pixi convention).
 */
const arcAt = (g: Graphics, cx: number, cy: number, r: number, a0: number, a1: number): Graphics =>
  g.moveTo(cx + Math.cos(a0) * r, cy + Math.sin(a0) * r).arc(cx, cy, r, a0, a1);

/** Annular band from deg a0 to a1 (clockwise from 12 o'clock) at radius r, width w. */
const band = (g: Graphics, r: number, w: number, a0: number, a1: number, color: number, alpha = 1): void => {
  arcAt(g, 0, 0, r, rad(a0), rad(a1)).stroke({ width: w, color, alpha, cap: 'butt' });
};

const ring = (g: Graphics, r: number, w: number, color: number, alpha = 1): void => {
  g.circle(0, 0, r).stroke({ width: w, color, alpha });
};

// ---------------------------------------------------------------------------
// rig-dependent parts

const drawCabinet = (c: Rect): Container => {
  const root = new Container();
  const g = new Graphics();
  const r = 26;
  // plum extrusion toward the lower right, then the face
  g.roundRect(c.x + 9, c.y + 9, c.w, c.h, r).fill(PLUM).stroke({ width: 5, color: INK });
  g.roundRect(c.x, c.y, c.w, c.h, r).fill(CAB.face).stroke({ width: 5, color: INK });
  // hard light band top + left, shadow band right + bottom (cel, key light top-left)
  g.roundRect(c.x + 5, c.y + 5, c.w - 10, 13, 10).fill(CAB.light);
  g.roundRect(c.x + 5, c.y + 5, 13, c.h - 10, 10).fill(CAB.light);
  g.roundRect(c.x + c.w - 17, c.y + 14, 12, c.h - 19, 8).fill(CAB.shade);
  g.roundRect(c.x + 14, c.y + c.h - 17, c.w - 19, 12, 8).fill(CAB.shade);
  root.addChild(g);

  // perforated grille panel (holes skip the woofer mount)
  const gx = c.x + 22;
  const gy = c.y + 22;
  const gw = c.w - 44;
  const gh = c.h - 44;
  const grill = new Graphics();
  grill.roundRect(gx, gy, gw, gh, 14).fill(CAB.grill);
  const mountR = R * 1.1;
  let row = 0;
  for (let y = gy + 7; y < gy + gh - 4; y += 8.5, row++) {
    for (let x = gx + 7 + (row % 2) * 4.25; x < gx + gw - 4; x += 8.5) {
      if (x * x + y * y < mountR * mountR) continue;
      grill.circle(x, y, 2.3);
    }
  }
  grill.fill(CAB.hole);
  // hard diagonal shade over the lower-right of the grille
  grill
    .poly([gx + gw, gy + gh * 0.18, gx + gw, gy + gh, gx + gw * 0.12, gy + gh], true)
    .fill({ color: INK, alpha: 0.2 });
  grill.roundRect(gx, gy, gw, gh, 14).stroke({ width: 3, color: INK });
  root.addChild(grill);

  // woofer mount (cabinet_front): dark bevelled collar the rim sits in
  const m = new Graphics();
  m.circle(0, 0, R * 1.075).fill(CAB.mount).stroke({ width: 4.5, color: INK });
  band(m, R * 1.045, R * 0.035, -115, 5, CAB.light);
  band(m, R * 1.045, R * 0.035, 65, 185, INK, 0.45);
  root.addChild(m);

  // gold corner protectors with a bolt each
  const corners = new Graphics();
  const L = 40;
  for (const [sx, sy] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ] as const) {
    const x = sx < 0 ? c.x - 4 : c.x + c.w + 4;
    const y = sy < 0 ? c.y - 4 : c.y + c.h + 4;
    corners
      .poly([x, y, x - sx * L, y, x, y - sy * L], true)
      .fill(sx + sy > 0 ? GOLDM.shade : GOLDM.base)
      .stroke({ width: 3.5, color: INK, join: 'round' });
    const bx = x - sx * 11;
    const by = y - sy * 11;
    corners.circle(bx, by, 4.6).fill(GOLDM.light).stroke({ width: 1.8, color: INK });
    corners.moveTo(bx - 2.6, by - 2.6).lineTo(bx + 2.6, by + 2.6).stroke({ width: 1.4, color: INK });
  }
  root.addChild(corners);
  return root;
};

/** Skin piping inside the cabinet border (white, tinted per skin). */
const drawCabinetTrim = (c: Rect): Graphics =>
  new Graphics().roundRect(c.x + 13, c.y + 13, c.w - 26, c.h - 26, 18).stroke({ width: 3, color: 0xffffff });

const drawRim = (): Graphics => {
  const g = new Graphics();
  // LED bed: dark groove the 60 ticks sit in
  ring(g, R * 0.775, R * 0.2, 0x0b0616);
  ring(g, R * 0.875, 3, INK);
  ring(g, R * 0.675, 2.5, INK);
  // metal rim 0.875..1.0 with cel bands
  ring(g, R * 0.9375, R * 0.125, METAL.base);
  band(g, R * 0.968, R * 0.055, -120, 20, METAL.light);
  band(g, R * 0.905, R * 0.05, 60, 195, METAL.shade);
  arcAt(g, 0, 0, R * 0.975, rad(-78), rad(-42)).stroke({ width: 3.2, color: 0xffffff, cap: 'round' });
  ring(g, R, 4.5, INK);
  ring(g, R * 0.875, 3, INK);
  // bolts between the notch badges
  for (const deg of [-175, -125, -75, -25, 25, 75, 125, 175]) {
    const p = polar(deg, R * 0.9375);
    g.circle(p.x, p.y, 4.8).fill(METAL.bolt).stroke({ width: 1.8, color: INK });
    g.moveTo(p.x - 2.6, p.y + 1.2).lineTo(p.x + 2.6, p.y - 1.2).stroke({ width: 1.4, color: INK });
  }
  return g;
};

/** Neon inlay band on the rim (white, tinted per skin). */
const drawTrim = (): Graphics => {
  const g = new Graphics();
  ring(g, R * 0.9, R * 0.03, 0xffffff);
  ring(g, R * 0.915, 1.3, INK);
  ring(g, R * 0.885, 1.3, INK);
  return g;
};

const drawCone = (): Graphics => {
  const g = new Graphics();
  // surround roll 0.63..0.70
  ring(g, R * 0.665, R * 0.07, 0x2b2540);
  band(g, R * 0.678, R * 0.025, -115, 0, 0x5a5378);
  band(g, R * 0.652, R * 0.03, 60, 190, 0x16121f);
  // cone body 0.525..0.63 with ridges
  ring(g, R * 0.5775, R * 0.105, 0x221c35);
  for (let i = 0; i < 18; i++) {
    const a = i * 20 + 5;
    const p0 = polar(a, R * 0.535);
    const p1 = polar(a, R * 0.622);
    g.moveTo(p0.x, p0.y).lineTo(p1.x, p1.y);
  }
  g.stroke({ width: 1.6, color: 0x120e1c });
  band(g, R * 0.6, R * 0.03, -115, 0, 0x3c3558);
  band(g, R * 0.565, R * 0.075, 60, 195, INK, 0.28);
  ring(g, R * 0.7, 3.5, INK);
  ring(g, R * 0.63, 2, INK);
  ring(g, R * 0.525, 3, INK);
  return g;
};

const drawCap = (): Graphics => {
  const g = new Graphics();
  const r = R * GEOM.counterR;
  g.circle(0, 0, r).fill(0x1a1233);
  // hard-edged glass: a lighter top-left lens, a deep lower-right crescent
  g.circle(-r * 0.14, -r * 0.16, r * 0.74).fill({ color: 0x241a47, alpha: 1 });
  band(g, r * 0.84, r * 0.2, 70, 200, 0x0e0920);
  arcAt(g, 0, 0, r * 0.8, rad(-68), rad(-36)).stroke({ width: r * 0.065, color: 0xffffff, alpha: 0.34, cap: 'round' });
  const sp = polar(-25, r * 0.8);
  g.circle(sp.x, sp.y, r * 0.05).fill({ color: 0xffffff, alpha: 0.5 });
  // gold bezel framing the counter (the reference's gold inner rim, in our palette)
  ring(g, r - R * 0.022, R * 0.044, GOLDM.base);
  band(g, r - R * 0.012, R * 0.018, -120, 10, GOLDM.light);
  band(g, r - R * 0.03, R * 0.018, 70, 190, GOLDM.shade);
  ring(g, r, 3.5, INK);
  ring(g, r - R * 0.044, 2, INK);
  return g;
};

const drawTick = (): Graphics => {
  const w = 6.8;
  const h = 19;
  return new Graphics().roundRect(-w / 2, -h / 2, w, h, 2.6).fill(0xffffff).stroke({ width: 1.7, color: INK });
};

const drawNotchPlate = (): Graphics => {
  const g = new Graphics();
  const r = R * GEOM.notchR;
  g.circle(2.5, 3, r).fill(PLUM).stroke({ width: 3, color: INK });
  g.circle(0, 0, r).fill(0x160c2a).stroke({ width: 3, color: INK });
  arcAt(g, 0, 0, r - 3.5, rad(-140), rad(-30)).stroke({ width: 2.2, color: 0x4a3b72, cap: 'round' });
  return g;
};

const drawNotchRing = (): Graphics => {
  const r = R * GEOM.notchR;
  return new Graphics().circle(0, 0, r - 3.2).stroke({ width: 3.2, color: 0xffffff });
};

const drawPuff = (): Graphics => {
  const g = new Graphics();
  g.circle(0, 0, 20).fill(0x8a7a98).stroke({ width: 2.6, color: INK });
  arcAt(g, 0, 0, 14.5, rad(70), rad(200)).stroke({ width: 8, color: 0x5d4d6c, cap: 'round' });
  g.circle(-7, -7, 3.2).fill({ color: 0xffffff, alpha: 0.5 });
  return g;
};

// ---------------------------------------------------------------------------
// icons (notch badges + chip): fixed resolution, built once

/** Gator-tooth wild charm (the W gem): gold cap, teal enamel tooth. Centre (0,0), ~18 x 26. */
const toothAt = (g: Graphics, x: number, y: number, s = 1): void => {
  const X = (v: number): number => x + v * s;
  const Y = (v: number): number => y + v * s;
  g.roundRect(X(-8), Y(-15), 16 * s, 6.5 * s, 2.5 * s).fill(GOLDM.base).stroke({ width: 2 * s, color: INK });
  g.moveTo(X(-7.5), Y(-8.5))
    .lineTo(X(7.5), Y(-8.5))
    .bezierCurveTo(X(7.5), Y(-1), X(4), Y(5.5), X(0), Y(10))
    .bezierCurveTo(X(-4), Y(5.5), X(-7.5), Y(-1), X(-7.5), Y(-8.5))
    .closePath()
    .fill(TEAL)
    .stroke({ width: 2.2 * s, color: INK, join: 'round' });
  g.moveTo(X(2.5), Y(-7)).bezierCurveTo(X(5.5), Y(-2), X(3.2), Y(3), X(0.8), Y(7)).stroke({ width: 2.2 * s, color: 0x14a89b, cap: 'round' });
  g.moveTo(X(-4.2), Y(-6)).bezierCurveTo(X(-4.6), Y(-2.5), X(-3.4), Y(0.5), X(-2), Y(3)).stroke({ width: 1.7 * s, color: 0xffffff, cap: 'round' });
};

const drawIconW = (pips: number): Graphics => {
  const g = new Graphics();
  toothAt(g, 0, pips > 0 ? -3.5 : 1.5);
  const gap = 7.2;
  for (let i = 0; i < pips; i++) {
    const x = (i - (pips - 1) / 2) * gap;
    g.circle(x, 14.5, 2.9).fill(0xffffff).stroke({ width: 1.5, color: INK });
  }
  return g;
};

const drawIconJJ = (): Graphics => {
  const g = new Graphics();
  // cabinet with an arched top
  g.moveTo(-11.5, 14)
    .lineTo(-11.5, -3)
    .arc(0, -3, 11.5, Math.PI, Math.PI * 2)
    .lineTo(11.5, 14)
    .closePath()
    .fill(GOLDM.base)
    .stroke({ width: 2.3, color: INK, join: 'round' });
  arcAt(g, 0, -3, 9, Math.PI, Math.PI * 2).stroke({ width: 2.2, color: PINK });
  g.moveTo(-6.6, 2.5)
    .lineTo(-6.6, -3)
    .arc(0, -3, 6.6, Math.PI, Math.PI * 2)
    .lineTo(6.6, 2.5)
    .closePath()
    .fill(TEAL)
    .stroke({ width: 1.6, color: INK });
  g.roundRect(-7.5, 5.5, 15, 6.2, 1.5).fill(0x3a1d10).stroke({ width: 1.3, color: INK });
  for (const y of [7.3, 9.6]) g.moveTo(-6, y).lineTo(6, y);
  g.stroke({ width: 0.9, color: GOLDM.shade });
  g.rect(9.5, -1, 2, 15).fill(GOLDM.shade);
  g.roundRect(-13, 13.5, 26, 3.6, 1.2).fill(GOLDM.deep).stroke({ width: 1.6, color: INK });
  return g;
};

const drawIconMM = (): Graphics => {
  const g = new Graphics();
  g.roundRect(-10.5, -4.5, 21, 20, 3.2).fill(PINK).stroke({ width: 2.3, color: INK });
  g.rect(7.2, -2.5, 2.2, 16).fill(0xb3246f);
  g.circle(0, 6, 6.6).fill(0x2a1030).stroke({ width: 1.7, color: INK });
  g.circle(0, 6, 2.5).fill(0xff9ad0).stroke({ width: 1, color: INK });
  // crown
  g.poly([-9.5, -5, -9.5, -14.5, -4.8, -10, 0, -17, 4.8, -10, 9.5, -14.5, 9.5, -5], true)
    .fill(GOLDM.base)
    .stroke({ width: 1.9, color: INK, join: 'round' });
  for (const [x, y] of [
    [-9.5, -14.5],
    [0, -17],
    [9.5, -14.5],
  ] as const) {
    g.circle(x, y, 1.9).fill(0xffffff).stroke({ width: 1, color: INK });
  }
  return g;
};

/** Tooth in gold clamp brackets (a sticky Mega Mix wild, chip only). */
const drawIconSticky = (): Graphics => {
  const g = new Graphics();
  toothAt(g, 0, 1.5, 0.9);
  for (const sx of [-1, 1]) {
    const x = sx * 12;
    g.poly([x - sx * 5, -12, x, -12, x, 13, x - sx * 5, 13], false).stroke({ width: 5.5, color: INK, join: 'round', cap: 'round' });
    g.poly([x - sx * 5, -12, x, -12, x, 13, x - sx * 5, 13], false).stroke({ width: 2.8, color: GOLDM.base, join: 'round', cap: 'round' });
  }
  return g;
};

const drawArrow = (): Graphics =>
  new Graphics()
    .poly([-12, -4.5, 3, -4.5, 3, -10, 13, 0, 3, 10, 3, 4.5, -12, 4.5], true)
    .fill(0xffffff)
    .stroke({ width: 2.4, color: INK, join: 'round' });

// ---------------------------------------------------------------------------
// soft FX textures (Canvas2D)

const softRing = (size: number, at: number, width: number, inner = 0): Texture => {
  const [c, g] = createCanvas(size, size);
  const img = g.createImageData(size, size);
  const h = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - h, y + 0.5 - h) / h;
      const k = Math.exp(-(((d - at) / width) ** 2)) + (d < at ? inner * (d / at) ** 2 : 0);
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(Math.min(1, k) * 255);
    }
  }
  g.putImageData(img, 0, 0);
  return canvasToTexture(c);
};

const swirlTexture = (size: number): Texture => {
  const [c, g] = createCanvas(size, size);
  const h = size / 2;
  g.translate(h, h);
  g.lineCap = 'round';
  for (let arm = 0; arm < 3; arm++) {
    const steps = 48;
    for (let i = 0; i < steps; i++) {
      const t0 = i / steps;
      const t1 = (i + 1) / steps;
      const a0 = arm * ((Math.PI * 2) / 3) + t0 * 3.6;
      const a1 = arm * ((Math.PI * 2) / 3) + t1 * 3.6;
      const r0 = h * (0.14 + t0 * 0.84);
      const r1 = h * (0.14 + t1 * 0.84);
      g.strokeStyle = `rgba(255,255,255,${(Math.sin(t0 * Math.PI) * 0.9).toFixed(3)})`;
      g.lineWidth = h * (0.03 + 0.07 * Math.sin(t0 * Math.PI));
      g.beginPath();
      g.moveTo(Math.cos(a0) * r0, Math.sin(a0) * r0);
      g.lineTo(Math.cos(a1) * r1, Math.sin(a1) * r1);
      g.stroke();
    }
  }
  return canvasToTexture(c);
};

/** Orb halo: a hotter profile than the generic glow (bright body, short falloff), tinted per orb. */
const orbHaloTexture = (size: number): Texture => {
  const [c, g] = createCanvas(size, size);
  const h = size / 2;
  const grad = g.createRadialGradient(h, h, 0, h, h, h);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.42, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.62, 'rgba(255,255,255,0.5)');
  grad.addColorStop(0.82, 'rgba(255,255,255,0.14)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return canvasToTexture(c);
};

const orbCoreTexture = (size: number): Texture => {
  const [c, g] = createCanvas(size, size);
  const h = size / 2;
  const grad = g.createRadialGradient(h, h, 0, h, h, h);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.55, 'rgba(255,255,255,1)');
  grad.addColorStop(0.75, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return canvasToTexture(c);
};

// ---------------------------------------------------------------------------

export interface MeterTextures {
  cabinet: Texture | null;
  /** top-left of the cabinet textures (rig units) */
  cabinetAt: { x: number; y: number };
  cabinetTrim: Texture | null;
  rim: Texture;
  trim: Texture;
  cone: Texture;
  cap: Texture;
  tick: Texture;
  notchPlate: Texture;
  notchRing: Texture;
}

export interface MeterIcons {
  w: [Texture, Texture, Texture, Texture];
  jj: Texture;
  mm: Texture;
  sticky: Texture;
  arrow: Texture;
  glowRing: Texture;
  swirl: Texture;
  wave: Texture;
  orbCore: Texture;
  orbHalo: Texture;
  puff: Texture;
}

/** Texture set of the meter: rig parts re-baked per layout/resolution, icons + FX built once. */
export class MeterArt {
  private rigTex: MeterTextures | null = null;
  private iconTex: MeterIcons | null = null;
  private key = '';

  constructor(private readonly renderer: Renderer) {}

  private bake(target: Container, frame: Rectangle, res: number): Texture {
    const tex = this.renderer.generateTexture({ target, frame, resolution: res, antialias: true });
    target.destroy({ children: true });
    return tex;
  }

  private square(target: Container, half: number, res: number): Texture {
    return this.bake(target, new Rectangle(-half, -half, half * 2, half * 2), res);
  }

  /** (Re)bake the rig parts for a cabinet rect (rig units) at `res`; no-op if unchanged. */
  build(cabinet: Rect | null, res: number): MeterTextures {
    const key = `${res}|${cabinet ? `${cabinet.x},${cabinet.y},${cabinet.w},${cabinet.h}` : 'bare'}`;
    if (this.rigTex && key === this.key) return this.rigTex;
    this.key = key;
    this.destroyRig();
    const pad = 16;
    const cabFrame = cabinet ? new Rectangle(cabinet.x - pad, cabinet.y - pad, cabinet.w + pad * 2 + 10, cabinet.h + pad * 2 + 10) : null;
    this.rigTex = {
      cabinet: cabinet && cabFrame ? this.bake(drawCabinet(cabinet), cabFrame, res) : null,
      cabinetAt: { x: cabFrame?.x ?? 0, y: cabFrame?.y ?? 0 },
      cabinetTrim: cabinet && cabFrame ? this.bake(drawCabinetTrim(cabinet), cabFrame, res) : null,
      rim: this.square(drawRim(), R * 1.02, res),
      trim: this.square(drawTrim(), R * 0.94, res),
      cone: this.square(drawCone(), R * 0.72, res),
      cap: this.square(drawCap(), R * 0.54, res),
      tick: this.square(drawTick(), 12, Math.max(res, 1.5)),
      notchPlate: this.square(drawNotchPlate(), R * GEOM.notchR + 6, Math.max(res, 1)),
      notchRing: this.square(drawNotchRing(), R * GEOM.notchR, Math.max(res, 1)),
    };
    return this.rigTex;
  }

  get icons(): MeterIcons {
    if (this.iconTex) return this.iconTex;
    const res = 3;
    this.iconTex = {
      w: [
        this.square(drawIconW(0), 20, res),
        this.square(drawIconW(1), 20, res),
        this.square(drawIconW(2), 20, res),
        this.square(drawIconW(3), 20, res),
      ],
      jj: this.square(drawIconJJ(), 20, res),
      mm: this.square(drawIconMM(), 20, res),
      sticky: this.square(drawIconSticky(), 20, res),
      arrow: this.square(drawArrow(), 16, res),
      glowRing: softRing(256, 0.82, 0.07, 0.08),
      swirl: swirlTexture(256),
      wave: softRing(256, 0.9, 0.045, 0.12),
      orbCore: orbCoreTexture(64),
      orbHalo: orbHaloTexture(128),
      puff: this.square(drawPuff(), 24, 1.5),
    };
    return this.iconTex;
  }

  notchIcon(kind: NotchKind, pips: number): Texture {
    const i = this.icons;
    return kind === 'jj' ? i.jj : kind === 'mm' ? i.mm : i.w[Math.min(3, Math.max(0, pips)) as 0 | 1 | 2 | 3];
  }

  private destroyRig(): void {
    const t = this.rigTex;
    if (!t) return;
    for (const tex of [t.cabinet, t.cabinetTrim, t.rim, t.trim, t.cone, t.cap, t.tick, t.notchPlate, t.notchRing]) tex?.destroy(true);
    this.rigTex = null;
  }

  destroy(): void {
    this.destroyRig();
    if (this.iconTex) {
      const i = this.iconTex;
      for (const tex of [...i.w, i.jj, i.mm, i.sticky, i.arrow, i.glowRing, i.swirl, i.wave, i.orbCore, i.orbHalo, i.puff]) tex.destroy(true);
      this.iconTex = null;
    }
  }
}
