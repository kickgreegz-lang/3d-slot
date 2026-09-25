import { pitchOf, slotPos } from '../../../board/model';
import type { Position } from '../../../book/types';
import type { LayoutSpec, Rect } from '../../../config/layout';
import type { GameContext } from '../../../game/context';
import { BASS_DROP_LAYOUT } from '../layout';
import { BASS_DROP_TIMING } from '../timing';

/**
 * Pure flight / board geometry of the Bass Drop (DESIGN.md §8.2). Everything is recomputed
 * from the CURRENT layout each frame (a rotation mid-flight re-targets the arc), writing into
 * caller-owned objects so the per-frame path allocates nothing.
 */
export interface Pt {
  x: number;
  y: number;
}

/** Quadratic Bezier P0 -> C -> P2 (design px). */
export interface Arc {
  x0: number;
  y0: number;
  cx: number;
  cy: number;
  x2: number;
  y2: number;
}

export const newArc = (): Arc => ({ x0: 0, y0: 0, cx: 0, cy: 0, x2: 0, y2: 0 });

export const cellKey = (p: Position): string => `${p.reel},${p.row}`;

/** Ascending (reel, row): the flight / return order (DESIGN §8.2, §9.3). */
export const byCell = (a: Position, b: Position): number => a.reel - b.reel || a.row - b.row;

/** Groove Meter centre of a layout: every bass drop leaves the woofer from here. */
export const meterCentre = (L: LayoutSpec, out: Pt): Pt => {
  const m = BASS_DROP_LAYOUT[L.kind].meter;
  out.x = m.cx;
  out.y = m.cy;
  return out;
};

/**
 * The drop arc from the meter to a padded cell (DESIGN §8.2). The apex is
 * `max(wildApexMinY, min(origin.y, grid.y) - apexLiftPitch x pitch)` (portrait: the arc still
 * rises above the meter; compact: clamped to 12) and the control point puts the curve's peak
 * EXACTLY on it: cy = apex - sqrt((y0 - apex)(y2 - apex)), cx = the chord midpoint.
 */
export const dropArc = (L: LayoutSpec, reel: number, row: number, out: Arc): Arc => {
  const extras = BASS_DROP_LAYOUT[L.kind];
  const x0 = extras.meter.cx;
  const y0 = extras.meter.cy;
  const p = slotPos(L, reel, row);
  const lift = BASS_DROP_TIMING.drop.apexLiftPitch * pitchOf(L);
  // the apex must stay above both ends, or the curve would have no interior peak
  const apex = Math.min(Math.max(extras.wildApexMinY, Math.min(y0, L.grid.y) - lift), Math.min(y0, p.y) - 1);
  out.x0 = x0;
  out.y0 = y0;
  out.x2 = p.x;
  out.y2 = p.y;
  out.cx = (x0 + p.x) / 2;
  out.cy = apex - Math.sqrt((y0 - apex) * (p.y - apex));
  return out;
};

/** Point on a quadratic arc at t (0..1). */
export const arcAt = (a: Arc, t: number, out: Pt): Pt => {
  const u = 1 - t;
  out.x = u * u * a.x0 + 2 * u * t * a.cx + t * t * a.x2;
  out.y = u * u * a.y0 + 2 * u * t * a.cy + t * t * a.y2;
  return out;
};

/** t of the arc's highest point (screen y is down). */
export const arcPeakT = (a: Arc): number => {
  const d = a.y0 - 2 * a.cy + a.y2;
  return d === 0 ? 0.5 : Math.min(1, Math.max(0, (a.y0 - a.cy) / d));
};

/** Visible part of the design space (design rect + letterbox), in design px. */
export const visibleRect = (ctx: GameContext, out: Rect): Rect => {
  const L = ctx.layout;
  const k = ctx.scale || 1;
  const w = ctx.app.screen.width / k;
  const h = ctx.app.screen.height / k;
  out.x = (L.width - w) / 2;
  out.y = (L.height - h) / 2;
  out.w = w;
  out.h = h;
  return out;
};

/** power2 in / out on 0..1 (the GSAP curves, inlined for per-frame use). */
export const p2in = (t: number): number => t * t;
export const p2out = (t: number): number => 1 - (1 - t) * (1 - t);
export const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);
