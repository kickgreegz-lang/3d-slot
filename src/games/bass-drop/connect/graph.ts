import type { ClusterWin, Position } from '../../../book/types';

/**
 * Pure cluster-topology helpers for the connection presentation (no Pixi, no GSAP): the
 * groove-link tree of a cluster (one link per orthogonal adjacency, oriented away from the
 * overlay cell in BFS order) and the per-cluster exploding counts of a burst.
 */

/** One groove link: parent (closer to the overlay cell) -> child, padded rows. */
export interface LinkEdge {
  aReel: number;
  aRow: number;
  bReel: number;
  bRow: number;
  /** BFS depth of the parent cell: the link draws on at depth x depthStagger */
  depth: number;
  /** a wild stands at either end (gold link through the W) */
  wild: boolean;
}

export interface ClusterGraph {
  edges: LinkEdge[];
  /** deepest parent depth (0 for a 2-cell cluster) */
  maxDepth: number;
}

const key = (reel: number, row: number): number => reel * 64 + row;
/** Neighbour order (up, right, down, left): deterministic BFS. */
const DIRS: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

/**
 * Link tree of a cluster: BFS from `overlay` (or the cluster cell nearest to it), one edge per
 * orthogonal adjacency. The grid graph is bipartite, so both ends of an adjacency always sit
 * one BFS level apart and every adjacency is emitted exactly once, from its shallower end.
 * Cells not reached from the root (malformed data) start their own tree at depth 0.
 */
export const clusterGraph = (
  positions: readonly Position[],
  overlay: Position,
  isWild: (reel: number, row: number) => boolean,
): ClusterGraph => {
  const cells = new Map<number, Position>();
  for (const p of positions) cells.set(key(p.reel, p.row), p);
  const depth = new Map<number, number>();
  const order: Position[] = [];
  const bfs = (root: Position): void => {
    depth.set(key(root.reel, root.row), 0);
    order.push(root);
    for (let i = order.length - 1; i < order.length; i++) {
      const c = order[i];
      const d = depth.get(key(c.reel, c.row)) ?? 0;
      for (const [dx, dy] of DIRS) {
        const k = key(c.reel + dx, c.row + dy);
        const n = cells.get(k);
        if (!n || depth.has(k)) continue;
        depth.set(k, d + 1);
        order.push(n);
      }
    }
  };
  if (cells.size) {
    let root = cells.get(key(overlay.reel, overlay.row));
    if (!root) {
      let best = Infinity;
      for (const p of cells.values()) {
        const dist = Math.abs(p.reel - overlay.reel) + Math.abs(p.row - overlay.row);
        if (dist < best) {
          best = dist;
          root = p;
        }
      }
    }
    if (root) bfs(root);
    for (const p of cells.values()) if (!depth.has(key(p.reel, p.row))) bfs(p);
  }

  const edges: LinkEdge[] = [];
  let maxDepth = 0;
  for (const c of order) {
    const d = depth.get(key(c.reel, c.row)) ?? 0;
    for (const [dx, dy] of DIRS) {
      const n = cells.get(key(c.reel + dx, c.row + dy));
      if (!n || depth.get(key(n.reel, n.row)) !== d + 1) continue;
      edges.push({
        aReel: c.reel,
        aRow: c.row,
        bReel: n.reel,
        bRow: n.row,
        depth: d,
        wild: isWild(c.reel, c.row) || isWild(n.reel, n.row),
      });
      maxDepth = Math.max(maxDepth, d);
    }
  }
  return { edges, maxDepth };
};

/** A cluster's share of one burst: its exploding cells (not claimed by an earlier cluster). */
export interface ClusterBurst {
  index: number;
  cells: Position[];
}

/**
 * Split a board:burst over the clusters of the last showWins (book order). A cell shared by
 * several clusters (a wild) counts for the first one only, so the "+N" pops of a step add
 * up to the meter's delta (one orb per exploding position). Clusters whose cells did not
 * explode are skipped (their pop waits for a later burst).
 */
export const splitBurst = (clusters: readonly ClusterWin[], done: ReadonlySet<number>, burst: readonly Position[]): ClusterBurst[] => {
  const hit = new Set<number>();
  for (const p of burst) hit.add(key(p.reel, p.row));
  const claimed = new Set<number>();
  const out: ClusterBurst[] = [];
  clusters.forEach((c, index) => {
    const cells: Position[] = [];
    const inCluster = new Set<number>();
    for (const p of c.positions) {
      const k = key(p.reel, p.row);
      if (!hit.has(k) || inCluster.has(k)) continue;
      inCluster.add(k);
      if (claimed.has(k)) continue;
      claimed.add(k);
      cells.push(p);
    }
    if (!done.has(index) && inCluster.size) out.push({ index, cells });
  });
  return out;
};
