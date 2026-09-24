import type { Application } from 'pixi.js';
import type { ArtProvider } from '../assets/art';
import type { LayoutSpec } from '../config/layout';
import { Emitter } from '../core/emitter';
import type { QualityTier, TierBudget } from '../env/tier';
import type { UrlParams } from '../env/url';
import type { MoneyApi } from '../money/format';
import type { Layers } from '../render/layers';
import type { GameEvents, HudEvents, UiEvents } from './events';

/**
 * Everything a module needs, passed to constructors: `new Board(ctx)`.
 * Modules subscribe to `ctx.game` / `ctx.hud` / `layout:change` themselves and
 * attach display objects to their layer. No module imports another module's
 * internals — they communicate through these emitters only.
 */
export interface GameContext {
  app: Application;
  layers: Layers;
  game: Emitter<GameEvents>;
  ui: Emitter<UiEvents>;
  hud: Emitter<HudEvents>;
  art: ArtProvider;
  tier: QualityTier;
  budget: TierBudget;
  params: UrlParams;
  /** bet/currency/format — owned by the flow module, read by everyone */
  money: MoneyApi;
  /** current layout and root scale (kept up to date by render/layout.ts) */
  layout: LayoutSpec;
  scale: number;
}

export const createEmitters = () => ({
  game: new Emitter<GameEvents>(),
  ui: new Emitter<UiEvents>(),
  hud: new Emitter<HudEvents>(),
});

/** Interface every visual module implements. */
export interface GameModule {
  /** called once after construction, before the first layout */
  init?(): Promise<void> | void;
  /** re-position for a new layout (also subscribed via 'layout:change') */
  layout?(layout: LayoutSpec): void;
  destroy?(): void;
}
