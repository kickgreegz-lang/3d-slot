import { gsap } from 'gsap';
import { Container } from 'pixi.js';
import { BOARD_TIMING } from '../../../board/boardTiming';
import { type Board as BoardIds, cloneBoard, planTumble } from '../../../board/model';
import type { ClusterWin, Position } from '../../../book/types';
import { SYMBOLS } from '../../../config/game';
import { clock } from '../../../core/clock';
import { followSpeed, s, stagger } from '../../../core/timing';
import type { GameContext, GameModule } from '../../../game/context';
import { GOLD } from '../timing';
import { CountPops } from './CountPops';
import { ensureConnectFonts } from './fonts';
import { clusterGraph, splitBurst } from './graph';
import { LinkField } from './LinkField';
import { CONNECT_LOOK as LOOK } from './look';

const isWildId = (id: string | undefined): boolean => !!id && SYMBOLS[id]?.kind === 'wild';

/**
 * CONNECTIONS — the "connections feed the meter" read of a tumble step (DESIGN.md §7.3,
 * §6.3 step 9):
 *  - 'board:showWins'  groove links per cluster (book order, BOARD_TIMING.clusterStagger apart):
 *                      one link per orthogonal adjacency, BFS draw-on from the overlay cell,
 *                      SFX link_connect once per cluster; held links scroll + pulse. Resolves
 *                      at once (never extends the presentation);
 *  - 'board:tumble'    every link collapses to its edge midpoint (links.snap);
 *  - 'board:burst'     (the Board's explode-burst frame) links spark and leave; each cluster
 *                      that exploded pops a teal "+N" that rides the orb stream to the meter;
 *  - 'round:end' / 'board:reveal' fade leftover links (win cap: no tumble), 'round:start' /
 *    'board:set' clear everything.
 * A board mirror (reveal / tumble / transform / set) tells which cells hold a wild, so the
 * links through a W are gold. Links and pops share one holder in `layers.board` (above the
 * symbols, below the frame) that is attached to `winLayer` while anything shows and kept
 * last in it, so it draws above the win-elevated symbols (which join winLayer at their pop)
 * and below the cluster labels (overlay).
 */
export class Connections implements GameModule {
  private readonly holder = new Container({ label: 'connections' });
  private links!: LinkField;
  private pops!: CountPops;
  private board: BoardIds = [];
  /** clusters of the last showWins and the indices that already popped */
  private clusters: readonly ClusterWin[] = [];
  private readonly popped = new Set<number>();
  private readonly pending = new Set<gsap.core.Tween>();
  private attached = false;
  private offs: Array<() => void> = [];

  constructor(private readonly ctx: GameContext) {}

  init(): void {
    const { ctx } = this;
    ensureConnectFonts(ctx.app.renderer);
    this.links = new LinkField();
    this.pops = new CountPops();
    this.holder.addChild(this.links.view, this.pops.view);
    ctx.layers.board.addChild(this.holder);

    const g = ctx.game;
    this.offs.push(
      g.on('round:start', () => this.clearAll()),
      g.on('round:end', () => this.links.fadeOut()),
      g.on('board:reveal', ({ board }) => {
        this.board = cloneBoard(board);
        this.clusters = [];
        this.popped.clear();
        this.killPending();
        this.links.fadeOut();
      }),
      g.on('board:set', ({ board }) => {
        this.board = cloneBoard(board);
        this.clearAll();
      }),
      g.on('board:transform', ({ cells }) => {
        for (const c of cells) if (this.board[c.reel]?.[c.row] !== undefined) this.board[c.reel][c.row] = c.id;
      }),
      g.on('board:showWins', ({ wins }) => this.onShowWins(wins)),
      g.on('board:tumble', ({ exploding, newSymbols }) => this.onTumble(exploding, newSymbols)),
      g.on('board:burst', ({ positions }) => this.onBurst(positions)),
      g.on('layout:change', () => this.update(0)),
      clock.onUpdate((dt) => this.update(dt)),
    );
  }

  destroy(): void {
    for (const off of this.offs) off();
    this.offs = [];
    this.killPending();
    this.setAttached(false);
    this.links.destroy();
    this.pops.destroy();
    this.holder.destroy({ children: true });
  }

  // ======================================================================= wins

  private onShowWins(wins: readonly ClusterWin[]): void {
    this.killPending();
    this.links.clear();
    this.clusters = wins;
    this.popped.clear();
    wins.forEach((w, i) => {
      const delay = i * stagger(BOARD_TIMING.clusterStagger);
      if (delay <= 0) {
        this.drawCluster(w, i);
        return;
      }
      const call = followSpeed(
        gsap.delayedCall(s(delay), () => {
          this.pending.delete(call);
          this.drawCluster(w, i);
        }),
      );
      this.pending.add(call);
    });
  }

  private drawCluster(w: ClusterWin, i: number): void {
    const graph = clusterGraph(w.positions, w.meta.overlay, (reel, row) => isWildId(this.board[reel]?.[row]));
    const color = SYMBOLS[w.symbol]?.color ?? 0xffffff;
    if (this.links.show(graph, color, GOLD) > 0) {
      this.ctx.game.broadcast('sfx', { id: 'link_connect', rate: 1 + Math.min(i, 4) * 0.06 });
    }
    this.update(0);
  }

  // ======================================================================= tumble

  private onTumble(exploding: Position[], newSymbols: string[][]): void {
    this.killPending();
    this.links.snap();
    if (this.board.length) {
      const seen = new Set<string>();
      const uniq = exploding.filter((p) => {
        const k = `${p.reel},${p.row}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      this.board = planTumble(this.board, uniq, newSymbols).next;
    }
  }

  private onBurst(positions: Position[]): void {
    const L = this.ctx.layout;
    const perLink = this.ctx.tier === 'low' ? Math.ceil(LOOK.sparksPerLink / 2) : LOOK.sparksPerLink;
    this.links.burst(L, perLink, (x, y, color, count) =>
      this.ctx.game.broadcast('fx:burst', { kind: 'sparkle', x, y, color, count, power: LOOK.sparkPower }),
    );
    for (const part of splitBurst(this.clusters, this.popped, positions)) {
      this.popped.add(part.index);
      if (!part.cells.length) continue;
      let reel = 0;
      let row = 0;
      for (const c of part.cells) {
        reel += c.reel;
        row += c.row;
      }
      this.pops.spawn(part.cells.length, reel / part.cells.length, row / part.cells.length);
    }
    this.update(0);
  }

  // ======================================================================= frame

  private update(dt: number): void {
    const L = this.ctx.layout;
    this.links.update(dt, L);
    this.pops.update(L);
    this.setAttached(this.links.active || this.pops.active);
  }

  /**
   * Attached to winLayer while something shows, and kept LAST in it: the Board elevates the
   * winners of each cluster into winLayer at their pop (after our draw-on call on the same
   * frame), so the order is re-checked every frame instead of once.
   */
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

  private killPending(): void {
    for (const c of this.pending) c.kill();
    this.pending.clear();
  }

  private clearAll(): void {
    this.killPending();
    this.clusters = [];
    this.popped.clear();
    this.links.clear();
    this.pops.clear();
    this.update(0);
  }
}
