import { gsap } from 'gsap';
import { Container, Sprite, type Texture } from 'pixi.js';
import { mulberry32, slotPos } from '../../../board/model';
import type { LayoutSpec } from '../../../config/layout';
import { followSpeed, s } from '../../../core/timing';
import { ALPHA, type ParticleSystem } from '../../../fx/particles';
import { glowTexture } from '../../../fx/textures';
import { mixColor } from '../../../fx/util';
import { BASS_DROP_LAYOUT } from '../layout';
import { BASS_DROP_TIMING, TEAL, physK } from '../timing';
import { METER_LOOK as LOOK } from './geometry';

const O = BASS_DROP_TIMING.orbs;

/** One orb (or super-turbo comet) to fly: source cell, look and what it carries. */
export interface OrbLaunch {
  /** padded source cell */
  reel: number;
  row: number;
  /** halo tint at launch (the source symbol colour lightened 35%) */
  color: number;
  /** launch delay after the burst, ms (unscaled; stagger / spread cap already applied) */
  delayMs: number;
  /** flight-time multiplier (turbo: seeded +-10%) */
  flightMul: number;
  /** seeded lateral jitter of the control point, design px before k (+-40) */
  jitter: number;
  /** counter increments this orb carries (1; a comet carries its cluster's share) */
  count: number;
  comet: boolean;
}

class Orb {
  readonly core: Sprite;
  readonly halo: Sprite;
  reel = 0;
  row = 0;
  color = 0xffffff;
  jitter = 0;
  count = 1;
  comet = false;
  /** 0..1 pop-out progress, 0..1 flight progress */
  pop = 0;
  t = 0;
  active = false;
  trailAcc = 0;
  x = 0;
  y = 0;
  /** position of the previous frame (motion stretch + trail interpolation) */
  px = 0;
  py = 0;
  tint = 0xffffff;

  constructor(coreTex: Texture, haloTex: Texture) {
    this.core = new Sprite({ texture: coreTex, anchor: 0.5 });
    this.halo = new Sprite({ texture: haloTex, anchor: 0.5, blendMode: 'add' });
    this.core.visible = this.halo.visible = false;
  }
}

const easeOut = (u: number): number => 1 - (1 - u) ** 3;
const smooth = (u: number): number => u * u * (3 - 2 * u);
/** pop-out scale: 0 -> 1.2 at 60 %, settle 1.0 (the back.out(2) overshoot, DESIGN §6.3 step 4) */
const popScale = (p: number): number => (p < 0.6 ? 1.2 * easeOut(p / 0.6) : 1.2 - 0.2 * smooth((p - 0.6) / 0.4));

/**
 * ENERGY ORBS (DESIGN §6.3): one pooled core + additive halo per orb on the meter's FX
 * container (attached to `winLayer`, so the streams cross the frame). Each orb pops out of
 * its cell (90 ms, overshoot 1.2, rising 14·k), then flies a quadratic Bézier to the meter
 * centre (520 ms, power2.in): control point on the chord midpoint lifted toward screen-up by
 * clamp(0.22·d, 120, 320)·k plus a seeded ±40·k lateral jitter, so the streams braid. The
 * halo lerps from the symbol colour to meter teal over the last 40 % of the path and a
 * sparkle trail (one particle / 16 ms, 220 ms life) follows it.
 *
 * Paths are evaluated every frame from the CURRENT layout (source cell and meter centre),
 * so a rotation mid-flight re-targets the orbs instead of landing at stale coordinates.
 * All timing runs on gsap (game clock: hit-stops freeze the orbs; followSpeed: a slam
 * retimes them).
 */
export class OrbField {
  readonly view = new Container({ label: 'orbs' });
  private readonly pool: Orb[] = [];
  /** acquired for a launch (waiting or flying) / flying */
  private readonly inUse = new Set<Orb>();
  private readonly live = new Set<Orb>();
  private readonly timelines = new Set<gsap.core.Timeline>();
  private readonly trailTex = glowTexture(32);
  private rng = mulberry32(1);
  /** trail density divisor (low tier / reduced motion: every 2nd particle) */
  trailThin = 1;

  constructor(
    private readonly coreTex: Texture,
    private readonly haloTex: Texture,
    private readonly particles: ParticleSystem,
    private readonly layout: () => LayoutSpec,
  ) {}

  get flying(): number {
    return this.live.size;
  }

  private acquire(): Orb {
    const o = this.pool.pop() ?? new Orb(this.coreTex, this.haloTex);
    if (!o.core.parent) this.view.addChild(o.halo, o.core);
    this.inUse.add(o);
    return o;
  }

  private release(o: Orb): void {
    o.active = false;
    o.core.visible = o.halo.visible = false;
    this.live.delete(o);
    if (this.inUse.delete(o)) this.pool.push(o);
  }

  /**
   * Fly `list`; `onArrive(count, comet)` per arrival; `onDone` after the last one. The
   * returned timeline is registered with followSpeed (and killed by clear()).
   */
  launch(list: readonly OrbLaunch[], seed: number, onArrive: (count: number, comet: boolean) => void, onDone: () => void): void {
    this.rng = mulberry32(seed ^ 0x2f6b1a3d);
    if (!list.length) {
      onDone();
      return;
    }
    const tl = gsap.timeline({
      onComplete: () => {
        this.timelines.delete(tl);
        onDone();
      },
    });
    const popSec = s(O.popOut);
    for (const spec of list) {
      const o = this.acquire();
      o.reel = spec.reel;
      o.row = spec.row;
      o.color = spec.color;
      o.jitter = spec.jitter;
      o.count = spec.count;
      o.comet = spec.comet;
      o.pop = 0;
      o.t = 0;
      o.trailAcc = 0;
      o.active = false;
      const at = s(spec.delayMs);
      tl.call(
        () => {
          o.active = true;
          this.live.add(o);
          o.core.visible = o.halo.visible = true;
          this.place(o, this.layout(), 0);
          o.px = o.x;
          o.py = o.y;
        },
        [],
        at,
      );
      tl.to(o, { pop: 1, duration: popSec, ease: 'none' }, at);
      tl.to(
        o,
        {
          t: 1,
          duration: s(O.flight) * spec.flightMul,
          ease: O.ease,
          onComplete: () => {
            this.release(o);
            onArrive(o.count, o.comet);
          },
        },
        at + popSec,
      );
    }
    this.timelines.add(followSpeed(tl));
  }

  /** Kill every flight (resume / board:set / destroy). Arrivals do not fire. */
  clear(): void {
    for (const tl of this.timelines) tl.kill();
    this.timelines.clear();
    for (const o of [...this.inUse]) this.release(o);
  }

  /** Per frame (game dt, s): positions from the current layout + trails. */
  update(dt: number): void {
    if (!this.live.size) return;
    const L = this.layout();
    const k = physK(L);
    const every = s(O.trailEvery) * this.trailThin;
    const life = s(O.trailLife);
    for (const o of this.live) {
      o.px = o.x;
      o.py = o.y;
      this.place(o, L, dt);
      if (dt <= 0) continue;
      // trail particles spread along this frame's segment, so the stream reads continuous
      let at = every - o.trailAcc;
      o.trailAcc += dt;
      while (o.trailAcc >= every) {
        o.trailAcc -= every;
        const f = Math.min(1, Math.max(0, at / dt));
        this.trail(o, k, life, o.px + (o.x - o.px) * f, o.py + (o.y - o.py) * f);
        at += every;
      }
    }
  }

  private place(o: Orb, L: LayoutSpec, dt: number): void {
    const k = physK(L);
    const m = BASS_DROP_LAYOUT[L.kind].meter;
    const src = slotPos(L, o.reel, o.row);
    const rise = O.popRise * k;
    const size = o.comet ? LOOK.cometScale : 1;
    let x: number;
    let y: number;
    let sc: number;
    let tint = o.color;
    if (o.t <= 0) {
      x = src.x;
      y = src.y - rise * easeOut(Math.min(1, o.pop));
      sc = popScale(o.pop);
    } else {
      const x0 = src.x;
      const y0 = src.y - rise;
      const dx = m.cx - x0;
      const dy = m.cy - y0;
      const d = Math.hypot(dx, dy) || 1;
      // perpendicular toward screen-up; a near-vertical chord (portrait) bends away from the meter's x
      let nx = dy / d;
      let ny = -dx / d;
      if (ny > 0) {
        nx = -nx;
        ny = -ny;
      }
      if (Math.abs(ny) < 0.2) {
        const side = Math.sign(x0 - m.cx) || 1;
        if (Math.sign(nx) !== side) {
          nx = -nx;
          ny = -ny;
        }
      }
      const lift = Math.min(O.liftMax, Math.max(O.liftMin, O.liftFactor * d)) * k + o.jitter * k;
      const cx = (x0 + m.cx) / 2 + nx * lift;
      const cy = (y0 + m.cy) / 2 + ny * lift;
      const t = o.t;
      const u = 1 - t;
      x = u * u * x0 + 2 * u * t * cx + t * t * m.cx;
      y = u * u * y0 + 2 * u * t * cy + t * t * m.cy;
      sc = 1 - 0.38 * t * t;
      if (t > O.tealFrom) tint = mixColor(o.color, TEAL, (t - O.tealFrom) / (1 - O.tealFrom));
    }
    o.x = x;
    o.y = y;
    o.tint = tint;
    // motion stretch along the travel direction (sucked in at the end: power2.in)
    const vx = x - o.px;
    const vy = y - o.py;
    const v = dt > 0 ? Math.hypot(vx, vy) / dt : 0;
    const stretch = 1 + Math.min(0.9, (v / Math.max(k, 0.1)) * 0.00045);
    const rot = v > 1 ? Math.atan2(vy, vx) : o.halo.rotation;
    const core = LOOK.orbCore * k * size * sc;
    const halo = LOOK.orbHalo * k * size * sc;
    o.core.position.set(x, y);
    o.core.rotation = rot;
    o.core.width = core * (1 + (stretch - 1) * 0.6);
    o.core.height = core;
    o.halo.position.set(x, y);
    o.halo.rotation = rot;
    o.halo.width = halo * stretch;
    o.halo.height = halo;
    o.halo.tint = tint;
  }

  private trail(o: Orb, k: number, life: number, x: number, y: number): void {
    const p = this.particles.acquire(this.trailTex, 'add', 2);
    if (!p) return;
    const r = this.rng;
    const size = LOOK.orbTrail * k * (o.comet ? LOOK.cometScale : 1);
    p.x = x + (r() - 0.5) * 5 * k;
    p.y = y + (r() - 0.5) * 5 * k;
    p.vx = (r() - 0.5) * 36 * k;
    p.vy = (r() - 0.5) * 36 * k;
    p.drag = 3;
    p.life = life * (0.8 + r() * 0.4);
    p.size0 = size * 2.6;
    p.size1 = 0;
    p.alpha0 = 1;
    p.alphaMode = ALPHA.fade;
    p.color = o.tint;
  }

  destroy(): void {
    this.clear();
    this.view.destroy({ children: true });
  }
}
