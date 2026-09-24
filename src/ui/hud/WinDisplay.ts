import { gsap } from 'gsap';
import { BlurFilter, Container, Graphics, Sprite, type Text, Texture } from 'pixi.js';
import { sUi } from '../../core/timing';
import type { GameContext } from '../../game/context';
import { bakeCentered } from './geometry';
import { HUD_TIMING } from './hudTiming';
import { type TextPool, labelStyle, valueStyle } from './theme';

export type WinMode = 'row' | 'stack';

/**
 * WIN readout. Renders flow-provided text, or rolls a count-up for 'hud:countWin'
 * (formatting through ctx.money only — no money maths here): the number rolls,
 * the readout swells slightly while counting, then punches with an elastic settle,
 * a warm flash and 'counter_end'. 'counter_tick' is throttled and pitches up.
 *
 * row   : [WIN][ value ] centred on the origin, the value grows to the right within
 *         the width reserved for the final amount (label never jitters).
 * stack : label above, value below, both centred (compact column).
 */
export class WinDisplay extends Container {
  private readonly body = new Container({ label: 'win-body' });
  private readonly caption: Text;
  private readonly value: Text;
  private readonly flash = new Sprite(Texture.EMPTY);
  private mode: WinMode = 'row';
  private labelSize = 28;
  private valueSize = 40;
  private maxWidth = 600;
  private readonly counter = { v: 0 };
  private tween: gsap.core.Tween | null = null;
  private punch: gsap.core.Timeline | null = null;
  private lastTickAt = -1;
  private shown = false;
  private format: (v: number) => string = String;

  constructor(
    private readonly ctx: GameContext,
    texts: TextPool,
    labelText: string,
  ) {
    super({ label: 'win' });
    this.caption = texts.make(labelText, labelStyle(28), 1, 0.5);
    this.value = texts.make('', valueStyle(40), 0, 0.5);
    this.flash.anchor.set(0.5);
    this.flash.blendMode = 'add';
    this.flash.tint = 0xffd66b;
    this.flash.alpha = 0;
    this.body.addChild(this.flash, this.caption, this.value);
    this.addChild(this.body);
    this.alpha = 0;
    this.visible = false;
  }

  get counting(): boolean {
    return this.tween !== null;
  }

  configure(opts: { mode: WinMode; labelSize: number; valueSize: number; maxWidth: number; resolution: number }): void {
    this.mode = opts.mode;
    this.labelSize = opts.labelSize;
    this.valueSize = opts.valueSize;
    this.maxWidth = opts.maxWidth;
    this.caption.style = labelStyle(opts.labelSize);
    this.value.style = valueStyle(opts.valueSize);
    if (opts.mode === 'row') {
      this.caption.anchor.set(1, 0.5);
      this.value.anchor.set(0, 0.5);
    } else {
      this.caption.anchor.set(0.5, 1);
      this.value.anchor.set(0.5, 0);
    }
    this.bakeFlash(opts.resolution);
    this.arrange(this.value.text);
  }

  setLabel(text: string): void {
    if (this.caption.text === text) return;
    this.caption.text = text;
    this.arrange(this.value.text);
  }

  /** Static readout from HudState (ignored while a count-up is rolling). */
  setStatic(text: string, show: boolean): void {
    if (this.tween) return;
    if (show) {
      this.value.text = text;
      this.arrange(text);
    }
    this.setShown(show);
  }

  /** Roll from -> to (API units) over durationMs of UI time. */
  countTo(from: number, to: number, durationMs: number, format: (v: number) => string): Promise<void> {
    this.format = format;
    this.tween?.kill();
    this.punch?.kill();
    this.tween = null;
    this.counter.v = from;
    const finalText = format(to);
    this.arrange(finalText);
    this.value.text = format(from);
    this.setShown(true);
    this.body.scale.set(1);
    if (durationMs <= 50 || from === to) {
      this.finish(to);
      return Promise.resolve();
    }
    this.lastTickAt = -1;
    return new Promise((resolve) => {
      const tl = gsap.to(this.counter, {
        v: to,
        duration: sUi(durationMs),
        ease: 'power1.out',
        onUpdate: () => this.onCount(tl),
        onComplete: () => {
          this.tween = null;
          this.finish(to);
          resolve();
        },
        onInterrupt: resolve,
      });
      this.tween = tl;
      gsap.to(this.body.scale, {
        x: HUD_TIMING.countGrowScale,
        y: HUD_TIMING.countGrowScale,
        duration: sUi(durationMs),
        ease: 'power1.in',
      });
    });
  }

  private onCount(tl: gsap.core.Tween): void {
    const txt = this.format(Math.round(this.counter.v));
    if (txt === this.value.text) return;
    this.value.text = txt;
    const t = tl.time();
    if (this.lastTickAt < 0 || (t - this.lastTickAt) * 1000 >= HUD_TIMING.tickInterval) {
      this.lastTickAt = t;
      const p = tl.progress();
      this.ctx.game.broadcast('sfx', { id: 'counter_tick', volume: 0.45, rate: 0.92 + p * 0.45 });
    }
  }

  private finish(to: number): void {
    this.value.text = this.format(to);
    this.ctx.game.broadcast('sfx', { id: 'counter_end' });
    const { punchScale, punchDuration, punchEase } = HUD_TIMING;
    gsap.killTweensOf(this.body.scale);
    this.punch = gsap
      .timeline()
      .to(this.body.scale, { x: punchScale, y: punchScale, duration: sUi(punchDuration * 0.2), ease: 'power2.out' })
      .to(this.body.scale, { x: 1, y: 1, duration: sUi(punchDuration), ease: punchEase });
    gsap.fromTo(
      this.flash,
      { alpha: 0.75 },
      { alpha: 0, duration: sUi(punchDuration * 1.3), ease: 'power2.out', overwrite: true },
    );
  }

  private setShown(on: boolean): void {
    if (on === this.shown) return;
    this.shown = on;
    const d = sUi(HUD_TIMING.fadeDuration);
    gsap.killTweensOf(this, 'alpha');
    if (on) {
      this.visible = true;
      gsap.to(this, { alpha: 1, duration: d, ease: 'power2.out' });
    } else {
      gsap.to(this, { alpha: 0, duration: d, ease: 'power2.in', onComplete: () => void (this.visible = false) });
    }
  }

  /** Lay out label + value around the origin using the width of `widest` (the final amount). */
  private arrange(widest: string): void {
    const cur = this.value.text;
    this.value.scale.set(1);
    this.caption.scale.set(1);
    this.value.text = widest;
    const vw = this.value.width;
    this.value.text = cur;
    const gap = this.labelSize * 0.45;
    if (this.mode === 'row') {
      const lw = this.caption.width;
      const total = lw + gap + vw;
      const k = total > this.maxWidth ? this.maxWidth / total : 1;
      this.caption.scale.set(k);
      this.value.scale.set(k);
      const left = (-total * k) / 2;
      this.caption.position.set(left + lw * k, this.valueSize * 0.04);
      this.value.position.set(left + (lw + gap) * k, 0);
      this.flash.position.set(left + (lw + gap + vw / 2) * k, 0);
      this.flash.scale.set(Math.max(0.6, (vw * k) / (this.valueSize * 4)), 1);
    } else {
      const k = vw > this.maxWidth ? this.maxWidth / vw : 1;
      this.value.scale.set(k);
      this.caption.position.set(0, 0);
      this.value.position.set(0, this.labelSize * 0.12);
      this.flash.position.set(0, this.labelSize * 0.12 + this.valueSize * 0.5);
      this.flash.scale.set(Math.max(0.6, (vw * k) / (this.valueSize * 4)), 1);
    }
  }

  /** Soft warm ellipse used for the end-of-count flash (baked once per layout). */
  private bakeFlash(resolution: number): void {
    const w = this.valueSize * 4;
    const h = this.valueSize * 1.3;
    const g = new Graphics().ellipse(0, 0, w / 2, h / 2).fill({ color: 0xffffff, alpha: 1 });
    const blur = new BlurFilter({ strength: h * 0.35, quality: 4 });
    g.filters = [blur];
    const old = this.flash.texture;
    this.flash.texture = bakeCentered(this.ctx.app.renderer, g, w + h * 2.2, Math.max(0.25, resolution * 0.25));
    if (old !== Texture.EMPTY) old.destroy(true);
    g.destroy();
    blur.destroy();
  }
}
