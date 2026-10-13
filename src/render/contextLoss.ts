import type { Application } from 'pixi.js';
import { t } from '../i18n';

/**
 * WebGL context loss (a GPU reset, or a low-memory phone reclaiming a backgrounded tab's context).
 * Without this the game stays a black canvas, and Stake disables live games for "rendering
 * failures" (docs/new-slot/PERFORMANCE.md, engine delta E6). Baked textures (procedural art,
 * glyph pages, render targets, the three.js mascots) cannot be rebuilt in place, so:
 *   lost      -> stop the frame loop and report a FATAL error: main.ts connects the report to the
 *                flow (`ui:fatal`), which enters its terminal error state (spin / buy / autoplay off)
 *                and shows the blocking dialog with its RELOAD button;
 *   restored  -> reload the page: the RGS resumes any active round (flow resume), keeping the bet.
 * Watch it right after the Application exists: a loss during boot (the heaviest GPU-allocation
 * phase) is remembered and reported as soon as something connects.
 */
export interface ContextLossWatch {
  /** true once the context was lost (until the page reloads) */
  readonly lost: boolean;
  /** where the fatal message goes; called at once when the loss already happened */
  connect(report: (text: string) => void): void;
  dispose(): void;
}

export const watchContextLoss = (app: Application): ContextLossWatch => {
  const canvas = app.canvas;
  let lost = false;
  let report: ((text: string) => void) | null = null;
  const onLost = (e: Event): void => {
    e.preventDefault(); // allow the browser to restore the context
    if (lost) return;
    lost = true;
    app.ticker.stop();
    report?.(t('err.GRAPHICS'));
  };
  const onRestored = (): void => window.location.reload();
  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);
  return {
    get lost() {
      return lost;
    },
    connect(fn) {
      report = fn;
      if (lost) fn(t('err.GRAPHICS'));
    },
    dispose() {
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
    },
  };
};
