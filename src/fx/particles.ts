import { type Container, Particle, ParticleContainer, type Texture } from 'pixi.js';
import { packParticleColor } from './util';

/**
 * In-house particle system on Pixi v8 `ParticleContainer` + `Particle` structs.
 *
 *  - Pooled: `Sim` records (and their pixi `Particle`) are recycled, no per-frame allocation.
 *  - Grouped: a ParticleContainer may only draw ONE texture source with ONE blend mode, so
 *    particles are bucketed per (depth, blend, texture source). Depth orders the buckets:
 *    0 = smoke/dust (behind), 1 = solid debris (shards, coins, confetti), 2 = additive light.
 *  - Hard cap: `acquire()` returns null once `maxParticles` are alive in this system OR the
 *    tier budget (`configureParticleBudget`, ctx.budget.maxParticles) is used up across ALL
 *    systems (engine Fx + a game's own systems + reserved static particles): the budget is
 *    one global number (ANIMATION_SET §7.2), a system's `maxParticles` is only its sub-cap.
 *  - Time: `update(dt)` is driven by `clock.onUpdate`, so hit-stop freezes every particle.
 *
 * Sizes are in design px (texture-size independent): `size` = on-screen width of the particle.
 */

/** Tier particle budget shared by every ParticleSystem (see configureParticleBudget). */
let globalMax = Number.POSITIVE_INFINITY;
/** live particles of every system + reserved static particles */
let globalLive = 0;

/** Set the global live-particle budget (Fx.init, ctx.budget.maxParticles). */
export const configureParticleBudget = (maxParticles: number): void => {
  globalMax = maxParticles;
};

/** Headroom under the global budget. */
export const particlesFree = (): number => Math.max(0, globalMax - globalLive);

/**
 * Count `n` particles drawn outside any ParticleSystem (e.g. the background's static bulbs /
 * fireflies ParticleContainer) against the global budget. Returns the release function
 * (idempotent).
 */
export const reserveParticles = (n: number): (() => void) => {
  const k = Math.max(0, Math.round(n));
  globalLive += k;
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    globalLive = Math.max(0, globalLive - k);
  };
};

export type ParticleBlend = 'normal' | 'add';
export type ParticleDepth = 0 | 1 | 2;

/** Alpha-over-life curves. */
export const ALPHA = {
  /** alpha0 -> 0 linearly */
  fade: 0,
  /** holds alpha0 until 55% of life, then fades out */
  late: 1,
  /** quick fade in (first 18%), then out */
  inOut: 2,
  /** inOut envelope multiplied by a flicker (stars) */
  twinkle: 3,
  /** holds alpha0 briefly then drops with a steep quadratic (light flashes) */
  flash: 4,
} as const;

/** Size-over-life curves (size0 -> size1). */
export const SIZE = {
  linear: 0,
  /** cubic ease-out (rings, smoke) */
  easeOut: 1,
  /** 0 -> size0 overshoot pop in the first 20%, then -> size1 */
  pop: 2,
} as const;

/** Orientation modes. */
export const SPIN = {
  /** rotation += vrot */
  none: 0,
  /** coin flip: scaleX = cos(phase), darker when edge-on */
  coin: 1,
  /** confetti flutter: scaleY = cos(phase) */
  flutter: 2,
  /** rotation follows velocity, scaleX stretches with speed (sparks) */
  velocity: 3,
} as const;

/** One live particle's simulation state. Fields are plain numbers for speed. */
export class Sim {
  readonly p: Particle;
  group: Group | null = null;
  slot = 0;
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  /** constant acceleration x (wind) */
  ax = 0;
  /** gravity (design px / s²), negative rises */
  g = 0;
  /** exponential velocity damping per second */
  drag = 0;
  rot = 0;
  vrot = 0;
  /** seconds; negative while waiting for its delay */
  age = 0;
  life = 1;
  size0 = 10;
  size1 = 10;
  sizeMode = 0;
  alpha0 = 1;
  alphaMode = 0;
  color = 0xffffff;
  /** colour shown edge-on for coins */
  shade = 0x7a5212;
  spin = 0;
  spinSpeed = 0;
  phase = 0;
  /** speed-stretch factor for SPIN.velocity */
  stretch = 0;
  /** y of a floor to bounce on once (Infinity = none) */
  floorY = Number.POSITIVE_INFINITY;
  bounce = 0.4;
  bounced = false;
  /** sideways sway amplitude (px/s²) and frequency (rad/s) — confetti */
  sway = 0;
  swayFreq = 0;
  /** 1 / texture width, so size is in design px */
  texScale = 1;

  constructor(texture: Texture) {
    this.p = new Particle({ texture, anchorX: 0.5, anchorY: 0.5 });
  }

  reset(texture: Texture): void {
    this.p.texture = texture;
    this.texScale = 1 / Math.max(1, texture.orig.width);
    this.x = this.y = this.vx = this.vy = this.ax = this.g = this.drag = 0;
    this.rot = this.vrot = this.age = this.phase = this.spinSpeed = this.stretch = 0;
    this.sway = this.swayFreq = 0;
    this.life = 1;
    this.size0 = this.size1 = 10;
    this.sizeMode = SIZE.linear;
    this.alpha0 = 1;
    this.alphaMode = ALPHA.fade;
    this.color = 0xffffff;
    this.shade = 0x7a5212;
    this.spin = SPIN.none;
    this.floorY = Number.POSITIVE_INFINITY;
    this.bounce = 0.4;
    this.bounced = false;
    this.p.alpha = 0;
  }

  /** Start after `seconds` (the particle stays hidden and frozen until then). */
  delay(seconds: number): this {
    this.age = -seconds;
    return this;
  }
}

interface Group {
  key: string;
  depth: number;
  order: number;
  container: ParticleContainer;
  sims: Sim[];
  dirty: boolean;
}

const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;

export class ParticleSystem {
  private groups: Group[] = [];
  private byKey = new Map<string, Group>();
  private pool: Sim[] = [];
  private live = 0;
  private created = 0;

  constructor(
    private parent: Container,
    public maxParticles: number,
  ) {}

  get count(): number {
    return this.live;
  }

  /** Remaining headroom under this system's sub-cap and the global budget. */
  get free(): number {
    return Math.max(0, Math.min(this.maxParticles - this.live, globalMax - globalLive));
  }

  /**
   * Take a particle from the pool and add it to the right bucket.
   * Returns null when the budget is exhausted — callers just skip that particle.
   */
  acquire(texture: Texture, blend: ParticleBlend = 'normal', depth: ParticleDepth = 1): Sim | null {
    if (this.live >= this.maxParticles || globalLive >= globalMax) return null;
    const group = this.group(texture, blend, depth);
    const sim = this.pool.pop() ?? new Sim(texture);
    sim.reset(texture);
    sim.group = group;
    sim.slot = group.sims.length;
    group.sims.push(sim);
    group.container.particleChildren.push(sim.p);
    group.dirty = true;
    this.live++;
    globalLive++;
    return sim;
  }

  /** Advance every particle by dt seconds (0 during hit-stop). */
  update(dt: number): void {
    if (dt <= 0 || this.live === 0) {
      this.flush();
      return;
    }
    for (let gi = 0; gi < this.groups.length; gi++) {
      const group = this.groups[gi];
      const sims = group.sims;
      for (let i = sims.length - 1; i >= 0; i--) {
        const s = sims[i];
        if (!this.step(s, dt)) this.kill(group, i);
      }
    }
    this.flush();
  }

  /** Remove every particle immediately. */
  clear(): void {
    for (const group of this.groups) {
      for (let i = group.sims.length - 1; i >= 0; i--) this.kill(group, i);
    }
    this.flush();
  }

  destroy(): void {
    this.clear();
    for (const g of this.groups) g.container.destroy();
    this.groups = [];
    this.byKey.clear();
    this.pool = [];
  }

  private flush(): void {
    for (const g of this.groups) {
      if (g.dirty) {
        g.container.update();
        g.dirty = false;
      }
    }
  }

  private group(texture: Texture, blend: ParticleBlend, depth: ParticleDepth): Group {
    const key = `${depth}|${blend}|${texture.source.uid}`;
    let g = this.byKey.get(key);
    if (g) return g;
    const container = new ParticleContainer({
      label: `particles:${key}`,
      texture,
      dynamicProperties: { position: true, rotation: true, vertex: true, color: true, uvs: false },
    });
    container.blendMode = blend;
    g = { key, depth, order: this.created++, container, sims: [], dirty: false };
    this.byKey.set(key, g);
    this.groups.push(g);
    this.groups.sort((a, b) => a.depth - b.depth || a.order - b.order);
    // keep scene order = depth order
    for (const grp of this.groups) this.parent.addChild(grp.container);
    return g;
  }

  private kill(group: Group, i: number): void {
    const sims = group.sims;
    const pc = group.container.particleChildren;
    const last = sims.length - 1;
    const dead = sims[i];
    if (i !== last) {
      sims[i] = sims[last];
      sims[i].slot = i;
      pc[i] = pc[last];
    }
    sims.pop();
    pc.pop();
    dead.group = null;
    this.pool.push(dead);
    this.live--;
    globalLive = Math.max(0, globalLive - 1);
    group.dirty = true;
  }

  /** Integrate one particle. Returns false when it died. */
  private step(s: Sim, dt: number): boolean {
    const p = s.p;
    if (s.age < 0) {
      s.age += dt;
      if (s.age < 0) {
        p.color = 0;
        return true;
      }
    } else {
      s.age += dt;
    }
    if (s.age >= s.life) return false;
    const t = s.age / s.life;

    // motion
    if (s.sway !== 0) s.vx += Math.sin(s.age * s.swayFreq + s.phase) * s.sway * dt;
    s.vx += s.ax * dt;
    s.vy += s.g * dt;
    if (s.drag > 0) {
      const k = Math.exp(-s.drag * dt);
      s.vx *= k;
      s.vy *= k;
    }
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    if (!s.bounced && s.y > s.floorY && s.vy > 0) {
      s.y = s.floorY;
      s.vy = -s.vy * s.bounce;
      s.vx *= 0.65;
      s.vrot *= 0.5;
      s.bounced = true;
    }
    s.rot += s.vrot * dt;

    // size curve
    let size: number;
    switch (s.sizeMode) {
      case SIZE.easeOut:
        size = s.size0 + (s.size1 - s.size0) * easeOutCubic(t);
        break;
      case SIZE.pop:
        if (t < 0.2) {
          const u = t / 0.2;
          // back-out overshoot to ~1.15
          const c = 2.2;
          size = s.size0 * (1 + (c + 1) * (u - 1) ** 3 + c * (u - 1) ** 2);
        } else {
          size = s.size0 + (s.size1 - s.size0) * ((t - 0.2) / 0.8);
        }
        break;
      default:
        size = s.size0 + (s.size1 - s.size0) * t;
    }

    // alpha curve
    let a: number;
    switch (s.alphaMode) {
      case ALPHA.late:
        a = t < 0.55 ? 1 : 1 - (t - 0.55) / 0.45;
        break;
      case ALPHA.inOut:
        a = t < 0.18 ? t / 0.18 : 1 - (t - 0.18) / 0.82;
        break;
      case ALPHA.twinkle:
        a = (t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85) * (0.55 + 0.45 * Math.sin(s.age * 26 + s.phase));
        break;
      case ALPHA.flash:
        a = t < 0.2 ? 1 : (1 - (t - 0.2) / 0.8) ** 2;
        break;
      default:
        a = 1 - t;
    }
    a *= s.alpha0;

    // orientation + output
    const k = size * s.texScale;
    let color = s.color;
    switch (s.spin) {
      case SPIN.coin: {
        s.phase += s.spinSpeed * dt;
        const c = Math.cos(s.phase);
        p.scaleX = k * (Math.abs(c) < 0.08 ? 0.08 * Math.sign(c || 1) : c);
        p.scaleY = k;
        p.rotation = s.rot;
        const edge = 1 - Math.abs(c);
        if (edge > 0.35) color = s.shade;
        break;
      }
      case SPIN.flutter: {
        s.phase += s.spinSpeed * dt;
        p.scaleX = k;
        p.scaleY = k * Math.cos(s.phase);
        p.rotation = s.rot;
        break;
      }
      case SPIN.velocity: {
        const speed = Math.sqrt(s.vx * s.vx + s.vy * s.vy);
        p.rotation = Math.atan2(s.vy, s.vx);
        p.scaleX = k * (1 + speed * s.stretch);
        p.scaleY = k * 0.55;
        break;
      }
      default:
        p.scaleX = k;
        p.scaleY = k;
        p.rotation = s.rot;
    }
    p.x = s.x;
    p.y = s.y;
    p.color = packParticleColor(color, a);
    return true;
  }
}
