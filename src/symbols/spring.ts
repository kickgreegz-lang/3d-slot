import { clock } from '../core/clock';

/** Largest integration step (s). Stiff springs stay stable at 30 fps and through frame hitches. */
const MAX_STEP = 1 / 240;

/**
 * Damped spring with unit mass, integrated with semi-implicit (symplectic) Euler:
 *   v += (-k (x - target) - c v) h;   x += v h
 * Underdamped when c < 2√k — that ringing is the jelly wobble.
 */
export class Spring {
  x = 0;
  v = 0;
  target = 0;

  constructor(
    public stiffness: number,
    public damping: number,
  ) {}

  /** Advance by dt seconds (sub-stepped). */
  step(dt: number): void {
    if (dt <= 0) return;
    const n = Math.ceil(dt / MAX_STEP);
    const h = dt / n;
    const k = this.stiffness;
    const c = this.damping;
    for (let i = 0; i < n; i++) {
      this.v += (-k * (this.x - this.target) - c * this.v) * h;
      this.x += this.v * h;
    }
  }

  /** Displacement from target plus velocity scaled to the same units (one natural period). */
  energy(): number {
    return Math.abs(this.x - this.target) + Math.abs(this.v) / Math.sqrt(this.stiffness);
  }

  settled(eps: number): boolean {
    return this.energy() < eps;
  }

  /** Jump to rest at the current target. */
  snap(): void {
    this.x = this.target;
    this.v = 0;
  }

  reset(value = 0): void {
    this.x = value;
    this.v = 0;
    this.target = value;
  }

  /** Damped natural frequency (rad/s); 0 when over-damped. */
  get omega(): number {
    const g = this.damping / 2;
    return Math.sqrt(Math.max(0, this.stiffness - g * g));
  }

  /** Time (s) from release at an extreme to the next zero crossing. */
  get quarterPeriod(): number {
    const w = this.omega;
    return w > 0 ? Math.PI / 2 / w : 0;
  }
}

/**
 * Idempotent per-frame loop on the game clock (hit-stop aware). Start it when a rig
 * becomes active, stop it when it settles, so static symbols cost nothing per frame.
 */
export class FrameLoop {
  private off: (() => void) | null = null;

  constructor(private readonly fn: (dt: number) => void) {}

  get running(): boolean {
    return this.off !== null;
  }

  start(): void {
    if (!this.off) this.off = clock.onUpdate(this.fn);
  }

  stop(): void {
    this.off?.();
    this.off = null;
  }
}
