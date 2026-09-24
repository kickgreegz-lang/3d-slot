// Cue sheet loading/validation + template variables for sfx.txt / music.txt.
import fs from 'node:fs';
import path from 'node:path';
import { GenError } from '../../gen/lib/genlib.mjs';
import { REPO } from '../../gen/lib/provenance.mjs';
import { parseYaml } from './yaml.mjs';

export const DEFAULT_CUES = path.join(REPO, 'audio', 'cues.yaml');
export const EXAMPLE_CUES = path.join(REPO, 'tools', 'audio', 'cues.example.yaml');
const SFX_IDS_FILE = path.join(REPO, 'src', 'game', 'events.ts');

/** The runtime's SfxId union, parsed from src/game/events.ts (cue keys must match it). */
export function sfxIds() {
  const src = fs.readFileSync(SFX_IDS_FILE, 'utf8');
  const m = /export type SfxId =([\s\S]*?);/.exec(src);
  return m ? [...m[1].matchAll(/'([a-z0-9_]+)'/g)].map((x) => x[1]) : [];
}
export const MUSIC_STEMS = ['base', 'freegame', 'bigwin'];

export function loadCues(file) {
  const f = file ?? DEFAULT_CUES;
  if (!fs.existsSync(f)) {
    throw new GenError(`cue sheet ${path.relative(REPO, f)} not found: copy ${path.relative(REPO, EXAMPLE_CUES)} to audio/cues.yaml (or pass --cues)`);
  }
  const text = fs.readFileSync(f, 'utf8');
  let doc;
  try {
    doc = f.endsWith('.json') ? JSON.parse(text) : parseYaml(text, path.basename(f));
  } catch (e) { throw new GenError(`cannot parse ${f}: ${e.message}`); }
  if (!doc || doc.version !== 1) throw new GenError(`${f}: expected 'version: 1'`);
  doc.global ??= {};
  doc.sfx ??= {};
  doc.music ??= {};
  const ids = new Set(sfxIds());
  for (const [id, c] of Object.entries(doc.sfx)) {
    if (ids.size && !ids.has(id)) throw new GenError(`${f}: sfx cue '${id}' is not an SfxId (src/game/events.ts)`);
    for (const k of ['source', 'action', 'character', 'duration']) if (c?.[k] === undefined) throw new GenError(`${f}: sfx.${id}.${k} is required`);
    if (!(c.duration >= 0.5 && c.duration <= 30)) throw new GenError(`${f}: sfx.${id}.duration must be 0.5..30 s`);
    if (c.loop && c.duration > 30) throw new GenError(`${f}: sfx.${id}: loops are capped at 30 s`);
    const pi = c.promptInfluence ?? doc.global.promptInfluence ?? 0.6;
    if (!(pi >= 0 && pi <= 1)) throw new GenError(`${f}: sfx.${id}.promptInfluence must be 0..1`);
  }
  for (const [stem, c] of Object.entries(doc.music)) {
    if (!MUSIC_STEMS.includes(stem)) throw new GenError(`${f}: music stem '${stem}' is not a MusicStem (${MUSIC_STEMS.join(', ')})`);
    if (c.chunks) {
      if (!Array.isArray(c.chunks) || !c.chunks.length || c.chunks.length > 30) throw new GenError(`${f}: music.${stem}.chunks must hold 1..30 chunks`);
      for (const ch of c.chunks) {
        if (!(ch.durationMs >= 3000 && ch.durationMs <= 120000)) throw new GenError(`${f}: music.${stem}: chunk durationMs must be 3000..120000`);
        if (!ch.text || !Array.isArray(ch.positiveStyles)) throw new GenError(`${f}: music.${stem}: chunk needs text and positiveStyles[]`);
      }
    } else if (!(c.durationS >= 3 && c.durationS <= 600)) {
      throw new GenError(`${f}: music.${stem}.durationS must be 3..600 (prompt mode)`);
    }
    if (c.conditionOn && !(c.conditionOn in doc.music)) throw new GenError(`${f}: music.${stem}.conditionOn '${c.conditionOn}' is not a stem in this sheet`);
  }
  return { doc, file: f };
}

export function sfxVars(doc, id) {
  const c = doc.sfx[id];
  return {
    CUE_ID: id,
    SOURCE: c.source,
    ACTION: c.action,
    CHARACTER: c.character,
    DURATION_S: String(c.duration),
    PITCH_NOTE: c.tonal && doc.global.key ? `in key ${doc.global.key},` : '',
    ...(c.tail ? { TAIL: c.tail } : {}),
  };
}

export function musicVars(doc, stem) {
  const c = doc.music[stem];
  return {
    STEM: stem,
    KEY: String(doc.global.key ?? ''),
    BPM: String(doc.global.bpm ?? ''),
    ENERGY: c.energy ?? '',
    SECTION_PLAN: c.sectionPlan ?? '',
    DURATION_S: String(c.durationS ?? ''),
    ...(c.genre ? { GENRE: c.genre } : {}),
    ...(c.instruments ? { INSTRUMENTS: c.instruments } : {}),
  };
}

/** channels from a raw s16 PCM byte length and the requested duration (1 or 2). */
export function guessChannels(bytes, seconds, rate = 48000) {
  const ratio = bytes / (2 * rate * seconds);
  return ratio > 1.5 ? 2 : 1;
}
