import { Container, FillGradient, Graphics } from 'pixi.js';
import type { Rect } from '../../config/layout';
import { rng } from '../background/paint';

/**
 * Weathered cypress-plank frame parts in the cel style of the foreground
 * (measured reference palette): face #d29039, grain #b96e29, highlight #da9b51,
 * beam underside #5b261d, sill face #b47e56 -> #836034, sill top #57241e, black
 * outline. Edges are jittered with a few chipped notches so the wood reads
 * hand-drawn rather than as programmer rectangles.
 */
export const WOOD = {
  face: 0xd29039,
  grain: 0xb96e29,
  light: 0xda9b51,
  under: 0x5b261d,
  sillTop: 0x57241e,
  sillFaceTop: 0xb47e56,
  sillFaceBottom: 0x836034,
  crack: 0x6b2c1c,
  ink: 0x000000,
  nail: 0x3a1e14,
  rope: 0xe0b56a,
  ropeShade: 0xa87434,
  ropeLight: 0xf6d99a,
};

type Rand = () => number;

/** Jittered rectangle outline with occasional chipped notches (flat [x,y,...]). */
const weatheredRect = (x: number, y: number, w: number, h: number, u: number, r: Rand, chips = true): number[] => {
  const pts: number[] = [];
  const j = 0.9 * u;
  const step = 26 * u;
  const edge = (x0: number, y0: number, x1: number, y1: number, nx: number, ny: number) => {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.max(1, Math.round(len / step));
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const px = x0 + (x1 - x0) * t;
      const py = y0 + (y1 - y0) * t;
      if (chips && i > 0 && i < n - 1 && r() < 0.14) {
        // chip: a small V bite into the wood
        const d = (2.5 + r() * 3.5) * u;
        const half = (4 + r() * 5) * u;
        const tx = (x1 - x0) / len;
        const ty = (y1 - y0) / len;
        pts.push(px - tx * half, py - ty * half, px - nx * d, py - ny * d, px + tx * half, py + ty * half);
      } else {
        const k = i === 0 ? 0 : (r() - 0.5) * 2 * j;
        pts.push(px + nx * k, py + ny * k);
      }
    }
  };
  edge(x, y, x + w, y, 0, -1);
  edge(x + w, y, x + w, y + h, 1, 0);
  edge(x + w, y + h, x, y + h, 0, 1);
  edge(x, y + h, x, y, -1, 0);
  return pts;
};

const vGrad = (top: number, bottom: number): FillGradient =>
  new FillGradient({
    type: 'linear',
    start: { x: 0, y: 0 },
    end: { x: 0, y: 1 },
    colorStops: [
      { offset: 0, color: top },
      { offset: 1, color: bottom },
    ],
    textureSpace: 'local',
  });

/** Wavy grain line along the plank. */
const grainLine = (g: Graphics, horizontal: boolean, a0: number, a1: number, b: number, amp: number, freq: number, ph: number, width: number, color: number): void => {
  const n = Math.max(6, Math.round(Math.abs(a1 - a0) / 18));
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    const off = Math.sin(a * freq + ph) * amp + Math.sin(a * freq * 2.3 + ph * 1.7) * amp * 0.35;
    if (horizontal) {
      if (i === 0) g.moveTo(a, b + off);
      else g.lineTo(a, b + off);
    } else if (i === 0) g.moveTo(b + off, a);
    else g.lineTo(b + off, a);
  }
  g.stroke({ width, color, cap: 'round', join: 'round' });
};

export interface PlankOptions {
  /** grain direction */
  horizontal: boolean;
  /** detail scale (1 at the 150 px cell) */
  u: number;
  seed: number;
  face?: number | FillGradient;
  /** hard light band on the lit edge (top / left) */
  lightBand?: boolean;
  /** darker band on the far edge (bottom / right) */
  shadeBand?: boolean;
  knots?: number;
  outline?: number;
  chips?: boolean;
}

/** One weathered cel-shaded plank. */
export const plank = (rect: Rect, o: PlankOptions): Container => {
  const { x, y, w, h } = rect;
  const u = o.u;
  const r = rng(o.seed);
  const c = new Container();
  const pts = weatheredRect(x, y, w, h, u, r, o.chips ?? true);
  const mask = new Graphics().poly(pts, true).fill(0xffffff);
  const g = new Graphics();
  g.rect(x - 4, y - 4, w + 8, h + 8).fill(o.face ?? WOOD.face);
  const across = o.horizontal ? h : w;
  const band = Math.max(2, Math.min(across * 0.16, 7 * u));
  if (o.lightBand ?? true) {
    if (o.horizontal) g.rect(x - 4, y - 4, w + 8, band + 4).fill(WOOD.light);
    else g.rect(x - 4, y - 4, band + 4, h + 8).fill(WOOD.light);
  }
  if (o.shadeBand ?? true) {
    if (o.horizontal) g.rect(x - 4, y + h - band * 1.2, w + 8, band * 1.2 + 4).fill(WOOD.grain);
    else g.rect(x + w - band * 1.2, y - 4, band * 1.2 + 4, h + 8).fill(WOOD.grain);
  }
  // grain
  const lines = Math.max(2, Math.round(across / (11 * u)));
  const len = o.horizontal ? w : h;
  const a0 = o.horizontal ? x : y;
  for (let i = 0; i < lines; i++) {
    const b = (o.horizontal ? y : x) + band + ((across - band * 2.2) * (i + 0.5)) / lines;
    // broken grain: a few long segments per line
    let a = a0 - 10;
    while (a < a0 + len) {
      const seg = (80 + r() * 260) * u;
      const gap = (10 + r() * 60) * u;
      grainLine(g, o.horizontal, a, Math.min(a0 + len + 10, a + seg), b, (1.2 + r() * 1.8) * u, 0.02 / u, r() * 6, 1.8 * u, WOOD.grain);
      a += seg + gap;
    }
  }
  // knots
  const knots = o.knots ?? Math.max(1, Math.round(len / (320 * u)));
  for (let i = 0; i < knots; i++) {
    const ka = a0 + len * (0.15 + 0.7 * r());
    const kb = (o.horizontal ? y : x) + across * (0.35 + 0.3 * r());
    const [kx, ky] = o.horizontal ? [ka, kb] : [kb, ka];
    const rx = (o.horizontal ? 9 : 4.5) * u;
    const ry = (o.horizontal ? 4.5 : 9) * u;
    g.ellipse(kx, ky, rx + 3 * u, ry + 3 * u).stroke({ width: 1.8 * u, color: WOOD.grain });
    g.ellipse(kx, ky, rx, ry).fill(WOOD.grain);
    g.ellipse(kx + 0.8 * u, ky + 0.8 * u, rx * 0.5, ry * 0.5).fill(WOOD.crack);
  }
  // cracks near the ends
  for (const end of [0, 1]) {
    if (r() < 0.6) continue;
    const ca = a0 + (end === 0 ? 14 * u : len - 14 * u - 30 * u);
    const cb = (o.horizontal ? y : x) + across * (0.3 + 0.4 * r());
    if (o.horizontal) g.moveTo(ca, cb).lineTo(ca + 30 * u, cb + 2 * u).stroke({ width: 1.6 * u, color: WOOD.crack, cap: 'round' });
    else g.moveTo(cb, ca).lineTo(cb + 2 * u, ca + 30 * u).stroke({ width: 1.6 * u, color: WOOD.crack, cap: 'round' });
  }
  c.addChild(g, mask);
  c.mask = mask;
  const line = new Graphics().poly(pts, true).stroke({ width: o.outline ?? Math.max(2.5, 4 * u), color: WOOD.ink, join: 'round' });
  c.addChild(line);
  return c;
};

/** Nail head with a tiny highlight. */
export const nail = (g: Graphics, x: number, y: number, u: number): void => {
  g.circle(x, y, 3.2 * u).fill(WOOD.nail).stroke({ width: 1.4 * u, color: WOOD.ink });
  g.circle(x - 0.9 * u, y - 0.9 * u, 1 * u).fill(0xc9a27a);
};

/** Rope wrap band (coils) around a vertical post at [x, x+w], from y down h. */
export const ropeWrap = (x: number, y: number, w: number, h: number, u: number): Container => {
  const c = new Container();
  const g = new Graphics();
  const coils = Math.max(3, Math.round(h / (8 * u)));
  const ch = h / coils;
  const over = 3 * u;
  for (let i = 0; i < coils; i++) {
    const cy = y + i * ch;
    const pts = [x - over, cy + ch * 0.35, x + w + over, cy - ch * 0.15, x + w + over, cy + ch * 0.85, x - over, cy + ch * 1.35];
    g.poly(pts, true).fill(WOOD.rope);
    // cel shade on the lower half of each coil + a light twist line
    g.poly([x - over, cy + ch * 0.9, x + w + over, cy + ch * 0.4, x + w + over, cy + ch * 0.85, x - over, cy + ch * 1.35], true).fill(WOOD.ropeShade);
    g.moveTo(x + w * 0.1, cy + ch * 0.45).lineTo(x + w * 0.6, cy + ch * 0.22).stroke({ width: 1.6 * u, color: WOOD.ropeLight, cap: 'round' });
    g.poly(pts, true).stroke({ width: 2 * u, color: WOOD.ink, join: 'round' });
  }
  c.addChild(g);
  return c;
};

/** Sill: shadowed top surface + graded face. */
export const sillPart = (rect: Rect, u: number, seed: number): Container => {
  const c = new Container();
  const topH = Math.max(3, rect.h * 0.2);
  c.addChild(
    plank({ x: rect.x, y: rect.y, w: rect.w, h: topH }, { horizontal: true, u, seed: seed + 1, face: WOOD.sillTop, lightBand: false, shadeBand: false, knots: 0, chips: false }),
  );
  c.addChild(
    plank(
      { x: rect.x, y: rect.y + topH, w: rect.w, h: rect.h - topH },
      { horizontal: true, u, seed, face: vGrad(WOOD.sillFaceTop, WOOD.sillFaceBottom), lightBand: false, shadeBand: true },
    ),
  );
  return c;
};
