/**
 * Design spaces and element placement. All numbers are DESIGN PIXELS inside the
 * chosen design space; the root game container is contain-scaled to the canvas,
 * the background is cover-scaled (see render/layout.ts).
 *
 * Landscape numbers are measured from the reference (x*1.01266, y*1.01266+3.8).
 * Breakpoints follow the Stake web-sdk createLayout: aspect >= 1.3 landscape,
 * <= 0.8 portrait, otherwise tablet; plus a "compact" space for popouts
 * (400x225, 800x450) and small landscape phones where legibility needs bigger UI.
 */

export type LayoutKind = 'landscape' | 'portrait' | 'tablet' | 'compact';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Pt {
  x: number;
  y: number;
}

export interface LayoutSpec {
  kind: LayoutKind;
  width: number;
  height: number;
  /** Symbol cell size and gap; pitch = cell + gap. */
  cell: number;
  gap: number;
  /** Top-left of the 7x5 visible grid (outer tile edges). */
  grid: Pt;
  /** Glass panel behind the grid (grid + padding). */
  panel: Rect;
  /** Outer bounds of the wooden frame (posts/beam/sill are drawn inside this). */
  frame: Rect;
  frameParts: { post: number; beam: number; sill: number };
  logo: Rect;
  /** Mascot slots (feet anchored at bottom-centre of the rect). null => no mascots in this layout. */
  mascots: { left: Rect; right: Rect } | null;
  hud: {
    spin: Pt & { size: number; tilt: number };
    autoplay: Pt;
    turbo: Pt;
    menu: Pt;
    bonusBuy: Pt;
    betMinus: Pt;
    betPlus: Pt;
    betValue: Pt;
    balance: Pt;
    win: Pt;
    /** small hex button diameter */
    smallButton: number;
    /** base font size for HUD values */
    valueFont: number;
    labelFont: number;
  };
  /** Where big-win / free-spin overlays centre. */
  center: Pt;
}

export const LANDSCAPE: LayoutSpec = {
  kind: 'landscape',
  width: 1920,
  height: 1080,
  cell: 150,
  gap: 4,
  grid: { x: 413, y: 149 },
  panel: { x: 401, y: 137, w: 1098, h: 790 },
  frame: { x: 326, y: 72, w: 1260, h: 922 },
  frameParts: { post: 50, beam: 66, sill: 65 },
  logo: { x: 592, y: 25, w: 741, h: 105 },
  mascots: {
    left: { x: 0, y: 557, w: 434, h: 496 },
    right: { x: 1531, y: 441, w: 389, h: 568 },
  },
  hud: {
    spin: { x: 1747, y: 800, size: 250, tilt: 20 },
    autoplay: { x: 1770, y: 636 },
    turbo: { x: 1841, y: 662 },
    menu: { x: 166, y: 712 },
    bonusBuy: { x: 150, y: 846 },
    betMinus: { x: 1529, y: 1009 },
    betPlus: { x: 1854, y: 1009 },
    betValue: { x: 1692, y: 1000 },
    balance: { x: 46, y: 1000 },
    win: { x: 950, y: 1030 },
    smallButton: 72,
    valueFont: 40,
    labelFont: 28,
  },
  center: { x: 950, y: 532 },
};

export const PORTRAIT: LayoutSpec = {
  kind: 'portrait',
  width: 1080,
  height: 1920,
  cell: 132,
  gap: 4,
  grid: { x: 66, y: 620 },
  panel: { x: 54, y: 608, w: 972, h: 700 },
  frame: { x: 20, y: 556, w: 1040, h: 812 },
  frameParts: { post: 34, beam: 52, sill: 52 },
  logo: { x: 190, y: 30, w: 700, h: 110 },
  mascots: {
    left: { x: 30, y: 150, w: 420, h: 450 },
    right: { x: 630, y: 150, w: 420, h: 450 },
  },
  hud: {
    spin: { x: 540, y: 1620, size: 260, tilt: 0 },
    autoplay: { x: 300, y: 1640 },
    turbo: { x: 780, y: 1640 },
    menu: { x: 110, y: 1800 },
    bonusBuy: { x: 150, y: 1450 },
    betMinus: { x: 700, y: 1820 },
    betPlus: { x: 980, y: 1820 },
    betValue: { x: 840, y: 1810 },
    balance: { x: 60, y: 1880 },
    win: { x: 540, y: 1420 },
    smallButton: 150,
    valueFont: 48,
    labelFont: 32,
  },
  center: { x: 540, y: 958 },
};

export const TABLET: LayoutSpec = {
  ...LANDSCAPE,
  kind: 'tablet',
  width: 1920,
  height: 1920,
  grid: { x: 413, y: 569 },
  panel: { x: 401, y: 557, w: 1098, h: 790 },
  frame: { x: 326, y: 492, w: 1260, h: 922 },
  logo: { x: 592, y: 330, w: 741, h: 105 },
  mascots: {
    left: { x: 0, y: 977, w: 434, h: 496 },
    right: { x: 1531, y: 861, w: 389, h: 568 },
  },
  hud: {
    ...LANDSCAPE.hud,
    spin: { x: 1747, y: 1220, size: 250, tilt: 20 },
    autoplay: { x: 1770, y: 1056 },
    turbo: { x: 1841, y: 1082 },
    menu: { x: 166, y: 1132 },
    bonusBuy: { x: 150, y: 1266 },
    betMinus: { x: 1529, y: 1560 },
    betPlus: { x: 1854, y: 1560 },
    betValue: { x: 1692, y: 1551 },
    balance: { x: 46, y: 1551 },
    win: { x: 950, y: 1480 },
  },
  center: { x: 950, y: 952 },
};

export const COMPACT: LayoutSpec = {
  kind: 'compact',
  width: 960,
  height: 540,
  cell: 90,
  gap: 3,
  grid: { x: 24, y: 40 },
  panel: { x: 16, y: 32, w: 664, h: 478 },
  frame: { x: 0, y: 8, w: 696, h: 526 },
  frameParts: { post: 20, beam: 28, sill: 28 },
  logo: { x: 188, y: 0, w: 320, h: 44 },
  mascots: null,
  hud: {
    spin: { x: 830, y: 280, size: 170, tilt: 0 },
    autoplay: { x: 760, y: 150 },
    turbo: { x: 900, y: 150 },
    menu: { x: 760, y: 420 },
    bonusBuy: { x: 900, y: 420 },
    betMinus: { x: 740, y: 500 },
    betPlus: { x: 920, y: 500 },
    betValue: { x: 830, y: 495 },
    balance: { x: 710, y: 40 },
    win: { x: 830, y: 80 },
    smallButton: 84,
    valueFont: 30,
    labelFont: 22,
  },
  center: { x: 348, y: 271 },
};

export const LAYOUTS: Record<LayoutKind, LayoutSpec> = {
  landscape: LANDSCAPE,
  portrait: PORTRAIT,
  tablet: TABLET,
  compact: COMPACT,
};

export const pickLayout = (cssWidth: number, cssHeight: number): LayoutSpec => {
  const ar = cssWidth / Math.max(1, cssHeight);
  if (ar >= 1.3) return Math.min(cssWidth, cssHeight) <= 480 ? COMPACT : LANDSCAPE;
  if (ar <= 0.8) return PORTRAIT;
  return TABLET;
};

/** Centre of a visible cell (reel 0..6, visibleRow 0..4) in design px. */
export const cellCenter = (L: LayoutSpec, reel: number, visibleRow: number): Pt => {
  const pitch = L.cell + L.gap;
  return {
    x: L.grid.x + L.cell / 2 + reel * pitch,
    y: L.grid.y + L.cell / 2 + visibleRow * pitch,
  };
};

export const gridSize = (L: LayoutSpec, reels = 7, rows = 5): { w: number; h: number } => ({
  w: reels * L.cell + (reels - 1) * L.gap,
  h: rows * L.cell + (rows - 1) * L.gap,
});
