import type { GameContext } from '../game/context';
import { SymbolRig } from './SymbolRig';
import type { SymbolView } from './types';

/**
 * Factory used by the Board: one procedural/Spine symbol rig per slot.
 * See SymbolRig.ts for the display structure and state machine.
 */
export const createSymbolView = (ctx: GameContext, id: string): SymbolView => new SymbolRig(ctx, id);

// Dev-only visual-QA harness: window.__symbolsDemo(ctx) (stripped from production builds).
if (import.meta.env.DEV) {
  void import('./demo').then((m) => m.installSymbolsDemo());
}
