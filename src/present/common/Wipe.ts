import { gsap } from 'gsap';
import { Container, Graphics } from 'pixi.js';
import type { LayoutSpec } from '../../config/layout';

/**
 * Feature transition "curtain": a dark slanted band with gold / magenta / cyan
 * black-outlined stripes on both edges. `coverIn` sweeps it across until it covers
 * the whole screen (it then IS the backdrop of the banner), `coverOut` carries on in
 * the same direction so the trailing stripes reveal the game underneath — a proper
 * directional scene change instead of a fade.
 */
const STRIPES = [
  { w: 150, color: 0x35f2e0 },
  { w: 44, color: 0xffd54a },
  { w: 110, color: 0xff3fa8 },
] as const;
const STRIPE_GAP = 10;
const SLANT = Math.tan((20 * Math.PI) / 180);
const BODY = 0x0b0620;

export class Wipe extends Container {
  private g = new Graphics();
  private geo = { start: 0, cover: 0, end: 0 };
  private tween: gsap.core.Tween | null = null;

  constructor(private bodyAlpha = 0.88) {
    super({ label: 'wipe' });
    this.addChild(this.g);
    this.visible = false;
  }

  private build(L: LayoutSpec): void {
    const pad = Math.max(L.width, L.height) * 0.5;
    const top = -pad;
    const bottom = L.height + pad;
    const skew = (bottom - top) * SLANT;
    const bodyW = L.width + pad * 2 + skew;
    const stripesW = STRIPES.reduce((a, s) => a + s.w + STRIPE_GAP, 0);
    const g = this.g.clear();
    const para = (x0: number, w: number): number[] => [x0 + skew, top, x0 + skew + w, top, x0 + w, bottom, x0, bottom];
    g.poly(para(0, bodyW)).fill({ color: BODY, alpha: this.bodyAlpha });
    // leading edge stripes (right) and trailing edge stripes (left, mirrored order)
    let x = bodyW + STRIPE_GAP;
    for (const s of STRIPES) {
      g.poly(para(x, s.w)).fill({ color: s.color }).stroke({ width: 5, color: 0x000000, join: 'miter' });
      x += s.w + STRIPE_GAP;
    }
    x = -STRIPE_GAP;
    for (const s of STRIPES) {
      x -= s.w;
      g.poly(para(x, s.w)).fill({ color: s.color }).stroke({ width: 5, color: 0x000000, join: 'miter' });
      x -= STRIPE_GAP;
    }
    this.geo.cover = -pad - skew;
    this.geo.start = -pad - skew - bodyW - stripesW;
    this.geo.end = L.width + pad + stripesW;
  }

  /** Sweep in (left -> right) until the band covers the screen. */
  coverIn(L: LayoutSpec, duration: number): Promise<void> {
    this.build(L);
    this.visible = true;
    this.x = this.geo.start;
    return this.to(this.geo.cover, duration, 'power3.out');
  }

  /** Continue the sweep off the right edge, revealing what is underneath. */
  coverOut(duration: number): Promise<void> {
    return this.to(this.geo.end, duration, 'power2.in').then(() => {
      this.visible = false;
    });
  }

  private to(x: number, duration: number, ease: string): Promise<void> {
    this.tween?.kill();
    return new Promise((resolve) => {
      this.tween = gsap.to(this, { x, duration, ease, onComplete: () => resolve() });
    });
  }
}
