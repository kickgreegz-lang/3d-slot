import { gsap } from 'gsap';
import { Container, Sprite, type Texture } from 'pixi.js';
import type { LayoutSpec } from '../../../config/layout';
import { followSpeed } from '../../../core/timing';
import { canvasToTexture, createCanvas, glowTexture } from '../../../fx/textures';
import { lighten } from '../../../fx/util';
import { frameTube, type TubeLine } from '../../swamp-funk/scene/Frame';
import { BASS_DROP_LAYOUT } from '../layout';

/** Look of the tube light (design px per frame unit u = post / 50; alphas 0..1). */
const TUBE = {
  /** steady glow while a crossed threshold waits for its drop (DESIGN §6.2 `armed`) */
  armedAlpha: 0.42,
  /** armed shimmer: +-alpha at METER_LOOK armedHz (<= 3 Hz) */
  shimmer: 0.1,
  /** the tube charges up under the travelling head (glow alpha at arrival, before the flash) */
  chargeAlpha: 0.55,
  /** arrival flash (the boom) and its decay (1/s) */
  flashAlpha: 1,
  flashDecay: 4.5,
  /** glow alpha follows its target at this rate (1/s) */
  follow: 10,
  /** bar glow thickness / end overhang (u) */
  barH: 30,
  barPad: 26,
  /** head: hot core (w x h, u), halo (w x h, u), comet tail max length (u) */
  core: [46, 12],
  halo: [120, 44],
  tail: 260,
} as const;

/** 256 x 32 bar: vertical gaussian beam + soft ends (additive, tinted). */
const barTexture = (): Texture => {
  const w = 256;
  const h = 32;
  const [c, g] = createCanvas(w, h);
  const img = g.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    const v = (y + 0.5) / h - 0.5;
    const beam = Math.exp(-((v / 0.2) ** 2)) * 0.8 + Math.exp(-((v / 0.07) ** 2)) * 0.5;
    for (let x = 0; x < w; x++) {
      const e = Math.min(x + 0.5, w - x - 0.5) / (w * 0.1);
      const end = e >= 1 ? 1 : e * e * (3 - 2 * e);
      const i = (y * w + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(Math.min(1, beam) * end * 255);
    }
  }
  g.putImageData(img, 0, 0);
  return canvasToTexture(c);
};

/** 128 x 16 comet tail: transparent at x = 0, hot at x = 1 (the head end). */
const tailTexture = (): Texture => {
  const w = 128;
  const h = 16;
  const [c, g] = createCanvas(w, h);
  const img = g.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    const v = (y + 0.5) / h - 0.5;
    const beam = Math.exp(-((v / 0.22) ** 2)) * 0.75 + Math.exp(-((v / 0.08) ** 2)) * 0.6;
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / w;
      const i = (y * w + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(Math.min(1, beam * u ** 1.6) * 255);
    }
  }
  g.putImageData(img, 0, 0);
  return canvasToTexture(c);
};

/** One travelling pulse head: hot core + coloured halo + comet tail (all additive). */
class Head {
  readonly view = new Container({ label: 'tubePulseHead', visible: false });
  readonly tail: Sprite;
  readonly halo: Sprite;
  readonly core: Sprite;
  /** start / end x of the run (design px) */
  from = 0;
  to = 0;

  constructor(glow: Texture, tail: Texture) {
    this.tail = new Sprite({ texture: tail, anchor: { x: 1, y: 0.5 }, blendMode: 'add' });
    this.halo = new Sprite({ texture: glow, anchor: 0.5, blendMode: 'add' });
    this.core = new Sprite({ texture: glow, anchor: 0.5, blendMode: 'add' });
    this.view.addChild(this.tail, this.halo, this.core);
  }

  setColor(color: number): void {
    this.tail.tint = color;
    this.halo.tint = color;
    this.core.tint = lighten(color, 0.75);
  }

  /** Place at progress e (0..1, eased) on line y; u = frame unit. */
  place(e: number, y: number, u: number): void {
    const x = this.from + (this.to - this.from) * e;
    const dir = this.to >= this.from ? 1 : -1;
    this.view.position.set(x, y);
    this.core.width = TUBE.core[0] * u;
    this.core.height = TUBE.core[1] * u;
    this.halo.width = TUBE.halo[0] * u;
    this.halo.height = TUBE.halo[1] * u;
    // the tail never reaches back past the run's start
    const len = Math.max(1, Math.min(TUBE.tail * u, Math.abs(x - this.from)));
    this.tail.width = len;
    this.tail.height = TUBE.halo[1] * 0.42 * u;
    this.tail.scale.x = dir * Math.abs(this.tail.scale.x);
  }
}

type TubeClip = 'charge';

/**
 * The frame beam's neon tube as the drop's power line (DESIGN §0 "the neon tube on the beam
 * carries the drop charge", §6.2 `armed`, §8.1 Charge; ANIMATION_SET §8 "Neon-tube charge
 * pulse", §9 `charge_start`). Procedural stand-in for the bd_ui `tube_pulse` region, drawn OVER
 * the Frame's own tube (the shared Frame is not touched; its tube line comes from frameTube):
 *  - play('charge', sec): a comet head runs along the tube from the booth end to the meter end
 *    (portrait, meter above the centre: one head from each end to the meter), power2.in, and
 *    arrives at exactly `sec` (the boom); the tube charges up under it and flashes on arrival.
 *    Reduced motion: no travelling head, the tube only brightens and flashes.
 *  - setArmed(on): a steady glow with a gentle shimmer while a crossed threshold waits for
 *    its drop.
 * The run is one followSpeed tween (a slam retimes it with the boom); the per-frame part is
 * `update(dt)` on the meter's game clock (hit-stop freezes it) and allocates nothing. The line
 * is re-read on every layout, so a rotation mid-charge retargets the heads.
 */
export class TubeLight {
  readonly view = new Container({ label: 'tubeLight' });
  private readonly barTex = barTexture();
  private readonly tailTex = tailTexture();
  private readonly bar: Sprite;
  private readonly heads: [Head, Head];
  private readonly line: TubeLine = { x0: 0, x1: 0, y: 0, w: 0 };
  private u = 1;
  private meterX = 0;
  private armed = false;
  private flash = 0;
  private glow = 0;
  private time = 0;
  private color = -1;
  private readonly run = { e: 0, active: false, heads: 1, reduced: false };
  private tween: gsap.core.Tween | null = null;

  constructor(private readonly armedHz: number) {
    const glow = glowTexture(128);
    this.bar = new Sprite({ texture: this.barTex, anchor: 0.5, blendMode: 'add', alpha: 0, visible: false });
    this.heads = [new Head(glow, this.tailTex), new Head(glow, this.tailTex)];
    this.view.addChild(this.bar, this.heads[0].view, this.heads[1].view);
  }

  layout(L: LayoutSpec): void {
    frameTube(L, this.line);
    this.u = L.frameParts.post / 50;
    const t = this.line;
    this.meterX = Math.min(t.x1, Math.max(t.x0, BASS_DROP_LAYOUT[L.kind].meter.cx));
    this.bar.position.set((t.x0 + t.x1) / 2, t.y);
    this.bar.width = t.x1 - t.x0 + TUBE.barPad * 2 * this.u;
    this.bar.height = TUBE.barH * this.u;
    if (this.run.active) this.aim();
  }

  setColor(color: number): void {
    if (color === this.color) return;
    this.color = color;
    this.bar.tint = color;
    for (const h of this.heads) h.setColor(color);
  }

  setArmed(on: boolean): void {
    this.armed = on;
  }

  /** `charge` stand-in: the pulse arrives at `sec` game seconds (already s()-scaled). */
  play(clip: TubeClip, sec: number, reduced: boolean): void {
    if (clip !== 'charge') return;
    this.stop();
    const r = this.run;
    r.e = 0;
    r.active = true;
    r.reduced = reduced;
    this.aim();
    this.tween = followSpeed(
      gsap.to(r, {
        e: 1,
        duration: Math.max(0.001, sec),
        ease: 'power2.in',
        onComplete: () => this.arrive(),
      }),
    );
  }

  /** Round end / board:set / meter:set: no pulse, no armed glow, no flash. */
  reset(): void {
    this.stop();
    this.armed = false;
    this.flash = 0;
    this.glow = 0;
    this.bar.alpha = 0;
    this.bar.visible = false;
  }

  update(dt: number): void {
    this.time += dt;
    const r = this.run;
    let target = 0;
    if (this.armed) target = TUBE.armedAlpha + TUBE.shimmer * Math.sin(this.time * Math.PI * 2 * this.armedHz);
    if (r.active) {
      target = Math.max(target, TUBE.chargeAlpha * r.e);
      if (!r.reduced) {
        const e = r.e;
        const n = r.heads;
        for (let i = 0; i < n; i++) this.heads[i].place(e, this.line.y, this.u);
      }
    }
    if (dt > 0) {
      this.glow += (target - this.glow) * Math.min(1, dt * TUBE.follow);
      this.flash = Math.max(0, this.flash - dt * TUBE.flashDecay);
    }
    const a = Math.min(1, Math.max(this.glow, this.flash));
    this.bar.visible = a > 0.004;
    this.bar.alpha = a;
  }

  destroy(): void {
    this.stop();
    this.view.destroy({ children: true });
    this.barTex.destroy(true);
    this.tailTex.destroy(true);
  }

  /** Head runs for the current line: booth end -> meter end, or both ends -> a centred meter. */
  private aim(): void {
    const t = this.line;
    const span = t.x1 - t.x0;
    const [a, b] = this.heads;
    const centred = Math.abs(this.meterX - (t.x0 + t.x1) / 2) < span / 6;
    if (centred) {
      a.from = t.x0;
      b.from = t.x1;
      a.to = b.to = this.meterX;
      this.run.heads = 2;
    } else {
      // the meter sits off one end of the beam (left of the reels); the booth side is the other
      const meterLeft = this.meterX <= (t.x0 + t.x1) / 2;
      a.from = meterLeft ? t.x1 : t.x0;
      a.to = meterLeft ? t.x0 : t.x1;
      this.run.heads = 1;
    }
    a.view.visible = !this.run.reduced;
    b.view.visible = !this.run.reduced && this.run.heads === 2;
  }

  private arrive(): void {
    this.tween = null;
    this.run.active = false;
    this.run.e = 0;
    for (const h of this.heads) h.view.visible = false;
    this.flash = TUBE.flashAlpha;
  }

  private stop(): void {
    this.tween?.kill();
    this.tween = null;
    this.run.active = false;
    this.run.e = 0;
    for (const h of this.heads) h.view.visible = false;
  }
}
