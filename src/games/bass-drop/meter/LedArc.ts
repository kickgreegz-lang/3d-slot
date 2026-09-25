import { gsap } from 'gsap';
import { Container, Sprite, type Texture } from 'pixi.js';
import { followSpeed, s } from '../../../core/timing';
import { glowTexture } from '../../../fx/textures';
import { lighten } from '../../../fx/util';
import { BASS_DROP_TIMING, METER_UNLIT } from '../timing';
import { GEOM, R_REF, polar, segmentColor, tickDeg } from './geometry';

const M = BASS_DROP_TIMING.meter;
const TICK_R = R_REF * ((GEOM.ledInner + GEOM.ledOuter) / 2);
const GLOW_SIZE = 40;
const HEAD_GLOW = 58;

/**
 * LED ARC — the 60 code-drawn ticks of the gauge plus its glow arc (ANIMATION_SET §8,
 * inserted in the rig's `led_arc` slot). 300° from 7 o'clock to 5 o'clock, clockwise;
 * tick i spans value i-1..i and lights in its 10-segment colour (DESIGN §6.1), the head
 * tick is white-hot with a bigger glow, unlit ticks are #243056.
 *
 * Three sprite rings (all pooled, created once): additive glow segments behind the
 * ticks (the "fill-glow arc": segment i shows `clamp(fill - (i - 1), 0, 1)`, so tweening
 * `fill` grows the arc smoothly), the ticks, and additive white flares on top (the
 * 1.6x brightness overshoot of a tick lighting up). A sweep (threshold ring flash, the
 * major gold wave) adds a travelling highlight on the glow ring.
 */
export class LedArc {
  readonly view = new Container({ label: 'led_arc' });
  private readonly glows: Sprite[] = [];
  private readonly ticks: Sprite[] = [];
  private readonly flares: Sprite[] = [];
  private readonly head = new Sprite({ texture: glowTexture(128), anchor: 0.5, blendMode: 'add' });
  private readonly fillState = { v: 0 };
  private fillTween: gsap.core.Tween | null = null;
  private lit = 0;
  private hot = true;
  /** glow strength of the lit arc (state-driven: cold dim .. locked bright) */
  private glowLevel = 0.5;
  /** sweep highlight: position in ticks (-1 = none), colour, width */
  private readonly sweepState = { pos: -1 };
  private sweepColor = 0xffffff;
  private sweepTween: gsap.core.Tween | null = null;
  /** pulse multiplier on the glow (overdrive / heat shimmer), set every frame by the rig */
  pulse = 1;

  constructor(tick: Texture) {
    const glowTex = glowTexture(64);
    for (let i = 1; i <= GEOM.ticks; i++) {
      const deg = tickDeg(i);
      const p = polar(deg, TICK_R);
      const g = new Sprite({ texture: glowTex, anchor: 0.5, blendMode: 'add', alpha: 0 });
      g.position.set(p.x, p.y);
      g.width = g.height = GLOW_SIZE;
      g.tint = segmentColor(i);
      const t = new Sprite({ texture: tick, anchor: 0.5 });
      t.position.set(p.x, p.y);
      t.angle = deg;
      t.tint = METER_UNLIT;
      const f = new Sprite({ texture: tick, anchor: 0.5, blendMode: 'add', alpha: 0 });
      f.position.set(p.x, p.y);
      f.angle = deg;
      f.visible = false;
      this.glows.push(g);
      this.ticks.push(t);
      this.flares.push(f);
    }
    this.head.width = this.head.height = HEAD_GLOW;
    this.head.visible = false;
    this.view.addChild(...this.glows, ...this.ticks, this.head, ...this.flares);
  }

  /** Swap the tick texture (layout re-bake). */
  setTexture(tick: Texture): void {
    for (const t of this.ticks) t.texture = tick;
    for (const f of this.flares) f.texture = tick;
  }

  get level(): number {
    return this.lit;
  }

  /** Light ticks 1..n (n clamped to 60); `hot` = head tick white-hot. */
  setLevel(n: number, hot = true): void {
    const lit = Math.max(0, Math.min(GEOM.ticks, Math.floor(n)));
    if (lit === this.lit && hot === this.hot) return;
    this.lit = lit;
    this.hot = hot;
    for (let i = 0; i < GEOM.ticks; i++) {
      const v = i + 1;
      this.ticks[i].tint = v > lit ? METER_UNLIT : v === lit && hot && lit < GEOM.ticks ? lighten(segmentColor(v), 0.8) : segmentColor(v);
    }
    const h = this.head;
    h.visible = lit > 0 && hot;
    if (h.visible) {
      const p = polar(tickDeg(Math.min(lit, GEOM.ticks)), TICK_R);
      h.position.set(p.x, p.y);
      h.tint = lighten(segmentColor(lit), 0.55);
    }
    this.refreshGlow();
  }

  /** Tween the glow arc to `n` ticks (power2.out). `sec` 0 = snap. */
  fillTo(n: number, sec: number): void {
    this.fillTween?.kill();
    this.fillTween = null;
    const to = Math.max(0, Math.min(GEOM.ticks, n));
    if (sec <= 0) {
      this.fillState.v = to;
      this.refreshGlow();
      return;
    }
    this.fillTween = followSpeed(
      gsap.to(this.fillState, { v: to, duration: sec, ease: 'power2.out', onUpdate: () => this.refreshGlow() }),
    );
  }

  setGlowLevel(level: number): void {
    if (Math.abs(level - this.glowLevel) < 1e-3) return;
    this.glowLevel = level;
    this.refreshGlow();
  }

  /** Tick i (1..60) lights up: 60 ms fade-in to 1.6x brightness, settle over 120 ms (s()-scaled). */
  flare(i: number): void {
    const f = this.flares[i - 1];
    if (!f) return;
    gsap.killTweensOf(f);
    f.visible = true;
    f.alpha = 0;
    const over = M.tickOvershoot - 1;
    followSpeed(
      gsap
        .timeline({ onComplete: () => void (f.visible = false) })
        .to(f, { alpha: over, duration: s(M.tickLed), ease: 'power1.out' })
        .to(f, { alpha: 0, duration: s(M.tickSettle), ease: 'power2.out' }),
    );
  }

  /**
   * A highlight travelling around the arc (threshold ring flash: 1 lap; major gold wave: 2).
   * Pure garnish: never holds anything.
   */
  sweep(color: number, sec: number, laps = 1): void {
    this.sweepTween?.kill();
    this.sweepColor = color;
    this.sweepState.pos = 0;
    this.sweepTween = followSpeed(
      gsap.to(this.sweepState, {
        pos: GEOM.ticks * laps,
        duration: sec,
        ease: 'none',
        onUpdate: () => this.refreshGlow(),
        onComplete: () => {
          this.sweepState.pos = -1;
          this.sweepTween = null;
          this.refreshGlow();
        },
      }),
    );
  }

  /** Called by the rig when `pulse` changed (loops); cheap (60 alpha writes). */
  refreshGlow(): void {
    const f = this.fillState.v;
    const lvl = this.glowLevel * this.pulse;
    const sw = this.sweepState.pos;
    const swPos = sw >= 0 ? sw % GEOM.ticks : -99;
    for (let i = 0; i < GEOM.ticks; i++) {
      const fill = Math.min(1, Math.max(0, f - i));
      let a = fill * lvl * 0.85;
      let tint = segmentColor(i + 1);
      if (swPos > -99) {
        const d = Math.abs(i - swPos);
        const k = d < 6 ? 1 - d / 6 : 0;
        if (k > 0) {
          a = Math.max(a, k * 0.95);
          tint = this.sweepColor;
        }
      }
      const g = this.glows[i];
      g.alpha = Math.min(1, a);
      g.tint = tint;
    }
    this.head.alpha = Math.min(1, 0.55 + 0.45 * lvl);
  }

  destroy(): void {
    this.fillTween?.kill();
    this.sweepTween?.kill();
    for (const f of this.flares) gsap.killTweensOf(f);
    this.view.destroy({ children: true });
  }
}
