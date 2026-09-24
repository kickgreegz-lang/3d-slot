import { CanvasSource, Texture } from 'pixi.js';
import type { SpotBand } from '../config/game';

/**
 * Baked textures for the board: heat-tier tiles, additive flash/glow overlays and
 * the anticipation beam parts. Drawn ONCE per (tier, cell size, resolution) with
 * Canvas2D — its shadowBlur gives true gaussian rims/glows that layered Graphics
 * strokes can't match — and cached as Pixi textures. Nothing here runs per frame.
 *
 * Heat-tier colours: research1/critic.md "heat-tier colours" (measured from the
 * reference): T0 dark tile + soft warm border, T1 marked payframe, T2 dim, T3 red
 * bottom, T4 hot fill + soft rim, T5 blazing gradient stroke + specular + glow.
 */
export type SpotTier = SpotBand['tier'];
export type OverlayKind = 'flash' | 'ring' | 'wash';

/** Tile texture padding (fraction of cell) so outer glows are not clipped. */
export const TILE_PAD = 0.14;
/** Corner radius as a fraction of the cell (reference: ~20 px at 150 px). */
export const TILE_RADIUS = 0.13;

type Ctx2D = CanvasRenderingContext2D;

const cache = new Map<string, Texture>();

const canvas = (w: number, h: number, res: number): { c: HTMLCanvasElement; g: Ctx2D } => {
  const c = document.createElement('canvas');
  c.width = Math.ceil(w * res);
  c.height = Math.ceil(h * res);
  const g = c.getContext('2d');
  if (!g) throw new Error('2D canvas unavailable');
  g.scale(res, res);
  return { c, g };
};

const toTexture = (c: HTMLCanvasElement, res: number): Texture =>
  new Texture({ source: new CanvasSource({ resource: c, resolution: res }) });

const rrPath = (g: Ctx2D, x: number, y: number, w: number, h: number, r: number): void => {
  const rr = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + rr, y);
  g.arcTo(x + w, y, x + w, y + h, rr);
  g.arcTo(x + w, y + h, x, y + h, rr);
  g.arcTo(x, y + h, x, y, rr);
  g.arcTo(x, y, x + w, y, rr);
  g.closePath();
};

interface TileBox {
  x: number;
  y: number;
  s: number;
  r: number;
}

const vGrad = (g: Ctx2D, b: TileBox, stops: [number, string][]): CanvasGradient => {
  const grad = g.createLinearGradient(0, b.y, 0, b.y + b.s);
  for (const [o, col] of stops) grad.addColorStop(o, col);
  return grad;
};

/** Soft glow OUTSIDE the tile (shadow of an off-canvas copy, so the shape itself never draws). */
const outerGlow = (g: Ctx2D, b: TileBox, color: string, blur: number, alpha: number, passes = 1): void => {
  g.save();
  g.globalAlpha = alpha;
  g.shadowColor = color;
  g.shadowBlur = blur;
  const off = 10000;
  g.shadowOffsetX = off;
  g.fillStyle = '#000';
  for (let i = 0; i < passes; i++) {
    rrPath(g, b.x - off, b.y, b.s, b.s, b.r);
    g.fill();
  }
  g.restore();
};

/** Soft glow INSIDE the tile along its edge. */
const innerGlow = (g: Ctx2D, b: TileBox, color: string, blur: number, width: number, alpha: number): void => {
  g.save();
  rrPath(g, b.x, b.y, b.s, b.s, b.r);
  g.clip();
  g.globalAlpha = alpha;
  g.shadowColor = color;
  g.shadowBlur = blur;
  g.lineWidth = width;
  g.strokeStyle = color;
  rrPath(g, b.x, b.y, b.s, b.s, b.r);
  g.stroke();
  g.restore();
};

/** Rim stroke inset so it sits fully inside the tile edge; `blur` > 0 softens it. */
const rim = (
  g: Ctx2D,
  b: TileBox,
  style: string | CanvasGradient,
  width: number,
  alpha: number,
  blur = 0,
  glowColor?: string,
): void => {
  g.save();
  g.globalAlpha = alpha;
  if (blur > 0) {
    g.shadowColor = glowColor ?? (typeof style === 'string' ? style : '#000');
    g.shadowBlur = blur;
  }
  g.lineWidth = width;
  g.strokeStyle = style;
  const i = width / 2;
  rrPath(g, b.x + i, b.y + i, b.s - 2 * i, b.s - 2 * i, Math.max(1, b.r - i));
  g.stroke();
  g.restore();
};

const fill = (g: Ctx2D, b: TileBox, style: string | CanvasGradient): void => {
  g.fillStyle = style;
  rrPath(g, b.x, b.y, b.s, b.s, b.r);
  g.fill();
};

/** Clipped paint inside the tile (bands, radial hot spots). */
const inside = (g: Ctx2D, b: TileBox, paint: () => void): void => {
  g.save();
  rrPath(g, b.x, b.y, b.s, b.s, b.r);
  g.clip();
  paint();
  g.restore();
};

/** Thin highlight line hugging the top inner edge (key light top-left). */
const topSheen = (g: Ctx2D, b: TileBox, color: string, alpha: number, width: number): void => {
  g.save();
  g.globalAlpha = alpha;
  g.strokeStyle = color;
  g.lineWidth = width;
  g.lineCap = 'round';
  const y = b.y + width * 1.6;
  g.beginPath();
  g.moveTo(b.x + b.r * 0.9, y);
  g.lineTo(b.x + b.s - b.r * 0.9, y);
  g.stroke();
  g.restore();
};

const drawTier = (g: Ctx2D, b: TileBox, tier: SpotTier, k: number): void => {
  // k = cell / 150 (all px values below are authored at 150 px cells)
  switch (tier) {
    case 0: {
      fill(g, b, vGrad(g, b, [[0, '#24365b'], [0.6, '#1e2c4b'], [1, '#1a2542']]));
      inside(g, b, () => {
        const rad = g.createRadialGradient(b.x + b.s * 0.25, b.y + b.s * 0.2, 0, b.x + b.s * 0.25, b.y + b.s * 0.2, b.s * 0.9);
        rad.addColorStop(0, 'rgba(110,150,220,0.10)');
        rad.addColorStop(1, 'rgba(110,150,220,0)');
        g.fillStyle = rad;
        g.fillRect(b.x, b.y, b.s, b.s);
      });
      rim(g, b, '#3b3634', 3.2 * k, 0.95, 3 * k, '#4a3f38');
      topSheen(g, b, '#9fb6e6', 0.08, 1.2 * k);
      break;
    }
    case 1: {
      outerGlow(g, b, '#ffb21e', 12 * k, 0.75);
      fill(g, b, vGrad(g, b, [[0, '#1e4a63'], [0.55, '#183a55'], [1, '#132b45']]));
      innerGlow(g, b, '#35f2e0', 16 * k, 5 * k, 0.8);
      rim(g, b, vGrad(g, b, [[0, '#ffe07a'], [0.5, '#ffc629'], [1, '#f59a12']]), 3 * k, 1, 4 * k, '#ffb21e');
      topSheen(g, b, '#fff4c4', 0.35, 1.2 * k);
      break;
    }
    case 2: {
      outerGlow(g, b, '#8a3a0c', 8 * k, 0.35);
      fill(g, b, vGrad(g, b, [[0, '#233352'], [0.55, '#262a40'], [1, '#30222c']]));
      innerGlow(g, b, '#a0470e', 14 * k, 4 * k, 0.55);
      rim(g, b, '#7a3f12', 2.8 * k, 0.95, 2.5 * k);
      topSheen(g, b, '#e0a060', 0.1, 1.2 * k);
      break;
    }
    case 3: {
      outerGlow(g, b, '#b02800', 10 * k, 0.45);
      fill(g, b, vGrad(g, b, [[0, '#1f2e4d'], [0.38, '#2c2a42'], [0.75, '#4a1f1e'], [1, '#5c1c10']]));
      innerGlow(g, b, '#c83208', 16 * k, 5 * k, 0.6);
      rim(g, b, '#9c2e10', 2.8 * k, 1, 3 * k, '#c83208');
      topSheen(g, b, '#ff9e63', 0.12, 1.2 * k);
      break;
    }
    case 4: {
      outerGlow(g, b, '#ff5a1e', 14 * k, 0.9);
      fill(g, b, vGrad(g, b, [[0, '#ae231f'], [0.5, '#d7371a'], [0.86, '#dc4812'], [1, '#903323']]));
      inside(g, b, () => {
        const cx = b.x + b.s * 0.5;
        const cy = b.y + b.s * 0.6;
        const rad = g.createRadialGradient(cx, cy, 0, cx, cy, b.s * 0.55);
        rad.addColorStop(0, 'rgba(232,96,24,0.65)');
        rad.addColorStop(1, 'rgba(232,96,24,0)');
        g.fillStyle = rad;
        g.fillRect(b.x, b.y, b.s, b.s);
      });
      rim(g, b, '#ff5a1e', 3.5 * k, 1, 6 * k, '#ff6d2d');
      topSheen(g, b, '#ff9e63', 0.75, 1.6 * k);
      break;
    }
    case 5: {
      outerGlow(g, b, '#ff7e20', 16 * k, 1, 2);
      fill(g, b, vGrad(g, b, [[0, '#b8321c'], [0.45, '#cf4a1e'], [0.8, '#dc5a18'], [1, '#c35221']]));
      inside(g, b, () => {
        const cx = b.x + b.s * 0.5;
        const cy = b.y + b.s * 0.58;
        const rad = g.createRadialGradient(cx, cy, 0, cx, cy, b.s * 0.55);
        rad.addColorStop(0, 'rgba(255,140,40,0.55)');
        rad.addColorStop(1, 'rgba(255,140,40,0)');
        g.fillStyle = rad;
        g.fillRect(b.x, b.y, b.s, b.s);
        // ~8 px #ff7e20 band inside the bottom stroke
        const band = g.createLinearGradient(0, b.y + b.s - 16 * k, 0, b.y + b.s);
        band.addColorStop(0, 'rgba(255,126,32,0)');
        band.addColorStop(1, 'rgba(255,126,32,0.95)');
        g.fillStyle = band;
        g.fillRect(b.x, b.y + b.s - 16 * k, b.s, 16 * k);
      });
      // crisp vertical-gradient stroke: orange top -> gold sides -> yellow bottom
      rim(
        g,
        b,
        vGrad(g, b, [[0, '#ff6600'], [0.35, '#ff8001'], [0.72, '#ffcc03'], [1, '#ffff10']]),
        3.2 * k,
        1,
        3 * k,
        '#ffb000',
      );
      // 2 px specular line along the bottom inner edge
      g.save();
      g.strokeStyle = '#ffffdc';
      g.lineWidth = 2 * k;
      g.lineCap = 'round';
      g.shadowColor = '#ffffdc';
      g.shadowBlur = 4 * k;
      const y = b.y + b.s - 6.5 * k;
      g.beginPath();
      g.moveTo(b.x + b.s * 0.2, y);
      g.lineTo(b.x + b.s * 0.8, y);
      g.stroke();
      g.restore();
      topSheen(g, b, '#ffd0a0', 0.55, 1.4 * k);
      break;
    }
  }
};

const tileBox = (cell: number): { box: TileBox; size: number } => {
  const pad = Math.ceil(cell * TILE_PAD);
  return { box: { x: pad, y: pad, s: cell, r: cell * TILE_RADIUS }, size: cell + 2 * pad };
};

/** Heat-tier tile texture (anchor 0.5 => tile centred; includes glow padding). */
export const tileTexture = (tier: SpotTier, cell: number, res: number): Texture => {
  const key = `tile:${tier}:${cell}:${res}`;
  let t = cache.get(key);
  if (!t) {
    const { box, size } = tileBox(cell);
    const { c, g } = canvas(size, size, res);
    drawTier(g, box, tier, cell / 150);
    t = toTexture(c, res);
    cache.set(key, t);
  }
  return t;
};

/**
 * White overlays, used additively and tinted:
 *  flash — solid tile + halo (tier-change flash, ignite pop)
 *  ring  — halo + rim only (payframe ignite ring)
 *  wash  — soft inner fill (winning-cell glow, anticipation column)
 */
export const overlayTexture = (kind: OverlayKind, cell: number, res: number): Texture => {
  const key = `ov:${kind}:${cell}:${res}`;
  let t = cache.get(key);
  if (!t) {
    const { box, size } = tileBox(cell);
    const k = cell / 150;
    const { c, g } = canvas(size, size, res);
    if (kind === 'flash') {
      outerGlow(g, box, '#ffffff', 14 * k, 1);
      fill(g, box, '#ffffff');
    } else if (kind === 'ring') {
      outerGlow(g, box, '#ffffff', 14 * k, 1, 2);
      g.save();
      g.globalCompositeOperation = 'destination-out';
      fill(g, box, '#000');
      g.restore();
      innerGlow(g, box, '#ffffff', 14 * k, 5 * k, 1);
      rim(g, box, '#ffffff', 3 * k, 1, 3 * k);
    } else {
      inside(g, box, () => {
        const cx = box.x + box.s / 2;
        const cy = box.y + box.s / 2;
        const rad = g.createRadialGradient(cx, cy, box.s * 0.1, cx, cy, box.s * 0.75);
        rad.addColorStop(0, 'rgba(255,255,255,0.55)');
        rad.addColorStop(1, 'rgba(255,255,255,0.12)');
        g.fillStyle = rad;
        g.fillRect(box.x, box.y, box.s, box.s);
      });
      innerGlow(g, box, '#ffffff', 12 * k, 4 * k, 0.9);
    }
    t = toTexture(c, res);
    cache.set(key, t);
  }
  return t;
};

/**
 * Anticipation beam parts (resolution-independent, stretched at runtime):
 *  beam   — wide soft vertical light (gaussian across, fades at both ends)
 *  rail   — thin bright line with a soft falloff (column edges)
 *  streak — short rising spark streak
 */
export const beamTexture = (kind: 'beam' | 'rail' | 'streak'): Texture => {
  const key = `beam:${kind}`;
  let t = cache.get(key);
  if (!t) {
    const [w, h] = kind === 'beam' ? [96, 256] : kind === 'rail' ? [24, 256] : [16, 96];
    const { c, g } = canvas(w, h, 1);
    const across = g.createLinearGradient(0, 0, w, 0);
    const core = kind === 'beam' ? 0.35 : kind === 'rail' ? 0.12 : 0.22;
    across.addColorStop(0, 'rgba(255,255,255,0)');
    across.addColorStop(0.5 - core, 'rgba(255,255,255,0.35)');
    across.addColorStop(0.5, 'rgba(255,255,255,1)');
    across.addColorStop(0.5 + core, 'rgba(255,255,255,0.35)');
    across.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = across;
    g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = 'destination-in';
    const along = g.createLinearGradient(0, 0, 0, h);
    if (kind === 'streak') {
      along.addColorStop(0, 'rgba(0,0,0,1)');
      along.addColorStop(0.25, 'rgba(0,0,0,0.8)');
      along.addColorStop(1, 'rgba(0,0,0,0)');
    } else {
      along.addColorStop(0, 'rgba(0,0,0,0)');
      along.addColorStop(0.1, 'rgba(0,0,0,1)');
      along.addColorStop(0.9, 'rgba(0,0,0,1)');
      along.addColorStop(1, 'rgba(0,0,0,0)');
    }
    g.fillStyle = along;
    g.fillRect(0, 0, w, h);
    t = toTexture(c, 1);
    cache.set(key, t);
  }
  return t;
};
