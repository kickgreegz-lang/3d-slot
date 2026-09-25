import type { ClusterWin, Position } from '../../../book/types';
import { getSymbolDef } from '../../../config/game';
import { lighten } from '../../../fx/util';
import { BASS_DROP_TIMING, TEAL } from '../timing';
import type { OrbLaunch } from './Orbs';

const O = BASS_DROP_TIMING.orbs;

/** One exploding cell of a tumble step, ordered for the orb stream. */
export interface PlanCell {
  reel: number;
  row: number;
  /** index into the step's clusters (-1: not in any listed cluster) */
  cluster: number;
  /** BFS depth from the cluster's overlay cell and index within that depth */
  depth: number;
  index: number;
  /** normal-speed launch delay after the burst (ms, spread cap applied) */
  delayMs: number;
  /** halo tint: the cluster symbol colour lightened 35 % */
  color: number;
  /** orbs this cell releases (the step's `delta` spread over its cells) */
  count: number;
}

export const cellKey = (p: Position): string => `${p.reel},${p.row}`;

const NEIGHBOURS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

/**
 * Order a step's exploding cells for the orb stream (DESIGN §6.3 steps 2-3): BFS outward
 * from each cluster's `overlay` cell ("the groove drains from the heart of the cluster"),
 * delay = depth x 22 + indexInDepth x 6 ms with the whole spread capped at 300 ms, and the
 * step's `delta` orbs spread over the cells (delta = exploding count in the mock; if it
 * differs, cells are picked evenly in stream order, or some release two).
 */
export const planStep = (exploding: readonly Position[], wins: readonly ClusterWin[], delta: number): PlanCell[] => {
  const byKey = new Map<string, PlanCell>();
  for (const p of exploding) {
    const k = cellKey(p);
    if (!byKey.has(k)) byKey.set(k, { reel: p.reel, row: p.row, cluster: -1, depth: 0, index: 0, delayMs: 0, color: TEAL, count: 0 });
  }
  wins.forEach((w, ci) => {
    const inCluster = new Set(w.positions.map(cellKey));
    const color = lighten(getSymbolDef(w.symbol).color, 0.35);
    const rootKey = inCluster.has(cellKey(w.meta.overlay)) ? cellKey(w.meta.overlay) : w.positions[0] ? cellKey(w.positions[0]) : '';
    if (!rootKey) return;
    const seen = new Set<string>([rootKey]);
    let frontier = [rootKey];
    let depth = 0;
    while (frontier.length) {
      const next: string[] = [];
      frontier.forEach((k, index) => {
        const c = byKey.get(k);
        if (c && c.cluster < 0) {
          c.cluster = ci;
          c.depth = depth;
          c.index = index;
          c.color = color;
        }
        const [r, row] = k.split(',').map(Number);
        for (const [dr, dc] of NEIGHBOURS) {
          const nk = `${r + dr},${row + dc}`;
          if (inCluster.has(nk) && !seen.has(nk)) {
            seen.add(nk);
            next.push(nk);
          }
        }
      });
      frontier = next;
      depth++;
    }
  });
  const cells = [...byKey.values()];
  // cells outside every listed cluster go last, in book order
  let orphan = 0;
  let maxDepth = 0;
  for (const c of cells) if (c.cluster >= 0) maxDepth = Math.max(maxDepth, c.depth);
  for (const c of cells) {
    if (c.cluster >= 0) continue;
    c.depth = maxDepth + 1;
    c.index = orphan++;
  }
  let maxDelay = 0;
  for (const c of cells) {
    c.delayMs = c.depth * O.depthStagger + c.index * O.orbStagger;
    maxDelay = Math.max(maxDelay, c.delayMs);
  }
  if (maxDelay > O.spreadCap) for (const c of cells) c.delayMs *= O.spreadCap / maxDelay;
  cells.sort((a, b) => a.delayMs - b.delayMs || a.cluster - b.cluster);

  // spread `delta` orbs over the cells
  const n = Math.max(0, Math.round(delta));
  const m = cells.length;
  if (m > 0 && n > 0) {
    if (n <= m) {
      for (let i = 0; i < n; i++) cells[Math.min(m - 1, Math.floor(((i + 0.5) * m) / n))].count++;
    } else {
      const base = Math.floor(n / m);
      const rem = n % m;
      cells.forEach((c, i) => (c.count = base + (i < rem ? 1 : 0)));
    }
  }
  return cells;
};

export type OrbMode = 'normal' | 'turbo' | 'comets';

/**
 * Orb launches for the cells bursting now:
 *  - normal: one orb per count, BFS delays (extra orbs of one cell trail it by 6 ms);
 *  - turbo: zero stagger, each flight +-10 % (seeded), so they still arrive as a quick stream;
 *  - comets (super turbo / slam): at most 6, one per cluster carrying its share; with fewer
 *    than 3 clusters the largest splits (DESIGN §6.3 speed profiles).
 */
export const orbsFor = (cells: readonly PlanCell[], mode: OrbMode, rnd: () => number): OrbLaunch[] => {
  const out: OrbLaunch[] = [];
  const jitter = (): number => (rnd() * 2 - 1) * O.jitter;
  if (mode !== 'comets') {
    for (const c of cells) {
      for (let j = 0; j < c.count; j++) {
        out.push({
          reel: c.reel,
          row: c.row,
          color: c.color,
          delayMs: mode === 'normal' ? c.delayMs + j * O.orbStagger : 0,
          flightMul: mode === 'turbo' ? 1 + (rnd() * 2 - 1) * O.turboFlightVariance : 1,
          jitter: jitter(),
          count: 1,
          comet: false,
        });
      }
    }
    return out;
  }
  // group by cluster (stream order kept inside a group)
  const groups = new Map<number, PlanCell[]>();
  for (const c of cells) {
    if (c.count <= 0) continue;
    let g = groups.get(c.cluster);
    if (!g) {
      g = [];
      groups.set(c.cluster, g);
    }
    g.push(c);
  }
  const sum = (g: readonly PlanCell[]): number => g.reduce((a, c) => a + c.count, 0);
  let list = [...groups.values()].sort((a, b) => sum(b) - sum(a));
  const cap = O.superTurboComets;
  if (list.length > cap) {
    const tail = list.slice(cap - 1).flat();
    list = [...list.slice(0, cap - 1), tail];
  }
  if (list.length > 0 && list.length < 3) {
    const want = Math.min(3 - list.length + 1, list[0].length, sum(list[0]));
    if (want > 1) {
      const big = list[0];
      const chunks: PlanCell[][] = [];
      for (let i = 0; i < want; i++) chunks.push(big.slice(Math.floor((i * big.length) / want), Math.floor(((i + 1) * big.length) / want)));
      list = [...chunks.filter((ch) => ch.length), ...list.slice(1)];
    }
  }
  for (const g of list) {
    const src = g[0];
    out.push({
      reel: src.reel,
      row: src.row,
      color: src.color,
      delayMs: 0,
      flightMul: 1 + (rnd() * 2 - 1) * O.turboFlightVariance * 0.5,
      jitter: jitter(),
      count: sum(g),
      comet: true,
    });
  }
  return out;
};
