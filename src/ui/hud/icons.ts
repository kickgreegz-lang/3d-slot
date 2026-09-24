import { type FillInput, Graphics, type PointData } from 'pixi.js';
import { verticalRamp } from './geometry';
import { HUD_COLORS } from './theme';

/**
 * Vector HUD icons. Each draws a NEW Graphics centred on (0,0) that fits a box of
 * `s` design px. Shapes are filled solids (no strokes) with a top-lit grey ramp,
 * matching the reference's soft-shaded grey glyphs; the caller bakes them.
 */
export type IconDraw = (s: number) => Graphics;

const DEG = Math.PI / 180;

const greyRamp = (): FillInput => verticalRamp(HUD_COLORS.iconTop, HUD_COLORS.iconBottom);

/**
 * Ring arrow as ONE closed polygon: butt tail at `a0`, clockwise arc to `a1`, and a
 * tangential arrowhead (clockwise = the direction the spin button turns).
 */
export const ringArrowPoints = (r: number, th: number, a0: number, a1: number, headW: number, headL: number): PointData[] => {
  const ro = r + th / 2;
  const ri = r - th / 2;
  const pts: PointData[] = [];
  const steps = 48;
  for (let i = 0; i <= steps; i++) {
    const a = a0 + ((a1 - a0) * i) / steps;
    pts.push({ x: Math.cos(a) * ro, y: Math.sin(a) * ro });
  }
  const cx = Math.cos(a1) * r;
  const cy = Math.sin(a1) * r;
  const nx = Math.cos(a1);
  const ny = Math.sin(a1);
  const tx = -Math.sin(a1);
  const ty = Math.cos(a1);
  pts.push({ x: cx + nx * (headW / 2), y: cy + ny * (headW / 2) });
  pts.push({ x: cx + tx * headL, y: cy + ty * headL });
  pts.push({ x: cx - nx * (headW / 2), y: cy - ny * (headW / 2) });
  for (let i = steps; i >= 0; i--) {
    const a = a0 + ((a1 - a0) * i) / steps;
    pts.push({ x: Math.cos(a) * ri, y: Math.sin(a) * ri });
  }
  return pts;
};

/** SPIN: fat clockwise ring arrow, gap at the upper-left (reference silhouette). */
export const spinArrowIcon = (s: number, color: number = HUD_COLORS.spinIcon): Graphics => {
  const r = s * 0.33;
  const th = s * 0.2;
  const g = new Graphics();
  g.poly(ringArrowPoints(r, th, -64 * DEG, 192 * DEG, th * 2.75, th * 1.95)).fill(
    verticalRamp(0xffffff, color, color),
  );
  return g;
};

/** AUTOPLAY: thin ring arrow around a play triangle. */
export const autoplayIcon = (s: number): Graphics => {
  const g = new Graphics();
  const r = s * 0.36;
  const th = s * 0.12;
  g.poly(ringArrowPoints(r, th, -50 * DEG, 225 * DEG, th * 2.6, th * 1.7)).fill(greyRamp());
  const t = s * 0.2;
  g.roundShape(
    [
      { x: -t * 0.55, y: -t * 0.8 },
      { x: t * 0.85, y: 0 },
      { x: -t * 0.55, y: t * 0.8 },
    ],
    t * 0.18,
  ).fill(greyRamp());
  return g;
};

/** Lightning bolt polygon in a unit box (x -0.5..0.5, y -0.8..0.8). */
export const BOLT: ReadonlyArray<readonly [number, number]> = [
  [0.2, -0.8],
  [-0.42, 0.08],
  [-0.04, 0.08],
  [-0.2, 0.8],
  [0.44, -0.12],
  [0.05, -0.12],
];

/** TURBO: 1 / 2 / 3 bolts for normal / turbo / super turbo; lit bolts use the label yellow. */
export const turboIcon =
  (bolts: 1 | 2 | 3, lit: boolean): IconDraw =>
  (s: number): Graphics => {
    const g = new Graphics();
    const layouts: Record<1 | 2 | 3, Array<[number, number, number]>> = {
      1: [[0, 0, 0.62]],
      2: [
        [-0.17, 0.03, 0.5],
        [0.17, -0.03, 0.5],
      ],
      3: [
        [-0.28, 0.05, 0.42],
        [0, -0.02, 0.44],
        [0.28, 0.05, 0.42],
      ],
    };
    const fill = lit ? verticalRamp(0xfff6b0, HUD_COLORS.turboOn, 0xffe45a) : greyRamp();
    for (const [ox, oy, k] of layouts[bolts]) {
      const h = s * k;
      g.roundShape(
        BOLT.map(([x, y]) => ({ x: ox * s + x * h, y: oy * s + y * h })),
        h * 0.04,
      ).fill(fill);
      if (lit) g.stroke({ width: Math.max(1, s * 0.025), color: 0x3a2a00, alpha: 0.55 });
    }
    return g;
  };

/** MENU: three rounded bars. */
export const menuIcon = (s: number): Graphics => {
  const g = new Graphics();
  const w = s * 0.56;
  const h = s * 0.1;
  for (let i = -1; i <= 1; i++) {
    g.roundRect(-w / 2, i * s * 0.19 - h / 2, w, h, h / 2);
  }
  g.fill(greyRamp());
  return g;
};

/** BET -/+: chunky arrow (down for minus, up for plus). */
export const arrowIcon =
  (dir: 'up' | 'down'): IconDraw =>
  (s: number): Graphics => {
    const k = dir === 'up' ? 1 : -1;
    const hw = s * 0.34; // half head width
    const hl = s * 0.32; // head length
    const sw = s * 0.13; // half shaft width
    const top = -s * 0.36;
    const bottom = s * 0.36;
    const pts = [
      { x: 0, y: top },
      { x: hw, y: top + hl },
      { x: sw, y: top + hl },
      { x: sw, y: bottom },
      { x: -sw, y: bottom },
      { x: -sw, y: top + hl },
      { x: -hw, y: top + hl },
    ].map((p) => ({ x: p.x, y: p.y * k }));
    const g = new Graphics();
    g.roundShape(pts, s * 0.045).fill(greyRamp());
    return g;
  };

/** BONUS BUY: rounded five-point star inside a ring (white). */
export const bonusIcon = (s: number): Graphics => {
  const g = new Graphics();
  const r = s * 0.42;
  g.circle(0, 0, r).fill({ color: 0xffffff, alpha: 1 });
  g.circle(0, 0, r * 0.8).cut();
  const pts: PointData[] = [];
  const ro = r * 0.62;
  const ri = ro * 0.47;
  for (let i = 0; i < 10; i++) {
    const a = (-90 + i * 36) * DEG;
    const rr = i % 2 === 0 ? ro : ri;
    pts.push({ x: Math.cos(a) * rr, y: Math.sin(a) * rr + r * 0.03 });
  }
  g.roundShape(pts, r * 0.05).fill(verticalRamp(0xffffff, 0xf2d6ec));
  return g;
};

/** Stop square (spin hole while a round runs). */
export const stopIcon = (s: number): Graphics =>
  new Graphics().roundRect(-s / 2, -s / 2, s, s, s * 0.2).fill(verticalRamp(0xffffff, 0xd8d8d8));
