import type { Container } from 'pixi.js';
import type { LandWeight } from '../config/game';

/**
 * SymbolView contract used by the Board. One SymbolView per board slot
 * (7 reels x 7 padded rows) plus a pool for tumble refills.
 *
 * Display structure (implementation detail, but relied on for layering):
 *   view (Container)  — positioned by the Board at the cell CENTRE; Board tweens view.y for drops
 *     └ body          — pivot at the symbol's FEET so squash/stretch reads as weight
 *         └ art       — Sprite (static/blur) or a borrowed pooled Spine instance
 *
 * All animation methods are idempotent-safe and resolve when their motion finishes.
 * All durations come from core/timing.ts; all motion is driven by core/clock.ts.
 */
export type SymbolState =
  | 'static'
  | 'blur'
  | 'falling'
  | 'land'
  | 'anticipation'
  | 'win'
  | 'postWin'
  | 'explode'
  | 'hidden';

export interface LandOptions {
  /** impact speed in design px/s (drives squash amount + wobble energy) */
  velocity: number;
  /** override the symbol's configured weight */
  weight?: LandWeight;
  /** true when landing as part of a tumble refill (softer) */
  tumble?: boolean;
  /** caller (the Board) plays its own per-column land sound — suppress the per-symbol one */
  silent?: boolean;
}

export interface SymbolView {
  readonly view: Container;
  readonly id: string;
  readonly state: SymbolState;
  /** Swap the symbol id (resets to static, keeps position). */
  setSymbol(id: string): void;
  /** Motion-blur variant while falling fast. */
  setBlur(on: boolean): void;
  /** Called by the Board at the exact frame of impact. Squash -> spring recovery -> settle. */
  land(opts: LandOptions): Promise<void>;
  /** Scatter/special anticipation loop (intro -> loop until stopped -> outro). */
  setAnticipation(on: boolean): void;
  /** Dim (non-winning / non-anticipating) with tint tween. */
  setDim(on: boolean, animate?: boolean): void;
  /** Win: pop + win animation (+ shine). Ends in 'postWin' (still visible, highlighted). */
  win(): Promise<void>;
  /** Explode: anticipation squeeze -> burst -> hidden. Emits particles via ctx. */
  explode(): Promise<void>;
  /** Occasional idle accent (blink, glint, wiggle) — cheap, interruptible. */
  idleAccent(): void;
  /** Kill tweens, return borrowed Spine, back to 'static' at rest pose. */
  reset(): void;
  /** Re-parent into / out of the win RenderLayer (escape board mask). */
  setElevated(on: boolean): void;
  destroy(): void;
}
