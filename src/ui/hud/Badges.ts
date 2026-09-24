import { gsap } from 'gsap';
import { Container, Graphics, Sprite, type Text, Texture } from 'pixi.js';
import { sUi } from '../../core/timing';
import type { GameContext } from '../../game/context';
import { bakeCentered, hexPath } from './geometry';
import { HUD_TIMING } from './hudTiming';
import { HUD_COLORS, type TextPool, fitWidth, labelStyle, valueStyle } from './theme';

/** Shared show/hide for passive HUD badges. */
const fade = (c: Container, on: boolean): void => {
  gsap.killTweensOf(c, 'alpha');
  gsap.killTweensOf(c.scale);
  const d = sUi(HUD_TIMING.fadeDuration);
  if (on) {
    c.visible = true;
    gsap.fromTo(c, { alpha: 0 }, { alpha: 1, duration: d, ease: 'power2.out' });
    gsap.fromTo(c.scale, { x: 0.8, y: 0.8 }, { x: 1, y: 1, duration: d * 1.5, ease: 'back.out(2.2)' });
  } else {
    gsap.to(c, { alpha: 0, duration: d, ease: 'power2.in', onComplete: () => void (c.visible = false) });
  }
};

/**
 * FREE SPINS counter hex (takes the bonus-buy slot — buying is never possible
 * during the feature). Neutral glass with a yellow rim; punches on every change.
 */
export class FsBadge extends Container {
  private readonly plate = new Sprite(Texture.EMPTY);
  private readonly caption: Text;
  private readonly value: Text;
  private r = 80;
  private shown = false;

  constructor(
    private readonly ctx: GameContext,
    texts: TextPool,
    labelText: string,
  ) {
    super({ label: 'freeSpins' });
    this.plate.anchor.set(0.5);
    this.caption = texts.make(labelText, labelStyle(26));
    this.value = texts.make('', valueStyle(44));
    this.addChild(this.plate, this.caption, this.value);
    this.visible = false;
  }

  configure(radius: number, tilt: number, labelSize: number, valueSize: number, resolution: number): void {
    this.r = radius;
    const g = new Graphics();
    hexPath(g, radius, tilt, 0.22).fill({ color: 0x07050c, alpha: 0.62 });
    hexPath(g, radius, tilt, 0.22).stroke({ width: 2.5, color: HUD_COLORS.label, alpha: 0.75 });
    const old = this.plate.texture;
    this.plate.texture = bakeCentered(this.ctx.app.renderer, g, (radius + 6) * 2, resolution);
    if (old !== Texture.EMPTY) old.destroy(true);
    g.destroy();
    this.caption.style = labelStyle(labelSize);
    this.value.style = valueStyle(valueSize);
    this.caption.position.set(0, -radius * 0.3);
    this.value.position.set(0, radius * 0.16);
    fitWidth(this.caption, radius * 1.45);
    fitWidth(this.value, radius * 1.45);
  }

  setLabel(text: string): void {
    this.caption.text = text;
    fitWidth(this.caption, this.r * 1.45);
  }

  /** null hides the badge. */
  setCount(text: string | null): void {
    const on = text !== null;
    if (on && text !== this.value.text) {
      const changed = this.value.text !== '' && this.shown;
      this.value.text = text;
      fitWidth(this.value, this.r * 1.45);
      if (changed) {
        const k = this.value.scale.x;
        gsap.fromTo(
          this.value.scale,
          { x: k * 1.35, y: k * 1.35 },
          { x: k, y: k, duration: sUi(HUD_TIMING.fsPunch * 1.6), ease: 'back.out(3)', overwrite: true },
        );
      }
    }
    if (on !== this.shown) {
      this.shown = on;
      fade(this, on);
    }
  }
}

/** Pulsing red-dot "REPLAY" chip (replay mode hides balance / bet / autoplay / buy). */
export class ReplayChip extends Container {
  private readonly plate = new Sprite(Texture.EMPTY);
  private readonly dot = new Graphics();
  private readonly text: Text;
  private shown = false;
  private pulse: gsap.core.Tween | null = null;

  constructor(
    private readonly ctx: GameContext,
    texts: TextPool,
    labelText: string,
  ) {
    super({ label: 'replay' });
    this.plate.anchor.set(0, 0.5);
    this.text = texts.make(labelText, labelStyle(28, 0xffffff), 0, 0.5);
    this.addChild(this.plate, this.dot, this.text);
    this.visible = false;
  }

  configure(size: number, resolution: number): void {
    this.text.style = { ...labelStyle(size, 0xffffff), stroke: { color: 0x000000, width: 0 } };
    const h = size * 1.55;
    const pad = size * 0.55;
    const dotR = size * 0.2;
    const tw = this.text.width;
    const w = pad + dotR * 2 + size * 0.35 + tw + pad;
    const g = new Graphics()
      .roundRect(-w / 2, -h / 2, w, h, h / 2)
      .fill({ color: 0x05030a, alpha: 0.72 })
      .stroke({ width: 1.5, color: 0xffffff, alpha: 0.22 });
    const old = this.plate.texture;
    const tex = bakeCentered(this.ctx.app.renderer, g, w + 8, resolution);
    this.plate.texture = tex;
    this.plate.anchor.set(0.5);
    this.plate.position.set(w / 2, 0);
    if (old !== Texture.EMPTY) old.destroy(true);
    g.destroy();
    this.dot.clear().circle(0, 0, dotR).fill(HUD_COLORS.replay);
    this.dot.position.set(pad + dotR, 0);
    this.text.position.set(pad + dotR * 2 + size * 0.35, size * 0.04);
  }

  setShown(on: boolean): void {
    if (on === this.shown) return;
    this.shown = on;
    fade(this, on);
    this.pulse?.kill();
    this.pulse = on
      ? gsap.fromTo(
          this.dot,
          { alpha: 1 },
          { alpha: 0.25, duration: sUi(HUD_TIMING.replayPulse / 2), ease: 'sine.inOut', yoyo: true, repeat: -1 },
        )
      : null;
  }
}
