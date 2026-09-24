# tools/audio: ElevenLabs generation, mastering, SFX sprites

| Script | Does |
|---|---|
| `gen-sfx.mjs` | Cue sheet → prompt rendered from `art/bible/prompts/sfx.txt` → ElevenLabs SFX v2 (`POST /v1/sound-generation`, `pcm_48000` → WAV) × N takes → `art/_raw/audio_sfx_<SfxId>/vNN/raw_<take>.wav` + rows |
| `gen-music.mjs` | Eleven Music per `MusicStem`: prompt mode (`music.txt`, `force_instrumental`) or plan mode (v2 `chunks`, no lyric lines), `store_for_inpainting` → `song_id.txt`, `conditionOn` → `conditioning_ref` on every chunk (prompt-mode stems go through `/v1/music/plan` first), six-stem separation, `video_to_music` |
| `master.sh IN OUT_BASE` | `--mode music` 2-pass loudnorm (I −16, TP −1, `linear=true`, **asserts `normalization_type == linear`**; otherwise a deterministic static gain + 4× oversampled limiter, re-measured to ±0.5 LU, never loudnorm's dynamic mode) · `--mode loop` + equal-power **seam crossfade** (processed with circular padding, loop length snapped to whole AAC frames so `.m4a` loops without a padding gap) · `--mode sfx` silence trim + micro-fades + sample-peak ceiling (gated on the PCM master to ±0.1 dB; the lossy encodes must only stay unclipped, ≤ −0.1 dBFS, because AAC/Opus overshoot abrupt attacks and noise bursts by 2–5 dB; the overshoot is reported per file in `qa.json`) · encodes `.webm` (Opus) + `.m4a` (AAC) [+ `.ogg` Vorbis] [+ 24-bit master WAV], bit-exact containers |
| `sprite.mjs` | Mastered one-shots → one sprite per format + JSON (Howler `sprite` ms, audiosprite `spritemap` s, exact `samples`); clips start on 1024-sample boundaries; QA decodes every encode and checks clip energy and silent gaps |
| `audio_qa.py` | ebur128 (I, LRA, true peak), sample peak, lead/tail silence, loop seam jump; gates used by `master.sh` |
| `cues.example.yaml` | Example cue sheet (copy to `audio/cues.yaml`, keyed by `SfxId` / `MusicStem`) |
| `lib/` | `yaml.mjs` (YAML subset; no dependency may be added), `cues.mjs` (validation vs `src/game/events.ts` SfxIds), `elevenlabs.mjs` (REST + dry-run log), `ff.mjs` (ffmpeg) |

```bash
cp tools/audio/cues.example.yaml audio/cues.yaml             # then edit (audio/ is outside tools/)
node tools/audio/gen-sfx.mjs --cue land_heavy --takes 6 [--dry-run]     # ELEVENLABS_API_KEY
node tools/audio/gen-music.mjs --stem base && node tools/audio/gen-music.mjs --stem freegame --stem bigwin
# after the human pick (art/source/audio/masters/<SfxId>_<nn>.wav):
tools/audio/master.sh art/source/audio/masters/land_heavy_01.wav public/assets/audio/sfx/land_heavy_01 --mode sfx --peak -6 --shipped --manifest art/manifest.json
tools/audio/master.sh art/source/audio/masters/base.wav public/assets/audio/music/base --mode loop --crossfade-ms 250 --shipped --manifest art/manifest.json
# optional sprite (the runtime reads per-file today): master with --wav build/audio/masters/<id>.wav, then
node tools/audio/sprite.mjs --out public/assets/audio/sfx/sprite --shipped build/audio/masters/*.wav
```

Then list the files in `src/audio/manifest.ts` as `'./assets/audio/sfx/land_heavy_01.{webm,m4a}'`
(`pickFormat` requests only the first playable extension). Loudness/peak targets per bus live in the
cue sheet's `global.targets` (sfx −6 dBFS peak, ui −12, music/loops −16 LUFS / −1 dBTP).

**Notes.** `pcm_48000` channel count is detected from the byte length vs the requested duration.
Credits: the SFX estimate uses 40 credits/s (secondary source, marked `estimated`); the music API
reports no cost (row `cost.amount` 0, `estimated`). ElevenLabs is allowlisted with clearance
*pending*: prototype on Pro, ship only under an Enterprise agreement (audit enforces on shipped rows).
The Higgsfield audio models (`mirelo_*`, `sonilo_*`) are refused by the licence gate.

## Tests

```bash
PIPELINE_PY=tools/.venv/bin/python tools/.venv/bin/python tools/audio/test/test_audio.py   # 17 tests, ~15 s
```
Synthetic tones through `master.sh` in every mode, verified independently with ebur128: music
(linear loudnorm) −15.9 LUFS in `.wav/.webm/.m4a/.ogg`; loop −16.0 LUFS, all four outputs exactly
179 200 samples (175 AAC frames) with seam jump ≈ 2× a normal step; sfx trimmed from 1.0 s to 0.41 s,
peak −6.0 dBFS; a spiky input that forbids linear gain → static gain + limiter → −16.1 LUFS, TP −1.2;
byte-identical re-runs. Sprite: 1024-aligned starts, loop flag, all encodes pass the bleed check.
`gen-sfx` / `gen-music` against a local mock ElevenLabs server: exact requests, WAV takes, song-id
chaining (freegame/bigwin chunks carry the base song's `conditioning_ref`), stems unzipped, rows valid,
idempotent skip, refusals (denylisted model → 3, unknown SfxId / missing key → 2). YAML parser = PyYAML
on the example sheet.

## Doc snippet (docs/PIPELINE.md tooling status + 7.1/7.3)

```md
| `tools/audio/{gen-sfx,gen-music,sprite}.mjs`, `master.sh`, `audio_qa.py` | **exists** | ElevenLabs generation from `audio/cues.yaml`, EBU R128 mastering with asserted linear normalisation, seam crossfade, WebM-Opus + AAC, sprites |
```
Replace the planned `tools/audio/{gen-sfx,gen-music,sprite,prefilter}.ts` (the tools are `.mjs`: no TS runner is installed).
