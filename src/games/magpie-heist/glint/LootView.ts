import { gsap } from 'gsap';
import { BitmapText, Container, Sprite, type Texture } from 'pixi.js';
import { s } from '../../../core/timing';
import type { LootItem } from '../events';
import { LOOT_COLOR } from '../timing';
import { coinTexture, diamondTexture, nestTexture } from './art';

/** Item kind as drawn (a coin's tier picks its art). */
export type LootKind = 'bronze' | 'silver' | 'gold' | 'diamond' | 'nest';

export const kindOf = (it: LootItem): LootKind => (it.kind === 'coin' ? it.tier : it.kind);

const artFor = (k: LootKind): Texture => (k === 'diamond' ? diamondTexture() : k === 'nest' ? nestTexture() : coinTexture(k));
/** art size relative to the cell (the textures are 120-130 design px) */
const FIT: Record<LootKind, number> = { bronze: 0.84, silver: 0.86, gold: 0.9, diamond: 0.92, nest: 1.02 };
const ART_PX: Record<LootKind, number> = { bronze: 120, silver: 120, gold: 120, diamond: 120, nest: 130 };

/**
 * One piece of loot on a glint square: the art (coin / diamond / nest), a soft additive halo in the
 * loot colour and the live value (money for coins and nests, "×N" for a diamond). Origin = cell
 * centre. Animations are game time (s()).
 */
export class LootView extends Container {
  readonly kind: LootKind;
  readonly art: Sprite;
  readonly halo: Sprite;
  readonly text: BitmapText;
  value = 0;
  mult = 1;
  private tweens: Array<gsap.core.Tween | gsap.core.Timeline> = [];
  private readonly roll = { v: 0 };
  private cell = 140;
  private artK = 1;

  constructor(
    item: LootItem,
    glow: Texture,
    font: string,
    private readonly fmt: (bookValue: number) => string,
  ) {
    super({ label: `loot:${item.kind}` });
    this.kind = kindOf(item);
    this.halo = new Sprite({ texture: glow, anchor: 0.5, blendMode: 'add', tint: LOOT_COLOR[this.kind], alpha: 0.55 });
    this.art = new Sprite({ texture: artFor(this.kind), anchor: 0.5 });
    this.text = new BitmapText({ text: '', style: { fontFamily: font, fontSize: 34 }, anchor: 0.5 });
    this.addChild(this.halo, this.art, this.text);
    if (item.kind === 'diamond') this.mult = item.mult;
    else this.value = item.value;
    this.paintText();
  }

  /** Fit to a cell of `cell` design px. */
  fit(cell: number): void {
    this.cell = cell;
    const k = (cell * FIT[this.kind]) / ART_PX[this.kind];
    this.artK = k;
    this.art.scale.set(k);
    this.halo.scale.set((cell * 1.5) / 256);
    const size = Math.round(cell * (this.kind === 'nest' ? 0.24 : 0.22));
    this.text.style.fontSize = size;
    this.text.y = this.kind === 'nest' ? cell * 0.22 : this.kind === 'diamond' ? cell * 0.3 : cell * 0.02;
    this.fitText();
  }

  private fitText(): void {
    this.text.scale.set(1);
    const max = this.cell * 0.82;
    if (this.text.width > max) this.text.scale.set(max / this.text.width);
  }

  private paintText(): void {
    if (this.kind === 'diamond') this.text.text = `×${this.mult}`;
    else this.text.text = this.kind === 'nest' && this.value <= 0 ? '' : this.fmt(this.value);
    this.fitText();
  }

  /** 3D-ish coin flip into view (scale-x through 0 with a lift), then a settle bounce. */
  flipIn(delayS = 0, ms = 300): gsap.core.Timeline {
    this.scale.set(0, 0.2);
    this.alpha = 1;
    const tl = gsap.timeline({ delay: delayS });
    tl.to(this.scale, { x: 1.18, y: 1.18, duration: s(ms * 0.6), ease: 'back.out(2.4)' })
      .to(this.scale, { x: 1, y: 1, duration: s(ms * 0.4), ease: 'sine.inOut' })
      .fromTo(this.halo, { alpha: 1.2 }, { alpha: 0.55, duration: s(ms), ease: 'sine.out' }, 0)
      .fromTo(this.art, { rotation: -0.25 }, { rotation: 0, duration: s(ms * 0.9), ease: 'back.out(3)' }, 0);
    this.tweens.push(tl);
    return tl;
  }

  /** Value change with a counting roll and a punch (coins / nests). */
  rollTo(value: number, ms: number): void {
    const from = this.value;
    this.value = value;
    this.roll.v = from;
    this.tweens.push(
      gsap.to(this.roll, {
        v: value,
        duration: s(ms),
        ease: 'power2.out',
        onUpdate: () => {
          this.text.text = this.fmt(Math.round(this.roll.v));
          this.fitText();
        },
        onComplete: () => this.paintText(),
      }),
    );
    this.punch(1.22, ms * 0.6);
  }

  punch(to = 1.2, ms = 220): void {
    this.tweens.push(
      gsap
        .timeline()
        .to(this.scale, { x: to, y: to, duration: s(ms * 0.35), ease: 'power2.out' })
        .to(this.scale, { x: 1, y: 1, duration: s(ms * 0.65), ease: 'elastic.out(1, 0.45)' }),
    );
    this.tweens.push(gsap.fromTo(this.halo, { alpha: 1.3 }, { alpha: 0.55, duration: s(ms * 1.4), ease: 'sine.out' }));
  }

  /** A nest squash as a coin lands in it. */
  gulp(): void {
    this.tweens.push(
      gsap
        .timeline()
        .to(this.art.scale, { y: this.artK * 0.84, x: this.artK * 1.12, duration: s(60), ease: 'power2.out' })
        .to(this.art.scale, { y: this.artK, x: this.artK, duration: s(260), ease: 'elastic.out(1, 0.4)' }),
    );
  }

  fadeOut(ms = 260, delayS = 0): gsap.core.Tween {
    const t = gsap.to(this, { alpha: 0, duration: s(ms), delay: delayS, ease: 'sine.in' });
    this.tweens.push(t, gsap.to(this.scale, { x: 0.6, y: 0.6, duration: s(ms), delay: delayS, ease: 'back.in(2)' }));
    return t;
  }

  /** idle life: a slow bob + halo breathing (phase per cell) */
  idle(t: number, phase: number): void {
    this.art.y = Math.sin(t * 2.2 + phase) * this.cell * 0.012;
    if (!this.tweens.some((tw) => tw.isActive())) this.halo.alpha = 0.45 + 0.15 * Math.sin(t * 3 + phase);
  }

  kill(): void {
    for (const t of this.tweens) t.kill();
    this.tweens = [];
  }

  override destroy(): void {
    this.kill();
    super.destroy({ children: true });
  }
}
