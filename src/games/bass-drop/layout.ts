import type { LayoutKind, LayoutSpec, Pt, Rect } from '../../config/layout';

/**
 * SWAMP: BASS DROP design spaces (6x6 grid, 4 design spaces). Numbers are copied from the
 * design track's docs/games/bass-drop/layout.json (DESIGN.md section 15 is authoritative;
 * fix both together). The square grid sits slightly right of centre in landscape, leaving
 * the left column for the Groove Meter speaker cabinet above Gumbo, with Baron Croak and
 * his DJ booth on the right.
 *
 * Deviation: portrait bet-row anchors are nudged up (label baselines 1834, bet buttons
 * 1856) so the values hanging below the labels stay inside 1920; layout.json lists
 * 1842-1880 for them.
 */

/** Groove Meter ring (every other meter radius is a fraction of ringOuterD / 2, see layout.json meterGeometry). */
export interface MeterSpec {
  cx: number;
  cy: number;
  ringOuterD: number;
}

/** Bass Drop only placements the engine LayoutSpec has no slot for (read by the game's feature modules). */
export interface BassDropExtras {
  meter: MeterSpec;
  /** speaker cabinet behind the meter (null: no cabinet art in this space) */
  cabinet: Rect | null;
  lowerCabinet: Rect | null;
  /** "GROOVE n/60" chip under the meter */
  meterChip: Rect;
  /** free-spin counter plate ('meterChip' = shares the chip slot) */
  fsPlate: Rect | 'meterChip';
  /** Baron Croak's DJ booth (null: no mascots) */
  booth: Rect | null;
  /** decorative speaker horns on the frame beam */
  frameHorns: [Rect, Rect] | null;
  /** running tumble-win plate */
  tumblePlate: Pt & { scale: number };
  /** dropped wilds never arc above this y */
  wildApexMinY: number;
}

export const LANDSCAPE: LayoutSpec = {
  kind: 'landscape',
  width: 1920,
  height: 1080,
  cell: 124,
  gap: 4,
  grid: { x: 578, y: 149 },
  panel: { x: 566, y: 137, w: 788, h: 788 },
  frame: { x: 491, y: 72, w: 938, h: 922 },
  frameParts: { post: 50, beam: 66, sill: 65 },
  logo: { x: 1472, y: 40, w: 428, h: 236 },
  mascots: {
    left: { x: 0, y: 557, w: 434, h: 496 },
    right: { x: 1560, y: 430, w: 360, h: 630 },
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
    win: { x: 960, y: 1030 },
    smallButton: 72,
    valueFont: 40,
    labelFont: 28,
  },
  center: { x: 960, y: 531 },
  // plates from layout.json: tumblePlate on the sill, free-spin counter in the fsPlate slot
  present: {
    tumblePlate: { x: 960, y: 961, scale: 0.9 },
    fsCounter: { x: 1686, y: 355, scale: 1, stacked: false },
  },
};

export const PORTRAIT: LayoutSpec = {
  kind: 'portrait',
  width: 1080,
  height: 1920,
  cell: 132,
  gap: 4,
  grid: { x: 134, y: 584 },
  panel: { x: 122, y: 572, w: 836, h: 836 },
  frame: { x: 88, y: 520, w: 904, h: 940 },
  frameParts: { post: 34, beam: 52, sill: 52 },
  logo: { x: 240, y: 40, w: 600, h: 110 },
  mascots: {
    left: { x: 0, y: 150, w: 400, h: 430 },
    right: { x: 680, y: 150, w: 400, h: 430 },
  },
  hud: {
    spin: { x: 540, y: 1665, size: 250, tilt: 0 },
    autoplay: { x: 330, y: 1690 },
    turbo: { x: 750, y: 1690 },
    menu: { x: 950, y: 1650 },
    bonusBuy: { x: 130, y: 1650 },
    betMinus: { x: 715, y: 1856 },
    betPlus: { x: 980, y: 1856 },
    betValue: { x: 848, y: 1834 },
    balance: { x: 40, y: 1834 },
    win: { x: 540, y: 1500 },
    smallButton: 150,
    valueFont: 48,
    labelFont: 32,
  },
  center: { x: 540, y: 990 },
  // free-spin counter shares the meter chip slot under the meter
  present: {
    tumblePlate: { x: 540, y: 1434, scale: 1 },
    fsCounter: { x: 540, y: 546, scale: 0.7, stacked: false },
  },
};

/** Landscape composition moved down by 420 (as Swamp Funk's tablet space). */
export const TABLET: LayoutSpec = {
  ...LANDSCAPE,
  kind: 'tablet',
  width: 1920,
  height: 1920,
  grid: { x: 578, y: 569 },
  panel: { x: 566, y: 557, w: 788, h: 788 },
  frame: { x: 491, y: 492, w: 938, h: 922 },
  logo: { x: 1472, y: 460, w: 428, h: 236 },
  mascots: {
    left: { x: 0, y: 977, w: 434, h: 496 },
    right: { x: 1560, y: 850, w: 360, h: 630 },
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
    win: { x: 960, y: 1480 },
  },
  center: { x: 960, y: 951 },
  present: {
    tumblePlate: { x: 960, y: 1381, scale: 0.9 },
    fsCounter: { x: 1686, y: 775, scale: 1, stacked: false },
  },
};

/** Popouts / small landscape phones: no mascots; HUD as Swamp Funk's compact space. */
export const COMPACT: LayoutSpec = {
  kind: 'compact',
  width: 960,
  height: 540,
  cell: 72,
  gap: 3,
  grid: { x: 226, y: 42 },
  panel: { x: 218, y: 34, w: 463, h: 463 },
  frame: { x: 198, y: 8, w: 503, h: 517 },
  frameParts: { post: 20, beam: 26, sill: 28 },
  logo: { x: 331, y: 0, w: 236, h: 40 },
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
  center: { x: 449, y: 265 },
  present: {
    tumblePlate: { x: 449, y: 511, scale: 0.6 },
    fsCounter: { x: 100, y: 282, scale: 0.5, stacked: false },
  },
};

export const LAYOUTS: Record<LayoutKind, LayoutSpec> = {
  landscape: LANDSCAPE,
  portrait: PORTRAIT,
  tablet: TABLET,
  compact: COMPACT,
};

export const BASS_DROP_LAYOUT: Record<LayoutKind, BassDropExtras> = {
  landscape: {
    meter: { cx: 248, cy: 318, ringOuterD: 320 },
    cabinet: { x: 72, y: 112, w: 352, h: 420 },
    lowerCabinet: { x: 96, y: 532, w: 304, h: 320 },
    meterChip: { x: 112, y: 478, w: 272, h: 56 },
    fsPlate: { x: 1514, y: 300, w: 344, h: 110 },
    booth: { x: 1436, y: 640, w: 230, h: 300 },
    frameHorns: [
      { x: 452, y: 30, w: 116, h: 100 },
      { x: 1352, y: 30, w: 116, h: 100 },
    ],
    tumblePlate: { x: 960, y: 961, scale: 0.9 },
    wildApexMinY: 24,
  },
  portrait: {
    meter: { cx: 540, cy: 340, ringOuterD: 300 },
    cabinet: { x: 380, y: 176, w: 320, h: 360 },
    lowerCabinet: null,
    meterChip: { x: 390, y: 522, w: 300, h: 48 },
    fsPlate: 'meterChip',
    booth: { x: 730, y: 380, w: 210, h: 140 },
    frameHorns: [
      { x: 58, y: 486, w: 92, h: 80 },
      { x: 930, y: 486, w: 92, h: 80 },
    ],
    tumblePlate: { x: 540, y: 1434, scale: 1 },
    wildApexMinY: 160,
  },
  tablet: {
    meter: { cx: 248, cy: 738, ringOuterD: 320 },
    cabinet: { x: 72, y: 532, w: 352, h: 420 },
    lowerCabinet: { x: 96, y: 952, w: 304, h: 320 },
    meterChip: { x: 112, y: 898, w: 272, h: 56 },
    fsPlate: { x: 1514, y: 720, w: 344, h: 110 },
    booth: { x: 1436, y: 1060, w: 230, h: 300 },
    frameHorns: [
      { x: 452, y: 450, w: 116, h: 100 },
      { x: 1352, y: 450, w: 116, h: 100 },
    ],
    tumblePlate: { x: 960, y: 1381, scale: 0.9 },
    wildApexMinY: 300,
  },
  compact: {
    meter: { cx: 100, cy: 168, ringOuterD: 170 },
    cabinet: null,
    lowerCabinet: null,
    meterChip: { x: 15, y: 262, w: 170, h: 40 },
    fsPlate: 'meterChip',
    booth: null,
    frameHorns: null,
    tumblePlate: { x: 449, y: 511, scale: 0.6 },
    wildApexMinY: 12,
  },
};
