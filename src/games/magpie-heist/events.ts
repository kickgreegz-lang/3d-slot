import type { Position } from '../../book/types';
import type { HeistFeature, LootTier } from './config';

/**
 * MAGPIE HEIST scene events (on top of the engine's CoreGameEvents), emitted by ./book.ts for the
 * game's feature modules (glint squares, Shooting Star, loot, heist screens). Like every scene event,
 * a subscriber that returns a promise holds the round until it resolves. Positions are padded.
 */

export type LootItem =
  | (Position & { kind: 'coin'; tier: LootTier; value: number })
  | (Position & { kind: 'diamond'; mult: number })
  | (Position & { kind: 'nest'; value: number });

export interface LootTarget extends Position {
  kind: 'coin' | 'nest';
  from: number;
  to: number;
}

export interface LootSource extends Position {
  kind: 'coin' | 'nest';
  value: number;
}

export type GameSceneEvents = {
  /** After a winInfo: winning positions that became glint squares (+ the full set). Gilds them on the next board:burst. */
  'glint:add': { added: Position[]; squares: Position[] };
  /** Instant set (free-spin start, resume): the persisting squares. */
  'glint:state': { squares: Position[] };
  /** End of an activation / base spin: clear the squares (keep = Vault Raid / Starfall keeps them). */
  'glint:reset': { squares: Position[]; keep: boolean };
  /** The cascade settled with a Shooting Star on the board: the star fires. */
  'star:activate': { stars: Position[]; squares: Position[] };
  /** Squares reveal their loot (round 1 = the star's sweep, 2+ = re-reveals after a nest). */
  'loot:reveal': { round: number; items: LootItem[] };
  /** A diamond multiplies its neighbours. */
  'loot:boost': Position & { mult: number; targets: LootTarget[] };
  /** A nest collects every coin on the board. */
  'loot:collect': Position & { from: number; to: number; sources: LootSource[] };
  /** The activation pays every remaining coin and nest. */
  'loot:payout': { amount: number; items: LootSource[] };
  /** Free spins awarded at base round end (bought: the round was a feature buy). */
  'heist:trigger': { feature: HeistFeature; scatters: number; totalFs: number; positions: Position[]; bought: boolean };
  /** Extra free spins (2+ Safes during a feature). */
  'heist:retrigger': { feature: HeistFeature; addFs: number; total: number; positions: Position[] };
  /** Night Prowl -> Vault Raid (4+ Safes during Night Prowl). */
  'heist:upgrade': { from: HeistFeature; to: HeistFeature; addFs: number; total: number; positions: Position[] };
  /** The active heist look (base / a feature), for background, frame and music. */
  'heist:mode': { feature: HeistFeature | null };
};
