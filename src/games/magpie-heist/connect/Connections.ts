import { gsap } from 'gsap';
import { Container, Graphics, Sprite, type Texture } from 'pixi.js';
import { BOARD_TIMING } from '../../../board/boardTiming';
import { type Board as BoardIds, cloneBoard, planTumble } from '../../../board/model';
import type { ClusterWin, Position } from '../../../book/types';
import { GRID, SYMBOLS, toSpotRow } from '../../../config/game';
import { cellCenter } from '../../../config/layout';
import { clock } from '../../../core/clock';
import { followSpeed, registerTiming, s, stagger } from '../../../core/timing';
import { reducedMotion } from '../../../fx/motion';
import type { GameContext, GameModule } from '../../../game/context';
import { glowTexture, streakTexture } from '../scene/textures';
import { GOLD_HOT } from '../timing';
import { clusterGraph } from './graph';

/** Lab-tunable connection look (section `heistConnect`); ms are game time (s()). */
export const CONNECT = registerTiming('heistConnect', {
  /** gold thread: draw-on per BFS depth, grow time, width (x cell), alpha */
  depthStagger: 45,
  grow: 110,
  width: 0.16,
  alpha: 0.95,
  /** bead of light running root -> leaves along the threads */
  beadPeriod: 700,
  beadSize: 0.55,
  /** super cascade: arcs start after the threads, flicker rate, jitter (x cell), ring flash */
  arcDelay: 220,
  arcFlickerMs: 55,
  arcJitter: 0.1,
  arcSegments: 9,
  ringSize: 1.4,
  /** snap: sparks per link at the explode burst */
  sparks: 4,
  fadeOut: 200,
});

interface Link {
  sp: Sprite;
  ax: number;
  ay: number;
  bx: number;
  by: number;
  depth: number;
  grow: { t: number };
  wild: boolean;
}

interface Arc {
  from: Position;
  to: Position;
  g: Graphics;
  ring: Sprite;
  t: { a: number };
}

const isWildId = (id: string | undefined): boolean => !!id && SYMBOLS[id]?.kind === 'wild';
const lighten = (c: number, k: number): number => {
  const ch = (sh: number): number => Math.round(((c >> sh) & 255) + (255 - ((c >> sh) & 255)) * k);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
};

/**
 * CONNECTIONS — the "connection" read of a win (DESIGN §5.2):
 *  - 'board:showWins': per cluster (BOARD_TIMING.clusterStagger apart) gold threads draw on along the
 *    cluster's link tree from the label cell outward (one per orthogonal adjacency, brighter through a
 *    Bandit Mask), and a bead of light runs root -> leaves while they hold;
 *  - SUPER CASCADE: every other symbol of a winning type on the board (they explode with the cluster)
 *    gets a flickering lightning arc from the nearest cluster cell and a ring flash, so the player sees
 *    WHY it explodes;
 *  - 'board:burst' (the explode frame): threads and arcs snap into sparks; 'board:tumble' / new reveal /
 *    round end clear what is left.
 * A board mirror (reveal / tumble / transform / set) finds the same-type symbols. The holder sits in
 * layers.board and joins winLayer while it shows (kept last in it, above the elevated winners).
 */
export class Connections implements GameModule {
  private readonly holder = new Container({ label: 'heistConnections' });
  private readonly linkLayer = new Container();
  private readonly arcLayer = new Container();
  private links: Link[] = [];
  private arcs: Arc[] = [];
  private beads: Sprite[] = [];
  private board: BoardIds = [];
  private glow!: Texture;
  private streak!: Texture;
  private time = 0;
  private flicker = 0;
  private attached = false;
  private calls = new Set<gsap.core.Tween>();
  private offs: Array<() => void> = [];

  constructor(private readonly ctx: GameContext) {}

  init(): void {
    const { ctx } = this;
    this.glow = glowTexture();
    this.streak = streakTexture();
    this.holder.addChild(this.arcLayer, this.linkLayer);
    ctx.layers.board.addChild(this.holder);
    const g = ctx.game;
    this.offs.push(
      g.on('round:start', () => this.clear()),
      g.on('round:end', () => this.fade()),
      g.on('board:reveal', ({ board }) => {
        this.board = cloneBoard(board);
        this.clear();
      }),
      g.on('board:set', ({ board }) => {
        this.board = cloneBoard(board);
        this.clear();
      }),
      g.on('board:transform', ({ cells }) => {
        for (const c of cells) if (this.board[c.reel]?.[c.row] !== undefined) this.board[c.reel][c.row] = c.id;
      }),
      g.on('board:showWins', ({ wins }) => this.show(wins)),
      g.on('board:burst', () => this.snap()),
      g.on('board:tumble', ({ exploding, newSymbols }) => {
        this.clear();
        if (!this.board.length) return;
        const seen = new Set<string>();
        const uniq = exploding.filter((p) => {
          const k = `${p.reel},${p.row}`;
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });
        this.board = planTumble(this.board, uniq, newSymbols).next;
      }),
      clock.onUpdate((dt) => this.update(dt)),
    );
  }

  destroy(): void {
    for (const off of this.offs) off();
    this.clear();
    this.holder.destroy({ children: true });
  }

  private at(p: Position): { x: number; y: number } {
    return cellCenter(this.ctx.layout, p.reel, toSpotRow(p.row));
  }

  private show(wins: readonly ClusterWin[]): void {
    this.clear();
    const inCluster = new Set<number>();
    for (const w of wins) for (const p of w.positions) inCluster.add(p.reel * 16 + p.row);
    const types = new Set(wins.map((w) => w.symbol));
    let maxDelay = 0;
    wins.forEach((w, i) => {
      const delay = i * stagger(BOARD_TIMING.clusterStagger);
      maxDelay = Math.max(maxDelay, delay);
      this.later(delay, () => this.drawCluster(w));
    });
    // super cascade: the other symbols of each winning type
    const extra: Array<{ to: Position; from: Position }> = [];
    for (let reel = 0; reel < GRID.reels; reel++) {
      for (let row = GRID.firstVisibleRow; row <= GRID.lastVisibleRow; row++) {
        const id = this.board[reel]?.[row];
        if (!id || !types.has(id) || inCluster.has(reel * 16 + row)) continue;
        const win = wins.find((w) => w.symbol === id);
        if (!win) continue;
        let best = win.positions[0];
        let bd = Infinity;
        for (const p of win.positions) {
          const d = (p.reel - reel) ** 2 + (p.row - row) ** 2;
          if (d < bd) {
            bd = d;
            best = p;
          }
        }
        extra.push({ to: { reel, row }, from: best });
      }
    }
    extra.forEach((e, i) => this.later(maxDelay + CONNECT.arcDelay + i * stagger(40), () => this.arc(e.from, e.to)));
  }

  private drawCluster(w: ClusterWin): void {
    const L = this.ctx.layout;
    const graph = clusterGraph(w.positions, w.meta.overlay, (reel, row) => isWildId(this.board[reel]?.[row]));
    const tint = lighten(SYMBOLS[w.symbol]?.color ?? 0xffc53d, 0.45);
    for (const e of graph.edges) {
      const a = this.at({ reel: e.aReel, row: e.aRow });
      const b = this.at({ reel: e.bReel, row: e.bRow });
      const sp = new Sprite({ texture: this.streak, anchor: { x: 0.5, y: 0 }, blendMode: 'add', tint: e.wild ? 0xffffff : tint });
      sp.position.set(a.x, a.y);
      sp.rotation = Math.atan2(b.y - a.y, b.x - a.x) - Math.PI / 2;
      sp.width = L.cell * CONNECT.width * (e.wild ? 1.4 : 1);
      sp.height = 0;
      sp.alpha = CONNECT.alpha;
      this.linkLayer.addChild(sp);
      const link: Link = { sp, ax: a.x, ay: a.y, bx: b.x, by: b.y, depth: e.depth, grow: { t: 0 }, wild: e.wild };
      this.links.push(link);
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const tw = followSpeed(
        gsap.to(link.grow, {
          t: 1,
          duration: s(CONNECT.grow),
          delay: s(e.depth * stagger(CONNECT.depthStagger)),
          ease: 'power2.out',
          onUpdate: () => void (sp.height = len * link.grow.t),
        }),
      );
      this.calls.add(tw);
    }
    if (graph.edges.length) {
      const bead = new Sprite({ texture: this.glow, anchor: 0.5, blendMode: 'add', tint: GOLD_HOT });
      bead.scale.set((L.cell * CONNECT.beadSize) / 256);
      this.linkLayer.addChild(bead);
      this.beads.push(bead);
      this.ctx.game.broadcast('sfx', { id: 'spot_mark', rate: 1.4, volume: 0.7 });
    }
    this.setAttached(true);
  }

  private arc(from: Position, to: Position): void {
    const L = this.ctx.layout;
    const g = new Graphics();
    g.blendMode = 'add';
    const ring = new Sprite({ texture: this.glow, anchor: 0.5, blendMode: 'add', tint: 0xfff0b0 });
    const c = this.at(to);
    ring.position.set(c.x, c.y);
    ring.scale.set(0);
    this.arcLayer.addChild(g, ring);
    const arc: Arc = { from, to, g, ring, t: { a: 1 } };
    this.arcs.push(arc);
    const k = (L.cell * CONNECT.ringSize) / 256;
    this.calls.add(followSpeed(gsap.fromTo(ring.scale, { x: 0, y: 0 }, { x: k, y: k, duration: s(180), ease: 'back.out(3)' })));
    this.ctx.game.broadcast('fx:burst', { kind: 'sparkle', x: c.x, y: c.y, color: 0xfff0b0, count: 8, power: 0.8 });
    this.ctx.game.broadcast('sfx', { id: 'link_connect', rate: 1.2, volume: 0.6 });
    this.drawArc(arc);
    this.setAttached(true);
  }

  private drawArc(a: Arc): void {
    const L = this.ctx.layout;
    const p0 = this.at(a.from);
    const p1 = this.at(a.to);
    const n = CONNECT.arcSegments;
    const j = L.cell * CONNECT.arcJitter;
    const nx = -(p1.y - p0.y);
    const ny = p1.x - p0.x;
    const nl = Math.hypot(nx, ny) || 1;
    const pts: number[] = [];
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      const off = i === 0 || i === n ? 0 : (Math.random() - 0.5) * 2 * j * Math.sin(u * Math.PI);
      pts.push(p0.x + (p1.x - p0.x) * u + (nx / nl) * off, p0.y + (p1.y - p0.y) * u + (ny / nl) * off);
    }
    const g = a.g;
    g.clear();
    g.poly(pts, false).stroke({ width: L.cell * 0.09, color: 0xffb020, alpha: 0.35 * a.t.a, join: 'round', cap: 'round' });
    g.poly(pts, false).stroke({ width: L.cell * 0.035, color: 0xffe9a0, alpha: 0.9 * a.t.a, join: 'round', cap: 'round' });
    g.poly(pts, false).stroke({ width: L.cell * 0.012, color: 0xffffff, alpha: a.t.a, join: 'round', cap: 'round' });
  }

  private snap(): void {
    const n = this.ctx.tier === 'low' ? 2 : CONNECT.sparks;
    for (const l of this.links) {
      const x = (l.ax + l.bx) / 2;
      const y = (l.ay + l.by) / 2;
      this.ctx.game.broadcast('fx:burst', { kind: 'sparkle', x, y, color: GOLD_HOT, count: n, power: 0.35 });
    }
    this.fade();
  }

  private fade(): void {
    const items = [...this.links.map((l) => l.sp), ...this.beads, ...this.arcs.flatMap((a) => [a.g, a.ring])];
    if (!items.length) return;
    for (const a of this.arcs) this.calls.add(followSpeed(gsap.to(a.t, { a: 0, duration: s(CONNECT.fadeOut) })));
    this.calls.add(followSpeed(gsap.to(items, { alpha: 0, duration: s(CONNECT.fadeOut), onComplete: () => this.clear() })));
  }

  private later(ms: number, fn: () => void): void {
    if (ms <= 0) {
      fn();
      return;
    }
    const call = followSpeed(gsap.delayedCall(s(ms), () => {
      this.calls.delete(call);
      fn();
    }));
    this.calls.add(call);
  }

  private clear(): void {
    for (const c of this.calls) c.kill();
    this.calls.clear();
    for (const l of this.links) l.sp.destroy();
    for (const b of this.beads) b.destroy();
    for (const a of this.arcs) {
      a.g.destroy();
      a.ring.destroy();
    }
    this.links = [];
    this.beads = [];
    this.arcs = [];
    this.setAttached(false);
  }

  private update(dt: number): void {
    if (!this.links.length && !this.arcs.length) return;
    this.time += dt;
    // beads run root -> leaves: place each bead on the link whose depth matches the phase
    const period = CONNECT.beadPeriod / 1000;
    const maxDepth = this.links.reduce((m, l) => Math.max(m, l.depth), 0) + 1;
    const ph = ((this.time % period) / period) * maxDepth;
    const onDepth = this.links.filter((l) => l.depth === Math.floor(ph) && l.grow.t >= 1);
    this.beads.forEach((b, i) => {
      const l = onDepth[i % Math.max(1, onDepth.length)];
      b.visible = !!l && !reducedMotion();
      if (!l) return;
      const u = ph - Math.floor(ph);
      b.position.set(l.ax + (l.bx - l.ax) * u, l.ay + (l.by - l.ay) * u);
    });
    // arcs flicker
    this.flicker += dt * 1000;
    if (this.flicker > CONNECT.arcFlickerMs) {
      this.flicker = 0;
      for (const a of this.arcs) this.drawArc(a);
    }
    for (const a of this.arcs) a.ring.alpha = 0.6 + 0.4 * Math.sin(this.time * 30);
    this.setAttached(true);
  }

  private setAttached(on: boolean): void {
    const layer = this.ctx.layers.winLayer;
    if (!on) {
      if (this.attached) layer.detach(this.holder);
      this.attached = false;
      return;
    }
    const list = layer.renderLayerChildren;
    if (this.attached && list[list.length - 1] === this.holder) return;
    if (this.attached) layer.detach(this.holder);
    layer.attach(this.holder);
    this.attached = true;
  }
}
