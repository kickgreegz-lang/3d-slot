/**
 * SWAMP FUNK: BASS DROP scene events (on top of the engine's CoreGameEvents), emitted by
 * ./book.ts for the game's feature modules (Groove Meter, speaker stack, feature intros).
 * Names and payloads follow docs/games/bass-drop/DESIGN.md §3.2 / CR-3. Like every scene
 * event, a subscriber that returns a promise holds the round until it resolves.
 */

export interface DroppedWild {
  /** padded position */
  reel: number;
  row: number;
  /** 1 = plain wild (base game); x2..x10 in the features */
  multiplier: number;
  /** Mega Mix: stays on the board for the rest of the feature */
  sticky: boolean;
}

export interface StickyWild {
  reel: number;
  row: number;
  multiplier: number;
}

export type GrooveFeature = 'bonus' | 'super';
/** what the meter is counting for: a base round, or a feature (it persists across its spins) */
export type MeterMode = 'base' | GrooveFeature;

export type GameSceneEvents = {
  /** After a winInfo: value = connected symbols this round, delta = this step, thresholds = multiples of 10 just crossed. Arms the meter (orbs fly on the next board:tumble). */
  'meter:update': { value: number; delta: number; thresholds: number[] };
  /** Silent set: resume / replay start / feature start. */
  'meter:set': { value: number; mode: MeterMode; animate: boolean };
  /**
   * One bass drop (one crossed threshold), after the refill: charge, boom, flight. The
   * subscriber hands each cell to the Board with board:transform {style:'impact'}; the
   * handler then reconciles with board:transform {style:'drop'} (a no-op for cells already
   * holding the wild, the whole animation when nobody handled the drop).
   * chainIndex = 0 for the first drop after a refill, 1.. for further drops in the same step.
   */
  'wild:drop': { threshold: number; wilds: DroppedWild[]; chainIndex: number };
  /** Mega Mix: the current sticky set after each free-spin reveal (lock / multiplier diffs). */
  'wild:sticky': { wilds: StickyWild[] };
  /** Feature awarded at base round end (bought: the round was a feature buy). */
  'feature:trigger': { feature: GrooveFeature; meter: number; totalFs: number; bought: boolean };
  /** Juke Jam -> Mega Mix (60 reached during Juke Jam). */
  'feature:upgrade': { from: 'bonus'; to: 'super'; addFs: number };
};
