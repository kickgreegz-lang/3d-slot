import { gsap } from 'gsap';
import { Container, Graphics } from 'pixi.js';
import type { ClusterWin, Position } from '../book/types';
import { FEATURES, GRID, type LandWeight, SYMBOLS, getSymbolDef, isVisibleRow } from '../config/game';
import type { LayoutSpec } from '../config/layout';
import { clock } from '../core/clock';
import { TIMING, fallTime, followSpeed, s, sUi, speedScale, stagger } from '../core/timing';
import { REDUCED_SHAKE_SCALE, reducedMotion } from '../fx/motion';
import type { GameContext, GameModule } from '../game/context';
import type { BoardTransformStyle, GameEvents, SfxId } from '../game/events';
import { createSymbolView } from '../symbols/createSymbolView';
import type { SymbolView } from '../symbols/types';
import { AnticipationBeam } from './AnticipationBeam';
import { BOARD_TIMING } from './boardTiming';
import { ClusterOutlines } from './ClusterOutline';
import { Decorations } from './decorations';
import { type Board as BoardIds, cloneBoard, mulberry32, pitchOf, planTumble, slotPos } from './model';
import { SpotGrid } from './SpotGrid';
import { GridThump } from './thump';

/**
 * BOARD — grid choreography: fall-out, gravity drop-in with anticipation,
 * cluster win presentation (dim / elevate / neon outline), explode + SDK-exact
 * tumble refill, multiplier-spot tiles, idle life.
 *
 * Owns GRID.reels x GRID.paddedRows SymbolViews (the padding rows above and below
 * the visible grid sit one pitch outside it, hidden by the board mask) plus a spare
 * pool, so no view is ever created or destroyed during play. `boardIds` mirrors the book
 * exactly; a DEV assertion checks views <-> model after every tumble.
 *
 * Every scene handler returns a promise that resolves when its motion is done
 * (the flow awaits `broadcastAsync`). All motion runs on GSAP via core/clock
 * (hit-stop + deterministic stepping); durations come from TIMING via s(), and
 * running timelines follow a mid-round speed change (slam-stop) via followSpeed().
 *
 * Views are positioned in CELL units (reel, fractional padded row) and drawn
 * from the current layout, so a layout change mid-animation (device rotation)
 * re-targets motion already in flight instead of finishing at old coordinates.
 *
 * Feature hooks (core scene events, synchronous unless noted; DESIGN bass-drop §5 / §8.3 / §9.3):
 *   board:decorate  keyed displays on the VIEW at a cell (follow falls / pops / squash)
 *   board:thump     the symbol container dips px x k on a 9 Hz spring
 *   board:react     distance-staggered bass_react hop on every visible symbol
 *   board:focus     light dim of everything but some cells (second dim channel)
 *   board:hold      cells that stay standing through the next fall-out / drop-in (CR-10b)
 *   board:burst     EMITTED here during board:tumble at the explode-burst frame
 *   board:transform 'impact' (awaited): crush now, heavy impact placement anticipateDuration later
 * where k = pitch / BOARD_TIMING.physRefPitch.
 */
const WEIGHT_RANK: Record<LandWeight, number> = { light: 0, medium: 1, heavy: 2, special: 3 };
const LAND_SFX: Record<LandWeight, SfxId> = {
  light: 'land_light',
  medium: 'land_medium',
  heavy: 'land_heavy',
  special: 'land_special',
};
const SCATTER_SFX: SfxId[] = ['scatter_land_1', 'scatter_land_2', 'scatter_land_3'];
/** Spare views for tumble refills (exploded views are recycled first). */
const POOL_SPARES = Math.max(14, GRID.reels * 2);
/** Symbol z-order: lower/right cells above upper/left (extrusion falls lower-right). */
const Z_ROW = Math.max(10, GRID.reels);
const zOf = (reel: number, row: number): number => row * Z_ROW + reel;
const Z_BEAM = Math.max(1000, (GRID.paddedRows + 1) * Z_ROW);
const Z_OUTLINE = Z_BEAM + 100;
/** Safety gap (ms) between a column's fall-out end and its drop-in start. */
const PIPELINE_MARGIN = 50;
const isScatter = (id: string): boolean => getSymbolDef(id).kind === 'scatter';
const cellKey = (reel: number, row: number): string => `${reel},${row}`;
/** Orthogonal neighbour offsets (reel, row) for the impact push. */
const NEIGHBOURS: ReadonlyArray<readonly [number, number]> = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];
/** Logical position of a view: reel + fractional padded row (tweened instead of pixels). */
interface Cell {
  reel: number;
  row: number;
}

export class Board implements GameModule {
  private readonly root = new Container({ label: 'boardSymbols', sortableChildren: true });
  private readonly maskG = new Graphics();
  private readonly spots: SpotGrid;
  private readonly outlines: ClusterOutlines;
  private readonly beam = new AnticipationBeam();
  private slots: SymbolView[][] = [];
  private boardIds: BoardIds = [];
  private readonly pool: SymbolView[] = [];
  private readonly cells = new Map<SymbolView, Cell>();
  private readonly elevated = new Set<SymbolView>();
  private readonly dimmed = new Set<SymbolView>();
  private readonly anticipating = new Set<SymbolView>();
  private readonly timelines = new Set<gsap.core.Timeline>();
  private readonly unsubs: (() => void)[] = [];
  private readonly rng = mulberry32(0x5eed);
  /** board currently on screen (false between fall-out and drop-in) */
  private shown = false;
  private roundActive = false;
  /** running board operations (layout re-positioning waits for 0) */
  private busy = 0;
  /** bumped by board:set so stale async operations stop touching the board */
  private gen = 0;
  private tumblesSinceReveal = 0;
  private fallOutPromise: Promise<void> | null = null;
  private fallOutTl: gsap.core.Timeline | null = null;
  /** per column: fall-out timeline time (local s, as built) when its old symbols are gone */
  private fallOutClear: number[] = [];
  /** per column: bumped when the drop-in takes the column over, so a late fall-out never touches it */
  private readonly colEpoch: number[] = new Array<number>(GRID.reels).fill(0);
  private idleCall: gsap.core.Tween | null = null;
  private readonly decorations = new Decorations();
  private readonly thump = new GridThump(this.root);
  /** board:focus: cells kept bright (cellKey) + the tint of the rest; null = no focus */
  private focus: { keep: Set<string>; tint: number } | null = null;
  /** board:hold request for the next fall-out: cellKey -> id */
  private holdReq: Map<string, string> | null = null;
  /** views standing through the current fall-out, until the reveal has settled */
  private readonly held = new Set<SymbolView>();

  constructor(private ctx: GameContext) {
    this.spots = new SpotGrid(ctx);
    this.outlines = new ClusterOutlines(ctx);
  }

  init(): void {
    const { ctx } = this;
    ctx.layers.board.addChild(this.root, this.maskG);
    this.root.mask = this.maskG;
    this.beam.view.zIndex = Z_BEAM;
    this.outlines.view.zIndex = Z_OUTLINE;
    this.root.addChild(this.beam.view, this.outlines.view);

    this.boardIds = this.attractBoard();
    for (let reel = 0; reel < GRID.reels; reel++) {
      const col: SymbolView[] = [];
      for (let row = 0; row < GRID.paddedRows; row++) {
        const sv = createSymbolView(ctx, this.boardIds[reel][row]);
        this.root.addChild(sv.view);
        sv.view.zIndex = zOf(reel, row);
        this.put(sv, reel, row);
        col.push(sv);
      }
      this.slots.push(col);
    }
    for (let i = 0; i < POOL_SPARES; i++) {
      const sv = createSymbolView(ctx, 'L5');
      sv.view.visible = false;
      this.root.addChild(sv.view);
      this.pool.push(sv);
    }
    this.hidePadding();
    this.shown = true;
    this.layout(ctx.layout);

    const g = ctx.game;
    this.unsubs.push(
      g.on('layout:change', ({ layout }) => this.layout(layout)),
      g.on('round:start', () => this.onRoundStart()),
      g.on('round:end', () => this.onRoundEnd()),
      g.on('board:reveal', ({ board, anticipation }) => this.reveal(board, anticipation)),
      g.on('board:showWins', ({ wins }) => this.showWins(wins)),
      g.on('board:tumble', ({ exploding, newSymbols }) => this.tumble(exploding, newSymbols)),
      g.on('board:set', ({ board }) => this.setBoard(board)),
      g.on('board:transform', ({ cells, style }) => this.transform(cells, style)),
      g.on('board:decorate', ({ reel, row, key, display }) => {
        const sv = this.slots[reel]?.[row];
        if (sv) this.decorations.set(sv, key, display);
      }),
      g.on('board:thump', ({ px }) => this.thump.kick(px * this.physK() * (reducedMotion() ? REDUCED_SHAKE_SCALE : 1))),
      g.on('board:react', (p) => this.react(p)),
      g.on('board:focus', ({ cells, tint }) => this.setFocus(cells, tint)),
      g.on('board:hold', ({ cells }) => {
        this.holdReq = cells.length ? new Map(cells.map((c) => [cellKey(c.reel, c.row), c.id])) : null;
      }),
      g.on('spots:update', ({ grid }) => (FEATURES.multiplierSpots ? this.spots.update(grid) : undefined)),
      g.on('spots:reset', ({ grid }) => this.spots.reset(grid)),
      g.on('fs:trigger', ({ positions }) => this.celebrate(positions)),
      g.on('mode:change', ({ gameType }) => {
        if (gameType === 'basegame') this.spots.reset(null);
      }),
    );
    this.scheduleIdle();
    if (import.meta.env.DEV) void import('./demo').then((m) => m.registerBoard(this));
  }

  layout(L: LayoutSpec): void {
    const p = L.panel;
    this.maskG.clear().rect(p.x, p.y, p.w, p.h).fill(0xffffff);
    this.spots.layout(L);
    // SymbolViews re-fit themselves on layout:change; the Board only re-positions. Running
    // tweens move cells (not pixels) and re-draw from ctx.layout every frame, so motion in
    // flight continues in the new layout instead of waiting for the round to go idle.
    for (const sv of this.cells.keys()) this.place(sv);
    this.outlines.layout(L);
    this.beam.layout(L);
  }

  destroy(): void {
    this.gen++;
    for (const off of this.unsubs) off();
    this.idleCall?.kill();
    this.killTimelines();
    this.thump.reset();
    this.decorations.clear();
    this.beam.stop();
    this.outlines.clear();
    this.spots.destroy();
    for (const col of this.slots) for (const sv of col) sv.destroy();
    for (const sv of this.pool) sv.destroy();
    this.root.destroy({ children: true });
    this.maskG.destroy();
  }

  // =========================================================================
  // round start: the old board falls out
  // =========================================================================

  private async onRoundStart(): Promise<void> {
    this.roundActive = true;
    this.idleCall?.kill();
    await this.fallOut();
  }

  private onRoundEnd(): void {
    this.roundActive = false;
    this.scheduleIdle();
  }

  /**
   * Starts the fall-out. Resolves as soon as the FIRST column has left the grid:
   * the drop-in is pipelined column by column behind the fall-out (each new
   * column waits for its own old column, see reveal()), so the grid is never
   * empty for long. The remaining columns keep falling in the background.
   */
  private fallOut(): Promise<void> {
    if (!this.shown) return this.fallOutPromise ?? Promise.resolve();
    this.shown = false;
    this.fallOutPromise = new Promise<void>((firstClear) => void this.runFallOut(firstClear));
    return this.fallOutPromise;
  }

  private async runFallOut(firstClear: () => void): Promise<void> {
    const gen = this.gen;
    this.busy++;
    try {
      this.clearPresentation(false);
      this.takeHold();
      const L = this.ctx.layout;
      const T = TIMING.spin;
      const dist = T.fallOutDistanceCells * pitchOf(L);
      // power1.in over `dist`: v(t) = 2*dist*t/T^2 (px/ms) -> blur once past the threshold
      const tBlur = (BOARD_TIMING.blurSpeed * T.fallOutDuration ** 2) / (2 * dist);
      const tl = this.timeline();
      this.sfx('fall_out');
      this.fallOutClear = [];
      for (let reel = 0; reel < GRID.reels; reel++) {
        let clear = 0;
        const epoch = this.colEpoch[reel];
        const owned = () => this.colEpoch[reel] === epoch;
        for (let row = GRID.firstVisibleRow; row <= GRID.lastVisibleRow; row++) {
          const sv = this.slots[reel][row];
          if (this.held.has(sv)) continue;
          const at = reel * stagger(T.fallOutColumnStagger) + (GRID.lastVisibleRow - row) * stagger(T.fallOutRowStagger);
          const end = at + T.fallOutDuration;
          clear = Math.max(clear, end);
          const to = this.cellOf(sv).row + T.fallOutDistanceCells;
          this.tweenRow(tl, sv, to, s(T.fallOutDuration), T.fallOutEase, s(at));
          tl.call(() => {
            if (owned()) sv.setBlur(true);
          }, [], s(at + tBlur));
          tl.call(() => {
            if (!owned()) return;
            sv.setBlur(false);
            sv.view.visible = false;
            this.decorations.detach(sv);
          }, [], s(end));
        }
        // local timeline seconds as built: a later speed change retimes the timeline (timeScale), not these
        this.fallOutClear.push(s(clear));
      }
      tl.call(firstClear, [], this.fallOutClear[0]);
      this.fallOutTl = tl;
      await this.play(tl);
      if (this.fallOutTl === tl) this.fallOutTl = null;
      if (gen !== this.gen) return;
    } finally {
      firstClear();
      this.done();
    }
  }

  /**
   * ms from now until `reel`'s old symbols are gone (0 when no fall-out is running), in the
   * reveal's unscaled ms for the CURRENT profile: the rest of the fall-out is measured in the
   * fall-out timeline's local seconds and its timeScale (a slam / turbo switch retimes it),
   * which gives real seconds; s() in the reveal divides by speedScale() again.
   */
  private columnClearIn(reel: number): number {
    const tl = this.fallOutTl;
    if (!tl) return 0;
    const realSec = (this.fallOutClear[reel] - tl.time()) / tl.timeScale();
    return Math.max(0, realSec * 1000 * speedScale() + PIPELINE_MARGIN);
  }

  /** The drop-in takes `reel` over: a fall-out still running must not move or hide its views. */
  private takeColumn(reel: number): void {
    this.colEpoch[reel]++;
    const tl = this.fallOutTl;
    if (tl) for (const sv of this.slots[reel]) tl.killTweensOf(this.cellOf(sv));
  }

  // =========================================================================
  // reveal: gravity drop-in, scatter lands, anticipation
  // =========================================================================

  private async reveal(board: string[][], anticipation: number[]): Promise<void> {
    if (this.shown) await this.fallOut();
    else if (this.fallOutPromise) await this.fallOutPromise;
    const gen = this.gen;
    this.busy++;
    try {
      this.roundActive = true;
      this.idleCall?.kill();
      this.tumblesSinceReveal = 0;
      const L = this.ctx.layout;
      const D = TIMING.drop;
      const g = D.gravity;
      const dist = D.startOffsetCells * pitchOf(L);
      const T = fallTime(dist, g, D.minFall);
      const vImpact = (g * T) / 1000;
      const colStagger = stagger(D.columnStagger);
      const rowStagger = stagger(D.rowStagger);
      const hold = TIMING.anticipation.holdPerColumn;
      const visRows = GRID.lastVisibleRow - GRID.firstVisibleRow; // row-steps between the bottom and top visible rows
      const lastImpact = (start: number) => start + visRows * rowStagger + T;

      // ---- column schedule (ms, unscaled; anticipation columns wait) -------
      const colStart: number[] = [];
      const antStart: (number | null)[] = [];
      let shift = 0;
      for (let reel = 0; reel < GRID.reels; reel++) {
        let start = Math.max(reel * colStagger, this.columnClearIn(reel)) + shift;
        if ((anticipation[reel] ?? 0) > 0) {
          const prevDone = reel > 0 ? lastImpact(colStart[reel - 1]) : 0;
          const a = Math.max(start, prevDone);
          antStart.push(a);
          shift += a + hold - start;
          start = a + hold;
        } else {
          antStart.push(null);
        }
        colStart.push(start);
      }
      const antReels = antStart.map((a, r) => (a === null ? -1 : r)).filter((r) => r >= 0);
      const lastAnt = antReels.length ? antReels[antReels.length - 1] : -1;
      const antEnd = lastAnt >= 0 ? lastImpact(colStart[lastAnt]) : -1;
      /** scatters landing before the final anticipating column drops join the heartbeat */
      const antTease = lastAnt >= 0 ? colStart[lastAnt] : -1;

      this.boardIds = cloneBoard(board);
      const tl = this.timeline();
      // CR-10b: a held view whose reveal id matches just stays (no drop-in); a mismatch drops in
      const heldRows = this.slots.map((col, reel) => col.map((sv, row) => this.held.has(sv) && board[reel][row] === sv.id));

      // ---- place each column's new symbols above their slots when it starts --
      // (added first so the placement renders before that column's drop tweens)
      for (let reel = 0; reel < GRID.reels; reel++) {
        tl.call(() => {
          this.takeColumn(reel);
          for (let row = 0; row < GRID.paddedRows; row++) {
            const sv = this.slots[reel][row];
            if (heldRows[reel][row]) continue;
            if (this.held.delete(sv)) sv.view.zIndex = zOf(reel, row);
            this.decorations.detach(sv);
            sv.reset();
            sv.setSymbol(board[reel][row]);
            // padding rows are never seen at rest: park them hidden in their slot
            this.put(sv, reel, isVisibleRow(row) ? row - D.startOffsetCells : row);
            sv.view.zIndex = zOf(reel, row);
            sv.view.visible = isVisibleRow(row);
          }
        }, [], s(colStart[reel]));
      }

      const lands: Promise<void>[] = [];
      const tBlur = (BOARD_TIMING.blurSpeed * 1e6) / g; // ms until v > threshold (v = g t)
      const tBlurOff = T - BOARD_TIMING.blurOffLead;
      let scatterCount = 0;

      // ---- land SFX: one per column (heaviest non-scatter), merged when columns land together
      const sfxAt = new Map<number, LandWeight>();
      for (let reel = 0; reel < GRID.reels; reel++) {
        let heaviest: LandWeight | null = null;
        for (let row = GRID.firstVisibleRow; row <= GRID.lastVisibleRow; row++) {
          if (heldRows[reel][row]) continue;
          const def = getSymbolDef(board[reel][row]);
          if (def.kind === 'scatter') continue;
          if (!heaviest || WEIGHT_RANK[def.landWeight] > WEIGHT_RANK[heaviest]) heaviest = def.landWeight;
        }
        if (!heaviest) continue;
        const t = Math.round(colStart[reel] + T);
        const prev = sfxAt.get(t);
        if (!prev || WEIGHT_RANK[heaviest] > WEIGHT_RANK[prev]) sfxAt.set(t, heaviest);
      }
      for (const [t, w] of sfxAt) tl.call(() => this.sfx(LAND_SFX[w]), [], s(t));

      // ---- anticipation phases --------------------------------------------
      const antColor = SYMBOLS.S?.color ?? 0xffd54a;
      antReels.forEach((reel, i) => {
        tl.call(() => this.beginAnticipation(reel, i === 0, antColor), [], s(antStart[reel] ?? 0));
        tl.call(() => this.spots.setColumnWash(reel, antColor, 0, TIMING.anticipation.outroDuration), [], s(lastImpact(colStart[reel])));
      });
      if (lastAnt >= 0) tl.call(() => this.endAnticipation(), [], s(antEnd));

      // ---- drops -------------------------------------------------------------
      for (let reel = 0; reel < GRID.reels; reel++) {
        for (let row = GRID.firstVisibleRow; row <= GRID.lastVisibleRow; row++) {
          const sv = this.slots[reel][row];
          const id = board[reel][row];
          if (heldRows[reel][row]) continue;
          const at = colStart[reel] + (GRID.lastVisibleRow - row) * rowStagger;
          this.tweenRow(tl, sv, row, s(T), 'power1.in', s(at));
          if (tBlurOff - tBlur > 16) {
            tl.call(() => sv.setBlur(true), [], s(at + tBlur));
            tl.call(() => sv.setBlur(false), [], s(at + tBlurOff));
          }
          const impactAt = at + T;
          tl.call(() => {
            sv.setBlur(false);
            lands.push(sv.land({ velocity: vImpact, silent: true }));
            if (isScatter(id)) {
              scatterCount++;
              this.scatterLanded(sv, reel, row, scatterCount, impactAt < antTease);
            }
          }, [], s(impactAt));
        }
      }

      await this.play(tl);
      await Promise.all(lands);
      if (gen !== this.gen) return;
      for (const sv of [...this.elevated]) this.unelevate(sv);
      this.releaseHeld();
      this.shown = true;
      this.fallOutPromise = null;
    } finally {
      this.done();
    }
  }

  /**
   * CR-10b: consume the board:hold request at the fall-out: every listed cell whose view
   * still shows the id stays standing (drawn above the falling symbols) until the reveal.
   */
  private takeHold(): void {
    const req = this.holdReq;
    this.holdReq = null;
    this.releaseHeld();
    if (!req) return;
    for (const [key, id] of req) {
      const [reel, row] = key.split(',').map(Number);
      const sv = this.slots[reel]?.[row];
      if (!sv || !isVisibleRow(row) || sv.id !== id || !sv.view.visible || sv.state === 'explode' || sv.state === 'hidden') continue;
      this.held.add(sv);
      sv.view.zIndex = Z_BEAM - 2;
    }
  }

  /** Held views return to their normal z-order (after the reveal, board:set). */
  private releaseHeld(): void {
    for (let reel = 0; reel < GRID.reels; reel++) {
      for (let row = 0; row < GRID.paddedRows; row++) {
        const sv = this.slots[reel][row];
        if (this.held.delete(sv)) sv.view.zIndex = zOf(reel, row);
      }
    }
    this.held.clear();
  }

  private scatterLanded(sv: SymbolView, reel: number, row: number, n: number, keepAnticipating: boolean): void {
    const p = slotPos(this.ctx.layout, reel, row);
    const def = getSymbolDef(sv.id);
    this.sfx(SCATTER_SFX[Math.min(n, SCATTER_SFX.length) - 1]);
    this.ctx.game.broadcast('fx:burst', { kind: 'scatter', x: p.x, y: p.y, color: def.color, count: 26, power: 0.9 });
    this.elevate(sv);
    if (keepAnticipating) {
      this.anticipating.add(sv);
      sv.setAnticipation(true);
    }
  }

  private beginAnticipation(reel: number, first: boolean, color: number): void {
    const L = this.ctx.layout;
    for (let r = 0; r < reel; r++) {
      for (let row = GRID.firstVisibleRow; row <= GRID.lastVisibleRow; row++) {
        const sv = this.slots[r][row];
        if (!isScatter(sv.id)) this.dim(sv, true);
      }
    }
    this.beam.show(reel, color, L);
    this.spots.setColumnWash(reel, color, 0.22, TIMING.anticipation.introDuration);
    if (first) {
      this.sfx('anticipation_loop');
      this.ctx.game.broadcast('mascot:cue', { cue: 'anticipation' });
    }
  }

  private endAnticipation(): void {
    void this.beam.hide();
    this.sfx('anticipation_end');
    for (const sv of this.anticipating) sv.setAnticipation(false);
    this.anticipating.clear();
    for (const sv of [...this.dimmed]) this.dim(sv, false);
  }

  // =========================================================================
  // wins: dim / elevate + win() / neon cluster outline
  // =========================================================================

  private async showWins(wins: ClusterWin[]): Promise<void> {
    const gen = this.gen;
    this.busy++;
    try {
      const winners = new Set<SymbolView>();
      for (const w of wins) for (const p of w.positions) winners.add(this.slots[p.reel][p.row]);
      this.forVisible((sv) => {
        if (!winners.has(sv)) this.dim(sv, true);
      });
      this.ctx.game.broadcast('mascot:cue', { cue: this.tumblesSinceReveal > 0 ? 'reactTumble' : 'reactSmall' });
      const started = new Set<SymbolView>();
      const jobs = wins.map(async (w, i) => {
        const delay = i * stagger(BOARD_TIMING.clusterStagger);
        if (delay > 0) await clock.wait(delay);
        if (gen !== this.gen) return;
        const color = getSymbolDef(w.symbol).color;
        this.sfx('win_cluster', { rate: 1 + Math.min(i, 4) * 0.06 });
        const anims: Promise<void>[] = [];
        for (const p of w.positions) {
          const sv = this.slots[p.reel][p.row];
          if (started.has(sv)) continue;
          started.add(sv);
          this.dim(sv, false, false);
          this.elevate(sv);
          anims.push(sv.win());
        }
        this.spots.highlight(w.positions, color);
        anims.push(this.outlines.show(w.positions, color, this.ctx.layout));
        await Promise.all(anims);
      });
      await Promise.all(jobs);
    } finally {
      this.done();
    }
  }

  /** Scatter celebration on free-spin (re)trigger: dim the rest, pop the scatters. */
  private async celebrate(positions: Position[]): Promise<void> {
    this.busy++;
    try {
      const hits = new Set(positions.map((p) => this.slots[p.reel]?.[p.row]).filter((v): v is SymbolView => !!v));
      this.forVisible((sv) => {
        if (!hits.has(sv)) this.dim(sv, true);
      });
      const anims: Promise<void>[] = [];
      for (const sv of hits) {
        this.elevate(sv);
        anims.push(sv.win());
      }
      await Promise.all(anims);
    } finally {
      this.done();
    }
  }

  // =========================================================================
  // tumble: explode -> hit-stop -> SDK-exact gravity refill
  // =========================================================================

  private async tumble(exploding: Position[], newSymbols: string[][]): Promise<void> {
    const gen = this.gen;
    this.busy++;
    try {
      this.tumblesSinceReveal++;
      const L = this.ctx.layout;
      const seen = new Set<string>();
      const uniq = exploding.filter((p) => {
        const k = `${p.reel},${p.row}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      const doomed = uniq.map((p) => this.slots[p.reel][p.row]);

      // ---- explode together, ONE hit-stop + shake at the burst -------------
      void this.outlines.fadeOut();
      this.spots.clearHighlights();
      const E = TIMING.explode;
      const bursts = doomed.map((sv) => sv.explode());
      const n = doomed.length;
      const burstPositions = uniq.map((p) => ({ reel: p.reel, row: p.row }));
      const impact = gsap.delayedCall(s(E.anticipateDuration), () => {
        // orbs / link snaps / count pops sync to the burst frame (before the freeze starts)
        this.ctx.game.broadcast('board:burst', { positions: burstPositions });
        clock.hitStop(E.hitStop);
        const B = BOARD_TIMING;
        this.ctx.game.broadcast('fx:shake', {
          trauma: Math.min(B.explodeTraumaMax, B.explodeTraumaBase + B.explodeTraumaPerSymbol * n),
        });
        this.sfx('explode', { volume: Math.min(1, 0.7 + n * 0.03) });
      });
      followSpeed(impact);
      await Promise.all(bursts);
      if (gen !== this.gen) {
        impact.kill();
        return;
      }
      for (const sv of doomed) this.release(sv);
      const doomedSet = new Set(doomed);
      for (const col of this.slots) {
        for (const sv of col) {
          if (doomedSet.has(sv)) continue;
          this.dim(sv, false);
          this.unelevate(sv);
          if (sv.state === 'postWin') sv.reset();
        }
      }
      await clock.wait(TIMING.tumble.preRefillDelay);
      if (gen !== this.gen) return;

      // ---- refill: combined = [...new, ...survivors]; row i = combined[i] ----
      const plan = planTumble(this.boardIds, uniq, newSymbols);
      const Tu = TIMING.tumble;
      const g = Tu.gravity;
      const pitch = pitchOf(L);
      const tBlur = (BOARD_TIMING.blurSpeed * 1e6) / g;
      const tl = this.timeline();
      const lands: Promise<void>[] = [];
      const next: SymbolView[][] = [];
      const sfxTimes = new Set<number>();
      let scatters = 0;
      let colOrder = 0;
      for (let reel = 0; reel < GRID.reels; reel++) {
        const col: SymbolView[] = [];
        const moving: { sv: SymbolView; from: number; to: number; fresh: boolean }[] = [];
        plan.columns[reel].forEach((src, row) => {
          let sv: SymbolView;
          if (src.kind === 'survivor') {
            sv = this.slots[reel][src.fromRow];
          } else {
            sv = this.acquire(src.id);
            this.put(sv, reel, src.fromRow);
          }
          sv.view.zIndex = zOf(reel, row);
          // resting padding stays hidden; anything moving (incl. row 0 sliding in) shows
          sv.view.visible = isVisibleRow(row) || src.fromRow !== row;
          col.push(sv);
          // "fresh" = the player has not seen it yet (new, or sliding in from padding row 0)
          const fresh = !isVisibleRow(src.fromRow);
          if (src.fromRow !== row) moving.push({ sv, from: src.fromRow, to: row, fresh });
          if (!fresh && isVisibleRow(row) && isScatter(src.id)) scatters++;
        });
        for (const src of plan.overflow[reel]) if (src.kind === 'survivor') this.release(this.slots[reel][src.fromRow]);
        next.push(col);
        if (!moving.length) continue;

        const colDelay = colOrder++ * stagger(Tu.columnStagger);
        moving.sort((a, b) => b.to - a.to); // bottom-most lands first
        let firstImpact = Number.POSITIVE_INFINITY;
        moving.forEach((m, k) => {
          const at = colDelay + k * stagger(Tu.rowStagger);
          const T = fallTime((m.to - m.from) * pitch, g, TIMING.drop.minFall);
          this.tweenRow(tl, m.sv, m.to, s(T), 'power1.in', s(at));
          if (T - BOARD_TIMING.blurOffLead - tBlur > 16) {
            tl.call(() => m.sv.setBlur(true), [], s(at + tBlur));
            tl.call(() => m.sv.setBlur(false), [], s(at + T - BOARD_TIMING.blurOffLead));
          }
          if (!isVisibleRow(m.to)) return;
          firstImpact = Math.min(firstImpact, at + T);
          tl.call(() => {
            m.sv.setBlur(false);
            lands.push(m.sv.land({ velocity: (g * T) / 1000, tumble: true, silent: true }));
            if (m.fresh && isScatter(m.sv.id)) {
              scatters++;
              this.scatterLanded(m.sv, reel, m.to, scatters, false);
            }
          }, [], s(at + T));
        });
        const t = Math.round(firstImpact);
        if (Number.isFinite(firstImpact) && !sfxTimes.has(t)) {
          sfxTimes.add(t);
          tl.call(() => this.sfx('tumble_drop'), [], s(t));
        }
      }

      await this.play(tl);
      await Promise.all(lands);
      if (gen !== this.gen) return;
      for (const sv of [...this.elevated]) this.unelevate(sv);
      this.slots = next;
      this.boardIds = plan.next;
      this.hidePadding();
      this.assertConsistent('tumble');
    } finally {
      this.done();
    }
  }

  // =========================================================================
  // transform: replace symbols in place (wild drops, upgrades, sticky restores)
  // =========================================================================

  private async transform(cells: Array<Position & { id: string }>, style: BoardTransformStyle): Promise<void> {
    const seen = new Set<string>();
    // 'impact' replaces even a cell that already shows the id (a drop onto a W, [M-6])
    const todo = cells.filter((c) => {
      const k = `${c.reel},${c.row}`;
      if (seen.has(k) || !this.slots[c.reel]?.[c.row]) return false;
      if (style !== 'impact' && this.boardIds[c.reel][c.row] === c.id) return false;
      seen.add(k);
      return true;
    });
    if (!todo.length) return;
    const gen = this.gen;
    this.busy++;
    try {
      if (style === 'set') {
        for (const c of todo) {
          const sv = this.slots[c.reel][c.row];
          gsap.killTweensOf(this.cellOf(sv));
          this.decorations.detach(sv);
          sv.reset();
          sv.setSymbol(c.id);
          this.put(sv, c.reel, c.row);
          this.boardIds[c.reel][c.row] = c.id;
        }
        return;
      }
      const jobs = todo.map(async (c, i) => {
        // 'impact' is frame-locked to the caller's proxy contact: never staggered
        const delay = style === 'impact' ? 0 : i * stagger(BOARD_TIMING.transformStagger);
        if (delay > 0) await clock.wait(delay);
        if (gen !== this.gen) return;
        if (style === 'morph') await this.morphCell(c);
        else if (style === 'impact') await this.impactCell(c, gen);
        else await this.dropCell(c, gen);
      });
      await Promise.all(jobs);
      if (gen !== this.gen) return;
      this.hidePadding();
      this.assertConsistent('transform');
    } finally {
      this.done();
    }
  }

  /** Swap in place: sparkle burst + a land squash on the new symbol. */
  private async morphCell(c: Position & { id: string }): Promise<void> {
    const sv = this.slots[c.reel][c.row];
    const def = getSymbolDef(c.id);
    const p = slotPos(this.ctx.layout, c.reel, c.row);
    this.decorations.detach(sv);
    sv.reset();
    sv.setSymbol(c.id);
    this.boardIds[c.reel][c.row] = c.id;
    this.ctx.game.broadcast('fx:burst', { kind: 'sparkle', x: p.x, y: p.y, color: def.color, count: 18, power: 0.8 });
    this.ctx.game.broadcast('fx:shake', { trauma: BOARD_TIMING.transformTrauma * 0.6 });
    this.sfx(LAND_SFX[def.landWeight]);
    await sv.land({ velocity: 2400, silent: true });
  }

  /**
   * Crush + place (CR-10a, DESIGN bass-drop §8.3). At the call the old symbol is crushed: it
   * explodes with fx power BOARD_TIMING.impactCrushPower + `symbol_crush` (no board:burst, so
   * no orb). TIMING.explode.anticipateDuration (s()-scaled) later — the caller's proxy contact
   * — the new id takes the cell with its heavy impact (SymbolView.impact: `drop_impact` or the
   * procedural sy 0.72 squash) and the 4 orthogonal neighbours are pushed out and spring
   * back. Resolves when the new symbol has settled and the crush is done. Contact feedback
   * (impact SFX, dust, shake, hit-stop, board thump, mascot cue) belongs to the caller.
   */
  private async impactCell(c: Position & { id: string }, gen: number): Promise<void> {
    const old = this.slots[c.reel][c.row];
    this.unelevate(old);
    this.dim(old, false, false);
    const burst = old.explode({ power: BOARD_TIMING.impactCrushPower });
    this.sfx('symbol_crush');
    await clock.wait(TIMING.explode.anticipateDuration);
    if (gen !== this.gen) return;
    const sv = this.acquire(c.id);
    this.put(sv, c.reel, c.row);
    // above its neighbours while the slam spills out of the cell
    sv.view.zIndex = Z_BEAM - 1;
    this.slots[c.reel][c.row] = sv;
    this.boardIds[c.reel][c.row] = c.id;
    if (this.focus && !this.focus.keep.has(cellKey(c.reel, c.row))) sv.setFocusDim(this.focus.tint, false);
    this.pushNeighbours(c.reel, c.row);
    await Promise.all([burst, sv.impact()]);
    this.release(old);
    if (gen === this.gen && this.slots[c.reel][c.row] === sv) sv.view.zIndex = zOf(c.reel, c.row);
  }

  /** The 4 orthogonal neighbours of an impact are shoved out and spring back. */
  private pushNeighbours(reel: number, row: number): void {
    const d = BOARD_TIMING.impactPush * this.physK();
    for (const [dr, dc] of NEIGHBOURS) {
      const r = reel + dr;
      const w = row + dc;
      if (r < 0 || r >= GRID.reels || !isVisibleRow(w)) continue;
      this.slots[r]?.[w]?.nudge(dr * d, dc * d, BOARD_TIMING.impactPushMs);
    }
  }

  /**
   * Drop in from above the grid: the new symbol falls (gravity, blur) into its cell and
   * smashes the old one, which bursts on impact and returns to the pool.
   */
  private async dropCell(c: Position & { id: string }, gen: number): Promise<void> {
    const old = this.slots[c.reel][c.row];
    const def = getSymbolDef(c.id);
    const sv = this.acquire(c.id);
    const L = this.ctx.layout;
    const g = TIMING.drop.gravity;
    const from = GRID.firstVisibleRow - 1 - BOARD_TIMING.transformDropCells;
    const T = fallTime((c.row - from) * pitchOf(L), g, TIMING.drop.minFall);
    const E = TIMING.explode;
    this.put(sv, c.reel, from);
    sv.view.zIndex = Z_BEAM - 1;
    const tl = this.timeline();
    this.tweenRow(tl, sv, c.row, s(T), 'power1.in', 0);
    const tBlur = (BOARD_TIMING.blurSpeed * 1e6) / g;
    if (T - BOARD_TIMING.blurOffLead - tBlur > 16) {
      tl.call(() => sv.setBlur(true), [], s(tBlur));
      tl.call(() => sv.setBlur(false), [], s(T - BOARD_TIMING.blurOffLead));
    }
    let burst: Promise<void> = Promise.resolve();
    let land: Promise<void> = Promise.resolve();
    tl.call(() => {
      this.unelevate(old);
      this.dim(old, false, false);
      burst = old.explode();
    }, [], s(Math.max(0, T - E.anticipateDuration)));
    tl.call(() => {
      const p = slotPos(this.ctx.layout, c.reel, c.row);
      sv.setBlur(false);
      land = sv.land({ velocity: (g * T) / 1000, silent: true });
      this.ctx.game.broadcast('fx:shake', { trauma: BOARD_TIMING.transformTrauma });
      this.ctx.game.broadcast('fx:burst', { kind: 'dust', x: p.x, y: p.y + L.cell * 0.4, color: def.color, power: 0.9 });
      this.sfx(LAND_SFX[def.landWeight]);
    }, [], s(T));
    await this.play(tl);
    await Promise.all([burst, land]);
    if (gen !== this.gen) {
      this.release(sv);
      return;
    }
    this.release(old);
    this.slots[c.reel][c.row] = sv;
    this.boardIds[c.reel][c.row] = c.id;
    sv.view.zIndex = zOf(c.reel, c.row);
  }

  // =========================================================================
  // instant set
  // =========================================================================

  private setBoard(board: string[][]): void {
    this.gen++;
    this.killTimelines();
    this.clearPresentation(false);
    this.thump.reset();
    this.decorations.clear();
    this.holdReq = null;
    this.releaseHeld();
    for (let reel = 0; reel < GRID.reels; reel++) {
      for (let row = 0; row < GRID.paddedRows; row++) {
        const sv = this.slots[reel][row];
        gsap.killTweensOf(this.cellOf(sv));
        sv.reset();
        sv.setSymbol(board[reel][row]);
        this.put(sv, reel, row);
        sv.view.zIndex = zOf(reel, row);
        sv.view.visible = isVisibleRow(row);
      }
    }
    this.boardIds = cloneBoard(board);
    this.shown = true;
    this.fallOutPromise = null;
    this.fallOutTl = null;
    this.busy = 0;
    this.assertConsistent('set');
  }

  // =========================================================================
  // idle life
  // =========================================================================

  private scheduleIdle(): void {
    this.idleCall?.kill();
    const B = BOARD_TIMING;
    const ms = B.idleMin + this.rng() * (B.idleMax - B.idleMin);
    this.idleCall = gsap.delayedCall(sUi(ms), () => {
      this.idleTick();
      this.scheduleIdle();
    });
  }

  private idleTick(): void {
    if (this.roundActive || this.busy || !this.shown) return;
    const pick: SymbolView[] = [];
    this.forVisible((sv) => {
      if (getSymbolDef(sv.id).kind !== 'royal') pick.push(sv);
    });
    const count = Math.min(pick.length, this.rng() < 0.45 ? 2 : 1);
    for (let i = 0; i < count; i++) {
      const j = Math.floor(this.rng() * pick.length);
      pick.splice(j, 1)[0]?.idleAccent();
    }
  }

  // =========================================================================
  // feature hooks: bass reaction wave, focus dim
  // =========================================================================

  /**
   * board:react — every visible symbol plays its bass reaction with an onset of
   * min(capMs, perPxMs x distance from (x, y)) (design px, s()-scaled), so the wave visibly
   * travels across the board. Additive on the symbols (safe mid-land / mid-win).
   */
  private react({ x, y, perPxMs, capMs, power }: GameEvents['board:react']): void {
    const L = this.ctx.layout;
    const pw = power ?? 1;
    const tl = this.timeline();
    this.forVisible((sv) => {
      const c = this.cellOf(sv);
      const p = slotPos(L, c.reel, c.row);
      const delay = Math.max(0, Math.min(capMs, perPxMs * Math.hypot(p.x - x, p.y - y)));
      if (delay < 1) sv.react(pw);
      else tl.call(() => sv.react(pw), [], s(delay));
    });
    void this.play(tl);
  }

  /** board:focus — light dim of every visible symbol except `cells`; null restores all. */
  private setFocus(cells: Position[] | null, tint: number = BOARD_TIMING.focusTint): void {
    if (!cells) {
      if (!this.focus) return;
      this.focus = null;
      for (const col of this.slots) for (const sv of col) sv.setFocusDim(null);
      return;
    }
    const keep = new Set(cells.map((c) => cellKey(c.reel, c.row)));
    this.focus = { keep, tint };
    this.forVisible((sv, reel, row) => sv.setFocusDim(keep.has(cellKey(reel, row)) ? null : tint));
  }

  /** Physics / distance scale of the current layout: k = pitch / BOARD_TIMING.physRefPitch. */
  private physK(): number {
    return pitchOf(this.ctx.layout) / BOARD_TIMING.physRefPitch;
  }

  // =========================================================================
  // helpers
  // =========================================================================

  /** Deterministic idle board shown before the first round (no scatters). */
  private attractBoard(): BoardIds {
    const ids = Object.keys(SYMBOLS).filter((id) => !isScatter(id) && getSymbolDef(id).kind !== 'wild');
    const rnd = mulberry32(0xb0a4d);
    return Array.from({ length: GRID.reels }, () =>
      Array.from({ length: GRID.paddedRows }, () => ids[Math.floor(rnd() * ids.length)]),
    );
  }

  /** Padding rows (above / below the visible grid) exist only to slide into view; hidden at rest. */
  private hidePadding(): void {
    for (const col of this.slots) {
      col.forEach((sv, row) => {
        if (!isVisibleRow(row)) sv.view.visible = false;
      });
    }
  }

  private forVisible(fn: (sv: SymbolView, reel: number, row: number) => void): void {
    for (let reel = 0; reel < GRID.reels; reel++) {
      for (let row = GRID.firstVisibleRow; row <= GRID.lastVisibleRow; row++) fn(this.slots[reel][row], reel, row);
    }
  }

  private sfx(id: SfxId, extra: { volume?: number; rate?: number } = {}): void {
    this.ctx.game.broadcast('sfx', { id, ...extra });
  }

  private elevate(sv: SymbolView): void {
    if (this.elevated.has(sv)) return;
    this.elevated.add(sv);
    sv.setElevated(true);
  }

  private unelevate(sv: SymbolView): void {
    if (this.elevated.delete(sv)) sv.setElevated(false);
  }

  private dim(sv: SymbolView, on: boolean, animate = true): void {
    if (on) {
      if (this.dimmed.has(sv)) return;
      this.dimmed.add(sv);
      sv.setDim(true, animate);
    } else if (this.dimmed.delete(sv)) {
      sv.setDim(false, animate);
    }
  }

  /** Drop every presentation state (dim, focus, elevation, anticipation, outlines, beams). */
  private clearPresentation(animate: boolean): void {
    this.setFocus(null);
    this.beam.stop();
    this.outlines.clear();
    this.spots.clearHighlights(animate);
    for (let r = 0; r < GRID.reels; r++) this.spots.setColumnWash(r, 0xffffff, 0, 0);
    for (const sv of this.anticipating) sv.setAnticipation(false);
    this.anticipating.clear();
    for (const sv of [...this.dimmed]) this.dim(sv, false, animate);
    for (const sv of [...this.elevated]) this.unelevate(sv);
    for (const col of this.slots) for (const sv of col) if (sv.state === 'postWin') sv.reset();
  }

  private acquire(id: string): SymbolView {
    let sv = this.pool.pop();
    if (!sv) {
      // Pool exhausted (malformed book): grow once rather than fail the round.
      sv = createSymbolView(this.ctx, id);
      this.root.addChild(sv.view);
    }
    sv.reset();
    sv.setSymbol(id);
    sv.view.visible = true;
    return sv;
  }

  private release(sv: SymbolView): void {
    this.decorations.detach(sv);
    this.held.delete(sv);
    this.unelevate(sv);
    this.dim(sv, false, false);
    if (this.anticipating.delete(sv)) sv.setAnticipation(false);
    gsap.killTweensOf(this.cellOf(sv));
    sv.reset();
    sv.view.visible = false;
    this.pool.push(sv);
  }

  /** A board timeline: tracked for kill, retimed by a mid-round speed change. */
  private timeline(): gsap.core.Timeline {
    const tl = followSpeed(gsap.timeline());
    this.timelines.add(tl);
    return tl;
  }

  /** Resolves when the timeline completes or is killed (never hangs a round). */
  private play(tl: gsap.core.Timeline): Promise<void> {
    return new Promise<void>((resolve) => {
      const done = () => {
        this.timelines.delete(tl);
        resolve();
      };
      if (tl.duration() === 0) {
        tl.kill();
        done();
        return;
      }
      tl.eventCallback('onComplete', done);
      tl.eventCallback('onInterrupt', done);
    });
  }

  private killTimelines(): void {
    for (const tl of [...this.timelines]) tl.kill();
    this.timelines.clear();
  }

  private done(): void {
    this.busy = Math.max(0, this.busy - 1);
  }

  private cellOf(sv: SymbolView): Cell {
    let c = this.cells.get(sv);
    if (!c) {
      c = { reel: 0, row: 0 };
      this.cells.set(sv, c);
    }
    return c;
  }

  /** Draw a view at its logical cell in the CURRENT layout. */
  private place(sv: SymbolView): void {
    const c = this.cellOf(sv);
    const p = slotPos(this.ctx.layout, c.reel, c.row);
    sv.view.position.set(p.x, p.y);
  }

  /** Move a view to (reel, padded row; fractional rows sit between cells). */
  private put(sv: SymbolView, reel: number, row: number): void {
    const c = this.cellOf(sv);
    c.reel = reel;
    c.row = row;
    this.place(sv);
  }

  /** Tween a view's logical row (duration/at in seconds, as tl.to); drawn from ctx.layout every frame. */
  private tweenRow(
    tl: gsap.core.Timeline,
    sv: SymbolView,
    row: number,
    duration: number,
    ease: string,
    at: number,
  ): void {
    tl.to(this.cellOf(sv), { row, duration, ease, onUpdate: () => this.place(sv) }, at);
  }

  /** DEV: views <-> boardIds <-> positions must agree after every tumble. */
  private assertConsistent(where: string): void {
    if (!import.meta.env.DEV) return;
    const L = this.ctx.layout;
    const seen = new Set<SymbolView>();
    for (let reel = 0; reel < GRID.reels; reel++) {
      for (let row = 0; row < GRID.paddedRows; row++) {
        const sv = this.slots[reel][row];
        const at = `[board] ${where}: slot ${reel},${row}`;
        if (seen.has(sv)) throw new Error(`${at} reuses a view`);
        seen.add(sv);
        if (sv.id !== this.boardIds[reel][row]) throw new Error(`${at} shows ${sv.id}, model has ${this.boardIds[reel][row]}`);
        if (sv.view.visible !== isVisibleRow(row)) throw new Error(`${at} visibility is wrong`);
        const p = slotPos(L, reel, row);
        if (Math.abs(sv.view.x - p.x) > 0.5 || Math.abs(sv.view.y - p.y) > 0.5) throw new Error(`${at} is off its cell`);
      }
    }
    for (const sv of this.pool) if (seen.has(sv)) throw new Error(`[board] ${where}: pooled view is on the board`);
  }

  /** DEV/QA read-out of the model (used by demo.ts to verify against the book). */
  get ids(): BoardIds {
    return cloneBoard(this.boardIds);
  }
}
