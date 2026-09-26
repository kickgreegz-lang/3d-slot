import { gsap } from 'gsap';
import { Container, Sprite, type Texture } from 'pixi.js';
import { followSpeed } from '../../../core/timing';
import { glowTexture, godRaysTexture } from '../../../fx/textures';
import { GOLD, PINK } from '../timing';
import { GEOM, NOTCHES, type NotchDef, type NotchState, R_REF, polar, valueDeg } from './geometry';

/** State looks: ring tint / alpha, icon tint, glow alpha, badge scale. */
const LOOK: Record<NotchState, { ring: number | null; ringA: number; icon: number; glow: number; scale: number }> = {
  off: { ring: 0x3a3452, ringA: 1, icon: 0x5f5a78, glow: 0, scale: 1 },
  next: { ring: null, ringA: 0.9, icon: 0xd8d4e8, glow: 0.18, scale: 1 },
  lit: { ring: null, ringA: 1, icon: 0xffffff, glow: 0.62, scale: 1.1 },
  spent: { ring: GOLD, ringA: 0.55, icon: 0x9b917f, glow: 0, scale: 1 },
};

/**
 * One notch badge on the rim (slots `notch_1..6`): dark plate, state ring, icon (W gem
 * with pips / jukebox / crowned speaker; shape-distinct, no text), an additive glow and
 * the `fx_burst` star. States `off` / `next` / `lit` / `spent` (ANIMATION_SET §3); the
 * armed strobe (2 Hz gold) and the heat pulse (1.9 Hz) are driven per frame by the rig.
 */
class NotchBadge {
  readonly view = new Container({ label: 'notch' });
  readonly glow = new Sprite({ texture: glowTexture(128), anchor: 0.5, blendMode: 'add', alpha: 0 });
  readonly star = new Sprite({ texture: godRaysTexture(12, 512, 3), anchor: 0.5, blendMode: 'add', alpha: 0 });
  readonly plate: Sprite;
  readonly ring: Sprite;
  readonly icon: Sprite;
  readonly badge = new Container();
  state: NotchState = 'off';
  /** armed (strobing) / solid (charge: the armed notch goes solid) / heat pulse */
  armed = false;
  solid = false;
  pulse = false;
  private bursting = false;

  constructor(
    readonly def: NotchDef,
    plate: Texture,
    ring: Texture,
    icon: Texture,
  ) {
    this.plate = new Sprite({ texture: plate, anchor: 0.5 });
    this.ring = new Sprite({ texture: ring, anchor: 0.5 });
    this.icon = new Sprite({ texture: icon, anchor: 0.5 });
    const r = R_REF * GEOM.notchR;
    this.icon.width = this.icon.height = r * 1.62;
    this.glow.width = this.glow.height = r * 5;
    this.star.width = this.star.height = r * 3.2;
    this.badge.addChild(this.plate, this.ring, this.icon);
    this.view.addChild(this.glow, this.star, this.badge);
    const p = polar(valueDeg(def.threshold), R_REF * GEOM.notchRadius);
    this.view.position.set(p.x, p.y);
    this.apply();
  }

  setTextures(plate: Texture, ring: Texture): void {
    this.plate.texture = plate;
    this.ring.texture = ring;
  }

  /** State + overlays in one go; re-applies the plain look only when something changed. */
  configure(st: NotchState, armed: boolean, solid: boolean, pulse: boolean): void {
    if (st === this.state && armed === this.armed && solid === this.solid && pulse === this.pulse) return;
    this.state = st;
    this.armed = armed;
    this.solid = solid;
    this.pulse = pulse;
    this.apply();
  }

  private apply(): void {
    const L = LOOK[this.state];
    this.ring.tint = L.ring ?? this.def.color;
    this.ring.alpha = L.ringA;
    this.icon.tint = L.icon;
    this.glow.tint = this.def.color;
    if (!this.bursting) {
      this.glow.alpha = L.glow;
      this.badge.scale.set(L.scale);
    }
  }

  /** Per-frame: armed strobe (2 Hz gold) / solid / heat pulse (1.9 Hz). `t` game seconds. */
  update(t: number, armedHz: number, heatHz: number): void {
    if (this.bursting) return;
    if (this.armed) {
      const on = this.solid ? 1 : 0.5 + 0.5 * Math.cos(t * Math.PI * 2 * armedHz);
      // tints on change only (pixi's tint setter allocates even for an unchanged value)
      if (this.ring.tint !== GOLD) this.ring.tint = GOLD;
      this.ring.alpha = 0.55 + 0.45 * on;
      if (this.glow.tint !== GOLD) this.glow.tint = GOLD;
      this.glow.alpha = 0.25 + 0.6 * on;
      if (this.icon.tint !== 0xffffff) this.icon.tint = 0xffffff;
      this.badge.scale.set(1.06 + 0.06 * on);
    } else if (this.pulse) {
      const on = 0.5 + 0.5 * Math.sin(t * Math.PI * 2 * heatHz);
      this.glow.alpha = LOOK[this.state].glow + 0.35 * on;
      this.badge.scale.set(1 + 0.07 * on);
    }
  }

  /** `threshold_minor` (15 f) / `threshold_major` (27 f): star + icon punch + glow flare. */
  burst(major: boolean, sec: number, color: number): void {
    gsap.killTweensOf([this.star, this.star.scale, this.badge.scale, this.glow]);
    this.bursting = true;
    const r = R_REF * GEOM.notchR;
    const peak = major ? 1.4 : 1.25;
    this.star.tint = color;
    this.glow.tint = color;
    const starSize = (r * 3.2) / this.star.texture.width;
    const tl = gsap.timeline({
      onComplete: () => {
        this.bursting = false;
        this.star.alpha = 0;
        this.apply();
      },
    });
    tl.set(this.star, { alpha: 1, rotation: 0 })
      .fromTo(this.star.scale, { x: 0, y: 0 }, { x: starSize * (major ? 2.6 : 2), y: starSize * (major ? 2.6 : 2), duration: sec * 0.35, ease: 'power3.out' }, 0)
      .to(this.star, { rotation: major ? 1.2 : 0.7, duration: sec, ease: 'power1.out' }, 0)
      .to(this.star, { alpha: 0, duration: sec * 0.6, ease: 'power2.in' }, sec * 0.4)
      .fromTo(this.glow, { alpha: 1 }, { alpha: LOOK.lit.glow, duration: sec, ease: 'power2.out' }, 0)
      .fromTo(this.badge.scale, { x: 1, y: 1 }, { x: peak, y: peak, duration: sec * 0.12, ease: 'power2.out' }, 0)
      .to(this.badge.scale, { x: LOOK.lit.scale, y: LOOK.lit.scale, duration: sec * 0.5, ease: 'back.out(3)' }, sec * 0.12);
    followSpeed(tl);
  }

  destroy(): void {
    gsap.killTweensOf([this.star, this.star.scale, this.badge.scale, this.glow]);
  }
}

/** The six notch badges (rim order 10..60). */
export class Notches {
  readonly view = new Container({ label: 'notches' });
  readonly badges: NotchBadge[];

  constructor(plate: Texture, ring: Texture, iconFor: (d: NotchDef) => Texture) {
    this.badges = NOTCHES.map((d) => new NotchBadge(d, plate, ring, iconFor(d)));
    this.view.addChild(...this.badges.map((b) => b.view));
  }

  setTextures(plate: Texture, ring: Texture): void {
    for (const b of this.badges) b.setTextures(plate, ring);
  }

  update(t: number, armedHz: number, heatHz: number): void {
    for (const b of this.badges) b.update(t, armedHz, heatHz);
  }

  /** Burst colour: the notch's segment colour, jukebox gold, crowned speaker pink. */
  static burstColor(d: NotchDef): number {
    return d.kind === 'jj' ? GOLD : d.kind === 'mm' ? PINK : d.color;
  }

  destroy(): void {
    for (const b of this.badges) b.destroy();
    this.view.destroy({ children: true });
  }
}
