import { TIMING, type Timing } from '../core/timing';

/**
 * DEV-ONLY live editing of the TIMING bible: leaf enumeration with slider ranges,
 * path get/set (used by the lab pane and `__slot.setTiming`), per-browser
 * persistence of overrides, and export back to `src/core/timing.ts`.
 *
 * Export strategy: the real source file (Vite `?raw`) is patched value-by-value so
 * comments, casts and formatting survive; the patch is re-parsed and verified
 * against the live object, falling back to a generated object literal.
 */

export type TimingValue = number | string;
type Node = Record<string, unknown> | unknown[];

export interface TimingLeaf {
  /** dotted path, e.g. 'land.squashX' or 'counters.smallByLevel.2' */
  path: string;
  /** parent object/array and key, for Tweakpane bindings */
  parent: Node;
  key: string;
  value: TimingValue;
}

export interface SliderRange {
  min: number;
  max: number;
  step: number;
}

const STORAGE_KEY = 'slot.lab.timing.v1';

const isNode = (v: unknown): v is Node => typeof v === 'object' && v !== null;
const get = (node: Node, key: string): unknown => (node as Record<string, unknown>)[key];

/** Deep, JSON-safe copy of the current TIMING values. */
export const snapshotTiming = (): Timing => JSON.parse(JSON.stringify(TIMING)) as Timing;

/** Pristine values as compiled (taken before any override is applied). */
const DEFAULTS = /* @__PURE__ */ snapshotTiming();

export const timingLeaves = (root: Node = TIMING as unknown as Node, prefix = ''): TimingLeaf[] => {
  const out: TimingLeaf[] = [];
  for (const key of Object.keys(root)) {
    const v = get(root, key);
    const path = prefix ? `${prefix}.${key}` : key;
    if (isNode(v)) out.push(...timingLeaves(v, path));
    else if (typeof v === 'number' || typeof v === 'string') out.push({ path, parent: root, key, value: v });
  }
  return out;
};

const resolve = (path: string, root: unknown = TIMING): { parent: Node; key: string } => {
  const parts = path.split('.');
  let node: unknown = root;
  for (const p of parts.slice(0, -1)) {
    node = isNode(node) ? get(node, p) : undefined;
  }
  const key = parts[parts.length - 1];
  if (!isNode(node) || !(key in node)) throw new Error(`Unknown TIMING path "${path}"`);
  return { parent: node, key };
};

export const getTimingValue = (path: string, root: unknown = TIMING): TimingValue => {
  const { parent, key } = resolve(path, root);
  const v = get(parent, key);
  if (typeof v !== 'number' && typeof v !== 'string') throw new Error(`TIMING path "${path}" is not a leaf`);
  return v;
};

type Listener = (path: string, value: TimingValue) => void;
const listeners = new Set<Listener>();

/** Subscribe to programmatic edits (e.g. `__slot.setTiming`) so the pane can refresh. */
export const onTimingChange = (fn: Listener): (() => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

/** Sets one leaf (type-checked against the current value) and persists overrides. */
export const setTimingValue = (path: string, value: TimingValue, notify = true): void => {
  const current = getTimingValue(path);
  if (typeof value !== typeof current) {
    throw new Error(`TIMING "${path}" expects a ${typeof current}, got ${typeof value}`);
  }
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`TIMING "${path}": non-finite value`);
  const { parent, key } = resolve(path);
  (parent as Record<string, unknown>)[key] = value;
  saveOverrides();
  if (notify) for (const fn of listeners) fn(path, value);
};

/** Leaves whose value differs from the compiled defaults. */
export const changedLeaves = (): Array<{ path: string; from: TimingValue; to: TimingValue }> =>
  timingLeaves()
    .map((l) => ({ path: l.path, from: getTimingValue(l.path, DEFAULTS), to: l.value }))
    .filter((c) => c.from !== c.to);

export const resetTiming = (): void => {
  for (const l of timingLeaves()) {
    const d = getTimingValue(l.path, DEFAULTS);
    if (d !== l.value) (l.parent as Record<string, unknown>)[l.key] = d;
  }
  saveOverrides();
  for (const fn of listeners) fn('*', 0);
};

/** Persist after an external in-place edit (Tweakpane bindings write TIMING directly). */
export const saveTimingEdit = (): void => saveOverrides();

const saveOverrides = (): void => {
  try {
    const diff = Object.fromEntries(changedLeaves().map((c) => [c.path, c.to]));
    if (Object.keys(diff).length) localStorage.setItem(STORAGE_KEY, JSON.stringify(diff));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // storage unavailable (private mode / capture) — overrides just don't persist
  }
};

/** Re-applies overrides saved by a previous lab session. Returns how many were applied. */
export const loadOverrides = (): number => {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return 0;
  }
  if (!raw) return 0;
  let applied = 0;
  try {
    const diff = JSON.parse(raw) as Record<string, TimingValue>;
    for (const [path, value] of Object.entries(diff)) {
      try {
        setTimingValue(path, value, false);
        applied++;
      } catch {
        // stale key from an older TIMING shape — ignore
      }
    }
  } catch {
    return 0;
  }
  return applied;
};

// ---------------------------------------------------------------------------
// Slider ranges
// ---------------------------------------------------------------------------

const RANGE_RULES: Array<[RegExp, SliderRange]> = [
  [/^land\.weight\./, { min: 0, max: 3, step: 0.05 }],
  [/(Scale|squashX|squashY)$/, { min: 0.5, max: 2, step: 0.01 }],
  [/[gG]ravity$/, { min: 500, max: 40000, step: 100 }],
  [/Cells$/, { min: 0, max: 12, step: 0.1 }],
  [/springStiffness$/, { min: 10, max: 2000, step: 5 }],
  [/springDamping$/, { min: 0, max: 60, step: 0.5 }],
  [/([pP]articles|coinRate)$/, { min: 0, max: 200, step: 1 }],
  [/^shake\.maxOffset$/, { min: 0, max: 60, step: 0.5 }],
  [/^shake\.maxAngle$/, { min: 0, max: 10, step: 0.1 }],
  [/^shake\.decayPerSecond$/, { min: 0.1, max: 10, step: 0.05 }],
  [/^shake\.frequency$/, { min: 1, max: 60, step: 0.5 }],
  [/(hopHeight|Float)$/, { min: 0, max: 120, step: 1 }],
  [/finalPortion$/, { min: 0, max: 1, step: 0.01 }],
  [/^mascot\.crossFade/, { min: 0, max: 1.5, step: 0.01 }],
  [/^bigWin\.tierDurations\./, { min: 0, max: 30000, step: 100 }],
  [/^counters\.smallByLevel\./, { min: 0, max: 6000, step: 50 }],
];

const niceCeil = (v: number): number => {
  const p = 10 ** Math.floor(Math.log10(Math.max(1, v)));
  return Math.ceil(v / p) * p;
};

/** True for 0xRRGGBB colour leaves (tints) — bound with a colour picker instead of a slider. */
export const isColorLeaf = (path: string): boolean => /Tint$|Color$/.test(path);

/** Sensible slider range for a numeric leaf; unknown keys are treated as ms durations. */
export const rangeFor = (path: string, value: number): SliderRange => {
  for (const [re, r] of RANGE_RULES) if (re.test(path)) return r;
  const max = niceCeil(Math.max(value * 4, 100));
  return { min: 0, max, step: max > 4000 ? 50 : max > 400 ? 5 : 1 };
};

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

const fmtNumber = (path: string, v: number): string => {
  if (isColorLeaf(path)) return `0x${Math.round(v).toString(16).padStart(6, '0')}`;
  const r = Math.round(v * 10000) / 10000;
  return String(r);
};
const fmtValue = (path: string, v: TimingValue): string =>
  typeof v === 'number' ? fmtNumber(path, v) : `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

const parseLiteral = (src: string): TimingValue | TimingValue[] | null => {
  const t = src.trim();
  if (/^'.*'$|^".*"$/.test(t)) return t.slice(1, -1).replace(/\\(['"\\])/g, '$1');
  if (/^\[.*\]$/.test(t)) {
    const inner = t.slice(1, -1).trim();
    return inner ? inner.split(',').map((x) => Number(x.trim())) : [];
  }
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

const LEAF_RE = /^(\s*)([A-Za-z_$][\w$]*)(\s*:\s*)(.+?)(,?)(\s*(?:\/\/.*)?)$/;
const OPEN_RE = /^\s*([A-Za-z_$][\w$]*)\s*:\s*\{\s*$/;
const CLOSE_RE = /^\s*\}[^{]*$/;
const INLINE_PAIR_RE = /([A-Za-z_$][\w$]*)(\s*:\s*)([^,}]+?)(\s*[,}])/g;

interface ScanHit {
  path: string;
  value: TimingValue | TimingValue[];
}

/**
 * Walks the `export const TIMING = { ... }` block line by line. With `patch`, leaf
 * values are rewritten from the live TIMING; returns the (patched) source + the
 * leaves it saw (for verification).
 */
const scanTimingSource = (source: string, patch: boolean): { text: string; hits: ScanHit[] } | null => {
  const lines = source.split('\n');
  const start = lines.findIndex((l) => /^export const TIMING\s*=\s*\{\s*$/.test(l));
  if (start < 0) return null;
  const stack: string[] = [];
  const hits: ScanHit[] = [];
  let inComment = false;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (inComment) {
      if (trimmed.includes('*/')) inComment = false;
      continue;
    }
    if (trimmed.startsWith('/*')) {
      if (!trimmed.includes('*/')) inComment = true;
      continue;
    }
    if (!trimmed || trimmed.startsWith('//')) continue;
    if (stack.length === 0 && /^\};?\s*$/.test(trimmed)) return { text: lines.join('\n'), hits };
    const open = OPEN_RE.exec(line);
    if (open) {
      stack.push(open[1]);
      continue;
    }
    if (CLOSE_RE.test(line) && !LEAF_RE.test(line)) {
      stack.pop();
      continue;
    }
    const m = LEAF_RE.exec(line);
    if (!m) return null;
    const [, indent, key, colon, rawValue, comma, tail] = m;
    const path = [...stack, key].join('.');
    const inline = /^(\{.*\})(.*)$/.exec(rawValue);
    if (inline) {
      // inline record: `weight: { light: 0.7, ... } as Record<string, number>,`
      const body = inline[1].replace(INLINE_PAIR_RE, (all, k: string, c: string, v: string, end: string) => {
        const leafPath = `${path}.${k}`;
        const lit = parseLiteral(v);
        if (lit !== null) hits.push({ path: leafPath, value: lit as TimingValue });
        if (!patch) return all;
        return `${k}${c}${fmtValue(leafPath, getTimingValue(leafPath))}${end}`;
      });
      lines[i] = `${indent}${key}${colon}${body}${inline[2]}${comma}${tail}`;
      continue;
    }
    const lit = parseLiteral(rawValue.replace(/\s+as\s+.+$/, ''));
    if (lit === null) return null;
    hits.push({ path, value: lit });
    if (!patch) continue;
    let next: string;
    if (Array.isArray(lit)) {
      const { parent, key: arrKey } = resolve(path);
      const arr = get(parent, arrKey) as number[];
      next = `[${arr.map((v, j) => fmtValue(`${path}.${j}`, v)).join(', ')}]`;
    } else {
      next = fmtValue(path, getTimingValue(path));
    }
    const cast = /\s+as\s+.+$/.exec(rawValue)?.[0] ?? '';
    lines[i] = `${indent}${key}${colon}${next}${cast}${comma}${tail}`;
  }
  return null;
};

const verify = (hits: ScanHit[]): boolean => {
  const live = new Map(timingLeaves().map((l) => [l.path, l.value]));
  let count = 0;
  for (const h of hits) {
    if (Array.isArray(h.value)) {
      for (const [j, v] of h.value.entries()) {
        count++;
        if (live.get(`${h.path}.${j}`) !== v) return false;
      }
    } else {
      count++;
      if (live.get(h.path) !== h.value) return false;
    }
  }
  return count === live.size;
};

const literal = (node: unknown, path: string, depth: number): string => {
  const pad = '  '.repeat(depth);
  if (Array.isArray(node)) return `[${node.map((v, j) => fmtValue(`${path}.${j}`, v as TimingValue)).join(', ')}]`;
  if (isNode(node)) {
    const body = Object.keys(node)
      .map((k) => `${pad}  ${k}: ${literal(get(node, k), path ? `${path}.${k}` : k, depth + 1)},`)
      .join('\n');
    return `{\n${body}\n${pad}}`;
  }
  return fmtValue(path, node as TimingValue);
};

/** Plain `export const TIMING = {...};` literal of the live values. */
export const timingLiteral = (): string => `export const TIMING = ${literal(TIMING, '', 0)};\n`;

/**
 * Full `src/core/timing.ts` with every TIMING value replaced by the live one
 * (comments/casts preserved). Falls back to the plain literal if the source
 * can't be patched faithfully.
 */
export const exportTimingSource = (source: string): { text: string; patched: boolean } => {
  const out = scanTimingSource(source, true);
  if (out) {
    const check = scanTimingSource(out.text, false);
    if (check && verify(check.hits)) return { text: out.text, patched: true };
  }
  return { text: timingLiteral(), patched: false };
};
