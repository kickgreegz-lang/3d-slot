import { EN } from './en';
import { EN_SOCIAL, findRestricted, socialize } from './social';

/**
 * i18n + Stake social-casino (stake.us) wording. Every user-visible string goes
 * through t(). Language tables fall back key by key to English; in social mode
 * the game is forced to English, hand-tuned EN_SOCIAL overrides apply first and
 * the official restricted-phrase table (./social.ts) rewrites everything else
 * (bet -> play, pay -> win, buy -> play, paytable -> win table, ...).
 *
 * Only English ships today. Add a language by registering its table here; the
 * lang param has already been normalised by env/url.ts ('br' -> 'pt', ...).
 */
const TABLES: Record<string, Record<string, string>> = {
  en: EN,
};

let social = false;
let lang = 'en';
let table: Record<string, string> = EN;

export const configureI18n = (opts: { lang: string; social: boolean }): void => {
  social = opts.social;
  // Social mode: "use English with the restricted phrase replacements, regardless of lang".
  lang = social ? 'en' : TABLES[opts.lang] ? opts.lang : 'en';
  table = TABLES[lang] ?? EN;
};

const fill = (s: string, vars?: Record<string, string | number>): string => {
  if (!vars) return s;
  let out = s;
  for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{${k}}`, String(v));
  return out;
};

/**
 * Translate `key` (falls back to English, then to the key itself) and fill {vars}.
 * In social mode the result — including the filled-in vars — is passed through the
 * restricted-phrase table, so callers can never leak a restricted word.
 */
export const t = (key: string, vars?: Record<string, string | number>): string => {
  if (social) return socialize(fill(EN_SOCIAL[key] ?? EN[key] ?? key, vars));
  return fill(table[key] ?? EN[key] ?? key, vars);
};

/** true if `key` has a translation (lets callers fall back to config labels). */
export const hasKey = (key: string): boolean => key in EN;

export const isSocial = (): boolean => social;
export const currentLang = (): string => lang;

/**
 * Social-safe version of text that did not come from t() (e.g. an RGS error message).
 * Identity outside social mode.
 */
export const safeText = (text: string): string => (social ? socialize(text) : text);

export { findRestricted, socialize };
