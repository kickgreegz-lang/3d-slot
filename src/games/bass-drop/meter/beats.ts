import { gsap } from 'gsap';
import { followSpeed } from '../../../core/timing';

interface Beat {
  tween: gsap.core.Tween;
  fn: () => void;
  /** pure garnish (a pump): dropped by flush() instead of played late */
  cosmetic: boolean;
}

/**
 * A list of scheduled meter beats on the game clock (charge -> boom, trigger pumps, the drain
 * behind the wipe). Each beat is a gsap delayedCall registered with followSpeed, so a slam
 * retimes it with every other gameplay animation. `flush()` runs the pending state beats NOW
 * (the flow moved on before they played: the next reveal, round end) and drops the cosmetic
 * ones; `cancel()` drops everything.
 */
export class Beats {
  private list: Beat[] = [];

  /** Run `fn` after `sec` game seconds (already s()-scaled by the caller). */
  at(sec: number, fn: () => void, cosmetic = false): void {
    const beat: Beat = {
      fn,
      cosmetic,
      tween: followSpeed(
        gsap.delayedCall(sec, () => {
          this.list = this.list.filter((b) => b !== beat);
          fn();
        }),
      ),
    };
    this.list.push(beat);
  }

  get pending(): number {
    return this.list.length;
  }

  flush(): void {
    const list = this.list;
    this.list = [];
    for (const b of list) {
      b.tween.kill();
      if (!b.cosmetic) b.fn();
    }
  }

  cancel(): void {
    for (const b of this.list) b.tween.kill();
    this.list = [];
  }
}
