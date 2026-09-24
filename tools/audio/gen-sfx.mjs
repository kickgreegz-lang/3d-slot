#!/usr/bin/env node
// ElevenLabs Sound Effects v2 generation from the cue sheet -> art/_raw/audio_sfx_<cue>/vNN/raw_<take>.wav
// + one manifest row per take. Prompts are rendered from art/bible/prompts/sfx.txt.
import fs from 'node:fs';
import path from 'node:path';
import { GenError, RAW_ROOT, allocate, buildValues, fingerprint, gate, parseArgs, render } from '../gen/lib/genlib.mjs';
import { MANIFEST, makeRow, record, rel, safeId, sha256File } from '../gen/lib/provenance.mjs';
import { guessChannels, loadCues, sfxVars } from './lib/cues.mjs';
import { Client } from './lib/elevenlabs.mjs';
import { wavBuffer } from './lib/ff.mjs';

const TOOL = 'tools/audio/gen-sfx.mjs';
const HELP = `Usage: node ${TOOL} [--cues audio/cues.yaml] [--cue ID ...] [--dry-run] [options]
Generates N takes per SFX cue with ElevenLabs 'eleven_text_to_sound_v2' (POST /v1/sound-generation,
output_format pcm_48000 wrapped losslessly to WAV). Licence-gated (licenses/allowlist.json 'elevenlabs':
prototype on Pro, ship only under an Enterprise agreement). Every take is a new request (no seed).
Options:
  --cues FILE       default audio/cues.yaml (see tools/audio/cues.example.yaml)
  --cue ID          only these cues (repeatable; SfxId)      --takes N   override takes per cue
  --out-root DIR    default art/_raw                          --manifest FILE  default art/manifest.json ('none' to skip)
  --plan-tier S     e.g. "ElevenLabs Pro"                     --force-new  new vNN even if identical
  --max-credits N   abort before generating if the estimate (40 credits/s, unverified) is higher
  --api-base URL    default https://api.elevenlabs.io (tests point it at a mock)
  --dry-run         print every exact request, target folder and prompt; no network, no files
Env: ELEVENLABS_API_KEY. Exit: 0 ok/skipped, 2 usage, 3 licence refusal, 4 cost cap, 5 vendor failure.`;

const SPEC = {
  help: { type: 'boolean', alias: 'h' }, cues: { type: 'string' }, cue: { type: 'string', multi: true },
  takes: { type: 'number' }, 'out-root': { type: 'string' }, manifest: { type: 'string' }, 'plan-tier': { type: 'string' },
  'force-new': { type: 'boolean' }, 'max-credits': { type: 'number' }, 'api-base': { type: 'string' }, 'dry-run': { type: 'boolean' },
};
const CREDITS_PER_SECOND = 40; // secondary source; verify on elevenlabs.io/pricing/api

async function main(argv) {
  const a = parseArgs(argv, SPEC);
  if (a.help) { console.log(HELP); return 0; }
  const { doc, file } = loadCues(a.cues);
  const model = doc.global.sfxModel ?? 'eleven_text_to_sound_v2';
  const g = gate('elevenlabs', model);
  for (const w of g.warnings) console.error(`warning: ${w}`);
  const outputFormat = doc.global.outputFormat ?? 'pcm_48000';
  if (!/^pcm_48000$/.test(outputFormat)) throw new GenError(`outputFormat ${outputFormat}: only pcm_48000 is supported (lossless masters)`);
  const ids = a.cue.length ? a.cue : Object.keys(doc.sfx);
  for (const id of ids) if (!doc.sfx[id]) throw new GenError(`no sfx cue '${id}' in ${rel(file)}`);
  const client = new Client({ apiBase: a['api-base'], dry: a['dry-run'] });
  const root = a['out-root'] ? path.resolve(a['out-root']) : RAW_ROOT;
  const plan = [];
  let credits = 0;
  for (const id of ids) {
    const c = doc.sfx[id];
    const values = buildValues('sfx.txt', { overrides: sfxVars(doc, id) });
    const { text, hash } = render('sfx.txt', values);
    const takes = a.takes ?? c.takes ?? doc.global.takes ?? 4;
    const body = { text, model_id: model, duration_seconds: c.duration, prompt_influence: c.promptInfluence ?? doc.global.promptInfluence ?? 0.6, loop: Boolean(c.loop) };
    const { text: _t, ...params } = body;
    const request = { route: 'elevenlabs', endpoint: 'v1/sound-generation', outputFormat, promptHash: hash, params, takes };
    const fp = fingerprint(request);
    const asset = `audio_sfx_${id}`;
    const alloc = allocate(asset, fp, root, a['force-new']);
    const { dir } = alloc;
    // allocate() calls a folder 'done' as soon as ANY raw_* exists; a run that died after take 2 of 4
    // must resume the missing takes and still write the rows, so completeness is judged per take
    const need = Array.from({ length: takes }, (_, i) => i + 1).filter((t) => !fs.existsSync(path.join(dir, `raw_${String(t).padStart(2, '0')}.wav`)));
    const state = need.length === 0 && fs.existsSync(path.join(dir, 'manifest.json')) ? 'done' : alloc.state === 'new' ? 'new' : 'resume';
    credits += need.length * Math.ceil(c.duration * CREDITS_PER_SECOND);
    plan.push({ id, c, text, hash, takes, body, request, fp, asset, dir, state, need });
  }
  if (a['max-credits'] !== undefined && credits > a['max-credits']) throw new GenError(`estimated ${credits} credits > --max-credits ${a['max-credits']}`, 4);
  if (a['dry-run']) {
    for (const p of plan) for (let i = 0; i < p.need.length; i++) await client.request('POST', 'v1/sound-generation', { query: { output_format: outputFormat }, json: p.body });
    console.log(JSON.stringify({
      dryRun: true, gate: g, cues: rel(file), estimatedCredits: credits,
      jobs: plan.map((p) => ({ cue: p.id, rawDir: rel(p.dir), state: p.state, takes: p.need, prompt: p.text, promptHash: p.hash, fingerprint: p.fp })),
      requests: client.log,
    }, null, 2));
    return 0;
  }
  const summary = [];
  for (const p of plan) {
    if (p.state === 'done') { summary.push({ cue: p.id, rawDir: rel(p.dir), skipped: 'already generated' }); continue; }
    fs.mkdirSync(p.dir, { recursive: true });
    fs.writeFileSync(path.join(p.dir, 'args.json'), `${JSON.stringify({ tool: TOOL, fingerprint: p.fp, request: p.request, cues: rel(file) }, null, 2)}\n`);
    fs.writeFileSync(path.join(p.dir, 'prompt.txt'), p.text);
    const jobFile = path.join(p.dir, 'job.json');
    let jobs = [];
    try { jobs = JSON.parse(fs.readFileSync(jobFile, 'utf8')).jobs ?? []; } catch { jobs = []; }
    const rows = [];
    for (const t of p.need) {
      const r = await client.request('POST', 'v1/sound-generation', { query: { output_format: outputFormat }, json: p.body });
      if (!r.body.length) throw new GenError(`empty audio for ${p.id} take ${t}`, 5);
      const ch = guessChannels(r.body.length, p.c.duration);
      const out = path.join(p.dir, `raw_${String(t).padStart(2, '0')}.wav`);
      fs.writeFileSync(out, wavBuffer(r.body, { rate: 48000, channels: ch }));
      jobs = [...jobs.filter((x) => x.take !== t), { take: t, requestId: r.headers['request-id'] ?? r.headers['x-request-id'] ?? null, bytes: r.body.length, channels: ch }]
        .sort((x, y) => x.take - y.take);
      fs.writeFileSync(jobFile, `${JSON.stringify({ jobs }, null, 2)}\n`);   // after every take: a crash keeps the ids
    }
    for (let t = 1; t <= p.takes; t++) {
      const out = path.join(p.dir, `raw_${String(t).padStart(2, '0')}.wav`);
      if (!fs.existsSync(out)) continue;
      const j = jobs.find((x) => x.take === t);
      rows.push(makeRow({
        id: safeId(p.asset, 'raw', path.basename(p.dir), `t${String(t).padStart(2, '0')}`), path: rel(out), stage: 'audio-sfx',
        route: 'elevenlabs', vendor: 'ElevenLabs', model, version: `v1/sound-generation ${outputFormat}`, seed: null,
        jobId: j?.requestId ?? null, promptPath: rel(path.join(p.dir, 'prompt.txt')), promptHash: p.hash,
        template: 'art/bible/prompts/sfx.txt', refHashes: [], planTier: a['plan-tier'] ?? null, tosVersion: g.tosVersion,
        licenseId: g.licenseId, sha256: sha256File(out),
        cost: { amount: Math.ceil(p.c.duration * CREDITS_PER_SECOND), currency: 'credits', unit: 'ElevenLabs credits (40/s, unverified)', estimated: true },
        notes: `cue ${p.id} take ${t}/${p.takes}; loop=${Boolean(p.c.loop)}; bus ${p.c.bus ?? 'sfx'}`,
      }));
    }
    const added = record(rows, { sidecar: path.join(p.dir, 'manifest.json'), manifest: a.manifest ?? MANIFEST, generatedBy: TOOL });
    summary.push({ cue: p.id, rawDir: rel(p.dir), takes: rows.map((r) => r.path), manifestRowsAdded: added });
  }
  console.log(JSON.stringify({ outputs: summary }, null, 2));
  return 0;
}

main(process.argv.slice(2)).then((c) => process.exit(c), (e) => {
  console.error(`error: ${e.message}`);
  process.exit(e instanceof GenError ? e.code : 1);
});
