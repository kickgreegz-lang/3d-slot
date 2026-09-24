import type { HudState } from '../game/events';

/** Flow FSM states (critic.md): the controller only moves along TRANSITIONS. */
export type FlowState = 'rendering' | 'idle' | 'spinning' | 'presenting' | 'autoplay' | 'resume' | 'replay' | 'error';

export const TRANSITIONS: Record<FlowState, readonly FlowState[]> = {
  rendering: ['idle', 'resume', 'replay', 'error'],
  // idle -> presenting: dev playBook()
  idle: ['spinning', 'autoplay', 'presenting', 'resume', 'error'],
  autoplay: ['spinning', 'idle', 'error'],
  spinning: ['presenting', 'idle', 'autoplay', 'resume', 'error'],
  presenting: ['idle', 'autoplay', 'replay', 'error'],
  resume: ['presenting', 'idle', 'error'],
  replay: ['presenting', 'error'],
  error: ['idle', 'resume', 'error'],
};

export type ReplayPhase = 'loading' | 'ready' | 'playing' | 'done' | 'error';

/**
 * `hud:state` payload. It IS a HudState (the frozen contract); the extra fields are
 * optional reading for the HUD / DOM UI (see contractRequests in the flow report).
 */
export interface FlowHudState extends HudState {
  phase: FlowState;
  /** active bet mode key and its cost multiplier */
  mode: string;
  modeCost: number;
  /** bet as an index into ALL RGS bet levels (bet menu) */
  betIndex: number;
  betLevelCount: number;
  /** preformatted text of every bet level (bet menu) */
  betLevelTexts: string[];
  /** balance covers the next base spin */
  canAfford: boolean;
  slamStopAllowed: boolean;
  spacebarAllowed: boolean;
  fullscreenAllowed: boolean;
  soundEnabled: boolean;
  /** jurisdiction displays (null = hidden) */
  netPositionText: string | null;
  rtpText: string | null;
  sessionTimeText: string | null;
  /** replay mode: start/play-again button + bet info (null outside replay) */
  replayPhase: ReplayPhase | null;
  replayButtonText: string | null;
  replayInfoText: string | null;
  replayResultText: string | null;
}
