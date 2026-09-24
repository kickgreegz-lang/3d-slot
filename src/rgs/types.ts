import type { BookEvent } from '../book/types';

/**
 * Stake Engine RGS wire types (https://{rgs_url}). ALL money fields are integer
 * API units (1_000_000 = 1.00 of the currency). Round `state` is the book's
 * `events` array. Shapes follow the engine docs + the official ts-client.
 */

export interface RgsBalance {
  amount: number;
  currency: string;
}

/** config.jurisdiction — the authenticate docs say "ignore", other pages document it: read defensively. */
export interface JurisdictionFlags {
  socialCasino: boolean;
  disabledFullscreen: boolean;
  disabledTurbo: boolean;
  disabledSuperTurbo: boolean;
  disabledAutoplay: boolean;
  disabledSlamstop: boolean;
  disabledSpacebar: boolean;
  disabledBuyFeature: boolean;
  displayNetPosition: boolean;
  displayRTP: boolean;
  displaySessionTimer: boolean;
  /** ms; 0 = none. A round may not complete faster than this. */
  minimumRoundDuration: number;
}

/** One entry of config.betModes (the live RGS currently sends `{}`; the mock sends these). */
export interface RgsBetModeInfo {
  costMultiplier?: number;
  [k: string]: unknown;
}

export interface RgsConfig {
  gameID?: string;
  minBet: number;
  maxBet: number;
  stepBet: number;
  defaultBetLevel: number;
  betLevels: number[];
  betModes: Record<string, RgsBetModeInfo>;
  jurisdiction: Partial<JurisdictionFlags>;
}

export interface RgsRound {
  /** real responses use betID; the OpenAPI schema calls it roundID */
  betID?: number;
  roundID?: number;
  /** BASE bet in API units (not multiplied by the mode cost) */
  amount?: number;
  payout?: number;
  /** float bet multiple, e.g. 33.4 */
  payoutMultiplier?: number;
  costMultiplier?: number;
  active: boolean;
  mode?: string;
  /** last recorded /bet/event value (index of the reveal the player reached) */
  event?: string | null;
  state: BookEvent[];
}

export interface AuthenticateResponse {
  balance: RgsBalance;
  config: RgsConfig;
  round: RgsRound | null;
  meta?: unknown;
}

export interface PlayRequest {
  /** base bet in API units */
  amount: number;
  mode: string;
  currency: string;
}

export interface PlayResponse {
  balance: RgsBalance;
  round: RgsRound;
}

export interface BalanceResponse {
  balance: RgsBalance;
}

export type EndRoundResponse = BalanceResponse;

export interface EventResponse {
  event: string;
}

export interface ReplayRequest {
  game: string;
  version: string;
  mode: string;
  event: string;
}

export interface ReplayResponse {
  payoutMultiplier: number;
  costMultiplier: number;
  state: BookEvent[];
}

/** Server codes (docs) + client-side codes (ERR_NETWORK, ERR_EMPTY_STATE, ERR_CONFIG). */
export type RgsErrorCode =
  | 'ERR_VAL'
  | 'ERR_IPB'
  | 'ERR_IS'
  | 'ERR_ATE'
  | 'ERR_GLE'
  | 'ERR_LOC'
  | 'ERR_GEN'
  | 'ERR_MAINTENANCE'
  | 'ERR_BE'
  | 'NOT_FOUND'
  | 'ERR_NETWORK'
  | 'ERR_EMPTY_STATE'
  | 'ERR_CONFIG';

const FATAL: ReadonlySet<string> = new Set(['ERR_IS', 'ERR_ATE', 'ERR_LOC', 'ERR_CONFIG']);

/** Typed RGS failure. `code` may be an unknown operator code, so it is widened to string. */
export class RgsError extends Error {
  override readonly name = 'RgsError';

  constructor(
    readonly code: RgsErrorCode | (string & {}),
    message: string,
    /** HTTP status (0 = no response) */
    readonly status: number,
  ) {
    super(message);
  }

  /** Session-level failures cannot be retried from inside the game. */
  get fatal(): boolean {
    return FATAL.has(this.code);
  }
}

export const isRgsError = (e: unknown): e is RgsError => e instanceof RgsError;
