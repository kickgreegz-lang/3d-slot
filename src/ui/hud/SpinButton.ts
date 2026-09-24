import { gsap } from 'gsap';
import { BlurFilter, Graphics, Sprite, type Text, Texture } from 'pixi.js';
import { clock } from '../../core/clock';
import { sUi } from '../../core/timing';
import type { GameContext } from '../../game/context';
import { hexPath } from './geometry';
import { HexButton, type HexButtonOptions } from './HexButton';
import { HUD_TIMING } from './hudTiming';
import { spinArrowIcon, stopIcon } from './icons';
import { type TextPool, fitWidth, valueStyle } from './theme';

export type SpinMode = 'idle' | 'spinning' | 'autoplay' | 'disabled';

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
/** icon box as a fraction of the hex diameter (reference: arrow ≈ 60 % of the button) */
const ICON_SCALE = 0.62;
/** inner radius of the ring arrow as a fraction of the icon box (see icons.spinArrowIcon) */
const HOLE = 0.23;

/**
 * The big tilted SPIN hex. Idle: slow breathing halo + an occasional attract turn.
 * Round running: the ring arrow spins up and a stop square appears in its hole
 * (tap = skip). Autoplay: the hole shows the rounds left (tap = stop autoplay).
 * The HUD decides what a tap means; this class only renders the mode.
 */
export class SpinButton extends HexButton {
  private readonly glow = new Sprite(Texture.EMPTY);
  /** soft contact shadow of the arrow toward the lower-right (key light top-left) */
  private readonly iconShadow = new Sprite(Texture.EMPTY);
  private readonly stop = new Sprite(Texture.EMPTY);
  private readonly count: Text;
  private mode: SpinMode = 'idle';
  private autoText = '';
  /** ring angular velocity (rad/s) */
  omega = 0;
  private breathe: gsap.core.Tween | null = null;
  private readonly offTick: () => void;
  private attract: gsap.core.Timeline | null = null;

  constructor(ctx: GameContext, opts: HexButtonOptions, texts: TextPool) {
    super(ctx, { ...opts, icon: (s) => spinArrowIcon(s), iconScale: ICON_SCALE });
    this.glow.anchor.set(0.5);
    this.glow.blendMode = 'add';
    this.glow.tint = 0xfff1d0;
    this.glow.alpha = 0;
    this.face.addChildAt(this.glow, 0);
    this.iconShadow.anchor.set(0.5);
    this.iconShadow.tint = 0x000000;
    this.iconShadow.alpha = 0.38;
    this.face.addChildAt(this.iconShadow, this.face.getChildIndex(this.iconSprite));
    this.stop.anchor.set(0.5);
    this.stop.scale.set(0);
    this.count = texts.make('', valueStyle(40));
    this.count.scale.set(0);
    this.face.addChild(this.stop, this.count);
    this.offTick = clock.onUpdate((dt) => {
      if (this.omega !== 0) this.iconSprite.rotation = (this.iconSprite.rotation + this.omega * dt) % (TAU * 64);
      this.iconShadow.rotation = this.iconSprite.rotation;
    });
    this.enterIdle();
  }

  override rebake(resolution: number): void {
    super.rebake(resolution);
    const { radius: r, tilt = 0, corner = 0.2 } = this.opts;
    const blur = r * 0.16;
    const halo = hexPath(new Graphics(), r * 1.02, tilt, corner).fill({ color: 0xffffff, alpha: 1 });
    const filter = new BlurFilter({ strength: blur, quality: 4 });
    halo.filters = [filter];
    // the halo is soft, so half the density is plenty
    this.swap(this.glow, halo, (r + blur * 3) * 2, resolution * 0.5);
    filter.destroy();
    const iconBox = r * 2 * ICON_SCALE;
    this.iconShadow.texture = this.iconSprite.texture;
    this.iconShadow.position.set(r * 0.025, r * 0.04);
    this.swap(this.stop, stopIcon(iconBox * HOLE * 0.86), iconBox * HOLE * 1.4);
    const font = Math.round(iconBox * 0.3);
    this.count.style.fontSize = font;
    this.fitCount();
  }

  /** Render the round / autoplay state. `autoRemaining`: null = no autoplay, Infinity/-1 = ∞. */
  setMode(mode: SpinMode, autoRemaining: number | null): void {
    const txt = autoRemaining === null ? '' : !Number.isFinite(autoRemaining) || autoRemaining < 0 ? '∞' : String(autoRemaining);
    if (txt !== this.autoText) {
      const bump = this.autoText !== '' && txt !== '';
      this.autoText = txt;
      this.count.text = txt;
      this.fitCount();
      if (bump && mode === 'autoplay') this.bumpCount();
    }
    if (mode === this.mode) return;
    const prev = this.mode;
    this.mode = mode;
    this.setEnabled(mode !== 'disabled');
    if (prev === 'idle' || prev === 'disabled') this.leaveIdle();
    const swap = sUi(HUD_TIMING.centerSwap);
    const showStop = mode === 'spinning';
    const showCount = mode === 'autoplay';
    gsap.to(this.stop.scale, { x: showStop ? 1 : 0, y: showStop ? 1 : 0, duration: swap, ease: showStop ? 'back.out(2.5)' : 'power2.in', overwrite: true });
    gsap.to(this.count.scale, {
      x: showCount ? this.countScale : 0,
      y: showCount ? this.countScale : 0,
      duration: swap,
      ease: showCount ? 'back.out(2.5)' : 'power2.in',
      overwrite: true,
    });
    // the plate darkens so the stop / count affordance pops over busy mascot art
    gsap.to(this, {
      plateBoost: mode === 'spinning' || mode === 'autoplay' ? 0.28 : 0,
      duration: swap,
      overwrite: 'auto',
      onUpdate: () => this.applyStatic(),
    });
    // the ring steps back while the hole shows the stop / count affordance
    const ringAlpha = mode === 'idle' || mode === 'disabled' ? 1 : 0.5;
    gsap.to([this.iconSprite, this.iconShadow], { alpha: (i: number) => (i === 0 ? ringAlpha : ringAlpha * 0.38), duration: swap, overwrite: 'auto' });
    if (mode === 'spinning') this.spinUp(TAU / (HUD_TIMING.spinRevolution / 1000));
    else if (mode === 'autoplay') this.spinUp(TAU / (HUD_TIMING.autoRevolution / 1000));
    else this.settle();
    if (mode === 'idle') this.enterIdle();
  }

  /** Autoplay count pops when it decrements. */
  private bumpCount(): void {
    const k = this.countScale;
    gsap.fromTo(this.count.scale, { x: k * 1.3, y: k * 1.3 }, { x: k, y: k, duration: sUi(HUD_TIMING.fsPunch), ease: 'back.out(3)', overwrite: true });
  }

  private countScale = 1;
  private fitCount(): void {
    const iconBox = this.opts.radius * 2 * ICON_SCALE;
    const max = iconBox * HOLE * 1.9;
    const shown = this.count.scale.x > 0.01;
    fitWidth(this.count, max);
    this.countScale = this.count.scale.x;
    if (!shown || this.mode !== 'autoplay') this.count.scale.set(this.mode === 'autoplay' ? this.countScale : 0);
  }

  private spinUp(target: number): void {
    gsap.killTweensOf(this.iconSprite, 'rotation');
    gsap.to(this, { omega: target, duration: sUi(HUD_TIMING.spinRampUp), ease: 'power2.in', overwrite: 'auto' });
  }

  /** Coast to the next upright position with the current angular velocity (power3.out slope match). */
  private settle(): void {
    gsap.killTweensOf(this, 'omega');
    const w = this.omega;
    this.omega = 0;
    const rot = this.iconSprite.rotation;
    if (w <= 0.01) {
      gsap.to(this.iconSprite, { rotation: Math.round(rot / TAU) * TAU, duration: sUi(HUD_TIMING.spinSettle), ease: 'power3.out' });
      return;
    }
    let target = Math.ceil(rot / TAU) * TAU;
    if (target - rot < Math.PI * 0.6) target += TAU;
    const dur = Math.min(1.4, Math.max(sUi(HUD_TIMING.spinSettle) * 0.6, (3 * (target - rot)) / w));
    gsap.to(this.iconSprite, {
      rotation: target,
      duration: dur,
      ease: 'power3.out',
      onComplete: () => void (this.iconSprite.rotation = 0),
    });
  }

  private enterIdle(): void {
    this.breathe?.kill();
    this.glow.alpha = 0.06;
    this.breathe = gsap.to(this.glow, {
      alpha: 0.26,
      duration: sUi(HUD_TIMING.breathePeriod / 2),
      ease: 'sine.inOut',
      yoyo: true,
      repeat: -1,
    });
    this.attract?.kill();
    this.attract = gsap
      .timeline({ delay: sUi(HUD_TIMING.attractDelay), repeat: -1, repeatDelay: sUi(HUD_TIMING.attractRepeat) })
      .to(this.iconSprite, { rotation: `+=${TAU}`, duration: sUi(HUD_TIMING.attractDuration), ease: 'back.inOut(1.6)' })
      .set(this.iconSprite, { rotation: 0 });
  }

  private leaveIdle(): void {
    this.breathe?.kill();
    this.breathe = null;
    this.attract?.kill();
    this.attract = null;
    gsap.to(this.glow, { alpha: 0.04, duration: sUi(HUD_TIMING.fadeDuration), overwrite: true });
  }

  protected override onVisualState(s: 'idle' | 'hover' | 'pressed'): void {
    if (this.mode !== 'idle') return;
    this.attract?.pause();
    const nudge = s === 'idle' ? 0 : HUD_TIMING.hoverNudge * DEG;
    gsap.to(this.iconSprite, {
      rotation: nudge,
      duration: sUi(HUD_TIMING.releaseDuration),
      ease: 'back.out(2.2)',
      overwrite: 'auto',
      onComplete: () => {
        if (s === 'idle') this.attract?.restart(true);
      },
    });
    if (this.breathe) this.breathe.timeScale(s === 'idle' ? 1 : 3);
  }

  protected override applyStatic(): void {
    super.applyStatic();
    this.iconSprite.tint = this.enabled ? 0xffffff : 0x9a9a9a;
  }

  override destroy(options?: Parameters<HexButton['destroy']>[0]): void {
    this.offTick();
    this.breathe?.kill();
    this.attract?.kill();
    super.destroy(options);
  }
}
