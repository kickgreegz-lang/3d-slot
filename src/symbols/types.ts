import type { Container } from 'pixi.js';
import type { LandWeight } from '../config/game';

/**
 * SymbolView contract used by the Board. One SymbolView per board slot
 * (GRID.reels x GRID.paddedRows) plus a pool for tumble refills.
 *
 * Display structure (implementation detail, but relied on for layering):
 *   view (Container)  — positioned by the Board at the cell CENTRE; Board tweens view.y for drops
 *     └ body          — pivot at the symbol's FEET so squash/stretch reads as weight
 *         └ pose      — pop / pulse / burst about the content centre
 *             ├ art   — Sprite (static/blur) or a borrowed pooled Spine instance
 *             └ decor — Board decorations (see `decor`)
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

/** SymbolView.explode options. */
export interface ExplodeOptions {
  /** particle energy (default 1) */
  power?: number;
  /** crushed under a landing wild instead of blown up (DESIGN bass-drop §8.3) */
  crush?: boolean;
}

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
  /**
   * Decoration holder above the art, inside the squash / pop hierarchy (Board 'board:decorate'):
   * children are in design px with the origin at the cell centre (at rest), squash with the
   * body, pop with win, fade with explode and share the dim tint. Owned by the Board: it adds
   * and detaches children, the view never destroys them.
   */
  readonly decor: Container;
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
  /**
   * Explode: anticipation squeeze -> burst -> hidden. Emits particles via ctx (power scales them,
   * default 1). `crush`: the symbol is flattened under a landing wild (board:transform 'impact'):
   * pressed flat instead of blown up, with a dim charge / light and fewer particles, so the
   * wild's impact squash on top of it stays readable.
   */
  explode(opts?: ExplodeOptions): Promise<void>;
  /**
   * Board-wide bass reaction (Spine `bass_react` on track 1 if the skeleton has it, else a
   * procedural squash sy ~0.95 + small hop). Additive: never interrupts land / win.
   */
  react(power?: number): void;
  /**
   * Heavy drop impact from the contact frame (Spine `drop_impact`, else procedural sy 0.72 at
   * f1, rebound 1.10 at f5, settled by f15). Resolves when settled.
   */
  impact(): Promise<void>;
  /** Push the body by (dx, dy) design px and spring back; `ms` covers out + back. Additive. */
  nudge(dx: number, dy: number, ms: number): void;
  /** Focus dim channel (board:focus): tint toward `tint`, null clears. The darker of dim / focus shows. */
  setFocusDim(tint: number | null, animate?: boolean): void;
  /** Occasional idle accent (blink, glint, wiggle) — cheap, interruptible. */
  idleAccent(): void;
  /** Kill tweens, return borrowed Spine, back to 'static' at rest pose. */
  reset(): void;
  /** Re-parent into / out of the win RenderLayer (escape board mask). */
  setElevated(on: boolean): void;
  destroy(): void;
}
