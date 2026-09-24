import { TIMING, TIMING_SECTIONS, type Timing } from '../core/timing';

/**
 * DEV-ONLY live editing of every registered timing table: the core TIMING bible
 * plus module-local sections registered with `registerTiming(name, table)`
 * (board, symbol, hud, winPresent, ...). Leaf enumeration with slider ranges,
 * path get/set (lab pane + `__slot.setTiming`), per-browser persistence of
 * overrides, and export.
 *
 * Paths: bare paths address core TIMING ('land.squashX'); section paths are
 * prefixed with the section name ('board.blurSpeed'). Core keys and section
 * names never collide.
 *
 * Export strategy (core): the real source file (Vite `?raw`) is patched
 * value-by-value so comments, casts and formatting survive; the patch is
 * re-parsed and verified against the live object, falling back to a generated
 * object literal. Other sections export as JSON (`{section: {...}}`).
 */

export type TimingValue = number | string;
type Node = Record<string, unknown> | unknown[];

export interface TimingLeaf {
  /** dotted path inside its table, e.g. 'land.squashX' or 'counters.smallByLevel.2' */
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

const STORAGE_KEY = 'slot.lab.timing.v2';
export const CORE_SECTION = 'core';

const isNode = (v: unknown): v is Node => typeof v === 'object' && v !== null;
const get = (node: Node, key: string): unknown => (node as Record<string, unknown>)[key];
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Deep, JSON-safe copy of the current core TIMING values. */
export const snapshotTiming = (): Timing => clone(TIMING);

/** Deep, JSON-safe copy of every registered section: `{core: {...}, board: {...}, ...}`. */
export const snapshotSections = (): Record<string, unknown> =>
  Object.fromEntries(Object.entries(TIMING_SECTIONS).map(([name, table]) => [name, clone(table)]));

export const sectionNames = (): string[] => Object.keys(TIMING_SECTIONS);

/**
 * Pristine values per section, taken the first time a section is seen and
 * before any lab edit (sections register as their modules load, so this is lazy).
 */
const defaults = new Map<string, Node>();
export const captureTimingDefaults = (): void => {
  for (const [name, table] of Object.entries(TIMING_SECTIONS)) {
    if (!defaults.has(name)) defaults.set(name, clone(table));
  }
};

/** Qualified path -> section + path inside the section table. */
const split = (qualified: string): { section: string; path: string } => {
  const dot = qualified.indexOf('.');
  const head = dot < 0 ? qualified : qualified.slice(0, dot);
  if (dot > 0 && head in TIMING_SECTIONS) return { section: head, path: qualified.slice(dot + 1) };
  return { section: CORE_SECTION, path: qualified };
};
const qualify = (section: string, path: string): string => (section === CORE_SECTION ? path : `${section}.${path}`);

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

/** Every leaf of every section, with qualified paths. */
export const allTimingLeaves = (): Array<TimingLeaf & { section: string; qualified: string }> =>
  Object.entries(TIMING_SECTIONS).flatMap(([section, table]) =>
    timingLeaves(table as Node).map((l) => ({ ...l, section, qualified: qualify(section, l.path) })),
  );

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

/** Leaf value by (qualified) path; `root` overrides the table (core export verification). */
export const getTimingValue = (qualified: string, root?: unknown): TimingValue => {
  const { section, path } = root ? { section: CORE_SECTION, path: qualified } : split(qualified);
  let hit: { parent: Node; key: string };
  try {
    hit = resolve(path, root ?? TIMING_SECTIONS[section]);
  } catch {
    throw new Error(`Unknown TIMING path "${qualified}" (sections: ${sectionNames().join(', ')})`);
  }
  const v = get(hit.parent, hit.key);
  if (typeof v !== 'number' && typeof v !== 'string') throw new Error(`TIMING path "${qualified}" is not a leaf`);
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
export const setTimingValue = (qualified: string, value: TimingValue, notify = true): void => {
  captureTimingDefaults();
  const current = getTimingValue(qualified);
  if (typeof value !== typeof current) {
    throw new Error(`TIMING "${qualified}" expects a ${typeof current}, got ${typeof value}`);
  }
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`TIMING "${qualified}": non-finite value`);
  const { section, path } = split(qualified);
  const { parent, key } = resolve(path, TIMING_SECTIONS[section]);
  (parent as Record<string, unknown>)[key] = value;
  saveOverrides();
  if (notify) for (const fn of listeners) fn(qualified, value);
};

/** Leaves (all sections, qualified paths) whose value differs from the defaults. */
export const changedLeaves = (): Array<{ path: string; from: TimingValue; to: TimingValue }> => {
  captureTimingDefaults();
  return allTimingLeaves()
    .map((l) => ({ path: l.qualified, from: getTimingValue(l.path, defaults.get(l.section)), to: l.value }))
    .filter((c) => c.from !== c.to);
};

export const resetTiming = (): void => {
  captureTimingDefaults();
  for (const l of allTimingLeaves()) {
    const d = getTimingValue(l.path, defaults.get(l.section));
    if (d !== l.value) (l.parent as Record<string, unknown>)[l.key] = d;
  }
  saveOverrides();
  for (const fn of listeners) fn('*', 0);
};

/** Persist after an external in-place edit (Tweakpane bindings write tables directly). */
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
  captureTimingDefaults();
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
        // stale key from an older table shape — ignore
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
  // generic key patterns (module sections)
  [/([aA]lpha|[oO]pacity|[tT]rauma\w*)$/, { min: 0, max: 1, step: 0.005 }],
];

const niceCeil = (v: number): number => {
  const p = 10 ** Math.floor(Math.log10(Math.max(1, v)));
  return Math.ceil(v / p) * p;
};

/** True for 0xRRGGBB colour leaves (tints) — bound with a colour picker instead of a slider. */
export const isColorLeaf = (path: string): boolean => /([tT]int|[cC]olou?r)$/.test(path);

/**
 * Sensible slider range for a numeric leaf (qualified path). Integers >= 10 are
 * treated as ms durations; small/fractional values (factors, px/ms speeds, 0..1
 * amounts) get a fine-grained range around them.
 */
export const rangeFor = (path: string, value: number): SliderRange => {
  const rule = RANGE_RULES.find(([re]) => re.test(path))?.[1];
  if (rule) {
    // never clamp: Tweakpane writes a clamped value straight back into the table
    return {
      min: value < rule.min ? (value < 0 ? value * 2 : 0) : rule.min,
      max: value > rule.max ? value * 2 : rule.max,
      step: rule.step,
    };
  }
  if (Number.isInteger(value) && Math.abs(value) >= 10) {
    const max = niceCeil(Math.max(Math.abs(value) * 4, 100));
    return { min: value < 0 ? -max : 0, max, step: max > 4000 ? 50 : max > 400 ? 5 : 1 };
  }
  const max = niceCeil(Math.max(Math.abs(value) * 4, 1));
  return { min: value < 0 ? -max : 0, max, step: max <= 1 ? 0.005 : max <= 10 ? 0.01 : 0.1 };
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

/** JSON of every registered section (`{core: {...}, board: {...}, ...}`) for pasting back. */
export const sectionsJson = (): string => JSON.stringify(snapshotSections(), null, 2);
