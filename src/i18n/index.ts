/**
 * i18n + Stake social-casino (stake.us) wording. Every user-visible string goes
 * through t(). In social mode the restricted-phrase table rewrites gambling terms
 * (bet -> play, win -> won/prize, etc.). The UI module owns and extends the tables.
 */
const EN: Record<string, string> = {
  balance: 'BALANCE',
  bet: 'BET',
  win: 'WIN',
  totalWin: 'TOTAL WIN',
  freeSpins: 'FREE SPINS',
  bonusBuy: 'BONUS BUY',
  spin: 'SPIN',
};

/** Social-mode overrides (subset; the UI module completes the official table). */
const EN_SOCIAL: Record<string, string> = {
  bet: 'PLAY',
  bonusBuy: 'BONUS PLAY',
};

let social = false;
let lang = 'en';

export const configureI18n = (opts: { lang: string; social: boolean }): void => {
  lang = opts.lang;
  social = opts.social;
};

export const t = (key: string, vars?: Record<string, string | number>): string => {
  void lang;
  let s = (social ? (EN_SOCIAL[key] ?? EN[key]) : EN[key]) ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
};

export const isSocial = (): boolean => social;
