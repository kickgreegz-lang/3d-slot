import { clock } from '../core/clock';
import type { SpeedProfile } from '../core/timing';
import type { JurisdictionFlags } from '../rgs/types';

/**
 * Jurisdiction flags from authenticate `config.jurisdiction`, ENFORCED here (the
 * web-sdk only stores them). Missing / malformed values fall back to permissive
 * defaults, as the authenticate docs mark the object "do not use".
 *
 *   disabledTurbo / disabledSuperTurbo -> speed profiles offered by ui:turbo
 *   disabledSlamstop                   -> ui:skip / spin-to-stop ignored
 *   disabledAutoplay                   -> ui:autoplay ignored, HUD hides it
 *   disabledBuyFeature                 -> ui:buy ignored, HUD hides it
 *   disabledSpacebar                   -> capture-phase Space blocker (DOM guard)
 *   disabledFullscreen                 -> requestFullscreen rejected (DOM guard), HUD hides it
 *   displayNetPosition / displayRTP / displaySessionTimer -> HUD extras (FlowHudState)
 *   minimumRoundDuration               -> round end held until elapsed >= value
 */
export const DEFAULT_JURISDICTION: JurisdictionFlags = {
  socialCasino: false,
  disabledFullscreen: false,
  disabledTurbo: false,
  disabledSuperTurbo: false,
  disabledAutoplay: false,
  disabledSlamstop: false,
  disabledSpacebar: false,
  disabledBuyFeature: false,
  displayNetPosition: false,
  displayRTP: false,
  displaySessionTimer: false,
  minimumRoundDuration: 0,
};

export const parseJurisdiction = (raw: unknown): JurisdictionFlags => {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out = { ...DEFAULT_JURISDICTION };
  for (const key of Object.keys(out) as (keyof JurisdictionFlags)[]) {
    const v = src[key];
    if (key === 'minimumRoundDuration') {
      const n = typeof v === 'string' ? Number(v) : v;
      out.minimumRoundDuration = typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0;
    } else {
      (out as Record<string, boolean | number>)[key] = v === true || v === 'true';
    }
  }
  return out;
};

const isEditable = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

export class Jurisdiction {
  constructor(readonly flags: JurisdictionFlags = DEFAULT_JURISDICTION) {}

  /** Player-selectable speed profiles, in ui:turbo cycle order. */
  get profiles(): SpeedProfile[] {
    const list: SpeedProfile[] = ['normal'];
    if (!this.flags.disabledTurbo) {
      list.push('turbo');
      if (!this.flags.disabledSuperTurbo) list.push('superTurbo');
    }
    return list;
  }

  get turboAllowed(): boolean {
    return this.profiles.length > 1;
  }
  get autoplayAllowed(): boolean {
    return !this.flags.disabledAutoplay;
  }
  get buyAllowed(): boolean {
    return !this.flags.disabledBuyFeature;
  }
  get slamStopAllowed(): boolean {
    return !this.flags.disabledSlamstop;
  }
  get spacebarAllowed(): boolean {
    return !this.flags.disabledSpacebar;
  }
  get fullscreenAllowed(): boolean {
    return !this.flags.disabledFullscreen;
  }
  get minimumRoundMs(): number {
    return this.flags.minimumRoundDuration;
  }
  /** Speed used for the rest of a round after a slam-stop. */
  get slamProfile(): SpeedProfile {
    return this.flags.disabledSuperTurbo ? 'turbo' : 'superTurbo';
  }

  nextProfile(current: SpeedProfile): SpeedProfile {
    const list = this.profiles;
    return list[(list.indexOf(current) + 1) % list.length] ?? 'normal';
  }

  clampProfile(p: SpeedProfile): SpeedProfile {
    return this.profiles.includes(p) ? p : 'normal';
  }

  /**
   * DOM-level enforcement for flags the HUD might not know about: a window
   * capture-phase Space blocker (runs before any bubble/target listener) and a
   * fullscreen guard. Returns an uninstall function.
   */
  installDomGuards(): () => void {
    const offs: Array<() => void> = [];
    if (this.flags.disabledSpacebar) {
      const block = (e: KeyboardEvent): void => {
        if ((e.code === 'Space' || e.key === ' ') && !isEditable(e.target)) {
          e.stopImmediatePropagation();
          e.preventDefault();
        }
      };
      window.addEventListener('keydown', block, { capture: true });
      window.addEventListener('keyup', block, { capture: true });
      offs.push(() => {
        window.removeEventListener('keydown', block, { capture: true });
        window.removeEventListener('keyup', block, { capture: true });
      });
    }
    if (this.flags.disabledFullscreen) {
      const proto = Element.prototype as unknown as Record<string, unknown>;
      const names = ['requestFullscreen', 'webkitRequestFullscreen'].filter((n) => typeof proto[n] === 'function');
      const originals = names.map((n) => proto[n]);
      const denied = (): Promise<void> => Promise.reject(new DOMException('Fullscreen disabled', 'NotAllowedError'));
      for (const n of names) proto[n] = denied;
      const onChange = (): void => {
        if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
      };
      document.addEventListener('fullscreenchange', onChange);
      offs.push(() => {
        names.forEach((n, i) => (proto[n] = originals[i]));
        document.removeEventListener('fullscreenchange', onChange);
      });
    }
    return () => offs.forEach((off) => off());
  }
}

/**
 * Real-time stopwatch on THE clock (unfrozen `realDt`, so hit-stops do not
 * stretch it; deterministic under manual stepping). Used for the jurisdiction
 * minimum round duration and the session timer.
 */
export class Stopwatch {
  private ms = 0;
  private running = false;
  private readonly off: () => void;

  constructor(onTick?: (elapsedMs: number) => void) {
    this.off = clock.onUpdate(() => {
      if (!this.running) return;
      this.ms += clock.realDt * 1000;
      onTick?.(this.ms);
    });
  }

  get elapsedMs(): number {
    return this.ms;
  }

  restart(): void {
    this.ms = 0;
    this.running = true;
  }

  stop(): void {
    this.running = false;
  }

  destroy(): void {
    this.off();
  }
}
