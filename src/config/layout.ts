/**
 * ENGINE VIEW of the active game's design spaces.
 *
 * The four LayoutSpecs (landscape / portrait / tablet / compact) are game data in
 * `src/games/<GAME>/layout.ts` (`@game/layout`), re-exported here next to the generic
 * types and helpers, so engine modules keep importing '../config/layout'.
 *
 * All numbers are DESIGN PIXELS inside the chosen design space; the root game container
 * is contain-scaled to the canvas, the background is cover-scaled (see render/layout.ts).
 * Breakpoints follow the Stake web-sdk createLayout: aspect >= 1.3 landscape,
 * <= 0.8 portrait, otherwise tablet; plus a "compact" space for popouts
 * (400x225, 800x450) and small landscape phones where legibility needs bigger UI.
 */
import { LAYOUTS } from '@game/layout';
import { GRID } from './game';

export * from '@game/layout';

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
  /** Top-left of the GRID.reels x GRID.rows visible grid (outer tile edges). */
  grid: Pt;
  /** Glass panel behind the grid (grid + padding). */
  panel: Rect;
  /** Outer bounds of the wooden frame (posts/beam/sill are drawn inside this). */
  frame: Rect;
  frameParts: { post: number; beam: number; sill: number };
  logo: Rect;
  /** Mascot slots (feet anchored at bottom-centre of the rect). null => no mascots in this layout. */
  mascots: { left: Rect; right: Rect } | null;
  /**
   * HUD anchors (ui/hud/hudLayout.ts). Button x/y = hex centre; value y = label baseline
   * (value hangs below); win y = centre line.
   */
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
  /**
   * Optional per-game placement of the presentation plates (present/common/placement.ts
   * derives them from grid/frame otherwise).
   */
  present?: {
    /** running tumble-win plate */
    tumblePlate?: Pt & { scale: number };
    /** free-spin counter plate (stacked: label above the count) */
    fsCounter?: Pt & { scale: number; stacked: boolean };
  };
}

export const pickLayout = (cssWidth: number, cssHeight: number): LayoutSpec => {
  const ar = cssWidth / Math.max(1, cssHeight);
  if (ar >= 1.3) return Math.min(cssWidth, cssHeight) <= 480 ? LAYOUTS.compact : LAYOUTS.landscape;
  if (ar <= 0.8) return LAYOUTS.portrait;
  return LAYOUTS.tablet;
};

/** Centre of a visible cell (reel 0..GRID.reels-1, visibleRow 0..GRID.rows-1; fractions interpolate) in design px. */
export const cellCenter = (L: LayoutSpec, reel: number, visibleRow: number): Pt => {
  const pitch = L.cell + L.gap;
  return {
    x: L.grid.x + L.cell / 2 + reel * pitch,
    y: L.grid.y + L.cell / 2 + visibleRow * pitch,
  };
};

export const gridSize = (L: LayoutSpec, reels = GRID.reels, rows = GRID.rows): { w: number; h: number } => ({
  w: reels * L.cell + (reels - 1) * L.gap,
  h: rows * L.cell + (rows - 1) * L.gap,
});
