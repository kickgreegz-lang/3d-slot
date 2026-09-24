#!/usr/bin/env node
// Higgsfield generation wrapper around the official CLI (@higgsfield/cli, `higgsfield`).
// Renders the prompt from art/bible, licence-gates the model, previews cost, runs
// `higgsfield generate create <model> ... --wait --json`, downloads the result into
// art/_raw/<asset>/vNN/ and appends a provenance row to art/manifest.json.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GenError, RAW_ROOT, allocate, buildValues, defaultAsset, fingerprint, gate, parseArgs, parseVars, render,
  splitTemplateRef, templatePath,
} from './lib/genlib.mjs';
import { MANIFEST, REPO, isMain, makeRow, nowIso, record, rel, safeId, sha256File } from './lib/provenance.mjs';

const TOOL = 'tools/gen/higgsfield.mjs';

const HELP = `Usage: node ${TOOL} --template <file.txt[#X]> [asset options] [model options] [--dry-run]

Prompt (rendered from art/bible/prompts + artbible.json; never hand-written):
  --template T          e.g. symbol.txt, mascot_expressions.txt#D, video_loop.txt
  --symbol ID           symbol context (H1..H4, L1..L5, W, S)     --rig-ready   rig-ready master line
  --mascot ID           mascot context (gumbo, croak)
  --var NAME=value      fill/override a placeholder (repeatable)
Model (CLI ids; nano_banana_2 IS Nano Banana Pro):
  --model ID            default nano_banana_2. Known: ${'${MODELS}'}
  --image PATH          reference image (repeatable; copied to refs/ and hashed)
  --start-image PATH / --end-image PATH   video key poses (aspect must equal --aspect-ratio)
  --aspect-ratio R      default 1:1 (always passed explicitly)
  --resolution R        image default 2k, video default 1080p (always passed where supported)
  --duration S          video seconds, default 5 (always passed)
  --mode M              seedance: std|fast, kling3_0: std|pro|4k (default pro)
Output / provenance:
  --asset NAME          raw folder name (default derived, e.g. sym_H1, sym_H1_rig)
  --out-root DIR        default art/_raw          --manifest FILE   default art/manifest.json ('none' to skip)
  --stage S             manifest stage (default 2d-image for images, video for videos)
  --plan-tier S         e.g. "Higgsfield Ultra"   --max-credits N   abort if the cost preview is higher
  --force-new           new vNN even when the identical request already produced output
  --no-cost-preview     skip 'higgsfield generate cost'
  --bin PATH            higgsfield executable (default: $HIGGSFIELD_BIN or 'higgsfield'); result URLs must be
                        http(s) (file:// only with HIGGSFIELD_ALLOW_FILE_URLS=1, for the offline test double)
  --snapshot-models     save 'higgsfield model list --json' to art/_raw/_meta/higgsfield-models-<date>.json and exit
  --dry-run             print the exact CLI calls, target folder and gate result; write nothing
Exit codes: 0 ok/skipped, 2 usage, 3 licence refusal, 4 cost cap, 5 vendor failure, 6 download failure.`;

// Flag schemas from the CLI's MODELS.md (higgsfield model get <id> --json). Audio is ALWAYS off.
const MODELS = {
  nano_banana_2: { kind: 'image', maxRefs: 14, aspect: ['1:1', '3:2', '2:3', '4:3', '3:4', '4:5', '5:4', '9:16', '16:9', '21:9'], resolution: ['1k', '2k', '4k'], upstream: 'Google Nano Banana Pro (gemini-3-pro-image)' },
  nano_banana_flash: { kind: 'image', maxRefs: 14, aspect: ['1:1', '3:2', '2:3', '4:3', '3:4', '4:5', '5:4', '9:16', '16:9', '21:9'], resolution: ['1k', '2k', '4k'], upstream: 'Google Nano Banana 2 (gemini-3.1-flash-image)' },
  nano_banana_2_lite: { kind: 'image', maxRefs: 14, aspect: ['1:1', '3:2', '2:3', '4:3', '3:4', '4:5', '5:4', '9:16', '16:9', '21:9'], resolution: ['1k'], upstream: 'Google Nano Banana 2 Lite' },
  seedance_2_0: { kind: 'video', maxRefs: 9, aspect: ['16:9', '9:16', '4:3', '3:4', '1:1', '21:9'], resolution: ['480p', '720p', '1080p', '4k'], modes: ['std', 'fast'], defaultMode: 'std', audio: ['--generate_audio', 'false'], upstream: 'ByteDance Seedance 2.0' },
  seedance_2_0_mini: { kind: 'video', maxRefs: 9, aspect: ['16:9', '9:16', '4:3', '3:4', '1:1', '21:9'], resolution: ['480p', '720p'], audio: ['--generate_audio', 'false'], upstream: 'ByteDance Seedance 2.0 Mini' },
  kling3_0: { kind: 'video', maxRefs: 0, aspect: ['16:9', '9:16', '1:1'], resolution: null, modes: ['std', 'pro', '4k'], defaultMode: 'pro', audio: ['--sound', 'off'], upstream: 'Kuaishou Kling 3.0' },
  kling3_0_turbo: { kind: 'video', maxRefs: 0, aspect: ['16:9', '9:16', '1:1'], resolution: ['720p', '1080p'], noEndImage: true, audio: null, upstream: 'Kuaishou Kling 3.0 Turbo (no audio option)' },
};

const SPEC = {
  help: { type: 'boolean', alias: 'h' },
  template: { type: 'string' }, symbol: { type: 'string' }, mascot: { type: 'string' }, 'rig-ready': { type: 'boolean' },
  var: { type: 'string', multi: true }, model: { type: 'string', default: 'nano_banana_2' },
  image: { type: 'string', multi: true }, 'start-image': { type: 'string' }, 'end-image': { type: 'string' },
  'aspect-ratio': { type: 'string', default: '1:1' }, resolution: { type: 'string' }, duration: { type: 'number' },
  mode: { type: 'string' }, asset: { type: 'string' }, 'out-root': { type: 'string' }, manifest: { type: 'string' },
  stage: { type: 'string' }, 'plan-tier': { type: 'string' }, 'max-credits': { type: 'number' }, 'force-new': { type: 'boolean' },
  'no-cost-preview': { type: 'boolean' }, bin: { type: 'string' }, 'snapshot-models': { type: 'boolean' }, 'dry-run': { type: 'boolean' },
};

const shq = (s) => (/^[A-Za-z0-9_./:=@%+-]+$/.test(s) ? s : `'${String(s).replace(/'/g, `'\\''`)}'`);

/** PNG/JPEG pixel size without dependencies (null when unknown). */
export function imageSize(file) {
  const b = fs.readFileSync(file);
  if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47) return [b.readUInt32BE(16), b.readUInt32BE(20)];
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      const len = b.readUInt16BE(i + 2);
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)];
      i += 2 + len;
    }
  }
  return null;
}

const ratio = (ar) => { const [w, h] = ar.split(':').map(Number); return w / h; };

function buildRequest(a) {
  const m = MODELS[a.model];
  if (!m) throw new GenError(`model ${a.model} has no flag schema here; check 'higgsfield model get ${a.model} --json' and add it to MODELS in ${TOOL}`);
  const flags = [];
  if (!m.aspect.includes(a['aspect-ratio'])) throw new GenError(`--aspect-ratio ${a['aspect-ratio']} not valid for ${a.model} (${m.aspect.join(', ')})`);
  flags.push('--aspect_ratio', a['aspect-ratio']);
  if (m.kind === 'image') {
    const res = a.resolution ?? (m.resolution.includes('2k') ? '2k' : m.resolution[0]);
    if (!m.resolution.includes(res)) throw new GenError(`--resolution ${res} not valid for ${a.model} (${m.resolution.join(', ')})`);
    flags.push('--resolution', res);
    if (a['start-image'] || a['end-image']) throw new GenError(`${a.model} is an image model: use --image for references`);
  } else {
    const dur = a.duration ?? 5;
    if (!Number.isInteger(dur) || dur < 1 || dur > 15) throw new GenError(`--duration must be an integer 1..15 s, got ${dur}`);
    flags.push('--duration', String(dur));
    if (m.resolution) {
      const res = a.resolution ?? (m.resolution.includes('1080p') ? '1080p' : m.resolution[m.resolution.length - 1]);
      if (!m.resolution.includes(res)) throw new GenError(`--resolution ${res} not valid for ${a.model} (${m.resolution.join(', ')})`);
      flags.push('--resolution', res);
    } else if (a.resolution) {
      throw new GenError(`${a.model} has no --resolution; use --mode ${m.modes.join('|')}`);
    }
    if (m.modes) {
      const mode = a.mode ?? m.defaultMode;
      if (!m.modes.includes(mode)) throw new GenError(`--mode ${mode} not valid for ${a.model} (${m.modes.join(', ')})`);
      if (a.model.startsWith('seedance') && mode === 'fast' && !['480p', '720p'].includes(flags[flags.indexOf('--resolution') + 1])) {
        throw new GenError('seedance mode fast supports only 480p/720p');
      }
      flags.push('--mode', mode);
    }
    if (m.audio) flags.push(...m.audio);
    if (a['end-image'] && m.noEndImage) throw new GenError(`${a.model} takes no --end-image`);
    for (const k of ['start-image', 'end-image']) {
      if (!a[k]) continue;
      const sz = imageSize(a[k]);
      if (sz && Math.abs(sz[0] / sz[1] - ratio(a['aspect-ratio'])) > 0.01) {
        throw new GenError(`--${k} is ${sz[0]}x${sz[1]} but --aspect-ratio is ${a['aspect-ratio']}: the key pose must match or the model reframes it`);
      }
    }
  }
  const nRefs = a.image.length + (a['start-image'] ? 1 : 0) + (a['end-image'] ? 1 : 0);
  if (a.image.length > 0 && m.maxRefs === 0) throw new GenError(`${a.model} takes no --image references`);
  if (nRefs > Math.max(m.maxRefs, 2)) throw new GenError(`${a.model}: at most ${m.maxRefs} reference images (got ${nRefs})`);
  for (const f of [...a.image, a['start-image'], a['end-image']].filter(Boolean)) {
    if (!fs.existsSync(f)) throw new GenError(`reference not found: ${f}`);
  }
  return { model: m, flags };
}

function runCli(bin, args, { allowFail = false } = {}) {
  const r = spawnSync(bin, args, { encoding: 'utf8', maxBuffer: 64 << 20 });
  if (r.error) throw new GenError(`cannot run ${bin}: ${r.error.message} (npm i -g @higgsfield/cli@1.1.26, then higgsfield auth login)`, 5);
  if (r.status !== 0 && !allowFail) throw new GenError(`${bin} ${args.slice(0, 3).join(' ')} failed (exit ${r.status}):\n${r.stderr || r.stdout}`, 5);
  return r;
}

const parseJsonOut = (s) => {
  const t = s.trim();
  try { return JSON.parse(t); } catch { /* fall through: last JSON line */ }
  for (const line of t.split('\n').reverse()) { try { return JSON.parse(line); } catch { /* next */ } }
  throw new GenError(`higgsfield did not print JSON:\n${t.slice(0, 2000)}`, 5);
};

/** Credits from a `generate cost --json` answer (field names differ across CLI versions). */
const creditsOf = (j) => {
  for (const k of ['credits', 'cost', 'total_credits', 'price', 'amount']) {
    const v = j?.[k] ?? j?.data?.[k];
    if (typeof v === 'number') return v;
    if (typeof v === 'string' && Number.isFinite(Number(v))) return Number(v);
  }
  return null;
};

/** Result URLs and job id from `generate create --wait --json` (single object or list). */
export function resultsOf(j) {
  const jobs = Array.isArray(j) ? j : [j];
  const urls = [];
  let jobId = null;
  for (const job of jobs) {
    jobId ??= job?.id ?? job?.job_id ?? job?.jobId ?? null;
    const status = String(job?.status ?? 'completed').toLowerCase();
    if (/fail|error|nsfw|cancel/.test(status)) throw new GenError(`job ${jobId} ended with status ${status}`, 5);
    for (const u of [job?.result_url, ...(job?.result_urls ?? []), ...(job?.results ?? []).map((r) => r?.url ?? r?.result_url ?? r)]) {
      if (typeof u === 'string' && u) urls.push(u);
    }
  }
  if (!urls.length) throw new GenError(`no result_url in higgsfield output: ${JSON.stringify(j).slice(0, 500)}`, 5);
  return { jobId, urls: [...new Set(urls)] };
}

const EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'video/mp4': '.mp4', 'video/webm': '.webm', 'audio/mpeg': '.mp3', 'audio/wav': '.wav' };

async function download(url, destNoExt) {
  let buf;
  let type = '';
  if (url.startsWith('file://')) {
    // only the offline test double answers with local files; a vendor response must not make the
    // wrapper copy arbitrary local files into art/_raw
    if (process.env.HIGGSFIELD_ALLOW_FILE_URLS !== '1') throw new GenError(`refusing non-HTTP result URL ${url}`, 6);
    const p = fileURLToPath(url);
    if (!fs.existsSync(p)) throw new GenError(`download failed for ${url}: no such file`, 6);
    buf = fs.readFileSync(p);
    type = Object.entries(EXT).find(([, e]) => p.toLowerCase().endsWith(e))?.[0] ?? '';
  } else {
    if (!/^https?:\/\//i.test(url)) throw new GenError(`refusing result URL ${url} (http/https only)`, 6);
    let last;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await fetch(url);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        buf = Buffer.from(await r.arrayBuffer());
        type = (r.headers.get('content-type') ?? '').split(';')[0].trim();
        break;
      } catch (e) { last = e; await new Promise((res) => setTimeout(res, 1000 * (attempt + 1))); }
    }
    if (!buf) throw new GenError(`download failed for ${url}: ${last?.message}`, 6);
  }
  if (!buf.length) throw new GenError(`empty download: ${url}`, 6);
  const ext = EXT[type] ?? (path.extname(new URL(url).pathname) || '.bin');
  const out = `${destNoExt}${ext}`;
  fs.writeFileSync(out, buf);
  return out;
}

async function main(argv) {
  const a = parseArgs(argv, SPEC);
  if (a.help) { console.log(HELP.replace('${MODELS}', Object.keys(MODELS).join(', '))); return 0; }
  const bin = a.bin ?? process.env.HIGGSFIELD_BIN ?? 'higgsfield';
  if (a['snapshot-models']) {
    const r = runCli(bin, ['model', 'list', '--json']);
    const out = path.join(a['out-root'] ?? RAW_ROOT, '_meta', `higgsfield-models-${nowIso().slice(0, 10)}.json`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, `${JSON.stringify(parseJsonOut(r.stdout), null, 2)}\n`);
    console.log(rel(out));
    return 0;
  }
  if (!a.template) throw new GenError('--template is required (see --help)');
  if (a['no-cost-preview'] && a['max-credits'] !== undefined) throw new GenError('--max-credits needs the cost preview: drop --no-cost-preview');
  // 1) licence gate before anything else
  const g = gate('higgsfield-cli', a.model);
  // 2) prompt
  const values = buildValues(a.template, { symbol: a.symbol, mascot: a.mascot, rigReady: a['rig-ready'], overrides: parseVars(a.var) });
  const { text: prompt, hash: promptHash } = render(a.template, values);
  // 3) request
  const { model, flags } = buildRequest(a);
  const refs = [...a.image.map((p) => ['image', p]), ...(a['start-image'] ? [['start-image', a['start-image']]] : []), ...(a['end-image'] ? [['end-image', a['end-image']]] : [])];
  const refHashes = refs.map(([, p]) => sha256File(p));
  const request = { route: 'higgsfield-cli', model: a.model, promptHash, refHashes, refRoles: refs.map(([r]) => r), flags };
  const fp = fingerprint(request);
  const asset = a.asset ?? defaultAsset(a.template, { symbol: a.symbol, mascot: a.mascot, rigReady: a['rig-ready'] });
  const root = a['out-root'] ? path.resolve(a['out-root']) : RAW_ROOT;
  const { dir, state } = allocate(asset, fp, root, a['force-new']);
  const refPaths = refs.map(([role, p], i) => [role, path.join(dir, 'refs', `${String(i + 1).padStart(2, '0')}_${path.basename(p)}`)]);
  const mediaArgs = refPaths.flatMap(([role, p]) => [role === 'image' ? '--image' : `--${role}`, p]);
  const createArgs = ['generate', 'create', a.model, '--prompt', prompt, ...mediaArgs, ...flags, '--wait', '--json'];
  const costArgs = ['generate', 'cost', a.model, '--prompt', prompt, ...flags, '--json'];
  for (const w of g.warnings) console.error(`warning: ${w}`);

  if (a['dry-run']) {
    console.log(JSON.stringify({
      dryRun: true, gate: g, asset, rawDir: rel(dir), state, promptHash, fingerprint: fp, template: splitTemplateRef(a.template).join('#').replace(/#$/, ''),
      prompt, costCommand: [bin, ...costArgs].map(shq).join(' '), createCommand: [bin, ...createArgs].map(shq).join(' '),
      refs: refs.map(([role, p], i) => ({ role, from: rel(p), to: rel(refPaths[i][1]), sha256: refHashes[i] })),
    }, null, 2));
    return 0;
  }
  if (state === 'done') { console.log(`already generated: ${rel(dir)} (identical request; --force-new to regenerate)`); return 0; }

  // args.json first: a failed run leaves a 'resume' folder that the next identical call reuses
  fs.mkdirSync(path.join(dir, 'refs'), { recursive: true });
  const writeArgs = (cliVersion) => fs.writeFileSync(path.join(dir, 'args.json'),
    `${JSON.stringify({ tool: TOOL, fingerprint: fp, request, cliVersion, argv: [bin, ...createArgs] }, null, 2)}\n`);
  writeArgs(null);
  refs.forEach(([, p], i) => fs.copyFileSync(p, refPaths[i][1]));
  fs.writeFileSync(path.join(dir, 'prompt.txt'), prompt);
  const verOut = runCli(bin, ['version'], { allowFail: true });
  const cliVersion = (verOut.stdout || '').trim().split('\n')[0] || 'unknown';
  writeArgs(cliVersion);

  // resume: a previous run of this exact request finished the (paid) job but failed while
  // downloading: re-download its results instead of generating (and paying) again
  let job = null;
  let credits = null;
  const jobFile = path.join(dir, 'job.json');
  if (state === 'resume' && fs.existsSync(jobFile)) {
    try {
      const prev = parseJsonOut(fs.readFileSync(jobFile, 'utf8'));
      resultsOf(prev);
      job = prev;
      if (fs.existsSync(path.join(dir, 'cost.json'))) credits = creditsOf(parseJsonOut(fs.readFileSync(path.join(dir, 'cost.json'), 'utf8')));
      console.error(`resuming ${rel(dir)}: re-downloading the finished job's results (no new generation)`);
    } catch { job = null; /* failed or unreadable job: generate again */ }
  }
  if (!job) {
    if (!a['no-cost-preview']) {
      const c = runCli(bin, costArgs);
      credits = creditsOf(parseJsonOut(c.stdout));
      fs.writeFileSync(path.join(dir, 'cost.json'), c.stdout);
      console.error(`cost preview: ${credits ?? '?'} credits`);
      if (a['max-credits'] !== undefined && credits === null) {
        // fail closed: an unparseable preview must not bypass the spending cap
        throw new GenError(`--max-credits ${a['max-credits']} set but the cost preview had no credit figure (see ${rel(path.join(dir, 'cost.json'))})`, 4);
      }
      if (a['max-credits'] !== undefined && credits > a['max-credits']) {
        throw new GenError(`cost ${credits} credits exceeds --max-credits ${a['max-credits']}`, 4);
      }
    }
    const run = runCli(bin, createArgs);
    fs.writeFileSync(jobFile, run.stdout);
    job = parseJsonOut(run.stdout);
  }
  const { jobId, urls } = resultsOf(job);
  credits = creditsOf(job) ?? credits;

  const rows = [];
  const vtag = path.basename(dir);
  const parts = [];
  for (let i = 0; i < urls.length; i++) parts.push(await download(urls[i], path.join(dir, `.part_${i + 1}`)));
  const outs = parts.map((p, i) => {
    const out = path.join(dir, `${i === 0 ? 'raw' : `raw_${i + 1}`}${path.extname(p)}`);
    fs.renameSync(p, out);
    return out;
  });
  for (let i = 0; i < outs.length; i++) {
    const out = outs[i];
    rows.push(makeRow({
      id: safeId(asset, 'raw', vtag, i ? String(i + 1) : ''),
      path: rel(out), stage: a.stage ?? (model.kind === 'image' ? '2d-image' : 'video'), route: 'higgsfield-cli',
      vendor: 'Higgsfield', model: a.model, version: cliVersion, seed: null, jobId,
      promptPath: rel(path.join(dir, 'prompt.txt')), promptHash, template: templatePath(a.template),
      refHashes, parents: [], planTier: a['plan-tier'] ?? null, tosVersion: g.tosVersion, licenseId: g.licenseId,
      cost: { amount: i === 0 ? credits ?? 0 : 0, currency: 'credits', unit: 'Higgsfield credits', estimated: true },
      sha256: sha256File(out), notes: `upstream: ${model.upstream}; audio off; ${urls.length} output(s)`,
    }));
  }
  const manifest = a.manifest ?? MANIFEST;
  const added = record(rows, { sidecar: path.join(dir, 'manifest.json'), manifest, generatedBy: TOOL });
  console.log(JSON.stringify({ rawDir: rel(dir), outputs: rows.map((r) => r.path), jobId, credits, manifestRowsAdded: added }, null, 2));
  return 0;
}

if (isMain(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (e) => {
    console.error(`error: ${e.message}`);
    process.exit(e instanceof GenError ? e.code : 1);
  });
}

export { MODELS, REPO };
