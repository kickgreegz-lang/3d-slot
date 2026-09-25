import { gsap } from 'gsap';
import { followSpeed, s } from '../core/timing';
import { SYMBOL_TIMING as T } from './symbolTiming';

/**
 * Additive body-motion channels a SymbolRig layers on top of its own squash spring / hop:
 *
 *   react   `bass_react` — small squash + hop (board-wide bass wave, DESIGN bass-drop §5)
 *   impact  heavy drop impact keys (sy 0.72 at f1, rebound 1.10 at f5, settle by f15)
 *   push    neighbour push (translate out, spring back)
 *
 * They multiply (scale) / add (offset) onto the body transform in SymbolRig.applyBody and
 * never touch the rig's state machine, so a reaction can hit a symbol mid-land or mid-win.
 * Everything is s()-timed and follows a mid-round speed change (followSpeed). `kill()`
 * snaps every channel back to rest (the rig's reset()).
 */
export class BodyOverlay {
  /** combined output, read by the rig every applyBody() */
  sx = 1;
  sy = 1;
  x = 0;
  y = 0;
  private readonly react = { sx: 1, sy: 1, hop: 0 };
  private readonly hit = { sx: 1, sy: 1 };
  private readonly push = { x: 0, y: 0 };
  private reactTl: gsap.core.Timeline | null = null;
  private hitTl: gsap.core.Timeline | null = null;
  private pushTl: gsap.core.Timeline | null = null;
  private hitResolve: (() => void) | null = null;
  private readonly update = (): void => {
    this.combine();
    this.onChange();
  };

  constructor(private readonly onChange: () => void) {}

  /** True while any channel is away from rest. */
  get active(): boolean {
    return !!(this.reactTl || this.hitTl || this.pushTl);
  }

  /** `bass_react`: squash, hop `hopPx` design px up, land (power 0..1 scales both). */
  playReact(power: number, hopPx: number): void {
    const R = T.bassReact;
    const p = Math.max(0, Math.min(1.5, power));
    this.reactTl?.kill();
    const r = this.react;
    const tl = followSpeed(gsap.timeline({ onUpdate: this.update, onComplete: () => this.endReact(tl) }));
    tl.to(r, { sy: 1 - (1 - R.squashY) * p, sx: 1 + (R.squashX - 1) * p, hop: 0, duration: s(R.inMs), ease: 'power2.out' });
    tl.to(r, { sy: 1 + (R.reboundY - 1) * p, sx: 1 + (R.reboundX - 1) * p, hop: hopPx * p, duration: s(R.riseMs), ease: 'power2.out' });
    tl.to(r, { sy: 1, sx: 1, hop: 0, duration: s(R.fallMs), ease: 'power2.in' });
    this.reactTl = tl;
  }

  /** Heavy impact keys from contact (f0) to the setup pose (f15). Resolves when settled. */
  playImpact(): Promise<void> {
    const D = T.dropImpact;
    this.endImpact();
    const h = this.hit;
    h.sx = 1;
    h.sy = 1;
    const tl = followSpeed(gsap.timeline({ onUpdate: this.update, onComplete: () => this.endImpact() }));
    tl.to(h, { sy: D.squashY, sx: D.squashX, duration: s(D.f1), ease: 'power3.out' });
    tl.to(h, { sy: D.reboundY, sx: D.reboundX, duration: s(D.f5 - D.f1), ease: 'sine.inOut' });
    tl.to(h, { sy: D.settleY, sx: D.settleX, duration: s(D.f9 - D.f5), ease: 'sine.inOut' });
    tl.to(h, { sy: 1, sx: 1, duration: s(D.f15 - D.f9), ease: 'sine.out' });
    this.hitTl = tl;
    return new Promise<void>((resolve) => {
      this.hitResolve = resolve;
    });
  }

  /** Translate by (dx, dy) design px, then spring back; `ms` is the whole push (out + back). */
  nudge(dx: number, dy: number, ms: number): void {
    const N = T.nudge;
    this.pushTl?.kill();
    const p = this.push;
    const tl = followSpeed(
      gsap.timeline({
        onUpdate: this.update,
        onComplete: () => {
          if (this.pushTl === tl) this.pushTl = null;
        },
      }),
    );
    tl.to(p, { x: dx, y: dy, duration: s(ms * N.outShare), ease: 'power2.out' });
    tl.to(p, { x: 0, y: 0, duration: s(ms * (1 - N.outShare)), ease: N.backEase });
    this.pushTl = tl;
  }

  /** Snap every channel to rest (resolves a pending impact). */
  kill(): void {
    this.reactTl?.kill();
    this.reactTl = null;
    this.pushTl?.kill();
    this.pushTl = null;
    this.endImpact();
    this.react.sx = this.react.sy = 1;
    this.react.hop = 0;
    this.hit.sx = this.hit.sy = 1;
    this.push.x = this.push.y = 0;
    this.combine();
  }

  private endReact(tl: gsap.core.Timeline): void {
    if (this.reactTl === tl) this.reactTl = null;
  }

  private endImpact(): void {
    this.hitTl?.kill();
    this.hitTl = null;
    const r = this.hitResolve;
    this.hitResolve = null;
    r?.();
  }

  private combine(): void {
    this.sx = this.react.sx * this.hit.sx;
    this.sy = this.react.sy * this.hit.sy;
    this.x = this.push.x;
    this.y = this.push.y - this.react.hop;
  }
}
