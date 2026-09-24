import { Container, Sprite } from 'pixi.js';
import { clock } from '../../core/clock';
import { glowTexture, godRaysTexture } from '../textures';

/**
 * Filter-free "god rays" burst for big wins / feature banners: two procedurally
 * generated ray textures counter-rotating (different ray counts so they never
 * line up), plus a soft core glow, all additive. Costs 3 sprites, no RT pass.
 */
export interface GodRaysOptions {
  /** outer diameter in design px */
  size: number;
  color: number;
  /** rad/s of the main layer (the second spins opposite at ~0.6x) */
  speed?: number;
  alpha?: number;
}

export class GodRays extends Container {
  private a: Sprite;
  private b: Sprite;
  private core: Sprite;
  private speed: number;
  private unsub: (() => void) | null = null;
  private t = 0;
  private coreScale = 1;

  constructor(o: GodRaysOptions) {
    super({ label: 'godRays' });
    this.speed = o.speed ?? 0.16;
    this.a = new Sprite({ texture: godRaysTexture(16, 1024, 3), anchor: 0.5, blendMode: 'add' });
    this.b = new Sprite({ texture: godRaysTexture(11, 1024, 7), anchor: 0.5, blendMode: 'add' });
    this.core = new Sprite({ texture: glowTexture(256), anchor: 0.5, blendMode: 'add' });
    this.addChild(this.b, this.a, this.core);
    this.resize(o.size);
    this.color = o.color;
    this.alpha = o.alpha ?? 1;
    this.b.alpha = 0.55;
    this.core.alpha = 0.85;
    this.unsub = clock.onUpdate((dt) => this.tick(dt));
  }

  resize(size: number): void {
    this.a.width = this.a.height = size;
    this.b.width = this.b.height = size * 0.86;
    this.coreScale = (size * 0.62) / this.core.texture.width;
    this.core.scale.set(this.coreScale);
  }

  set color(c: number) {
    this.a.tint = c;
    this.b.tint = c;
    this.core.tint = c;
  }

  private tick(dt: number): void {
    this.t += dt;
    this.a.rotation += this.speed * dt;
    this.b.rotation -= this.speed * 0.62 * dt;
    // slow breathing so the burst feels alive even when nothing else moves
    const k = 1 + Math.sin(this.t * 2.1) * 0.035;
    this.core.scale.set(this.coreScale * k);
  }

  override destroy(): void {
    this.unsub?.();
    this.unsub = null;
    super.destroy({ children: true });
  }
}
