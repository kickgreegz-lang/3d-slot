import type { Container } from 'pixi.js';
import { speedScale } from '../core/timing';
import { FrameLoop } from '../symbols/spring';
import { BOARD_TIMING } from './boardTiming';

/**
 * Board thump (ANIMATION_CONTRACT §9, DESIGN bass-drop §5): the symbol container dips on a
 * damped spring (BOARD_TIMING.thumpHz, thumpZeta) and settles back to 0. A kick adds
 * velocity sized so the FIRST peak of a kick from rest equals the requested dip, so
 * overlapping thumps stack naturally.
 *
 * The spring is stepped with the exact closed-form solution of the damped oscillator (not
 * numerically): a 9 Hz spring peaks ~21 ms after the kick, and a sub-stepped Euler lags
 * enough there to lose a quarter of the dip at 60 fps. Stepped on the game clock (hit-stop
 * freezes it, turbo speeds it up like every symbol spring); the loop stops once settled.
 */
export class GridThump {
  private x = 0;
  private v = 0;
  /** w², zeta * w and the damped angular frequency, refreshed from BOARD_TIMING per kick / frame */
  private w2 = 1;
  private zw = 0;
  private wd = 1;
  private readonly loop = new FrameLoop((dt) => this.tick(dt));

  constructor(private readonly target: Container) {}

  /** Dip `px` design px (positive = down). */
  kick(px: number): void {
    if (!(Math.abs(px) > 0.01)) return;
    this.tune();
    const { zw, wd } = this;
    // impulse response x(t) = v0/wd e^(-zw t) sin(wd t): first peak where tan(wd t) = wd / zw
    const tp = Math.atan2(wd, zw) / wd;
    const gain = (Math.exp(-zw * tp) * Math.sin(wd * tp)) / wd;
    this.v += px / Math.max(1e-6, gain);
    this.loop.start();
  }

  /** Snap back to rest (board:set, destroy). */
  reset(): void {
    this.x = 0;
    this.v = 0;
    this.target.y = 0;
    this.loop.stop();
  }

  /** Spring constants from BOARD_TIMING (lab-tunable): zw = zeta * omega, wd = damped angular frequency. */
  private tune(): void {
    const w = 2 * Math.PI * BOARD_TIMING.thumpHz;
    const z = Math.min(0.99, Math.max(0.01, BOARD_TIMING.thumpZeta));
    this.w2 = w * w;
    this.zw = z * w;
    this.wd = w * Math.sqrt(1 - z * z);
  }

  private tick(dtRaw: number): void {
    const dt = dtRaw * speedScale();
    if (dt <= 0) return;
    this.tune();
    const { w2, zw, wd } = this;
    const e = Math.exp(-zw * dt);
    const c = Math.cos(wd * dt);
    const s = Math.sin(wd * dt);
    const x = this.x;
    const v = this.v;
    this.x = e * (x * c + ((v + zw * x) / wd) * s);
    this.v = e * (v * c - ((zw * v + w2 * x) / wd) * s);
    this.target.y = this.x;
    if (Math.abs(this.x) + Math.abs(this.v) / Math.sqrt(w2) < 0.05) this.reset();
  }
}
