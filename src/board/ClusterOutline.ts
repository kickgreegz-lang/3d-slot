import { gsap } from 'gsap';
import { Container, Graphics, Sprite } from 'pixi.js';
import type { Position } from '../book/types';
import type { LayoutSpec } from '../config/layout';
import { s } from '../core/timing';
import type { GameContext } from '../game/context';
import { BOARD_TIMING } from './boardTiming';
import { type LatticePt, pitchOf, traceCluster } from './model';

/**
 * Animated cluster outline: a glowing neon tube tracing the UNION of a cluster's
 * cells (boundary edges only, holes included), drawn on from the top-left
 * corner in both directions until the two heads meet bottom-right, then held
 * with a soft pulse until the tumble fades it out.
 *
 * Three additive strokes (wide halo, body, hot core) replace a glow filter; the
 * Graphics is only rebuilt during the ~0.3 s draw-on, then left static.
 */
interface Loop {
  /** sampled polyline (x,y pairs, closed: last point != first) */
  pts: number[];
  /** cumulative arc length at each point */
  cum: number[];
  total: number;
  /** arc length where the draw-on starts (top-left-most point) */
  start: number;
}

interface Item {
  g: Graphics;
  heads: Sprite[];
  /** cluster cells (padded rows), kept to re-trace the loops on a layout change */
  positions: Position[];
  loops: Loop[];
  color: number;
  core: number;
  width: number;
  progress: { p: number };
  tweens: gsap.core.Animation[];
}

const mix = (a: number, b: number, t: number): number => {
  const ch = (sh: number) => Math.round(((a >> sh) & 0xff) * (1 - t) + ((b >> sh) & 0xff) * t) << sh;
  return ch(16) | ch(8) | ch(0);
};

export class ClusterOutlines {
  readonly view = new Container({ label: 'clusterOutlines' });
  private items: Item[] = [];
  private readonly scratch: number[] = [];

  constructor(private ctx: GameContext) {}

  /** Draw on an outline around `positions` (padded rows). Resolves when the draw-on completes. */
  show(positions: Position[], color: number, L: LayoutSpec): Promise<void> {
    const loops = traceCluster(positions).map((l) => this.sampleLoop(l, L));
    if (!loops.length) return Promise.resolve();
    const g = new Graphics();
    g.blendMode = 'add';
    this.view.addChild(g);
    const heads: Sprite[] = [];
    const headTex = this.ctx.art.particle('glow');
    for (let i = 0; i < loops.length * 2; i++) {
      const h = new Sprite(headTex);
      h.anchor.set(0.5);
      h.blendMode = 'add';
      h.tint = mix(color, 0xffffff, 0.6);
      h.width = h.height = L.cell * 0.42;
      h.alpha = 0;
      this.view.addChild(h);
      heads.push(h);
    }
    const item: Item = {
      g,
      heads,
      positions,
      loops,
      color,
      core: mix(color, 0xffffff, 0.65),
      width: Math.max(2.5, L.cell * 0.03),
      progress: { p: 0 },
      tweens: [],
    };
    this.items.push(item);
    this.draw(item);

    return new Promise<void>((resolve) => {
      const draw = gsap.to(item.progress, {
        p: 1,
        duration: s(BOARD_TIMING.outlineDraw),
        ease: BOARD_TIMING.outlineDrawEase,
        onUpdate: () => this.draw(item),
        onComplete: () => {
          this.draw(item);
          for (const h of heads) gsap.to(h, { alpha: 0, duration: s(120), ease: 'power1.in' });
          const pulse = gsap.to(g, {
            alpha: 0.72,
            duration: s(BOARD_TIMING.outlinePulse / 2),
            ease: 'sine.inOut',
            yoyo: true,
            repeat: -1,
          });
          item.tweens.push(pulse);
          resolve();
        },
        onInterrupt: () => resolve(),
      });
      item.tweens.push(draw);
      for (const h of heads) item.tweens.push(gsap.to(h, { alpha: 1, duration: s(60) }));
    });
  }

  /** Fade every outline out (tumble start). */
  fadeOut(): Promise<void> {
    const items = this.items;
    this.items = [];
    if (!items.length) return Promise.resolve();
    return new Promise<void>((resolve) => {
      let left = items.length;
      for (const it of items) {
        for (const t of it.tweens) t.kill();
        gsap.to(it.g, {
          alpha: 0,
          duration: s(BOARD_TIMING.outlineFade),
          ease: 'power1.in',
          onComplete: () => {
            this.destroyItem(it);
            if (--left === 0) resolve();
          },
        });
        for (const h of it.heads) h.visible = false;
      }
    });
  }

  /** Re-trace every held outline for a new layout (device rotation while wins are shown). */
  layout(L: LayoutSpec): void {
    for (const it of this.items) {
      it.loops = traceCluster(it.positions).map((l) => this.sampleLoop(l, L));
      it.width = Math.max(2.5, L.cell * 0.03);
      for (const h of it.heads) h.width = h.height = L.cell * 0.42;
      this.draw(it);
    }
  }

  clear(): void {
    for (const it of this.items) this.destroyItem(it);
    this.items = [];
  }

  private destroyItem(it: Item): void {
    for (const t of it.tweens) t.kill();
    gsap.killTweensOf(it.g);
    for (const h of it.heads) {
      gsap.killTweensOf(h);
      h.destroy();
    }
    it.g.destroy();
  }

  // -------------------------------------------------------------------------

  /** Lattice loop -> px polyline on the seam centres with rounded corners. */
  private sampleLoop(loop: LatticePt[], L: LayoutSpec): Loop {
    const pitch = pitchOf(L);
    const ox = L.grid.x - L.gap / 2;
    const oy = L.grid.y - L.gap / 2;
    const P = loop.map((q) => ({ x: ox + q.i * pitch, y: oy + q.j * pitch }));
    const n = P.length;
    const convexR = L.cell * 0.16;
    const concaveR = L.cell * 0.09;
    const pts: number[] = [];
    for (let k = 0; k < n; k++) {
      const a = P[(k - 1 + n) % n];
      const c = P[k];
      const b = P[(k + 1) % n];
      const lin = Math.hypot(c.x - a.x, c.y - a.y);
      const lout = Math.hypot(b.x - c.x, b.y - c.y);
      const dix = (c.x - a.x) / lin;
      const diy = (c.y - a.y) / lin;
      const dox = (b.x - c.x) / lout;
      const doy = (b.y - c.y) / lout;
      const convex = dix * doy - diy * dox > 0; // right turn in y-down space
      const r = Math.min(convex ? convexR : concaveR, lin / 2, lout / 2);
      const x0 = c.x - dix * r;
      const y0 = c.y - diy * r;
      const x1 = c.x + dox * r;
      const y1 = c.y + doy * r;
      const SEG = 6;
      for (let i = 0; i <= SEG; i++) {
        const t = i / SEG;
        const u = 1 - t;
        pts.push(u * u * x0 + 2 * u * t * c.x + t * t * x1, u * u * y0 + 2 * u * t * c.y + t * t * y1);
      }
    }
    const cum: number[] = [0];
    const count = pts.length / 2;
    let total = 0;
    for (let i = 1; i <= count; i++) {
      const j = i % count;
      total += Math.hypot(pts[j * 2] - pts[(i - 1) * 2], pts[j * 2 + 1] - pts[(i - 1) * 2 + 1]);
      cum.push(total);
    }
    let best = 0;
    let bestScore = Infinity;
    for (let i = 0; i < count; i++) {
      const sc = pts[i * 2] + pts[i * 2 + 1];
      if (sc < bestScore) {
        bestScore = sc;
        best = i;
      }
    }
    return { pts, cum, total, start: cum[best] };
  }

  /** Point at arc length u (wrapped) -> writes into out[0..1]. */
  private pointAt(l: Loop, u: number, out: number[]): number {
    const count = l.pts.length / 2;
    let v = u % l.total;
    if (v < 0) v += l.total;
    let i = 0;
    while (i < count - 1 && l.cum[i + 1] < v) i++;
    const j = (i + 1) % count;
    const seg = l.cum[i + 1] - l.cum[i] || 1;
    const t = (v - l.cum[i]) / seg;
    out[0] = l.pts[i * 2] + (l.pts[j * 2] - l.pts[i * 2]) * t;
    out[1] = l.pts[i * 2 + 1] + (l.pts[j * 2 + 1] - l.pts[i * 2 + 1]) * t;
    return i;
  }

  /** Rebuild the partial path for the current progress (3 additive strokes). */
  private draw(it: Item): void {
    const g = it.g;
    g.clear();
    const p = it.progress.p;
    const passes: [number, number, number][] = [
      [it.width * 7, it.color, 0.14],
      [it.width * 4, it.color, 0.24],
      [it.width * 2.2, it.color, 0.7],
      [it.width, it.core, 1],
    ];
    const tmp = [0, 0];
    it.loops.forEach((l, li) => {
      const path = this.scratch;
      path.length = 0;
      if (p >= 1) {
        for (let i = 0; i < l.pts.length; i++) path.push(l.pts[i]);
      } else {
        const half = (p * l.total) / 2;
        const a = l.start - half;
        const b = l.start + half;
        const count = l.pts.length / 2;
        let i = this.pointAt(l, a, tmp);
        path.push(tmp[0], tmp[1]);
        // walk vertices from segment i+1 until we pass b
        let travelled = 0;
        const segStart = ((a % l.total) + l.total) % l.total;
        let cursor = segStart;
        for (let guard = 0; guard < count + 1; guard++) {
          const nextIdx = (i + 1) % count;
          const nextCum = l.cum[i + 1];
          const step = nextCum - cursor;
          if (travelled + step >= b - a) break;
          travelled += step;
          path.push(l.pts[nextIdx * 2], l.pts[nextIdx * 2 + 1]);
          cursor = nextIdx === 0 ? 0 : nextCum;
          i = nextIdx;
        }
        this.pointAt(l, b, tmp);
        path.push(tmp[0], tmp[1]);
        const h0 = it.heads[li * 2];
        const h1 = it.heads[li * 2 + 1];
        h0.position.set(path[0], path[1]);
        h1.position.set(tmp[0], tmp[1]);
      }
      for (const [w, col, alpha] of passes) {
        g.moveTo(path[0], path[1]);
        for (let k = 2; k < path.length; k += 2) g.lineTo(path[k], path[k + 1]);
        if (p >= 1) g.closePath();
        g.stroke({ width: w, color: col, alpha, join: 'round', cap: 'round' });
      }
    });
  }
}
