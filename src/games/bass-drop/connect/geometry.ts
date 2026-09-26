import { GRID } from '../../../config/game';
import type { LayoutSpec } from '../../../config/layout';
import { BASS_DROP_LAYOUT } from '../layout';
import { BASS_DROP_TIMING, physK } from '../timing';

const O = BASS_DROP_TIMING.orbs;

/**
 * Allocation-free design-space geometry for the connection presentation, always evaluated
 * from the CURRENT layout (a rotation mid-animation re-targets instead of finishing at stale
 * coordinates). Results are written into a caller-owned `out` pair.
 */
export interface XY {
  x: number;
  y: number;
}

/** Centre of a (fractional) padded cell. */
export const cellXY = (L: LayoutSpec, reel: number, row: number, out: XY): XY => {
  const pitch = L.cell + L.gap;
  out.x = L.grid.x + L.cell / 2 + reel * pitch;
  out.y = L.grid.y + L.cell / 2 + (row - GRID.firstVisibleRow) * pitch;
  return out;
};

/**
 * Point `t` (0..1) of the orb stream from (x0, y0) to the Groove Meter centre: the same
 * lifted quadratic Bézier as the meter's energy orbs (DESIGN §6.3 step 5): control point on
 * the chord midpoint, lifted perpendicular toward screen-up by clamp(0.22·d, 120, 320)·k plus
 * `jitter`·k; a near-vertical chord (portrait) bends away from the meter's x.
 */
export const streamPoint = (L: LayoutSpec, x0: number, y0: number, t: number, jitter: number, out: XY): XY => {
  const k = physK(L);
  const m = BASS_DROP_LAYOUT[L.kind].meter;
  const dx = m.cx - x0;
  const dy = m.cy - y0;
  const d = Math.hypot(dx, dy) || 1;
  let nx = dy / d;
  let ny = -dx / d;
  if (ny > 0) {
    nx = -nx;
    ny = -ny;
  }
  if (Math.abs(ny) < 0.2) {
    const side = Math.sign(x0 - m.cx) || 1;
    if (Math.sign(nx) !== side) {
      nx = -nx;
      ny = -ny;
    }
  }
  const lift = Math.min(O.liftMax, Math.max(O.liftMin, O.liftFactor * d)) * k + jitter * k;
  const cx = (x0 + m.cx) / 2 + nx * lift;
  const cy = (y0 + m.cy) / 2 + ny * lift;
  const u = 1 - t;
  out.x = u * u * x0 + 2 * u * t * cx + t * t * m.cx;
  out.y = u * u * y0 + 2 * u * t * cy + t * t * m.cy;
  return out;
};
