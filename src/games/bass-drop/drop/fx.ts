import { gsap } from 'gsap';
import { BitmapText, Container, Sprite, type Texture } from 'pixi.js';
import { mulberry32 } from '../../../board/model';
import { followSpeed, s } from '../../../core/timing';
import { ALPHA, ParticleSystem, SIZE, SPIN } from '../../../fx/particles';
import { lighten } from '../../../fx/util';
import type { GameContext } from '../../../game/context';
import { label } from '../../../present/common/text';
import { TEAL } from '../timing';
import { type DropArt, PLUS_FONT } from './art';
import { DROP_LOOK as LOOK } from './look';

const RING_POOL = 10;
const PLUS_POOL = 6;
const TAU = Math.PI * 2;

/**
 * The drop's live effects (ANIMATION_SET §7.2), on a container attached to `winLayer` (above
 * the symbols and the frame): the impact dust crown + debris + shock ring (the P0 fallback of
 * the `fx_wild_impact` flipbook), `fx_mult_spark`, `fx_lock_glint`, the home return ring
 * flash and the sticky "+1" preview. Its own particle system (a share of the tier budget),
 * advanced by the module's clock loop, so hit-stops freeze it.
 *
 * Cosmetic randomness is seeded per event (mulberry32), so a replay looks the same.
 */
export class DropFx {
  readonly view = new Container({ label: 'bassDropFx' });
  private readonly particles: ParticleSystem;
  private readonly partHolder = new Container({ label: 'dropParticles' });
  private readonly ringHolder = new Container({ label: 'dropRings' });
  private readonly textHolder = new Container({ label: 'dropTexts' });
  private readonly rings: Sprite[] = [];
  private readonly plus: BitmapText[] = [];
  private readonly smoke: Texture;
  private readonly shard: Texture;
  private readonly spark: Texture;
  private readonly glint: Texture;
  private rng = mulberry32(0xd40b);

  constructor(
    private readonly ctx: GameContext,
    art: DropArt,
  ) {
    this.particles = new ParticleSystem(this.partHolder, Math.round(ctx.budget.maxParticles * LOOK.particleShare));
    this.smoke = ctx.art.particle('smoke');
    this.shard = ctx.art.particle('shard');
    this.spark = ctx.art.particle('spark');
    this.glint = art.tex.glint;
    for (let i = 0; i < RING_POOL; i++) {
      const r = new Sprite({ texture: art.tex.ring, anchor: 0.5, blendMode: 'add', visible: false });
      this.rings.push(r);
      this.ringHolder.addChild(r);
    }
    for (let i = 0; i < PLUS_POOL; i++) {
      const t = new BitmapText({ text: '', style: { fontFamily: PLUS_FONT, fontSize: 64 }, anchor: 0.5 });
      t.visible = false;
      t.tint = TEAL;
      this.plus.push(t);
      this.textHolder.addChild(t);
    }
    this.view.addChild(this.ringHolder, this.partHolder, this.textHolder);
  }

  /** Re-seed the cosmetic RNG (per drop / event, so replays match). */
  seed(n: number): void {
    this.rng = mulberry32(n >>> 0);
  }

  update(dt: number): void {
    this.particles.update(dt);
  }

  /** Wild contact: plum-grey dust crown from the feet, debris, shock ring (fx_wild_impact fallback). */
  impact(x: number, y: number, cell: number, k: number, tint: number): void {
    const r = this.rng;
    const low = this.ctx.tier === 'low';
    const feet = y + cell * 0.38;
    const dust = low ? LOOK.dust / 2 : LOOK.dust;
    for (let i = 0; i < dust; i++) {
      const p = this.particles.acquire(this.smoke, 'normal', 0);
      if (!p) break;
      const crown = i % 3 === 2;
      const side = i % 2 === 0 ? -1 : 1;
      // low sideways sheet + an upward crown
      const a = crown ? -Math.PI / 2 + (r() - 0.5) * 1.1 : (side < 0 ? Math.PI : 0) - side * r() * 0.45;
      const v = (crown ? 200 + r() * 160 : 280 + r() * 200) * k;
      p.x = x + Math.cos(a) * cell * 0.18;
      p.y = feet - cell * 0.04;
      p.vx = Math.cos(a) * v;
      p.vy = Math.sin(a) * v;
      p.drag = 5.5;
      p.g = -70 * k;
      p.vrot = (r() - 0.5) * 4;
      p.rot = r() * TAU;
      p.life = s(380 + r() * 180);
      p.size0 = (18 + r() * 12) * k;
      p.size1 = (44 + r() * 20) * k;
      p.sizeMode = SIZE.easeOut;
      p.alpha0 = 0.8;
      p.alphaMode = ALPHA.late;
      p.color = i % 4 === 0 ? lighten(LOOK.dustColor, 0.3) : LOOK.dustColor;
    }
    const debris = low ? LOOK.debris / 2 : LOOK.debris;
    for (let i = 0; i < debris; i++) {
      const p = this.particles.acquire(this.shard, 'normal', 1);
      if (!p) break;
      const a = -Math.PI / 2 + (r() - 0.5) * 2.2;
      const v = (320 + r() * 320) * k;
      p.x = x + (r() - 0.5) * cell * 0.4;
      p.y = feet - cell * 0.1;
      p.vx = Math.cos(a) * v;
      p.vy = Math.sin(a) * v;
      p.g = 2600 * k;
      p.drag = 0.8;
      p.floorY = feet + cell * 0.06;
      p.bounce = 0.35;
      p.vrot = (r() - 0.5) * 18;
      p.rot = r() * TAU;
      p.life = s(520 + r() * 220);
      p.size0 = (9 + r() * 7) * k;
      p.size1 = p.size0 * 0.7;
      p.alpha0 = 1;
      p.alphaMode = ALPHA.late;
      p.color = LOOK.debrisColors[i % LOOK.debrisColors.length];
    }
    this.ring(x, y, 0.15 * cell, LOOK.shockRing * cell, LOOK.shockRingMs, lighten(tint, 0.5), 0.95);
  }

  /** Radial tier sparks (fx_mult_spark: badge slam, mult_up, label arrivals). */
  sparks(x: number, y: number, k: number, count: number, color: number, lifeMs: number, speed = 1): void {
    const r = this.rng;
    const n = this.ctx.tier === 'low' ? Math.ceil(count / 2) : count;
    const c = lighten(color, 0.35);
    for (let i = 0; i < n; i++) {
      const p = this.particles.acquire(this.spark, 'add', 2);
      if (!p) return;
      const a = (i / n) * TAU + r() * 0.5;
      const v = (240 + r() * 260) * k * speed;
      p.x = x;
      p.y = y;
      p.vx = Math.cos(a) * v;
      p.vy = Math.sin(a) * v;
      p.drag = 4;
      p.g = 420 * k;
      p.life = s(lifeMs) * (0.7 + r() * 0.5);
      p.size0 = (14 + r() * 8) * k;
      p.size1 = 0;
      p.spin = SPIN.velocity;
      p.stretch = 0.003;
      p.alpha0 = 1;
      p.alphaMode = ALPHA.late;
      p.color = i % 3 === 0 ? 0xffffff : c;
    }
  }

  /** Gold star glints at the clamps (fx_lock_glint on lock_snap). */
  glints(x: number, y: number, cell: number, k: number): void {
    const r = this.rng;
    const n = LOOK.lockGlints;
    for (let i = 0; i < n; i++) {
      const p = this.particles.acquire(this.glint, 'add', 2);
      if (!p) return;
      const side = i % 2 === 0 ? -1 : 1;
      p.x = x + side * cell * LOOK.clampX;
      p.y = y + (r() - 0.5) * cell * 0.3;
      p.vx = side * (40 + r() * 80) * k;
      p.vy = (-60 - r() * 80) * k;
      p.drag = 3;
      p.life = s(LOOK.lockGlintMs) * (0.8 + r() * 0.4);
      p.size0 = (22 + r() * 14) * k;
      p.size1 = 0;
      p.sizeMode = SIZE.pop;
      p.vrot = (r() - 0.5) * 6;
      p.alpha0 = 1;
      p.alphaMode = ALPHA.flash;
      p.color = i % 3 === 0 ? 0xffffff : 0xffd54a;
    }
  }

  /** Expanding additive ring (visible diameter from `d0` to `d1` design px over `ms`, s()-scaled). */
  ring(x: number, y: number, d0: number, d1: number, ms: number, color: number, alpha: number): void {
    const ring = this.rings.find((q) => !q.visible);
    if (!ring) return;
    const tw = ring.texture.width * 0.88;
    ring.position.set(x, y);
    ring.tint = color;
    ring.scale.set(d0 / tw);
    ring.alpha = alpha;
    ring.visible = true;
    followSpeed(
      gsap
        .timeline({ onComplete: () => void (ring.visible = false) })
        .to(ring.scale, { x: d1 / tw, y: d1 / tw, duration: s(ms), ease: 'power2.out' }, 0)
        .to(ring, { alpha: 0, duration: s(ms), ease: 'power1.in' }, 0),
    );
  }

  /** Sticky +1 preview (DESIGN §9.2.3): teal "+n" pops off the badge and rises 30·k over 400 ms. */
  plusOne(x: number, y: number, k: number, n: number, riseMs: number, rise: number): void {
    const t = this.plus.find((q) => !q.visible);
    if (!t) return;
    t.text = label('bd.drop.plusOne', '+{n}', { n });
    t.style.fontSize = LOOK.plusOneSize * k;
    t.position.set(x, y);
    t.alpha = 0;
    t.scale.set(0.6);
    t.visible = true;
    followSpeed(
      gsap
        .timeline({ onComplete: () => void (t.visible = false) })
        .to(t, { alpha: 1, duration: s(80), ease: 'power1.out' }, 0)
        .to(t.scale, { x: 1, y: 1, duration: s(160), ease: 'back.out(3)' }, 0)
        .to(t, { y: y - rise * k, duration: s(riseMs), ease: 'power2.out' }, 0)
        .to(t, { alpha: 0, duration: s(riseMs * 0.4), ease: 'power1.in' }, s(riseMs * 0.6)),
    );
  }

  clear(): void {
    this.particles.clear();
    for (const r of this.rings) {
      gsap.killTweensOf([r, r.scale]);
      r.visible = false;
    }
    for (const t of this.plus) {
      gsap.killTweensOf([t, t.scale]);
      t.visible = false;
    }
  }

  destroy(): void {
    this.clear();
    this.particles.destroy();
    this.view.destroy({ children: true });
  }
}
