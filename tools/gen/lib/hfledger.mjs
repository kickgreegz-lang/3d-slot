// Higgsfield MCP paid-job ledger (art/ledger/higgsfield-jobs.json, schema next to it).
// Pure data helpers shared by tools/gen/hf-ingest.mjs: load/validate/locked update of the ledger,
// prompt resolution (re-render from the art bible, else the stored copy), asset/stage/model
// resolution, and parsing of the MCP's generate_image_batch / jobs_wait JSON. No network.
import fs from 'node:fs';
import path from 'node:path';
import { validate } from '../../licence/schema-lite.mjs';
import { GenError, bible, buildValues, defaultAsset, loadJson, render, splitTemplateRef } from './genlib.mjs';
import { REPO, rel, sha256Text, withLock, writeAtomic } from './provenance.mjs';

export const LEDGER = path.join(REPO, 'art', 'ledger', 'higgsfield-jobs.json');
export const LEDGER_SCHEMA = path.join(REPO, 'art', 'ledger', 'higgsfield-jobs.schema.json');
export const LEDGER_PROMPTS = path.join(REPO, 'art', 'ledger', 'prompts');

export const LEDGER_COMMENT = 'Paid Higgsfield MCP generation jobs (route higgsfield-mcp). Results live on the Higgsfield CDN until '
  + "'pnpm gen:hf-ingest' downloads them into art/_raw/<asset>/vNN (+ art/manifest.json rows). Record new jobs with "
  + "'pnpm gen:hf-ingest record' straight from the MCP's generate_image_batch / jobs_wait JSON; 'pnpm gen:hf-ingest status' "
  + 'shows credits and download state. Prompts are rendered from art/bible/prompts (promptHash = sha256 of the rendered text; '
  + 'the exact text is also kept in art/ledger/prompts/<promptHash>.txt). Committed so paid jobs survive container restarts.';

/**
 * MCP model ids (they differ from the CLI's!). 'reports' is the id the finished job reports in
 * jobs_wait (what the manifest row records); credits measured 2026-09-26 on the Plus plan.
 * Never add an OpenAI model here: gpt_image_2 / gpt_image_2_5 / openai_hazel are denylisted.
 */
export const MCP_MODELS = {
  nano_banana_pro: { reports: 'nano_banana_2', upstream: 'Google Nano Banana Pro (gemini-3-pro-image)', credits: { '2k': 2, '4k': 4 } },
  nano_banana_2: { reports: null, upstream: 'Google Nano Banana 2 (gemini-3.1-flash-image)', credits: { '1k': 1.5, '2k': 2 } },
  seedream_v4_5: { reports: null, upstream: 'ByteDance Seedream 4.5', credits: { '*': 1 } },
};

export const estimateCredits = (model, resolution) => {
  const c = MCP_MODELS[model]?.credits;
  if (!c) return null;
  return c[String(resolution ?? '').toLowerCase()] ?? c['*'] ?? null;
};

const TERMINAL_FAIL = /fail|error|nsfw|cancel|reject|timeout|expired/i;
export const isCompleted = (s) => String(s ?? '').toLowerCase() === 'completed';
export const isFailed = (s) => TERMINAL_FAIL.test(String(s ?? ''));
export const isTerminal = (s) => isCompleted(s) || isFailed(s);

// ------------------------------------------------------------------ load / validate / update

export const emptyLedger = () => ({ $schema: './higgsfield-jobs.schema.json', $comment: LEDGER_COMMENT, batches: [] });

export function loadLedger(p = LEDGER, { allowMissing = false } = {}) {
  if (!fs.existsSync(p)) {
    if (allowMissing) return emptyLedger();
    throw new GenError(`ledger ${rel(p)} not found`);
  }
  let doc;
  try { doc = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { throw new GenError(`ledger ${rel(p)} is not JSON: ${e.message}`); }
  return doc;
}

/** Schema + semantic problems (list of strings; empty = valid). */
export function ledgerProblems(doc) {
  const errs = validate(loadJson(LEDGER_SCHEMA), doc).map((m) => `schema ${m}`);
  if (errs.length) return errs;
  const seenBatch = new Set();
  const seenJob = new Map();
  for (const b of doc.batches) {
    if (seenBatch.has(b.id)) errs.push(`batch ${b.id}: duplicate batch id`);
    seenBatch.add(b.id);
    const names = new Set();
    for (const j of b.jobs) {
      if (names.has(j.name)) errs.push(`batch ${b.id}: duplicate job name ${j.name}`);
      names.add(j.name);
      const key = j.job_id.toLowerCase();
      if (seenJob.has(key)) errs.push(`job ${j.job_id}: recorded twice (${seenJob.get(key)} and ${b.id}/${j.name})`);
      seenJob.set(key, `${b.id}/${j.name}`);
      if (j.template && j.template.includes('#') && !/#[A-Z0-9]+$/.test(j.template)) errs.push(`${b.id}/${j.name}: bad template ref ${j.template}`);
      for (const k of Object.keys(j.vars ?? {})) {
        if (!/^[A-Z0-9_]+$/.test(k) && !['symbol', 'mascot', 'rigReady'].includes(k)) errs.push(`${b.id}/${j.name}: vars.${k} is neither symbol/mascot/rigReady nor an UPPER_CASE placeholder`);
      }
    }
  }
  return errs;
}

export function checkedLedger(p = LEDGER, opts = {}) {
  const doc = loadLedger(p, opts);
  const errs = ledgerProblems(doc);
  if (errs.length) throw new GenError(`ledger ${rel(p)} is invalid:\n  ${errs.join('\n  ')}`);
  return doc;
}

/** Locked read-modify-write; mutate(doc) edits in place. Writes only when the JSON changed. */
export function updateLedger(p, mutate) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  return withLock(p, () => {
    const doc = checkedLedger(p, { allowMissing: true });
    const before = JSON.stringify(doc);
    const out = mutate(doc);
    const errs = ledgerProblems(doc);
    if (errs.length) throw new GenError(`refusing to write an invalid ledger:\n  ${errs.join('\n  ')}`);
    const changed = JSON.stringify(doc) !== before || !fs.existsSync(p);
    if (changed) writeAtomic(p, doc);
    return { changed, result: out };
  });
}

export function* allJobs(doc) {
  for (const batch of doc.batches) for (const job of batch.jobs) yield { batch, job };
}

export const findJob = (doc, jobId) => {
  for (const x of allJobs(doc)) if (x.job.job_id.toLowerCase() === String(jobId).toLowerCase()) return x;
  return null;
};

// ------------------------------------------------------------------ per-job resolution

/** Render context for a job: explicit vars, else inferred from a legacy name (sym_H1, mascot_gumbo_*). */
export function jobContext(job) {
  const v = job.vars ?? null;
  const ctx = { symbol: null, mascot: null, rigReady: false, overrides: {}, inferred: false };
  if (v) {
    ctx.symbol = v.symbol ?? null;
    ctx.mascot = v.mascot ?? null;
    ctx.rigReady = Boolean(v.rigReady);
    for (const [k, val] of Object.entries(v)) if (/^[A-Z0-9_]+$/.test(k)) ctx.overrides[k] = String(val);
    return ctx;
  }
  // backward compatibility: ledgers written before 'vars' existed (the hash check below keeps this honest)
  const tpl = job.template ? splitTemplateRef(job.template)[0] : '';
  const sym = /^sym_([A-Z][A-Z0-9]*?)(_rig)?(?:_|$)/.exec(job.name);
  const mas = /^mascot_([a-z]+)_/.exec(job.name);
  if (sym && /symbol|royal/.test(tpl)) Object.assign(ctx, { symbol: sym[1], rigReady: Boolean(sym[2]), inferred: true });
  else if (mas && tpl.startsWith('mascot_')) Object.assign(ctx, { mascot: mas[1], inferred: true });
  return ctx;
}

export const promptFile = (hash, dir = LEDGER_PROMPTS) => path.join(dir, `${hash}.txt`);

/** Store prompt text as <dir>/<sha256>.txt (no trailing newline). Returns the path. */
export function storePrompt(text, dir = LEDGER_PROMPTS) {
  const hash = sha256Text(text);
  const p = promptFile(hash, dir);
  if (fs.existsSync(p)) {
    if (sha256Text(fs.readFileSync(p, 'utf8')) !== hash) throw new GenError(`${rel(p)} does not hash to its name; fix or delete it`);
    return p;
  }
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${p}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, p);
  return p;
}

/**
 * The exact prompt that was paid for: {text, hash, source: 'rendered'|'stored', warning?}.
 * A template job is re-rendered and must hash to job.promptHash; when the art bible or template
 * changed since, the stored copy (art/ledger/prompts/<hash>.txt) is used instead, with a warning.
 */
export function resolvePrompt(job, dir = LEDGER_PROMPTS) {
  const tag = job.name;
  if (!job.promptHash) throw new GenError(`${tag}: no promptHash in the ledger (record jobs with 'pnpm gen:hf-ingest record')`);
  const sp = promptFile(job.promptHash, dir);
  let stored = null;
  if (fs.existsSync(sp)) {
    stored = fs.readFileSync(sp, 'utf8');
    if (sha256Text(stored) !== job.promptHash) throw new GenError(`${rel(sp)} does not hash to its name; fix or delete it`);
  }
  if (job.template) {
    const ctx = jobContext(job);
    let r = null;
    let why;
    try {
      r = render(job.template, buildValues(job.template, { symbol: ctx.symbol, mascot: ctx.mascot, rigReady: ctx.rigReady, overrides: ctx.overrides }));
    } catch (e) {
      if (!(e instanceof GenError)) throw e;
      why = e.message;
    }
    if (r && r.hash === job.promptHash) return { text: r.text, hash: r.hash, source: 'rendered' };
    why ??= `renders sha256 ${r.hash.slice(0, 12)}…, the ledger says ${job.promptHash.slice(0, 12)}…`;
    if (stored !== null) {
      return { text: stored, hash: job.promptHash, source: 'stored', warning: `${tag}: ${job.template} no longer reproduces the paid prompt (${why}); using ${rel(sp)}` };
    }
    throw new GenError(`${tag}: prompt drift: ${job.template} with vars ${JSON.stringify(job.vars ?? {})} ${why}, and there is no stored copy ${rel(sp)}. `
      + 'Re-render at the commit the job ran on (git log art/bible) and save the exact text there, or fix the job\'s vars.');
  }
  if (stored !== null) return { text: stored, hash: job.promptHash, source: 'stored' };
  throw new GenError(`${tag}: no template and no stored prompt ${rel(sp)} (record MCP jobs with 'pnpm gen:hf-ingest record --plan|--request')`);
}

const SAFE_ASSET = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

/** art/_raw/<asset>: job.asset, else genlib's defaultAsset (same folder as gen:higgsfield), else the name. */
export function assetFor(job) {
  if (job.asset) return job.asset;
  if (job.template) {
    const ctx = jobContext(job);
    const a = defaultAsset(job.template, { symbol: ctx.symbol, mascot: ctx.mascot, rigReady: ctx.rigReady });
    if (SAFE_ASSET.test(a)) return a;
  }
  const n = job.name.replace(/[^A-Za-z0-9_.-]+/g, '_').replace(/^[^A-Za-z0-9]+/, '');
  return n || 'hf_job';
}

const STAGE_BY_TEMPLATE = {
  'symbol.txt': '2d-image', 'symbol_parts_sheet.txt': '2d-image', 'royal_material_pass.txt': '2d-image',
  'frame_piece.txt': '2d-image', 'vfx_keyframe.txt': '2d-image',
  'mascot_turnaround.txt': 'mascot-sheets', 'mascot_expressions.txt': 'mascot-sheets',
  'background.txt': 'backgrounds', 'video_loop.txt': 'video',
};

/** Manifest stage per asset kind (job.stage overrides). */
export function stageFor(job, asset = assetFor(job)) {
  if (job.stage) return job.stage;
  if (job.template) {
    const s = STAGE_BY_TEMPLATE[splitTemplateRef(job.template)[0]];
    if (s) return s;
  }
  if (String(job.type ?? '').toLowerCase() === 'video') return 'video';
  // untemplated jobs: name tokens (ab_bg_painted, D_gumbo, ab_croak_v2); mascot ids come from the art bible
  const tokens = new Set(asset.toLowerCase().split(/[_.-]+/));
  const mascots = Object.keys(bible().mascots ?? {}).filter((k) => k !== 'rules');
  if (tokens.has('bg') || tokens.has('background')) return 'backgrounds';
  if (tokens.has('mascot') || mascots.some((m) => tokens.has(m.toLowerCase()))) return 'mascot-sheets';
  return '2d-image';
}

export const requestModelFor = (batch, job) => job.request_model ?? batch.model;

/** Model id for the manifest row: as reported by the job, else the known mapping, else the request id. */
export function rowModelFor(batch, job) {
  const req = requestModelFor(batch, job);
  if (job.model) return { model: job.model, known: true };
  const m = MCP_MODELS[req]?.reports;
  return m ? { model: m, known: true } : { model: req, known: false };
}

// ------------------------------------------------------------------ MCP JSON

const JOB_ARRAY_KEYS = ['jobs', 'results', 'items', 'generations', 'data'];

function jobArray(j) {
  if (Array.isArray(j)) return j;
  if (j && typeof j === 'object') {
    for (const k of JOB_ARRAY_KEYS) if (Array.isArray(j[k])) return j[k];
    if (j.result && typeof j.result === 'object') return jobArray(j.result);
    if (j.job_id || j.id) return [j];
  }
  return null;
}

/** MCP tool results often arrive wrapped as {content:[{type:'text', text:'<json>'}]}: unwrap them. */
function unwrap(j) {
  if (j && typeof j === 'object' && Array.isArray(j.content)) {
    const texts = j.content.filter((c) => c?.type === 'text' && typeof c.text === 'string');
    for (const t of texts) { try { return unwrap(JSON.parse(t.text)); } catch { /* next */ } }
  }
  return j;
}

/**
 * Jobs from a generate_image_batch or jobs_wait result:
 * [{index, job_id, status, model, type, result_url, error}] (null where absent).
 */
export function parseMcpJobs(json) {
  const arr = jobArray(unwrap(json));
  if (!arr) throw new GenError(`no jobs[] in the MCP JSON (expected generate_image_batch or jobs_wait output): ${JSON.stringify(json).slice(0, 300)}`);
  return arr.map((x) => {
    const url = x?.result_url ?? x?.result_urls?.[0] ?? x?.results?.[0]?.url ?? x?.result?.url ?? x?.url ?? null;
    return {
      index: Number.isInteger(x?.index) ? x.index : null,
      job_id: x?.job_id ?? x?.jobId ?? x?.id ?? null,
      // a result URL only exists once the job finished; staged {index, name, params, job_id, result_url} lists carry no status
      status: x?.status ?? (x?.error ? 'rejected' : typeof url === 'string' && url ? 'completed' : null),
      model: x?.model ?? null,
      type: x?.type ?? null,
      result_url: typeof url === 'string' && url ? url : null,
      error: x?.error ? (typeof x.error === 'string' ? x.error : JSON.stringify(x.error)) : null,
    };
  });
}
