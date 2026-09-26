import { gsap } from 'gsap';
import { followSpeed } from '../../../core/timing';

/**
 * A tracked set of game-clock beats and tweens (one per choreography run). Every entry is a
 * GSAP animation registered with followSpeed, so a slam-stop retimes it with the rest of the
 * round, and a hit-stop freezes it. `kill()` drops everything still pending (board:set,
 * resume, round end): nothing it scheduled fires afterwards, and every wait() resolves.
 */
export class Sched {
  private readonly live = new Set<gsap.core.Animation>();
  private readonly waits = new Map<gsap.core.Animation, () => void>();

  /** Run `fn` after `sec` game seconds (already s()-scaled by the caller). */
  at(sec: number, fn: () => void): gsap.core.Tween {
    const call: gsap.core.Tween = followSpeed(
      gsap.delayedCall(Math.max(0, sec), () => {
        this.live.delete(call);
        fn();
      }),
    );
    this.live.add(call);
    return call;
  }

  /** Track a tween / timeline built by the caller (followSpeed-registered here); killed with the rest. */
  add<A extends gsap.core.Animation>(a: A): A {
    followSpeed(a);
    this.live.add(a);
    // forget it once done (the caller's own onComplete still runs first)
    const own = a.eventCallback('onComplete') as ((...args: unknown[]) => void) | undefined;
    a.eventCallback('onComplete', (...args: unknown[]) => {
      own?.(...args);
      this.live.delete(a);
    });
    return a;
  }

  /** Stop tracking (and kill) one animation. */
  drop(a: gsap.core.Animation | null | undefined): void {
    if (!a) return;
    a.kill();
    this.live.delete(a);
  }

  /** Resolves after `sec` game seconds, or at once when the run is killed (never hangs). */
  wait(sec: number): Promise<void> {
    return new Promise((resolve) => {
      const call = this.at(sec, () => {
        this.waits.delete(call);
        resolve();
      });
      this.waits.set(call, resolve);
    });
  }

  kill(): void {
    for (const a of this.live) a.kill();
    this.live.clear();
    const waits = [...this.waits.values()];
    this.waits.clear();
    for (const r of waits) r();
  }
}
