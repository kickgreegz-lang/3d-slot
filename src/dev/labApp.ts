import type { GameContext } from '../game/context';
import { boardNames, findEvent } from './fixtures';
import { SymbolGallery } from './gallery';
import { devHooks } from './hooks';
import { LabPane } from './labPane';
import { loadOverrides } from './timingEdit';

/**
 * DEV-ONLY lab boot (loaded lazily by lab.ts). The game modules are already
 * built; the lab only adds tooling on top:
 *   ?dev=lab      idle fixture board + Tweakpane (scenarios, TIMING, inspector)
 *   ?dev=gallery  every symbol x every state, cycling (contact sheets)
 *   &capture=1    no pane / no docking (Playwright QA captures)
 */

/** Neutral no-win fixture used as the lab's resting board. */
const IDLE_BOOK = 'loss';

export const runLab = async (ctx: GameContext, mode: string): Promise<void> => {
  const hooks = devHooks();
  if (!hooks) return;
  const labMode = mode === 'gallery' ? 'gallery' : 'lab';
  if (!ctx.params.capture) loadOverrides();

  const resetScene = async (): Promise<void> => {
    const books = await hooks.fixtures();
    const book = books.base[IDLE_BOOK] ?? Object.values(books.base)[0];
    if (book) {
      await hooks.emitLogged('mode:change', { gameType: 'basegame' });
      await hooks.emitLogged('spots:reset', { grid: null });
      await hooks.emitLogged('board:set', { board: boardNames(findEvent(book, 'reveal').board) });
    }
  };

  let gallery: SymbolGallery | null = null;
  let bootError = '';
  if (labMode === 'gallery') {
    gallery = new SymbolGallery(ctx);
    gallery.start();
  } else {
    try {
      await resetScene();
    } catch (err) {
      bootError = err instanceof Error ? err.message : String(err);
    }
  }

  if (!ctx.params.capture) {
    const pane = new LabPane({ ctx, hooks, mode: labMode, gallery, resetScene });
    if (bootError) pane.notify(`boot: ${bootError}`);
  }
  hooks.labReady = true;
  hooks.ready = true;
};
