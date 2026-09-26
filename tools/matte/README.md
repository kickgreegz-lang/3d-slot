# tools/matte: key-colour matting, symbol canvas fit, blur/glow variants

| Script | Does |
|---|---|
| `outline_matte.py` | **Measured key + `keyUniform` gate** → key-colour + closed-black-outline matte → despill → 1 px erode → seal → fit on the **360×360 @2x** canvas → QA gates → provenance |
| `variants.py` | `<name>_blur.png` (vertical motion blur in screen space) and `<name>_glow.png` (soft white silhouette) on the same canvas |
| `mattelib.py` | The algorithms and metrics (`measure_key` / keyUniform, IoU, halo, canvas report, `src/games/$GAME/config.ts` targets, default swamp-funk) |
| `make_synthetic.py` | Test art: cel-shaded, outlined, extruded object with an enclosed key hole, 4× supersampled AA, exact ground-truth alpha; `--slop` adds a cast shadow + glow, `--gap` breaks the outline |
| `rembg_matte.sh` | Guarded optional model path: only `birefnet-general(-lite)` (the allowlist 'birefnet-rembg' models), always `-m … -dc`; never rembg's default BRIA RMBG-2.0 (denylisted) |

```bash
# raw generation -> AssetPack input (content = cellScale x 300 px from src/games/$GAME/config.ts: H1 291, S 336, royals 258)
# --key auto (the default) keys on the MEASURED background; --expect-key = the prompt's KEY_HEX (drift is reported)
GAME=bass-drop tools/.venv/bin/python tools/matte/outline_matte.py art/_raw/D_H1/v01/raw.png "build/pack/symbols{tps}/sym_H1.png" \
  --symbol H1 --expect-key 00FF00 --emit-master art/source/symbols/H1/master_2048.png --parent-id d_h1.raw.v01 --manifest art/manifest.json
tools/.venv/bin/python tools/matte/variants.py "build/pack/symbols{tps}/sym_H1.png" --symbol H1 --parent-id <matte row id>
# model matte instead of the key matte (ToonOut/BiRefNet), same fit + gates
tools/matte/rembg_matte.sh birefnet-general raw.png art/_work/sym_H1_rembg.png
tools/.venv/bin/python tools/matte/outline_matte.py raw.png out.png --alpha-from art/_work/sym_H1_rembg.png --key 00FF00 --symbol H1
```

## The key colour is measured, never assumed (`keyUniform`)

The prompt asks for a key hex, but the model does not always obey (STYLE_DECISION.md). The adopted
formula-D H1 (`ab2/D_H1`) came back on olive `#95C445` instead of `#00FF00`, `c01/sym_H3_rig` on
`#91C53E`, and `c03/sym_W_rig` on white. `--key auto` (the default) therefore **measures** the key
(`mattelib.measure_key`) and gates it before matting:

- **Measure:** the median of the 8 px border strips is the key. Every patch median (48 px: the 4 corners
  and the 4 edge midpoints) must lie within **16** (`patchSpread`), and 95% of the border pixels within
  **32** (`borderP95`), 0–255 RGB distance.
- **Calibration:** on the 24 Higgsfield NBP raws of 2026-09-26, flat keys measure a borderP95 of 1.7–20.6
  and a spread of at most 7.1; painted plates, which cannot be keyed, measure 59–155 and fail.
- **Keyable:** the key must be a colour. White, grey or black fails (`keyable: false`): enclosed white
  highlights or ivory enamel would be keyed out as holes.
- **Failure:** `error: keyUniform FAILED …` with the patch medians, exit **1**. `qa.json → keyUniform`
  keeps the report and nothing else is written. Regenerate (retry budget), or matte with `--alpha-from`.
- **Requested hex:** `--expect-key <prompt KEY_HEX>` reports `drift`, and a warning appears above 64.
  `--max-key-drift N` turns the drift into a failure. Drift alone is not fatal: the art director
  approved D_H1 on olive, and the matte keys on the measured colour.
- **Forcing:** `--key RRGGBB` forces a colour and skips the gate, recorded as `mode: forced, skipped`.
  It warns when the border measures something else. `--key-tol P95,SPREAD` loosens the gate.

Keys that are not clean chroma keys (every channel clearly on or off: `#00FF00`, `#FF00FF`, `#0000FF`
and drifts such as `#F530F6`) use a **hue-axis spill**: a colour's chroma projected on the key's hue
axis, minus the chroma orthogonal to it. Next to an olive key, gold then scores about 0.13, where the
classic channel split would call it about 0.6 "key". Despill removes the excess along that axis, so
luminance is kept. The enclosed-hole radius shrinks to what the background noise needs: 6 × borderP95,
at least 24. `matte.keyLikeFgFraction` reports subject pixels that look like the key. On the real
D_H1 raw: key `#95C445`, borderP95 4.6, halo 0, handle opening keyed out, cassette door opaque.

## How the matte works (why it is exact on bible-compliant art)

The bible guarantees a **closed pure-black outline** on a **flat key colour** (the hex requested in
the prompt: `#00FF00`, `#FF00FF` for green/teal assets, `#0000FF` when both clash; the matte keys on
the *measured* colour, see above).

1. **Ink** = `max(R,G,B) < 70/255`. **Key-like** = within 90/255 RGB of the key *or* strongly
   key-hued (`min(key channels) − max(other channels) > 0.40`, which catches holes tinted by an AI glow).
2. **Background** = every region the ink separates from the image border (kills AI cast shadows,
   glows and gradients *outside* the outline) + enclosed regions that are mostly key-like (handle
   openings, letter counters; tiny specks are sealed as noise) + a *key flood* from the background
   through key-like pixels (reclaims the key inside a sealed outline gap).
3. **Seal**: outline gaps are closed with a disc dilation of radius `s`; `s` is chosen
   automatically as the smallest radius whose background "leak" (non-key pixels claimed away from
   the ink) is within tolerance of the best (`--seal N` forces it).
4. **Soft edge by unmixing**: an anti-aliased edge pixel is a blend of exactly two colours, the ink
   and the key, so alpha is its projection onto the ink→key line and its colour *is the ink*: zero spill.
   Off-line edge pixels keep binary alpha; fg pixels within 4 px of the edge are despilled
   (`min(key channels)` pulled down to `max(other channels)`).
5. **1 px alpha erosion** at master resolution, colour **bleed** under alpha 0 (straight-alpha
   textures never sample the key when filtered).
6. **Fit**: content max side (default; the runtime `SymbolRig.fit` scales by `max(w,h)`) or `--fit
   height` scaled to the target and **centred** on the canvas (anchor 0.5); premultiplied Lanczos,
   un-premultiplied out (**straight alpha**), a final despill on edge texels (Lanczos ringing), never
   upscaled (exit 2; `--allow-upscale` for drafts). Content that would overflow the canvas fails the gate.
7. **Gates** (exit 1, `--no-strict` to keep the file): halo = zero key-tinted edge pixels in the
   straight texels *and* composited on black and on white (art bible §10); canvas/pivot = 360×360,
   content within 2 px of target. QA → `build/qa/matte/<name>/{qa.json, qa_on_black.png, qa_on_white.png, manifest.json}`.

**Magenta/blue keys**: ffmpeg `despill` only knows green/blue; this matte is key-agnostic.

**Variants.** `blur` reproduces the runtime's derived blur (`src/assets/placeholder/variants.ts`):
rotate by `restAngle` into screen space, squash 0.97×1.12, 7 weighted ghost copies at ±{4.5, 9, 14}
design px, light vertical Gaussian, rotate back; `--blur-mode box` = the PIPELINE ffmpeg recipe
(`avgblur sizeY=14` @2x). `glow` = alpha dilated 7 px, Gaussian σ 14 px, radial smoothstep fade before
the canvas edge, **white** (the runtime tints it with the symbol colour; see [PIPELINE 2.1](../../docs/PIPELINE.md#phase-2-2d-generation)).

## Tests

```bash
tools/.venv/bin/python tools/matte/test/test_matte.py        # 21 tests, ~90 s
```
Synthetic art on `#00FF00` (warm), `#FF00FF` (teal + slop), `#00FF00` with a 3 px outline gap, and
`#0000FF` (gold + slop), 640 px drawn at 4×: **zero key-tinted edge pixels**, **alpha IoU vs ground
truth > 0.98 at master and canvas resolution** (measured 0.984–0.988 at 640 px; the 1 px erosion costs most of the rest), content 300 ± 2 px centred
± 1 px, fill colours unchanged (straight alpha), enclosed hole transparent, gap sealed only when
needed, byte-identical re-runs, manifest row valid; blur smear axis vertical (< 1.5°) after the
runtime rotation for restAngle 0 / −14 / −18.
**keyUniform:**
- synthetic gold art on the olive `#95C445` with `--expect-key 00FF00`: measured key, drift warning,
  IoU > 0.98, zero halo, gold unchanged;
- a lit (gradient) key: exit 1 and nothing written;
- white: "not a colour key", exit 1;
- `--max-key-drift`, and the forced-key warning;
- the hue-axis spill table;
- the real D_H1 raw when it has been downloaded.

## Doc snippet (docs/PIPELINE.md 2.1 "Then, either route")

```md
1. Matte: `tools/matte/outline_matte.py raw.png "build/pack/symbols{tps}/sym_<ID>.png" --symbol <ID> --key <KEY_HEX>`
   (or ToonOut / `tools/matte/rembg_matte.sh birefnet-general` + `--alpha-from`). Gates: halo, canvas/pivot.
2. Variants: `tools/matte/variants.py … --symbol <ID>` → `_blur` (runtime recipe) and `_glow` (white; tinted at runtime).
```
