import { gsap } from 'gsap';
import { Container, Sprite, Texture } from 'pixi.js';
import type { ParticleKey } from '../assets/art';
import { FEATURES } from '../config/game';
import type { LayoutKind, Rect } from '../config/layout';
import { clock } from '../core/clock';
import { registerTiming, s } from '../core/timing';
import type { GameContext, GameModule } from '../game/context';
import type { GameEvents } from '../game/events';
import { configureFilterBudget } from './filters/budget';
import { configureFilterQuality, pulseShockwave, refitPulses } from './filters/effects';
import { configureParticleBudget, ParticleSystem } from './particles';
import { type BurstContext, spawnBurst } from './presets';
import { ScreenShake } from './shake';
import { clamp01, mix32, mixStr, seedFx } from './util';

/** Local FX tuning (candidates for TIMING.fx — see contract requests). */
export const FX_TIMING = registerTiming('fx', {
  /**
   * Full-screen flashes. Limiter (CR-7, photosensitivity): at most `maxPerSecond` flash
   * starts in any 1 s window of wall time AND at least `minGap` ms between two starts;
   * a flash over the limit is DROPPED (never queued).
   */
  flash: { defaultDuration: 150, defaultAlpha: 0.35, maxPerSecond: 3, minGap: 334 },
  /** scatter hit: displacement ring on the whole design space */
  scatterShock: { duration: 560, radius: 540, amplitude: 22, width: 150 },
} as const);

/**
 * FX module: particles, camera shake and screen flashes.
 *
 *   'fx:burst'  {kind,x,y,color?,count?,power?} -> layered particle preset at design (root) coords
 *   'fx:shake'  {trauma}                        -> trauma-based camera shake on layers.root
 *   'fx:flash'  {color?,alpha?,durationMs?}     -> additive full-screen flash in layers.screenFx
 *                                                  (limiter: <= 3 starts/s, >= 334 ms apart; excess dropped)
 *
 * Everything advances on `clock.onUpdate`, so hit-stop freezes particles and shake.
 *
 * Owns the global particle budget (ctx.budget.maxParticles, shared by every ParticleSystem;
 * this module's own system leaves FEATURES.particleReserve of it to the game's systems) and
 * the seeded cosmetic RNG: each burst reseeds it from the round seed (a hash of the last
 * 'board:reveal' board), the burst's index in that round and its payload, so a replayed book
 * spawns the same particles. A 'layout:change' refits (resize) or stops (new design space)
 * a live shockwave / chromatic pulse, which would otherwise stay clipped to the old rect.
 */
export class Fx implements GameModule {
  private particles!: ParticleSystem;
  private shake: ScreenShake;
  private flash!: Sprite;
  private flashTween: gsap.core.Tween | null = null;
  /** wall-clock starts (s, clock.realTime) of the last accepted flashes, oldest first */
  private readonly flashStarts: number[] = [];
  /** DEV/QA read-out of the limiter */
  readonly flashStats = { shown: 0, dropped: 0 };
  private burstCtx!: BurstContext;
  private textures = new Map<ParticleKey, Texture>();
  private offs: Array<() => void> = [];
  /** cosmetic seed of the current reveal (hash of its board) + bursts spawned since */
  private roundSeed = 0x5eed;
  private burstIndex = 0;
  private kind: LayoutKind;

  constructor(private ctx: GameContext) {
    this.shake = new ScreenShake(ctx);
    this.kind = ctx.layout.kind;
  }

  init(): void {
    const { ctx } = this;
    configureFilterBudget(ctx.budget.maxFilters);
    configureFilterQuality(ctx.tier);
    configureParticleBudget(ctx.budget.maxParticles);

    const holder = new Container({ label: 'fx:particles' });
    ctx.layers.fx.addChild(holder);
    const reserve = clamp01(FEATURES.particleReserve ?? 0);
    this.particles = new ParticleSystem(holder, Math.round(ctx.budget.maxParticles * (1 - reserve)));
    this.burstCtx = {
      sys: this.particles,
      tex: (key) => this.texture(key),
      layout: ctx.layout,
    };

    this.flash = new Sprite({ texture: Texture.WHITE, label: 'fx:flash', blendMode: 'add', alpha: 0 });
    this.flash.visible = false;
    ctx.layers.screenFx.addChild(this.flash);
    this.layout();

    // Pixi 8.21 FilterSystem keeps each stack slot's last input texture after pop (it is
    // back in the TexturePool) and reads its resolution on the next NESTED filter push
    // (e.g. the logo shine's alpha mask under a root shockwave); a resize destroys idle
    // screen-sized pool textures -> TypeError inside render and the ticker never
    // recovers. Resizes run outside render: drop the stale references.
    const renderer = ctx.app.renderer;
    const dropStaleFilterInputs = (): void => {
      const fs = renderer.filter as unknown as { _filterStack: Array<{ inputTexture: unknown } | undefined> };
      for (const fd of fs._filterStack) if (fd) fd.inputTexture = null;
    };
    renderer.on('resize', dropStaleFilterInputs);

    const g = ctx.game;
    this.offs.push(
      () => renderer.off('resize', dropStaleFilterInputs),
      g.on('fx:burst', (p) => this.burst(p)),
      g.on('fx:shake', ({ trauma }) => this.shake.add(trauma)),
      g.on('fx:flash', (p) => this.doFlash(p)),
      g.on('board:reveal', ({ board }) => this.seedRound(board)),
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
    refitPulses(this.visibleRect(), L.kind !== this.kind);
    this.kind = L.kind;
    // screenFx is cover-scaled in design space: overshoot so the flash reaches every edge
    const pad = Math.max(L.width, L.height);
    this.flash.position.set(-pad, -pad);
    this.flash.width = L.width + pad * 2;
    this.flash.height = L.height + pad * 2;
  }

  /** Visible part of the design space (design rect + letterbox), in design px. */
  private visibleRect(): Rect {
    const { app, layout: L } = this.ctx;
    const k = this.ctx.scale || 1;
    const w = app.screen.width / k;
    const h = app.screen.height / k;
    return { x: (L.width - w) / 2, y: (L.height - h) / 2, w, h };
  }

  private texture(key: ParticleKey): Texture {
    let t = this.textures.get(key);
    if (!t) {
      t = this.ctx.art.particle(key);
      this.textures.set(key, t);
    }
    return t;
  }

  /** New board on screen: its symbols seed the round's cosmetic randomness. */
  private seedRound(board: string[][]): void {
    let h = 0x811c9dc5;
    for (const col of board) {
      for (const id of col) h = mix32(mixStr(h, id), 0x7c);
      h = mix32(h, 0x2f);
    }
    this.roundSeed = h;
    this.burstIndex = 0;
  }

  private burst(p: GameEvents['fx:burst']): void {
    let h = mix32(this.roundSeed, ++this.burstIndex);
    h = mix32(mixStr(h, p.kind), Math.round(p.x));
    h = mix32(mix32(h, Math.round(p.y)), p.count ?? -1);
    seedFx(h);
    spawnBurst(this.burstCtx, p);
    if (p.kind === 'scatter') {
      const o = FX_TIMING.scatterShock;
      const k = this.ctx.layout.cell / 150;
      pulseShockwave({ target: this.ctx.layers.root, view: this.visibleRect() }, p.x, p.y, {
        duration: s(o.duration),
        radius: o.radius * k * (p.power ?? 1),
        amplitude: o.amplitude * k,
        width: o.width * k,
      });
    }
  }

  /** Flash limiter: true when a flash may start now (and records it). */
  private admitFlash(): boolean {
    const F = FX_TIMING.flash;
    const now = clock.realTime;
    const starts = this.flashStarts;
    while (starts.length && now - (starts[0] ?? 0) >= 1) starts.shift();
    const last = starts[starts.length - 1];
    if (starts.length >= F.maxPerSecond || (last !== undefined && (now - last) * 1000 < F.minGap - 0.5)) {
      this.flashStats.dropped++;
      return false;
    }
    starts.push(now);
    this.flashStats.shown++;
    return true;
  }

  private doFlash(p: GameEvents['fx:flash']): void {
    if (!this.admitFlash()) return;
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
