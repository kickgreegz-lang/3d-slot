#!/usr/bin/env node
// Eleven Music generation from the cue sheet -> art/_raw/audio_music_<stem>/vNN/{raw.wav, song_id.txt,
// plan.json, stems/} + manifest rows. Prompt mode renders art/bible/prompts/music.txt; plan mode sends the
// cue's composition-plan chunks (v2 'chunks' format, no lyric lines). A stem with conditionOn gets
// conditioning_ref -> the named stem's stored song on every chunk (prompt-mode stems are first turned
// into a plan via /v1/music/plan). Optional six-stem separation and video_to_music.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  GenError, RAW_ROOT, allocate, bible, buildValues, canonical, checkForbidden, fingerprint, forbiddenTerms, gate,
  parseArgs, rawOutputs, render, versionDirs,
} from '../gen/lib/genlib.mjs';
import { MANIFEST, makeRow, record, rel, safeId, sha256File, sha256Text } from '../gen/lib/provenance.mjs';
import { guessChannels, loadCues, musicVars } from './lib/cues.mjs';
import { Client } from './lib/elevenlabs.mjs';
import { wavBuffer } from './lib/ff.mjs';

const TOOL = 'tools/audio/gen-music.mjs';
const HELP = `Usage: node ${TOOL} [--cues audio/cues.yaml] [--stem base|freegame|bigwin ...] [--dry-run] [options]
Eleven Music (music_v2 / music_v2_5) per MusicStem, output pcm_48000 -> WAV. Instrumental only:
prompt mode sets force_instrumental; plan chunks must contain no lyric lines. Compose the base stem
first with storeForInpainting so the other stems can condition on its song_id.
Options:
  --cues FILE        default audio/cues.yaml       --stem ID   only these stems (repeatable, in order)
  --plan-only        prompt-mode stems: fetch /v1/music/plan and save plan.json for editing; no audio
  --no-stems         skip stem separation          --no-video  skip video_to_music jobs
  --out-root DIR     default art/_raw              --manifest FILE  default art/manifest.json ('none' to skip)
  --plan-tier S      --force-new                   --api-base URL (tests)
  --dry-run          print every exact request (multipart parts described), no network, no files
Env: ELEVENLABS_API_KEY. Exit: 0 ok/skipped, 2 usage, 3 licence refusal, 5 vendor failure.`;

const SPEC = {
  help: { type: 'boolean', alias: 'h' }, cues: { type: 'string' }, stem: { type: 'string', multi: true },
  'plan-only': { type: 'boolean' }, 'no-stems': { type: 'boolean' }, 'no-video': { type: 'boolean' },
  'out-root': { type: 'string' }, manifest: { type: 'string' }, 'plan-tier': { type: 'string' },
  'force-new': { type: 'boolean' }, 'api-base': { type: 'string' }, 'dry-run': { type: 'boolean' },
};
const OUT_FMT = 'pcm_48000';

/** The stored song id of a stem's latest finished generation (or null). */
function songIdOf(root, stem) {
  const vers = versionDirs(path.join(root, `audio_music_${stem}`)).reverse();
  for (const v of vers) {
    const f = path.join(v, 'song_id.txt');
    if (fs.existsSync(f) && rawOutputs(v).length) return fs.readFileSync(f, 'utf8').trim();
  }
  return null;
}

const toChunk = (ch) => ({
  text: ch.text, duration_ms: ch.durationMs, positive_styles: ch.positiveStyles ?? [], negative_styles: ch.negativeStyles ?? [],
  ...(ch.contextAdherence ? { context_adherence: ch.contextAdherence } : {}),
});

function withConditioning(plan, songId, c) {
  if (!songId) return plan;
  return { ...plan, chunks: plan.chunks.map((ch) => ({ ...ch, conditioning_ref: { song_id: songId, range: { start_ms: 0, end_ms: 30000 } }, condition_strength: c.conditionStrength ?? 'medium' })) };
}

function checkPlanText(plan) {
  const texts = plan.chunks.flatMap((ch) => [ch.text, ...(ch.positive_styles ?? []), ...(ch.negative_styles ?? [])]).join('\n');
  const hits = checkForbidden(texts, forbiddenTerms(bible()));
  if (hits.length) throw new GenError(`composition plan contains forbidden word(s) ${JSON.stringify(hits)}`);
}

async function main(argv) {
  const a = parseArgs(argv, SPEC);
  if (a.help) { console.log(HELP); return 0; }
  const { doc, file } = loadCues(a.cues);
  const model = doc.global.musicModel ?? 'music_v2';
  const g = gate('elevenlabs', model);
  for (const w of g.warnings) console.error(`warning: ${w}`);
  const stems = a.stem.length ? a.stem : Object.keys(doc.music);
  for (const s of stems) if (!doc.music[s]) throw new GenError(`no music stem '${s}' in ${rel(file)}`);
  const client = new Client({ apiBase: a['api-base'], dry: a['dry-run'] });
  const root = a['out-root'] ? path.resolve(a['out-root']) : RAW_ROOT;
  const manifest = a.manifest ?? MANIFEST;
  const report = [];

  for (const stem of stems) {
    const c = doc.music[stem];
    const asset = `audio_music_${stem}`;
    let promptText;
    let promptHash;
    let template = 'art/bible/prompts/music.txt';
    let basePlan = null;
    if (c.chunks) {
      basePlan = { chunks: c.chunks.map(toChunk) };
      checkPlanText(basePlan);
      promptText = JSON.stringify(basePlan, null, 2);
      promptHash = sha256Text(promptText);
      template = null;
    } else {
      ({ text: promptText, hash: promptHash } = render('music.txt', buildValues('music.txt', { overrides: musicVars(doc, stem) })));
    }
    const condSong = c.conditionOn ? songIdOf(root, c.conditionOn) : null;
    if (c.conditionOn && !condSong && !a['dry-run'] && !a['plan-only']) {
      throw new GenError(`music.${stem} conditions on '${c.conditionOn}', which has no stored song yet: generate --stem ${c.conditionOn} first (storeForInpainting: true)`);
    }
    const lengthMs = c.chunks ? c.chunks.reduce((s, ch) => s + ch.durationMs, 0) : c.durationS * 1000;
    const request = { route: 'elevenlabs', model, outputFormat: OUT_FMT, promptHash, conditionOn: c.conditionOn ?? null, conditionSong: condSong,
      storeForInpainting: Boolean(c.storeForInpainting), lengthMs, planOnly: Boolean(a['plan-only']) };
    const fp = fingerprint(request);
    const { dir, state } = allocate(asset, fp, root, a['force-new']);
    const job = { stem, rawDir: rel(dir), state, prompt: promptText, promptHash };
    if (state === 'done' && !a['dry-run']) { report.push({ ...job, skipped: 'already generated' }); continue; }
    if (!a['dry-run']) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'args.json'), `${JSON.stringify({ tool: TOOL, fingerprint: fp, request, cues: rel(file) }, null, 2)}\n`);
      fs.writeFileSync(path.join(dir, 'prompt.txt'), promptText);
    }
    // 1) plan: cue chunks, or /v1/music/plan from the rendered prompt when a plan is needed
    let plan = basePlan;
    if (!plan && (c.conditionOn || a['plan-only'])) {
      const r = await client.request('POST', 'v1/music/plan', { json: { prompt: promptText, music_length_ms: lengthMs, model_id: model } });
      plan = r ? JSON.parse(r.body.toString()) : { chunks: [{ text: '<from /v1/music/plan>', duration_ms: lengthMs, positive_styles: [] }] };
      if (!a['dry-run']) fs.writeFileSync(path.join(dir, 'plan.json'), `${JSON.stringify(plan, null, 2)}\n`);
      if (a['plan-only']) { report.push({ ...job, plan: rel(path.join(dir, 'plan.json')) }); continue; }
    }
    if (plan) plan = withConditioning(plan, condSong ?? (c.conditionOn ? `<song-id of audio_music_${c.conditionOn}>` : null), c);
    // 2) compose
    const body = plan
      ? { composition_plan: plan, model_id: model, ...(c.storeForInpainting ? { store_for_inpainting: true } : {}), ...(c.seed !== undefined ? { seed: c.seed } : {}) }
      : { prompt: promptText, music_length_ms: lengthMs, model_id: model, force_instrumental: true, ...(c.storeForInpainting ? { store_for_inpainting: true } : {}) };
    const r = await client.request('POST', 'v1/music', { query: { output_format: OUT_FMT }, json: body });
    const rows = [];
    const cost = { amount: 0, currency: 'credits', unit: 'ElevenLabs credits (not reported by the API)', estimated: true };
    const common = {
      stage: 'audio-music', route: 'elevenlabs', vendor: 'ElevenLabs', model, version: `v1/music ${OUT_FMT}`, seed: c.seed ?? null,
      promptPath: rel(path.join(dir, 'prompt.txt')), promptHash, template, refHashes: [], planTier: a['plan-tier'] ?? null,
      tosVersion: g.tosVersion, licenseId: g.licenseId, cost,
    };
    if (r) {
      const songId = r.headers['song-id'] ?? null;
      const ch = guessChannels(r.body.length, lengthMs / 1000);
      const out = path.join(dir, 'raw.wav');
      fs.writeFileSync(out, wavBuffer(r.body, { rate: 48000, channels: ch }));
      if (songId) fs.writeFileSync(path.join(dir, 'song_id.txt'), `${songId}\n`);
      if (plan) fs.writeFileSync(path.join(dir, 'plan.json'), `${JSON.stringify(plan, null, 2)}\n`);
      fs.writeFileSync(path.join(dir, 'job.json'), `${JSON.stringify({ songId, channels: ch, bytes: r.body.length, requestId: r.headers['request-id'] ?? null }, null, 2)}\n`);
      rows.push(makeRow({ ...common, id: safeId(asset, 'raw', path.basename(dir)), path: rel(out), sha256: sha256File(out), jobId: songId,
        notes: `stem ${stem}; ${plan ? 'plan' : 'prompt'} mode; ${c.conditionOn ? `conditioned on ${c.conditionOn} (${condSong})` : 'unconditioned'}` }));
    }
    // 3) stems
    if (c.stems && !a['no-stems']) {
      const s = await client.request('POST', 'v1/music/stem-separation', { form: { file: { file: path.join(dir, 'raw.wav') }, stem_variation_id: c.stems } });
      if (s) {
        const zip = path.join(dir, 'raw_stems.zip');
        fs.writeFileSync(zip, s.body);
        const x = spawnSync('python3', ['-c', 'import sys,zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])', zip, path.join(dir, 'stems')], { encoding: 'utf8' });
        if (x.status !== 0) throw new GenError(`cannot unzip stems: ${x.stderr}`, 5);
        rows.push(makeRow({ ...common, id: safeId(asset, 'stems', path.basename(dir)), path: rel(zip), sha256: sha256File(zip), jobId: null,
          stage: 'audio-music', parents: rows.length ? [rows[0].id] : [], notes: `${c.stems} separation of ${stem}` }));
      }
    }
    // 4) video_to_music (scores a rendered sequence; separate raw file)
    if (c.videoToMusic && !a['no-video']) {
      const v = path.resolve(c.videoToMusic);
      if (!a['dry-run'] && !fs.existsSync(v)) throw new GenError(`music.${stem}.videoToMusic: ${c.videoToMusic} not found (render it first)`);
      const vr = await client.request('POST', 'v1/music/video-to-music', { query: { output_format: OUT_FMT },
        form: { videos: { file: v }, description: promptText.slice(0, 1000), tags: JSON.stringify([stem, 'instrumental']), model_id: model } });
      if (vr) {
        const out = path.join(dir, 'raw_video2music.wav');
        fs.writeFileSync(out, wavBuffer(vr.body, { rate: 48000, channels: 2 }));
        rows.push(makeRow({ ...common, id: safeId(asset, 'v2m', path.basename(dir)), path: rel(out), sha256: sha256File(out), jobId: null,
          refHashes: [sha256File(v)], notes: `video_to_music on ${rel(v)}` }));
      }
    }
    if (rows.length) job.manifestRowsAdded = record(rows, { sidecar: path.join(dir, 'manifest.json'), manifest, generatedBy: TOOL });
    job.outputs = rows.map((x) => x.path);
    report.push(job);
  }
  console.log(JSON.stringify(a['dry-run'] ? { dryRun: true, gate: g, cues: rel(file), jobs: report, requests: client.log } : { jobs: report }, null, 2));
  return 0;
}

main(process.argv.slice(2)).then((c) => process.exit(c), (e) => {
  console.error(`error: ${e.message}`);
  process.exit(e instanceof GenError ? e.code : 1);
});

export { canonical };
