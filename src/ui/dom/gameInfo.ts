/**
 * ENGINE VIEW of the active game's facts for the rules / paytable / buy confirm.
 * The data is per game (`src/games/<GAME>/gameInfo.ts`, `@game/gameInfo`); the page
 * builders (ui/dom/pages.ts) render it generically. Nothing here is used for gameplay:
 * outcomes always come from the RGS.
 */
import { GAME_INFO } from '@game/gameInfo';

export * from '@game/gameInfo';

export interface BetModeInfo {
  /** RGS mode key as sent to /wallet/play (matches the game's config BET_MODES) */
  mode: string;
  /** i18n key for the mode's display name */
  nameKey: string;
  /** cost as a multiple of the bet (1 = base) */
  cost: number;
  rtp: string;
  maxWinX: number;
  /** free spins awarded when bought (null for base) */
  spins: number | null;
  /** i18n key of this mode's RULES "buy" paragraph (default 'rules.buy.body'; vars cost, spins) */
  buyBodyKey?: string;
  /** i18n key of this mode's buy-confirm description (default 'buy.desc') */
  buyDescKey?: string;
}

/** An i18n reference: t(key, vars), where keyVars values are i18n keys translated first. */
export interface TextRef {
  key: string;
  vars?: Record<string, string | number>;
  keyVars?: Record<string, string>;
}

export type RuleBlock = { text: TextRef } | { table: Array<{ label: TextRef; value: TextRef }> };

/** A RULES section: title = t(`rules.<key>.title`), then its blocks in order. */
export interface RuleSection {
  key: string;
  blocks: RuleBlock[];
}

export interface SpecialSymbolInfo {
  id: string;
  title: TextRef;
  desc: TextRef;
}

export interface GameInfo {
  title: string;
  copyrightHolder: string;
  year: number;
  version: string;
  modes: BetModeInfo[];
  /** cluster sizes shown in the paytable (last = "n+") */
  clusterSizes: number[];
  /** symbol pays as bet multiples per cluster size (null = not supplied yet, rendered "—") */
  pays: Record<string, number[] | null>;
  /** paytable order (highest first) */
  paySymbols: string[];
  /** SPECIAL SYMBOLS cards on the paytable */
  specials: SpecialSymbolInfo[];
  /** game feature sections of the RULES page, between TUMBLE and BUY */
  featureRules: RuleSection[];
}

export const buyMode = (mode: string): BetModeInfo | undefined =>
  GAME_INFO.modes.find((m) => m.mode.toUpperCase() === mode.toUpperCase());

/** Every bought feature (cost > 1), cheapest first. */
export const buyModes = (): BetModeInfo[] => GAME_INFO.modes.filter((m) => m.cost > 1).sort((a, b) => a.cost - b.cost);
