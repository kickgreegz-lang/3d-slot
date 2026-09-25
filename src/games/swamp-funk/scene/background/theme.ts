import type { LayoutKind, LayoutSpec, Rect } from '../../config/layout';

/**
 * Neon bayou juke joint — palettes and per-layout compositions.
 *
 * Contrast hierarchy (style bible): the background is LOWER contrast and darker in
 * the centre than the symbols, with thinner linework; neon lives only here. Light
 * masses sit left (firefly jars, moon window) and right (cyan gator sign), the
 * centre behind the reels stays calm.
 */
export interface ScenePalette {
  wallTop: number;
  wallBottom: number;
  plank: number;
  wainscot: number;
  rail: number;
  railLight: number;
  floorTop: number;
  floorBottom: number;
  floorLine: number;
  line: number;
  ambient: number;
  skyTop: number;
  skyBottom: number;
  water: number;
  moon: number;
  moonGlow: number;
  treeFar: number;
  treeNear: number;
  wood: number;
  woodLight: number;
  jarGlass: number;
  jarGlow: number;
  firefly: number;
  lid: number;
  neon: number;
  neonAccent: number;
  neonOff: number;
  board: number;
  bulbs: number[];
  wire: number;
  cone: number;
  speaker: number;
}

export const BASE_PALETTE: ScenePalette = {
  wallTop: 0x2a0f5e,
  wallBottom: 0x1b0b3a,
  plank: 0x220a4c,
  wainscot: 0x150833,
  rail: 0x2c1545,
  railLight: 0x4a2a66,
  floorTop: 0x120830,
  floorBottom: 0x0a0420,
  floorLine: 0x1d0f44,
  line: 0x0e0424,
  ambient: 0x4b3bff,
  skyTop: 0x17155a,
  skyBottom: 0x3b2d86,
  water: 0x120d3c,
  moon: 0xfff1c9,
  moonGlow: 0x8fa8ff,
  treeFar: 0x241b62,
  treeNear: 0x0d0830,
  wood: 0x331a4c,
  woodLight: 0x4f2f6c,
  jarGlass: 0x7d9a5a,
  jarGlow: 0xd8ff6a,
  firefly: 0xf6ffb0,
  lid: 0x5d4f78,
  neon: 0x35f2e0,
  neonAccent: 0xff3fa8,
  neonOff: 0x1c4453,
  board: 0x160a2c,
  bulbs: [0xffe3a0, 0xffb347, 0xffe3a0, 0xff7ab8, 0xffcf6b],
  wire: 0x0c0420,
  cone: 0x7b6cff,
  speaker: 0x130826,
};

/** Free spins: the joint heats up — magenta/crimson walls, hot neon, amber jars. */
export const FS_PALETTE: ScenePalette = {
  ...BASE_PALETTE,
  wallTop: 0x4d0c45,
  wallBottom: 0x2a0626,
  plank: 0x420a3a,
  wainscot: 0x22051f,
  rail: 0x3f1233,
  railLight: 0x6a2450,
  floorTop: 0x1f0620,
  floorBottom: 0x120312,
  floorLine: 0x33102c,
  line: 0x180418,
  ambient: 0xff3b8a,
  skyTop: 0x3a0c3a,
  skyBottom: 0x8a2a4e,
  water: 0x2a0a2c,
  moon: 0xffd0a0,
  moonGlow: 0xff7a6a,
  treeFar: 0x5a1a4a,
  treeNear: 0x1e0620,
  wood: 0x4a1a3c,
  woodLight: 0x74305a,
  jarGlass: 0x9a6a3a,
  jarGlow: 0xffa13a,
  firefly: 0xffe0a0,
  lid: 0x7a4a6a,
  neon: 0xff3fa8,
  neonAccent: 0xffb02a,
  neonOff: 0x4a1438,
  board: 0x220820,
  bulbs: [0xffb347, 0xff7a3a, 0xffe3a0, 0xff4f7b, 0xffcf6b],
  cone: 0xff4fa0,
  speaker: 0x1e0620,
};

export interface Swag {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  sag: number;
}

export interface Cone {
  x: number;
  y: number;
  len: number;
  spread: number;
  /** degrees from straight down (+ = toward +x) */
  angle: number;
}

/** Element placements in scene units for one layout kind. */
export interface Composition {
  W: number;
  H: number;
  /** scene -> design space scale (compact reuses the landscape scene at 0.5) */
  scale: number;
  ceiling: number;
  rail: number;
  floor: number;
  horizon: { x: number; y: number };
  window: Rect;
  shelves: { x: number; y: number; w: number; jars: number }[];
  sign: { x: number; y: number; scale: number; rot: number };
  swags: Swag[];
  cones: Cone[];
  speakers: { x: number; y: number; scale: number } | null;
  /** calm, darker area behind the reels */
  calm: Rect;
  /** firefly drift zones */
  fireflies: Rect[];
}

const LANDSCAPE_COMP = (panel: Rect): Composition => ({
  W: 1920,
  H: 1080,
  scale: 1,
  ceiling: 26,
  rail: 610,
  floor: 940,
  horizon: { x: 960, y: 640 },
  window: { x: 40, y: 96, w: 246, h: 290 },
  shelves: [
    { x: 18, y: 470, w: 300, jars: 4 },
    { x: 18, y: 590, w: 300, jars: 3 },
  ],
  sign: { x: 1752, y: 262, scale: 1, rot: -4 },
  swags: [
    { x0: -30, y0: 18, x1: 330, y1: 30, sag: 64 },
    { x0: 330, y0: 30, x1: 960, y1: 22, sag: 70 },
    { x0: 960, y0: 22, x1: 1590, y1: 30, sag: 70 },
    { x0: 1590, y0: 30, x1: 1950, y1: 18, sag: 64 },
  ],
  cones: [
    { x: 300, y: -20, len: 1000, spread: 420, angle: -12 },
    { x: 1640, y: -20, len: 1000, spread: 420, angle: 13 },
  ],
  speakers: { x: 1760, y: 720, scale: 1 },
  calm: panel,
  fireflies: [
    { x: 0, y: 380, w: 330, h: 320 },
    { x: 1590, y: 360, w: 330, h: 300 },
    { x: 0, y: 60, w: 1920, h: 90 },
  ],
});

const PORTRAIT_COMP = (panel: Rect): Composition => ({
  W: 1080,
  H: 1920,
  scale: 1,
  ceiling: 22,
  rail: 520,
  floor: 1440,
  horizon: { x: 540, y: 1180 },
  window: { x: 400, y: 170, w: 280, h: 300 },
  shelves: [
    { x: 8, y: 290, w: 330, jars: 4 },
    { x: 8, y: 420, w: 330, jars: 3 },
  ],
  sign: { x: 910, y: 330, scale: 0.86, rot: -5 },
  swags: [
    { x0: -30, y0: 150, x1: 540, y1: 140, sag: 80 },
    { x0: 540, y0: 140, x1: 1110, y1: 150, sag: 80 },
    { x0: -20, y0: 40, x1: 1100, y1: 40, sag: 60 },
  ],
  cones: [
    { x: 150, y: 28, len: 1480, spread: 520, angle: 12 },
    { x: 930, y: 28, len: 1480, spread: 520, angle: -12 },
  ],
  speakers: null,
  calm: panel,
  fireflies: [
    { x: 0, y: 160, w: 1080, h: 380 },
    { x: 0, y: 1400, w: 1080, h: 380 },
  ],
});

const TABLET_COMP = (panel: Rect, frameY: number): Composition => {
  const base = LANDSCAPE_COMP(panel);
  const dy = frameY - 72;
  const sh = (r: Rect): Rect => ({ ...r, y: r.y + dy });
  return {
    ...base,
    W: 1920,
    H: 1920,
    ceiling: 26,
    rail: base.rail + dy,
    floor: base.floor + dy,
    horizon: { x: 960, y: base.horizon.y + dy },
    window: sh(base.window),
    shelves: base.shelves.map((s) => ({ ...s, y: s.y + dy })),
    sign: { ...base.sign, y: base.sign.y + dy },
    swags: base.swags.map((s) => ({ ...s, y0: s.y0 + dy * 0.45, y1: s.y1 + dy * 0.45 })),
    cones: base.cones.map((c) => ({ ...c, y: 30, len: c.len + dy * 0.8 })),
    speakers: base.speakers ? { ...base.speakers, y: base.speakers.y + dy } : null,
    fireflies: base.fireflies.map(sh),
  };
};

export const composeFor = (L: LayoutSpec): Composition => {
  const kind: LayoutKind = L.kind;
  if (kind === 'portrait') return PORTRAIT_COMP(L.panel);
  if (kind === 'tablet') return TABLET_COMP(L.panel, L.frame.y);
  if (kind === 'compact') {
    // compact popouts reuse the landscape scene at half scale (same 16:9 space)
    const c = LANDSCAPE_COMP({ x: 401, y: 137, w: 1098, h: 790 });
    return { ...c, scale: L.width / 1920 };
  }
  return LANDSCAPE_COMP(L.panel);
};
