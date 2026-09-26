import { Container, Graphics } from 'pixi.js';
import { GOLD } from '../../timing';
import { INK, PLUM } from '../look';

/**
 * SCREEN CHROME placeholders (cards, ribbons, buttons, badges, the jukebox shards), in the
 * same cel language as ./emblems.ts. Sizes are design px; every builder draws around (0, 0)
 * so ScreenArt can bake it and hand back a centred texture. The Spine UI rigs replace them:
 * card frames are meshes weighted to corner bones there (ANIMATION_SET §6), so the runtime
 * keeps setting their size from the layout exactly as it does here.
 */

const WOOD = { base: 0xd4903f, light: 0xf2c070, shade: 0xa0622a, grain: 0x7a4418 };
const PANEL = { base: 0x151032, upper: 0x1d1745 };
const GOLDM = { base: GOLD, shade: 0xe2861a, light: 0xfff0a0 };

/**
 * CARD FRAME: cypress-wood border (grain, hard light band top-left, shadow bottom-right),
 * deep indigo panel with a hard two-tone split, a neon edge in `accent`, gold speaker-bolt
 * corners and a speaker crest on the top border, over a plum extrusion. `k` scales the border
 * / ornaments (compact = 0.5).
 */
export const cardFrame = (w: number, h: number, accent: number, k = 1): Container => {
  const root = new Container({ label: 'cardFrame' });
  const g = new Graphics();
  const x0 = -w / 2;
  const y0 = -h / 2;
  const r = 26 * k;
  const t = 22 * k;
  const o = 5 * k;
  g.roundRect(x0 + 9 * k, y0 + 11 * k, w, h, r).fill(PLUM).stroke({ width: o, color: INK });
  // wood border: shade base, lit inset, light band on the top / left edges
  g.roundRect(x0, y0, w, h, r).fill(WOOD.shade);
  g.roundRect(x0, y0, w - 7 * k, h - 8 * k, r).fill(WOOD.base);
  g.roundRect(x0 + 4 * k, y0 + 4 * k, w - 20 * k, 7 * k, 4 * k).fill(WOOD.light);
  g.roundRect(x0 + 4 * k, y0 + 4 * k, 7 * k, h - 22 * k, 4 * k).fill(WOOD.light);
  // grain: long thin strokes along each side of the border (deterministic offsets)
  const grain = (x1: number, y1: number, x2: number, y2: number): void => {
    g.moveTo(x1, y1).lineTo(x2, y2).stroke({ width: 2 * k, color: WOOD.grain, alpha: 0.55, cap: 'round' });
  };
  for (let i = 0; i < 3; i++) {
    const d = (6 + i * 5) * k;
    const s = (40 + i * 70) * k;
    grain(x0 + s, y0 + d, x0 + w * 0.55 + s * 0.4, y0 + d);
    grain(x0 + w * 0.35 - s * 0.3, y0 + h - d - 2 * k, x0 + w - s, y0 + h - d - 2 * k);
    grain(x0 + d, y0 + s + 20 * k, x0 + d, y0 + h * 0.6 + s * 0.5);
    grain(x0 + w - d - 4 * k, y0 + h * 0.3 - s * 0.2, x0 + w - d - 4 * k, y0 + h - s);
  }
  g.roundRect(x0, y0, w, h, r).stroke({ width: o, color: INK });
  // inner panel with a hard two-tone split (key light from the top)
  const px = x0 + t;
  const py = y0 + t;
  const pw = w - t * 2;
  const ph = h - t * 2;
  g.roundRect(px, py, pw, ph, r * 0.6).fill(PANEL.base);
  g.roundRect(px, py, pw, ph * 0.46, r * 0.6).fill(PANEL.upper);
  g.roundRect(px, py, pw, ph, r * 0.6).stroke({ width: 4 * k, color: INK });
  // neon edge (tube: black casing, colour, hot core)
  const ne = 9 * k;
  g.roundRect(px + ne, py + ne, pw - ne * 2, ph - ne * 2, r * 0.45).stroke({ width: 7 * k, color: INK });
  g.roundRect(px + ne, py + ne, pw - ne * 2, ph - ne * 2, r * 0.45).stroke({ width: 3.5 * k, color: accent });
  g.roundRect(px + ne, py + ne, pw - ne * 2, ph - ne * 2, r * 0.45).stroke({ width: 1.2 * k, color: 0xffffff, alpha: 0.7 });
  // speaker-bolt corners
  for (const [sx, sy] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ] as const) {
    const bx = sx < 0 ? x0 + t * 0.5 + 2 * k : x0 + w - t * 0.5 - 2 * k;
    const by = sy < 0 ? y0 + t * 0.5 + 2 * k : y0 + h - t * 0.5 - 2 * k;
    g.circle(bx, by, 9.5 * k).fill(GOLDM.base).stroke({ width: 3 * k, color: INK });
    g.circle(bx - 2.5 * k, by - 2.5 * k, 3 * k).fill(GOLDM.light);
    g.moveTo(bx - 4.5 * k, by + 4.5 * k).lineTo(bx + 4.5 * k, by - 4.5 * k).stroke({ width: 2 * k, color: INK });
  }
  crest(g, 0, y0 + t * 0.35, accent, k);
  root.addChild(g);
  return root;
};

/** Speaker crest on the top border: a gold-rimmed cone with sound-wave arcs in the accent. */
const crest = (g: Graphics, x: number, y: number, accent: number, k: number): void => {
  const r = 25 * k;
  for (const s of [-1, 1] as const) {
    for (let i = 0; i < 2; i++) {
      const rr = r + (11 + i * 10) * k;
      const a0 = s < 0 ? Math.PI * 0.78 : -Math.PI * 0.22;
      const a1 = s < 0 ? Math.PI * 1.22 : Math.PI * 0.22;
      const arc = (w: number, color: number): void => {
        g.moveTo(x + Math.cos(a0) * rr, y + Math.sin(a0) * rr)
          .arc(x, y, rr, a0, a1)
          .stroke({ width: w, color, cap: 'round' });
      };
      arc(8 * k, INK);
      arc(4 * k, accent);
    }
  }
  g.circle(x + 3 * k, y + 4 * k, r).fill(PLUM).stroke({ width: 4 * k, color: INK });
  g.circle(x, y, r).fill(GOLDM.shade).stroke({ width: 4 * k, color: INK });
  g.circle(x - 1.5 * k, y - 1.5 * k, r * 0.84).fill(GOLDM.base);
  g.circle(x, y, r * 0.64).fill(0x1a1024).stroke({ width: 3 * k, color: INK });
  g.circle(x, y, r * 0.44).fill(0x3a2d52);
  g.circle(x, y, r * 0.22).fill(GOLDM.base).stroke({ width: 2.5 * k, color: INK });
  g.circle(x - r * 0.07, y - r * 0.07, r * 0.07).fill(0xffffff);
};

/**
 * RIBBON banner behind a title (`banner_plate`): dark glass band with accent trim, folded
 * tails in the accent's dark tone. `w` x `h` is the front band.
 */
export const ribbon = (w: number, h: number, accent: number, dark: number): Container => {
  const root = new Container({ label: 'ribbon' });
  const g = new Graphics();
  const hw = w / 2;
  const hh = h / 2;
  const tail = h * 0.9;
  const drop = h * 0.28;
  // tails (behind), notched
  for (const s of [-1, 1] as const) {
    const x = s * hw;
    const pts = [x - s * 10, -hh + drop, x + s * tail, -hh + drop, x + s * (tail - h * 0.32), drop, x + s * tail, hh + drop, x - s * 10, hh + drop];
    g.poly(pts.map((v, i) => v + (i % 2 ? 8 : 6)), true).fill(PLUM).stroke({ width: 5, color: INK, join: 'round' });
    g.poly(pts, true).fill(dark).stroke({ width: 5, color: INK, join: 'round' });
    // fold shadow
    g.poly([x, hh, x - s * 10, hh + drop, x - s * 10, hh], true).fill(INK);
  }
  g.roundRect(-hw + 7, -hh + 9, w, h, 12).fill(PLUM).stroke({ width: 5, color: INK });
  g.roundRect(-hw, -hh, w, h, 12).fill(0x1a0f33);
  g.roundRect(-hw, -hh, w, h * 0.45, 12).fill(0x27194a);
  g.roundRect(-hw + 8, -hh + 8, w - 16, h - 16, 8).stroke({ width: 3, color: accent });
  g.roundRect(-hw, -hh, w, h, 12).stroke({ width: 5, color: INK });
  root.addChild(g);
  return root;
};

/** Button plate: hex-cut pill (HUD language) with a cel light band, black outline, plum foot. */
export const buttonPlate = (w: number, h: number, fill: number, light: number, shade: number): Container => {
  const root = new Container({ label: 'buttonPlate' });
  const g = new Graphics();
  const cut = h * 0.34;
  const hex = (dx: number, dy: number, iw = w, ih = h): number[] => {
    const x0 = -iw / 2 + dx;
    const x1 = iw / 2 + dx;
    const y0 = -ih / 2 + dy;
    const y1 = ih / 2 + dy;
    return [x0 + cut, y0, x1 - cut, y0, x1, (y0 + y1) / 2, x1 - cut, y1, x0 + cut, y1, x0, (y0 + y1) / 2];
  };
  g.poly(hex(4, 6), true).fill(PLUM).stroke({ width: 4.5, color: INK, join: 'round' });
  g.poly(hex(0, 0), true).fill(shade);
  g.poly(hex(-2, -3, w - 10, h - 12), true).fill(fill);
  g.poly(hex(-4, -h * 0.22, w - 30, h * 0.2), true).fill(light);
  g.poly(hex(0, 0), true).stroke({ width: 4.5, color: INK, join: 'round' });
  root.addChild(g);
  return root;
};

/** Close button: dark glass hexagon with a thick X. */
export const closeIcon = (r: number): Container => {
  const root = new Container({ label: 'closeIcon' });
  const g = new Graphics();
  const hex = (rr: number, dx = 0, dy = 0): number[] => {
    const pts: number[] = [];
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 6 + (i * Math.PI) / 3;
      pts.push(dx + Math.cos(a) * rr, dy + Math.sin(a) * rr);
    }
    return pts;
  };
  g.poly(hex(r, 3, 5), true).fill(PLUM).stroke({ width: 4, color: INK });
  g.poly(hex(r), true).fill(0x1a0f33).stroke({ width: 4, color: INK });
  g.poly(hex(r - 6), true).stroke({ width: 2.5, color: 0x8a8a8a });
  const a = r * 0.36;
  for (const [x1, y1, x2, y2] of [
    [-a, -a, a, a],
    [a, -a, -a, a],
  ] as const) {
    g.moveTo(x1, y1).lineTo(x2, y2).stroke({ width: r * 0.32, color: INK, cap: 'round' });
    g.moveTo(x1, y1).lineTo(x2, y2).stroke({ width: r * 0.17, color: 0xffffff, cap: 'round' });
  }
  root.addChild(g);
  return root;
};

/** Toggle box (s = side), checked or not. */
export const checkBox = (s: number, checked: boolean, accent: number): Container => {
  const root = new Container({ label: 'checkBox' });
  const g = new Graphics();
  g.roundRect(-s / 2 + 2, -s / 2 + 3, s, s, s * 0.22).fill(PLUM).stroke({ width: 3, color: INK });
  g.roundRect(-s / 2, -s / 2, s, s, s * 0.22).fill(0x1a0f33).stroke({ width: 3, color: INK });
  g.roundRect(-s / 2 + 4, -s / 2 + 4, s - 8, s - 8, s * 0.16).stroke({ width: 2, color: accent });
  if (checked) {
    const p = [-s * 0.26, 0, -s * 0.06, s * 0.2, s * 0.3, -s * 0.24];
    g.poly(p, false).stroke({ width: s * 0.2, color: INK, cap: 'round', join: 'round' });
    g.poly(p, false).stroke({ width: s * 0.1, color: accent, cap: 'round', join: 'round' });
  }
  root.addChild(g);
  return root;
};

/** Multiplier badge plate (tier colour) for the card illustrations; the "×N" on it is live text. */
export const badgePlate = (w: number, h: number, color: number): Container => {
  const root = new Container({ label: 'badgePlate' });
  const g = new Graphics();
  g.roundRect(-w / 2 + 3, -h / 2 + 4, w, h, h * 0.4).fill(PLUM).stroke({ width: 4, color: INK });
  g.roundRect(-w / 2, -h / 2, w, h, h * 0.4).fill(color).stroke({ width: 4, color: INK });
  g.roundRect(-w / 2 + 5, -h / 2 + 4, w - 10, h * 0.28, h * 0.14).fill({ color: 0xffffff, alpha: 0.45 });
  root.addChild(g);
  return root;
};

/** Hairline cracks across the jukebox face (`crack` event of ui_feature_upgrade). */
export const cracks = (): Container => {
  const root = new Container({ label: 'cracks' });
  const g = new Graphics();
  const lines = [
    [-10, -150, 12, -96, -18, -40, 16, 20, -6, 80, 20, 150],
    [12, -96, 70, -70, 118, -88],
    [-18, -40, -80, -20, -130, -48],
    [16, 20, 90, 40, 140, 30],
    [-6, 80, -70, 110, -120, 150],
  ];
  for (const l of lines) {
    g.poly(l, false).stroke({ width: 9, color: INK, cap: 'round', join: 'round' });
    g.poly(l, false).stroke({ width: 3, color: 0xfff6d0, cap: 'round', join: 'round' });
  }
  root.addChild(g);
  return root;
};

/** Jukebox shard i (0..5): a gold / teal / glass fragment, outlined (`shard_1..6`). */
export const shard = (i: number): Container => {
  const root = new Container({ label: `shard${i}` });
  const g = new Graphics();
  const shapes = [
    [-34, -28, 30, -36, 40, 18, -20, 30],
    [-26, -40, 36, -20, 22, 34, -38, 12],
    [-40, -10, 0, -44, 38, -6, 6, 36],
    [-30, -30, 34, -26, 18, 30, -34, 26],
    [-22, -40, 30, -12, 14, 38, -36, 4],
    [-38, -20, 18, -38, 40, 26, -12, 34],
  ];
  const fills = [GOLDM.base, 0x35f2e0, GOLDM.shade, 0x1b0f33, GOLDM.base, 0xff3fa8];
  const pts = shapes[i % shapes.length];
  g.poly(pts.map((v, j) => v + (j % 2 ? 5 : 4)), true).fill(PLUM).stroke({ width: 4.5, color: INK, join: 'round' });
  g.poly(pts, true).fill(fills[i % fills.length]).stroke({ width: 4.5, color: INK, join: 'round' });
  g.poly([pts[0] * 0.7, pts[1] * 0.7, pts[2] * 0.7, pts[3] * 0.7, 0, 0], true).fill({ color: 0xffffff, alpha: 0.3 });
  root.addChild(g);
  return root;
};
