#!/usr/bin/env node
// Higgsfield MCP ingestion (route higgsfield-mcp). The MCP generates on Higgsfield's side and returns
// CDN result URLs; this tool turns the committed ledger of those PAID jobs
// (art/ledger/higgsfield-jobs.json) into the same raw layout as tools/gen/higgsfield.mjs:
//   art/_raw/<asset>/vNN/{raw.png, prompt.txt, job.json, manifest.json} + rows in art/manifest.json.
// Subcommands: ingest (default) · status · check · plan · record. No Higgsfield credentials needed:
// it never calls the MCP; agents paste the MCP's JSON into 'record'.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { GenError, RAW_ROOT, buildValues, gate, parseArgs, render, templatePath, versionDirs } from './lib/genlib.mjs';
import {
  LEDGER, LEDGER_PROMPTS, MCP_MODELS, allJobs, assetFor, checkedLedger, estimateCredits, findJob, isCompleted,
  isFailed, isTerminal, jobContext, parseMcpJobs, promptFile, requestModelFor, resolvePrompt, rowModelFor, stageFor,
  storePrompt, updateLedger,
} from './lib/hfledger.mjs';
import { MANIFEST, REPO, isMain, makeRow, nowIso, readManifest, record, rel, safeId, sha256File, sha256Text } from './lib/provenance.mjs';

const TOOL = 'tools/gen/hf-ingest.mjs';

const HELP = `Usage: pnpm gen:hf-ingest [ingest|status|check|plan|record] [options]

  ingest (default)  download every completed ledger job that has no local copy into
                    art/_raw/<asset>/vNN/{raw.png,prompt.txt,job.json,manifest.json} and append its
                    row to art/manifest.json (route higgsfield-mcp, shipped false). Idempotent,
                    resumable (HTTP Range on .incoming/<job>.part), verifies the PNG (signature,
                    chunk CRCs, IEND), its size vs the job's resolution/aspect and its sha256 vs the
                    ledger; never overwrites a different file.
  status            batches, jobs, credits spent per batch, downloaded or not (offline). --json
  check             validate the ledger (schema, prompt re-render == promptHash, licence gate); offline.
                    --store-prompts saves each reproducible prompt as art/ledger/prompts/<hash>.txt
  plan --spec F     render prompts for an MCP batch from a spec (see README) and print the exact
                    generate_image_batch arguments; writes the plan to art/_work/hf-plans/<batch>.plan.json
  record            append/update ledger jobs from MCP JSON:
                      record --plan P --from submit.json [--from wait.json]   (jobs made from 'plan')
                      record --batch B --request req.json --from submit.json [--name 0=ui_emblem]
                      record --from wait.json                               (refresh status/result_url)

Options:
  --ledger FILE         default art/ledger/higgsfield-jobs.json
  --prompts-dir DIR     stored prompts, default art/ledger/prompts
  --out-root DIR        default art/_raw          --manifest FILE  default art/manifest.json ('none' to skip)
  --batch ID            only these batches (repeatable; record: target batch)
  --job NAME|JOB_ID     only these jobs (repeatable)
  --dry-run             ingest: resolve prompts, gate and folders; no network, no writes
  --allow-host HOST     extra result-URL host (repeatable; http:// only for loopback test servers).
                        Default: https on *.cloudfront.net and *.higgsfield.ai
  --timeout-s N         per-download timeout, default 600     --retries N   attempts per download, default 3
  --allow-size-mismatch accept a PNG whose size does not fit the job's resolution/aspect (noted in the row)
  --json                status: machine-readable output
  plan:   --spec FILE  --out FILE  --max-credits N (fails closed when the estimate is unknown)
  record: --plan FILE | --request FILE  --from FILE|- (repeatable)  --name INDEX=NAME  --purpose TEXT
          --plan-tier TEXT  --credits N (override the per-job estimate)  --date YYYY-MM-DD
Exit codes: 0 ok/nothing to do · 2 usage, ledger or prompt error · 3 licence refusal · 4 cost cap ·
            6 download failure (incl. the egress-policy block) · 7 verification failure or file conflict.`;

const SPEC = {
  help: { type: 'boolean', alias: 'h' },
  ledger: { type: 'string' }, 'prompts-dir': { type: 'string' }, 'out-root': { type: 'string' }, manifest: { type: 'string' },
  batch: { type: 'string', multi: true }, job: { type: 'string', multi: true }, 'dry-run': { type: 'boolean' },
  'allow-host': { type: 'string', multi: true }, 'timeout-s': { type: 'number', default: 600 }, retries: { type: 'number', default: 3 },
  'allow-size-mismatch': { type: 'boolean' }, json: { type: 'boolean' }, 'store-prompts': { type: 'boolean' },
  spec: { type: 'string' }, out: { type: 'string' }, 'max-credits': { type: 'number' },
  plan: { type: 'string' }, request: { type: 'string' }, from: { type: 'string', multi: true }, name: { type: 'string', multi: true },
  purpose: { type: 'string' }, 'plan-tier': { type: 'string' }, credits: { type: 'number' }, date: { type: 'string' },
};

const log = (m) => console.error(m);

// ------------------------------------------------------------------ PNG verification

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Full structural check: signature, IHDR first, every chunk's CRC, IDAT present, IEND reached. */
export function inspectPng(buf) {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIG)) {
    const head = buf.subarray(0, 32).toString('latin1').replace(/[^\x20-\x7e]/g, '.');
    throw new Error(`bad PNG signature (starts with "${head}")`);
  }
  let off = 8;
  let ihdr = null;
  let idat = false;
  while (off + 12 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    if (off + 12 + len > buf.length) throw new Error(`truncated inside chunk ${type} at byte ${off} (file has ${buf.length} bytes)`);
    const crc = buf.readUInt32BE(off + 8 + len);
    if (zlib.crc32(buf.subarray(off + 4, off + 8 + len)) !== crc) throw new Error(`CRC mismatch in chunk ${type} at byte ${off}`);
    if (!ihdr) {
      if (type !== 'IHDR' || len !== 13) throw new Error('first chunk is not IHDR');
      ihdr = { width: buf.readUInt32BE(off + 8), height: buf.readUInt32BE(off + 12), bitDepth: buf[off + 16], colorType: buf[off + 17] };
    }
    if (type === 'IDAT') idat = true;
    off += 12 + len;
    if (type === 'IEND') {
      if (!idat) throw new Error('no IDAT chunk');
      if (!ihdr.width || !ihdr.height) throw new Error('zero width/height');
      return { ...ihdr, trailingBytes: buf.length - off };
    }
  }
  throw new Error(`truncated: no IEND chunk (file has ${buf.length} bytes)`);
}

/** Problems with a w x h result for this job (exact when the ledger knows the size). */
export function sizeProblems(w, h, job) {
  if (job.width && job.height) return w === job.width && h === job.height ? [] : [`${w}x${h}, the ledger recorded ${job.width}x${job.height}`];
  const out = [];
  const ar = /^(\d+):(\d+)$/.exec(job.aspect_ratio ?? '');
  if (ar) {
    const want = Number(ar[1]) / Number(ar[2]);
    if (Math.abs(Math.log((w / h) / want)) > 0.03) out.push(`${w}x${h} is aspect ${(w / h).toFixed(3)}, the job asked for ${job.aspect_ratio} (${want.toFixed(3)})`);
  }
  const res = /^(\d+)k$/i.exec(job.resolution ?? '');
  if (res) {
    // NBP sizes: 2k 1:1 = 2048x2048, 4k 21:9 = 6336x2688 -> sqrt(area) ~ 1024*k; also accept a long edge ~ 1024*k
    const nominal = 1024 * Number(res[1]);
    const area = Math.sqrt(w * h) / nominal;
    const long = Math.max(w, h) / nominal;
    if (!(area >= 0.85 && area <= 1.2) && !(long >= 0.9 && long <= 1.1)) out.push(`${w}x${h} does not look like ${job.resolution} (expected about ${nominal} px per side or on the long edge)`);
  }
  return out;
}

// ------------------------------------------------------------------ download

const DEFAULT_HOSTS = [/^([a-z0-9-]+\.)*cloudfront\.net$/, /^([a-z0-9-]+\.)*higgsfield\.ai$/];
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

function checkUrl(url, allowHosts) {
  let u;
  try { u = new URL(url); } catch { throw new GenError(`bad result_url ${JSON.stringify(url)}`, 6); }
  const host = u.hostname.toLowerCase();
  const explicit = allowHosts.includes(host);
  if (u.protocol === 'https:' && (explicit || DEFAULT_HOSTS.some((re) => re.test(host)))) return u;
  if (u.protocol === 'http:' && explicit && LOOPBACK.has(host)) return u;
  throw new GenError(`refusing result URL ${url}: only https:// on the Higgsfield CDN (*.cloudfront.net, *.higgsfield.ai) or a host passed with --allow-host (http:// only for loopback test servers)`, 6);
}

export class EgressBlocked extends GenError {
  constructor(host, detail) {
    super(`EGRESS BLOCKED: this environment's network policy does not allow ${host} (${detail}).\n`
      + `  -> Ask the user to allow ${host}: cloud environment menu in the session title bar -> Edit -> Network access,\n`
      + `     add ${host} to the allowed domains (or pick a broader access level; https://code.claude.com/docs/en/claude-code-on-the-web).\n`
      + '     On your own machine or runner: allow it in your proxy/firewall. Then re-run: pnpm gen:hf-ingest\n'
      + '  Nothing was written for these jobs; they stay recorded in the ledger. Do not route around the block.', 6);
    this.host = host;
  }
}

const errChain = (e) => {
  const out = [];
  for (let c = e, d = 0; c && d < 6; c = c.cause, d++) if (c.message && !out.includes(c.message)) out.push(c.message);
  return out.join(': ');
};
const pause = (ms) => new Promise((res) => setTimeout(res, ms));
const fileSize = (p) => (fs.existsSync(p) ? fs.statSync(p).size : 0);

/** GET url into `part`, resuming with Range when part already holds bytes. */
async function download(url, part, { allowHosts, timeoutS, retries, jobRef }) {
  const u = checkUrl(url, allowHosts);
  const host = u.hostname;
  let lastErr = null;
  for (let attempt = 1; attempt <= Math.max(1, retries); attempt++) {
    if (attempt > 1) await pause(400 * attempt);
    const have = fileSize(part);
    let r;
    try {
      r = await fetch(u, { headers: have ? { range: `bytes=${have}-` } : {}, signal: AbortSignal.timeout(timeoutS * 1000) });
    } catch (e) {
      const d = errChain(e);
      if (/Proxy response \((403|407)\)|tunnel.*(403|407)|(403|407).*tunnel/i.test(d)) throw new EgressBlocked(host, `proxy refused CONNECT: ${d}`);
      lastErr = new GenError(`network error fetching ${host}: ${d}`, 6);
      continue;
    }
    if (r.url && r.url !== u.href) checkUrl(r.url, allowHosts); // redirects must stay on allowed hosts
    if (r.status === 403 || r.status === 407 || r.status === 451) {
      const body = (await r.text().catch(() => '')).slice(0, 400).trim();
      const deny = r.headers.get('x-deny-reason');
      if (deny || /not in allowlist|egress|network policy|host_not_allowed/i.test(body)) throw new EgressBlocked(host, `HTTP ${r.status}${deny ? ` x-deny-reason: ${deny}` : ''}${body ? `: ${body}` : ''}`);
      const cdn = r.headers.get('x-amz-cf-id') || /cloudfront|amazons3/i.test(r.headers.get('server') ?? '') || /AccessDenied|<Error>/.test(body);
      throw new GenError(`HTTP ${r.status} from ${cdn ? 'the CDN itself' : host} for ${jobRef}: ${body || r.statusText}. `
        + 'The result URL may have expired or been removed: refresh it with the MCP (jobs_wait, timeout_seconds 0, on this job_id), '
        + 'save the JSON and run `pnpm gen:hf-ingest record --from wait.json`, then ingest again.', 6);
    }
    if (r.status === 404 || r.status === 410) {
      await r.body?.cancel();
      throw new GenError(`HTTP ${r.status} for ${jobRef}: the result is gone from the CDN; refresh result_url with jobs_wait + record, or re-open the job in Higgsfield`, 6);
    }
    if (r.status === 416 && have) { await r.body?.cancel(); return { resumedFrom: have, status: 416, contentType: null }; } // part already complete
    if (!r.ok) {
      await r.body?.cancel();
      lastErr = new GenError(`HTTP ${r.status} ${r.statusText} from ${host} for ${jobRef}`, 6);
      if (r.status >= 500 || r.status === 429) continue;
      throw lastErr;
    }
    let flags = 'w';
    let resumedFrom = 0;
    if (r.status === 206) {
      const cr = /bytes (\d+)-/.exec(r.headers.get('content-range') ?? '');
      if (!have || !cr || Number(cr[1]) !== have) { await r.body?.cancel(); fs.rmSync(part, { force: true }); lastErr = new GenError(`bad partial response from ${host}`, 6); continue; }
      flags = 'a';
      resumedFrom = have;
    }
    fs.mkdirSync(path.dirname(part), { recursive: true });
    const fd = fs.openSync(part, flags);
    try {
      // synchronous writes: every received byte is on disk before an interruption surfaces
      for await (const chunk of r.body) fs.writeSync(fd, chunk);
    } catch (e) {
      lastErr = new GenError(`download of ${jobRef} from ${host} interrupted after ${fileSize(part)} bytes (${errChain(e)}); re-run to resume`, 6);
      continue;
    } finally {
      fs.closeSync(fd);
    }
    return { resumedFrom, status: r.status, contentType: r.headers.get('content-type') };
  }
  throw lastErr;
}

// ------------------------------------------------------------------ job resolution / local state

const absRow = (p) => (path.isAbsolute(p) ? p : path.join(REPO, p));
const readJsonMaybe = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };

function selectJobs(doc, a) {
  const out = [];
  for (const { batch, job } of allJobs(doc)) {
    if (a.batch.length && !a.batch.includes(batch.id)) continue;
    if (a.job.length && !a.job.some((x) => x === job.name || x.toLowerCase() === job.job_id.toLowerCase())) continue;
    out.push({ batch, job });
  }
  if ((a.batch.length || a.job.length) && !out.length) throw new GenError(`no ledger job matches --batch ${a.batch.join(',') || '*'} --job ${a.job.join(',') || '*'}`);
  return out;
}

/** Everything about a job that needs no network: asset, stage, models, gate, prompt. */
function resolveJob(batch, job, ctx) {
  const asset = assetFor(job);
  const requestModel = requestModelFor(batch, job);
  const g = gate('higgsfield-mcp', requestModel);
  const rm = rowModelFor(batch, job);
  if (rm.model !== requestModel) gate('higgsfield-mcp', rm.model);
  return {
    batch, job, asset, stage: stageFor(job, asset), requestModel, rowModel: rm.model, rowModelKnown: rm.known, gate: g,
    prompt: resolvePrompt(job, ctx.promptsDir), ref: `${batch.id}/${job.name}`,
  };
}

/**
 * Where this job lives locally: {dir|null, state: 'present'|'resume'|'new', row?, jobJson?}.
 * Lookup order: an art/manifest.json row with this jobId (keeps vNN stable across machines), then a
 * job.json with this jobId under <out-root>/<asset>/v*.
 */
function locate(info, ctx) {
  const jid = info.job.job_id.toLowerCase();
  const row = ctx.rowsByJob.get(jid) ?? null;
  let dir = null;
  if (row) dir = path.dirname(absRow(row.path));
  else {
    for (const v of versionDirs(path.join(ctx.root, info.asset))) {
      const jj = readJsonMaybe(path.join(v, 'job.json'));
      if (String(jj?.jobId ?? '').toLowerCase() === jid) { dir = v; break; }
    }
  }
  if (!dir || !fs.existsSync(dir)) return { dir, state: dir ? 'resume' : 'new', row, jobJson: null };
  const jobJson = readJsonMaybe(path.join(dir, 'job.json'));
  if (jobJson?.jobId && String(jobJson.jobId).toLowerCase() !== jid) {
    throw new GenError(`${info.ref}: ${rel(dir)} belongs to job ${jobJson.jobId}, but the manifest row ${row?.id} points this job there; fix the manifest or move the folder`, 7);
  }
  const raw = path.join(dir, 'raw.png');
  return { dir, state: fs.existsSync(raw) ? 'present' : 'resume', row, jobJson };
}

const expectedSha = (info, loc) => info.job.sha256 ?? loc.row?.sha256 ?? loc.jobJson?.download?.sha256 ?? null;

function buildRow(info, dir, meta, date, ctx) {
  const { batch, job, gate: g } = info;
  const upstream = MCP_MODELS[info.requestModel]?.upstream ?? info.requestModel;
  const notes = [
    `upstream: ${upstream}; MCP request model ${info.requestModel}${info.rowModelKnown ? '' : ' (reported id unknown: re-record with jobs_wait JSON)'}`,
    `ledger ${rel(ctx.ledger)} batch ${batch.id} job ${job.name}`,
    `${meta.width}x${meta.height} (${job.resolution ?? '?'} ${job.aspect_ratio ?? '?'})`,
    `prompt ${info.prompt.source}`,
    meta.sizeNote ? `SIZE MISMATCH accepted: ${meta.sizeNote}` : null,
    `clearance ${g.clearance}: not shippable until the written Higgsfield clearance is filed`,
  ].filter(Boolean).join('; ');
  return makeRow({
    id: safeId(info.asset, 'raw', path.basename(dir)),
    path: rel(path.join(dir, 'raw.png')), stage: info.stage, route: 'higgsfield-mcp', shipped: false,
    vendor: 'Higgsfield', model: info.rowModel, version: `higgsfield-mcp/${info.requestModel}@${batch.date}`, seed: null,
    jobId: job.job_id, promptPath: rel(path.join(dir, 'prompt.txt')), promptHash: info.prompt.hash,
    template: job.template ? templatePath(job.template) : null, parents: [],
    refHashes: job.refHashes ?? (job.medias ?? []).map((m) => m.sha256).filter(Boolean),
    planTier: batch.planTier ?? null, tosVersion: g.tosVersion, licenseId: g.licenseId,
    cost: { amount: job.credits ?? 0, currency: 'credits', unit: 'Higgsfield credits', estimated: true },
    date, sha256: meta.sha256, notes,
  });
}

/** Make sure the sidecar row, the manifest row and the ledger facts exist; write only what is missing. */
function ensureRecorded(info, dir, meta, ctx) {
  const sidecar = path.join(dir, 'manifest.json');
  const rowId = safeId(info.asset, 'raw', path.basename(dir));
  const sideRow = readJsonMaybe(sidecar)?.rows?.find((r) => r.id === rowId) ?? null;
  if (sideRow && sideRow.sha256 !== meta.sha256) {
    throw new GenError(`${info.ref}: ${rel(sidecar)} records sha256 ${sideRow.sha256.slice(0, 12)}… for ${rowId}, raw.png is ${meta.sha256.slice(0, 12)}…; nothing overwritten`, 7);
  }
  const row = sideRow ?? buildRow(info, dir, meta, meta.finishedAt ?? nowIso(), ctx);
  const inManifest = ctx.manifest === 'none' ? row : ctx.manifestRows.find((r) => r.id === row.id);
  if (inManifest && inManifest.sha256 !== row.sha256) {
    throw new GenError(`${info.ref}: ${rel(ctx.manifest)} already has row ${row.id} with a different sha256 (rows are immutable); move ${rel(dir)} aside or fix the manifest`, 7);
  }
  let added = 0;
  if (!sideRow || !inManifest) {
    try {
      added = record([row], { sidecar: sideRow ? null : sidecar, manifest: inManifest ? 'none' : ctx.manifest, generatedBy: TOOL });
    } catch (e) {
      throw new GenError(`${info.ref}: ${e.message}`, 7);
    }
    if (added) ctx.manifestRows.push(row);
  }
  // ledger facts about the paid output (container-independent; later downloads must match)
  if (!info.job.sha256 || !info.job.width || !info.job.height || !info.job.bytes) {
    const { changed } = updateLedger(ctx.ledger, (doc) => {
      const hit = findJob(doc, info.job.job_id);
      if (!hit) throw new GenError(`${info.ref}: job vanished from the ledger while ingesting`);
      const j = hit.job;
      if (j.sha256 && j.sha256 !== meta.sha256) throw new GenError(`${info.ref}: ledger sha256 changed while ingesting`, 7);
      Object.assign(j, { sha256: meta.sha256, width: meta.width, height: meta.height, bytes: meta.bytes });
    });
    if (changed) Object.assign(info.job, { sha256: meta.sha256, width: meta.width, height: meta.height, bytes: meta.bytes });
  }
  return { row, added };
}

/** Next free art/_raw/<asset>/vNN, claimed atomically (mkdir without recursive). */
function allocateDir(root, asset) {
  const adir = path.join(root, asset);
  fs.mkdirSync(adir, { recursive: true });
  for (;;) {
    const vers = versionDirs(adir);
    const n = vers.length ? Number(path.basename(vers[vers.length - 1]).slice(1)) + 1 : 1;
    const dir = path.join(adir, `v${String(n).padStart(2, '0')}`);
    try { fs.mkdirSync(dir); return dir; } catch (e) { if (e.code !== 'EEXIST') throw e; }
  }
}

function writeOnce(p, content, what) {
  if (fs.existsSync(p)) {
    if (fs.readFileSync(p, 'utf8') !== content) throw new GenError(`${rel(p)} already exists with different content (${what}); nothing overwritten: move it aside and re-run`, 7);
    return false;
  }
  fs.writeFileSync(p, content);
  return true;
}

function acquireRunLock(root) {
  fs.mkdirSync(root, { recursive: true });
  const lock = path.join(root, '.hf-ingest.lock');
  for (let i = 0; i < 2; i++) {
    try {
      fs.writeFileSync(lock, String(process.pid), { flag: 'wx' });
      return () => fs.rmSync(lock, { force: true });
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const pid = Number(fs.readFileSync(lock, 'utf8'));
      let alive = false;
      try { if (pid) { process.kill(pid, 0); alive = true; } } catch (err) { alive = err.code === 'EPERM'; }
      if (alive) throw new GenError(`another hf-ingest (pid ${pid}) is running (${rel(lock)}); wait for it or delete the lock if it is stale`);
      fs.rmSync(lock, { force: true });
    }
  }
  throw new GenError(`could not take ${rel(lock)}`);
}

// ------------------------------------------------------------------ ingest

function runContext(a) {
  const manifest = a.manifest ?? MANIFEST;
  const noManifest = String(manifest).toLowerCase() === 'none';
  const rows = !noManifest && fs.existsSync(manifest) ? readManifest(manifest).rows : [];
  const rowsByJob = new Map();
  for (const r of rows) {
    if (r.route === 'higgsfield-mcp' && r.jobId && /(^|\/)raw\.png$/.test(r.path)) rowsByJob.set(String(r.jobId).toLowerCase(), r);
  }
  return {
    ledger: path.resolve(a.ledger ?? LEDGER), promptsDir: path.resolve(a['prompts-dir'] ?? LEDGER_PROMPTS),
    root: a['out-root'] ? path.resolve(a['out-root']) : RAW_ROOT, manifest: noManifest ? 'none' : manifest,
    manifestRows: rows, rowsByJob, allowHosts: (a['allow-host'] ?? []).map((h) => h.toLowerCase()),
    timeoutS: a['timeout-s'], retries: a.retries,
  };
}

async function ingestOne(info, ctx, a) {
  const loc = locate(info, ctx);
  const want = expectedSha(info, loc);
  if (loc.state === 'present') {
    const raw = path.join(loc.dir, 'raw.png');
    const sha = sha256File(raw);
    if (want && sha !== want) {
      throw new GenError(`${info.ref}: ${rel(raw)} (sha256 ${sha.slice(0, 12)}…) differs from the recorded sha256 ${want.slice(0, 12)}… `
        + '(ledger/manifest): it was modified or replaced. Nothing was overwritten; move it aside to re-download.', 7);
    }
    if (a['dry-run']) return { kind: 'present', dir: loc.dir };
    const buf = fs.readFileSync(raw);
    let png;
    try { png = inspectPng(buf); } catch (e) { throw new GenError(`${info.ref}: ${rel(raw)} is not a valid PNG (${e.message}); nothing overwritten: move it aside to re-download`, 7); }
    const meta = { sha256: sha, width: png.width, height: png.height, bytes: buf.length, finishedAt: loc.jobJson?.download?.finishedAt };
    const { row, added } = ensureRecorded(info, loc.dir, meta, ctx);
    return { kind: 'present', dir: loc.dir, rowId: row.id, added };
  }
  if (loc.dir) {
    const pp = path.join(loc.dir, 'prompt.txt');
    if (fs.existsSync(pp) && fs.readFileSync(pp, 'utf8') !== info.prompt.text) {
      throw new GenError(`${rel(pp)} differs from the paid prompt of ${info.ref}; nothing overwritten: move the folder aside`, 7);
    }
  }
  if (a['dry-run']) return { kind: 'would-download', dir: loc.dir, url: info.job.result_url };

  const incoming = path.join(ctx.root, '.incoming');
  const part = path.join(incoming, `${info.job.job_id.toLowerCase()}.part`);
  const rejected = path.join(incoming, `${info.job.job_id.toLowerCase()}.rejected`);
  const startedAt = nowIso();
  const had = fileSize(part);
  if (had) log(`  resuming ${info.ref} from byte ${had}`);
  const dl = await download(info.job.result_url, part, { allowHosts: ctx.allowHosts, timeoutS: ctx.timeoutS, retries: ctx.retries, jobRef: info.ref });
  const buf = fs.readFileSync(part);
  let png;
  try {
    png = inspectPng(buf);
  } catch (e) {
    fs.renameSync(part, rejected);
    throw new GenError(`${info.ref}: the download is not a valid PNG (${e.message}); kept it as ${rel(rejected)} for inspection. Re-run to retry.`, 7);
  }
  const sha = sha256File(part);
  let sizeNote = null;
  const probs = sizeProblems(png.width, png.height, info.job);
  if (probs.length) {
    if (!a['allow-size-mismatch']) {
      fs.renameSync(part, rejected);
      throw new GenError(`${info.ref}: unexpected image size: ${probs.join('; ')}. Kept it as ${rel(rejected)}; `
        + 'pass --allow-size-mismatch to accept it (noted in the row).', 7);
    }
    sizeNote = probs.join('; ');
    log(`  warning: ${info.ref}: ${sizeNote} (accepted by --allow-size-mismatch)`);
  }
  if (want && sha !== want) {
    fs.renameSync(part, rejected);
    throw new GenError(`${info.ref}: downloaded sha256 ${sha.slice(0, 12)}… differs from the recorded ${want.slice(0, 12)}… (ledger/manifest). `
      + `The CDN served a different file; kept it as ${rel(rejected)}, nothing overwritten.`, 7);
  }
  const dir = loc.dir ?? allocateDir(ctx.root, info.asset);
  fs.mkdirSync(dir, { recursive: true });
  writeOnce(path.join(dir, 'prompt.txt'), info.prompt.text, 'prompt');
  const raw = path.join(dir, 'raw.png');
  if (fs.existsSync(raw)) throw new GenError(`${rel(raw)} appeared while downloading; nothing overwritten`, 7);
  fs.renameSync(part, raw);
  fs.rmSync(rejected, { force: true });
  const meta = { sha256: sha, width: png.width, height: png.height, bytes: buf.length, finishedAt: nowIso(), sizeNote };
  const jobJson = {
    tool: TOOL, route: 'higgsfield-mcp', jobId: info.job.job_id, ledger: rel(ctx.ledger),
    batch: { id: info.batch.id, date: info.batch.date, purpose: info.batch.purpose ?? null, model: info.batch.model, planTier: info.batch.planTier ?? null },
    job: info.job, asset: info.asset, stage: info.stage, requestModel: info.requestModel, reportedModel: info.rowModel,
    prompt: { path: 'prompt.txt', sha256: info.prompt.hash, source: info.prompt.source, template: info.job.template ?? null, vars: info.job.vars ?? null },
    download: { url: info.job.result_url, startedAt, finishedAt: meta.finishedAt, resumedFrom: dl.resumedFrom, httpStatus: dl.status, contentType: dl.contentType, bytes: meta.bytes, sha256: sha, width: png.width, height: png.height, sizeNote },
  };
  fs.writeFileSync(path.join(dir, 'job.json'), `${JSON.stringify(jobJson, null, 2)}\n`);
  const { row, added } = ensureRecorded(info, dir, meta, ctx);
  return { kind: 'downloaded', dir, rowId: row.id, added, sha256: sha, width: png.width, height: png.height, resumedFrom: dl.resumedFrom };
}

async function cmdIngest(a) {
  const ctx = runContext(a);
  const doc = checkedLedger(ctx.ledger);
  const summary = { ledger: rel(ctx.ledger), downloaded: [], present: [], wouldDownload: [], skipped: [], errors: [], manifestRowsAdded: 0 };
  const warned = new Set();
  const blockedHosts = new Map();
  let release = null;
  const codes = [];
  try {
    for (const { batch, job } of selectJobs(doc, a)) {
      const ref = `${batch.id}/${job.name}`;
      if (!isCompleted(job.status)) {
        summary.skipped.push({ job: ref, status: job.status, reason: isFailed(job.status) ? 'failed job (nothing to download)' : 'not finished: run jobs_wait, then record' });
        continue;
      }
      try {
        if (!job.result_url) throw new GenError(`${ref}: completed but no result_url; refresh with jobs_wait and 'pnpm gen:hf-ingest record --from wait.json'`, 2);
        const info = resolveJob(batch, job, ctx);
        for (const w of [...info.gate.warnings, info.prompt.warning].filter(Boolean)) if (!warned.has(w)) { warned.add(w); log(`warning: ${w}`); }
        let host = null;
        try { host = new URL(job.result_url).hostname; } catch { /* checkUrl reports it */ }
        if (host && blockedHosts.has(host)) {
          summary.errors.push({ job: ref, code: 6, error: `skipped: ${host} is blocked by the egress policy (see above)` });
          continue;
        }
        if (!a['dry-run'] && !release) release = acquireRunLock(ctx.root);
        const res = await ingestOne(info, ctx, a);
        summary.manifestRowsAdded += res.added ?? 0;
        const entry = { job: ref, asset: info.asset, dir: res.dir ? rel(res.dir) : `${rel(path.join(ctx.root, info.asset))}/v?? (new)`, rowId: res.rowId, stage: info.stage };
        if (res.kind === 'downloaded') {
          summary.downloaded.push({ ...entry, sha256: res.sha256, size: `${res.width}x${res.height}`, resumedFrom: res.resumedFrom || undefined });
          log(`downloaded ${ref} -> ${entry.dir}/raw.png (${res.width}x${res.height}, row ${res.rowId})`);
        } else if (res.kind === 'present') {
          summary.present.push(entry);
          if (res.added) log(`repaired ${ref}: manifest row ${res.rowId} re-added`);
        } else {
          summary.wouldDownload.push({ ...entry, url: res.url, prompt: info.prompt.source, model: info.rowModel });
        }
      } catch (e) {
        if (!(e instanceof GenError)) throw e;
        if (e instanceof EgressBlocked) {
          if (!blockedHosts.has(e.host)) log(`error: ${e.message}`);
          blockedHosts.set(e.host, e.message);
        } else {
          log(`error: ${e.message}`);
        }
        codes.push(e.code);
        summary.errors.push({ job: ref, code: e.code, error: e instanceof EgressBlocked ? `egress policy blocks ${e.host}` : e.message });
      }
    }
  } finally {
    release?.();
  }
  if (blockedHosts.size) summary.egressBlocked = [...blockedHosts.keys()];
  console.log(JSON.stringify(summary, null, 2));
  log(`hf-ingest: ${summary.downloaded.length} downloaded, ${summary.present.length} already local, `
    + `${a['dry-run'] ? `${summary.wouldDownload.length} to download (dry run), ` : ''}${summary.skipped.length} not completed, ${summary.errors.length} error(s)`);
  if (!codes.length) return 0;
  for (const c of [3, 2, 7, 6]) if (codes.includes(c)) return c;
  return codes[0];
}

// ------------------------------------------------------------------ status / check

function jobState(batch, job, ctx) {
  const s = { job: job.name, job_id: job.job_id, status: job.status, credits: job.credits ?? null, resolution: job.resolution ?? null, aspect_ratio: job.aspect_ratio ?? null };
  try {
    const asset = assetFor(job);
    Object.assign(s, { asset, stage: stageFor(job, asset) });
    const loc = locate({ job, asset, ref: `${batch.id}/${job.name}` }, ctx);
    const want = job.sha256 ?? loc.row?.sha256 ?? loc.jobJson?.download?.sha256 ?? null;
    if (loc.state === 'present') {
      const sha = sha256File(path.join(loc.dir, 'raw.png'));
      s.downloaded = !want || sha === want ? 'yes' : 'CONFLICT';
      s.path = rel(path.join(loc.dir, 'raw.png'));
      s.rowId = safeId(asset, 'raw', path.basename(loc.dir));
    } else {
      s.downloaded = 'no';
      const part = fileSize(path.join(ctx.root, '.incoming', `${job.job_id.toLowerCase()}.part`));
      if (part) s.partialBytes = part;
      if (loc.dir) s.path = rel(path.join(loc.dir, 'raw.png'));
    }
  } catch (e) {
    s.downloaded = 'error';
    s.error = e.message;
  }
  return s;
}

function cmdStatus(a) {
  const ctx = runContext(a);
  const doc = checkedLedger(ctx.ledger, { allowMissing: true });
  const sel = selectJobs(doc, a);
  const byBatch = new Map();
  for (const { batch, job } of sel) (byBatch.get(batch) ?? byBatch.set(batch, []).get(batch)).push(jobState(batch, job, ctx));
  const out = { ledger: rel(ctx.ledger), batches: [], totals: { jobs: 0, completed: 0, failed: 0, pending: 0, creditsSpent: 0, creditsOnFailed: 0, creditsUnknown: 0, downloaded: 0 } };
  for (const [batch, jobs] of byBatch) {
    const c = { jobs: jobs.length, completed: 0, failed: 0, pending: 0, creditsSpent: 0, creditsOnFailed: 0, creditsUnknown: 0, downloaded: 0 };
    for (const j of jobs) {
      if (isCompleted(j.status)) c.completed++; else if (isFailed(j.status)) c.failed++; else c.pending++;
      if (j.credits == null) c.creditsUnknown++;
      else if (isFailed(j.status)) c.creditsOnFailed += j.credits;
      else c.creditsSpent += j.credits;
      if (j.downloaded === 'yes') c.downloaded++;
    }
    out.batches.push({ id: batch.id, date: batch.date, model: batch.model, planTier: batch.planTier ?? null, purpose: batch.purpose ?? null, counts: c, jobs });
    for (const k of Object.keys(out.totals)) out.totals[k] += c[k];
  }
  if (a.json) { console.log(JSON.stringify(out, null, 2)); return 0; }
  const pad = (s, n) => String(s ?? '').padEnd(n);
  const lines = [`Higgsfield MCP ledger ${out.ledger}: ${out.batches.length} batch(es), ${out.totals.jobs} job(s)`];
  for (const b of out.batches) {
    const c = b.counts;
    lines.push('', `batch ${b.id}  ${b.date}  ${b.model}${b.planTier ? `  ${b.planTier}` : ''}${b.purpose ? `  - ${b.purpose}` : ''}`);
    lines.push(`  ${c.jobs} jobs: ${c.completed} completed, ${c.pending} pending, ${c.failed} failed | credits spent ${c.creditsSpent}`
      + `${c.creditsOnFailed ? ` (+${c.creditsOnFailed} on failed jobs)` : ''}${c.creditsUnknown ? ` (+${c.creditsUnknown} job(s) of unknown cost)` : ''} | downloaded ${c.downloaded}/${c.completed}`);
    lines.push(`  ${pad('NAME', 24)}${pad('STATUS', 11)}${pad('RES', 5)}${pad('AR', 6)}${pad('CR', 5)}${pad('LOCAL', 9)}WHERE`);
    for (const j of b.jobs) {
      const where = j.error ? `error: ${j.error.split('\n')[0]}` : j.path ? `${j.path}${j.rowId ? ` (row ${j.rowId})` : ''}` : `art/_raw/${j.asset}/v?? (${j.stage})${j.partialBytes ? `, ${j.partialBytes} bytes in .incoming` : ''}`;
      lines.push(`  ${pad(j.job, 24)}${pad(j.status, 11)}${pad(j.resolution, 5)}${pad(j.aspect_ratio, 6)}${pad(j.credits ?? '?', 5)}${pad(j.downloaded, 9)}${where}`);
    }
  }
  const t = out.totals;
  lines.push('', `total: ${t.creditsSpent} credits spent${t.creditsOnFailed ? ` (+${t.creditsOnFailed} on failed jobs)` : ''} in ${out.batches.length} batch(es); downloaded ${t.downloaded}/${t.completed} completed job(s)`);
  console.log(lines.join('\n'));
  return 0;
}

function cmdCheck(a) {
  const ctx = runContext(a);
  const doc = checkedLedger(ctx.ledger);
  let bad = 0;
  let refused = 0;
  let stored = 0;
  for (const { batch, job } of selectJobs(doc, a)) {
    const ref = `${batch.id}/${job.name}`;
    try {
      const info = resolveJob(batch, job, ctx);
      if (a['store-prompts'] && !fs.existsSync(promptFile(info.prompt.hash, ctx.promptsDir))) { storePrompt(info.prompt.text, ctx.promptsDir); stored++; }
      const inferred = !job.vars && job.template && jobContext(job).inferred ? ' (vars inferred from the name)' : '';
      console.log(`ok     ${ref}: prompt ${info.prompt.source}${inferred}, asset ${info.asset}, stage ${info.stage}, model ${info.requestModel} -> ${info.rowModel}${info.prompt.warning ? `\n       warning: ${info.prompt.warning}` : ''}`);
    } catch (e) {
      if (!(e instanceof GenError)) throw e;
      if (e.code === 3) refused++; else bad++;
      console.log(`FAIL   ${ref}: ${e.message}`);
    }
  }
  if (stored) console.log(`stored ${stored} prompt(s) in ${rel(ctx.promptsDir)}`);
  return refused ? 3 : bad ? 2 : 0;
}

// ------------------------------------------------------------------ plan / record

const today = () => nowIso().slice(0, 10);
const readJsonArg = (p) => {
  const text = p === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(p, 'utf8');
  try { return JSON.parse(text); } catch (e) { throw new GenError(`${p}: not JSON (${e.message})`); }
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** MCP medias[].value must be a media_id / job_id (UUID); placeholders would fail at the MCP or pick the wrong image. */
function checkMedias(medias, where) {
  for (const m of medias ?? []) {
    if (!m || !UUID.test(String(m.value ?? '')) || !m.role) throw new GenError(`${where}: medias entry ${JSON.stringify(m)} needs {value: <media_id or job_id UUID>, role}`);
  }
}

function cmdPlan(a) {
  if (!a.spec) throw new GenError('plan needs --spec FILE (see --help / README)');
  const spec = readJsonArg(a.spec);
  for (const k of ['batch', 'model', 'jobs']) if (!spec[k]) throw new GenError(`spec: '${k}' is required`);
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(spec.batch)) throw new GenError(`spec: bad batch id ${spec.batch}`);
  const ledgerPath = path.resolve(a.ledger ?? LEDGER);
  const doc = checkedLedger(ledgerPath, { allowMissing: true });
  const existing = doc.batches.find((b) => b.id === spec.batch);
  const used = new Set((existing?.jobs ?? []).map((j) => j.name));
  const warnings = new Set();
  const jobs = spec.jobs.map((j, i) => {
    if (!j.name || !j.template) throw new GenError(`spec.jobs[${i}]: 'name' and 'template' are required (prompts are rendered, never typed)`);
    if (used.has(j.name)) throw new GenError(`spec.jobs[${i}]: job name ${j.name} already used in batch ${spec.batch}`);
    used.add(j.name);
    const model = j.request_model ?? spec.model;
    for (const w of gate('higgsfield-mcp', model).warnings) warnings.add(w);
    const ctx = jobContext({ name: j.name, template: j.template, vars: j.vars ?? {} });
    const r = render(j.template, buildValues(j.template, { symbol: ctx.symbol, mascot: ctx.mascot, rigReady: ctx.rigReady, overrides: ctx.overrides }));
    const resolution = j.resolution ?? spec.resolution ?? '2k';
    const aspect = j.aspect_ratio ?? spec.aspect_ratio ?? '1:1';
    if (!/^\d+:\d+$/.test(aspect)) throw new GenError(`spec.jobs[${i}]: bad aspect_ratio ${aspect}`);
    const out = {
      index: j.index ?? i, name: j.name, template: j.template, vars: j.vars ?? {}, promptHash: r.hash, prompt: r.text,
      resolution, aspect_ratio: aspect, credits: j.credits ?? estimateCredits(model, resolution),
    };
    if (j.request_model) out.request_model = j.request_model;
    for (const k of ['medias', 'refHashes', 'asset', 'stage']) if (j[k] !== undefined) out[k] = j[k];
    checkMedias(out.medias, `spec.jobs[${i}] (${j.name})`);
    return out;
  });
  const idx = new Set();
  for (const j of jobs) { if (idx.has(j.index)) throw new GenError(`spec: duplicate index ${j.index}`); idx.add(j.index); }
  const unknown = jobs.filter((j) => j.credits == null).map((j) => j.name);
  const total = unknown.length ? null : jobs.reduce((s, j) => s + j.credits, 0);
  if (a['max-credits'] !== undefined) {
    if (total === null) throw new GenError(`--max-credits ${a['max-credits']}: no credit estimate for ${unknown.join(', ')} (set 'credits' in the spec)`, 4);
    if (total > a['max-credits']) throw new GenError(`estimated ${total} credits exceeds --max-credits ${a['max-credits']}`, 4);
  }
  const plan = {
    planVersion: 1, tool: TOOL, ledger: rel(ledgerPath),
    batch: { id: spec.batch, date: spec.date ?? today(), purpose: spec.purpose ?? '', model: spec.model, planTier: spec.planTier ?? null },
    jobs,
  };
  const out = path.resolve(a.out ?? path.join(REPO, 'art', '_work', 'hf-plans', `${spec.batch}.plan.json`));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(plan, null, 2)}\n`);
  const calls = [];
  for (let i = 0; i < jobs.length; i += 12) {
    calls.push({
      requests: jobs.slice(i, i + 12).map((j) => ({
        index: j.index,
        params: {
          model: j.request_model ?? spec.model, prompt: j.prompt, aspect_ratio: j.aspect_ratio, resolution: j.resolution,
          ...(j.medias?.length ? { medias: j.medias.map((m) => ({ value: m.value, role: m.role })) } : {}),
        },
      })),
    });
  }
  for (const w of warnings) log(`warning: ${w}`);
  log(`plan ${rel(out)}: ${jobs.length} job(s), estimated ${total ?? '?'} credits. Next: pass each calls[i] to generate_image_batch, save its JSON, then\n`
    + `  pnpm gen:hf-ingest record --plan ${rel(out)} --from <saved.json>   (again with the jobs_wait JSON once finished), then pnpm gen:hf-ingest`);
  console.log(JSON.stringify({ tool: 'generate_image_batch', plan: rel(out), estimatedCredits: total, calls }, null, 2));
  return 0;
}

/** Plan-shaped entries from a raw generate_image_batch request (stored prompts, no template). */
function planFromRequest(a) {
  if (!a.batch.length) throw new GenError('record --request needs --batch ID');
  const req = readJsonArg(a.request);
  const reqs = req.requests ?? req.calls?.flatMap((c) => c.requests) ?? (Array.isArray(req) ? req : null);
  if (!Array.isArray(reqs)) throw new GenError(`${a.request}: expected {"requests":[{index, params:{model, prompt, ...}}]}`);
  const names = Object.fromEntries((a.name ?? []).map((s) => {
    const m = /^(\d+)=([A-Za-z0-9][A-Za-z0-9_.-]*)$/.exec(s);
    if (!m) throw new GenError(`--name expects INDEX=NAME, got ${s}`);
    return [m[1], m[2]];
  }));
  const models = new Set(reqs.map((r) => r.params?.model));
  if (models.size !== 1) throw new GenError(`${a.request}: one model per recorded batch (got ${[...models].join(', ')})`);
  const [model] = models;
  return {
    batch: { id: a.batch[0], date: a.date ?? today(), purpose: a.purpose ?? '', model, planTier: a['plan-tier'] ?? null },
    jobs: reqs.map((r, i) => {
      const p = r.params ?? {};
      if (typeof p.prompt !== 'string' || !p.prompt) throw new GenError(`${a.request}: requests[${i}] has no params.prompt`);
      const index = Number.isInteger(r.index) ? r.index : i;
      const resolution = p.resolution ?? '2k';
      const name = names[index] ?? r.name ?? `${a.batch[0]}_${index}`;
      if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(name)) throw new GenError(`${a.request}: requests[${i}] name ${JSON.stringify(name)} must match [A-Za-z0-9][A-Za-z0-9_.-]*`);
      const medias = p.medias?.length ? p.medias.map((m) => ({ value: m.value, role: m.role })) : null;
      checkMedias(medias, `${a.request}: requests[${i}]`);
      return {
        index, name, template: r.template ?? null, ...(r.template ? { vars: r.vars ?? {} } : {}), promptHash: sha256Text(p.prompt), prompt: p.prompt,
        resolution, aspect_ratio: p.aspect_ratio ?? '1:1', credits: r.credits ?? estimateCredits(model, resolution),
        ...(medias ? { medias } : {}), ...(r.asset ? { asset: r.asset } : {}), ...(r.stage ? { stage: r.stage } : {}),
      };
    }),
  };
}

function cmdRecord(a) {
  if (!a.from.length) throw new GenError('record needs --from FILE (generate_image_batch or jobs_wait JSON; - for stdin)');
  if (a.plan && a.request) throw new GenError('use --plan or --request, not both');
  const ledgerPath = path.resolve(a.ledger ?? LEDGER);
  const promptsDir = path.resolve(a['prompts-dir'] ?? LEDGER_PROMPTS);
  const plan = a.plan ? readJsonArg(a.plan) : a.request ? planFromRequest(a) : null;
  if (plan) {
    for (const k of ['batch', 'jobs']) if (!plan[k]) throw new GenError(`${a.plan}: not a plan file ('${k}' missing)`);
    if (a.batch.length && a.batch[0] !== plan.batch.id) throw new GenError(`--batch ${a.batch[0]} differs from the plan's batch ${plan.batch.id}`);
    gate('higgsfield-mcp', plan.batch.model);
    for (const j of plan.jobs) {
      if (j.request_model) gate('higgsfield-mcp', j.request_model);
      if (sha256Text(j.prompt) !== j.promptHash) throw new GenError(`plan job ${j.name}: prompt text does not hash to promptHash (edited plan?)`);
    }
  }
  const incoming = a.from.flatMap((f) => parseMcpJobs(readJsonArg(f)));
  for (const x of incoming) if (x.model) gate('higgsfield-mcp', x.model);
  const report = { added: [], updated: [], unchanged: [], notSubmitted: [] };
  const { changed } = updateLedger(ledgerPath, (doc) => {
    let batch = plan ? doc.batches.find((b) => b.id === plan.batch.id) : null;
    for (const x of incoming) {
      if (!x.job_id) {
        report.notSubmitted.push({ index: x.index, error: x.error ?? 'no job_id' });
        continue;
      }
      const hit = findJob(doc, x.job_id);
      if (hit) {
        const j = hit.job;
        const before = JSON.stringify(j);
        // never downgrade a terminal status; refresh URLs; fill reported model/type once
        if (x.status && (!isTerminal(j.status) || (isTerminal(x.status) && !isCompleted(j.status)))) j.status = x.status;
        if (x.result_url && x.result_url !== j.result_url) j.result_url = x.result_url;
        if (x.model && !j.model) j.model = x.model;
        if (x.type && !j.type) j.type = x.type;
        (JSON.stringify(j) === before ? report.unchanged : report.updated).push(`${hit.batch.id}/${j.name}`);
        continue;
      }
      const pj = plan?.jobs.find((j) => j.index === x.index);
      if (!pj) throw new GenError(`job ${x.job_id} (index ${x.index}) is not in the ledger and not in ${plan ? 'the plan' : 'any --plan/--request'}: pass the plan (or request) it was submitted from`);
      if (!batch) {
        batch = { ...plan.batch, jobs: [] };
        if (a['plan-tier'] && !batch.planTier) batch.planTier = a['plan-tier'];
        doc.batches.push(batch);
      }
      storePrompt(pj.prompt, promptsDir);
      const reqModel = pj.request_model ?? (plan.batch.model !== batch.model ? plan.batch.model : null);
      const job = {
        name: pj.name, index: pj.index, job_id: x.job_id, status: x.status ?? 'submitted',
        ...(x.type ? { type: x.type } : {}), ...(x.model ? { model: x.model } : {}),
        ...(reqModel ? { request_model: reqModel } : {}),
        template: pj.template ?? null, ...(pj.template ? { vars: pj.vars ?? {} } : {}), promptHash: pj.promptHash,
        resolution: pj.resolution, aspect_ratio: pj.aspect_ratio, credits: a.credits ?? pj.credits ?? null, result_url: x.result_url ?? null,
      };
      for (const k of ['medias', 'refHashes', 'asset', 'stage']) if (pj[k] !== undefined) job[k] = pj[k];
      if (job.credits == null) log(`warning: ${batch.id}/${job.name}: credit cost unknown (pass --credits N, or check the MCP 'transactions')`);
      batch.jobs.push(job);
      report.added.push(`${batch.id}/${job.name}`);
    }
  });
  for (const n of report.notSubmitted) log(`not submitted (no charge): index ${n.index}: ${n.error}`);
  console.log(JSON.stringify({ ledger: rel(ledgerPath), changed, ...report }, null, 2));
  return 0;
}

// ------------------------------------------------------------------ main

const COMMANDS = { ingest: cmdIngest, status: cmdStatus, check: cmdCheck, plan: cmdPlan, record: cmdRecord };

async function main(argv) {
  const a = parseArgs(argv, SPEC);
  if (a.help) { console.log(HELP); return 0; }
  const [cmd = 'ingest', ...extra] = a._;
  if (!COMMANDS[cmd]) throw new GenError(`unknown subcommand ${cmd} (ingest, status, check, plan, record)`);
  if (extra.length) throw new GenError(`unexpected argument(s): ${extra.join(' ')}`);
  if (!Number.isInteger(a.retries) || a.retries < 1) throw new GenError('--retries must be an integer >= 1');
  return COMMANDS[cmd](a);
}

if (isMain(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (e) => {
    console.error(`error: ${e.message}`);
    process.exit(e instanceof GenError ? e.code : 1);
  });
}

