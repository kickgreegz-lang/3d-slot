import { BitmapFont, Container, Graphics, Rectangle, type Renderer, Texture } from 'pixi.js';
import { FONTS } from '../../../assets/fonts';
import { TILE_RADIUS } from '../../../board/tileArt';
import { canvasToTexture, createCanvas, glowTexture } from '../../../fx/textures';
import { darken, lighten, mixColor } from '../../../fx/util';
import { GOLD, MULT_TIERS } from '../timing';
import { DROP_LOOK as LOOK } from './look';

/**
 * BASS DROP placeholder art: the parts of the extended `sym_W` rig (multiplier badge per
 * tier, t5 flame crown, sticky clamps) and the code-drawn board elements of ANIMATION_SET §8
 * (Mega Mix home marker, target reticle, landing shadow, wild trail, impact / return rings),
 * drawn in the ART_BIBLE cel language — pure-black outline ~3% of the cell, one flat base +
 * two hard shadow tones + a white specular streak, plum extrusion to the lower right, key
 * light top-left, no baked glow — and baked ONCE to textures in reference-cell units
 * (DROP_LOOK.ref = one cell). Sprites scale by cell / ref, so a layout change never re-bakes.
 * Soft additive parts (trail, rings, shadow, glow) are Canvas2D FX textures (`fx_*` slots).
 *
 * Every number shown on these parts is live BitmapText (fonts below); nothing is baked in.
 */
const INK = 0x000000;
const PLUM = 0x4b283d;
const GOLDM = { base: GOLD, shade: 0xe2861a, deep: 0x9a4a0c, light: 0xfff0a0 };
const OUTLINE = 3.2;

export const MULT_FONT = 'bd-drop-mult';
export const PLUS_FONT = 'bd-drop-plus';

/**
 * Badge plate size per tier (ref units): the plate widens with the digit count it carries.
 * `inner`: share of the width the value may use (bursts lose their spikes).
 */
export const PLATE_SIZE: Record<number, { w: number; h: number; inner: number }> = {
  1: { w: 62, h: 40, inner: 0.8 },
  2: { w: 66, h: 40, inner: 0.74 },
  3: { w: 68, h: 42, inner: 0.76 },
  4: { w: 82, h: 46, inner: 0.66 },
  5: { w: 84, h: 48, inner: 0.66 },
};

type Shape = (g: Graphics, ox: number, oy: number, s: number) => Graphics;

const polyShape =
  (pts: readonly number[]): Shape =>
  (g, ox, oy, s) => {
    const out: number[] = [];
    for (let i = 0; i < pts.length; i += 2) out.push(pts[i] * s + ox, pts[i + 1] * s + oy);
    return g.poly(out, true);
  };

/** Per-tier plate silhouette: pill, hex, cut octagon, starburst, starburst (+ flame). Distinct in greyscale. */
const plateShape = (tier: number): Shape => {
  const { w, h } = PLATE_SIZE[tier];
  const hw = w / 2;
  const hh = h / 2;
  if (tier === 1) return (g, ox, oy, s) => g.roundRect(-hw * s + ox, -hh * s + oy, w * s, h * s, hh * s);
  if (tier === 2) return polyShape([-hw, 0, -hw + 12, -hh, hw - 12, -hh, hw, 0, hw - 12, hh, -hw + 12, hh]);
  if (tier === 3) {
    const c = 10;
    return polyShape([-hw + c, -hh, hw - c, -hh, hw, -hh + c, hw, hh - c, hw - c, hh, -hw + c, hh, -hw, hh - c, -hw, -hh + c]);
  }
  // starburst: 18 spikes on an ellipse
  const n = 18;
  const pts: number[] = [];
  for (let i = 0; i < n * 2; i++) {
    const a = (i / (n * 2)) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 === 0 ? 1 : 0.8;
    pts.push(Math.cos(a) * hw * r, Math.sin(a) * hh * r);
  }
  return polyShape(pts);
};

/** Cel plate: plum extrusion, deep rim, shade band, flat base, specular streak, one black outline. */
const drawCelPlate = (shape: Shape, base: number, w: number, h: number, extrude = 3.6): Graphics => {
  const g = new Graphics();
  const shade = mixColor(darken(base, 0.3), 0x6a1030, 0.25);
  const deep = mixColor(darken(base, 0.52), 0x6a1030, 0.3);
  shape(g, extrude, extrude, 1).fill(PLUM).stroke({ width: OUTLINE, color: INK, join: 'round' });
  shape(g, 0, 0, 1).fill(deep);
  shape(g, -0.9, -0.9, 0.95).fill(shade);
  shape(g, -2, -2, 0.88).fill(base);
  // specular streak along the upper-left edge (key light top-left)
  g.roundRect(-w * 0.34, -h * 0.34, w * 0.3, h * 0.11, h * 0.055).fill({ color: 0xffffff, alpha: 0.92 });
  g.circle(-w * 0.02, -h * 0.29, h * 0.045).fill({ color: 0xffffff, alpha: 0.85 });
  shape(g, 0, 0, 1).stroke({ width: OUTLINE, color: INK, join: 'round' });
  return g;
};

const drawPlate = (tier: number): Container => {
  const t = MULT_TIERS[tier - 1];
  const { w, h } = PLATE_SIZE[tier];
  const root = new Container();
  const g = drawCelPlate(plateShape(tier), t.color, w, h);
  root.addChild(g);
  if (tier === 3) {
    // gold tier: two rivets on the cut ends
    const r = new Graphics();
    for (const sx of [-1, 1]) {
      r.circle(sx * (w / 2 - 7), 0, 3.2).fill(GOLDM.light).stroke({ width: 1.8, color: INK });
    }
    root.addChild(r);
  }
  return root;
};

/** t5 flame tongue (the badge shows two, licking out from behind the plate ends): three tongues, orange shell + yellow core. */
const drawFlame = (): Graphics => {
  const g = new Graphics();
  const tongue = (x: number, base: number, half: number, tip: number, lean: number, color: number): void => {
    g.moveTo(x - half, base)
      .quadraticCurveTo(x - half * 1.1, base - (base - tip) * 0.55, x + lean, tip)
      .quadraticCurveTo(x + half * 1.15, base - (base - tip) * 0.5, x + half, base)
      .closePath()
      .fill(color);
  };
  const shell = 0xff6a2a;
  const core = 0xffd54a;
  // shells (outlined), then cores
  for (const [x, half, tip, lean] of [
    [-14, 8, -38, -5],
    [14, 8, -38, 5],
    [0, 10, -48, 1],
  ] as const) {
    tongue(x, -12, half, tip, lean, shell);
    g.stroke({ width: OUTLINE, color: INK, join: 'round' });
  }
  for (const [x, half, tip, lean] of [
    [-13, 4, -28, -3],
    [13, 4, -28, 3],
    [0, 5.5, -36, 1],
  ] as const) {
    tongue(x, -13, half, tip, lean, core);
  }
  return g;
};

/** Left sticky clamp (a C-jaw facing right; the right one is mirrored), origin at the bar centre. */
const drawClamp = (): Container => {
  const root = new Container();
  const pts = [-6, -21, 15, -21, 15, -12, 5, -12, 5, 12, 15, 12, 15, 21, -6, 21];
  const g = drawCelPlate(polyShape(pts), GOLDM.base, 21, 42, 2.8);
  const b = new Graphics();
  b.circle(-0.5, 0, 3.8).fill(GOLDM.light).stroke({ width: 1.8, color: INK });
  b.moveTo(-2.6, -2.1).lineTo(1.6, 2.1).stroke({ width: 1.3, color: INK });
  root.addChild(g, b);
  return root;
};

/** Mega Mix home marker on the tile: gold rim (#FFC629, 3 px @124, 60%) + 4 corner clamp brackets. */
const drawHomeMarker = (): Container => {
  const root = new Container();
  const S = LOOK.ref;
  const h = S / 2;
  const rim = new Graphics();
  rim.roundRect(-h + 1.4, -h + 1.4, S - 2.8, S - 2.8, S * TILE_RADIUS).stroke({ width: 2.4, color: GOLD, alpha: 0.6 });
  root.addChild(rim);
  const br = new Graphics();
  const arm = 21;
  const th = 6;
  for (const [sx, sy] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ] as const) {
    const x = sx * h;
    const y = sy * h;
    const pts = [x, y, x - sx * arm, y, x - sx * arm, y - sy * th, x - sx * th, y - sy * th, x - sx * th, y - sy * arm, x, y - sy * arm];
    br.poly(pts, true)
      .fill(sx + sy > 0 ? GOLDM.shade : sx + sy < 0 ? GOLDM.base : GOLDM.light)
      .stroke({ width: 2.4, color: INK, join: 'round' });
    br.circle(x - sx * 3.2, y - sy * 3.2, 1.9).fill(GOLDM.deep);
  }
  root.addChild(br);
  return root;
};

/** Target reticle: white dashed ring (outlined) with four inward ticks; spins at runtime. */
const drawReticle = (): Graphics => {
  const g = new Graphics();
  const r = (LOOK.ref * LOOK.reticleD) / 2 - 4;
  const dashes = 12;
  const span = (Math.PI * 2) / dashes;
  const on = span * 0.62;
  const arcs = (width: number, color: number): void => {
    for (let i = 0; i < dashes; i++) {
      const a0 = i * span;
      g.moveTo(Math.cos(a0) * r, Math.sin(a0) * r).arc(0, 0, r, a0, a0 + on);
      g.stroke({ width, color, cap: 'round' });
    }
  };
  arcs(7.2, INK);
  arcs(3.8, 0xffffff);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + span * 0.81;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const px = -s;
    const py = c;
    const r0 = r - 5;
    const r1 = r - 14;
    g.poly([c * r0 + px * 5, s * r0 + py * 5, c * r0 - px * 5, s * r0 - py * 5, c * r1, s * r1], true)
      .fill(0xffffff)
      .stroke({ width: 2.2, color: INK, join: 'round' });
  }
  return g;
};

/** Soft round landing shadow (dark plum, alpha falls off to the rim). */
const shadowTexture = (): Texture => {
  const size = 128;
  const [c, g] = createCanvas(size, size);
  const r = size / 2;
  const grad = g.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0, 'rgba(14,6,24,0.95)');
  grad.addColorStop(0.55, 'rgba(14,6,24,0.8)');
  grad.addColorStop(0.82, 'rgba(14,6,24,0.35)');
  grad.addColorStop(1, 'rgba(14,6,24,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return canvasToTexture(c);
};

/** Trail ribbon strip: u (length) fades from the tail (0) to the head (1); v is a soft beam with a hot core. */
const trailTexture = (): Texture => {
  const w = 128;
  const h = 32;
  const [c, g] = createCanvas(w, h);
  const img = g.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    const v = (y + 0.5) / h - 0.5;
    const beam = Math.exp(-((v / 0.24) ** 2));
    const core = Math.exp(-((v / 0.08) ** 2));
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / w;
      const a = Math.min(1, (beam * 0.85 + core * 0.7) * u ** 0.85);
      const i = (y * w + x) * 4;
      img.data[i] = 255;
      img.data[i + 1] = 255;
      img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(a * 255);
    }
  }
  g.putImageData(img, 0, 0);
  return canvasToTexture(c);
};

/** Crisp additive ring (shock ring, return flash). */
const ringTexture = (): Texture => {
  const size = 256;
  const [c, g] = createCanvas(size, size);
  const r = size / 2;
  const grad = g.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(0.74, 'rgba(255,255,255,0)');
  grad.addColorStop(0.86, 'rgba(255,255,255,0.95)');
  grad.addColorStop(0.9, 'rgba(255,255,255,1)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return canvasToTexture(c);
};

/** Four-point glint star (lock snap, badge sparks). */
const glintTexture = (): Texture => {
  const size = 64;
  const [c, g] = createCanvas(size, size);
  const r = size / 2;
  const grad = g.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.beginPath();
  g.moveTo(r, 0);
  g.quadraticCurveTo(r, r, size, r);
  g.quadraticCurveTo(r, r, r, size);
  g.quadraticCurveTo(r, r, 0, r);
  g.quadraticCurveTo(r, r, r, 0);
  g.fill();
  return canvasToTexture(c);
};

export interface DropTextures {
  /** badge plate per tier 1..5 (index 0 unused) */
  plates: Texture[];
  flame: Texture;
  clamp: Texture;
  marker: Texture;
  reticle: Texture;
  shadow: Texture;
  trail: Texture;
  ring: Texture;
  glint: Texture;
  glow: Texture;
}

let fontsInstalled = false;

/** Live-text fonts: badge values (Lilita One, white, black stroke, plum shadow) and the teal "+1" (Titan One). */
const installFonts = (renderer: Renderer): void => {
  if (fontsInstalled) return;
  fontsInstalled = true;
  const resolution = Math.min(2, Math.max(1, renderer.resolution));
  BitmapFont.install({
    name: MULT_FONT,
    chars: [['0', '9'], ' ×x+'],
    resolution,
    padding: 8,
    style: {
      fontFamily: FONTS.royal,
      fontSize: 80,
      fill: 0xffffff,
      stroke: { color: INK, width: 8, join: 'round' },
      dropShadow: { color: PLUM, alpha: 1, blur: 0, distance: 4, angle: Math.atan2(0.83, 0.56) },
    },
  });
  BitmapFont.install({
    name: PLUS_FONT,
    chars: [['0', '9'], ' +×x'],
    resolution,
    padding: 8,
    style: {
      fontFamily: FONTS.value,
      fontSize: 64,
      fill: 0xffffff,
      stroke: { color: INK, width: 9, join: 'round' },
    },
  });
};

/** Bakes every placeholder part once (the app has no MSAA: Graphics are baked antialiased). */
export class DropArt {
  readonly tex: DropTextures;

  constructor(private readonly renderer: Renderer) {
    installFonts(renderer);
    const plates: Texture[] = [Texture.EMPTY];
    for (const t of MULT_TIERS) {
      const { w, h } = PLATE_SIZE[t.tier];
      plates.push(this.bakeCentered(drawPlate(t.tier), w / 2 + 8, h / 2 + 8));
    }
    this.tex = {
      plates,
      flame: this.bake(drawFlame(), new Rectangle(-28, -54, 56, 46)),
      clamp: this.bake(drawClamp(), new Rectangle(-10, -25, 30, 52)),
      marker: this.bakeCentered(drawHomeMarker(), LOOK.ref / 2 + 3, LOOK.ref / 2 + 3),
      reticle: this.bakeCentered(drawReticle(), LOOK.ref / 2, LOOK.ref / 2),
      shadow: shadowTexture(),
      trail: trailTexture(),
      ring: ringTexture(),
      glint: glintTexture(),
      glow: glowTexture(128),
    };
  }

  /** Brightened tier colour for additive garnish (sparks, trail). */
  static garnish(color: number): number {
    return lighten(color, 0.35);
  }

  private bakeCentered(target: Container, halfW: number, halfH: number): Texture {
    return this.bake(target, new Rectangle(-halfW, -halfH, halfW * 2, halfH * 2));
  }

  private bake(target: Container, frame: Rectangle): Texture {
    const tex = this.renderer.generateTexture({ target, frame, resolution: LOOK.bakeRes, antialias: true });
    target.destroy({ children: true });
    return tex;
  }

  destroy(): void {
    const t = this.tex;
    for (const p of t.plates) if (p !== Texture.EMPTY) p.destroy(true);
    for (const x of [t.flame, t.clamp, t.marker, t.reticle, t.shadow, t.trail, t.ring, t.glint]) x.destroy(true);
  }
}
