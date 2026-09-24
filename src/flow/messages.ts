import { t } from '../i18n';
import type { RgsError } from '../rgs/types';

/**
 * Player-facing flow messages (errors, resume, replay). Each key is looked up
 * through i18n `t('flow.<key>')` first so the UI/i18n module can localise or
 * override it; otherwise these English defaults apply. The SOCIAL table is the
 * stake.us wording (no bet/buy/pay/cash/gamble/loss... — see stake-engine.md).
 */
const EN = {
  insufficientFunds: 'Insufficient balance for this bet.',
  sessionExpired: 'Your session has expired. Please reload the game.',
  missingSession: 'Missing game session. Please relaunch the game from the lobby.',
  connection: 'Connection problem. Please check your internet connection and try again.',
  generic: 'Something went wrong. Please try again.',
  maintenance: 'The game is under maintenance. Please try again later.',
  gamblingLimits: 'Gambling limits reached.',
  location: 'This game is not available in your location.',
  invalidBet: 'This bet is not available. Please choose another bet.',
  resuming: 'Resuming your unfinished round…',
  autoplayLossLimit: 'Loss limit reached. Autoplay stopped.',
  autoplayWinLimit: 'Single win limit reached. Autoplay stopped.',
  autoplayFunds: 'Insufficient balance. Autoplay stopped.',
  replayLoading: 'Loading replay…',
  replayNotFound: 'Replay not found.',
  replayMissing: 'Replay link is incomplete.',
  replayInfo: '{mode} {bet}, {cost} REAL COST',
  replayResult: 'PAYOUT {mult}x · WIN {win}',
  replayStart: 'START REPLAY',
  replayAgain: 'PLAY AGAIN',
} as const;

export type FlowMessageKey = keyof typeof EN;

const SOCIAL: Partial<Record<FlowMessageKey, string>> = {
  insufficientFunds: 'Insufficient balance for this play.',
  gamblingLimits: 'Play limits reached.',
  invalidBet: 'This play amount is not available. Please choose another amount.',
  autoplayLossLimit: 'Stop limit reached. Autoplay stopped.',
  replayInfo: '{mode} {bet}, {cost} TOTAL PLAY',
  replayResult: 'MULTIPLIER {mult}x · WIN {win}',
};

export const flowText = (key: FlowMessageKey, social: boolean, vars?: Record<string, string | number>): string => {
  const i18nKey = `flow.${key}`;
  const localized = t(i18nKey, vars);
  if (localized !== i18nKey) return localized;
  let s: string = (social ? SOCIAL[key] : undefined) ?? EN[key];
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
};

/** RGS error -> message key (social-safe wording chosen by flowText). */
export const errorMessageKey = (e: RgsError): FlowMessageKey => {
  switch (e.code) {
    case 'ERR_IPB':
      return 'insufficientFunds';
    case 'ERR_IS':
    case 'ERR_ATE':
      return 'sessionExpired';
    case 'ERR_GLE':
      return 'gamblingLimits';
    case 'ERR_LOC':
      return 'location';
    case 'ERR_MAINTENANCE':
      return 'maintenance';
    case 'ERR_NETWORK':
      return 'connection';
    case 'ERR_VAL':
      return 'invalidBet';
    case 'NOT_FOUND':
      return 'replayNotFound';
    case 'ERR_CONFIG':
      return 'missingSession';
    default:
      return 'generic';
  }
};
