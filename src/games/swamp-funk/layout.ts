import type { LayoutKind, LayoutSpec } from '../../config/layout';

/**
 * SWAMP FUNK design spaces (7x5 grid). Types, breakpoints (pickLayout) and cell helpers
 * are engine-side in src/config/layout.ts, which re-exports these specs.
 *
 * Landscape numbers are measured from the reference (x*1.01266, y*1.01266+3.8).
 * Portrait / compact HUD anchors are the collision-free placements the HUD used to keep
 * as local overrides (ui/hud/hudLayout.ts PORTRAIT_FIX / COMPACT_FIX), now owned here.
 */

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
  // below the top-left status line (title | clock)
  logo: { x: 205, y: 46, w: 670, h: 100 },
  mascots: {
    left: { x: 30, y: 150, w: 420, h: 450 },
    right: { x: 630, y: 150, w: 420, h: 450 },
  },
  hud: {
    spin: { x: 540, y: 1636, size: 260, tilt: 0 },
    autoplay: { x: 300, y: 1636 },
    turbo: { x: 780, y: 1636 },
    menu: { x: 950, y: 1636 },
    bonusBuy: { x: 130, y: 1636 },
    betMinus: { x: 640, y: 1848 },
    betPlus: { x: 1010, y: 1848 },
    betValue: { x: 825, y: 1826 },
    balance: { x: 60, y: 1826 },
    win: { x: 540, y: 1432 },
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
  // sits on the frame beam, as in landscape
  logo: { x: 592, y: 440, w: 741, h: 105 },
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
    spin: { x: 828, y: 270, size: 170, tilt: 0 },
    autoplay: { x: 770, y: 144 },
    turbo: { x: 886, y: 144 },
    menu: { x: 770, y: 408 },
    bonusBuy: { x: 886, y: 408 },
    betMinus: { x: 728, y: 502 },
    betPlus: { x: 928, y: 502 },
    betValue: { x: 828, y: 488 },
    balance: { x: 828, y: 26 },
    win: { x: 828, y: 74 },
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
