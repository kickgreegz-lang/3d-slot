# tools/matte: key-colour matting, symbol canvas fit, blur/glow variants

| Script | Does |
|---|---|
| `outline_matte.py` | Key-colour + closed-black-outline matte → despill → 1 px erode → seal → fit on the **360×360 @2x** canvas → QA gates → provenance |
| `variants.py` | `<name>_blur.png` (vertical motion blur in screen space) and `<name>_glow.png` (soft white silhouette) on the same canvas |
| `mattelib.py` | The algorithms and metrics (IoU, halo, canvas report, `src/config/game.ts` targets) |
| `make_synthetic.py` | Test art: cel-shaded, outlined, extruded object with an enclosed key hole, 4× supersampled AA, exact ground-truth alpha; `--slop` adds a cast shadow + glow, `--gap` breaks the outline |
| `rembg_matte.sh` | Guarded optional model path: only `birefnet-general(-lite)` (the allowlist 'birefnet-rembg' models), always `-m … -dc`; never rembg's default BRIA RMBG-2.0 (denylisted) |

```bash
# raw generation -> AssetPack input (content = cellScale x 300 px from src/config/game.ts: H1 291, S 336, royals 258)
tools/.venv/bin/python tools/matte/outline_matte.py art/_raw/sym_H1/v03/raw.png "build/pack/symbols{tps}/sym_H1.png" \
  --symbol H1 --key 00FF00 --emit-master art/source/symbols/H1/master_2048.png --parent-id sym_h1.raw.v03 --manifest art/manifest.json
tools/.venv/bin/python tools/matte/variants.py "build/pack/symbols{tps}/sym_H1.png" --symbol H1 --parent-id <matte row id>
# model matte instead of the key matte (ToonOut/BiRefNet), same fit + gates
tools/matte/rembg_matte.sh birefnet-general raw.png art/_work/sym_H1_rembg.png
tools/.venv/bin/python tools/matte/outline_matte.py raw.png out.png --alpha-from art/_work/sym_H1_rembg.png --key 00FF00 --symbol H1
```

## How the matte works (why it is exact on bible-compliant art)

The bible guarantees a **closed pure-black outline** on a **flat key colour** (the same hex that went
into the prompt: `#00FF00`, `#FF00FF` for green/teal assets, `#0000FF` when both clash).

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
the canvas edge, **white** (the runtime tints it with the symbol colour; PIPELINE 2.1 still says gold).

## Tests

```bash
tools/.venv/bin/python tools/matte/test/test_matte.py        # 14 tests, ~45 s
```
Synthetic art on `#00FF00` (warm), `#FF00FF` (teal + slop), `#00FF00` with a 3 px outline gap, and
`#0000FF` (gold + slop), 640 px drawn at 4×: **zero key-tinted edge pixels**, **alpha IoU vs ground
truth > 0.98 at master and canvas resolution** (measured 0.984–0.988 at 640 px; the 1 px erosion costs most of the rest), content 300 ± 2 px centred
± 1 px, fill colours unchanged (straight alpha), enclosed hole transparent, gap sealed only when
needed, byte-identical re-runs, manifest row valid; blur smear axis vertical (< 1.5°) after the
runtime rotation for restAngle 0 / −14 / −18.

## Doc snippet (docs/PIPELINE.md 2.1 "Then, either route")

```md
1. Matte: `tools/matte/outline_matte.py raw.png "build/pack/symbols{tps}/sym_<ID>.png" --symbol <ID> --key <KEY_HEX>`
   (or ToonOut / `tools/matte/rembg_matte.sh birefnet-general` + `--alpha-from`). Gates: halo, canvas/pivot.
2. Variants: `tools/matte/variants.py … --symbol <ID>` → `_blur` (runtime recipe) and `_glow` (white; tinted at runtime).
```
