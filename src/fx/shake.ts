import { TIMING } from '../core/timing';
import type { GameContext } from '../game/context';
import { noise1 } from './util';

/**
 * Trauma-based camera shake (Squirrel Eiserloh, "Juicing your cameras").
 *   trauma accumulates from 'fx:shake' (clamped 0..1) and decays linearly;
 *   offset = maxOffset * trauma² * noise(t * frequency), angle likewise, with
 *   independent smooth noise channels for x / y / angle.
 *
 * Applied to `layers.root` WITHOUT fighting the layout manager: every frame the
 * base (contain-scaled, centred) position is recomputed from ctx.layout/ctx.scale
 * exactly like render/layout.ts does, and the shake is added on top — rotating
 * about the design centre. When trauma reaches 0 the root is restored exactly.
 */
export class ScreenShake {
  private trauma = 0;
  private time = 0;
  private active = false;

  constructor(private ctx: GameContext) {}

  add(amount: number): void {
    this.trauma = Math.min(1, Math.max(0, this.trauma + amount));
  }

  get value(): number {
    return this.trauma;
  }

  update(dt: number): void {
    if (this.trauma <= 0) {
      if (this.active) this.apply(0, 0, 0);
      this.active = false;
      return;
    }
    this.active = true;
    this.time += dt;
    const cfg = TIMING.shake;
    const t2 = this.trauma * this.trauma;
    const f = this.time * cfg.frequency;
    const ox = cfg.maxOffset * t2 * noise1(f, 1);
    const oy = cfg.maxOffset * t2 * noise1(f, 2);
    const ang = ((cfg.maxAngle * Math.PI) / 180) * t2 * noise1(f * 0.8, 3);
    this.trauma = Math.max(0, this.trauma - cfg.decayPerSecond * dt);
    this.apply(ox, oy, ang);
  }

  /** Force the root back to its layout position (e.g. on destroy). */
  reset(): void {
    this.trauma = 0;
    this.apply(0, 0, 0);
    this.active = false;
  }

  private apply(ox: number, oy: number, angle: number): void {
    const { app, layers, layout: L, scale } = this.ctx;
    const root = layers.root;
    const bx = (app.screen.width - L.width * scale) / 2;
    const by = (app.screen.height - L.height * scale) / 2;
    const cx = (L.width * scale) / 2;
    const cy = (L.height * scale) / 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    root.rotation = angle;
    root.position.set(bx + cx - (cos * cx - sin * cy) + ox * scale, by + cy - (sin * cx + cos * cy) + oy * scale);
  }
}
