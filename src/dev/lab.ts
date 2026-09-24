import type { GameContext } from '../game/context';

/**
 * Animation lab entry (`?dev=lab` / `?dev=gallery`, called by main.ts).
 * Everything — Tweakpane included — sits behind this DEV branch and a dynamic
 * import, so production bundles contain only this empty shell.
 */
export const startLab = async (ctx: GameContext, mode: string): Promise<void> => {
  if (import.meta.env.DEV) {
    const { runLab } = await import('./labApp');
    await runLab(ctx, mode);
  }
};
