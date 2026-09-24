import type { Container } from 'pixi.js';
import { cellCenter } from '../config/layout';
import { toSpotRow } from '../config/game';
import type { GameContext } from '../game/context';

/**
 * DEV-ONLY motion probe: samples ONE symbol's vertical offset from its rest
 * position and its body squash (scaleX/scaleY) every frame, so QA can plot the
 * curves animators judge easing by (fall acceleration, squash depth, spring
 * overshoot, settle time).
 *
 * Targets:
 *   - a Container (the lab inspector passes its SymbolView.view + rest y)
 *   - a board cell {reel, row(padded)}: tracks the symbol view in that column
 *     that is closest above-or-at the cell (follows fall-out -> drop -> land ->
 *     explode -> refill). Symbol views are found by label 'symbol' under the board
 *     layer (SymbolView contract), their body as child 'body' (fallback: first child).
 */

export interface MotionSample {
  /** real (hit-stop inclusive) ms since start */
  t: number;
  /** design px offset from the rest position (negative = above) */
  y: number;
  sx: number;
  sy: number;
  /** true on the first sample after the tracked view changed */
  repick?: boolean;
}

export interface MotionTrace {
  target: string;
  samples: MotionSample[];
}

export type ProbeTarget = { view: Container; restY: number; label: string } | { reel: number; row: number };

const findSymbolViews = (root: Container, out: Container[] = []): Container[] => {
  for (const child of root.children) {
    const c = child as Container;
    if (c.label === 'symbol') out.push(c);
    else if (c.children?.length) findSymbolViews(c, out);
  }
  return out;
};

/** Visible all the way up the parent chain (Pixi v8 has no `worldVisible`). */
const isShown = (c: Container): boolean => {
  for (let n: Container | null = c; n; n = n.parent) if (!n.visible) return false;
  return true;
};

const bodyOf = (view: Container): Container => {
  const named = view.children.find((c) => c.label === 'body');
  return (named ?? view.children[0] ?? view) as Container;
};

export class MotionProbe {
  private samples: MotionSample[] = [];
  private tracked: Container | null = null;
  private body: Container | null = null;
  private t = 0;
  private active = false;
  private label = '';

  constructor(
    private readonly ctx: GameContext,
    private target: ProbeTarget | null = null,
  ) {}

  start(target: ProbeTarget | null): void {
    this.target = target;
    this.samples = [];
    this.tracked = null;
    this.body = null;
    this.t = 0;
    this.active = !!target;
    this.label = !target ? 'none' : 'view' in target ? target.label : `reel ${target.reel} row ${target.row}`;
  }

  stop(): MotionTrace {
    this.active = false;
    return { target: this.label, samples: this.samples };
  }

  /** Called once per frame with the real delta (seconds). */
  tick(realDt: number): void {
    if (!this.active || !this.target) return;
    this.t += realDt * 1000;
    const t = Math.round(this.t * 100) / 100;
    if ('view' in this.target) {
      const v = this.target.view;
      if (v.destroyed) return;
      const b = bodyOf(v);
      this.samples.push({ t, y: v.y - this.target.restY, sx: b.scale.x, sy: b.scale.y });
      return;
    }
    const { reel, row } = this.target;
    const rest = cellCenter(this.ctx.layout, reel, toSpotRow(row));
    let repick = false;
    const pitch = this.ctx.layout.cell + this.ctx.layout.gap;
    const gone =
      !this.tracked ||
      this.tracked.destroyed ||
      !this.tracked.parent ||
      !isShown(this.tracked) ||
      this.ctx.layers.root.toLocal(this.tracked.getGlobalPosition()).y > rest.y + pitch * 1.5;
    if (gone) {
      this.tracked = this.pick(rest.x, rest.y);
      this.body = this.tracked ? bodyOf(this.tracked) : null;
      repick = !!this.tracked;
    }
    if (!this.tracked || !this.body) return;
    const p = this.ctx.layers.root.toLocal(this.tracked.getGlobalPosition());
    const s: MotionSample = { t, y: p.y - rest.y, sx: this.body.scale.x, sy: this.body.scale.y };
    if (repick) s.repick = true;
    this.samples.push(s);
  }

  private pick(x: number, restY: number): Container | null {
    const root = this.ctx.layers.root;
    const half = (this.ctx.layout.cell + this.ctx.layout.gap) / 2;
    let best: Container | null = null;
    let bestY = Number.NEGATIVE_INFINITY;
    for (const v of findSymbolViews(this.ctx.layers.board)) {
      if (!isShown(v)) continue;
      const p = root.toLocal(v.getGlobalPosition());
      if (Math.abs(p.x - x) > half) continue;
      // falling-out views are already below the cell: skip them
      if (p.y > restY + half) continue;
      if (p.y > bestY) {
        bestY = p.y;
        best = v;
      }
    }
    return best;
  }
}
