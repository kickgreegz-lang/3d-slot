import type { GameSceneEvents } from '@game/events';
import type { Container } from 'pixi.js';
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
 * Symbol boards are symbol-id strings, [reel][paddedRow] (GRID.reels x GRID.paddedRows).
 * Positions are PADDED rows. Multiplier grids are UNPADDED [reel][visibleRow]
 * (GRID.reels x GRID.rows). Amounts are book units: bet multiple x100.
 *
 * `CoreGameEvents` are shared by every game; the active game adds its own scene events
 * (`GameSceneEvents` in src/games/<GAME>/events.ts) for its feature modules.
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
  | 'fsEnd'
  // Groove / Bass Drop cues (DESIGN bass-drop §16, CR-3); games without them never emit them
  | 'meterHeat'
  | 'meterThreshold'
  | 'bassDropCharge'
  | 'bassDrop'
  | 'wildLand'
  | 'featureLock'
  | 'featureUpgrade';

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
  | 'ui_bet_down'
  // Bass Drop (DESIGN bass-drop §17, CR-5)
  | 'link_connect'
  | 'orb_launch'
  | 'orb_absorb'
  | 'meter_threshold'
  | 'meter_lock_bonus'
  | 'meter_lock_super'
  | 'meter_heat'
  | 'meter_drain'
  | 'meter_lap'
  | 'bass_charge'
  | 'bass_boom'
  | 'wild_launch'
  | 'wild_whoosh'
  | 'wild_impact'
  | 'symbol_crush'
  | 'wild_mult'
  | 'sticky_lock'
  | 'sticky_mult_up'
  | 'feature_upgrade'
  | 'intro_card'
  | 'buy_open'
  | 'buy_select'
  | 'buy_confirm'
  | 'button_slam'
  | 'cooler_slam'
  | 'mic_drop'
  | 'dj_scratch';

export type BoardTransformStyle = 'drop' | 'impact' | 'morph' | 'set';

export type CoreGameEvents = {
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
  /**
   * Replace symbols in place (wild drops, symbol upgrades, sticky restores); resolves when
   * settled. Cells already showing the id are left alone (so a follow-up transform is a
   * cheap reconcile). Styles:
   *   'drop'   the new symbol falls into the cell from above the grid and smashes the old one;
   *   'impact' the old symbol is crushed NOW (explode, fx power 0.6, `symbol_crush`, NO
   *            board:burst / orb); TIMING.explode.anticipateDuration (s()-scaled) later the new
   *            one is placed with a heavy impact (sy 0.72 at f1, 1.10 at f5, settled by f15 —
   *            or the rig's `drop_impact`) and the 4 orthogonal neighbours are pushed out
   *            6 x k px and spring back over 200 ms; resolves when settled (~330 ms normal).
   *            Never staggered, and it also replaces a cell that already shows the id.
   *            A caller flying its own proxy calls it at contact - anticipateDuration, hides
   *            the proxy at contact and plays the contact feedback itself (impact SFX, dust /
   *            flipbook, shake, hit-stop, board:thump, mascot cue): the Board adds none;
   *   'morph'  swap in place with a sparkle pop;
   *   'set'    instant, no fanfare (resume / replay).
   */
  'board:transform': { cells: Array<Position & { id: string }>; style: BoardTransformStyle };
  /**
   * Hang (display) or remove (null) a decoration `key` on the symbol view at a padded cell
   * (multiplier badges, sticky clamps, tags). It follows that VIEW - through tumble falls,
   * squash and win pops - not the cell. The display lives in the view's `decor` holder:
   * design px with the origin at the cell centre (at rest), above the art, sharing the
   * symbol's dim tint, fading with its explode. The same key replaces the previous display.
   * The Board detaches it (removeFromParent, never destroys it) when the view is recycled:
   * after an explode, at a fall-out, board:set, or a symbol swap (transform 'set' / 'morph').
   * Owners check `display.parent` or re-attach, and re-size on layout:change.
   * Synchronous: fire with ctx.game.broadcast.
   */
  'board:decorate': { reel: number; row: number; key: string; display: Container | null };
  /**
   * Grid container dips `px` design px (x k, k = pitch / 154) and springs back (9 Hz, zeta 0.5:
   * peak ~21 ms, settled ~150 ms); overlapping thumps stack. Reduced motion: x 0.3.
   */
  'board:thump': { px: number };
  /**
   * Board-wide reaction wave: every visible symbol hops (sy ~0.95, 8 frames; Spine rigs play
   * `bass_react` on track 1) with an onset delay of `perPxMs` x its distance (design px) from
   * (x, y), capped at `capMs` (s()-scaled). Additive: safe mid-land / mid-win. power 0..1.
   */
  'board:react': { x: number; y: number; perPxMs: number; capMs: number; power?: number };
  /**
   * Dim every visible symbol except `cells` toward `tint` (default 0xcccccc, 170 ms), or
   * restore all (cells null). A second dim channel: the darker of it and the win dim shows.
   * Also cleared by a fall-out and board:set.
   */
  'board:focus': { cells: Position[] | null; tint?: number };
  /**
   * Hold set for the NEXT fall-out (CR-10b): these padded cells stay in place (idle, drawn
   * above the falling symbols, decorations kept) while the rest falls out, if their view
   * still shows `id` when the fall-out starts; the next reveal skips their drop-in when its
   * id matches (a mismatch drops in normally). The request is consumed by that fall-out
   * (emit it again for every spin, before the reveal: e.g. on fs:update) and the held set
   * ends with that reveal; an empty list cancels a pending request. Tumbles never use it.
   */
  'board:hold': { cells: Array<Position & { id: string }> };
  /**
   * Emitted BY the Board (not the flow) during 'board:tumble', at the explode-burst frame
   * (explode start + TIMING.explode.anticipateDuration, s()-scaled, slam-safe), once per
   * tumble with every exploding position, just before the explode hit-stop starts. Never
   * for 'impact' crushes. Orbs, link snaps and count pops sync to it. Synchronous.
   */
  'board:burst': { positions: Position[] };

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
  /**
   * Multiplier-sum driver for a cluster label at `overlay` (games with FEATURES.wildMultSum
   * 'external'): shows / bumps the label's xN badge to `mult` with a punch; `final` then
   * counts the value from meta.winWithoutMult to win and slams. Synchronous.
   */
  'win:labelMult': { overlay: Position; mult: number; final?: boolean };
  /** Big-win celebration; resolves after dismiss / auto-close. */
  'bigwin:show': { amount: number; tier: WinTierKey };

  /** Free spins awarded (scatter celebration + intro). */
  'fs:trigger': { total: number; positions: Position[]; retrigger: boolean };
  'fs:update': { current: number; total: number };
  'fs:end': { amount: number; level: number };
  /** Base <-> free-game presentation switch (background, music, spot panel). */
  'mode:change': { gameType: GameType };

  /**
   * Mascot reaction. `intensity` scales it (cue-specific: meterThreshold = notch / 6,
   * featureLock 1 = 40 / 2 = 60, meterHeat 0 = heat off). `look` (design px, optional) turns
   * both heads toward a point for the cue (the meter on bassDropCharge / meter cues).
   */
  'mascot:cue': { cue: MascotCue; intensity?: number; look?: { x: number; y: number } };
  /**
   * Feature music variant on top of the gameType stem (Bass Drop's Mega Mix: 'megamix',
   * 112 BPM, switched on the next bar); null returns to the gameType stem. A switch back to
   * the base game (mode:change basegame) clears it. Games without variants never emit it.
   */
  'music:stem': { stem: 'megamix' | null };
  /**
   * Scene-level music duck (dB, held holdMs then released) for a game's own fanfare that has no
   * core event: Bass Drop's feature trigger (the engine ducks on fs:trigger itself).
   */
  'music:duck': { db: number; holdMs: number };
  'sfx': { id: SfxId; volume?: number; rate?: number; delayMs?: number };
  /** Add trauma (0..1) to the camera shake. */
  'fx:shake': { trauma: number };
  /** Particle burst at a design-space (root) position. */
  'fx:burst': {
    kind: 'explode' | 'dust' | 'sparkle' | 'coins' | 'confetti' | 'spotSpark' | 'scatter';
    x: number;
    y: number;
    color?: number;
    /** particle count (preset default when omitted; 'explode' with 0 = light + smoke, no debris) */
    count?: number;
    /** 0..1 energy scale */
    power?: number;
    /** 0..1 scale of the preset's additive light (explode: flash glow + ring); default 1 */
    light?: number;
  };
  /** Full-screen flash (additive white/colour). */
  'fx:flash': { color?: number; alpha?: number; durationMs?: number };

  'layout:change': { layout: LayoutSpec; scale: number };
};

export type GameEvents = CoreGameEvents & GameSceneEvents;

/** Awaitable scene broadcast (ctx.game.broadcastAsync, or a DEV player's logged emitter). */
export type SceneEmit = <K extends keyof GameEvents>(type: K, payload: GameEvents[K]) => Promise<void>;

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
  /** player-selectable speed profiles, in ui:turbo cycle order (disabledTurbo / disabledSuperTurbo) */
  turboProfiles?: SpeedProfile[];
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
