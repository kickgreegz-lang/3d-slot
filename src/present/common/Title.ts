import { gsap } from 'gsap';
import { Container } from 'pixi.js';
import { fxRandom } from '../../fx/util';
import { BakedWord, type GlyphStyle, type WordGlyph } from './glyphs';

export interface TitleLine {
  text: string;
  style: GlyphStyle;
}

/**
 * Multi-line display title built from baked per-letter sprites, with the motion
 * vocabulary every banner shares: drop-in, slam-in (tier punch), blow-out, drop-out
 * and an idle travelling wave/bounce. Tweens drive per-glyph offsets (dx/dy), scale
 * and alpha; `tick()` composes offsets + wave into sprite positions each frame.
 */
export class Title extends Container {
  readonly words: BakedWord[] = [];
  readonly glyphs: WordGlyph[] = [];
  readonly blockHeight: number;
  /** idle wave amplitude in design px (tween it to fade the wave in/out) */
  waveAmp = 0;
  /** shine sweep position along the title (design px, content space) */
  glintPos = Number.NEGATIVE_INFINITY;
  glintWidth = 150;
  glintStrength = 0.8;
  /** idle-wave phase: seeded cosmetic stream (fx/util), so a replay matches */
  private time = fxRandom() * 10;
  private halfWidth = 0;

  constructor(lines: TitleLine[], resolution: number, opts: { maxWidth: number; lineGap?: number }) {
    super({ label: 'title' });
    const gap = opts.lineGap ?? 1.14;
    const heights: number[] = [];
    for (const line of lines) {
      const w = new BakedWord(line.text, line.style, resolution);
      if (w.textWidth > opts.maxWidth) w.scale.set(opts.maxWidth / w.textWidth);
      this.words.push(w);
      heights.push(w.capHeight * w.scale.y * gap);
      this.addChild(w);
    }
    const total = heights.reduce((a, b) => a + b, 0);
    let y = -total / 2;
    this.words.forEach((w, i) => {
      w.y = y + heights[i] / 2;
      y += heights[i];
    });
    this.blockHeight = total;
    for (const w of this.words) {
      this.glyphs.push(...w.glyphs);
      this.halfWidth = Math.max(this.halfWidth, (w.textWidth * w.scale.x) / 2);
    }
  }

  /** Sweep a diagonal glint across the letters. */
  sweep(duration: number): gsap.core.Tween {
    const from = -this.halfWidth - this.glintWidth - this.blockHeight * 0.4;
    const to = this.halfWidth + this.glintWidth + this.blockHeight * 0.4;
    return gsap.fromTo(this, { glintPos: from }, { glintPos: to, duration, ease: 'power1.inOut' });
  }

  /** Compose offsets + idle wave into sprite transforms. Call every frame. */
  tick(dt: number): void {
    this.time += dt;
    const t = this.time;
    const amp = this.waveAmp;
    let i = 0;
    for (const w of this.words) {
      for (const g of w.glyphs) {
        const ph = t * 3.1 - i * 0.62;
        // travelling hop: a smooth bump that runs across the letters
        const hop = Math.max(0, Math.sin(t * 2.4 - i * 0.5)) ** 4;
        const sp = g.sprite;
        sp.x = g.homeX + g.dx;
        sp.y = g.homeY + g.dy + (Math.sin(ph) * 0.45 - hop) * amp;
        sp.rotation = Math.sin(t * 2.2 - i * 0.8) * 0.006 * amp;
        // glint: additive copy brightens letters under the diagonal sweep line
        const gx = g.homeX * w.scale.x - (w.y + g.homeY) * 0.4;
        const d = Math.abs(gx - this.glintPos);
        const sh = g.shine;
        if (d < this.glintWidth && sp.alpha > 0) {
          const a = (1 - d / this.glintWidth) ** 2 * this.glintStrength * sp.alpha;
          sh.visible = true;
          sh.alpha = a;
          sh.position.copyFrom(sp.position);
          sh.scale.copyFrom(sp.scale);
          sh.rotation = sp.rotation;
        } else if (sh.visible) {
          sh.visible = false;
        }
        i++;
      }
    }
  }

  /** Letters fall in from above with overshoot, staggered left -> right. */
  dropIn(o: { duration: number; stagger: number; height: number }): gsap.core.Timeline {
    const tl = gsap.timeline();
    this.glyphs.forEach((g, i) => {
      g.dy = -o.height;
      g.sprite.alpha = 0;
      g.sprite.scale.set(0.4, 1.5);
      tl.to(g, { dy: 0, duration: o.duration, ease: 'back.out(2.2)' }, i * o.stagger);
      tl.to(g.sprite, { alpha: 1, duration: o.duration * 0.25, ease: 'none' }, i * o.stagger);
      // stretched while falling, squash on landing, settle
      tl.to(g.sprite.scale, { x: 1.18, y: 0.82, duration: o.duration * 0.42, ease: 'power2.in' }, i * o.stagger);
      const settleAt = i * o.stagger + o.duration * 0.42;
      tl.to(g.sprite.scale, { x: 1, y: 1, duration: o.duration * 0.58, ease: 'elastic.out(1.1, 0.45)' }, settleAt);
    });
    return tl;
  }

  /**
   * Letters pop up in place (scale 0 -> overshoot -> 1, small rise), staggered
   * left -> right and line by line. Clean read: letters never cross each other.
   */
  popIn(o: { duration: number; stagger: number; lineDelay: number; rise?: number }): gsap.core.Timeline {
    const tl = gsap.timeline();
    const rise = o.rise ?? 46;
    let t0 = 0;
    for (const w of this.words) {
      w.glyphs.forEach((g, i) => {
        const at = t0 + i * o.stagger;
        g.dy = rise;
        g.sprite.alpha = 0;
        g.sprite.scale.set(0.2);
        tl.to(g.sprite, { alpha: 1, duration: o.duration * 0.18, ease: 'none' }, at);
        tl.to(g.sprite.scale, { x: 1, y: 1, duration: o.duration, ease: 'back.out(2.6)' }, at);
        tl.to(g, { dy: 0, duration: o.duration * 0.8, ease: 'power3.out' }, at);
      });
      t0 += Math.max(o.lineDelay, w.glyphs.length * o.stagger * 0.6);
    }
    return tl;
  }

  /** Big-to-normal slam (tier upgrade punch). */
  slamIn(o: { duration: number; stagger: number; ease: string; from?: number }): gsap.core.Timeline {
    const tl = gsap.timeline();
    const from = o.from ?? 1.9;
    this.glyphs.forEach((g, i) => {
      g.sprite.alpha = 0;
      g.sprite.scale.set(from);
      tl.to(g.sprite, { alpha: 1, duration: o.duration * 0.2, ease: 'none' }, i * o.stagger);
      tl.to(g.sprite.scale, { x: 1, y: 1, duration: o.duration, ease: o.ease }, i * o.stagger);
    });
    return tl;
  }

  /** Scale up + fade (being replaced by a higher tier). */
  blowOut(duration: number): gsap.core.Timeline {
    const tl = gsap.timeline();
    this.glyphs.forEach((g, i) => {
      tl.to(g.sprite.scale, { x: 1.35, y: 1.35, duration, ease: 'power2.out' }, i * 0.01);
      tl.to(g.sprite, { alpha: 0, duration, ease: 'power1.in' }, i * 0.01);
      tl.to(g, { dy: -30, duration, ease: 'power2.out' }, i * 0.01);
    });
    return tl;
  }

  /** Letters anticipate up, then drop away with fade (close). */
  dropOut(o: { duration: number; stagger: number; height: number }): gsap.core.Timeline {
    const tl = gsap.timeline();
    this.glyphs.forEach((g, i) => {
      tl.to(g, { dy: o.height, duration: o.duration, ease: 'back.in(2)' }, i * o.stagger);
      tl.to(g.sprite, { alpha: 0, duration: o.duration * 0.5, ease: 'power1.in' }, i * o.stagger + o.duration * 0.5);
    });
    return tl;
  }

  override destroy(): void {
    gsap.killTweensOf(this.glyphs);
    for (const g of this.glyphs) {
      gsap.killTweensOf(g.sprite);
      gsap.killTweensOf(g.sprite.scale);
    }
    super.destroy({ children: true });
  }
}
