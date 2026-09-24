import { gsap } from 'gsap';
import { Container, Sprite, Texture } from 'pixi.js';
import type { ParticleKey } from '../assets/art';
import { clock } from '../core/clock';
import { s } from '../core/timing';
import type { GameContext, GameModule } from '../game/context';
import type { GameEvents } from '../game/events';
import { configureFilterBudget } from './filters/budget';
import { configureFilterQuality, pulseShockwave } from './filters/effects';
import { ParticleSystem } from './particles';
import { type BurstContext, spawnBurst } from './presets';
import { ScreenShake } from './shake';

/** Local FX tuning (candidates for TIMING.fx — see contract requests). */
export const FX_TIMING = {
  flash: { defaultDuration: 150, defaultAlpha: 0.35 },
  /** scatter hit: displacement ring on the whole design space */
  scatterShock: { duration: 560, radius: 540, amplitude: 22, width: 150 },
} as const;

/**
 * FX module: particles, camera shake and screen flashes.
 *
 *   'fx:burst'  {kind,x,y,color?,count?,power?} -> layered particle preset at design (root) coords
 *   'fx:shake'  {trauma}                        -> trauma-based camera shake on layers.root
 *   'fx:flash'  {color?,alpha?,durationMs?}     -> additive full-screen flash in layers.screenFx
 *
 * Everything advances on `clock.onUpdate`, so hit-stop freezes particles and shake.
 */
export class Fx implements GameModule {
  private particles!: ParticleSystem;
  private shake: ScreenShake;
  private flash!: Sprite;
  private flashTween: gsap.core.Tween | null = null;
  private burstCtx!: BurstContext;
  private textures = new Map<ParticleKey, Texture>();
  private offs: Array<() => void> = [];

  constructor(private ctx: GameContext) {
    this.shake = new ScreenShake(ctx);
  }

  init(): void {
    const { ctx } = this;
    configureFilterBudget(ctx.budget.maxFilters);
    configureFilterQuality(ctx.tier);

    const holder = new Container({ label: 'fx:particles' });
    ctx.layers.fx.addChild(holder);
    this.particles = new ParticleSystem(holder, ctx.budget.maxParticles);
    this.burstCtx = {
      sys: this.particles,
      tex: (key) => this.texture(key),
      layout: ctx.layout,
    };

    this.flash = new Sprite({ texture: Texture.WHITE, label: 'fx:flash', blendMode: 'add', alpha: 0 });
    this.flash.visible = false;
    ctx.layers.screenFx.addChild(this.flash);
    this.layout();

    const g = ctx.game;
    this.offs.push(
      g.on('fx:burst', (p) => this.burst(p)),
      g.on('fx:shake', ({ trauma }) => this.shake.add(trauma)),
      g.on('fx:flash', (p) => this.doFlash(p)),
      g.on('layout:change', () => this.layout()),
      clock.onUpdate((dt) => {
        this.particles.update(dt);
        this.shake.update(dt);
      }),
    );
  }

  layout(): void {
    const L = this.ctx.layout;
    this.burstCtx.layout = L;
    // screenFx is cover-scaled in design space: overshoot so the flash reaches every edge
    const pad = Math.max(L.width, L.height);
    this.flash.position.set(-pad, -pad);
    this.flash.width = L.width + pad * 2;
    this.flash.height = L.height + pad * 2;
  }

  private texture(key: ParticleKey): Texture {
    let t = this.textures.get(key);
    if (!t) {
      t = this.ctx.art.particle(key);
      this.textures.set(key, t);
    }
    return t;
  }

  private burst(p: GameEvents['fx:burst']): void {
    spawnBurst(this.burstCtx, p);
    if (p.kind === 'scatter') {
      const o = FX_TIMING.scatterShock;
      const k = this.ctx.layout.cell / 150;
      pulseShockwave({ target: this.ctx.layers.root, layout: this.ctx.layout }, p.x, p.y, {
        duration: s(o.duration),
        radius: o.radius * k * (p.power ?? 1),
        amplitude: o.amplitude * k,
        width: o.width * k,
      });
    }
  }

  private doFlash(p: GameEvents['fx:flash']): void {
    const f = this.flash;
    const alpha = p.alpha ?? FX_TIMING.flash.defaultAlpha;
    this.flashTween?.kill();
    f.tint = p.color ?? 0xffffff;
    f.alpha = Math.max(f.visible ? f.alpha : 0, alpha);
    f.visible = true;
    this.flashTween = gsap.to(f, {
      alpha: 0,
      duration: s(p.durationMs ?? FX_TIMING.flash.defaultDuration),
      ease: 'power2.out',
      onComplete: () => {
        f.visible = false;
        this.flashTween = null;
      },
    });
  }

  destroy(): void {
    for (const off of this.offs) off();
    this.offs = [];
    this.flashTween?.kill();
    this.particles.destroy();
    this.shake.reset();
    this.flash.destroy();
  }
}
