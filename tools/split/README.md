# tools/split: part sheets → Spine parts, registered onto the rig master (PIPELINE 3.1)

CPU only: no SAM, no GPU. The Higgsfield part sheets are generated on a flat key with wide gaps between
the pieces ([`symbol_parts_sheet.txt#A`](../../art/bible/prompts/symbol_parts_sheet.txt),
[`mascot_parts_sheet.txt#B–E`](../../art/bible/prompts/mascot_parts_sheet.txt)). Because of that layout,
the closed-outline key matte ([tools/matte](../matte/README.md), measured key and `keyUniform` gate)
plus connected components cut them exactly. The operator (an agent) looks at a numbered preview and
writes a small mapping file (component → slot). Everything else is computed:
- registration onto the approved master;
- canvas placement, trim and pad;
- joints from the round overlap caps, and the biped landmarks;
- `parts.json` in the format [`tools/spine/gen.py`](../spine/README.md) reads (symbol kind and
  [character kind](../spine/README.md#character-parts-contract-what-the-split-stage-delivers));
- a reassembly check against the master.

| File | Does |
|---|---|
| `split.py` | CLI: `cut` (matte + numbered components + mapping stub), `build` (mapping → registered parts + `parts.json` + QA + previews), `preview` (re-check an edited `parts.json`) |
| `splitlib.py` | Matting and caching, components, masked NCC (FFT), SIFT features, ECC, warps, cap joints, joint-hole test, SSIM / IoU, previews |
| `make_synthetic_sheet.py` | Test data with exact ground truth from any `parts.json`: rig master + part sheets (scaled, rotated ±N°, noisy key) + `truth.json`, and `truth_mapping()` (the operator stand-in for tests) |
| `test/test_split.py` | Self-tests (see [Tests](#tests)) |

```bash
PY=tools/.venv/bin/python        # numpy, scipy, pillow, opencv-python-headless (tools/requirements.txt)
# symbol fits read cellScale from src/games/$GAME/config.ts: run Bass Drop with GAME=bass-drop
# 1. cut each sheet: matte on the MEASURED key, number the pieces in reading order, write a mapping stub
$PY tools/split/split.py cut art/_raw/chr_gumbo_parts_face/v01/raw.png --out build/split/gumbo/face \
    --expect-key FF00FF --plan-row chr_gumbo_parts_face
#    -> components.png (look at it), components.json (+ sheetEntry stub; guesses in plan order only when the counts match)
# 2. write the mapping (below), then build
$PY tools/split/split.py build art/source/mascots/gumbo/spine2d/split.json --lock-visible [--strict]
#    -> parts.json, images/<skeleton>/<slot>[/<attachment>].png, work/{report.json, preview.png, landmarks.png, variants.png}
# 3. review preview / landmarks / variants; add hints for anything UNVERIFIED; rebuild
# 4. after hand edits of parts.json: re-check
$PY tools/split/split.py preview art/source/mascots/gumbo/spine2d/split.json
```

Exit codes: `0` ok · `1` a gate failed with `--strict`, or `keyUniform` failed (a non-uniform or
non-colour key) · `2` usage, mapping or registration error.

## Mapping file

JSON. Relative paths resolve against the working directory (the repo root).

```json
{
  "kind": "character",                          // or "symbol" (then "symbol": "H1", canvas 360x360)
  "skeleton": "chr_gumbo", "facing": "right",
  "canvas": [868, 992], "anchor": [0.5, 1.0],   // character canvas = 2x the landscape design rect, root = feet
  "master": {"image": "art/_raw/chr_gumbo_rig_master/v01/raw.png", "expectKey": "#FF00FF"},
  "fit": {"mode": "feet", "height": 872},       // feet | symbol {contentPx} | matrix {scale, offset} | identity
  "defaultsFrom": "tools/spine/examples/character_demo/gumbo/parts.json",   // z, bone, parent, relative pivots per slot
  "out": {"parts": "art/source/mascots/gumbo/spine2d/parts.json", "images": "art/source/bass-drop/spine/images"},
  "pad": 3, "lockVisible": true, "motion": "affine",
  "landmarks": {"look": [800, 200]},            // explicit canvas landmarks win over derived ones
  "sheets": [
    {"id": "face", "image": "art/_raw/chr_gumbo_parts_face/v01/raw.png", "expectKey": "#FF00FF",
     "scale": "auto",                           // or a number (sheet px -> master px), or [lo, hi]
     "pieces": {
       "1": "head",
       "2": {"slot": "jaw"},
       "7": "eye_R/open",                       // slot/attachment
       "8": {"slot": "eye_R", "attachment": "half"},
       "12+13": "brow_R",                       // merge components (a piece the matte split in two)
       "21": null,                              // ignore (a stray mark); every component must be named or null
       "22": {"slot": "mouth", "attachment": "roar", "place": {"like": "mouth/closed_pick", "align": "back"}},
       "23": {"slot": "pupil_L", "place": {"near": [566, 150], "radius": 30}}
     }}
  ]
}
```

Piece fields: `slot` / `name` (symbol), `attachment`, `z`, `bone`, `parent`, `setup`, `hidden`,
`blend`, `color` (copied into `parts.json`); `joint` / `tip` (see [Joints](#joints-and-landmarks));
`place` (below); `motion` (`affine` | `similarity` | `translation`); `within` (the slot to search inside
of); `lock: false` (keep this piece's own pixels under `--lock-visible`).

`place` (registration hints; all coordinates are **canvas** units, like `parts.json`):
- `"auto"` (the default for setup attachments): register from the image.
- `{"near": [x, y], "radius": r}`: register, with the piece's centre within `r` of the point. The point
  can be eyeballed from `landmarks.png` / `preview.png`. Use `nearMaster` for master pixels.
- `{"at": [x, y], "anchor": "centre", "rotate": 0}`: place the piece there at the sheet scale, then
  snap to the visible master evidence if a fit within 10 units is clearly better (`snap: false` turns
  that off). Use this for pieces the master hides almost completely.
- `{"like": "<piece>", "align": "centre|top|bottom|left|right|top-left|…|back|front|joint", "offset": [dx, dy]}`:
  take another piece's transform and align the two pieces. This is the default for variants:
  - eyes etc.: `centre`;
  - mouths: `back` (the mouth corner, which depends on facing);
  - hands: `joint`, which matches the wrist region around the setup hand's joint, so every pose pivots
    at the same wrist.

## How the build works

1. **Matte** the master and every sheet on the measured key (tools/matte `measure_key`, `keyUniform`
   gate), cached by sha256 under `work/cache/`. An open outline that lets a fill leak into the background
   is reported (`matte.leakPx`), never silent.
2. **Components** (8-connected, alpha > 0.5) numbered in reading order (rows by vertical overlap, then
   x); tiny ones are `n1, n2 …` noise; `gapPx` warns when two pieces are closer than 6 px.
3. **Sheet scale** (sheet px → master px; one per sheet because the prompts ask for "the same scale"):
   - the inlier-weighted median of per-piece SIFT similarities (OpenCV);
   - else an explained-area search (the master pixels the pieces explain with agreeing colour, inside
     the silhouette);
   - then refined as the median of the accepted ECC fits.
4. **Registration**, in rounds:
   - Round 0 goes front to back and accepts only strong, unambiguous fits. Later rounds go parents
     first and search inside the registered parent's region, with thresholds that step down to the gate.
   - Each try: SIFT + RANSAC similarity, or masked NCC over the master pixels no registered piece
     explains. The piece must lie inside the master silhouette, where hidden parts sit behind something
     opaque. Twins and repeats keep up to 3 peaks.
   - Refinement: ECC (OpenCV, Euclidean then affine on a two-level pyramid), else a rotation-aware NCC.
   - A registered piece *claims* the master pixels it covers and matches. For a later piece, pixels
     claimed by a piece in front are "don't care", and pixels claimed by a piece behind are a conflict
     (it would hide what is visibly there).
   - `_L`/`_R` twins are ordered by occlusion after the rounds.
   - A last reassembly pass slides aperture-prone pieces (mostly hidden limbs, twins) along their axis
     when the composite then fits the master better.
   - Whatever never passes stays at its best guess, marked **UNVERIFIED**: a warning, and the
     `registration` gate fails. The previews still render, so the operator can add a hint.
5. **Fit**: master → canvas.
   - `feet`: the figure's soles on the canvas bottom, the midpoint of `foot_L`/`foot_R` at the anchor,
     and the figure `height` (default 0.88 × canvas height).
   - `symbol`: content = `cellScale × 300` from `src/games/$GAME/config.ts`, centred on the 360 canvas,
     the same math as `outline_matte.py`.
6. **Place** each piece through crop → master → canvas in one resample (Lanczos pre-filter for
   downscales, cubic warp). Faint alpha below 3/255 is cut, then the piece is trimmed and padded
   (`pad` 2–4). Colour bleeds under alpha 0. Straight alpha PNG.
7. **Joints and landmarks** ([below](#joints-and-landmarks)); variants aligned with `align: joint`
   are placed after the joints exist.
8. **`--lock-visible`** (PIPELINE 3.1 "original visible pixels stay locked"): where a piece is the
   top-most one in the rest pose it takes the master's colour, 2 px inside its own edge and 3 px away
   from any other piece's edge, so a front piece's antialiased outline is never baked into the piece
   behind it.
9. **Gates** (`report.json → gates`; `--strict` exits 1 on any failure):

| Gate | Rule | Source |
|---|---|---|
| `reassembly` | rest pose vs master in canvas space: **SSIM > 0.98** (luminance on mid grey, display scale: both images blurred by σ = 1 canvas px, which is half a display pixel on the 2× canvas) and **alpha IoU > 0.99**; `ssimNative` is reported too | ART_BIBLE §10 "Spine split" |
| `jointHoles` | rotate every jointed child ±35° about its joint: on the parent side of the joint nothing covered at rest may open (≤ 1.5 % of the region, the rotation's own resampling noise), and the joint must sit inside a cap (child's distance to its edge ≥ 3 px) | PIPELINE 3.1 |
| `registration` | every registered piece NCC ≥ 0.5 and none UNVERIFIED | – |
| `noUpscale` | no piece enlarged by more than 2 % from its sheet | ART_BIBLE: never upscale |
| `adultProportions` | characters: head slots' height ≤ 27 % of the figure's (headphones, cable, mic, toothpick excluded) | tools/spine character contract |

**Why SSIM is computed at display scale.** The master and the pieces reach the canvas through different
resampling chains (master 2k → canvas; sheet 4k → canvas; each matte erodes 1 px at its own resolution).
At native resolution the kernel differences dominate the score without being reassembly errors. On the
synthetic character, the exact ground-truth composite scores 0.961 native and 0.988 at display scale
against its own resampled master. A 2 px misplacement still shows at display scale.

## Joints and landmarks

**Cap joints** (PIPELINE 3.1 step 5: "joint = centroid of dilate(child) ∩ parent, snapped to the child's
round overlap cap"):
1. The search is seeded at the attaching end of the child:
   - limbs: the end away from their own child (the upper arm's end away from the forearm);
   - end pieces: the end toward the parent (hand → forearm);
   - the head: on the neck's top cap;
   - the jaw: at the back (the hinge, which depends on facing);
   - otherwise: at the overlap centroid.
2. A RANSAC circle is fitted through the child's boundary near the seed (its own cap, even where it pokes
   past the parent), or through the parent's boundary inside the child (the parent's cap). The better arc
   wins (≥ 100°, low residual, radius 0.45–1.9 × the child's half width there).
3. No cap: the seed is used and a warning asks to check `landmarks.png` (ART_PLAN wants caps).

**Biped landmarks** (character kind; the names of the
[parts contract](../spine/README.md#character-parts-contract-what-the-split-stage-delivers)):

| Landmark | From |
|---|---|
| `shoulder_X`, `elbow_X`, `wrist_X`, `hip_X`, `knee_X`, `ankle_X`, `neck`, `head`, `jaw` | cap joints of upper_arm/torso, forearm/upper_arm, hand/forearm, thigh/torso, shin/thigh, foot/shin, neck/torso, head/neck (or head/torso), jaw/head |
| `hips` | midpoint of the hip joints |
| `chest` | 30% of the way from neck to hips |
| `head_top` | top of the head above the skull base |
| `chin` | the jaw's farthest point forward |
| `hand_X` (knuckles) | 62% of the hand's reach along the forearm direction |
| `toe_X` | the front of the sole |
| no neck piece (Croak) | `neck` = the head/torso joint; `head` = 10% of the way toward `head_top` |

Mapping `landmarks` override any of them. Measured on the synthetic Gumbo: every cap landmark within
4 px of the rig's own. The conventions for `hips` (22 px), `chest` and `toe` differ from the placeholder
rig's by design.

**Part bones** (face features, props, symbol parts): the mapping's `joint`
(`[x, y]` | `cap` | `centre` | `top` | `bottom` | `left` | `right`), else the `defaultsFrom` slot's
pivot at the same relative position in the piece, else the centre. `tip` works the same way, plus `far`
(the farthest alpha point from the joint).

## Reviewing (what the operator looks at)

- `components.png` (cut): the numbered pieces. Name each of them; `components.json → expected` lists the
  plan row's pieces (`--plan-row`) and says whether the counts match (a merged or missing piece means a
  regenerate or a manual cut).
- `preview.png`: rest pose | master | |diff| ×4 (cyan = alpha mismatch) with the SSIM / IoU numbers.
- `landmarks.png`: every landmark and part joint over the rest pose.
- `variants.png`: every attachment of every multi-attachment slot swapped into the rest pose.
- `report.json`: per piece its registration (method, NCC, visible fraction, ambiguity, the round,
  the search region, SIFT inliers, alternatives), placement, joint fit and hole test, locked fraction.
  Also the sheets (key report, scale search) and the gates.

## Known limits

- **First real sheet** (`bd_c04 sym_W_parts`, formula D, on `#FD03F8`): `cut` separates the 4 pieces
  cleanly (minimum gap 33 px, zero matte leak). But registration onto the approved `sym_W_rig` v02
  flags all three mapped pieces **UNVERIFIED** (NCC 0.48–0.70), for two reasons:
  - the model re-drew them: the fang's lower stripe is a separate crescent, the cap is drawn from below,
    and the chain is at another scale;
  - the chain alone gave a wrong SIFT scale. The explained-area search now arbitrates single-piece
    feature scales.

  This matches the art director's note in `art/plan/approvals.json → sym_W_parts`. Re-drawn pieces need
  hints, or cuts from the master itself (a master-cut mode is not built yet), and the tool says so
  instead of placing them silently.

- **Flat, featureless or mostly hidden pieces need hints.** On the flat placeholder Gumbo, 10-12 of 30
  setup pieces come back UNVERIFIED without hints: the pupils, a closed-mouth line, the torso under the
  tank top, the far arm behind the torso. With `near` / `at` / `like` hints every piece lands within
  6 px (median < 1.5 px). Painted formula-D art gives SIFT far more texture to work with. The tool never
  calls a doubtful placement verified: the test asserts that no verified piece is more than 4 px off.
- **Reassembly SSIM on re-rendered sheets.** Part sheets are edit-mode re-renders, not cut-outs of the
  master, so the gate needs `--lock-visible`. On the flat synthetic character it reaches display-scale
  SSIM 0.965–0.98 with hinted hidden pieces (IoU 0.996); the synthetic symbol reaches 0.998. Recalibrate
  on the first real formula-D split before the gate may fail a row (ART_BIBLE §10).
- **Hidden-area fills** (NB2 masked inpaint, PIPELINE 3.1 step 4) are not done here: the part sheets
  paint hidden areas in. Missing fills show up as joint holes.
- **Other gaps.** No PSD export (step 8), and no scale ±15% hole test (only ±35° rotation).
- **Without OpenCV** (`SPLIT_NO_CV2=1`): there are no SIFT features and no ECC. Translation plus
  1.5° rotation steps land every part of the synthetic symbol within 1 px, with SSIM just under the
  0.98 gate.

## Tests

```bash
tools/.venv/bin/python tools/split/test/test_split.py                    # ~6-9 min: symbol + the character loop
SPLIT_TEST_QUICK=1 tools/.venv/bin/python tools/split/test/test_split.py # ~2-3 min: symbol + units
```

**Units:**
- masked NCC under occlusion;
- the cap-joint circle fit on a capsule;
- the joint-hole test (capsule 0 vs straight cut > 100 px);
- reading order.

**Symbol** (demo_symbol, key `#00FF00`, pieces at 3× with ±2° rotation, master at 4×):
- one component per piece, measured key;
- every part within 1.5 px and the sheet rotation recovered within 0.5°;
- SSIM > 0.98 and IoU > 0.99;
- make_blur → gen.py → validate.mjs pass;
- the no-OpenCV fallback;
- the `symbol` fit (300 px content, centred);
- mapping errors (unmapped or unknown component: exit 2);
- a non-uniform sheet (exit 1, keyUniform).

**Character** (the demo Gumbo, key `#FF00FF`, 4 sheets, 49 pieces):
- `--plan-row` expects the plan's 23 face pieces;
- without hints: no silent error, UNVERIFIED pieces reported, `--strict` exits 1;
- the operator loop (hints for exactly the flagged pieces, rebuild, at most 3 passes): it converges
  with nothing flagged, no verified piece more than 4 px off in any pass, every piece within 6 px, the
  cap landmarks within 5 px, limb joints hole-free, IoU > 0.99;
- gen.py + validate.mjs `--kind character` pass on the demo rig.yaml.

## Doc snippet (docs/PIPELINE.md 3.1)

```md
- **Do** (`tools/split/split.py`, CPU only; tools/split/README.md): `cut` each Higgsfield part sheet
  (measured-key matte + numbered components) → the operator names the components in a mapping file →
  `build --lock-visible`: SIFT/NCC + ECC registration onto the rig master (front to back, claims,
  twins, reassembly slide), canvas placement, cap joints + biped landmarks → `parts.json` for
  tools/spine/gen.py + preview / landmarks / variants sheets. UNVERIFIED pieces get `near` / `at` /
  `like` hints. The SAM route stays planned for splitting a master that has no part sheet.
```
