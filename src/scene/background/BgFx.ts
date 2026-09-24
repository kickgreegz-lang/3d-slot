import { Container, Particle, ParticleContainer, Rectangle, type Renderer, Sprite, type Texture } from 'pixi.js';
import { mix } from '../../assets/placeholder/palette';
import type { GameContext } from '../../game/context';
import { type Bulb, bulbsOf, glowSprite, paintCone, paintSignLit, rng } from './paint';
import type { Composition, ScenePalette } from './theme';

/**
 * Live background FX (ctx.layers.bgFx, cover-scaled). Everything is baked sprites
 * or one ParticleContainer; per-frame work is a few dozen scalar updates, no
 * allocations and no filters.
 *   - neon sign: steady hum + occasional flicker bursts (gator and accent tubes
 *     flicker independently), with its wall spill
 *   - string-light bulbs twinkle
 *   - fireflies drift and blink
 *   - drifting haze and slowly breathing light cones
 * `setHeat(t)` blends base -> free-spins colours (0..1).
 */

const LOCAL = {
  /** seconds between neon flicker bursts */
  flickerGapMin: 3.5,
  flickerGapMax: 9,
  /** flicker burst length (s) */
  flickerBurst: 0.55,
  haze: { speed: 14, alpha: 0.07 },
  cone: { alpha: 0.1, breathe: 0.035, period: 7.5, sway: 1.2 },
};

interface Fly {
  p: Particle;
  x: number;
  y: number;
  ax: number;
  ay: number;
  fx: number;
  fy: number;
  ph: number;
  blink: number;
}

interface Twinkle {
  p: Particle;
  base: number;
  ph: number;
  speed: number;
}

interface NeonTube {
  lit: [Sprite, Sprite];
  /** remaining burst time; > 0 while flickering */
  burst: number;
  next: number;
  level: number;
}

export class BgFx {
  readonly view = new Container({ label: 'bgFxScene' });
  private particles: ParticleContainer;
  private bulbs: Twinkle[] = [];
  private flies: Fly[] = [];
  private hazes: Sprite[] = [];
  private cones: Sprite[] = [];
  private neon: NeonTube[] = [];
  private spill: [Sprite, Sprite] | null = null;
  private owned: Texture[] = [];
  private t = 0;
  private heat = 0;
  private rand = rng(0xf1ee);

  constructor(
    ctx: GameContext,
    private comp: Composition,
    private base: ScenePalette,
    private hot: ScenePalette,
  ) {
    const glow = ctx.art.particle('glow');
    this.view.scale.set(comp.scale);
    const renderer = ctx.app.renderer;
    const lowTier = ctx.tier === 'low';

    // light cones
    const coneTex = this.bake(renderer, paintCone(1000, 430), new Rectangle(-260, -10, 520, 1040), 0.5);
    for (const c of comp.cones) {
      const s = new Sprite(coneTex);
      s.anchor.set(0.5, 10 / 1040);
      s.position.set(c.x, c.y);
      s.scale.set(c.spread / 430, c.len / 1000);
      s.angle = -c.angle;
      s.blendMode = 'add';
      s.alpha = LOCAL.cone.alpha;
      this.cones.push(s);
      this.view.addChild(s);
    }

    // haze
    if (!lowTier) {
      const smoke = ctx.art.particle('smoke');
      for (let i = 0; i < 3; i++) {
        const s = new Sprite(smoke);
        s.anchor.set(0.5);
        s.scale.set((comp.W * 0.6) / smoke.width, (comp.H * 0.35) / smoke.height);
        s.position.set(comp.W * (0.2 + i * 0.35), comp.H * (0.25 + (i % 2) * 0.35));
        s.alpha = LOCAL.haze.alpha;
        s.blendMode = 'add';
        this.hazes.push(s);
        this.view.addChild(s);
      }
    }

    // neon sign (lit tubes, base + hot versions)
    const signFrame = new Rectangle(-190, -140, 380, 280);
    for (const part of ['gator', 'accent'] as const) {
      const pair = [this.base, this.hot].map((pal) => {
        const tex = this.bake(renderer, paintSignLit(pal, part), signFrame, 1);
        const s = new Sprite(tex);
        s.anchor.set(0.5);
        s.position.set(comp.sign.x, comp.sign.y);
        s.scale.set(comp.sign.scale);
        s.angle = comp.sign.rot;
        s.blendMode = 'add';
        this.view.addChild(s);
        return s;
      }) as [Sprite, Sprite];
      this.neon.push({ lit: pair, burst: 0, next: 1 + this.rand() * 4, level: 1 });
    }
    this.spill = [this.base.neon, this.hot.neon].map((col) => {
      const s = glowSprite(glow, comp.sign.x, comp.sign.y, 300 * comp.sign.scale, 240 * comp.sign.scale, col, 0.22);
      this.view.addChild(s);
      return s;
    }) as [Sprite, Sprite];

    // bulbs + fireflies share one particle container (same glow texture)
    this.particles = new ParticleContainer({
      texture: glow,
      dynamicProperties: { position: true, color: true, vertex: false, rotation: false, uvs: false },
    });
    this.particles.blendMode = 'add';
    this.particles.boundsArea = new Rectangle(0, 0, comp.W, comp.H);
    this.view.addChild(this.particles);
    const bulbList: Bulb[] = bulbsOf(comp, base);
    for (const b of bulbList) {
      const p = new Particle({ texture: glow, x: b.x, y: b.y + 3, anchorX: 0.5, anchorY: 0.5, tint: b.color, alpha: 0.3 });
      p.scaleX = p.scaleY = 52 / glow.width;
      this.particles.addParticle(p);
      this.bulbs.push({ p, base: 0.32, ph: this.rand() * Math.PI * 2, speed: 0.6 + this.rand() * 1.4 });
    }
    const flyCount = Math.min(lowTier ? 14 : 34, Math.floor(ctx.budget.maxParticles * 0.05));
    for (let i = 0; i < flyCount; i++) {
      const zone = comp.fireflies[i % comp.fireflies.length];
      const x = zone.x + this.rand() * zone.w;
      const y = zone.y + this.rand() * zone.h;
      const p = new Particle({ texture: glow, x, y, anchorX: 0.5, anchorY: 0.5, tint: base.firefly, alpha: 0 });
      p.scaleX = p.scaleY = (10 + this.rand() * 10) / glow.width;
      this.particles.addParticle(p);
      this.flies.push({
        p,
        x,
        y,
        ax: 14 + this.rand() * 30,
        ay: 8 + this.rand() * 20,
        fx: 0.08 + this.rand() * 0.18,
        fy: 0.1 + this.rand() * 0.22,
        ph: this.rand() * Math.PI * 2,
        blink: 0.25 + this.rand() * 0.5,
      });
    }
    this.applyHeat();
  }

  private bake(renderer: Renderer, target: Container, frame: Rectangle, resolution: number): Texture {
    const tex = renderer.generateTexture({ target, frame, resolution });
    target.destroy({ children: true });
    this.owned.push(tex);
    return tex;
  }

  /** 0 = base game, 1 = free spins. */
  setHeat(t: number): void {
    this.heat = t;
    this.applyHeat();
  }

  private applyHeat(): void {
    const h = this.heat;
    for (const c of this.cones) c.tint = mix(this.base.cone, this.hot.cone, h);
    for (const hz of this.hazes) hz.tint = mix(this.base.ambient, this.hot.ambient, h);
    for (let i = 0; i < this.bulbs.length; i++) {
      const b = this.bulbs[i];
      const k = i % this.base.bulbs.length;
      b.p.tint = mix(this.base.bulbs[k], this.hot.bulbs[k], h);
    }
    const fly = mix(this.base.firefly, this.hot.firefly, h);
    for (const f of this.flies) f.p.tint = fly;
  }

  update(dt: number): void {
    this.t += dt;
    const t = this.t;
    // neon hum + flicker bursts
    let signLevel = 0;
    for (const n of this.neon) {
      if (n.burst > 0) {
        n.burst -= dt;
        // stuttering on/off pattern while the burst runs
        n.level = Math.sin(n.burst * 61) > 0.1 ? 1 : 0.12 + this.rand() * 0.2;
        if (n.burst <= 0) {
          n.level = 1;
          n.next = LOCAL.flickerGapMin + this.rand() * (LOCAL.flickerGapMax - LOCAL.flickerGapMin);
        }
      } else {
        n.next -= dt;
        n.level = 0.93 + Math.sin(t * 7.3 + n.next) * 0.04;
        if (n.next <= 0) n.burst = LOCAL.flickerBurst * (0.5 + this.rand());
      }
      n.lit[0].alpha = n.level * (1 - this.heat);
      n.lit[1].alpha = n.level * this.heat;
      signLevel += n.level;
    }
    if (this.spill) {
      const a = 0.22 * (signLevel / this.neon.length);
      this.spill[0].alpha = a * (1 - this.heat);
      this.spill[1].alpha = a * this.heat;
    }
    // bulbs
    for (const b of this.bulbs) b.p.alpha = b.base + 0.14 * Math.sin(t * b.speed + b.ph) + 0.06 * Math.sin(t * b.speed * 3.1 + b.ph);
    // fireflies: lissajous drift + blink
    for (const f of this.flies) {
      f.p.x = f.x + Math.sin(t * f.fx * Math.PI * 2 + f.ph) * f.ax;
      f.p.y = f.y + Math.sin(t * f.fy * Math.PI * 2 + f.ph * 1.7) * f.ay;
      const s = Math.sin(t * f.blink * Math.PI * 2 + f.ph);
      f.p.alpha = s > 0.2 ? Math.min(1, (s - 0.2) * 2.2) : 0;
    }
    // haze drift (wraps)
    for (let i = 0; i < this.hazes.length; i++) {
      const hz = this.hazes[i];
      hz.x += LOCAL.haze.speed * dt * (i % 2 === 0 ? 1 : -0.7);
      const half = hz.width / 2;
      if (hz.x - half > this.comp.W) hz.x = -half;
      if (hz.x + half < 0) hz.x = this.comp.W + half;
    }
    // cones breathe + sway
    for (let i = 0; i < this.cones.length; i++) {
      const c = this.cones[i];
      const ph = (t / LOCAL.cone.period) * Math.PI * 2 + i * 2.1;
      c.alpha = LOCAL.cone.alpha + LOCAL.cone.breathe * Math.sin(ph);
      c.angle = -this.comp.cones[i].angle + LOCAL.cone.sway * Math.sin(ph * 0.7);
    }
  }

  destroy(): void {
    this.view.destroy({ children: true });
    for (const t of this.owned) t.destroy(true);
    this.owned.length = 0;
  }
}
