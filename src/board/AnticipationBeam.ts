import { gsap } from 'gsap';
import { Container, Sprite } from 'pixi.js';
import { GRID } from '../config/game';
import type { LayoutSpec } from '../config/layout';
import { clock } from '../core/clock';
import { TIMING, s } from '../core/timing';
import { BOARD_TIMING } from './boardTiming';
import { gridRect, mulberry32, slotPos } from './model';
import { beamTexture } from './tileArt';

/**
 * Anticipation column highlight: an additive vertical light beam over the
 * waiting column, two bright edge rails and sparks streaming upward. Lives in
 * the (masked) board container above the symbols, so it stays inside the panel
 * opening and under the frame. One instance, moved from column to column.
 */
export class AnticipationBeam {
  readonly view = new Container({ label: 'anticipationBeam' });
  private readonly beam = new Sprite(beamTexture('beam'));
  private readonly rails = [new Sprite(beamTexture('rail')), new Sprite(beamTexture('rail'))];
  private readonly streaks: { sp: Sprite; speed: number }[] = [];
  private readonly rng = mulberry32(0xa11ce);
  private offUpdate: (() => void) | null = null;
  private pulse: gsap.core.Tween | null = null;
  private top = 0;
  private bottom = 0;
  private left = 0;
  private width = 0;

  constructor() {
    this.view.visible = false;
    this.view.alpha = 0;
    this.beam.anchor.set(0.5, 0);
    this.beam.blendMode = 'add';
    this.view.addChild(this.beam);
    for (const r of this.rails) {
      r.anchor.set(0.5, 0);
      r.blendMode = 'add';
      this.view.addChild(r);
    }
    for (let i = 0; i < BOARD_TIMING.beamStreaks; i++) {
      const sp = new Sprite(beamTexture('streak'));
      sp.anchor.set(0.5, 0);
      sp.blendMode = 'add';
      this.view.addChild(sp);
      this.streaks.push({ sp, speed: 1 });
    }
  }

  get active(): boolean {
    return this.view.visible;
  }

  /** Light up `reel` (fades in, or slides over from the previous column). */
  show(reel: number, color: number, L: LayoutSpec): void {
    const g = gridRect(L);
    const k = L.cell / 150;
    const cx = slotPos(L, reel, GRID.firstVisibleRow).x;
    const pad = L.cell * 0.1;
    this.top = g.y - pad;
    this.bottom = g.y + g.h + pad;
    this.width = L.cell;
    this.left = cx - L.cell / 2;

    const wasVisible = this.view.visible;
    this.beam.tint = color;
    this.beam.width = L.cell * 1.55;
    this.beam.height = this.bottom - this.top;
    this.beam.position.set(cx, this.top);
    const railX = L.cell / 2 + L.gap / 2;
    this.rails.forEach((r, i) => {
      r.tint = 0xffffff;
      r.width = 18 * k;
      r.height = this.bottom - this.top;
      r.position.set(cx + (i === 0 ? -railX : railX), this.top);
    });
    for (const st of this.streaks) {
      st.sp.tint = color;
      st.sp.width = 7 * k;
      st.sp.height = L.cell * (0.35 + this.rng() * 0.35);
      st.sp.x = this.left + this.width * (0.12 + this.rng() * 0.76);
      st.sp.y = this.top + this.rng() * (this.bottom - this.top);
      st.speed = BOARD_TIMING.beamStreakSpeed * k * (0.6 + this.rng() * 0.8);
    }

    this.view.visible = true;
    gsap.killTweensOf(this.view);
    if (!wasVisible) this.view.alpha = 0;
    gsap.to(this.view, { alpha: 1, duration: s(TIMING.anticipation.introDuration), ease: 'power2.out' });
    this.pulse?.kill();
    this.beam.alpha = 0.55;
    this.pulse = gsap.to(this.beam, {
      alpha: 0.9,
      duration: s(TIMING.anticipation.pulsePeriod / 2),
      ease: 'sine.inOut',
      yoyo: true,
      repeat: -1,
    });
    if (!this.offUpdate) this.offUpdate = clock.onUpdate((dt) => this.tick(dt));
  }

  /** Fade out; resolves when hidden. */
  hide(): Promise<void> {
    if (!this.view.visible) return Promise.resolve();
    gsap.killTweensOf(this.view);
    return new Promise<void>((resolve) => {
      gsap.to(this.view, {
        alpha: 0,
        duration: s(TIMING.anticipation.outroDuration),
        ease: 'power1.in',
        onComplete: () => {
          this.stop();
          resolve();
        },
        onInterrupt: () => resolve(),
      });
    });
  }

  /** Immediate off (board:set, new round). */
  stop(): void {
    gsap.killTweensOf(this.view);
    this.pulse?.kill();
    this.pulse = null;
    this.view.visible = false;
    this.view.alpha = 0;
    this.offUpdate?.();
    this.offUpdate = null;
  }

  private tick(dt: number): void {
    const span = this.bottom - this.top;
    for (const st of this.streaks) {
      st.sp.y -= st.speed * dt;
      if (st.sp.y + st.sp.height < this.top) {
        st.sp.y = this.bottom;
        st.sp.x = this.left + this.width * (0.12 + this.rng() * 0.76);
      }
      const t = (st.sp.y - this.top) / span;
      st.sp.alpha = Math.max(0, Math.min(1, Math.sin(Math.PI * t) * 1.2)) * 0.85;
    }
  }
}
