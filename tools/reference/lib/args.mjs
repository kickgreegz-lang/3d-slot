/** Tiny argv parser: --key value, --key=value, boolean --flags, repeatable keys, positionals in `_`. */
export function parseArgs(argv, { booleans = [], multi = [] } = {}) {
  const out = { _: [] };
  const bool = new Set(booleans), rep = new Set(multi);
  const put = (k, v) => {
    if (rep.has(k)) (out[k] ??= []).push(v);
    else out[k] = v;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      out._.push(a);
      continue;
    }
    const eq = a.indexOf('=');
    if (eq > 0) {
      put(a.slice(2, eq), a.slice(eq + 1));
      continue;
    }
    const k = a.slice(2);
    const next = argv[i + 1];
    if (bool.has(k) || next === undefined || next.startsWith('--')) put(k, true);
    else {
      put(k, next);
      i++;
    }
  }
  return out;
}

export function parseViewport(s) {
  const m = /^(\d+)x(\d+)$/.exec(String(s));
  if (!m) throw new Error(`bad viewport "${s}" (expected WIDTHxHEIGHT)`);
  return { width: Number(m[1]), height: Number(m[2]) };
}

export const stamp = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};
