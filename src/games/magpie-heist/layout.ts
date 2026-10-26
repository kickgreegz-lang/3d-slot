import type { LayoutKind, LayoutSpec, Pt, Rect } from '../../config/layout';

/**
 * MAGPIE HEIST design spaces (6x5 grid, 4 design spaces; docs/games/magpie-heist/DESIGN.md §9).
 * Landscape: the grid sits right of centre, Monty stands on the left under the logo crest and
 * the HUD column is on the right (no hex on Monty). Portrait: Monty and the crest share the top
 * band above the grid, the HUD is the bottom band. Tablet = landscape moved down 420. Compact
 * (popouts): no mascot.
 */

/** Magpie Heist placements the engine LayoutSpec has no slot for (read by the game's modules). */
export interface HeistExtras {
  /** free-spin counter plate (feature name + n / total) */
  fsPlate: Rect;
  /** the loot total plate that counts an activation's payout up */
  lootPlate: Pt & { scale: number };
  /** where the payout flies (the HUD win display) */
  winTarget: Pt;
}

export const LANDSCAPE: LayoutSpec = {
  kind: 'landscape',
  width: 1920,
  height: 1080,
  cell: 140,
  gap: 6,
  grid: { x: 576, y: 136 },
  panel: { x: 562, y: 122, w: 898, h: 752 },
  frame: { x: 494, y: 58, w: 1034, h: 886 },
  frameParts: { post: 54, beam: 64, sill: 62 },
  logo: { x: 24, y: 18, w: 456, h: 236 },
  mascots: {
    left: { x: 40, y: 262, w: 440, h: 724 },
    right: { x: 1560, y: 262, w: 340, h: 300 },
  },
  hud: {
    spin: { x: 1735, y: 620, size: 220, tilt: 20 },
    autoplay: { x: 1628, y: 452 },
    turbo: { x: 1842, y: 452 },
    menu: { x: 1628, y: 800 },
    bonusBuy: { x: 1735, y: 236 },
    betMinus: { x: 1590, y: 1012 },
    betPlus: { x: 1870, y: 1012 },
    betValue: { x: 1730, y: 1000 },
    balance: { x: 48, y: 1004 },
    win: { x: 1011, y: 1012 },
    smallButton: 72,
    valueFont: 40,
    labelFont: 28,
  },
  center: { x: 1011, y: 498 },
  present: {
    tumblePlate: { x: 1011, y: 912, scale: 0.9 },
    fsCounter: { x: 1735, y: 236, scale: 1, stacked: false },
  },
};

export const PORTRAIT: LayoutSpec = {
  kind: 'portrait',
  width: 1080,
  height: 1920,
  cell: 150,
  gap: 6,
  grid: { x: 75, y: 640 },
  panel: { x: 61, y: 626, w: 958, h: 802 },
  frame: { x: 22, y: 570, w: 1036, h: 924 },
  frameParts: { post: 38, beam: 56, sill: 54 },
  logo: { x: 340, y: 46, w: 700, h: 210 },
  mascots: {
    left: { x: 24, y: 128, w: 318, h: 452 },
    right: { x: 700, y: 300, w: 340, h: 250 },
  },
  hud: {
    spin: { x: 540, y: 1700, size: 240, tilt: 0 },
    autoplay: { x: 330, y: 1720 },
    turbo: { x: 750, y: 1720 },
    menu: { x: 950, y: 1650 },
    bonusBuy: { x: 130, y: 1650 },
    betMinus: { x: 715, y: 1856 },
    betPlus: { x: 980, y: 1856 },
    betValue: { x: 848, y: 1834 },
    balance: { x: 40, y: 1834 },
    win: { x: 540, y: 1530 },
    smallButton: 150,
    valueFont: 48,
    labelFont: 32,
  },
  center: { x: 540, y: 1027 },
  present: {
    tumblePlate: { x: 540, y: 1460, scale: 1 },
    fsCounter: { x: 690, y: 404, scale: 0.8, stacked: false },
  },
};

/** Landscape composition moved down by 420. */
const down = <T extends { y: number }>(p: T, dy = 420): T => ({ ...p, y: p.y + dy });
export const TABLET: LayoutSpec = {
  ...LANDSCAPE,
  kind: 'tablet',
  width: 1920,
  height: 1920,
  grid: down(LANDSCAPE.grid),
  panel: down(LANDSCAPE.panel),
  frame: down(LANDSCAPE.frame),
  logo: down(LANDSCAPE.logo),
  mascots: { left: down(LANDSCAPE.mascots!.left), right: down(LANDSCAPE.mascots!.right) },
  hud: {
    ...LANDSCAPE.hud,
    spin: down(LANDSCAPE.hud.spin),
    autoplay: down(LANDSCAPE.hud.autoplay),
    turbo: down(LANDSCAPE.hud.turbo),
    menu: down(LANDSCAPE.hud.menu),
    bonusBuy: down(LANDSCAPE.hud.bonusBuy),
    betMinus: down(LANDSCAPE.hud.betMinus, 551),
    betPlus: down(LANDSCAPE.hud.betPlus, 551),
    betValue: down(LANDSCAPE.hud.betValue, 551),
    balance: down(LANDSCAPE.hud.balance, 547),
    win: down(LANDSCAPE.hud.win, 468),
  },
  center: down(LANDSCAPE.center),
  present: {
    tumblePlate: { ...down(LANDSCAPE.present!.tumblePlate!), scale: 0.9 },
    fsCounter: { ...down(LANDSCAPE.present!.fsCounter!), scale: 1, stacked: false },
  },
};

/** Popouts / small landscape phones: no mascot; HUD as Swamp Funk's compact space. */
export const COMPACT: LayoutSpec = {
  kind: 'compact',
  width: 960,
  height: 540,
  cell: 78,
  gap: 3,
  grid: { x: 196, y: 64 },
  panel: { x: 188, y: 56, w: 495, h: 414 },
  frame: { x: 166, y: 26, w: 539, h: 476 },
  frameParts: { post: 22, beam: 28, sill: 30 },
  logo: { x: 315, y: 0, w: 240, h: 30 },
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
  center: { x: 435, y: 263 },
  present: {
    tumblePlate: { x: 435, y: 488, scale: 0.6 },
    fsCounter: { x: 84, y: 270, scale: 0.5, stacked: false },
  },
};

export const LAYOUTS: Record<LayoutKind, LayoutSpec> = {
  landscape: LANDSCAPE,
  portrait: PORTRAIT,
  tablet: TABLET,
  compact: COMPACT,
};

export const HEIST_LAYOUT: Record<LayoutKind, HeistExtras> = {
  landscape: { fsPlate: { x: 1560, y: 150, w: 350, h: 170 }, lootPlate: { x: 1011, y: 498, scale: 1 }, winTarget: { x: 1011, y: 1030 } },
  portrait: { fsPlate: { x: 360, y: 300, w: 680, h: 160 }, lootPlate: { x: 540, y: 1027, scale: 1 }, winTarget: { x: 540, y: 1560 } },
  tablet: { fsPlate: { x: 1560, y: 570, w: 350, h: 170 }, lootPlate: { x: 1011, y: 918, scale: 1 }, winTarget: { x: 1011, y: 1500 } },
  compact: { fsPlate: { x: 10, y: 200, w: 150, h: 140 }, lootPlate: { x: 435, y: 263, scale: 0.6 }, winTarget: { x: 828, y: 90 } },
};
