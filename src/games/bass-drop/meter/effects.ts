import { gsap } from 'gsap';
import { Container, Sprite, type Texture } from 'pixi.js';
import { mulberry32 } from '../../../board/model';
import { clock } from '../../../core/clock';
import { followSpeed, getSpeedProfile, s } from '../../../core/timing';
import { ALPHA, ParticleSystem, SIZE, SPIN } from '../../../fx/particles';
import { reducedMotion } from '../../../fx/motion';
import { glowTexture } from '../../../fx/textures';
import type { GameContext } from '../../../game/context';
import type { MascotCue, SfxId } from '../../../game/events';
import { BASS_DROP_TIMING } from '../timing';
import { METER_LOOK as LOOK } from './geometry';
import { OrbField } from './Orbs';

const D = BASS_DROP_TIMING.drop;
const RING_POOL = 9;
/** share of the tier particle budget the meter may use (orb trails, sparks, smoke) */
const PARTICLE_SHARE = 0.55;

/**
 * The meter's screen-space FX, on a container attached to `winLayer` (above the frame and
 * the logo, below the mascots): the energy orbs, their trails, notch sparks, the boom's
 * sound-wave rings and speaker smoke. Also the meter's outlets to the shared FX: shake (the
 * engine ScreenShake applies the reduced-motion scale), flashes (the engine Fx limiter drops
 * the excess), hit-stops only in the normal profile (DESIGN §18 / CR-11) and capped, SFX and
 * mascot cues. Reduced motion (src/fx/motion.ts) halves the orb trails.
 *
 * Cosmetic randomness is seeded (mulberry32), so a replay looks the same.
 */
export class MeterFx {
  readonly view = new Container({ label: 'grooveMeterFx' });
  readonly particles: ParticleSystem;
  readonly orbs: OrbField;
  private readonly particleHolder = new Container({ label: 'meterParticles' });
  private readonly ringHolder = new Container({ label: 'meterRings' });
  private readonly rings: Sprite[] = [];
  private readonly sparkTex = glowTexture(32);
  private rng = mulberry32(0xb455);

  constructor(
    private readonly ctx: GameContext,
    orbCore: Texture,
    orbHalo: Texture,
    private readonly wave: Texture,
    private readonly puff: Texture,
  ) {
    this.particles = new ParticleSystem(this.particleHolder, Math.round(ctx.budget.maxParticles * PARTICLE_SHARE));
    this.orbs = new OrbField(orbCore, orbHalo, this.particles, () => ctx.layout);
    this.orbs.trailThin = ctx.tier === 'low' || reducedMotion() ? 2 : 1;
    for (let i = 0; i < RING_POOL; i++) {
      const r = new Sprite({ texture: wave, anchor: 0.5, blendMode: 'add', visible: false });
      this.rings.push(r);
      this.ringHolder.addChild(r);
    }
    this.view.addChild(this.ringHolder, this.particleHolder, this.orbs.view);
  }

  /** Re-seed the cosmetic RNG (per step / event, so replays match). */
  seed(n: number): void {
    this.rng = mulberry32(n >>> 0);
  }

  update(dt: number): void {
    this.orbs.trailThin = this.ctx.tier === 'low' || reducedMotion() ? 2 : 1;
    this.orbs.update(dt);
    this.particles.update(dt);
  }

  // ------------------------------------------------------------------ visuals

  /** Three additive sound-wave rings leaving the woofer 90 ms apart (radius -> 900·k over 520 ms). */
  soundRings(x: number, y: number, k: number, r0: number, color: number): void {
    const gap = s(D.ringsGap);
    const life = s(D.shockDuration);
    for (let i = 0; i < 3; i++) {
      const ring = this.rings.find((r) => !r.visible);
      if (!ring) return;
      const end = (LOOK.ringRadius * k * 2) / (this.wave.width * 0.9);
      const start = (r0 * 2) / (this.wave.width * 0.9);
      ring.position.set(x, y);
      ring.tint = color;
      ring.scale.set(start);
      ring.alpha = 0;
      ring.visible = true;
      followSpeed(
        gsap
          .timeline({ delay: gap * i, onComplete: () => void (ring.visible = false) })
          .set(ring, { alpha: 0.85 - i * 0.15 })
          .to(ring.scale, { x: end, y: end, duration: life, ease: 'power2.out' }, 0)
          .to(ring, { alpha: 0, duration: life, ease: 'power1.in' }, 0),
      );
    }
  }

  /** Radial spark burst (notch thresholds, overdrive crackle). */
  sparks(x: number, y: number, k: number, count: number, color: number, lifeMs: number, speed = 1): void {
    const r = this.rng;
    const n = this.ctx.tier === 'low' ? Math.ceil(count / 2) : count;
    for (let i = 0; i < n; i++) {
      const p = this.particles.acquire(this.sparkTex, 'add', 2);
      if (!p) return;
      const a = (i / n) * Math.PI * 2 + r() * 0.4;
      const v = (260 + r() * 420) * k * speed;
      p.x = x;
      p.y = y;
      p.vx = Math.cos(a) * v;
      p.vy = Math.sin(a) * v;
      p.drag = 3.2;
      p.g = 380 * k;
      p.life = s(lifeMs) * (0.7 + r() * 0.5);
      p.size0 = (8 + r() * 6) * k;
      p.size1 = 0;
      p.spin = SPIN.velocity;
      p.stretch = 0.004;
      p.alpha0 = 1;
      p.alphaMode = ALPHA.late;
      p.color = i % 3 === 0 ? 0xffffff : color;
    }
  }

  /** Cel smoke puffs blown out of the woofer rim, outward (the fx_speaker_blast fallback); r0 = rim radius. */
  smoke(x: number, y: number, k: number, r0: number, count: number, tint: number): void {
    const r = this.rng;
    const n = this.ctx.tier === 'low' ? Math.ceil(count / 2) : count;
    for (let i = 0; i < n; i++) {
      const p = this.particles.acquire(this.puff, 'normal', 0);
      if (!p) return;
      const a = (i / n) * Math.PI * 2 + r() * 0.5;
      const v = (320 + r() * 380) * k;
      p.x = x + Math.cos(a) * r0;
      p.y = y + Math.sin(a) * r0;
      p.vx = Math.cos(a) * v;
      p.vy = Math.sin(a) * v - 80 * k;
      p.drag = 5;
      p.g = -60 * k;
      p.vrot = (r() - 0.5) * 3;
      p.life = s(340 + r() * 220);
      p.size0 = (12 + r() * 10) * k;
      p.size1 = (30 + r() * 16) * k;
      p.sizeMode = SIZE.easeOut;
      p.alpha0 = 0.7;
      p.alphaMode = ALPHA.fade;
      p.color = tint;
    }
  }

  // ------------------------------------------------------------------ outlets

  shake(trauma: number): void {
    if (trauma > 0) this.ctx.game.broadcast('fx:shake', { trauma });
  }

  /** Full-screen flash (the engine Fx limiter keeps flashes <= 3/s, >= 334 ms apart; excess dropped). */
  flash(color: number, alpha: number, durationMs: number): void {
    this.ctx.game.broadcast('fx:flash', { color, alpha, durationMs });
  }

  /** Hit-stop in the normal profile only (turbo / super turbo have none), capped. */
  hitStop(ms: number): void {
    if (getSpeedProfile() !== 'normal') return;
    clock.hitStop(Math.min(ms, BASS_DROP_TIMING.hitStop.max));
  }

  sfx(id: SfxId, rate = 1, volume?: number): void {
    this.ctx.game.broadcast('sfx', volume === undefined ? { id, rate } : { id, rate, volume });
  }

  cue(cue: MascotCue, intensity?: number): void {
    this.ctx.game.broadcast('mascot:cue', intensity === undefined ? { cue } : { cue, intensity });
  }

  clear(): void {
    this.orbs.clear();
    this.particles.clear();
    for (const r of this.rings) {
      gsap.killTweensOf([r, r.scale]);
      r.visible = false;
    }
  }

  destroy(): void {
    this.clear();
    for (const r of this.rings) gsap.killTweensOf([r, r.scale]);
    this.orbs.destroy();
    this.particles.destroy();
    this.view.destroy({ children: true });
  }
}
