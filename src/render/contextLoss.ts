import type { Application } from 'pixi.js';
import type { Emitter } from '../core/emitter';
import type { HudEvents } from '../game/events';
import { t } from '../i18n';

/**
 * WebGL context loss (a GPU reset, or a low-memory phone reclaiming a backgrounded tab's context).
 * Without this the game stays a black canvas, and Stake disables live games for "rendering
 * failures" (docs/new-slot/PERFORMANCE.md, engine delta E6). Baked textures (procedural art,
 * glyph pages, render targets, the three.js mascots) cannot be rebuilt in place, so:
 *   lost      -> stop the frame loop and show the blocking error (its RELOAD button works at once);
 *   restored  -> reload the page: the RGS resumes any active round (flow resume), keeping the bet.
 * Returns an unsubscribe for tests.
 */
export const watchContextLoss = (app: Application, hud: Emitter<HudEvents>): (() => void) => {
  const canvas = app.canvas;
  const onLost = (e: Event): void => {
    e.preventDefault(); // allow the browser to restore the context
    app.ticker.stop();
    hud.broadcast('hud:message', { text: t('err.GRAPHICS'), kind: 'error' });
  };
  const onRestored = (): void => window.location.reload();
  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);
  return () => {
    canvas.removeEventListener('webglcontextlost', onLost);
    canvas.removeEventListener('webglcontextrestored', onRestored);
  };
};
