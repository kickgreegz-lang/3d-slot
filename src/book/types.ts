/**
 * Stake Engine book format for the 7x5 cluster/tumble game (math-sdk 0_0_cluster
 * adapted to 5 rows). A "book" is one round: an ordered list of events that the
 * front-end plays back. Amounts inside books are BET MULTIPLES x100
 * (e.g. 130 = 1.3x bet). See config/game.ts for the padded-row convention.
 */

export interface RawSymbol {
  name: string;
  wild?: boolean;
  scatter?: boolean;
  /** future specials (value symbols, collectors, boosters) */
  multiplier?: number;
  value?: number;
}

/** Padded position: row 0..6, visible rows 1..5. */
export interface Position {
  reel: number;
  row: number;
}

export type GameType = 'basegame' | 'freegame';

export interface RevealEvent {
  index: number;
  type: 'reveal';
  /** [reel][paddedRow] — 7 x 7 */
  board: RawSymbol[][];
  paddingPositions?: number[];
  gameType: GameType;
  /** per reel: >0 means this reel plays anticipation before stopping */
  anticipation: number[];
}

export interface ClusterWin {
  symbol: string;
  clusterSize: number;
  /** x100 bet multiple */
  win: number;
  positions: Position[];
  meta: {
    globalMult: number;
    clusterMult: number;
    winWithoutMult: number;
    /** where the cluster win label should be shown */
    overlay: Position;
  };
}

export interface WinInfoEvent {
  index: number;
  type: 'winInfo';
  totalWin: number;
  wins: ClusterWin[];
}

export interface UpdateTumbleWinEvent {
  index: number;
  type: 'updateTumbleWin';
  amount: number;
}

export interface TumbleBoardEvent {
  index: number;
  type: 'tumbleBoard';
  /** per reel, new symbols entering from the top; index 0 is the TOP-most */
  newSymbols: RawSymbol[][];
  explodingSymbols: Position[];
}

export interface UpdateGridEvent {
  index: number;
  type: 'updateGrid';
  /** UNPADDED [reel][visibleRow] multiplier-spot values */
  gridMultipliers: number[][];
}

export interface SetWinEvent {
  index: number;
  type: 'setWin';
  amount: number;
  winLevel: number;
}

export interface SetTotalWinEvent {
  index: number;
  type: 'setTotalWin';
  amount: number;
}

export interface FreeSpinTriggerEvent {
  index: number;
  type: 'freeSpinTrigger';
  totalFs: number;
  positions: Position[];
}

export interface FreeSpinRetriggerEvent {
  index: number;
  type: 'freeSpinRetrigger';
  totalFs: number;
  positions: Position[];
}

export interface UpdateFreeSpinEvent {
  index: number;
  type: 'updateFreeSpin';
  amount: number;
  total: number;
}

export interface UpdateGlobalMultEvent {
  index: number;
  type: 'updateGlobalMult';
  globalMult: number;
}

export interface FreeSpinEndEvent {
  index: number;
  type: 'freeSpinEnd';
  amount: number;
  winLevel: number;
}

export interface FinalWinEvent {
  index: number;
  type: 'finalWin';
  amount: number;
}

export interface WincapEvent {
  index: number;
  type: 'wincap';
  amount?: number;
}

export type BookEvent =
  | RevealEvent
  | WinInfoEvent
  | UpdateTumbleWinEvent
  | TumbleBoardEvent
  | UpdateGridEvent
  | SetWinEvent
  | SetTotalWinEvent
  | FreeSpinTriggerEvent
  | FreeSpinRetriggerEvent
  | UpdateFreeSpinEvent
  | UpdateGlobalMultEvent
  | FreeSpinEndEvent
  | FinalWinEvent
  | WincapEvent;

export type BookEventType = BookEvent['type'];
export type BookEventOf<T extends BookEventType> = Extract<BookEvent, { type: T }>;

export interface Book {
  id: number;
  /** x100 bet multiple of the whole round */
  payoutMultiplier: number;
  events: BookEvent[];
  criteria?: string;
  baseGameWins?: number;
  freeGameWins?: number;
}
