# tools/video: keyed loops, stacked-alpha MP4, flipbook frames

| Script | Does |
|---|---|
| `key_video.sh IN.mp4 OUT_DIR NAME` | fps normalise → **loop crossfade** on the opaque clip → denoise → `chromakey` (YUV) or `colorkey` (RGB) → despill (green/blue: ffmpeg `despill`; magenta: `geq` spill clamp) → alpha erode → premultiplied Lanczos scale → `NAME_0001.png…`; QA: frame count + loop seam |
| `stacked_alpha.sh FRAMES OUT.mp4` | RGBA frames → H.264 MP4, **premultiplied colour on top, alpha below** (research/PIPELINE 5.4 graph), even sizes, stacked-height cap (2160), BT.709 tags; decode-back verification (`stacked_check.py`) |
| `flipbook.py SRC OUT{tps}` | Frames → one AssetPack `{tps}` clip folder: union trim symmetric around the pivot (center / bottom-center), frame edges ×8, optional `--size`, `--every 2` (on twos), `--expect-frames` |
| `make_test_clip.sh` | Synthetic key clip (lavfi): outlined disc circling on the key, AA, H.264 4:2:0 |
| `ffenv.sh` | Sourced by all shell tools: resolves a **full** ffmpeg (`$FFMPEG` → imageio-ffmpeg static binary in `tools/.venv` → PATH) and checks the needed filters/encoders exist |
| `record.py` | Provenance rows for files or frame folders (folder sha256 = tools/blender folder digest) |

```bash
# AI key-colour loop (e.g. Higgsfield animatic or Wan) -> seamless keyed frames at 256 px, 24 fps
tools/video/key_video.sh art/_raw/fx_smoke/v02/raw.mp4 build/frames/fx_smoke fx_smoke --size 256 --fps 24 --fade 12 --key 00FF00
# -> AssetPack clip folder, trimmed around the centre pivot, 12 fps "on twos"
tools/.venv/bin/python tools/video/flipbook.py build/frames/fx_smoke "build/pack/fx_smoke{tps}" --name fx_smoke --every 2
# baked 3D insert (bottom-centre pivot, ANIMATION_CONTRACT 8.1), frame-count gate
tools/.venv/bin/python tools/video/flipbook.py build/frames/W_turn "build/pack/W_turn{tps}" --name W_turn --pivot bottom-center --expect-frames 24
# full-screen cinematic with alpha (bonus intro / big-win backdrop)
tools/video/stacked_alpha.sh build/frames/bigwin_bg public/assets/video/bigwin_bg.mp4 --fps 30 --crf 20 --shipped
```

**Loop crossfade.** For `N` input frames and fade `F`, output = `N − F` frames: frames `F…N−F−1`
play untouched, then the first `F` frames fade in (weights 0…1 *inclusive*) over the last `F`, so the
last output frame **is** input frame `F−1` and the wrap to `F` is an ordinary step. Gate: SSIM(last,
first) ≥ min consecutive-frame SSIM − 0.01.

**Runtime recombine** (stacked alpha): sample `top = (u, v/2)`, `a = texture(u, 0.5 + v/2).r`;
colour is already premultiplied → use premultiplied blending. VP9-alpha is Chromium/Firefox only and
HEVC-alpha needs a Mac encoder; stacked H.264 plays everywhere. Titles stay live text.

## Tests

```bash
PIPELINE_PY=tools/.venv/bin/python tools/.venv/bin/python tools/video/test/test_video.py   # 6 tests, ~10 s
```
Green and magenta synthetic clips (2 s @ 25 fps → 48 frames @ 24 fps → 36 looped frames): frame count,
size, transparent corners, disc area, **zero key-tinted edge pixels in every frame**, loop seam gate,
`--no-loop` (48 frames) and usage errors; stacked MP4 256×384, 36 frames, decode-back alpha MAE 0.22/255
(p99 6/255), colour MAE 0.41/255; a height-capped encode; flipbook: uniform ×8 sizes, the source
centre maps exactly to the output centre in every frame, byte-identical re-run, `--every 2 --size 96
--pivot bottom-center` gives anchor (0.5, 1) and 18 frames, `--expect-frames` mismatch exits 1.

## Doc snippet (docs/PIPELINE.md 5.3/5.4 "Out")

```md
- Keyed AI/Wan loops: `tools/video/key_video.sh` → `tools/video/flipbook.py` → `build/pack/<clip>{tps}/`.
- Stacked alpha: `tools/video/stacked_alpha.sh FRAMES public/assets/video/<name>.mp4` (verifies the decode).
```
