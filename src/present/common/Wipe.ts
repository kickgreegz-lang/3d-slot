import { gsap } from 'gsap';
import { Container, Graphics } from 'pixi.js';
import type { LayoutSpec } from '../../config/layout';

/**
 * Transition "swoosh": three slanted, black-outlined colour bands (gold / magenta /
 * cyan) that sweep across the whole screen. Used as the accent on feature
 * intros/outros while the stage dims underneath — reads as a deliberate scene
 * change rather than a fade.
 */
const BANDS = [
  { w: 64, color: 0xffd54a },
  { w: 190, color: 0xff3fa8 },
  { w: 118, color: 0x35f2e0 },
] as const;

const SLANT = Math.tan((22 * Math.PI) / 180);

export class Wipe extends Container {
  private bands: Graphics[] = [];
  private span = { from: 0, to: 0 };

  constructor() {
    super({ label: 'wipe' });
    for (let i = 0; i < BANDS.length; i++) {
      const g = new Graphics();
      this.bands.push(g);
      this.addChild(g);
    }
    this.visible = false;
  }

  private build(L: LayoutSpec): void {
    const pad = Math.max(L.width, L.height) * 0.5;
    const top = -pad;
    const bottom = L.height + pad;
    const h = bottom - top;
    const skew = h * SLANT;
    BANDS.forEach((b, i) => {
      this.bands[i]
        .clear()
        .poly([skew, top, skew + b.w, top, b.w, bottom, 0, bottom])
        .fill({ color: b.color })
        .stroke({ width: 5, color: 0x000000, join: 'miter' });
    });
    this.span.from = -pad - skew - 260;
    this.span.to = L.width + pad + 60;
  }

  /**
   * Sweep across the screen. dir 1 = left -> right, -1 = right -> left.
   * Resolves when the last band has left the screen.
   */
  sweep(L: LayoutSpec, dir: 1 | -1, duration: number, stagger: number): Promise<void> {
    this.build(L);
    this.visible = true;
    const from = dir === 1 ? this.span.from : this.span.to;
    const to = dir === 1 ? this.span.to : this.span.from;
    return new Promise((resolve) => {
      const tl = gsap.timeline({
        onComplete: () => {
          this.visible = false;
          resolve();
        },
      });
      const order = dir === 1 ? [...this.bands].reverse() : this.bands;
      order.forEach((g, i) => {
        const offset = dir === 1 ? -i * 36 : i * 36;
        g.x = from + offset;
        tl.to(g, { x: to + offset, duration, ease: 'power2.inOut' }, i * stagger);
      });
    });
  }
}
