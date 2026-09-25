import { gsap } from 'gsap';
import { Container, Graphics } from 'pixi.js';
import type { Rect } from '../../../config/layout';
import { followSpeed } from '../../../core/timing';
import { INK, type SkinLook } from './look';

const STRIPE_GAP = 10;
const SLANT = Math.tan((20 * Math.PI) / 180);

type Stop = 'start' | 'cover' | 'end';

/**
 * Feature transition curtain in the FEATURE colour (Juke Jam gold, Mega Mix pink): the
 * engine's present/common/Wipe geometry (a slanted dark band with black-outlined stripes on
 * both edges, sweeping left -> right until it covers the screen, then carrying on to reveal
 * the game) with the stripe set and body tone taken from the skin, since the engine Wipe's
 * stripes are fixed cyan / gold / magenta. Sweeps are gameplay time (s(), followSpeed): a
 * slam-stop retimes a running sweep. `relayout` keeps a running sweep (and its promise) at
 * the same progress on a resize / rotation.
 */
export class FeatureWipe extends Container {
  private readonly g = new Graphics();
  private geo: Record<Stop, number> = { start: 0, cover: 0, end: 0 };
  private leg: { from: Stop; to: Stop; u: number } = { from: 'start', to: 'start', u: 1 };
  private tween: gsap.core.Tween | null = null;
  private skin: SkinLook | null = null;
  private view: Rect | null = null;
  private done: (() => void) | null = null;

  constructor(private readonly bodyAlpha = 0.9) {
    super({ label: 'featureWipe' });
    this.addChild(this.g);
    this.visible = false;
  }

  private build(): void {
    const view = this.view;
    const skin = this.skin;
    if (!view || !skin) return;
    const m = 8;
    const left = view.x - m;
    const right = view.x + view.w + m;
    const top = view.y - m;
    const bottom = view.y + view.h + m;
    const skew = (bottom - top) * SLANT;
    const bodyW = right - left + skew;
    const stripes = skin.wipe.stripes;
    const stripesW = stripes.reduce((a, s) => a + s.w + STRIPE_GAP, 0);
    const g = this.g.clear();
    const para = (x0: number, w: number): number[] => [x0 + skew, top, x0 + skew + w, top, x0 + w, bottom, x0, bottom];
    g.poly(para(0, bodyW)).fill({ color: skin.wipe.body, alpha: this.bodyAlpha });
    let x = bodyW + STRIPE_GAP;
    for (const s of stripes) {
      g.poly(para(x, s.w)).fill({ color: s.color }).stroke({ width: 5, color: INK, join: 'miter' });
      x += s.w + STRIPE_GAP;
    }
    x = -STRIPE_GAP;
    for (const s of stripes) {
      x -= s.w;
      g.poly(para(x, s.w)).fill({ color: s.color }).stroke({ width: 5, color: INK, join: 'miter' });
      x -= STRIPE_GAP;
    }
    this.geo.cover = left - skew;
    this.geo.start = left - skew - bodyW - stripesW;
    this.geo.end = right + stripesW;
  }

  /** Sweep in until the band covers `view` (visible design rect). Resolves when covered. */
  coverIn(view: Rect, skin: SkinLook, duration: number): Promise<void> {
    this.view = view;
    this.skin = skin;
    this.build();
    this.visible = true;
    return this.to('start', 'cover', duration);
  }

  /** Continue the sweep off the right edge, revealing the game. */
  coverOut(duration: number): Promise<void> {
    return this.to('cover', 'end', duration).then(() => {
      this.visible = false;
    });
  }

  /** Jump to the end of the current sweep (round start / teardown): its promise resolves now. */
  finish(): void {
    if (!this.tween) return;
    this.tween.progress(1);
  }

  /** New visible rect while showing: rebuild and keep the running sweep at the same progress. */
  relayout(view: Rect): void {
    this.view = view;
    if (!this.visible) return;
    this.build();
    this.place();
  }

  get covering(): boolean {
    return this.visible && this.leg.to === 'cover';
  }

  private place(): void {
    const { from, to, u } = this.leg;
    this.x = this.geo[from] + (this.geo[to] - this.geo[from]) * u;
  }

  private to(from: Stop, to: Stop, duration: number): Promise<void> {
    this.tween?.kill();
    this.done?.();
    const leg = (this.leg = { from, to, u: 0 });
    this.place();
    return new Promise((resolve) => {
      this.done = resolve;
      this.tween = followSpeed(
        gsap.to(leg, {
          u: 1,
          duration,
          ease: 'power2.inOut',
          onUpdate: () => this.place(),
          onComplete: () => {
            this.tween = null;
            this.done = null;
            resolve();
          },
        }),
      );
    });
  }

  override destroy(): void {
    this.tween?.kill();
    this.done?.();
    super.destroy({ children: true });
  }
}
