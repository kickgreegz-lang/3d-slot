import { BlurFilter, Container, FillGradient, Graphics, Sprite, type Texture } from 'pixi.js';
import type { Rect } from '../../../../config/layout';
import type { Composition, ScenePalette, Swag } from './theme';

/**
 * Procedural painter for the juke-joint background. Everything here is drawn ONCE
 * and baked to a texture by Background.ts; the live parts (neon flicker, bulb
 * twinkle, fireflies, haze, light cones) are in BgFx.ts.
 *
 * Linework is deliberately thinner (2 px) and lower-contrast than the 4.6 px
 * foreground outline so the symbols always win.
 */

const vGrad = (stops: [number, number][]): FillGradient =>
  new FillGradient({
    type: 'linear',
    start: { x: 0, y: 0 },
    end: { x: 0, y: 1 },
    colorStops: stops.map(([offset, color]) => ({ offset, color })),
    textureSpace: 'local',
  });

const rgba = (c: number, a: number): string => `rgba(${(c >> 16) & 255},${(c >> 8) & 255},${c & 255},${a})`;

const alphaGrad = (color: number, stops: [number, number][], vertical = true): FillGradient =>
  new FillGradient({
    type: 'linear',
    start: { x: 0, y: 0 },
    end: vertical ? { x: 0, y: 1 } : { x: 1, y: 0 },
    colorStops: stops.map(([offset, a]) => ({ offset, color: rgba(color, a) })),
    textureSpace: 'local',
  });

/** Deterministic PRNG so the scene is identical on every boot/capture. */
export const rng = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** Soft additive glow sprite from the shared radial glow texture (128 px). */
export const glowSprite = (tex: Texture, x: number, y: number, rx: number, ry: number, color: number, alpha: number, add = true): Sprite => {
  const s = new Sprite(tex);
  s.anchor.set(0.5);
  s.position.set(x, y);
  s.scale.set((rx * 2) / tex.width, (ry * 2) / tex.height);
  s.tint = color;
  s.alpha = alpha;
  if (add) s.blendMode = 'add';
  return s;
};

const soften = (child: Container, strength: number): Container => {
  const c = new Container();
  c.addChild(child);
  c.filters = [new BlurFilter({ strength, quality: 3 })];
  return c;
};

// ---------------------------------------------------------------------------
// room shell

const paintRoom = (root: Container, c: Composition, p: ScenePalette, r: () => number): void => {
  const { W, H } = c;
  const g = new Graphics();
  g.rect(-20, -20, W + 40, c.rail + 20).fill(vGrad([[0, p.wallTop], [1, p.wallBottom]]));
  // board-and-batten wall
  for (let x = -10; x < W + 20; x += 58 + Math.floor(r() * 10)) {
    g.rect(x, c.ceiling, 3, c.rail - c.ceiling).fill({ color: p.line, alpha: 0.55 });
    g.rect(x + 3, c.ceiling, 1.5, c.rail - c.ceiling).fill({ color: p.railLight, alpha: 0.18 });
    // knots / nail heads, sparse and dim
    if (r() > 0.55) g.circle(x + 18 + r() * 20, c.ceiling + 40 + r() * (c.rail - c.ceiling - 80), 1.8).fill({ color: p.line, alpha: 0.5 });
  }
  // ceiling beam
  g.rect(-20, -20, W + 40, c.ceiling + 20).fill(p.line);
  g.rect(-20, c.ceiling - 6, W + 40, 6).fill({ color: p.rail, alpha: 1 });
  for (let x = 40; x < W; x += 240) g.rect(x, c.ceiling, 22, 16).fill(p.line);
  // wainscot
  g.rect(-20, c.rail, W + 40, c.floor - c.rail).fill(vGrad([[0, p.wainscot], [1, p.floorTop]]));
  for (let x = -6; x < W + 20; x += 42) g.rect(x, c.rail + 18, 2.5, c.floor - c.rail - 18).fill({ color: p.line, alpha: 0.6 });
  // chair rail
  g.rect(-20, c.rail - 8, W + 40, 26).fill(p.rail);
  g.rect(-20, c.rail - 8, W + 40, 4).fill(p.railLight);
  g.rect(-20, c.rail + 16, W + 40, 3).fill(p.line);
  // plank floor in perspective
  g.rect(-20, c.floor, W + 40, H - c.floor + 20).fill(vGrad([[0, p.floorTop], [1, p.floorBottom]]));
  g.rect(-20, c.floor, W + 40, 5).fill(p.line);
  const depth = H - c.floor;
  for (let k = 1; k < 9; k++) {
    const y = c.floor + depth * (k / 9) ** 1.6;
    g.rect(-20, y, W + 40, 1.6).fill({ color: p.floorLine, alpha: 0.9 });
  }
  for (let i = -24; i <= 24; i++) {
    const xb = c.horizon.x + i * 120;
    const t = (c.floor - c.horizon.y) / (H + 40 - c.horizon.y);
    const xt = c.horizon.x + (xb - c.horizon.x) * t;
    g.moveTo(xt, c.floor).lineTo(xb, H + 40).stroke({ width: 1.6, color: p.floorLine, alpha: 0.9 });
  }
  root.addChild(g);
};

// ---------------------------------------------------------------------------
// moon window with cypress silhouettes

const cypress = (g: Graphics, x: number, base: number, h: number, color: number, r: () => number): void => {
  const w = h * 0.07;
  const top = base - h;
  // buttressed trunk, tapering up into the crown
  g.moveTo(x - w * 2.4, base)
    .quadraticCurveTo(x - w * 0.9, base - h * 0.1, x - w * 0.7, base - h * 0.35)
    .lineTo(x - w * 0.35, top + h * 0.2)
    .lineTo(x + w * 0.35, top + h * 0.2)
    .lineTo(x + w * 0.7, base - h * 0.35)
    .quadraticCurveTo(x + w * 0.9, base - h * 0.1, x + w * 2.4, base)
    .closePath()
    .fill(color);
  // limbs
  for (let i = 0; i < 4; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const y0 = top + h * (0.22 + i * 0.07);
    g.moveTo(x, y0).quadraticCurveTo(x + side * w * 3, y0 - h * 0.02, x + side * w * (4 + r() * 3), y0 - h * 0.06).stroke({ width: w * 0.5, color, cap: 'round' });
  }
  // flat-topped clumped crown
  for (let i = 0; i < 11; i++) {
    const cx = x + (r() - 0.5) * w * 10;
    const cy = top + h * (0.04 + r() * 0.2);
    g.ellipse(cx, cy, w * (1.6 + r() * 1.4), w * (0.9 + r() * 0.7)).fill(color);
  }
  // spanish moss
  for (let i = 0; i < 12; i++) {
    const mx = x + (r() - 0.5) * w * 9;
    const my = top + h * (0.14 + r() * 0.16);
    const len = h * (0.08 + r() * 0.16);
    g.moveTo(mx - w * 0.35, my).quadraticCurveTo(mx + w * 0.5, my + len * 0.55, mx + w * 0.1, my + len).lineTo(mx + w * 0.35, my).closePath().fill(color);
  }
  // cypress knees
  for (let i = 0; i < 3; i++) {
    const kx = x + (r() - 0.5) * w * 12;
    g.moveTo(kx - w * 0.5, base).lineTo(kx, base - h * (0.03 + r() * 0.04)).lineTo(kx + w * 0.5, base).closePath().fill(color);
  }
};

const archPath = (g: Graphics, x: number, y: number, w: number, h: number): Graphics => {
  const rr = w / 2;
  return g
    .moveTo(x, y + h)
    .lineTo(x, y + rr)
    .arc(x + rr, y + rr, rr, Math.PI, Math.PI * 2)
    .lineTo(x + w, y + h)
    .closePath();
};

const paintWindow = (root: Container, win: Rect, p: ScenePalette, glow: Texture, r: () => number): void => {
  const { x, y, w, h } = win;
  const t = 14;
  // moonlight spill on the wall
  root.addChild(glowSprite(glow, x + w * 0.6, y + h * 0.4, w * 1.3, h * 1.1, p.moonGlow, 0.16));

  const inner = new Container();
  const sky = new Graphics();
  const ix = x + t;
  const iy = y + t;
  const iw = w - t * 2;
  const ih = h - t * 2;
  const horizon = iy + ih * 0.74;
  sky.rect(ix, iy, iw, horizon - iy).fill(vGrad([[0, p.skyTop], [1, p.skyBottom]]));
  sky.rect(ix, horizon, iw, iy + ih - horizon).fill(p.water);
  inner.addChild(sky);
  const mx = ix + iw * 0.68;
  const my = iy + ih * 0.3;
  inner.addChild(glowSprite(glow, mx, my, iw * 0.7, iw * 0.7, p.moonGlow, 0.55));
  const moon = new Graphics().circle(mx, my, iw * 0.13).fill(p.moon);
  moon.circle(mx + iw * 0.04, my - iw * 0.02, iw * 0.03).fill({ color: p.moonGlow, alpha: 0.35 });
  moon.circle(mx - iw * 0.05, my + iw * 0.04, iw * 0.02).fill({ color: p.moonGlow, alpha: 0.3 });
  inner.addChild(moon);
  const trees = new Graphics();
  cypress(trees, ix + iw * 0.36, horizon + 3, ih * 0.34, p.treeFar, r);
  cypress(trees, ix + iw * 0.86, horizon + 3, ih * 0.3, p.treeFar, r);
  cypress(trees, ix + iw * 0.62, horizon + 3, ih * 0.24, p.treeFar, r);
  cypress(trees, ix + iw * 0.12, horizon + 6, ih * 0.52, p.treeNear, r);
  trees.rect(ix, horizon + 2, iw, 6).fill(p.treeNear);
  inner.addChild(trees);
  // moon reflection streaks on the water
  const refl = new Graphics();
  for (let i = 0; i < 5; i++) {
    const ry = horizon + 12 + i * 9;
    const rw = iw * (0.2 - i * 0.03);
    refl.roundRect(mx - rw / 2 + (r() - 0.5) * 8, ry, rw, 2.5, 1.2).fill({ color: p.moon, alpha: 0.5 - i * 0.07 });
  }
  inner.addChild(refl);
  const mask = archPath(new Graphics(), ix, iy, iw, ih).fill(0xffffff);
  inner.addChild(mask);
  inner.mask = mask;
  root.addChild(inner);

  // frame, muntins, sill
  const f = new Graphics();
  archPath(f, x, y, w, h).fill(p.wood);
  archPath(f, ix, iy, iw, ih).cut();
  archPath(f, x, y, w, h).stroke({ width: 2, color: p.line });
  archPath(f, ix, iy, iw, ih).stroke({ width: 2, color: p.line });
  f.rect(x + w / 2 - 4, iy, 8, ih).fill(p.wood).stroke({ width: 1.6, color: p.line });
  f.rect(ix, iy + ih * 0.5, iw, 8).fill(p.wood).stroke({ width: 1.6, color: p.line });
  f.rect(x - 12, y + h - 4, w + 24, 14).fill(p.woodLight).stroke({ width: 2, color: p.line });
  f.rect(x - 12, y + h + 10, w + 24, 6).fill(p.wood);
  // glass glint
  f.moveTo(ix + 10, iy + ih * 0.46).lineTo(ix + 30, iy + ih * 0.26).stroke({ width: 3, color: 0xffffff, alpha: 0.18, cap: 'round' });
  root.addChild(f);
};

// ---------------------------------------------------------------------------
// firefly jar shelves (left light mass)

const paintShelves = (root: Container, c: Composition, p: ScenePalette, glow: Texture, r: () => number): void => {
  const glows = new Container();
  const g = new Graphics();
  for (const s of c.shelves) {
    const jw = 46;
    const jh = 60;
    const gap = (s.w - 24 - s.jars * jw) / Math.max(1, s.jars - 1);
    for (let i = 0; i < s.jars; i++) {
      const jx = s.x + 12 + i * (jw + gap);
      const jy = s.y - jh;
      glows.addChild(glowSprite(glow, jx + jw / 2, jy + jh * 0.55, 80, 80, p.jarGlow, 0.3));
      // glass body
      g.roundRect(jx, jy + 8, jw, jh - 8, 10).fill({ color: p.jarGlass, alpha: 0.55 });
      g.roundRect(jx + 4, jy + 16, jw - 8, jh - 20, 8).fill({ color: p.jarGlow, alpha: 0.35 });
      g.roundRect(jx, jy + 8, jw, jh - 8, 10).stroke({ width: 2, color: p.line });
      // lid
      g.roundRect(jx + 3, jy, jw - 6, 11, 3).fill(p.lid).stroke({ width: 2, color: p.line });
      // fireflies inside
      for (let k = 0; k < 4; k++) g.circle(jx + 10 + r() * (jw - 20), jy + 22 + r() * (jh - 34), 1.8 + r() * 1.2).fill(p.firefly);
      g.moveTo(jx + 8, jy + 18).lineTo(jx + 8, jy + jh - 10).stroke({ width: 2.5, color: 0xffffff, alpha: 0.28, cap: 'round' });
    }
    // plank + brackets
    g.rect(s.x, s.y, s.w, 12).fill(p.woodLight).stroke({ width: 2, color: p.line });
    g.rect(s.x, s.y + 12, s.w, 5).fill(p.wood);
    for (const bx of [s.x + 26, s.x + s.w - 40]) {
      g.moveTo(bx, s.y + 17).lineTo(bx + 14, s.y + 17).lineTo(bx + 14, s.y + 44).closePath().fill(p.wood).stroke({ width: 1.6, color: p.line });
    }
  }
  root.addChild(g, glows);
};

// ---------------------------------------------------------------------------
// neon gator sign (right light mass). Tubes are shared by the unlit (baked) and
// lit (BgFx) versions.

export type SignPart = 'all' | 'gator' | 'accent';

/** Neon tube strokes in sign-local coordinates (board is 300x210 centred). */
export const signTubes = (g: Graphics, width: number, main: number, accent: number, alpha = 1, part: SignPart = 'all'): Graphics => {
  const s = { width, color: main, alpha, cap: 'round' as const, join: 'round' as const };
  if (part !== 'accent') gatorTubes(g, s, width);
  if (part !== 'gator') accentTubes(g, { ...s, color: accent });
  return g;
};

interface TubeStyle {
  width: number;
  color: number;
  alpha: number;
  cap: 'round';
  join: 'round';
}

const gatorTubes = (g: Graphics, s: TubeStyle, width: number): void => {
  // gator head profile, jaws open
  g.moveTo(70, -22)
    .bezierCurveTo(40, -58, -30, -44, -112, -26)
    .quadraticCurveTo(-128, -20, -116, -8)
    .lineTo(18, -8)
    .stroke(s);
  g.moveTo(22, 4).lineTo(-96, 30).quadraticCurveTo(-110, 36, -100, 44).bezierCurveTo(-50, 46, 10, 40, 58, 24).stroke(s);
  g.moveTo(70, -22).quadraticCurveTo(84, 2, 58, 24).stroke(s);
  // teeth
  for (let i = 0; i < 6; i++) {
    const tx = -100 + i * 20;
    g.moveTo(tx, -8).lineTo(tx + 6, 2).lineTo(tx + 12, -8).stroke({ ...s, width: width * 0.7 });
    const bx = -84 + i * 18;
    const by = 32 - i * 3.6;
    g.moveTo(bx, by).lineTo(bx + 6, by - 9).lineTo(bx + 12, by - 2).stroke({ ...s, width: width * 0.7 });
  }
  // eye bump + eye
  g.moveTo(14, -44).quadraticCurveTo(30, -66, 48, -44).stroke(s);
  g.circle(31, -46, 5).stroke(s);
  // nostril
  g.moveTo(-106, -30).quadraticCurveTo(-100, -38, -92, -32).stroke({ ...s, width: width * 0.8 });
};

const accentTubes = (g: Graphics, a: TubeStyle): void => {
  // sound waves + star + underline swoosh
  g.arc(-122, 24, 16, 2.0, 2.9).stroke(a);
  g.arc(-122, 24, 28, 2.05, 2.85).stroke(a);
  const sx = 110;
  const sy = -58;
  g.moveTo(sx, sy - 18)
    .lineTo(sx + 5, sy - 5)
    .lineTo(sx + 18, sy - 4)
    .lineTo(sx + 8, sy + 5)
    .lineTo(sx + 12, sy + 18)
    .lineTo(sx, sy + 10)
    .lineTo(sx - 12, sy + 18)
    .lineTo(sx - 8, sy + 5)
    .lineTo(sx - 18, sy - 4)
    .lineTo(sx - 5, sy - 5)
    .closePath()
    .stroke(a);
  g.moveTo(-90, 74).bezierCurveTo(-30, 62, 50, 86, 118, 64).stroke(a);
};

const paintSign = (root: Container, c: Composition, p: ScenePalette): void => {
  const sign = new Container();
  sign.position.set(c.sign.x, c.sign.y);
  sign.scale.set(c.sign.scale);
  sign.angle = c.sign.rot;
  const g = new Graphics();
  // hanging wires
  g.moveTo(-110, -105).lineTo(-80, -400).stroke({ width: 2, color: p.line });
  g.moveTo(110, -105).lineTo(80, -400).stroke({ width: 2, color: p.line });
  g.roundRect(-160, -110, 320, 220, 26).fill(p.board).stroke({ width: 2.5, color: p.line });
  g.roundRect(-150, -100, 300, 200, 20).stroke({ width: 2, color: p.neonOff, alpha: 0.6 });
  for (const [bx, by] of [
    [-140, -90],
    [140, -90],
    [-140, 90],
    [140, 90],
  ]) {
    g.circle(bx, by, 4).fill(p.lid);
  }
  sign.addChild(g);
  // unlit glass tubes (the lit overlay lives in BgFx)
  sign.addChild(signTubes(new Graphics(), 6, p.neonOff, p.neonOff));
  sign.addChild(signTubes(new Graphics(), 2, 0xffffff, 0xffffff, 0.12));
  root.addChild(sign);
};

// ---------------------------------------------------------------------------
// string lights

/** Point on a swag (quadratic catenary approximation), t in 0..1. */
export const swagPoint = (s: Swag, t: number): { x: number; y: number } => {
  const cx = (s.x0 + s.x1) / 2;
  const cy = (s.y0 + s.y1) / 2 + s.sag * 2;
  const u = 1 - t;
  return {
    x: u * u * s.x0 + 2 * u * t * cx + t * t * s.x1,
    y: u * u * s.y0 + 2 * u * t * cy + t * t * s.y1,
  };
};

export interface Bulb {
  x: number;
  y: number;
  color: number;
}

export const bulbsOf = (c: Composition, p: ScenePalette): Bulb[] => {
  const out: Bulb[] = [];
  let k = 0;
  for (const s of c.swags) {
    const len = Math.hypot(s.x1 - s.x0, s.y1 - s.y0);
    const n = Math.max(2, Math.round(len / 54));
    for (let i = 1; i < n; i++) {
      const pt = swagPoint(s, i / n);
      out.push({ x: pt.x, y: pt.y + 11, color: p.bulbs[k++ % p.bulbs.length] });
    }
  }
  return out;
};

const paintStrings = (root: Container, c: Composition, p: ScenePalette, glow: Texture): void => {
  const g = new Graphics();
  for (const s of c.swags) {
    const cx = (s.x0 + s.x1) / 2;
    const cy = (s.y0 + s.y1) / 2 + s.sag * 2;
    g.moveTo(s.x0, s.y0).quadraticCurveTo(cx, cy, s.x1, s.y1).stroke({ width: 2, color: p.wire });
  }
  const glows = new Container();
  for (const b of bulbsOf(c, p)) {
    glows.addChild(glowSprite(glow, b.x, b.y + 4, 30, 30, b.color, 0.45));
    g.rect(b.x - 3, b.y - 9, 6, 6).fill(p.wire);
    g.ellipse(b.x, b.y, 5, 7).fill(b.color);
    g.ellipse(b.x - 1.5, b.y - 2, 1.6, 2.6).fill({ color: 0xffffff, alpha: 0.85 });
  }
  root.addChild(glows, g);
};

// ---------------------------------------------------------------------------
// DJ speaker stack (right, mostly behind the frog DJ)

const paintSpeakers = (root: Container, c: Composition, p: ScenePalette): void => {
  if (!c.speakers) return;
  const { x, y, scale } = c.speakers;
  const g = new Graphics();
  const box = (bx: number, by: number, bw: number, bh: number, cones: number) => {
    g.roundRect(bx, by, bw, bh, 8).fill(p.speaker).stroke({ width: 2, color: p.line });
    g.roundRect(bx + 8, by + 8, bw - 16, bh - 16, 6).stroke({ width: 1.6, color: p.railLight, alpha: 0.25 });
    for (let i = 0; i < cones; i++) {
      const cy = by + (bh / cones) * (i + 0.5);
      const rr = Math.min(bw, bh / cones) * 0.34;
      g.circle(bx + bw / 2, cy, rr).fill(p.wainscot).stroke({ width: 2, color: p.railLight, alpha: 0.35 });
      g.circle(bx + bw / 2, cy, rr * 0.35).fill(p.line);
    }
  };
  box(x - 150 * scale, y - 220 * scale, 150 * scale, 220 * scale, 2);
  box(x, y - 280 * scale, 170 * scale, 280 * scale, 2);
  box(x - 150 * scale, y, 320 * scale, 150 * scale, 1);
  root.addChild(g);
};

// ---------------------------------------------------------------------------
// ceiling spot lamps (cone sources when on screen) + light pools on the floor

const paintLamps = (root: Container, c: Composition, p: ScenePalette, glow: Texture): void => {
  const g = new Graphics();
  const pools = new Container();
  for (const cone of c.cones) {
    const a = (cone.angle * Math.PI) / 180;
    // where the cone axis meets the floor
    const fx = cone.x + Math.tan(a) * (c.floor + 40 - cone.y);
    if (fx > -200 && fx < c.W + 200) {
      pools.addChild(glowSprite(glow, fx, c.floor + 60, cone.spread * 0.55, 46, p.cone, 0.22));
    }
    if (cone.y < 0) continue;
    const x = cone.x;
    const y = cone.y;
    g.rect(x - 2, 0, 4, y).fill(p.line);
    g.poly([x - 14, y, x + 14, y, x + 20, y + 26, x - 20, y + 26], true).fill(p.speaker).stroke({ width: 2, color: p.line });
    g.rect(x - 12, y + 2, 5, 20).fill({ color: p.railLight, alpha: 0.5 });
    g.ellipse(x, y + 27, 17, 5).fill(0xfff4d6);
    root.addChild(glowSprite(glow, x, y + 30, 60, 40, p.cone, 0.6));
  }
  root.addChild(pools, g);
};

/** Neon / jar reflections pooling on the plank floor (tall layouts show a lot of floor). */
const paintFloorLight = (root: Container, c: Composition, p: ScenePalette, glow: Texture): void => {
  const depth = c.H - c.floor;
  const y = c.floor + depth * 0.4;
  const shelf = c.shelves[0];
  root.addChild(glowSprite(glow, c.sign.x, y, 320, Math.min(90, depth * 0.3), p.neon, 0.16));
  if (shelf) root.addChild(glowSprite(glow, shelf.x + shelf.w / 2, y, 260, Math.min(80, depth * 0.3), p.jarGlow, 0.12));
  root.addChild(glowSprite(glow, c.W / 2, c.floor + depth * 0.55, c.W * 0.34, depth * 0.3, p.neonAccent, 0.1));
};

// ---------------------------------------------------------------------------

/** Full static scene (scene units). */
export const paintScene = (c: Composition, p: ScenePalette, glow: Texture): Container => {
  const r = rng(0x5eed);
  const root = new Container({ label: 'bgScene' });
  paintRoom(root, c, p, r);
  // ambient washes (top-left violet key, faint magenta bottom-right)
  root.addChild(glowSprite(glow, 0, 0, c.W * 0.55, c.H * 0.6, p.ambient, 0.3));
  root.addChild(glowSprite(glow, c.W, c.H, c.W * 0.5, c.H * 0.45, p.neonAccent, 0.1));
  paintWindow(root, c.window, p, glow, r);
  paintShelves(root, c, p, glow, r);
  paintSpeakers(root, c, p);
  paintSign(root, c, p);
  // sign spill on the wall (static base; BgFx flickers the bright part)
  root.addChild(glowSprite(glow, c.sign.x, c.sign.y, 260 * c.sign.scale, 200 * c.sign.scale, p.neon, 0.12));
  paintStrings(root, c, p, glow);
  paintLamps(root, c, p, glow);
  paintFloorLight(root, c, p, glow);
  // calm centre: darken behind the reels so symbols carry the contrast
  const calm = c.calm;
  root.addChild(
    glowSprite(glow, calm.x + calm.w / 2, calm.y + calm.h / 2, calm.w * 0.85, calm.h * 0.85, 0x000000, 0.55, false),
  );
  // soft floor-to-wall haze band at the rail
  const band = new Graphics().rect(-20, c.rail - 60, c.W + 40, 120).fill(alphaGrad(p.ambient, [[0, 0], [0.5, 0.06], [1, 0]]));
  root.addChild(soften(band, 8));
  return root;
};

/** Cone-of-light texture source (white, soft), drawn pointing down from (0,0). */
export const paintCone = (len: number, spread: number): Container => {
  const g = new Graphics();
  g.moveTo(-34, 0)
    .lineTo(34, 0)
    .lineTo(spread / 2, len)
    .lineTo(-spread / 2, len)
    .closePath()
    .fill(alphaGrad(0xffffff, [[0, 0.75], [0.35, 0.4], [0.75, 0.12], [1, 0]]));
  // brighter core
  g.moveTo(-16, 0)
    .lineTo(16, 0)
    .lineTo(spread * 0.2, len * 0.75)
    .lineTo(-spread * 0.2, len * 0.75)
    .closePath()
    .fill(alphaGrad(0xffffff, [[0, 0.6], [0.45, 0.15], [1, 0]]));
  return soften(g, 12);
};

/** Lit neon tubes (sign-local coords) for additive flicker in BgFx. */
export const paintSignLit = (p: ScenePalette, part: Exclude<SignPart, 'all'>): Container => {
  const c = new Container();
  const halo = signTubes(new Graphics(), 20, p.neon, p.neonAccent, 0.5, part);
  c.addChild(soften(halo, 10));
  c.addChild(signTubes(new Graphics(), 7, p.neon, p.neonAccent, 1, part));
  c.addChild(signTubes(new Graphics(), 2.4, 0xffffff, 0xffffff, 0.9, part));
  return c;
};
