import { gsap } from 'gsap';
import { Container } from 'pixi.js';
import { mulberry32 } from '../../../board/model';
import type { ClusterWin } from '../../../book/types';
import type { LayoutSpec } from '../../../config/layout';
import { clock } from '../../../core/clock';
import { followSpeed, getSpeedProfile, s } from '../../../core/timing';
import type { GameContext, GameModule } from '../../../game/context';
import type { GameEvents } from '../../../game/events';
import { GROOVE } from '../config';
import type { GrooveFeature, MeterMode } from '../events';
import { BASS_DROP_TIMING, PINK } from '../timing';
import { MeterArt } from './art';
import { Beats } from './beats';
import { Chip } from './Chip';
import { boomBeat, thresholdBurst, triggerPump } from './choreo';
import { MeterFx } from './effects';
import { ensureMeterFonts } from './fonts';
import { METER_LOOK as LOOK, R_REF, type RigLayout, polar, rigLayout } from './geometry';
import { deriveLook } from './look';
import { MeterRig } from './MeterRig';
import { type OrbMode, type PlanCell, cellKey, orbsFor, planStep } from './plan';

const T = BASS_DROP_TIMING;
const M = T.meter;
const MAX = GROOVE.displayMax;
const CHAINED_FLOOR = 0.06;

/** A meter:update waiting for the board:tumble that launches its orbs. */
interface Armed {
  value: number;
  delta: number;
  thresholds: number[];
  clusters: readonly ClusterWin[];
  seed: number;
}

/** The orbs of one tumble step; board:tumble awaits `resolve` (last arrival). */
interface StepRun {
  seed: number;
  remaining: Map<string, PlanCell>;
  inFlight: number;
  batch: number;
  first: boolean;
  safety: gsap.core.Tween | null;
  resolve: () => void;
  done: boolean;
}

interface PendingBurst {
  threshold: number;
  /** false: no drop follows (win cap / step end), so no armed strobe */
  strobe: boolean;
}

/**
 * GROOVE METER (DESIGN.md §6; meter beats of §8.1 / §8.4 / §10.1): the upper speaker cabinet
 * with the woofer gauge left of the reels (portrait: top centre; compact: bare ring), its
 * 60-tick LED arc, live counter, six notch badges and the next-drop chip (which carries the
 * free-spin plate in portrait / compact), plus the energy orbs that carry every exploded
 * symbol into it.
 *
 * Scene contract:
 *  - 'meter:update'  arms the step (resolves at once; delta 0 = silent set, CR-2);
 *  - 'board:tumble'  returns a promise that resolves at the LAST orb arrival. Orbs launch on
 *                    the Board's 'board:burst' (explode-burst frame), BFS-ordered from each
 *                    cluster's overlay cell; if no burst arrives within LOOK.burstSafety game
 *                    ms (s()-scaled) the rest launch from the tumble positions anyway;
 *  - arrivals roll the counter +1 each (comets roll their share), light the LED tick,
 *    punch, tick the cone and climb the orb_absorb pitch; thresholds burst on the notch
 *    (minor / major with shake, flash, hit-stop, SFX, mascot cues) and stay armed until
 *    their 'wild:drop' (charge -> boom beats on the meter, never holding the drop);
 *  - no tumble after an update (win cap): 'win:set' / 'round:end' / 'board:reveal' snap it;
 *  - 'feature:trigger' plays the three pumps and drains behind the wipe; 'feature:upgrade'
 *    drains behind the upgrade screen; 'round:start' drains in the base game (400 ms);
 *  - 'meter:set' (resume / replay) is instant.
 * Other modules are never called: everything goes through ctx.game.
 */
export class GrooveMeter implements GameModule {
  private art!: MeterArt;
  private rig!: MeterRig;
  private chip!: Chip;
  private fx!: MeterFx;
  private geo!: RigLayout;
  private readonly body = new Container({ label: 'grooveMeter' });
  private offs: Array<() => void> = [];
  /** charge -> boom beats of the drops / trigger pumps + the feature drains and skin swaps */
  private readonly dropBeats = new Beats();
  private readonly featureBeats = new Beats();

  // ---- model
  private mode: MeterMode = 'base';
  /** book value (meter:update.value) */
  private value = 0;
  /** displayed counter / arrivals credited so far (the counter rolls toward it) */
  private shown = 0;
  private credited = 0;
  private rollRate = 0;
  private rollAcc = 0;
  private drainTween: gsap.core.Tween | null = null;
  private armed: Armed | null = null;
  private run: StepRun | null = null;
  private pendingBursts: PendingBurst[] = [];
  /** thresholds that burst and wait for their wild:drop */
  private readonly armedNotches = new Set<number>();
  private charging: number | null = null;
  private clusters: readonly ClusterWin[] = [];
  private readonly homes = new Set<string>();
  private fsFeature: GrooveFeature | null = null;
  private fs: { current: number; total: number } | null = null;
  private lapMode = false;
  private heat = false;
  private revealed = false;
  private stepSeq = 0;
  // ---- throttles (game ms)
  private now = 0;
  private absorbN = 0;
  private lastAbsorb = -1e9;
  private lastPunch = -1e9;
  private lastTick = -1e9;
  private sparkAcc = 0;
  private readonly idleRng = mulberry32(0x60f7);

  constructor(private readonly ctx: GameContext) {}

  init(): void {
    const { ctx } = this;
    ensureMeterFonts(ctx.app.renderer);
    this.art = new MeterArt(ctx.app.renderer);
    this.geo = rigLayout(ctx.layout);
    this.rig = new MeterRig(this.art, this.art.build(this.geo.cabinet, this.bakeRes()));
    this.body.addChild(this.rig.view);
    // under the frame (the portrait cabinet base hides behind the beam); the chip rides above it
    ctx.layers.panel.addChildAt(this.body, 0);
    const icons = this.art.icons;
    this.chip = new Chip(icons);
    ctx.layers.logo.addChild(this.chip.view);
    this.fx = new MeterFx(ctx, icons.orbCore, icons.orbHalo, icons.wave, icons.puff);
    ctx.layers.logo.addChild(this.fx.view);
    ctx.layers.winLayer.attach(this.fx.view);
    this.layout(ctx.layout);
    this.rig.led.fillTo(0, 0);
    this.refresh();

    const g = ctx.game;
    this.offs.push(
      g.on('layout:change', ({ layout }) => this.layout(layout)),
      g.on('round:start', () => this.onRoundStart()),
      g.on('round:end', () => this.onRoundEnd()),
      g.on('board:reveal', () => this.onReveal()),
      g.on('board:set', () => this.onBoardSet()),
      g.on('board:showWins', ({ wins }) => void (this.clusters = wins)),
      g.on('meter:update', (p) => this.onMeterUpdate(p)),
      g.on('board:tumble', (p) => this.onTumble(p)),
      g.on('board:burst', ({ positions }) => this.onBurst(positions)),
      g.on('win:set', () => this.finishNoTumble()),
      g.on('wild:drop', (p) => this.onWildDrop(p)),
      g.on('wild:sticky', ({ wilds }) => this.onSticky(wilds)),
      g.on('feature:trigger', (p) => this.onFeatureTrigger(p)),
      g.on('feature:upgrade', (p) => this.onFeatureUpgrade(p)),
      g.on('fs:update', ({ current, total }) => {
        this.fs = { current, total };
        this.refresh();
      }),
      g.on('mode:change', ({ gameType }) => this.onModeChange(gameType)),
      g.on('meter:set', (p) => this.onMeterSet(p)),
      g.on('bigwin:show', () => this.rig.pump()),
      g.on('sfx', ({ id }) => {
        if (id === 'bigwin_tier') this.rig.pump(LOOK.pumpScale + 0.04);
      }),
      clock.onUpdate((dt) => this.update(dt)),
    );
  }

  private bakeRes(): number {
    const r = this.ctx.scale * this.ctx.app.renderer.resolution * (this.geo?.scale ?? 1);
    return Math.min(2, Math.max(0.5, Math.ceil(r * 4) / 4));
  }

  layout(L: LayoutSpec): void {
    this.geo = rigLayout(L);
    this.rig.layout(this.geo, this.art.build(this.geo.cabinet, this.bakeRes()));
    this.chip.layout(this.geo.chip);
    this.refresh();
  }

  destroy(): void {
    for (const off of this.offs) off();
    this.offs = [];
    this.dropBeats.cancel();
    this.featureBeats.cancel();
    this.drainTween?.kill();
    this.endRun();
    this.ctx.layers.winLayer.detach(this.fx.view);
    if (this.rig.counter.view.parentRenderLayer) this.ctx.layers.winLayer.detach(this.rig.counter.view);
    this.fx.destroy();
    this.chip.destroy();
    this.rig.destroy();
    this.body.destroy({ children: true });
    this.art.destroy();
  }

  // ======================================================================= round flow

  private onRoundStart(): void {
    this.dropBeats.cancel();
    this.featureBeats.flush();
    this.endRun();
    this.armed = null;
    this.pendingBursts = [];
    this.armedNotches.clear();
    this.charging = null;
    this.clusters = [];
    this.revealed = false;
    this.stepSeq = 0;
    // stateless rounds: the base meter drains at every spin (DESIGN §6.5); never between free spins
    if (this.mode === 'base') this.drain(this.shown > 0);
    else this.refresh();
  }

  private onRoundEnd(): void {
    this.finishNoTumble();
    this.endRun();
    this.featureBeats.flush();
    this.armedNotches.clear();
    this.charging = null;
    this.refresh();
  }

  private onReveal(): void {
    this.finishNoTumble();
    this.featureBeats.flush();
    this.revealed = true;
    this.clusters = [];
  }

  private onBoardSet(): void {
    this.endRun();
    this.armed = null;
    this.pendingBursts = [];
    this.rollRate = 0;
    this.shown = this.credited = this.value;
    this.rig.rest();
    this.rig.led.fillTo(this.ringLevel(this.shown), 0);
    this.refresh();
  }

  private onModeChange(gameType: GameEvents['mode:change']['gameType']): void {
    // freegame: the trigger beats keep their schedule (the first free-spin reveal flushes them)
    if (gameType === 'freegame') return;
    // feature over (outro): skin back to base, value silently 0 (DESIGN §10.5)
    this.featureBeats.cancel();
    this.cancelDrain();
    this.mode = 'base';
    this.fsFeature = null;
    this.fs = null;
    this.homes.clear();
    this.lapMode = false;
    this.armedNotches.clear();
    this.setSilently(0);
  }

  private onMeterSet(p: GameEvents['meter:set']): void {
    this.endRun();
    this.cancelDrain();
    this.featureBeats.cancel();
    this.armed = null;
    this.pendingBursts = [];
    this.armedNotches.clear();
    this.charging = null;
    this.mode = p.mode;
    this.fsFeature = p.mode === 'base' ? null : p.mode;
    this.lapMode = false;
    this.rig.rest();
    if (p.animate) {
      this.value = p.value;
      this.rollTo(p.value, s(M.drain));
    } else this.setSilently(p.value);
  }

  // ======================================================================= arm + orbs

  private onMeterUpdate(p: GameEvents['meter:update']): void {
    if (p.delta <= 0) {
      this.setSilently(p.value);
      return;
    }
    if (this.armed) this.finishNoTumble();
    this.cancelDrain();
    this.raiseCounter();
    const thresholds = [...p.thresholds].sort((a, b) => a - b);
    if (thresholds.some((t) => t > MAX)) this.lapMode = true;
    const seed = (Math.imul(++this.stepSeq, 0x9e3779b1) ^ Math.imul(p.value, 0x85ebca6b) ^ Math.imul(p.delta, 0xc2b2ae35)) >>> 0;
    this.armed = { value: p.value, delta: p.delta, thresholds, clusters: this.clusters, seed };
    this.value = p.value;
  }

  private onTumble(p: GameEvents['board:tumble']): Promise<void> | undefined {
    const a = this.armed;
    if (!a) return undefined;
    this.armed = null;
    this.endRun();
    this.queueBursts(a.thresholds, true);
    const cells = planStep(p.exploding, a.clusters, a.delta);
    if (!cells.length) {
      this.rollTo(a.value, s(M.fillTween));
      return undefined;
    }
    this.fx.seed(a.seed);
    return new Promise<void>((resolve) => {
      const run: StepRun = {
        seed: a.seed,
        remaining: new Map(cells.map((c) => [cellKey(c), c])),
        inFlight: 0,
        batch: 0,
        first: true,
        safety: null,
        resolve,
        done: false,
      };
      run.safety = followSpeed(gsap.delayedCall(s(LOOK.burstSafety), () => this.launch(run, [...run.remaining.values()])));
      this.run = run;
    });
  }

  private onBurst(positions: GameEvents['board:burst']['positions']): void {
    const run = this.run;
    if (!run || run.done) return;
    const cells: PlanCell[] = [];
    for (const pos of positions) {
      const c = run.remaining.get(cellKey(pos));
      if (c) cells.push(c);
    }
    this.launch(run, cells);
  }

  private launch(run: StepRun, cells: PlanCell[]): void {
    if (run.done || !cells.length) return;
    for (const c of cells) run.remaining.delete(cellKey(c));
    if (!run.remaining.size) {
      run.safety?.kill();
      run.safety = null;
    }
    cells.sort((a, b) => a.delayMs - b.delayMs);
    const profile = getSpeedProfile();
    const mode: OrbMode = profile === 'superTurbo' ? 'comets' : profile === 'turbo' ? 'turbo' : 'normal';
    const seed = (run.seed + Math.imul(++run.batch, 7919)) >>> 0;
    const list = orbsFor(cells, mode, mulberry32(seed));
    if (run.first && list.length) {
      run.first = false;
      this.absorbN = 0;
      this.fx.sfx('orb_launch');
    }
    run.inFlight++;
    this.fx.orbs.launch(
      list,
      seed,
      (count, comet) => this.arrive(count, comet),
      () => {
        run.inFlight--;
        this.checkRun(run);
      },
    );
  }

  private checkRun(run: StepRun): void {
    if (run.done || run.remaining.size > 0 || run.inFlight > 0) return;
    run.done = true;
    if (this.run === run) this.run = null;
    // reconcile: the counter always ends on meter:update.value (the orb count may differ)
    if (this.credited !== this.value) this.rollTo(this.value, s(M.fillTween));
    run.resolve();
  }

  /** Hard stop of the current step (board:set, resume, round end, destroy): never leaves a hanging promise. */
  private endRun(): void {
    const run = this.run;
    this.run = null;
    this.fx?.orbs.clear();
    if (!run || run.done) return;
    run.done = true;
    run.safety?.kill();
    if (this.credited !== this.value) this.rollTo(this.value, s(M.fillTween));
    run.resolve();
  }

  /** One orb (or comet) landed in the dust cap. */
  private arrive(count: number, comet: boolean): void {
    this.credited += count;
    const n = this.absorbN++;
    if (this.now - this.lastAbsorb >= 35) {
      this.lastAbsorb = this.now;
      this.fx.sfx('orb_absorb', 2 ** (Math.min(n, 12) / 12));
    }
    if (this.now - this.lastTick >= s(M.pumpMinGap) * 1000) {
      this.lastTick = this.now;
      this.rig.tick();
    }
    if (comet) this.rollTo(this.credited, s(T.orbs.cometRoll));
    else if (this.rollRate <= 0) this.stepToCredited();
  }

  /**
   * No tumble followed the update (win cap, [M-9]): no orbs. Snap the counter + LEDs to the
   * value over 120 ms, burst the listed thresholds without the armed strobe (DESIGN §6.3 step 10).
   */
  private finishNoTumble(): void {
    const a = this.armed;
    if (!a) return;
    this.armed = null;
    this.queueBursts(a.thresholds, false);
    this.rollTo(a.value, s(M.fillTween));
    this.fireBursts();
  }

  // ======================================================================= counter roll

  private rollTo(target: number, sec: number): void {
    this.credited = target;
    const d = Math.abs(target - this.shown);
    if (d === 0) return;
    this.rollRate = Math.max(this.rollRate, d / Math.max(sec, 1e-3));
  }

  private stepToCredited(): void {
    while (this.shown !== this.credited) {
      const up = this.shown < this.credited;
      this.shown += up ? 1 : -1;
      this.onStep(up);
    }
  }

  private roll(dt: number): void {
    if (this.rollRate <= 0) return;
    this.rollAcc += this.rollRate * dt;
    while (this.rollAcc >= 1 && this.shown !== this.credited) {
      this.rollAcc -= 1;
      const up = this.shown < this.credited;
      this.shown += up ? 1 : -1;
      this.onStep(up);
    }
    if (this.shown === this.credited) {
      this.rollRate = 0;
      this.rollAcc = 0;
    }
  }

  /** LED ring level of a counter value (fallback laps show value mod 60). */
  private ringLevel(v: number): number {
    return this.lapMode ? v % MAX : Math.min(v, MAX);
  }

  /** The displayed counter moved by one. */
  private onStep(up: boolean): void {
    const v = this.shown;
    const lvl = this.ringLevel(v);
    if (up) {
      if (lvl > 0) this.rig.led.flare(lvl);
      if (this.now - this.lastPunch >= s(M.punchMinGap) * 1000) {
        this.lastPunch = this.now;
        this.rig.counter.punch(M.punchScale, s(M.punch));
      }
      if (this.lapMode && v > 0 && v % MAX === 0) this.lap();
    }
    this.rig.led.fillTo(lvl, up ? s(M.fillTween) : 0);
    // look first (a heat that ends here releases the mascots' lean-in BEFORE the notch's own
    // cue, which the release would otherwise cancel), then the bursts and their state
    this.refresh();
    if (this.fireBursts()) this.refresh();
  }

  /** Fallback lap (a threshold above 60 was listed): pink ring flash, LEDs empty, a lap pip (DESIGN §6.7). */
  private lap(): void {
    this.rig.led.sweep(PINK, s(M.lapFlash), 1);
    this.rig.led.fillTo(0, s(M.lapEmpty));
    this.fx.sfx('meter_lap');
  }

  private setSilently(v: number): void {
    this.cancelDrain();
    this.rollRate = 0;
    this.rollAcc = 0;
    this.value = this.credited = this.shown = v;
    this.rig.led.fillTo(this.ringLevel(v), 0);
    this.refresh();
  }

  /** Drain to 0 (DESIGN §6.5): LEDs off from the head back, counter rolls down, 400 ms power2.in. */
  private drain(withSfx: boolean): void {
    this.cancelDrain();
    const from = this.shown;
    const sec = s(M.drain);
    this.value = this.credited = 0;
    this.rollRate = 0;
    this.rollAcc = 0;
    this.armedNotches.clear();
    this.rig.drain(sec);
    if (withSfx) this.fx.sfx('meter_drain');
    if (from <= 0) {
      this.shown = 0;
      this.lapMode = false;
      this.refresh();
      return;
    }
    const proxy = { v: from };
    this.drainTween = followSpeed(
      gsap.to(proxy, {
        v: 0,
        duration: sec,
        ease: 'power2.in',
        onUpdate: () => {
          const n = Math.ceil(proxy.v - 1e-6);
          if (n === this.shown) return;
          this.shown = n;
          this.rig.led.fillTo(this.ringLevel(n), 0);
          this.refresh();
        },
        onComplete: () => {
          this.drainTween = null;
          this.shown = 0;
          this.lapMode = false;
          this.refresh();
        },
      }),
    );
  }

  private cancelDrain(): void {
    if (!this.drainTween) return;
    this.drainTween.kill();
    this.drainTween = null;
    this.shown = this.credited;
    this.lapMode = this.lapMode && this.shown > 0;
  }

  // ======================================================================= thresholds

  private queueBursts(thresholds: readonly number[], strobe: boolean): void {
    for (const t of thresholds) {
      if (this.pendingBursts.some((p) => p.threshold === t) || this.armedNotches.has(t)) continue;
      this.pendingBursts.push({ threshold: t, strobe });
    }
    this.pendingBursts.sort((a, b) => a.threshold - b.threshold);
  }

  /** Burst every queued threshold the counter has reached; true when one fired. */
  private fireBursts(): boolean {
    let fired = false;
    while (this.pendingBursts.length && this.pendingBursts[0].threshold <= this.shown) {
      this.burst(this.pendingBursts.shift() as PendingBurst);
      fired = true;
    }
    return fired;
  }

  private burst(pb: PendingBurst): void {
    thresholdBurst(this.rig, this.fx, this.geo, this.mode, pb.threshold);
    if (pb.strobe) this.armedNotches.add(pb.threshold);
  }

  // ======================================================================= bass drop beats

  /**
   * The meter side of a bass drop (DESIGN §8.1 / §8.4), timed from BASS_DROP_TIMING like the
   * BassDrop module: charge at t = 0 (first of a step floored at drop.chargeFloor, chained
   * 200 ms floored at 60), boom at t = charge. Shake / flash / hit-stop / shockwave / SFX of the
   * boom belong to BassDrop. Resolves immediately (never holds the drop).
   */
  private onWildDrop(p: GameEvents['wild:drop']): void {
    for (const w of p.wilds) if (w.sticky) this.homes.add(cellKey(w));
    const D = T.drop;
    const first = p.chainIndex <= 0;
    const sec = first ? Math.max(s(D.charge), D.chargeFloor / 1000) : Math.max(s(D.chargeChained), CHAINED_FLOOR);
    this.charging = p.threshold;
    this.raiseCounter();
    this.rig.charge(sec, !first);
    this.refresh();
    this.dropBeats.at(sec, () => this.boom(p.threshold));
  }

  /**
   * DESIGN §8.2 launch layering: the wild pops out of the woofer on winLayer, which draws above
   * the whole meter; the live counter joins winLayer after it (render order only, it keeps its
   * rig transform), so neither the launching wild nor the arriving orbs ever cover the digits.
   * Checked on every arm and drop (modules that attach later, e.g. BassDrop's flights, stay under).
   */
  private raiseCounter(): void {
    const layer = this.ctx.layers.winLayer;
    const view = this.rig.counter.view;
    const list = layer.renderLayerChildren;
    if (list[list.length - 1] === view) return;
    if (view.parentRenderLayer === layer) layer.detach(view);
    layer.attach(view);
  }

  private boom(threshold: number): void {
    boomBeat(this.rig, this.fx, this.geo);
    this.armedNotches.delete(threshold);
    if (this.charging === threshold) this.charging = null;
    this.refresh();
  }

  private onSticky(wilds: GameEvents['wild:sticky']['wilds']): void {
    this.homes.clear();
    for (const w of wilds) this.homes.add(cellKey(w));
    this.refresh();
  }

  // ======================================================================= features

  /**
   * Feature trigger (DESIGN §10.1): three pumps on the beat grid at triggerHold + i x pumpGap
   * (trauma 0.2 / 0.3 / 0.6; the last flashes, hit-stops and plays fs_trigger), then the drain
   * + skin swap behind the wipe. A book that starts with featureTrigger (no base reveal) skips
   * the pumps. Resolves immediately: FeatureScreens owns the timeline.
   */
  private onFeatureTrigger(p: GameEvents['feature:trigger']): void {
    this.featureBeats.cancel();
    // the merged FS line (portrait / compact) reads "JUKE JAM 0/8" from the feature start on
    this.fs = { current: 0, total: p.totalFs };
    if (!this.revealed) {
      this.enterFeature(p.feature);
      return;
    }
    const F = T.feature;
    for (let i = 0; i < 3; i++) this.featureBeats.at(s(F.triggerHold + i * F.pumpGap), () => this.triggerPump(i, p.feature), true);
    this.featureBeats.at(s(F.triggerTotal + LOOK.wipeCover), () => this.enterFeature(p.feature));
  }

  private triggerPump(i: number, feature: GrooveFeature): void {
    triggerPump(this.rig, this.fx, this.geo, i, feature, (x, y, color) =>
      this.ctx.game.broadcast('fx:burst', { kind: 'explode', x, y, color, power: 1 }),
    );
  }

  private enterFeature(feature: GrooveFeature): void {
    this.drain(false);
    this.mode = feature;
    this.fsFeature = feature;
    this.homes.clear();
    this.refresh();
  }

  /** Juke Jam -> Mega Mix (DESIGN §10.4): drain + megamix skin behind the upgrade screen. Resolves at once. */
  private onFeatureUpgrade(p: GameEvents['feature:upgrade']): void {
    this.featureBeats.cancel();
    const upgradedTotal = (this.fs?.total ?? 0) + p.addFs;
    this.featureBeats.at(s(LOOK.upgradeDrainAt), () => this.drain(false));
    this.featureBeats.at(s(LOOK.upgradeSkinAt), () => {
      this.mode = 'super';
      this.fsFeature = 'super';
      // the plate retitles and its total jumps (+4); the next updateFreeSpin confirms it
      if (this.fs) this.fs = { current: this.fs.current, total: Math.max(this.fs.total, upgradedTotal) };
      this.homes.clear();
      this.lapMode = false;
      this.rig.pump(1.12);
      this.refresh();
    });
  }

  // ======================================================================= state -> look

  /** Re-derive the whole look from the model (cheap; called on every counter step and state change). */
  private refresh(): void {
    if (!this.rig) return;
    const look = deriveLook({
      mode: this.mode,
      shown: this.shown,
      lapMode: this.lapMode,
      armed: this.armedNotches,
      charging: this.charging,
      homes: this.homes.size,
      chipHasFs: this.geo.chipHasFs,
      fsFeature: this.fsFeature,
      fs: this.fs,
    });
    const rig = this.rig;
    rig.led.setLevel(look.level, look.hot);
    rig.counter.set(look.count, look.max, look.laps);
    rig.setTrim(look.trim);
    rig.setGlowLevel(look.glow);
    rig.play(look.loop);
    if (look.heat && !this.heat) {
      this.fx.cue('meterHeat', 1);
      this.fx.sfx('meter_heat');
    } else if (!look.heat && this.heat && !this.drainTween && this.shown > 0) {
      // heat over while counting (locked at 40 / 60): the mascots' held lean-in ends here
      // (a drain back to 0 at the next spin needs no cue: the round start resets them)
      this.fx.cue('meterHeat', 0);
    }
    this.heat = look.heat;
    rig.notches.badges.forEach((b, i) => {
      const n = look.notches[i];
      b.configure(n.state, n.armed, n.solid, n.pulse);
    });
    this.chip.set(look.chip);
  }

  // ======================================================================= frame

  private update(dt: number): void {
    this.now += dt * 1000;
    this.roll(dt);
    const beat = LOOK.beatMs[this.mode];
    this.rig.update(dt, beat);
    // overdrive crackle: a few pink sparks off the rim (seeded, idle garnish)
    if (this.rig.currentLoop === 'overdrive_loop' && dt > 0) {
      this.sparkAcc += dt;
      if (this.sparkAcc > 0.16) {
        this.sparkAcc = 0;
        const g = this.geo;
        const p = polar(-150 + this.idleRng() * 300, R_REF * 0.95);
        this.fx.sparks(g.cx + p.x * g.scale, g.cy + p.y * g.scale, g.k * 0.6, 2, PINK, 380, 0.5);
      }
    }
    this.fx.update(dt);
  }
}
