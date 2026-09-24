import { t } from '../../i18n';

/**
 * i18n lookup with an English fallback for keys the string table does not have yet
 * (t() echoes unknown keys). Every presentation string goes through here so the
 * UI/i18n owners can localise / social-rewrite them by adding keys.
 */
export const label = (key: string, fallback: string, vars?: Record<string, string | number>): string => {
  const v = t(key, vars);
  if (v !== key) return v;
  let s = fallback;
  if (vars) for (const [k, val] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(val));
  return s;
};

/** Split a title into display lines: "MEGA WIN" -> ["MEGA", "WIN"]; single words stay one line. */
export const titleLines = (text: string): string[] => {
  const words = text.trim().split(/\s+/);
  if (words.length < 2) return words;
  const last = words.pop() as string;
  return [words.join(' '), last];
};
