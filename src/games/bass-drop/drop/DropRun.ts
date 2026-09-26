import { gsap } from 'gsap';
import { BOARD_TIMING } from '../../../board/boardTiming';
import { pitchOf, slotPos } from '../../../board/model';
import type { Rect } from '../../../config/layout';
import { FEATURES, GRID } from '../../../config/game';
import { clock } from '../../../core/clock';
import { TIMING, fallTime, s } from '../../../core/timing';
import { semitoneRate } from '../../../audio/mix';
import { pulseShockwave } from '../../../fx/filters/effects';
import { reducedMotion } from '../../../fx/motion';
import type { GameContext } from '../../../game/context';
import type { GameEvents } from '../../../game/events';
import type { DroppedWild } from '../events';
import { BASS_DROP_LAYOUT } from '../layout';
import { BASS_DROP_TIMING, GOLD, TEAL, multTier, physK } from '../timing';
import type { Reticle } from './decor';
import type { DropFx } from './fx';
import {
  type Arc,
  type Pt,
  arcAt,
  byCell,
  clamp01,
  dropArc,
  meterCentre,
  newArc,
  p2in,
  p2out,
  visibleRect,
} from './geometry';
import { DROP_LOOK as LOOK } from './look';
import type { WildRegistry } from './registry';
import { Sched } from './sched';
import type { WildProxy } from './WildProxy';

const T = BASS_DROP_TIMING;
const D = T.drop;
/** chained charge floor (s): DESIGN §18.1 "67 (floor 60)" */
const CHAINED_FLOOR = 0.06;

/** What a run borrows from the module (pools, layers, shared FX). */
export interface DropHost {
  readonly ctx: GameContext;
  readonly fx: DropFx;
  readonly registry: WildRegistry;
  acquireProxy(): WildProxy;
  /** contact: the proxy stays up this frame and hides on the next one (the Board's placement frame) */
  releaseProxy(p: WildProxy): void;
  /** launch layering: parent the proxy into the meter's fx_blast slot (meter:blastSlot); false if no meter took it */
  mountProxy(p: WildProxy): boolean;
  /** back to the winLayer holder (past the rim, contact, abort) */
  unmountProxy(p: WildProxy): void;
  /** hide now (abort / board:set): back on the holder, invisible, free */
  endProxy(p: WildProxy): void;
  acquireReticle(): Reticle;
  /** board:focus restore, deferred a frame so a chained drop does not flicker the dim */
  focusLater(): void;
  cancelFocusRestore(): void;
}

/** One flying wild of the run. */
interface Flight {
  wild: DroppedWild;
  index: number;
  tint: number;
  proxy: WildProxy | null;
  reticle: Reticle;
  arc: Arc;
  /** flight progress 0..1 (linear in time: a quadratic Bezier at constant dt is ballistic) */
  u: number;
  /** +1 clockwise (target right of the meter), -1 counter-clockwise */
  spinDir: number;
  landed: boolean;
  /** still inside the meter's fx_blast slot (launch layering, DESIGN §8.2) */
  mounted: boolean;
  /** path progress where the wild passed the rim: the trail ribbon never reaches inside it */
  uRim: number;
}

/** Charge seconds of a drop (s()-scaled, floored: first of a step >= chargeFloor, chained >= 60 ms). */
export const chargeSeconds = (chainIndex: number): number =>
  chainIndex <= 0 ? Math.max(s(D.charge), D.chargeFloor / 1000) : Math.max(s(D.chargeChained), CHAINED_FLOOR);

/**
 * One `wild:drop` (DESIGN.md §8.1 beat sheet, §8.2 flight rules, §8.3 handoff, §8.4 chains).
 * t = 0 when the handler starts (the refill has settled):
 *   0          charge: bass_charge, cue bassDropCharge (chained: reactSmall), board:focus dim of
 *              the non-targets; reticles + small landing shadows at reticleAt;
 *   C          boom: ShockwaveFilter from the meter (not in reduced motion), board:react wave,
 *              shake 0.45 (+0.1 per chain step, max 0.65), hit-stop 60, cyan flash 0.2 / 120 ms,
 *              bass_boom (+2 st per chain step), cue bassDrop;
 *   C + 40 + i x 110  wild i launches from the woofer: Bezier to its cell, scale 0.55 -> 1.75 at
 *              60% -> 1.0 (power2.in), 1.25 turns easing to 0, trail; shadow grows from 55%;
 *              inside the meter's fx_blast slot (meter:blastSlot) until its centre passes the
 *              rim (ring radius x LOOK.rimExit), then on winLayer; the trail starts at the rim;
 *   contact - 80  board:transform {style:'impact'} (the Board crushes the doomed symbol);
 *   contact    the proxy hides on the placement frame; dust crown + debris + shock ring,
 *              board:thump, trauma 0.2, hit-stop 40, wild_impact, cue wildLand; the registry
 *              slams the badge at +120 and locks the clamps at +180;
 *   last contact + settle  resolve.
 * C = chargeSeconds(chainIndex). Reduced motion: no arc (board:transform 'drop'), no shockwave.
 * Every beat is a followSpeed game-clock call: slam-stops retime it, hit-stops shift it.
 */
export class DropRun {
  readonly promise: Promise<void>;
  private resolve!: () => void;
  private readonly sched = new Sched();
  private readonly flights: Flight[] = [];
  private readonly placed: Promise<void>[] = [];
  private readonly pt: Pt = { x: 0, y: 0 };
  private readonly meter: Pt = { x: 0, y: 0 };
  private readonly view: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private done = false;
  private landedCount = 0;
  private readonly rm = reducedMotion();

  constructor(
    private readonly host: DropHost,
    private readonly p: GameEvents['wild:drop'],
  ) {
    this.promise = new Promise((r) => (this.resolve = r));
  }

  start(): void {
    const { ctx, fx } = this.host;
    const p = this.p;
    fx.seed(p.threshold * 131 + p.chainIndex * 17 + p.wilds.length);
    const L = ctx.layout;
    const wilds = [...p.wilds].sort(byCell);
    const first = p.chainIndex <= 0;
    const C = chargeSeconds(p.chainIndex);
    meterCentre(L, this.meter);

    // ---- t = 0: charge
    this.sfx('bass_charge');
    if (first) this.cue('bassDropCharge', undefined, this.meter);
    else this.cue('reactSmall');
    this.host.cancelFocusRestore();
    ctx.game.broadcast('board:focus', { cells: wilds.map((w) => ({ reel: w.reel, row: w.row })), tint: D.dimTint });

    for (const [i, w] of wilds.entries()) {
      const tint = w.multiplier > 1 ? multTier(w.multiplier).color : GOLD;
      const reticle = this.host.acquireReticle();
      reticle.reel = w.reel;
      reticle.row = w.row;
      const f: Flight = {
        wild: w,
        index: i,
        tint,
        proxy: null,
        reticle,
        arc: newArc(),
        u: 0,
        spinDir: 1,
        landed: false,
        mounted: false,
        uRim: 0,
      };
      this.flights.push(f);
    }
    // reticles appear before the boom (at reticleAt, never later than 60% of a short charge)
    this.sched.at(Math.min(s(D.reticleAt), C * 0.6), () => {
      const Lr = ctx.layout;
      for (const f of this.flights) {
        const c = slotPos(Lr, f.wild.reel, f.wild.row);
        f.reticle.show(c.x, c.y, Lr.cell);
      }
    });

    // ---- t = C: boom
    this.sched.at(C, () => this.boom());

    // ---- launches
    const launch0 = C + s(D.launchDelay);
    for (const f of this.flights) {
      this.sched.at(launch0 + f.index * s(D.launchStagger), () => (this.rm ? this.dropStraight(f) : this.launch(f)));
    }
    if (!this.flights.length) this.sched.at(C + s(D.settle), () => this.finish());
    // never hangs: the last contact is at most launch0 + (n-1) x stagger + flight (+ 1 frame)
    const lastContact = launch0 + Math.max(0, this.flights.length - 1) * s(D.launchStagger) + s(D.flight);
    this.sched.at(lastContact + s(D.settle) + s(800), () => this.finish());
  }

  /** Abort (board:set, round end, destroy): everything stops, the promise resolves. */
  abort(): void {
    this.finish();
  }

  // ---------------------------------------------------------------------------- beats

  private boom(): void {
    const { ctx } = this.host;
    const L = ctx.layout;
    const chain = Math.max(0, this.p.chainIndex);
    const m = meterCentre(L, this.meter);
    const k = physK(L);
    if (!this.rm) {
      const v = visibleRect(ctx, this.view);
      pulseShockwave({ target: ctx.layers.root, view: v }, m.x, m.y, {
        duration: s(D.shockDuration),
        radius: 0.9 * Math.hypot(v.w, v.h),
        amplitude: D.shockAmplitude * k,
        width: D.shockWavelength * k,
      });
    }
    ctx.game.broadcast('board:react', { x: m.x, y: m.y, perPxMs: D.boardReactPerPx, capMs: D.boardReactCap, power: 1 });
    ctx.game.broadcast('fx:shake', { trauma: Math.min(T.shake.boom + T.shake.boomChainAdd * chain, T.shake.boomMax) });
    clock.hitStop(D.boomHitStop);
    ctx.game.broadcast('fx:flash', { color: TEAL, alpha: T.flash.boom, durationMs: T.flash.boomMs });
    this.sfx('bass_boom', semitoneRate(2 * chain));
    this.cue('bassDrop', 1 + 0.25 * chain);
  }

  private launch(f: Flight): void {
    if (this.done) return;
    const { ctx } = this.host;
    const L = ctx.layout;
    const proxy = this.host.acquireProxy();
    f.proxy = proxy;
    dropArc(L, f.wild.reel, f.wild.row, f.arc);
    f.spinDir = f.arc.x2 >= f.arc.x0 ? 1 : -1;
    proxy.begin(f.arc.x0, f.arc.y0, f.tint);
    // it pops out of the woofer: under the rim and the counter until it passes the rim
    f.mounted = this.host.mountProxy(proxy);
    f.uRim = 0;
    this.fly(f);
    this.sfx('wild_launch', semitoneRate(2 * f.index));
    this.sfx('wild_whoosh', semitoneRate(f.index));
    this.sched.add(progress(f, s(D.flight), () => this.fly(f)));
    // the Board's crush leads contact by anticipateDuration: its explode_burst lands on contact
    this.sched.at(s(D.flight) - s(TIMING.explode.anticipateDuration), () => this.crush(f));
  }

  /** Per-frame flight sample, from the CURRENT layout (a rotation mid-flight re-targets). */
  private fly(f: Flight): void {
    const proxy = f.proxy;
    if (!proxy) return;
    const L = this.host.ctx.layout;
    dropArc(L, f.wild.reel, f.wild.row, f.arc);
    const u = f.u;
    arcAt(f.arc, u, this.pt);
    const peakScale = D.peakScale;
    const a = D.peakAt;
    // toward the camera on the rise, then it drops onto the board in depth (power2.in)
    const scale =
      u < a
        ? D.launchScale + (peakScale - D.launchScale) * p2out(u / a)
        : peakScale + (1 - peakScale) * p2in((u - a) / (1 - a));
    const spin = 1 - p2out(clamp01(u / LOOK.spinEndAt));
    proxy.place(this.pt.x, this.pt.y, scale, -f.spinDir * D.spinTurns * Math.PI * 2 * spin);
    if (f.mounted) {
      // launch layering: winLayer from the frame the centre passes the rim's inner edge
      const m = meterCentre(L, this.meter);
      const rim = BASS_DROP_LAYOUT[L.kind].meter.ringOuterD * 0.5 * LOOK.rimExit;
      if (Math.hypot(this.pt.x - m.x, this.pt.y - m.y) >= rim) {
        this.host.unmountProxy(proxy);
        f.mounted = false;
        f.uRim = u;
      }
    }
    // the ribbon covers the last trailSpan of the path behind the wild (frame-rate independent),
    // starting at the rim (collapsed on the wild while it is still inside the woofer)
    const from = f.mounted ? u : f.uRim;
    const n = LOOK.trailPoints;
    for (let i = 0; i < n; i++) {
      arcAt(f.arc, Math.max(from, u - LOOK.trailSpan * (1 - i / (n - 1))), this.pt);
      proxy.trailAt(i, this.pt.x, this.pt.y);
    }
    f.reticle.setGrow(clamp01((u - D.shadowFrom) / (1 - D.shadowFrom)));
  }

  /** contact - anticipateDuration: the Board crushes the doomed symbol and places W at contact. */
  private crush(f: Flight): void {
    if (this.done) return;
    const cell = { reel: f.wild.reel, row: f.wild.row, id: 'W' };
    this.placed.push(this.host.ctx.game.broadcastAsync('board:transform', { cells: [cell], style: 'impact' }));
    // same frame, same duration as the Board's own placement wait (both created now)
    this.sched.at(s(TIMING.explode.anticipateDuration), () => this.contact(f));
  }

  private contact(f: Flight): void {
    if (this.done || f.landed) return;
    f.landed = true;
    const { ctx, fx, registry } = this.host;
    const L = ctx.layout;
    const c = slotPos(L, f.wild.reel, f.wild.row);
    if (f.proxy) {
      // the Board places its W in the continuation of its own anticipateDuration wait (a
      // microtask after this beat), i.e. on the NEXT rendered frame: hide the proxy there
      if (f.mounted) this.host.unmountProxy(f.proxy);
      f.mounted = false;
      f.proxy.place(c.x, c.y, 1, 0);
      this.host.releaseProxy(f.proxy);
      f.proxy = null;
    }
    f.reticle.hit(() => undefined);
    fx.impact(c.x, c.y, L.cell, physK(L), f.tint);
    ctx.game.broadcast('board:thump', { px: D.thumpPx });
    ctx.game.broadcast('fx:shake', { trauma: T.shake.wildImpact });
    clock.hitStop(D.impactHitStop);
    this.sfx('wild_impact');
    this.cue('wildLand', undefined, c);
    registry.land(f.wild, null);
    this.landed();
  }

  /**
   * Reduced motion (DESIGN §8.3): no arc — the Board's straight 'drop' transform from above the
   * grid. Contact time mirrors the Board's fall (TIMING.drop.gravity from transformDropCells);
   * the badge / clamps wait for the placement (the new view exists only once it resolves).
   */
  private dropStraight(f: Flight): void {
    if (this.done) return;
    const { ctx } = this.host;
    const L = ctx.layout;
    const cell = { reel: f.wild.reel, row: f.wild.row, id: 'W' };
    const placed = ctx.game.broadcastAsync('board:transform', { cells: [cell], style: 'drop' });
    this.placed.push(placed);
    const from = GRID.firstVisibleRow - 1 - BOARD_TIMING.transformDropCells;
    // same fall as the Board's 'drop' (FEATURES.physicsScale: distance in reference px)
    const dist = (f.wild.row - from) * pitchOf(L);
    const fall = fallTime(FEATURES.physicsScale ? dist / physK(L) : dist, TIMING.drop.gravity, TIMING.drop.minFall);
    this.sfx('wild_launch', semitoneRate(2 * f.index));
    this.sched.at(s(fall), () => {
      if (this.done || f.landed) return;
      f.landed = true;
      f.reticle.hit(() => undefined);
      const c = slotPos(ctx.layout, f.wild.reel, f.wild.row);
      ctx.game.broadcast('board:thump', { px: D.thumpPx });
      this.sfx('wild_impact');
      this.cue('wildLand', undefined, c);
      this.host.registry.land(f.wild, placed);
      this.landed();
    });
  }

  private landed(): void {
    this.landedCount++;
    if (this.landedCount < this.flights.length) return;
    // resolve settle ms after the last contact. The 'impact' placement updated the Board's
    // model at contact (its follow-up spring may still run: the next winInfo interrupts it
    // safely). Reduced motion's 'drop' updates the model only when its land has settled, so
    // there the run also waits for it (else the book's reconcile would drop the W twice).
    const waits = [this.sched.wait(s(D.settle))];
    if (this.rm) waits.push(...this.placed);
    void Promise.all(waits).then(() => this.finish());
  }

  private finish(): void {
    if (this.done) return;
    this.done = true;
    this.sched.kill();
    for (const f of this.flights) {
      if (f.proxy) {
        this.host.endProxy(f.proxy);
        f.proxy = null;
        f.mounted = false;
      }
      // landed reticles free themselves after their hit clip; aborted ones go now
      if (!f.landed) f.reticle.free();
    }
    this.host.focusLater();
    this.resolve();
  }

  private sfx(id: 'bass_charge' | 'bass_boom' | 'wild_launch' | 'wild_whoosh' | 'wild_impact', rate = 1): void {
    this.host.ctx.game.broadcast('sfx', { id, rate });
  }

  private cue(cue: 'bassDropCharge' | 'bassDrop' | 'reactSmall' | 'wildLand', intensity?: number, look?: Pt): void {
    const payload: GameEvents['mascot:cue'] = { cue };
    if (intensity !== undefined) payload.intensity = intensity;
    if (look) payload.look = { x: look.x, y: look.y };
    this.host.ctx.game.broadcast('mascot:cue', payload);
  }
}

/** Linear 0 -> 1 progress tween on a flight (the path easing lives in fly()). */
const progress = (f: Flight, sec: number, onUpdate: () => void): gsap.core.Tween =>
  gsap.to(f, { u: 1, duration: sec, ease: 'none', onUpdate });
