import type { Position } from '../book/types';
import { GRID, isVisibleRow } from '../config/game';
import { type LayoutSpec, type Rect, cellCenter } from '../config/layout';

/**
 * Pure board logic shared by the Board module and its dev tooling: slot
 * geometry, the Stake web-sdk tumble rule, cluster boundary tracing and a tiny
 * deterministic RNG. No Pixi, no GSAP — easy to reason about and to test.
 */

export type Board = string[][];

export const cloneBoard = (b: Board): Board => b.map((reel) => [...reel]);

/** Centre of a PADDED slot (padding rows sit one pitch outside the visible grid). */
export const slotPos = (L: LayoutSpec, reel: number, paddedRow: number): { x: number; y: number } =>
  cellCenter(L, reel, paddedRow - GRID.firstVisibleRow);

export const pitchOf = (L: LayoutSpec): number => L.cell + L.gap;

/** Outer rectangle of the GRID.reels x GRID.rows visible grid (tile edges). */
export const gridRect = (L: LayoutSpec): Rect => {
  const p = pitchOf(L);
  return { x: L.grid.x, y: L.grid.y, w: GRID.reels * p - L.gap, h: GRID.rows * p - L.gap };
};

// ---------------------------------------------------------------------------
// Tumble (exactly the web-sdk TumbleBoard.svelte rule)
// ---------------------------------------------------------------------------

export type TumbleSource =
  | { kind: 'survivor'; fromRow: number; id: string }
  /** new symbol: `index` into newSymbols[reel]; starts stacked above row 0 at row index-n */
  | { kind: 'new'; index: number; fromRow: number; id: string };

export interface TumblePlan {
  /** [reel][newPaddedRow] -> where that symbol comes from */
  columns: TumbleSource[][];
  /** board after the tumble */
  next: Board;
  /** [reel] survivors that no longer fit (only on malformed data) */
  overflow: TumbleSource[][];
}

/**
 * Per reel: combined = [...newSymbols[reel] (index 0 = top-most), ...survivors of
 * the GRID.paddedRows padded slots in order]; new padded row i = combined[i]. New symbols start
 * stacked directly above row 0 (row k - n), so the whole stack above a hole moves
 * as one — identical to the Stake SDK's tumbleBoardInit/SlideDown.
 */
export const planTumble = (board: Board, exploding: Position[], newSymbols: string[][]): TumblePlan => {
  const columns: TumbleSource[][] = [];
  const next: Board = [];
  const overflow: TumbleSource[][] = [];
  for (let reel = 0; reel < GRID.reels; reel++) {
    const gone = new Set(exploding.filter((p) => p.reel === reel).map((p) => p.row));
    const adding = newSymbols[reel] ?? [];
    const combined: TumbleSource[] = [
      ...adding.map((id, index): TumbleSource => ({ kind: 'new', index, fromRow: index - adding.length, id })),
      ...board[reel]
        .map((id, fromRow): TumbleSource => ({ kind: 'survivor', fromRow, id }))
        .filter((s) => !gone.has(s.fromRow)),
    ];
    if (combined.length !== GRID.paddedRows && import.meta.env.DEV) {
      throw new Error(
        `planTumble: reel ${reel} has ${combined.length} symbols after tumble (expected ${GRID.paddedRows})`,
      );
    }
    // Malformed data in prod: keep the old symbol for missing rows rather than leaving holes.
    const col: TumbleSource[] = [];
    for (let row = 0; row < GRID.paddedRows; row++) {
      col.push(combined[row] ?? { kind: 'survivor', fromRow: row, id: board[reel][row] });
    }
    columns.push(col);
    overflow.push(combined.slice(GRID.paddedRows));
    next.push(col.map((s) => s.id));
  }
  return { columns, next, overflow };
};

// ---------------------------------------------------------------------------
// Cluster boundary tracing
// ---------------------------------------------------------------------------

export interface LatticePt {
  /** lattice column 0..GRID.reels (left seam of reel i) */
  i: number;
  /** lattice row 0..GRID.rows (top seam of visible row j) */
  j: number;
}

/**
 * Closed boundary loops of a cell set (visible cells), as lattice corner points
 * with collinear points removed. Edges are directed clockwise (interior on the
 * right in screen space), so outer loops run clockwise and holes run
 * counter-clockwise. Diagonal pinch points are resolved by the sharpest right
 * turn, which keeps every loop simple.
 */
export const traceCluster = (positions: Position[]): LatticePt[][] => {
  const cells = new Set<string>();
  for (const p of positions) if (isVisibleRow(p.row)) cells.add(`${p.reel},${p.row - GRID.firstVisibleRow}`);
  const has = (c: number, r: number) => cells.has(`${c},${r}`);

  type Edge = { a: LatticePt; b: LatticePt; used: boolean };
  const edges: Edge[] = [];
  const out = new Map<string, Edge[]>();
  const add = (ai: number, aj: number, bi: number, bj: number) => {
    const e: Edge = { a: { i: ai, j: aj }, b: { i: bi, j: bj }, used: false };
    edges.push(e);
    const k = `${ai},${aj}`;
    const list = out.get(k);
    if (list) list.push(e);
    else out.set(k, [e]);
  };
  for (const key of cells) {
    const [c, r] = key.split(',').map(Number);
    if (!has(c, r - 1)) add(c, r, c + 1, r); // top: left -> right
    if (!has(c + 1, r)) add(c + 1, r, c + 1, r + 1); // right: top -> bottom
    if (!has(c, r + 1)) add(c + 1, r + 1, c, r + 1); // bottom: right -> left
    if (!has(c - 1, r)) add(c, r + 1, c, r); // left: bottom -> top
  }

  const loops: LatticePt[][] = [];
  for (const start of edges) {
    if (start.used) continue;
    const loop: LatticePt[] = [];
    let e: Edge | undefined = start;
    let guard = 0;
    while (e && !e.used && guard++ < 400) {
      e.used = true;
      loop.push(e.a);
      const dx = e.b.i - e.a.i;
      const dy = e.b.j - e.a.j;
      const candidates: Edge[] = (out.get(`${e.b.i},${e.b.j}`) ?? []).filter((x) => !x.used);
      if (candidates.length > 1) {
        // prefer right turn (cross > 0 in y-down space), then straight, then left
        const score = (x: Edge) => {
          const ex = x.b.i - x.a.i;
          const ey = x.b.j - x.a.j;
          const cross = dx * ey - dy * ex;
          const dot = dx * ex + dy * ey;
          return cross > 0 ? 2 : dot > 0 ? 1 : 0;
        };
        candidates.sort((p, q) => score(q) - score(p));
      }
      e = candidates[0];
    }
    loops.push(simplifyLoop(loop));
  }
  return loops;
};

const simplifyLoop = (pts: LatticePt[]): LatticePt[] => {
  const n = pts.length;
  const res: LatticePt[] = [];
  for (let k = 0; k < n; k++) {
    const p = pts[(k - 1 + n) % n];
    const c = pts[k];
    const q = pts[(k + 1) % n];
    const cross = (c.i - p.i) * (q.j - c.j) - (c.j - p.j) * (q.i - c.i);
    if (cross !== 0) res.push(c);
  }
  return res;
};

// ---------------------------------------------------------------------------
// Deterministic RNG (idle life / attract board must be reproducible in captures)
// ---------------------------------------------------------------------------

export const mulberry32 = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
