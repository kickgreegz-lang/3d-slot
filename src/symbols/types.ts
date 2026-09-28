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
  /**
   * Called once on the burst frame: the rig's `explode_burst` (frame 2-3) or the procedural burst
   * at TIMING.explode.anticipateDuration. The Board syncs 'board:burst' / hit-stop / shake to it.
   */
  onBurst?: () => void;
}

/**
 * Runtime-owned bone channel of a rig look (ANIMATION_SET: e.g. `ctrl_badge_scale`, "the runtime's
 * plate scale"). A LIVE object: the owner tweens its fields and the rig writes them into the bone's
 * local pose every update (after the animation is applied), so only bones no clip keys belong here.
 */
export interface SymbolBoneDrive {
  x?: number;
  y?: number;
  rotation?: number;
  scaleX?: number;
  scaleY?: number;
}

/**
 * Persistent rig state of one symbol VIEW (Board 'board:look', 'board:transform' cells): a W that
 * carries a multiplier badge or sticky clamps (ANIMATION_SET §2.6 / §2.7). While a look is set the
 * view keeps a live Spine instance (the static board sprite cannot show a skin) and loops `rest`
 * between actions; land / win / explode / blur play in the look's skin. It follows the view
 * (tumble falls, holds) and is cleared when the Board recycles the view (explode -> pool, fall-out,
 * board:set, symbol swap) or with null. Needs the symbol's Spine rig: without one it is ignored and
 * the owner keeps its code decorations.
 */
export interface SymbolLook {
  /** Spine skin (default: the rig's default skin); a change re-poses the slots, then `attachments` apply */
  skin?: string;
  /** slot -> attachment (e.g. badge: 'badge_t3'), re-applied after every skin change / setup pose */
  attachments?: Readonly<Record<string, string | null>>;
  /**
   * Live display objects mounted in empty `txt_*` slots (addSlotObject: they follow the slot's bone,
   * draw order and alpha). Owned by the caller: the view only adds / removes them, never destroys.
   * Units = skeleton units (the 360 @2x canvas, 1 unit = 1 canvas px), origin at the bone.
   */
  mounts?: Readonly<Record<string, Container>>;
  /** runtime bone channels (live objects, see SymbolBoneDrive) */
  bones?: Readonly<Record<string, SymbolBoneDrive>>;
  /** loop between actions (default 'idle') */
  rest?: string;
}

/** SymbolView.play options (Board 'board:play'). */
export interface SymbolPlayOptions {
  /** 0 = state track (default); >= 1 = one-shot ADDITIVE overlay on that track */
  track?: number;
  loop?: boolean;
  /**
   * Track 0 one-shots: the loop queued after the clip (mix per SYMBOL_TIMING.spine.mixes).
   * undefined = the look's rest (or back to the static sprite without a look); null = hold the last pose.
   */
  next?: string | null;
  /** rig event name -> handler, fired once on the event's frame (e.g. mult_swap, lock_snap) */
  events?: Readonly<Record<string, () => void>>;
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
  /**
   * Persistent rig look (skin, attachments, live slot mounts, bone channels, rest loop), or null to
   * clear it. Calling it again with a new object updates in place (a tier swap, sticky after mult).
   * Returns false when the symbol has no Spine rig (the look is not applied).
   */
  setLook(look: SymbolLook | null): boolean;
  /** Whether the symbol's rig has `clip` (false without a rig). */
  has(clip: string): boolean;
  /**
   * Play a rig clip ('board:play': the W's drop / sticky clips, flying proxies). Resolves on
   * complete OR interrupt, at once when the rig or the clip is missing, or the view is exploding.
   */
  play(clip: string, opts?: SymbolPlayOptions): Promise<void>;
  /** Kill tweens, return borrowed Spine, back to 'static' at rest pose. */
  reset(): void;
  /** Re-parent into / out of the win RenderLayer (escape board mask). */
  setElevated(on: boolean): void;
  destroy(): void;
}
