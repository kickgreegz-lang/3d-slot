// Shared generation library for the Node wrappers (JS twin of tools/gen/genlib.py).
// tools/gen/test_gen.py asserts both render byte-identical prompts / hashes and agree on the
// licence gate, so read genlib.py's docstrings for the rules; this file mirrors them 1:1.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPO, rel, sha256Text } from './provenance.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const GEN_DIR = path.resolve(HERE, '..');
export const BIBLE_PATH = path.join(REPO, 'art', 'bible', 'artbible.json');
export const PROMPTS_DIR = path.join(REPO, 'art', 'bible', 'prompts');
export const ALLOWLIST_PATH = path.join(REPO, 'licenses', 'allowlist.json');
export const DENYLIST_PATH = path.join(REPO, 'licenses', 'denylist.json');
export const TOS_DIR = path.join(REPO, 'licenses', 'tos');
export const RAW_ROOT = path.join(REPO, 'art', '_raw');
const TEMPLATE_VARS = path.join(GEN_DIR, 'template-vars.json');
const FORBIDDEN = path.join(GEN_DIR, 'forbidden-words.json');

const PLACEHOLDER = /\{([A-Z0-9_]+)\}/g;
const SECTION = /^## SECTION ([A-Z0-9]+)\b/;

export class GenError extends Error {
  constructor(msg, code = 2) { super(msg); this.code = code; }
}

export const loadJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
export const bible = () => loadJson(BIBLE_PATH);

// ------------------------------------------------------------------ templates

export function splitTemplateRef(ref) {
  const i = ref.indexOf('#');
  let name = i < 0 ? ref : ref.slice(0, i);
  const section = i < 0 ? null : ref.slice(i + 1) || null;
  if (!name.endsWith('.txt')) name += '.txt';
  return [name, section];
}

/** Row 'template' value: repo path of the template file, plus '#X' for a section. */
export function templatePath(ref) {
  const [name, section] = splitTemplateRef(ref);
  return `art/bible/prompts/${name}${section ? `#${section}` : ''}`;
}

export function templateSections(name) {
  const text = fs.readFileSync(path.join(PROMPTS_DIR, name), 'utf8');
  return text.split(/\r?\n/).map((l) => SECTION.exec(l)?.[1]).filter(Boolean);
}

export function templateBody(name, section) {
  const p = path.join(PROMPTS_DIR, name);
  if (!fs.existsSync(p)) throw new GenError(`unknown template ${name} (see ${rel(PROMPTS_DIR)})`);
  const sections = templateSections(name);
  if (sections.length && section == null) throw new GenError(`${name} has sections ${JSON.stringify(sections)}: pick one as ${name}#<X>`);
  if (section != null && !sections.includes(section)) throw new GenError(`${name} has no SECTION ${section}`);
  let keep = section == null;
  const out = [];
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = SECTION.exec(line);
    if (m) { keep = m[1] === section; continue; }
    if (line.startsWith('#') || !keep) continue;
    out.push(line);
  }
  return out.join('\n');
}

export const placeholders = (name, section) =>
  [...new Set([...templateBody(name, section).matchAll(PLACEHOLDER)].map((m) => m[1]))].sort();

export function normalize(text) {
  return text.normalize('NFC').split('\n')
    .map((l) => l.replace(/[ \t]{2,}/g, ' ').trim())
    .filter((l) => l.length > 0)
    .join('\n');
}

const reEscape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function forbiddenTerms(b) {
  const child = b?.mascots?.rules?.forbiddenPromptWords ?? [];
  const brands = loadJson(FORBIDDEN).brands ?? [];
  return [...child, ...brands].map((w) => w.toLowerCase());
}

export function checkForbidden(text, terms) {
  const low = text.toLowerCase();
  return terms.filter((t) => new RegExp(`(?<![a-z0-9])${reEscape(t)}(?![a-z0-9])`).test(low));
}

/** Render template `ref` with `values`. Returns {text, hash}. */
export function render(ref, values) {
  const [name, section] = splitTemplateRef(ref);
  const body = templateBody(name, section);
  let out = body.replace(PLACEHOLDER, (m, k) => (k in values ? String(values[k]) : m));
  out = normalize(out);
  const left = [...new Set([...out.matchAll(PLACEHOLDER)].map((m) => m[1]))].sort();
  if (left.length) throw new GenError(`${ref}: unfilled placeholder(s) ${JSON.stringify(left)}; pass --var NAME=value`);
  if (!out) throw new GenError(`${ref}: rendered prompt is empty`);
  const hits = checkForbidden(out, forbiddenTerms(bible()));
  if (hits.length) throw new GenError(`${ref}: forbidden word(s) in prompt: ${JSON.stringify(hits)}`);
  return { text: out, hash: sha256Text(out) };
}

// ------------------------------------------------------------------ bible context

const isUpper = (c) => c === c.toUpperCase() && c !== c.toLowerCase();
const isLower = (c) => c === c.toLowerCase() && c !== c.toUpperCase();

const CHILD_WORDS = ['kid', 'child', 'cute', 'chibi', 'baby'];

export function subjectFromBrief(brief) {
  let s = brief.trim().replace(/^\s*PROPOSAL\s*(\([^)]*\))?\s*:\s*/, '');
  s = s.replace(new RegExp(`[,;]?\\s*\\bnot\\s+(?:${CHILD_WORDS.join('|')})\\b`, 'gi'), '');
  const keep = s.split(/(?<=\.)\s+/).filter((x) => !/live text|in code|never painted/i.test(x));
  s = keep.join(' ').trim();
  if (s.length > 1 && isUpper(s[0]) && isLower(s[1])) s = s[0].toLowerCase() + s.slice(1);
  if (s && !s.endsWith('.')) s += '.';
  return s;
}

function rgbToHls(r, g, b) {
  const maxc = Math.max(r, g, b);
  const minc = Math.min(r, g, b);
  const sumc = maxc + minc;
  const rangec = maxc - minc;
  const l = sumc / 2;
  if (minc === maxc) return [0, l, 0];
  const s = l <= 0.5 ? rangec / sumc : rangec / (2 - maxc - minc);
  const rc = (maxc - r) / rangec;
  const gc = (maxc - g) / rangec;
  const bc = (maxc - b) / rangec;
  let h;
  if (r === maxc) h = bc - gc;
  else if (g === maxc) h = 2 + rc - bc;
  else h = 4 + gc - rc;
  h = (((h / 6) % 1) + 1) % 1;
  return [h, l, s];
}

export function hueName(hex) {
  const v = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255);
  const [h, l, s] = rgbToHls(r, g, b);
  const deg = h * 360;
  if (s < 0.15) return l > 0.2 && l < 0.8 ? 'grey' : l <= 0.2 ? 'black' : 'white';
  let name;
  if (deg < 15 || deg >= 345) name = 'red';
  else if (deg < 40) name = l < 0.55 || s > 0.75 ? 'orange' : 'peach';
  else if (deg < 70) name = 'yellow';
  else if (deg < 160) name = 'green';
  else if (deg < 200) name = 'teal';
  else if (deg < 260) name = 'blue';
  else if (deg < 300) name = 'purple';
  else name = 'pink';
  if (name === 'orange' && l < 0.42) name = 'amber brown';
  return name;
}

const FILL_KIND = { royal: 'royal', high: 'high', wild: 'special', scatter: 'special' };

export function symbolContext(b, sid, rigReady, tv) {
  const sym = b.symbols[sid];
  if (!sym || typeof sym !== 'object' || !('kind' in sym)) throw new GenError(`unknown symbol ${JSON.stringify(sid)} (artbible.symbols)`);
  const kind = sym.kind;
  const ctx = { SYMBOL_NAME: sym.label.toLowerCase(), KEY_HEX: sym.keyHex ?? b.keyColors.default };
  ctx.FILL_PCT = String(b.cellFill.promptFillPctOfFrame[FILL_KIND[kind] ?? 'high']);
  if (kind === 'royal') {
    ctx.GLYPH = sym.glyph;
    ctx.FACE_HEX = sym.face;
    ctx.FACE_NAME = hueName(sym.face);
    ctx.SUBJECT = subjectFromBrief(b.symbols.royalsCommon.brief.split('.')[0]);
  } else {
    ctx.SUBJECT = subjectFromBrief(sym.brief);
    ctx.PART_LIST = (sym.rigParts ?? []).map((p) => p.replace(/\s*\(.*?\)/g, '').trim()).join(', ');
  }
  const st = tv['symbol.txt'] ?? {};
  ctx.LIGHT_NOTE = (sym.restAngle ?? 0) < 0 ? st.negativeTiltLightNote ?? '' : '';
  ctx.RIG_READY_LINE = rigReady ? st.rigReadyLine ?? '' : '';
  return ctx;
}

export function mascotContext(b, mid) {
  const m = b.mascots[mid];
  if (!m || mid === 'rules') throw new GenError(`unknown mascot ${JSON.stringify(mid)} (artbible.mascots)`);
  return { CHARACTER: subjectFromBrief(m.brief).replace(/\.+$/, ''), IDENTITY_LOCK: b.mascots.rules.identityLock, KEY_HEX: m.keyHex ?? b.keyColors.default };
}

export function buildValues(ref, { symbol = null, mascot = null, rigReady = false, overrides = {} } = {}) {
  const b = bible();
  const tv = loadJson(TEMPLATE_VARS);
  const [name] = splitTemplateRef(ref);
  const spec = tv[name] ?? {};
  const vals = { STYLE_FORMULA: b.styleFormula, KEY_HEX: b.keyColors.default, ...(spec.defaults ?? {}) };
  if (symbol) Object.assign(vals, symbolContext(b, symbol, rigReady, tv));
  if (mascot) Object.assign(vals, mascotContext(b, mascot));
  Object.assign(vals, overrides);
  for (const [k, ch] of Object.entries(spec.choices ?? {})) {
    if (!(k in overrides) && ch.by in vals) {
      const choice = ch.map[String(vals[ch.by])];
      if (choice === undefined) throw new GenError(`${name}: ${ch.by}=${JSON.stringify(vals[ch.by])} not in ${JSON.stringify(Object.keys(ch.map).sort())}`);
      vals[k] = choice;
    }
  }
  return vals;
}

export function parseVars(items = []) {
  const out = {};
  for (const it of items) {
    const i = it.indexOf('=');
    const k = i < 0 ? '' : it.slice(0, i);
    if (i < 0 || !/^[A-Z0-9_]+$/.test(k)) throw new GenError(`--var expects NAME=value with NAME in [A-Z0-9_], got ${JSON.stringify(it)}`);
    out[k] = it.slice(i + 1);
  }
  return out;
}

// ------------------------------------------------------------------ licence gate

export const ROUTES = {
  'higgsfield-cli': ['higgsfield', 'Higgsfield', 'higgsfield'],
  'higgsfield-mcp': ['higgsfield', 'Higgsfield', 'higgsfield'],
  vertex: [null, 'Google Cloud', 'google-cloud'],
  scenario: ['scenario', 'Scenario', 'scenario'],
  elevenlabs: ['elevenlabs', 'ElevenLabs', 'elevenlabs'],
  stability: ['stability-audio-api', 'Stability AI', 'stability'],
};

export const FAMILY_DENY = [
  [/gpt[-_ .]?image|(^|[^a-z])gpt[-_ .]?\d|openai|dall[-_ ]?e|(^|[^a-z])sora([^a-z]|$)|codex/, 'openai-gpt-image'],
  [/hunyuan|hy[-_ ]?motion/, 'tencent-hunyuan'],
  [/midjourney|(^|[^a-z])mj[-_ ]?v\d/, 'midjourney'],
  [/flux[-_ .]?1[-_ .]?(fill[-_ .]?)?dev|flux[-_ .]?2[-_ .]?dev|klein[-_ .]?9b/, 'flux-dev-self-hosted'],
  [/qwen[-_ .]?image[-_ .]?2[-_ .]?1/, 'qwen-image-2.1'],
  [/ideogram[-_ .]?4/, 'ideogram-4-weights'],
  [/(^|[^a-z])bria([^a-z]|$)|rmbg/, 'bria-rmbg-2.0'],
  [/trellis/, 'trellis-2-default'],
  [/matanyone|videomama|sam2matting|transpix/, 'video-matting-nc'],
  [/musicgen|audiogen|mmaudio/, 'audio-nc-models'],
  [/(^|[^a-z])suno([^a-z]|$)/, 'suno'],
  [/(^|[^a-z])udio([^a-z]|$)/, 'udio'],
  [/ace[-_ ]?step/, 'ace-step-shipped'],
  [/stable[-_ ]?audio[-_ ]?3[-_ ]?(small|medium)/, 'stable-audio-3-open-over-1m'],
  [/mirelo|sonilo/, 'higgsfield-audio'],
  [/see[-_ ]?through/, 'see-through'],
];

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

export function denylistHits(route, model, deny = loadJson(DENYLIST_PATH)) {
  const hits = new Set();
  const low = model.toLowerCase();
  for (const [re, id] of FAMILY_DENY) if (re.test(low)) hits.add(id);
  const vendor = route.split('-')[0];
  const nm = norm(model);
  for (const e of deny.entries ?? []) {
    if (e.category === 'approval') continue; // hosts / sample assets / npm clients, not generation models
    for (const item of e.appliesTo ?? []) {
      const i = item.indexOf(':');
      let target = item;
      if (i >= 0) {
        if (norm(item.slice(0, i)) !== norm(vendor)) continue;
        target = item.slice(i + 1);
      }
      const t = norm(target.replace(/\(.*?\)/g, ''));
      // the model id equals or extends a denylisted id (gpt_image_2_5 extends gpt-image-2)
      if (t.length >= 4 && nm.startsWith(t)) hits.add(e.id);
    }
  }
  return [...hits].sort();
}

export function latestTos(slug) {
  const d = path.join(TOS_DIR, slug);
  if (!fs.existsSync(d)) return null;
  const pdfs = fs.readdirSync(d).filter((f) => f.toLowerCase().endsWith('.pdf')).sort();
  return pdfs.length ? rel(path.join(d, pdfs[pdfs.length - 1])) : null;
}

/** Licence gate for a vendor call. Throws GenError(code 3) on refusal. */
export function gate(route, model) {
  if (!(route in ROUTES)) throw new GenError(`unknown route ${JSON.stringify(route)}`, 3);
  const allow = loadJson(ALLOWLIST_PATH);
  const hits = denylistHits(route, model);
  if (hits.length) throw new GenError(`REFUSED: ${route}:${model} matches licenses/denylist.json ${JSON.stringify(hits)}`, 3);
  const [lid, vendor, slug] = ROUTES[route];
  let entry;
  if (lid === null) {
    entry = allow.entries.find((e) => (e.modelIds ?? []).includes(model));
    if (!entry) throw new GenError(`REFUSED: model ${JSON.stringify(model)} is not listed in any licenses/allowlist.json modelIds`, 3);
  } else {
    entry = allow.entries.find((e) => e.id === lid);
    if (!entry) throw new GenError(`REFUSED: allowlist entry ${JSON.stringify(lid)} missing from licenses/allowlist.json`, 3);
    if (entry.modelIds && !entry.modelIds.includes(model)) throw new GenError(`REFUSED: ${model} not in allowlist[${lid}].modelIds`, 3);
  }
  const warnings = [];
  if (entry.clearance !== 'cleared' && entry.clearance !== 'not-required') {
    warnings.push(`clearance for '${entry.id}' is '${entry.clearance}': build now, but outputs cannot ship until licenses/clearances/ holds the written answer`);
  }
  const tos = latestTos(slug);
  if (tos === null) warnings.push(`no archived ToS under licenses/tos/${slug}/ (tosVersion will be null)`);
  return { licenseId: entry.id, vendor, clearance: entry.clearance, tosVersion: tos, warnings };
}

// ------------------------------------------------------------------ raw folders

/** Canonical JSON (sorted keys, compact) for request fingerprints. */
export const canonical = (v) => {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
};
export const fingerprint = (request) => sha256Text(canonical(request));

export function versionDirs(assetDir) {
  if (!fs.existsSync(assetDir)) return [];
  return fs.readdirSync(assetDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^v\d{2,}$/.test(d.name))
    .map((d) => d.name).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))
    .map((n) => path.join(assetDir, n));
}

export const rawOutputs = (vdir) => fs.readdirSync(vdir).filter((f) => f.startsWith('raw') && fs.statSync(path.join(vdir, f)).isFile()).sort();

/** Pick art/_raw/<asset>/vNN. Returns {dir, state: 'done'|'resume'|'new'} (see genlib.py). */
export function allocate(asset, fp, root = RAW_ROOT, forceNew = false) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(asset)) throw new GenError(`asset name ${JSON.stringify(asset)} must match [A-Za-z0-9][A-Za-z0-9_.-]*`);
  const adir = path.join(root, asset);
  const vers = versionDirs(adir);
  if (!forceNew) {
    for (const v of [...vers].reverse()) {
      const a = path.join(v, 'args.json');
      if (!fs.existsSync(a)) continue;
      try {
        if (loadJson(a).fingerprint === fp) return { dir: v, state: rawOutputs(v).length ? 'done' : 'resume' };
      } catch { /* corrupt args.json: ignore */ }
    }
  }
  const n = vers.length ? Number(path.basename(vers[vers.length - 1]).slice(1)) + 1 : 1;
  return { dir: path.join(adir, `v${String(n).padStart(2, '0')}`), state: 'new' };
}

export function defaultAsset(ref, { symbol, mascot, rigReady, extra } = {}) {
  const [name, section] = splitTemplateRef(ref);
  const base = name.slice(0, -4);
  const sec = section ? `_${section}` : '';
  const ex = extra ? `_${extra}` : '';
  if (symbol) {
    const stem = `sym_${symbol}${rigReady ? '_rig' : ''}`;
    return base === 'symbol' ? stem : `${stem}_${base}${sec}`;
  }
  if (mascot) return `mascot_${mascot}_${base.replace(/^mascot_/, '')}${sec}${ex}`;
  return `${base}${sec}${ex}`;
}

// ------------------------------------------------------------------ tiny argv parser

/**
 * parseArgs(argv, spec): spec = { name: {type:'string'|'boolean'|'number', multi, default, alias} }.
 * Unknown flags are an error (typos must not silently change a paid request).
 */
export function parseArgs(argv, spec) {
  const out = {};
  const positionals = [];
  const alias = {};
  for (const [k, s] of Object.entries(spec)) {
    if (s.alias) alias[s.alias] = k;
    out[k] = s.multi ? [...(s.default ?? [])] : s.default;
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { positionals.push(...argv.slice(i + 1)); break; }
    if (!a.startsWith('-') || a === '-') { positionals.push(a); continue; }
    let [flag, val] = a.includes('=') ? [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)] : [a, undefined];
    flag = flag.replace(/^--?/, '');
    const dashed = flag.replace(/_/g, '-');
    const key = spec[flag] ? flag : alias[flag] ?? (spec[dashed] ? dashed : undefined);
    const s = key && spec[key];
    if (!s) throw new GenError(`unknown option ${a} (see --help)`);
    if (s.type === 'boolean') {
      out[key] = val === undefined ? true : !/^(0|false|no|off)$/i.test(val);
      continue;
    }
    if (val === undefined) {
      if (i + 1 >= argv.length) throw new GenError(`option --${key} needs a value`);
      val = argv[++i];
    }
    const v = s.type === 'number' ? Number(val) : val;
    if (s.type === 'number' && !Number.isFinite(v)) throw new GenError(`option --${key} expects a number, got ${val}`);
    if (s.multi) out[key].push(v); else out[key] = v;
  }
  out._ = positionals;
  return out;
}
