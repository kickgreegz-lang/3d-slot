import { gsap } from 'gsap';
import { Circle, Container, type FederatedPointerEvent, Graphics, Sprite, Texture } from 'pixi.js';
import { sUi } from '../../core/timing';
import type { GameContext } from '../../game/context';
import type { SfxId } from '../../game/events';
import { bakeCentered, hexPath } from './geometry';
import { HUD_TIMING } from './hudTiming';
import type { IconDraw } from './icons';

export interface HexButtonOptions {
  /** debug / automation label */
  label: string;
  /** hex circumradius (visual), design px */
  radius: number;
  /** touch-target radius (>= radius; portrait needs >= 75 => 150 px targets) */
  hitRadius?: number;
  /** clockwise tilt in degrees (reference language: 20°) */
  tilt?: number;
  /** corner rounding as a fraction of the radius */
  corner?: number;
  fill: { color: number; alpha: number };
  rim: { color: number; alpha: number; width: number };
  rimHover?: { color: number; alpha: number };
  icon: IconDraw;
  /** icon box as a fraction of the hex diameter */
  iconScale?: number;
  /** click SFX (null = silent) */
  sfx?: SfxId | null;
  onTap: () => void;
}

type VisualState = 'idle' | 'hover' | 'pressed';

/**
 * Translucent rounded-hex button (reference UI kit): baked vector plate + rim + icon,
 * states default / hover / pressed / disabled. Press = TIMING.ui.pressScale for
 * pressDuration, spring back with a small overshoot; hover = TIMING.ui.hoverScale.
 * Everything visual lives in `face` so the hit area never moves while it animates.
 */
export class HexButton extends Container {
  readonly face = new Container({ label: 'face' });
  protected readonly plate = new Sprite(Texture.EMPTY);
  protected readonly rim = new Sprite(Texture.EMPTY);
  protected readonly iconSprite = new Sprite(Texture.EMPTY);
  protected enabled = true;
  protected shown = true;
  protected visualState: VisualState = 'idle';
  protected resolution = 2;
  protected iconDraw: IconDraw;
  /** extra plate opacity (spin button darkens while a round runs) */
  plateBoost = 0;

  constructor(
    protected readonly ctx: GameContext,
    protected opts: HexButtonOptions,
  ) {
    super({ label: opts.label });
    this.iconDraw = opts.icon;
    this.plate.anchor.set(0.5);
    this.rim.anchor.set(0.5);
    this.iconSprite.anchor.set(0.5);
    this.face.addChild(this.plate, this.rim, this.iconSprite);
    this.addChild(this.face);

    this.eventMode = 'static';
    this.cursor = 'pointer';
    this.updateHitArea();
    this.on('pointerover', () => this.setVisual('hover'));
    this.on('pointerout', () => this.setVisual('idle'));
    this.on('pointerdown', (e: FederatedPointerEvent) => {
      if (e.button > 0) return;
      this.setVisual('pressed');
    });
    this.on('pointerup', () => this.setVisual(this.isTouch() ? 'idle' : 'hover'));
    this.on('pointerupoutside', () => this.setVisual('idle'));
    this.on('pointertap', (e: FederatedPointerEvent) => {
      if (e.button > 0 || !this.enabled) return;
      this.activate();
    });
    this.applyStatic();
  }

  /** Design-space radius of the visual hex. */
  get radius(): number {
    return this.opts.radius;
  }

  /** Update geometry (per layout) — call rebake() afterwards. */
  configure(patch: Partial<HexButtonOptions>): void {
    this.opts = { ...this.opts, ...patch };
    if (patch.icon) this.iconDraw = patch.icon;
    this.updateHitArea();
  }

  /** Re-rasterise plate/rim/icon at `resolution` texels per design px. */
  rebake(resolution: number): void {
    this.resolution = resolution;
    const { radius: r, rim } = this.opts;
    const box = (r + rim.width + 4) * 2;
    this.swap(this.plate, this.drawFill(), box);
    this.swap(this.rim, this.drawRim(), box);
    this.rebakeIcon();
  }

  /** Swap the icon (turbo levels, etc.). */
  setIcon(draw: IconDraw): void {
    this.iconDraw = draw;
    this.rebakeIcon();
  }

  setEnabled(on: boolean): void {
    if (on === this.enabled) return;
    this.enabled = on;
    this.eventMode = on && this.shown ? 'static' : 'none';
    this.cursor = on ? 'pointer' : 'default';
    if (!on) this.visualState = 'idle';
    gsap.to(this.face, { alpha: on ? 1 : 0.42, duration: sUi(HUD_TIMING.fadeDuration), overwrite: 'auto' });
    this.applyStatic();
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /** Show / hide with a soft scale-fade (jurisdiction, replay, free spins). */
  setShown(on: boolean, animate = true): void {
    if (on === this.shown) return;
    this.shown = on;
    // never clickable while fading out
    this.eventMode = on && this.enabled ? 'static' : 'none';
    gsap.killTweensOf(this, 'alpha');
    gsap.killTweensOf(this.scale);
    if (!animate) {
      this.visible = on;
      this.alpha = 1;
      this.scale.set(1);
      return;
    }
    const d = sUi(HUD_TIMING.fadeDuration);
    if (on) {
      this.visible = true;
      this.alpha = 0;
      this.scale.set(0.8);
      gsap.to(this, { alpha: 1, duration: d, ease: 'power2.out' });
      gsap.to(this.scale, { x: 1, y: 1, duration: d * 1.4, ease: 'back.out(2.2)' });
    } else {
      gsap.to(this, { alpha: 0, duration: d, ease: 'power2.in', onComplete: () => void (this.visible = false) });
      gsap.to(this.scale, { x: 0.85, y: 0.85, duration: d, ease: 'power2.in' });
    }
  }

  get isShown(): boolean {
    return this.shown;
  }

  /** Play the press animation without a pointer (keyboard shortcut). */
  pressVisual(): void {
    if (!this.enabled) return;
    const { pressScale, pressDuration, releaseDuration, releaseEase } = HUD_TIMING;
    gsap.killTweensOf(this.face.scale);
    gsap
      .timeline()
      .to(this.face.scale, { x: pressScale, y: pressScale, duration: sUi(pressDuration), ease: 'power2.out' })
      .to(this.face.scale, { x: 1, y: 1, duration: sUi(releaseDuration), ease: releaseEase });
  }

  /** Tap handler: SFX + callback. Subclasses may route differently. */
  protected activate(): void {
    const sfx = this.opts.sfx === undefined ? 'ui_click' : this.opts.sfx;
    if (sfx) this.ctx.game.broadcast('sfx', { id: sfx });
    this.opts.onTap();
  }

  protected drawFill(): Graphics {
    const { radius: r, tilt = 0, corner = 0.2, fill } = this.opts;
    return hexPath(new Graphics(), r, tilt, corner).fill({ color: fill.color, alpha: 1 });
  }

  protected drawRim(): Graphics {
    const { radius: r, tilt = 0, corner = 0.2, rim } = this.opts;
    return hexPath(new Graphics(), r, tilt, corner).stroke({ width: rim.width, color: 0xffffff, alpha: 1 });
  }

  protected rebakeIcon(): void {
    const s = this.opts.radius * 2 * (this.opts.iconScale ?? 0.52);
    this.swap(this.iconSprite, this.iconDraw(s), s * 1.3);
  }

  /** Bake `g` into `sprite` (destroys the previous texture and the source graphics). */
  protected swap(sprite: Sprite, g: Container, box: number, resolution = this.resolution): void {
    const old = sprite.texture;
    sprite.texture = bakeCentered(this.ctx.app.renderer, g, box, resolution);
    if (old !== Texture.EMPTY) old.destroy(true);
    g.destroy({ children: true });
  }

  protected setVisual(s: VisualState): void {
    if (!this.enabled && s !== 'idle') return;
    if (s === this.visualState) return;
    const prev = this.visualState;
    this.visualState = s;
    const { pressScale, pressDuration, hoverScale, hoverDuration, releaseDuration, releaseEase } = HUD_TIMING;
    gsap.killTweensOf(this.face.scale);
    if (s === 'pressed') {
      gsap.to(this.face.scale, { x: pressScale, y: pressScale, duration: sUi(pressDuration), ease: 'power2.out' });
    } else if (prev === 'pressed') {
      const k = s === 'hover' ? hoverScale : 1;
      gsap.to(this.face.scale, { x: k, y: k, duration: sUi(releaseDuration), ease: releaseEase });
    } else {
      const k = s === 'hover' ? hoverScale : 1;
      gsap.to(this.face.scale, { x: k, y: k, duration: sUi(hoverDuration), ease: 'power2.out' });
    }
    this.applyStatic();
    this.onVisualState(s);
  }

  /** Hook for subclasses (spin arrow nudge, glow). */
  protected onVisualState(_s: VisualState): void {}

  /** Colours / alphas for the current state (no tween: these are subtle). */
  protected applyStatic(): void {
    const { fill, rim, rimHover } = this.opts;
    const s = this.enabled ? this.visualState : 'idle';
    this.plate.alpha = Math.min(1, fill.alpha + this.plateBoost + (s === 'pressed' ? 0.08 : s === 'hover' ? 0.04 : 0));
    const hot = s !== 'idle' && rimHover;
    this.rim.tint = hot ? rimHover.color : rim.color;
    this.rim.alpha = hot ? rimHover.alpha : rim.alpha;
    this.iconSprite.tint = this.enabled ? (s === 'idle' ? 0xe8e8e8 : 0xffffff) : 0x8a8a8a;
  }

  private updateHitArea(): void {
    this.hitArea = new Circle(0, 0, Math.max(this.opts.hitRadius ?? 0, this.opts.radius * 0.95));
  }

  private isTouch(): boolean {
    return typeof matchMedia === 'function' && matchMedia('(hover: none)').matches;
  }
}
