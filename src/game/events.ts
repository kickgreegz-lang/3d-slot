import type { ClusterWin, GameType, Position } from '../book/types';
import type { WinTierKey } from '../config/game';
import type { LayoutSpec } from '../config/layout';
import type { SpeedProfile } from '../core/timing';

/**
 * SCENE EVENTS — emitted by the flow layer (book player handlers) and consumed
 * by visual modules (board, spots, win presenter, big win, mascots, sound, HUD).
 * Book handlers `await game.broadcastAsync(...)`, so every subscriber that
 * returns a promise holds the round until its animation finishes.
 *
 * Symbol boards are symbol-id strings, [reel][paddedRow] (7x7). Positions are
 * PADDED rows. Multiplier grids are UNPADDED [reel][visibleRow] (7x5).
 * Amounts are book units: bet multiple x100.
 */
export type MascotCue =
  | 'idle'
  | 'spinStart'
  | 'anticipation'
  | 'reactSmall'
  | 'reactTumble'
  | 'spotUpgrade'
  | 'winBig'
  | 'celebrate'
  | 'fsTrigger'
  | 'fsEnd';

export type SfxId =
  | 'spin_start'
  | 'fall_out'
  | 'land_light'
  | 'land_medium'
  | 'land_heavy'
  | 'land_special'
  | 'scatter_land_1'
  | 'scatter_land_2'
  | 'scatter_land_3'
  | 'anticipation_loop'
  | 'anticipation_end'
  | 'win_small'
  | 'win_cluster'
  | 'explode'
  | 'tumble_drop'
  | 'spot_mark'
  | 'spot_upgrade'
  | 'counter_tick'
  | 'counter_end'
  | 'bigwin_start'
  | 'bigwin_tier'
  | 'bigwin_end'
  | 'fs_trigger'
  | 'fs_intro'
  | 'fs_outro'
  | 'ui_click'
  | 'ui_bet_up'
  | 'ui_bet_down';

export type GameEvents = {
  /** Spin pressed and accepted: old board falls out, mascots react. */
  'round:start': { profile: SpeedProfile };
  /** Round presentation complete (all events played). */
  'round:end': { totalWin: number };

  /** New board: symbols drop in with gravity, land with squash/physics, anticipation per reel. */
  'board:reveal': { board: string[][]; anticipation: number[]; gameType: GameType };
  /** Winning clusters: dim others, pop winners, win anim, cluster labels. */
  'board:showWins': { wins: ClusterWin[]; totalWin: number };
  /** Explode winners, then remove + gravity refill with new symbols (index 0 = top). */
  'board:tumble': { exploding: Position[]; newSymbols: string[][] };
  /** Instantly set a board without animation (resume/replay start, dev). */
  'board:set': { board: string[][] };

  /** Multiplier spots changed (animate only cells where value differs). */
  'spots:update': { grid: number[][]; previous: number[][] };
  /** Clear or restore all spots without fanfare (mode change, resume). */
  'spots:reset': { grid: number[][] | null };

  /** Running win of the current tumble sequence. */
  'win:tumble': { amount: number };
  /** Win of a (free)spin with its level 1..10 (math-sdk winLevel). */
  'win:set': { amount: number; level: number };
  /** Accumulated round total so far. */
  'win:total': { amount: number };
  /** Final round win (counter must end exactly here). */
  'win:final': { amount: number };
  /** Big-win celebration; resolves after dismiss / auto-close. */
  'bigwin:show': { amount: number; tier: WinTierKey };

  /** Free spins awarded (scatter celebration + intro). */
  'fs:trigger': { total: number; positions: Position[]; retrigger: boolean };
  'fs:update': { current: number; total: number };
  'fs:end': { amount: number; level: number };
  /** Base <-> free-game presentation switch (background, music, spot panel). */
  'mode:change': { gameType: GameType };

  'mascot:cue': { cue: MascotCue; intensity?: number };
  'sfx': { id: SfxId; volume?: number; rate?: number; delayMs?: number };
  /** Add trauma (0..1) to the camera shake. */
  'fx:shake': { trauma: number };
  /** Particle burst at a design-space (root) position. */
  'fx:burst': {
    kind: 'explode' | 'dust' | 'sparkle' | 'coins' | 'confetti' | 'spotSpark' | 'scatter';
    x: number;
    y: number;
    color?: number;
    count?: number;
    /** 0..1 energy scale */
    power?: number;
  };
  /** Full-screen flash (additive white/colour). */
  'fx:flash': { color?: number; alpha?: number; durationMs?: number };

  'layout:change': { layout: LayoutSpec; scale: number };
};

/** UI -> flow commands (HUD and DOM menus emit these). */
export type UiEvents = {
  'ui:spin': void;
  'ui:skip': void;
  'ui:betUp': void;
  'ui:betDown': void;
  'ui:betSet': { index: number };
  'ui:turbo': void;
  /** rounds may be Infinity; limits are RGS API money units */
  'ui:autoplay': { rounds: number; lossLimit?: number; singleWinLimit?: number } | null;
  'ui:buy': { mode: string };
  'ui:menu': { open: boolean; page?: 'paytable' | 'rules' | 'settings' | 'guide' };
  'ui:sound': { enabled: boolean };
};

/** Flow -> HUD state snapshots (HUD renders; it never computes money). */
export interface HudState {
  /** preformatted strings (currency formatting + social mode applied by flow) */
  balanceText: string;
  betText: string;
  winText: string;
  /** raw API units for count-ups */
  balance: number;
  bet: number;
  win: number;
  spinEnabled: boolean;
  isSpinning: boolean;
  betUpEnabled: boolean;
  betDownEnabled: boolean;
  turbo: SpeedProfile;
  turboAllowed: boolean;
  autoplayAllowed: boolean;
  autoplayRemaining: number | null;
  buyAllowed: boolean;
  freeSpins: { current: number; total: number } | null;
  replay: boolean;
  social: boolean;

  // --- optional extras sent by the flow (flow/hudState.ts FlowHudState) ---
  /** flow FSM state */
  phase?: string;
  /** active bet mode key and its cost multiplier */
  mode?: string;
  modeCost?: number;
  /** bet as an index into ALL RGS bet levels, with preformatted level texts */
  betIndex?: number;
  betLevelCount?: number;
  betLevelTexts?: string[];
  /** balance covers the next base spin */
  canAfford?: boolean;
  /** jurisdiction permissions */
  slamStopAllowed?: boolean;
  spacebarAllowed?: boolean;
  fullscreenAllowed?: boolean;
  soundEnabled?: boolean;
  /** jurisdiction displays (null = hidden) */
  netPositionText?: string | null;
  rtpText?: string | null;
  sessionTimeText?: string | null;
  /** replay mode: start/play-again button + bet info (null outside replay) */
  replayPhase?: 'loading' | 'ready' | 'playing' | 'done' | 'error' | null;
  replayButtonText?: string | null;
  replayInfoText?: string | null;
  replayResultText?: string | null;
}

export type HudEvents = {
  'hud:state': HudState;
  /** animate the win display counting from->to over ms (book units x100 * bet already applied: API units) */
  'hud:countWin': { from: number; to: number; durationMs: number };
  'hud:message': { text: string; kind: 'info' | 'error' } | null;
};
