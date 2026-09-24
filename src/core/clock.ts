import { gsap } from 'gsap';
import { type Ticker, UPDATE_PRIORITY } from 'pixi.js';
import { s } from './timing';

type TickFn = (dtSeconds: number) => void;

/**
 * The ONE frame clock. GSAP, Spine, three.js mixers, particles and shake all
 * advance from here, which gives us:
 *  - perfect sync between tweens, skeletal animation and the 3D pass;
 *  - hit-stop (freeze-frame) that freezes everything for N ms;
 *  - deterministic frame stepping for automated visual QA
 *    (`window.__slot.step(ms)` -> capture PNG sequences -> contact sheets).
 *
 * RULE: never use setTimeout/setInterval/requestAnimationFrame for animation.
 * Use `clock.wait(ms)`, GSAP tweens, or `clock.onUpdate`.
 */
class Clock {
  /** accumulated game time (s); frozen during hit-stop */
  time = 0;
  /** last game delta (s); 0 during hit-stop */
  dt = 0;
  /** real (unfrozen) delta of the last frame (s) — UI that must not freeze */
  realDt = 0;
  private ticker: Ticker | null = null;
  private freezeLeftMs = 0;
  private listeners = new Set<TickFn>();
  private manual = false;

  attach(ticker: Ticker): void {
    if (this.ticker) return;
    this.ticker = ticker;
    this.time = gsap.ticker.time;
    gsap.ticker.remove(gsap.updateRoot);
    ticker.add(this.onTick, this, UPDATE_PRIORITY.HIGH);
  }

  private onTick(t: Ticker): void {
    const ms = Math.min(t.deltaMS, 100);
    let advance = ms;
    if (this.freezeLeftMs > 0) {
      const frozen = Math.min(this.freezeLeftMs, ms);
      this.freezeLeftMs -= frozen;
      advance = ms - frozen;
    }
    this.realDt = ms / 1000;
    this.dt = advance / 1000;
    this.time += this.dt;
    gsap.updateRoot(this.time);
    for (const fn of this.listeners) fn(this.dt);
  }

  /** Per-frame callback with the (hit-stop aware) game delta in seconds. */
  onUpdate(fn: TickFn): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Freeze all gameplay motion for `ms` real milliseconds (impact emphasis). */
  hitStop(ms: number): void {
    this.freezeLeftMs = Math.max(this.freezeLeftMs, ms);
  }

  /** Speed-profile-scaled wait driven by the game clock (deterministic). */
  wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      gsap.delayedCall(s(ms), resolve);
    });
  }

  /** Unscaled wait (UI timing that must not speed up in turbo). */
  waitUi(ms: number): Promise<void> {
    return new Promise((resolve) => {
      gsap.delayedCall(ms / 1000, resolve);
    });
  }

  /** Switch to manual stepping (automated capture). */
  setManual(on: boolean): void {
    if (!this.ticker) return;
    this.manual = on;
    if (on) this.ticker.stop();
    else this.ticker.start();
  }

  get isManual(): boolean {
    return this.manual;
  }

  /** Advance exactly `ms` (only meaningful in manual mode). Renders one frame. */
  step(ms = 1000 / 60): void {
    if (!this.ticker) return;
    this.ticker.update(this.ticker.lastTime + ms);
  }
}

export const clock = new Clock();
