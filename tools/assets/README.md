# tools/assets: AssetPack packing

`assetpack.config.mjs` is the AssetPack 1.7.0 config (ported from the research prototype, which built
a sample tree in ~1.9 s); `pack.mjs` runs it and gates the result.

```bash
node tools/assets/pack.mjs                                   # build/pack -> public/assets/pack, gates, rows
node tools/assets/pack.mjs --entry build/pack --output public/assets/pack --shipped --manifest art/manifest.json
npx assetpack -c tools/assets/assetpack.config.mjs           # plain AssetPack, same config, no gates
```

## Layout

```
build/pack/                      input, written only by scripts
  symbols{tps}/sym_H1.png …      matte + variants (360x360 @2x canvases; not an animation)
  W_turn{tps}/W_turn_0001.png …  ONE folder per clip (tools/video/flipbook.py) -> animations.W_turn
  fx_poof{tps}/fx_poof_0001.png …
  env{m}/bg_landscape.png        {m} = manifest bundle 'env'
  audio/land_heavy_01.webm|m4a   mastered by tools/audio/master.sh: copied byte-identical
public/assets/pack/              output, owned by AssetPack (it deletes the folder on a cold cache)
  manifest.json                  srcs relative to this folder -> Assets.init({ basePath: './assets/pack/', manifest })
  symbols.{png,webp}.json + pages, symbols@0.5x.{png,webp}.json + pages, …
```

## Fixes vs the prototype

| | Prototype | Now |
|---|---|---|
| resolutions | `{high: 2, default: 1, low: 0.5}` (a third, @2x copy) | `{default: 1, low: 0.5}`: art is authored at the shipped size; `@0.5x` for the low tier |
| pages | 2048 max | 2048 max, `padding 4`, `allowRotation/allowTrim false` (flipbooks are already trimmed around their pivot; frames ×8 px) → pages are multiples of 4 at both resolutions |
| formats | png + webp (+ jpg) | **webp + png** only (jpg/avif off) |
| clips | one `{tps}` folder | one `{tps}` folder **per clip**; symbol statics have animation autodetect off (`sym_H1..H4` is not an animation `sym_H`) |
| audio | AssetPack's bundled 2018 ffmpeg re-encoded to mp3 + 32 kbps mono ogg | disabled: `.webm/.m4a` from `master.sh` pass through untouched |
| manifest | `manifest.json` | in the output root, srcs relative to it (basePath), short aliases, no extensions |
| output | `public/assets` | `public/assets/pack` (AssetPack wipes its output; fonts/spine/GLBs live beside it) |
| cache busting | on | off by default (`--cache-bust`): Stake versions the whole build path and `src/assets/manifest.ts` lists stable names |

## Gates in `pack.mjs` (exit 1)

manifest exists and every `src` is relative (no `/`, `..`, scheme) and present; every page ≤ 2048
(and ×4 with `--strict-pages`, otherwise a warning); every `{tps}` clip `<clip>_NNNN.png` yields
`animations.<clip>` with exactly that many frames in every resolution × format (multi-pack pages
summed); audio byte-identical. Writes `build/qa/assetpack/{qa.json, manifest.json}`: one row per
output file (stage `packaging`, licence `pixi`), `parents` = rows (by sha256 in `art/manifest.json`)
of the inputs packed into it, so the licence audit can walk shipped files back to their generations.

## Test

```bash
PIPELINE_PY=tools/.venv/bin/python tools/.venv/bin/python tools/assets/test/test_assets.py   # 8 tests, ~3 s
```
Fixture `art/_work/assetpack-fixture/raw` (3 symbols, clips `fx_poof` ×8 and `W_turn` ×12, a `{m}`
background, Opus + AAC audio): pass; relative manifest with an `env` bundle; png + webp at 1× and
0.5× for every sheet (symbol `sourceSize` 360 → 180); pages ≤ 2048 and ×4 (e.g. `W_turn` 500×496 /
260×256); clip lengths 8 / 12 in all 4 variants; no `sym_H` animation; audio untouched; one valid row
per output; cached re-run byte-identical. AssetPack `rm -rf`s `--output` (cold cache) and `--cache-dir`
(`--no-cache`), so `pack.mjs` refuses, before AssetPack runs, any folder that is or contains the repo,
`public/assets`, the entry tree, `$HOME` or `/`; inside the repo only strict subfolders of
`public/assets/`, `build/` and `art/_work/`; outside it, a non-empty folder without `manifest.json`.

```bash
PIPELINE_PY=tools/.venv/bin/python tools/.venv/bin/python tools/assets/test/test_chain.py    # 2 tests, ~20-60 s
```
End to end: synthetic art → `outline_matte.py` → `variants.py`, synthetic clip → `key_video.sh` →
`flipbook.py`, → `pack.mjs --shipped` → `audit.mjs`. The sheet row's parents are the matte + blur +
glow rows, the clip sheet's parent is the flipbook folder row (whose parent is the keyed-frames row);
the audit passes. With a pretend Higgsfield raw row upstream, the matte inherits `licenseId
higgsfield` and the audit fails the shipped outputs on its `pending` clearance.

## Doc snippet (docs/PIPELINE.md 8.3)

```md
- AssetPack: `node tools/assets/pack.mjs --shipped --manifest art/manifest.json` (build/pack → public/assets/pack; 2048 pages, one `{tps}` folder per clip, WebP + PNG, @0.5x low tier; gates: relative srcs, page sizes, clip lengths).
```
