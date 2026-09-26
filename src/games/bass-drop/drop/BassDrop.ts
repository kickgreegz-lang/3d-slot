import { gsap } from 'gsap';
import { Container } from 'pixi.js';
import { slotPos } from '../../../board/model';
import type { LayoutSpec } from '../../../config/layout';
import { clock } from '../../../core/clock';
import { followSpeed, s } from '../../../core/timing';
import type { GameContext, GameModule } from '../../../game/context';
import type { GameEvents } from '../../../game/events';
import { BASS_DROP_TIMING } from '../timing';
import { DropArt } from './art';
import { Reticle } from './decor';
import { type DropHost, DropRun } from './DropRun';
import { DropFx } from './fx';
import { MultSumDirector } from './multSum';
import { WildRegistry } from './registry';
import { StickyDirector } from './sticky';
import { WildProxy } from './WildProxy';

/** Proxies / reticles created up front (a drop carries at most 3 wilds). */
const PREWARM = 3;
/** grace before the drop's focus dim lifts (a chained drop starting in between keeps it) */
const FOCUS_GRACE = 60;

/**
 * BASS DROP — everything the wilds do (DESIGN.md §7 step 6, §8, §9):
 *  - 'wild:drop'     the drop choreography (DropRun): charge, boom (shockwave, board wave,
 *                    shake, hit-stop, flash, SFX, mascot cues), target reticles + landing
 *                    shadows, flying proxies on winLayer, the 'impact' handoff to the Board,
 *                    contact feedback; resolves settle ms after the last contact;
 *  - multiplier badges ('board:decorate' key 'mult') and sticky clamps (key 'clamp') on the
 *    landed W views, tracked by cell through tumbles (WildRegistry, SDK tumble rule);
 *  - 'board:showWins' the label multiplier sums (MultSumDirector, FEATURES.wildMultSum
 *                    'external') and the Mega Mix "+1" previews;
 *  - 'wild:sticky'   Mega Mix homes: markers on the tiles, returns, mult_up, the x25 shimmer,
 *                    and the board:hold set before every free-spin reveal (StickyDirector).
 * The Groove Meter plays its own charge / boom / rings from the same BASS_DROP_TIMING beats.
 *
 * Layers: home markers on `tiles`; reticles + shadows on `board` above the masked symbols
 * (below the frame); flights, trails and impact FX on a `winLayer`-attached holder (they cross
 * the frame); label-sum clones, their arrival sparks and the "+1" pops on `overlay`, above the
 * cluster labels and the win-elevated symbols (which join winLayer after our holder).
 * A proxy hides on the frame AFTER its contact beat: the Board places its W in the promise
 * continuation of its own anticipateDuration wait, i.e. one rendered frame later.
 * Speed: gameplay beats go through s() / followSpeed (slam-safe), hit-stops through the gated
 * clock.hitStop. Every promise it returns resolves on board:set / round start / destroy.
 */
export class BassDrop implements GameModule {
  private art!: DropArt;
  private fx!: DropFx;
  private registry!: WildRegistry;
  private sticky!: StickyDirector;
  private sums!: MultSumDirector;
  private readonly targets = new Container({ label: 'bassDropTargets' });
  private readonly flights = new Container({ label: 'bassDropFlights' });
  private readonly trails = new Container({ label: 'bassDropTrails' });
  private readonly bodies = new Container({ label: 'bassDropProxies' });
  private readonly proxies: WildProxy[] = [];
  private readonly reticles: Reticle[] = [];
  private readonly runs = new Set<DropRun>();
  /** proxies to hide on the frame after their contact (+ the frame count when asked) */
  private readonly hiding: WildProxy[] = [];
  private readonly hideAt: number[] = [];
  private frame = 0;
  private focusCall: gsap.core.Tween | null = null;
  private focused = false;
  private offs: Array<() => void> = [];
  private host!: DropHost;

  constructor(private readonly ctx: GameContext) {}

  init(): void {
    const { ctx } = this;
    this.art = new DropArt(ctx.app.renderer);
    this.fx = new DropFx(ctx, this.art);
    this.registry = new WildRegistry(ctx, this.art, this.fx);
    this.sticky = new StickyDirector(ctx, this.fx, this.registry);
    this.sums = new MultSumDirector(ctx, this.art, this.registry);

    ctx.layers.tiles.addChild(this.registry.markerLayer);
    ctx.layers.board.addChild(this.targets);
    this.flights.addChild(this.trails, this.bodies, this.fx.view);
    ctx.layers.logo.addChild(this.flights);
    ctx.layers.winLayer.attach(this.flights);
    ctx.layers.overlay.addChild(this.sums.view);
    for (let i = 0; i < PREWARM; i++) {
      this.newProxy();
      this.newReticle();
    }

    const self = this;
    this.host = {
      ctx,
      fx: this.fx,
      registry: this.registry,
      acquireProxy: () => this.proxies.find((p) => !p.busy) ?? this.newProxy(),
      releaseProxy: (p) => {
        this.hiding.push(p);
        this.hideAt.push(this.frame);
      },
      acquireReticle: () => {
        const r = this.reticles.find((x) => !x.busy) ?? this.newReticle();
        r.busy = true;
        return r;
      },
      focusLater: () => self.focusLater(),
      cancelFocusRestore: () => self.cancelFocusRestore(),
    };

    const g = ctx.game;
    this.offs.push(
      g.on('layout:change', ({ layout }) => this.layout(layout)),
      g.on('round:start', () => this.onRoundStart()),
      g.on('round:end', () => this.restoreFocus()),
      g.on('board:reveal', ({ board }) => {
        this.restoreFocus();
        this.sticky.onReveal();
        this.registry.mirror(board);
      }),
      g.on('board:set', ({ board }) => this.onBoardSet(board)),
      g.on('board:tumble', ({ exploding, newSymbols }) => {
        this.restoreFocus();
        this.registry.tumble(exploding, newSymbols);
      }),
      g.on('board:transform', ({ cells, style }) => this.registry.transform(cells, style)),
      g.on('board:showWins', ({ wins }) => {
        this.restoreFocus();
        return this.sums.showWins(wins);
      }),
      g.on('wild:drop', (p) => this.drop(p)),
      g.on('wild:sticky', ({ wilds }) => this.sticky.reconcile(wilds)),
      g.on('fs:update', () => this.sticky.requestHold()),
      g.on('fs:end', () => this.sticky.release()),
      g.on('mode:change', ({ gameType }) => {
        if (gameType === 'basegame') this.sticky.endFeature();
      }),
      clock.onUpdate((dt) => this.tick(dt)),
    );
    this.layout(ctx.layout);
  }

  layout(L: LayoutSpec): void {
    this.registry.layout(L);
    this.sums.layout(L);
    for (const r of this.reticles) {
      if (!r.busy) continue;
      const p = slotPos(L, r.reel, r.row);
      r.fit(p.x, p.y, L.cell);
    }
  }

  // =========================================================================== drops

  private drop(p: GameEvents['wild:drop']): Promise<void> {
    const run = new DropRun(this.host, p);
    this.runs.add(run);
    run.start();
    return run.promise.then(() => void this.runs.delete(run));
  }

  private newProxy(): WildProxy {
    const p = new WildProxy(this.ctx, this.art);
    this.proxies.push(p);
    this.trails.addChild(p.trail);
    this.bodies.addChild(p.view);
    return p;
  }

  private newReticle(): Reticle {
    const r = new Reticle(this.art);
    this.reticles.push(r);
    this.targets.addChild(r);
    return r;
  }

  /** Per frame (game dt; 0 during a hit-stop): proxies, reticle spin, FX, sticky heartbeat. */
  private tick(dt: number): void {
    this.frame++;
    // a contact beat runs before this frame's tick: hide one frame later (placement frame)
    for (let i = this.hiding.length - 1; i >= 0; i--) {
      if (this.hideAt[i] > this.frame - 2) continue;
      this.hiding[i].end();
      this.hiding.splice(i, 1);
      this.hideAt.splice(i, 1);
    }
    for (const p of this.proxies) if (p.busy) p.update(dt);
    const spin = BASS_DROP_TIMING.drop.reticleSpin;
    for (const r of this.reticles) if (r.busy) r.spin(dt, spin);
    this.fx.update(dt);
    this.sums.update(dt);
    this.registry.heartbeat(clock.time * 1000);
  }

  // =========================================================================== focus dim

  /** Lift the drop's focus dim a moment later (a chained drop starting first keeps it on). */
  private focusLater(): void {
    this.focused = true;
    this.focusCall?.kill();
    this.focusCall = followSpeed(gsap.delayedCall(s(FOCUS_GRACE), () => this.restoreFocus()));
  }

  private cancelFocusRestore(): void {
    this.focusCall?.kill();
    this.focusCall = null;
    this.focused = true;
  }

  private restoreFocus(): void {
    this.focusCall?.kill();
    this.focusCall = null;
    if (!this.focused) return;
    this.focused = false;
    this.ctx.game.broadcast('board:focus', { cells: null });
  }

  // =========================================================================== lifecycle

  private abortRuns(): void {
    for (const r of [...this.runs]) r.abort();
    this.runs.clear();
  }

  private onRoundStart(): void {
    this.abortRuns();
    this.sums.abort();
    this.restoreFocus();
    this.sticky.reset();
    this.registry.sched.kill();
    this.registry.killAll(false);
    this.registry.clearHomes(0);
  }

  /** Resume / replay start / dev: no animation survives; the next wild:sticky restores instantly. */
  private onBoardSet(board: string[][]): void {
    this.abortRuns();
    this.sums.abort();
    this.focusCall?.kill();
    this.focusCall = null;
    this.focused = false;
    this.sticky.reset();
    this.registry.reset();
    this.registry.mirror(board);
    this.sticky.armInstant();
    this.fx.clear();
    this.hiding.length = 0;
    this.hideAt.length = 0;
    for (const p of this.proxies) p.end();
    for (const r of this.reticles) r.free();
  }

  destroy(): void {
    for (const off of this.offs) off();
    this.offs = [];
    this.abortRuns();
    this.focusCall?.kill();
    this.sums.destroy();
    this.sticky.reset();
    this.registry.destroy();
    for (const p of this.proxies) p.destroy();
    for (const r of this.reticles) r.destroy();
    this.fx.destroy();
    this.ctx.layers.winLayer.detach(this.flights);
    this.flights.destroy({ children: true });
    this.targets.destroy({ children: true });
    this.art.destroy();
  }
}
