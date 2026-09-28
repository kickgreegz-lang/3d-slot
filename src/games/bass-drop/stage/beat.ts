import { clock } from '../../../core/clock';

/**
 * The room's shared music beat (DESIGN §17: base 100 BPM, Juke Jam 106, Mega Mix 112) for the
 * Groove Meter and the stage rigs. One accumulator on the engine clock (hit-stops freeze it, no
 * turbo scaling: the music tempo never changes with the speed profile), so the meter's idle
 * breathing, the lower cabinet's woofer and the horns / booth pump on the same beat even when
 * their modules finished init at different times (async rig loads). Each owner switches the
 * period on its own feature schedule (the schedules are identical, see Stage / GrooveMeter).
 * Retained per user: the clock listener lives while at least one module uses it.
 */
class GrooveBeat {
  /** beats since the first retain (continuous; 1 beat = one kick) */
  beats = 0;
  private periodMs = 600;
  private users = 0;
  private off: (() => void) | null = null;

  retain(): void {
    if (this.users++ > 0) return;
    this.beats = 0;
    this.off = clock.onUpdate((dt) => {
      this.beats += (dt * 1000) / this.periodMs;
    });
  }

  release(): void {
    if (this.users === 0) return;
    this.users--;
    if (this.users > 0) return;
    this.off?.();
    this.off = null;
  }

  /** Beat period (ms) of the stem that plays now. */
  setPeriod(ms: number): void {
    if (ms > 0) this.periodMs = ms;
  }

  get period(): number {
    return this.periodMs;
  }

  /** 0..1 within the current beat (0 = the kick). */
  get phase(): number {
    return this.beats - Math.floor(this.beats);
  }
}

export const grooveBeat = new GrooveBeat();
