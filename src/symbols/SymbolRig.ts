import { gsap } from 'gsap';
import { CustomEase } from 'gsap/CustomEase';
import { CustomWiggle } from 'gsap/CustomWiggle';
import { Container, Point, Sprite, type Texture } from 'pixi.js';
import type { SpineRef } from '../assets/art';
import { type LandWeight, type SymbolDef, getSymbolDef } from '../config/game';
import { clock } from '../core/clock';
import { TIMING, followSpeed, s, sUi, speedScale } from '../core/timing';
import type { GameEvents, SfxId } from '../game/events';
import type { GameContext } from '../game/context';
import { reducedMotion } from '../fx/motion';
import { BodyOverlay } from './bodyOverlay';
import { measureContent } from './contentBounds';
import { type JellyFrame, type JellyMesh, acquireJelly, releaseJelly } from './JellyMesh';
import { SPINE_ANIM, SPINE_EVENT, type SpineCue, SpineRig } from './SpinePool';
import { FrameLoop, Spring } from './spring';
import type { SymbolFxParams } from './symbolFxShader';
import { SYMBOL_TIMING as T } from './symbolTiming';
import type { ExplodeOptions, LandOptions, SymbolState, SymbolView } from './types';

const DEG = Math.PI / 180;
const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const lerpGray = (from: number, to: number, t: number): number => {
  const ch = (shift: number) => Math.round(lerp((from >> shift) & 255, (to >> shift) & 255, t));
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
};
/** Per-channel minimum of two tints (the darker of two dims wins). */
const darker = (a: number, b: number): number => {
  const ch = (shift: number) => Math.min((a >> shift) & 255, (b >> shift) & 255);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
};

let easesReady = false;
/** Custom eases are created lazily: main.ts registers the plugins after module evaluation. */
const ensureEases = (): void => {
  if (easesReady) return;
  easesReady = true;
  CustomEase.create('symbol.heartbeat', T.anticipation.heartbeat);
  CustomWiggle.create('symbol.wiggle', { wiggles: T.idle.wiggles, type: 'easeOut' });
  CustomWiggle.create('symbol.winWiggle', { wiggles: T.win.wiggles, type: 'easeOut' });
};

/** Shared (all symbols) SFX / shake limiter so a full-board landing stays musical. */
const feedback = {
  lastSfx: new Map<SfxId, number>(),
  shakeWindowStart: -1,
  shakeSum: 0,
};

let instanceCounter = 0;

/** Art-pipeline FX ids (docs/ANIMATION_CONTRACT.md §8.2) that map onto an fx:burst kind. */
const VFX_KIND: Record<string, GameEvents['fx:burst']['kind']> = {
  fx_explode: 'explode',
  fx_poof: 'explode',
  fx_explosion_big: 'explode',
  fx_dust: 'dust',
  fx_land_puff: 'dust',
  fx_smoke: 'dust',
  fx_sparkle: 'sparkle',
  fx_coins: 'coins',
  fx_coin_shower: 'coins',
  fx_confetti: 'confetti',
  fx_spot_spark: 'spotSpark',
  fx_scatter: 'scatter',
};

type Hold = 'win' | 'explode' | 'anticipation' | 'glint';

/**
 * Procedural symbol rig (the SymbolView implementation).
 *
 *   view  (Board: cell centre, drop tweens)
 *    └ body  origin at the FEET: squash/stretch spring, hop, rock wobble (weight)
 *            + additive overlay channels (bass_react, drop impact, neighbour push)
 *       └ pose  origin at the content centre: pop / pulse / breathe / sway / burst
 *          ├ art    fit scale + restAngle; children: glow (add) · sprite | jelly mesh | spine
 *          └ decor  Board decorations (badges, clamps; design px, origin = cell centre at rest)
 *
 * Static = one batched Sprite. While animating, a pooled JellyMesh (and, for win /
 * explode / glint, the FX shader) or a pooled Spine instance replaces the sprite,
 * and a clock-driven loop steps the springs; the loop stops once everything settles.
 */
export class SymbolRig implements SymbolView {
  readonly view = new Container({ label: 'symbol' });
  private readonly body = new Container({ label: 'body' });
  private readonly pose = new Container({ label: 'pose' });
  private readonly art = new Container({ label: 'art' });
  private readonly glow = new Sprite();
  private readonly sprite = new Sprite();
  /** Board decorations hang here: they squash / pop / explode with the symbol, above the art. */
  readonly decor = new Container({ label: 'decor', sortableChildren: true });

  private _id = '';
  private _state: SymbolState = 'static';
  private def!: SymbolDef;
  private staticTex!: Texture;
  private frame: JellyFrame = { cx: 0, cy: 0, k: 1, angle: 0, feetY: 0, topY: 0 };
  private jelly: JellyMesh | null = null;
  private rig: SpineRig | null = null;
  private blurred = false;

  // physics
  private readonly squash = new Spring(TIMING.land.springStiffness, TIMING.land.springDamping);
  private readonly rock = new Spring(T.land.rotStiffness, T.land.rotDamping);
  private readonly bulge = new Spring(T.jelly.bulgeStiffness, T.jelly.bulgeDamping);
  private readonly lag = new Spring(T.jelly.lagStiffness, T.jelly.lagDamping);
  private readonly shear = new Spring(T.jelly.shearStiffness, T.jelly.shearDamping);
  private squashHeld = false;
  private squashGain = 1;
  private readonly hop = { active: false, delay: 0, t: 0, h: 0, v0: 0 };
  private readonly field = { bulge: 0, lag: 0, shear: 0 };
  private readonly loop = new FrameLoop((dt) => this.tick(dt));

  // effect state (GSAP tweens these plain objects; tick() pushes them to the GPU)
  private readonly fx: SymbolFxParams = { shine: -1, shineWidth: 0.16, shineIntensity: 0, flash: 0, dissolve: 0 };
  private readonly glowState = { a: 0, s: 1 };
  private readonly dim = { t: 0, target: 0 };
  /** second dim channel (board:focus); the darker of dim / focus shows */
  private readonly focus = { t: 0, target: 0, tint: 0xcccccc };
  private focusTween: gsap.core.Tween | null = null;
  private readonly overlay = new BodyOverlay(() => this.applyBody());
  private readonly sway = { env: 0, t: 0 };
  private readonly beat = { base: 1, peak: 1 };
  private readonly holds = new Set<Hold>();

  private anims: gsap.core.Animation[] = [];
  private dimTween: gsap.core.Tween | null = null;
  private breath: gsap.core.Tween | null = null;
  private pending: Array<() => void> = [];
  private landResolve: (() => void) | null = null;
  private antOn = false;
  private elevated = false;
  private destroyed = false;
  private readonly seed: number;
  private readonly offLayout: () => void;
  private readonly p0 = new Point();
  private readonly p1 = new Point();
  private readonly p2 = new Point();
  private readonly onGlow = (): void => this.applyGlow();
  /** Generic Spine payload events: `sfx` (SfxId), `vfx` (fx id -> fx:burst kind), `shake` (trauma). */
  private readonly onSpineCue: SpineCue = (name, ev) => {
    const c = this.toRoot(this.pose, 0, 0);
    if (name === 'sfx' && ev.stringValue) {
      this.ctx.game.broadcast('sfx', { id: ev.stringValue as SfxId });
    } else if (name === 'vfx' && ev.stringValue) {
      const kind = VFX_KIND[ev.stringValue];
      if (kind) this.ctx.game.broadcast('fx:burst', { kind, x: c.x, y: c.y, color: this.def.color });
    } else if (name === 'shake' && ev.floatValue > 0) {
      this.ctx.game.broadcast('fx:shake', { trauma: Math.min(1, ev.floatValue) });
    }
  };

  constructor(
    private readonly ctx: GameContext,
    id: string,
  ) {
    const n = ++instanceCounter;
    this.seed = Math.abs(Math.sin(n * 12.9898) * 43758.5453) % 1;
    this.glow.blendMode = 'add';
    this.glow.anchor.set(0.5);
    this.glow.visible = false;
    this.art.addChild(this.glow, this.sprite);
    this.pose.addChild(this.art, this.decor);
    this.body.addChild(this.pose);
    this.view.addChild(this.body);
    this.offLayout = ctx.game.on('layout:change', () => this.fit());
    this.setSymbol(id);
  }

  get id(): string {
    return this._id;
  }

  get state(): SymbolState {
    return this._state;
  }

  // ───────────────────────────── identity / layout ─────────────────────────────

  setSymbol(id: string): void {
    this.reset();
    this._id = id;
    this.def = getSymbolDef(id);
    this.staticTex = this.ctx.art.symbol(id, 'static');
    this.sprite.texture = this.staticTex;
    this.glow.texture = this.ctx.art.symbol(id, 'glow');
    this.glow.tint = this.def.color;
    this.fit();
    this.startBreath();
  }

  /** Fit the measured content to def.cellScale of the current cell; find the feet. */
  private fit(): void {
    if (this.destroyed) return;
    const tex = this.staticTex;
    const b = measureContent(this.ctx.app.renderer, tex);
    const k = (this.def.cellScale * this.ctx.layout.cell) / Math.max(1, b.w, b.h);
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    const angle = this.def.restAngle * DEG;
    const c = Math.cos(angle);
    const sn = Math.sin(angle);
    let feet = -Infinity;
    let top = Infinity;
    const hull = b.hull;
    for (let i = 0; i < hull.length; i += 2) {
      const px = hull[i] - cx;
      const py = hull[i + 1] - cy;
      const y = k * (sn * px + c * py);
      if (y > feet) feet = y;
      if (y < top) top = y;
    }
    this.frame = { cx, cy, k, angle, feetY: feet, topY: top };
    this.art.scale.set(k);
    this.art.rotation = angle;
    this.sprite.position.set(-cx, -cy);
    this.glow.position.set(tex.width / 2 - cx, tex.height / 2 - cy);
    this.pose.position.set(0, -feet);
    this.jelly?.bind(this.sprite.texture, this.frame);
    if (this.rig) this.placeSpine(this.rig);
    this.applyBody();
  }

  private get height(): number {
    return Math.max(1, this.frame.feetY - this.frame.topY);
  }

  // ───────────────────────────── public API ─────────────────────────────

  setBlur(on: boolean): void {
    if (on === this.blurred) return;
    if (on && (this._state === 'hidden' || this._state === 'explode')) return;
    this.blurred = on;
    this.stopBreath();
    const tex = on ? this.ctx.art.symbol(this._id, 'blur') : this.staticTex;
    this.sprite.texture = tex;
    this.jelly?.bind(tex, this.frame);
    if (on) {
      this.fadeGlow(0);
      const ref = this.spineRef();
      if (ref && SpineRig.supports(ref, 'blur')) {
        void this.useSpine(ref).play('blur', true);
      }
      if (this._state === 'static' || this._state === 'land') this._state = 'blur';
    } else if (this._state === 'blur') {
      this._state = 'static';
      if (this.rig && !this.holds.size) this.releaseSpine();
    }
    this.squash.target = on ? T.blur.stretch : 0;
    this.loop.start();
  }

  land(opts: LandOptions): Promise<void> {
    this.interrupt();
    this.stopBreath();
    this._state = 'land';
    if (this.blurred || this.sprite.texture !== this.staticTex) {
      this.blurred = false;
      this.sprite.texture = this.staticTex;
      this.jelly?.bind(this.staticTex, this.frame);
    }
    const weight: LandWeight = opts.weight ?? this.def.landWeight;
    const wm = TIMING.land.weight[weight] ?? 1;
    const L = T.land;
    const vf = clamp(Math.pow(Math.max(0, opts.velocity) / L.refVelocity, L.velocityCurve), L.minVelocityFactor, L.maxVelocityFactor);
    const soft = opts.tumble ? L.tumbleSoftness : 1;
    const raw = wm * vf * soft;
    const m = raw <= 1 ? raw : 1 + (raw - 1) * L.squashKnee;

    this.restorePose();
    this.fadeGlow(0);

    const ref = this.spineRef();
    const rig = ref && SpineRig.supports(ref, 'land') ? this.useSpine(ref) : null;
    if (rig) {
      this.squashGain = T.spine.squashScale;
      rig.impact(T.spine.physicsImpulse * m);
      if (rig.hasEvent(SPINE_EVENT.impact)) rig.once(SPINE_EVENT.impact, () => this.landFeedback(weight, m, !!opts.tumble, !!opts.silent));
      else this.landFeedback(weight, m, !!opts.tumble, !!opts.silent);
      void rig.play('land', false, true).then(() => {
        if (this.rig === rig && (this._state === 'land' || this._state === 'static')) this.releaseSpine();
      });
    } else {
      this.releaseSpine();
      this.squashGain = 1;
      this.landFeedback(weight, m, !!opts.tumble, !!opts.silent);
      this.ensureJelly();
      this.lag.v += T.jelly.landLagKick * m;
      this.bulge.v += T.jelly.landBulgeKick * m;
    }

    // impact: squash in over squashDuration (held), then hand over to the spring
    this.squash.target = 0;
    this.squashHeld = true;
    this.track(
      gsap.to(this.squash, {
        x: m,
        duration: s(TIMING.land.squashDuration),
        ease: 'power2.out',
        onComplete: () => this.releaseSquash(weight, m, vf * soft),
      }),
    );
    this.loop.start();
    return new Promise<void>((resolve) => {
      this.landResolve = resolve;
      this.pending.push(resolve);
    });
  }

  win(): Promise<void> {
    ensureEases();
    this.interrupt();
    this.stopBreath();
    this.antOn = false;
    this._state = 'win';
    const W = T.win;
    const tw = TIMING.win;
    this.hold('win');

    const ref = this.spineRef();
    const rig = ref && SpineRig.supports(ref, 'win') ? this.useSpine(ref) : null;
    if (rig) {
      void rig.play('win');
      if (rig.has('win_loop')) rig.queueLoop('win_loop');
    } else {
      this.releaseSpine();
      const j = this.ensureJelly();
      if (j) j.setFx(true);
      this.bulge.v += T.jelly.winBulgeKick;
      this.lag.v += T.jelly.winLagKick;
    }

    // Choreography (ms): pop -> short hold -> dip (anticipation) -> second beat -> settle to postWin.
    const tPop = tw.popDuration;
    const tDip = tPop + W.holdAfterPop;
    const tBeat = tDip + W.dipDuration;
    const tSettle = tBeat + W.beatDuration;
    const settle = Math.max(120, tw.winAnimDuration - tSettle);
    const tl = this.track(gsap.timeline());
    // a Spine `win` carries its own pop/dip/settle: only the halo + sparkle stay procedural
    const procedural = !rig;
    const sc = this.pose.scale;
    if (procedural) {
      tl.to(sc, { x: tw.popScale, y: tw.popScale, duration: s(tPop), ease: tw.popEase }, 0);
      tl.to(sc, { x: W.dipScale, y: W.dipScale, duration: s(W.dipDuration), ease: 'power2.inOut' }, s(tDip));
      tl.to(sc, { x: W.beatScale, y: W.beatScale, duration: s(W.beatDuration), ease: W.beatEase }, s(tBeat));
      tl.to(sc, { x: W.postWinScale, y: W.postWinScale, duration: s(settle), ease: W.settleEase }, s(tSettle));
    } else tl.to(sc, { x: 1, y: 1, duration: s(tPop), ease: 'power2.out' }, 0);
    // white hit flash on the pop
    this.fx.flash = procedural ? W.flash : 0;
    tl.to(this.fx, { flash: 0, duration: s(W.flashDuration), ease: 'power3.out' }, 0);
    // jelly: belly bulge on the pop, a smaller one on the second beat
    tl.call(
      () => {
        this.bulge.v += T.jelly.winBulgeKick * W.beatJelly;
        this.lag.v += T.jelly.winLagKick * W.beatJelly;
      },
      undefined,
      s(tBeat),
    );
    // glow halo breathes with the beats, then settles to the postWin level
    this.glowState.s = 0.9;
    const glow = (a: number, sc2: number, at: number, dur: number, ease: string) =>
      tl.to(this.glowState, { a, s: sc2, duration: s(dur), ease, onUpdate: this.onGlow }, s(at));
    glow(W.glowAlpha, W.glowScale, 0, tPop * 1.5, 'power2.out');
    glow(W.glowAlpha * 0.7, 1.02, tDip, W.dipDuration, 'power2.inOut');
    glow(W.glowAlpha, W.glowScale, tBeat, W.beatDuration, 'power2.out');
    glow(W.glowPostAlpha, 1, tSettle, settle, 'power2.inOut');
    // shine sweep (top-left -> bottom-right) riding the pop
    this.fx.shine = -0.35;
    this.fx.shineWidth = W.shineWidth;
    this.fx.shineIntensity = W.shineIntensity;
    tl.to(this.fx, { shine: 1.35, duration: s(tw.shineDuration), ease: W.shineEase }, s(tPop * 0.5));
    // follow-through: specials/highs wiggle through the hold, royals (and Spine rigs) stay upright
    if (this.def.kind === 'royal' || !procedural) tl.to(this.pose, { rotation: 0, duration: s(tPop), ease: 'power2.out' }, 0);
    else {
      tl.to(
        this.pose,
        { rotation: W.wiggleDeg * DEG, duration: s(tSettle - tPop * 0.6), ease: 'symbol.winWiggle' },
        s(tPop * 0.6),
      );
    }

    const sparkle = () => {
      const c = this.toRoot(this.pose, 0, 0);
      this.ctx.game.broadcast('fx:burst', { kind: 'sparkle', x: c.x, y: c.y, color: this.def.color, count: W.sparkleCount, power: 1 });
    };
    if (rig?.hasEvent(SPINE_EVENT.winPeak)) rig.once(SPINE_EVENT.winPeak, sparkle);
    else sparkle();

    return new Promise<void>((resolve) => {
      this.pending.push(resolve);
      this.track(
        gsap.delayedCall(s(tw.winAnimDuration), () => {
          this.enterPostWin();
          this.resolvePending();
        }),
      );
    });
  }

  explode(opts: ExplodeOptions = {}): Promise<void> {
    this.interrupt();
    this.stopBreath();
    this.antOn = false;
    this._state = 'explode';
    const E = TIMING.explode;
    const X = T.explode;
    const C = opts.crush ? X.crush : null;
    const burstAt = s(E.anticipateDuration);
    const burst = s(E.burstDuration);
    const power = (opts.power ?? 1) * (this.def.kind === 'royal' ? 0.8 : 1);
    const emitBurst = () => {
      const c = this.toRoot(this.pose, 0, 0);
      this.ctx.game.broadcast('fx:burst', {
        kind: 'explode',
        x: c.x,
        y: c.y,
        color: this.def.color,
        count: C ? Math.round(E.particles * C.particles) : E.particles,
        power,
        light: C ? C.light : 1,
      });
    };
    // decorations (badges, clamps) break apart with the symbol
    if (this.decor.children.length) {
      this.track(gsap.to(this.decor, { alpha: 0, duration: burst, delay: burstAt, ease: X.fadeEase }));
    }

    const ref = this.spineRef();
    const rig = ref && SpineRig.supports(ref, 'explode') ? this.useSpine(ref) : null;
    this.hold('explode');
    if (rig) {
      const hasBurst = rig.hasEvent(SPINE_EVENT.burst);
      if (hasBurst) rig.once(SPINE_EVENT.burst, emitBurst);
      const finish = () => {
        if (this.rig !== rig || this._state !== 'explode') return;
        rig.flushEvents();
        if (!hasBurst) emitBurst();
        this.finishExplode();
      };
      // `explode_done` lets the art end the state (and return the instance) before the clip ends
      if (rig.hasEvent(SPINE_EVENT.done)) rig.once(SPINE_EVENT.done, finish);
      return new Promise<void>((resolve) => {
        this.pending.push(resolve);
        void rig.play('explode').then(finish);
      });
    }

    this.releaseSpine();
    const j = this.ensureJelly();
    if (j) {
      j.setFx(true);
      j.fxShader.setEdgeColor(this.def.color, X.edgeWhiten);
      j.fxShader.setNoiseScale(X.noiseScale);
    }
    this.fx.dissolve = 0;
    this.fx.shineIntensity = 0;
    const tl = this.track(gsap.timeline());
    const light = C ? C.charge : 1;
    // anticipation squeeze + charge-up (crush: pressed down by the wild above it)
    tl.to(
      this.pose.scale,
      { x: C ? C.pressX : E.anticipateScale, y: C ? C.pressY : E.anticipateScale, duration: burstAt, ease: E.anticipateEase },
      0,
    );
    tl.to(this.fx, { flash: X.chargeFlash * light, duration: burstAt, ease: 'power1.in' }, 0);
    tl.to(this.glowState, { a: X.glowCharge * light, s: 0.95, duration: burstAt, ease: 'power1.in', onUpdate: this.onGlow }, 0);
    // burst (crush: flattened under the landing wild instead of blown up)
    tl.call(emitBurst, undefined, burstAt);
    tl.to(this.pose.scale, { x: C ? C.flatX : E.burstScale, y: C ? C.flatY : E.burstScale, duration: burst, ease: X.burstEase }, burstAt);
    tl.to(this.fx, { dissolve: 1, duration: burst, ease: X.dissolveEase }, burstAt);
    tl.to(this.fx, { flash: 0, duration: burst * 0.7, ease: 'power2.out' }, burstAt);
    tl.to(this.art, { alpha: 0, duration: burst, ease: X.fadeEase }, burstAt);
    tl.to(
      this.glowState,
      { a: X.glowPeak * light, s: C ? 1 : X.glowScale, duration: burst * 0.25, ease: 'power2.out', onUpdate: this.onGlow },
      burstAt,
    );
    tl.to(this.glowState, { a: 0, duration: burst * 0.6, ease: 'power2.out', onUpdate: this.onGlow }, burstAt + burst * 0.25);
    return new Promise<void>((resolve) => {
      this.pending.push(resolve);
      tl.call(() => this.finishExplode(), undefined, burstAt + burst);
    });
  }

  setAnticipation(on: boolean): void {
    if (on === this.antOn) return;
    ensureEases();
    const A = TIMING.anticipation;
    if (on) {
      this.interrupt();
      this.stopBreath();
      this.antOn = true;
      this._state = 'anticipation';
      const LA = T.anticipation;
      const ref = this.spineRef();
      const loopName = ref ? SpineRig.pick(ref, SPINE_ANIM.anticipationLoop) : null;
      const rig = ref && loopName ? this.useSpine(ref) : null;
      this.glowState.s = 0.9;
      this.track(
        gsap.to(this.glowState, {
          a: LA.glowFlare,
          s: 1.1,
          duration: s(A.introDuration * 0.5),
          ease: 'power2.out',
          onUpdate: this.onGlow,
        }),
      );
      if (rig && loopName) {
        // the skeleton carries the pulse; the halo just breathes on the same period
        if (rig.has('anticipation_intro')) {
          void rig.play('anticipation_intro');
          rig.queueLoop(loopName);
        } else void rig.play(loopName, true);
        this.track(
          gsap.to(this.glowState, {
            a: LA.glowAlpha * 0.6,
            duration: s(A.pulsePeriod / 2),
            ease: 'sine.inOut',
            yoyo: true,
            repeat: -1,
            delay: s(A.introDuration),
            onUpdate: this.onGlow,
          }),
        );
        return;
      }
      this.releaseSpine();
      this.ensureJelly();
      this.hold('anticipation');
      this.beat.base = 1 + (A.pulseScale - 1) * LA.restFraction;
      this.beat.peak = A.pulseScale;
      // intro: scale up (overshoot) and sway fades in
      this.track(
        gsap.to(this.pose.scale, { x: this.beat.base, y: this.beat.base, duration: s(A.introDuration), ease: 'back.out(3)' }),
      );
      this.track(gsap.to(this.sway, { env: 1, duration: s(A.introDuration * 2), ease: 'sine.inOut' }));
      // heartbeat loop (lub-dub) on the pose scale; glow + jelly follow it in tick()
      this.track(
        gsap.fromTo(
          this.pose.scale,
          { x: this.beat.base, y: this.beat.base },
          {
            x: this.beat.peak,
            y: this.beat.peak,
            duration: s(A.pulsePeriod),
            ease: 'symbol.heartbeat',
            repeat: -1,
            delay: s(A.introDuration),
            immediateRender: false,
          },
        ),
      );
      this.loop.start();
    } else {
      this.antOn = false;
      if (this._state !== 'anticipation') return;
      this.killAnims();
      this.release('anticipation');
      if (this.rig?.has('anticipation_out')) void this.rig.play('anticipation_out');
      const out = s(A.outroDuration);
      this.track(gsap.to(this.pose.scale, { x: 1, y: 1, duration: out, ease: 'power2.out' }));
      this.track(gsap.to(this.pose, { rotation: 0, duration: out, ease: 'power2.out' }));
      this.track(gsap.to(this.glowState, { a: 0, s: 1, duration: out, ease: 'power2.in', onUpdate: this.onGlow }));
      this.track(
        gsap.delayedCall(out, () => {
          if (this.rig) this.releaseSpine();
          this._state = 'static';
          if (!this.loop.running) this.startBreath();
        }),
      );
    }
  }

  setDim(on: boolean, animate = true): void {
    const target = on ? 1 : 0;
    if (target === this.dim.target && (animate || this.dim.t === target)) return;
    this.dim.target = target;
    this.dimTween?.kill();
    this.dimTween = null;
    if (animate) {
      this.dimTween = followSpeed(
        gsap.to(this.dim, {
          t: target,
          duration: s(TIMING.win.dimDuration),
          ease: 'power2.out',
          onUpdate: () => this.applyDim(),
          onComplete: () => {
            this.dimTween = null;
          },
        }),
      );
    } else {
      this.dim.t = target;
      this.applyDim();
    }
  }

  idleAccent(): void {
    if (this._state !== 'static' || this.loop.running || this.destroyed) return;
    ensureEases();
    const I = T.idle;
    const ref = this.spineRef();
    if (ref && SpineRig.supports(ref, 'idle')) {
      const rig = this.useSpine(ref);
      void rig.play('idle').then(() => {
        if (this.rig === rig && this._state === 'static') this.releaseSpine();
      });
      return;
    }
    if (this.ctx.budget.idleShaders && this.def.kind !== 'royal') {
      // glint: shine sweep + a soft jelly nudge
      const j = this.ensureJelly();
      if (!j) return;
      j.setFx(true);
      this.hold('glint');
      this.fx.shine = -0.35;
      this.fx.shineWidth = T.win.shineWidth;
      this.fx.shineIntensity = I.glintIntensity;
      this.fx.flash = 0;
      this.fx.dissolve = 0;
      this.bulge.v += I.glintBulge;
      this.track(
        gsap.to(this.fx, {
          shine: 1.35,
          duration: s(I.glintDuration),
          ease: T.win.shineEase,
          onComplete: () => this.release('glint'),
        }),
      );
      this.loop.start();
    } else {
      this.track(gsap.to(this.pose, { rotation: I.wiggleDeg * DEG, duration: s(I.wiggleDuration), ease: 'symbol.wiggle' }));
    }
  }

  reset(): void {
    this.interrupt();
    this.stopBreath();
    this.dimTween?.kill();
    this.dimTween = null;
    this.dim.t = 0;
    this.dim.target = 0;
    this.focusTween?.kill();
    this.focusTween = null;
    this.focus.t = 0;
    this.focus.target = 0;
    this.applyDim();
    this.overlay.kill();
    this.decor.alpha = 1;
    for (const sp of [this.squash, this.rock, this.bulge, this.lag, this.shear]) sp.reset(0);
    this.squashHeld = false;
    this.squashGain = 1;
    this.hop.active = false;
    this.hop.h = 0;
    this.holds.clear();
    this.loop.stop();
    this.dropJelly();
    this.releaseSpine();
    this.blurred = false;
    this.antOn = false;
    if (this.staticTex) this.sprite.texture = this.staticTex;
    this.glowState.a = 0;
    this.glowState.s = 1;
    this.applyGlow();
    this.sway.env = 0;
    this.pose.scale.set(1);
    this.pose.rotation = 0;
    this.art.alpha = 1;
    this.body.visible = true;
    this.applyBody();
    this._state = 'static';
  }

  setElevated(on: boolean): void {
    if (on === this.elevated) return;
    this.elevated = on;
    if (on) this.ctx.layers.winLayer.attach(this.view);
    else this.ctx.layers.winLayer.detach(this.view);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.reset();
    this.stopBreath();
    this.destroyed = true;
    this.offLayout();
    this.setElevated(false);
    // decorations belong to their owners: detach, never destroy
    this.decor.removeChildren();
    this.view.destroy({ children: true });
  }

  // ───────────────────────── board reactions (additive) ─────────────────────────

  /**
   * Board-wide bass reaction: Spine `bass_react` on track 1 (additive) when the skeleton has
   * it, else a procedural squash (sy ~0.95) + small hop. Never interrupts the current state,
   * so it is safe mid-land / mid-win; ignored while exploding or hidden.
   */
  react(power = 1): void {
    if (this.destroyed || this._state === 'hidden' || this._state === 'explode' || !this.body.visible) return;
    if (this.rig?.has('bass_react')) {
      void this.rig.playOverlay('bass_react');
      return;
    }
    const ref = this.spineRef();
    if (!this.rig && ref && this._state === 'static' && SpineRig.supports(ref, 'bass_react')) {
      this.stopBreath();
      const rig = this.useSpine(ref);
      void rig.playOverlay('bass_react').then(() => {
        if (this.rig !== rig || this._state !== 'static') return;
        this.releaseSpine();
        this.startBreath();
      });
      return;
    }
    const hop = reducedMotion() ? 0 : T.bassReact.hopCells * this.ctx.layout.cell;
    this.overlay.playReact(power, hop);
  }

  /**
   * Heavy drop impact at the contact frame: Spine `drop_impact` when the skeleton has it,
   * else procedural keys (sy 0.72 at f1, rebound 1.10 at f5, setup pose by f15) plus a jelly
   * bulge. Resolves when settled (or interrupted).
   */
  impact(): Promise<void> {
    this.interrupt();
    this.stopBreath();
    this._state = 'land';
    if (this.blurred || this.sprite.texture !== this.staticTex) {
      this.blurred = false;
      this.sprite.texture = this.staticTex;
      this.jelly?.bind(this.staticTex, this.frame);
    }
    this.restorePose();
    this.fadeGlow(0);
    this.squash.reset(0);
    this.squashHeld = false;
    this.hop.active = false;
    this.hop.h = 0;
    const ref = this.spineRef();
    const rig = ref && SpineRig.supports(ref, 'drop_impact') ? this.useSpine(ref) : null;
    let motion: Promise<void>;
    if (rig) {
      rig.impact(T.spine.maxImpulse);
      motion = rig.play('drop_impact');
    } else {
      this.releaseSpine();
      this.ensureJelly();
      this.bulge.v += T.dropImpact.bulgeKick;
      this.lag.v += T.jelly.landLagKick * 2;
      motion = this.overlay.playImpact();
    }
    this.loop.start();
    return new Promise<void>((resolve) => {
      this.pending.push(resolve);
      void motion.then(() => {
        if (!this.pending.includes(resolve)) return;
        this.pending = this.pending.filter((p) => p !== resolve);
        if (this._state === 'land') this._state = 'static';
        if (rig && this.rig === rig && this._state === 'static') this.releaseSpine();
        resolve();
      });
    });
  }

  /** Push the body by (dx, dy) design px and spring back; `ms` covers out + back. Additive. */
  nudge(dx: number, dy: number, ms: number): void {
    if (this.destroyed) return;
    this.overlay.nudge(dx, dy, ms);
  }

  /** Focus dim (board:focus): tint toward `tint`, or `null` to clear; the darker of win-dim and focus shows. */
  setFocusDim(tint: number | null, animate = true): void {
    const target = tint === null ? 0 : 1;
    if (tint !== null) this.focus.tint = tint;
    if (target === this.focus.target && (animate || this.focus.t === target)) {
      if (tint !== null) this.applyDim();
      return;
    }
    this.focus.target = target;
    this.focusTween?.kill();
    this.focusTween = null;
    if (animate) {
      this.focusTween = followSpeed(
        gsap.to(this.focus, {
          t: target,
          duration: s(TIMING.win.dimDuration),
          ease: 'power2.out',
          onUpdate: () => this.applyDim(),
          onComplete: () => {
            this.focusTween = null;
          },
        }),
      );
    } else {
      this.focus.t = target;
      this.applyDim();
    }
  }

  // ───────────────────────────── internals ─────────────────────────────

  /** Resolve in-flight promises and kill action tweens (springs keep settling naturally). */
  private interrupt(): void {
    this.killAnims();
    this.resolvePending();
    if (this.holds.size) {
      this.holds.clear();
      this.jelly?.setFx(false);
    }
    this.fx.shine = -1;
    this.fx.shineIntensity = 0;
    this.fx.flash = 0;
    this.fx.dissolve = 0;
    this.squashHeld = false;
    this.bulge.target = 0;
    this.lag.target = 0;
  }

  private killAnims(): void {
    for (const a of this.anims) a.kill();
    this.anims = [];
  }

  private resolvePending(): void {
    const list = this.pending;
    this.pending = [];
    this.landResolve = null;
    for (const r of list) r();
  }

  /** Action animations (all s()-timed): killed by interrupt(), retimed by a mid-round speed change. */
  private track<A extends gsap.core.Animation>(a: A): A {
    this.anims.push(followSpeed(a));
    return a;
  }

  private hold(h: Hold): void {
    this.holds.add(h);
    this.loop.start();
  }

  private release(h: Hold): void {
    this.holds.delete(h);
    if (h === 'anticipation') {
      this.bulge.target = 0;
      this.lag.target = 0;
      this.sway.env = 0;
    }
    if (!this.holds.has('win') && !this.holds.has('explode') && !this.holds.has('glint')) this.jelly?.setFx(false);
  }

  private releaseSquash(weight: LandWeight, m: number, energy: number): void {
    this.squashHeld = false;
    this.syncSprings();
    this.squash.v = -this.squash.x * this.squash.omega * T.land.reboundVelocity;
    // secondary hop launched as the spring passes neutral (stretch carries it up)
    const h = TIMING.land.hopHeight * (TIMING.land.weight[weight] ?? 1) * energy;
    if (h > 0.5) {
      this.hop.active = true;
      this.hop.delay = this.squash.quarterPeriod * 0.85;
      this.hop.t = 0;
      this.hop.h = 0;
      this.hop.v0 = Math.sqrt(2 * T.land.hopGravity * h);
    }
    // heavy things rock on their base (direction varies per instance)
    const deg = (T.land.wobbleDeg[weight] ?? 0) * Math.min(1.2, m / (TIMING.land.weight[weight] ?? 1));
    if (deg > 0) {
      const dir = this.seed < 0.5 ? -1 : 1;
      this.rock.v += dir * deg * DEG * this.rock.omega;
    }
  }

  private enterPostWin(): void {
    this.release('win');
    this._state = 'postWin';
    const W = T.win;
    const half = s(W.postWinPulsePeriod / 2);
    const loop = { duration: half, ease: 'sine.inOut', yoyo: true, repeat: -1 };
    // a Spine `win_loop` pulses itself; the procedural rig breathes the pose instead
    if (!this.rig?.has('win_loop')) {
      this.track(gsap.to(this.pose.scale, { x: W.postWinPulseScale, y: W.postWinPulseScale, ...loop }));
    }
    this.track(gsap.to(this.glowState, { a: W.glowPostAlpha + 0.3, onUpdate: this.onGlow, ...loop }));
    this.track(gsap.to(this.pose, { rotation: 0, duration: s(W.straightenDuration), ease: 'power2.out' }));
  }

  private finishExplode(): void {
    this.release('explode');
    this.body.visible = false;
    this._state = 'hidden';
    this.glowState.a = 0;
    this.applyGlow();
    this.releaseSpine();
    this.dropJelly();
    for (const sp of [this.squash, this.rock, this.bulge, this.lag, this.shear]) sp.reset(0);
    this.hop.active = false;
    this.hop.h = 0;
    this.applyBody();
    this.loop.stop();
    this.resolvePending();
  }

  private restorePose(): void {
    if (this.pose.scale.x !== 1 || this.pose.scale.y !== 1 || this.pose.rotation !== 0) {
      this.track(gsap.to(this.pose.scale, { x: 1, y: 1, duration: s(TIMING.land.squashDuration * 2), ease: 'power2.out' }));
      this.track(gsap.to(this.pose, { rotation: 0, duration: s(TIMING.land.squashDuration * 2), ease: 'power2.out' }));
    }
    this.art.alpha = 1;
    this.body.visible = true;
  }

  private fadeGlow(a: number): void {
    if (this.glowState.a === a) return;
    this.track(gsap.to(this.glowState, { a, duration: s(TIMING.win.dimDuration), ease: 'power2.out', onUpdate: this.onGlow }));
  }

  private applyDim(): void {
    const d = lerpGray(0xffffff, TIMING.win.dimTint, this.dim.t);
    const tint = this.focus.t > 0 ? darker(d, lerpGray(0xffffff, this.focus.tint, this.focus.t)) : d;
    this.art.tint = tint;
    this.decor.tint = tint;
  }

  private applyGlow(): void {
    const a = this.glowState.a;
    this.glow.visible = a > 0.004;
    this.glow.alpha = Math.min(1, a);
    this.glow.scale.set(this.glowState.s);
  }

  private applyBody(): void {
    const { squashX, squashY } = TIMING.land;
    const p = Math.log(squashX) / -Math.log(squashY);
    const a = this.squash.x * this.squashGain;
    const sy = Math.max(0.3, 1 - a * (1 - squashY));
    const o = this.overlay;
    this.body.scale.set(Math.pow(sy, -p) * o.sx, sy * o.sy);
    this.body.position.set(o.x, this.frame.feetY - this.hop.h + o.y);
    this.body.rotation = this.rock.x;
  }

  private startBreath(): void {
    if (this.breath || this.destroyed || !this.ctx.budget.idleShaders) return;
    if (this.def.kind === 'royal' || this._state !== 'static') return;
    const I = T.idle;
    const period = lerp(I.breathPeriodMin, I.breathPeriodMax, this.seed);
    this.pose.scale.set(1);
    this.breath = gsap.to(this.pose.scale, {
      x: I.breathScale,
      y: I.breathScale,
      duration: sUi(period / 2),
      ease: 'sine.inOut',
      yoyo: true,
      repeat: -1,
      delay: sUi(this.seed * period),
    });
  }

  private stopBreath(): void {
    if (!this.breath) return;
    this.breath.kill();
    this.breath = null;
  }

  // ── jelly / spine swapping ──

  private ensureJelly(): JellyMesh | null {
    if (this.rig) return null;
    if (!this.jelly) {
      const j = acquireJelly();
      j.bind(this.sprite.texture, this.frame);
      this.art.addChildAt(j.mesh, this.art.getChildIndex(this.sprite) + 1);
      this.sprite.visible = false;
      this.jelly = j;
    }
    return this.jelly;
  }

  private dropJelly(): void {
    if (!this.jelly) return;
    releaseJelly(this.jelly);
    this.jelly = null;
    this.sprite.visible = true;
  }

  private spineRef(): SpineRef | null {
    return this._id ? this.ctx.art.spine(this._id) : null;
  }

  /**
   * Borrow (or keep) the Spine rig for a new action. Physics stop inheriting container
   * motion for every action; only `land` re-arms it (SpineRig.impact).
   */
  private useSpine(ref: SpineRef): SpineRig {
    if (!this.rig) {
      this.dropJelly();
      const rig = new SpineRig(ref);
      rig.onCue(this.onSpineCue);
      this.placeSpine(rig);
      this.art.addChild(rig.spine);
      this.sprite.visible = false;
      this.rig = rig;
    }
    this.rig.detachPhysics();
    return this.rig;
  }

  private placeSpine(rig: SpineRig): void {
    const tex = this.staticTex;
    rig.spine.scale.set(tex.width / T.spine.canvasPx);
    rig.spine.position.set(tex.width / 2 - this.frame.cx, tex.height / 2 - this.frame.cy);
  }

  private releaseSpine(): void {
    if (!this.rig) return;
    this.rig.release();
    this.rig = null;
    this.sprite.visible = !this.jelly;
    this.squashGain = 1;
  }

  // ── feedback ──

  private landFeedback(weight: LandWeight, m: number, tumble: boolean, silent: boolean): void {
    const L = T.land;
    const now = clock.time * 1000;
    const id = `land_${weight}` as SfxId;
    const last = feedback.lastSfx.get(id) ?? -Infinity;
    if (!silent && now - last >= T.feedback.sfxMinGap) {
      feedback.lastSfx.set(id, now);
      const volume = (L.sfxVolume[weight] ?? 0.7) * (tumble ? L.tumbleVolume : 1);
      this.ctx.game.broadcast('sfx', { id, volume, rate: 0.96 + this.seed * 0.08 });
    }
    if (weight !== 'heavy' && weight !== 'special') return;
    const f = this.toRoot(this.body, 0, 0);
    this.ctx.game.broadcast('fx:burst', {
      kind: 'dust',
      x: f.x,
      y: f.y,
      color: this.def.shade,
      count: Math.round(TIMING.land.dustParticles * clamp(m / (TIMING.land.weight[weight] ?? 1), 0.5, 1.2)),
      power: clamp(m / 1.6, 0.3, 1),
    });
    // shared shake budget per window
    if (now - feedback.shakeWindowStart > T.feedback.shakeWindow) {
      feedback.shakeWindowStart = now;
      feedback.shakeSum = 0;
    }
    const want = (L.shakeTrauma[weight] ?? 0) * (tumble ? 0.6 : 1);
    const trauma = Math.min(want, T.feedback.shakeWindowMax - feedback.shakeSum);
    if (trauma > 0.005) {
      feedback.shakeSum += trauma;
      this.ctx.game.broadcast('fx:shake', { trauma });
    }
  }

  /** A local point of `from` in design (root) coordinates. Returns a shared Point. */
  private toRoot(from: Container, x: number, y: number): Point {
    this.p0.set(x, y);
    from.toGlobal(this.p0, this.p1);
    return this.ctx.layers.root.toLocal(this.p1, undefined, this.p2);
  }

  // ── per-frame ──

  /** Re-read spring constants every frame so the animation lab can tune them live. */
  private syncSprings(): void {
    this.squash.stiffness = TIMING.land.springStiffness;
    this.squash.damping = TIMING.land.springDamping;
    this.rock.stiffness = T.land.rotStiffness;
    this.rock.damping = T.land.rotDamping;
    this.bulge.stiffness = T.jelly.bulgeStiffness;
    this.bulge.damping = T.jelly.bulgeDamping;
    this.lag.stiffness = T.jelly.lagStiffness;
    this.lag.damping = T.jelly.lagDamping;
    this.shear.stiffness = T.jelly.shearStiffness;
    this.shear.damping = T.jelly.shearDamping;
  }

  private tick(dtRaw: number): void {
    if (this.destroyed) return;
    this.syncSprings();
    const dt = dtRaw * speedScale();
    if (!this.squashHeld) this.squash.step(dt);
    this.rock.step(dt);

    const anticipating = this.holds.has('anticipation');
    let beat = 0;
    if (anticipating) {
      // glow + jelly breathe with the heartbeat; slow sway on a sine
      const span = this.beat.peak - this.beat.base;
      beat = span > 0 ? clamp((this.pose.scale.x - this.beat.base) / span, 0, 1.2) : 0;
      this.bulge.target = T.anticipation.bulge * beat;
      this.lag.target = T.anticipation.lag * beat;
      this.sway.t += dt;
      const w = (2 * Math.PI) / (T.anticipation.swayPeriod / 1000);
      this.pose.rotation = T.anticipation.swayDeg * DEG * this.sway.env * Math.sin(this.sway.t * w + this.seed * 6.28);
    }
    this.shear.target = -this.rock.x * this.height * T.jelly.shearFollow;
    this.bulge.step(dt);
    this.lag.step(dt);
    this.shear.step(dt);

    if (this.hop.active) {
      // ballistic arc, evaluated analytically (no integration drift on the apex)
      const hop = this.hop;
      if (hop.delay > 0) hop.delay -= dt;
      else {
        const g = T.land.hopGravity;
        hop.t += dt;
        hop.h = hop.v0 * hop.t - 0.5 * g * hop.t * hop.t;
        if (hop.h <= 0) {
          this.squash.v += hop.v0 * T.land.hopKick;
          hop.h = 0;
          hop.active = false;
        }
      }
    }

    this.applyBody();
    if (anticipating) {
      this.applyGlow();
      this.glow.alpha *= 0.6 + 0.4 * beat;
    }
    if (this.jelly) {
      this.field.bulge = this.bulge.x;
      this.field.lag = this.lag.x;
      this.field.shear = this.shear.x;
      this.jelly.apply(this.field);
      if (this.jelly.hasFx) this.jelly.fxShader.apply(this.fx);
    }

    const energy = Math.max(
      this.squash.energy(),
      this.rock.energy() * 4,
      this.bulge.energy(),
      this.lag.energy(),
      this.shear.energy() * 0.02,
    );
    const moving = this.squashHeld || this.hop.active;
    if (this.landResolve && !moving && energy < T.land.resolveEpsilon) {
      const r = this.landResolve;
      this.landResolve = null;
      this.pending = this.pending.filter((p) => p !== r);
      if (this._state === 'land') {
        this._state = 'static';
      }
      r();
    }
    if (!moving && this.holds.size === 0 && energy < T.land.settleEpsilon) {
      for (const sp of [this.squash, this.rock, this.bulge, this.lag, this.shear]) sp.snap();
      this.applyBody();
      this.dropJelly();
      this.loop.stop();
      if (this._state === 'land') this._state = 'static';
      if (this._state === 'static' && !this.rig) this.startBreath();
    }
  }
}
