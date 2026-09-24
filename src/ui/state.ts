import type { HudState } from '../game/events';

/**
 * HudState plus OPTIONAL fields the flow module already sends on 'hud:state'
 * (duck-typed — the UI never imports flow internals). Everything here degrades
 * gracefully when absent. Proposed for the frozen contract in contractRequests.
 */
export type HudStateExt = HudState &
  Partial<{
    /** active bet mode key and its cost multiplier */
    mode: string;
    modeCost: number;
    betIndex: number;
    betLevelCount: number;
    betLevelTexts: string[];
    canAfford: boolean;
    slamStopAllowed: boolean;
    spacebarAllowed: boolean;
    fullscreenAllowed: boolean;
    soundEnabled: boolean;
    netPositionText: string | null;
    rtpText: string | null;
    sessionTimeText: string | null;
    replayPhase: 'loading' | 'ready' | 'playing' | 'done' | 'error' | null;
    replayButtonText: string | null;
    replayInfoText: string | null;
    replayResultText: string | null;
  }>;
