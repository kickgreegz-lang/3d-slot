# Bass Drop 2D mascots: Gumbo (`chr_gumbo`) and Baron Croak (`chr_croak`)

Production Spine 4.3 rigs on the real formula-D art (Phase C, batches `bd_c08`–`bd_c10`), built without the
Spine editor. This folder is the source of truth; the game loads the shipped copies in
`public/assets/bass-drop/mascots/` (`tools/.venv/bin/python tools/artqa/ship_mascots.py [--check]`: lossless-WebP
PMA pages, `_half` = the @0.5x pack, one provenance row per file) through `src/games/bass-drop/mascots/`
(cue → clip mapping, tracks, look-at and sync rules: DESIGN §16).

```
art/source/mascots/
  pipeline/            mastercut.py (the cut), jawsync.py (Gumbo mouth follows the jaw), faces.py (variant
                       previews), gridview.py (coordinate grids for authoring), prep.py, build.sh (end to end)
  gumbo/spine2d/       cut.yaml, rig.yaml, parts.json, points.json, images/chr_gumbo/**, rig_master.png
  gumbo/spine/         chr_gumbo.json + chr_gumbo.atlas + chr_gumbo.png (+ @0.5x atlas/page)   <- runtime set
  croak/spine2d/       cut.yaml, rig.yaml, parts.json, points.json, images/chr_croak/**, rig_master.png
  croak/spine/         chr_croak.json + chr_croak.atlas + chr_croak.png (+ @0.5x atlas/page)   <- runtime set
  croak/sheets/        design_sheet.webp (approved mascot_croak_sheet, 2560 wide, identity reference)
```

Rebuild (about 1 min each; `--capture` adds contact sheets of every clip):

```bash
art/source/mascots/pipeline/build.sh gumbo --cut --capture build/qa/mascots/final --scenarios all --publish
art/source/mascots/pipeline/build.sh croak --cut --capture build/qa/mascots/final --scenarios all --publish
```

Needs `tools/.venv` (tools/requirements.txt + requirements-spine.txt, OpenCV) and the raws in `art/_raw/`
(re-download with `NODE_USE_ENV_PROXY=1 pnpm gen:hf-ingest`; sha256-checked against `art/ledger/`).

## Why a master cut, not a sheet split

The body part sheets (`chr_*_parts_body`, 4 jobs) came back re-drawn: frontal torsos and garments, limbs
in other poses, a curled tail, Croak's c2 even with a head. None of it registers onto the approved rig
master (the same failure `tools/split` reports on `sym_W_parts`), and a retry repeats the redraw. So:

- **the setup pose is the rig master, pixel for pixel.** `mastercut.py` partitions the master with a
  watershed on the painted image (seed shapes per part + cut lines through continuous paint), gives
  outline ink to the front part, takes joint discs into the child (overlap caps that are exact at rest)
  and fills every area a moving part uncovers (inpaint / painted gradient fills, then an ink stroke on
  the new silhouette, never on pixels visible at rest). Reassembly: Gumbo SSIM 0.9985 / alpha IoU 0.9985,
  Croak 0.9986 / 0.9979 (gate 0.98 / 0.99);
- **the sheets supply what the master cannot:** hand poses, Croak's mouths, Gumbo's mouth interior, the
  cooler and the mic, each placed by two or three point pairs (wrist → knuckles, mouth corners, jaw
  hinge → snout tip) and colour-matched to the master;
- **eye states** (`open`, `half`, `closed`, `wide`) are painted over the master's own eye patch, so all
  four sit at the identical size and centre (the sheets' eyes are drawn at another angle).

Art-director verdicts per job: `art/plan/approvals.json` (`approvals` for the used sheets, `notApproved`
for the two body sheets per mascot). QA: `build/qa/chr_<id>/cut/` (rest | master | diff, rotation tests,
owners map, variant rows) and `build/qa/mascots/final/<id>/` (every clip).

## The rigs

| | Gumbo | Croak |
|---|---|---|
| Facing / near side | screen-right (master mirrored) / R | screen-left / L |
| Canvas @2x, root | 868×992, feet (434, 992) | 720×1260, feet (360, 1260) |
| Head share (gate ≤ 27%) | 22.0% | 22.8% |
| Bones / slots / mesh verts / physics | 37 / 23 / 395 / 7 | 37 / 22 / 369 / 5 |
| Atlas @1x (@0.5x) | 1144×1024 (648×512), 1 page | 1272×1020 (632×512), 1 page |
| Springs | tail ×4 (heavy: 2.4–2.8 Hz, ζ 0.35–0.4), belly, jowl, toothpick | pouch ×2, chain ×3 (3 Hz, ζ 0.3) |
| Swaps | eyes ×4, mouth `closed_pick/grin/open/roar`, hand_R `open/fist/point`, hand_L `open/fist/point/lean` | eyes ×4, mouth `closed/smile/open/O`, hand_R `open/point/fist/scratch/press`, hand_L `open/point/fist/fader`, `mic` (hidden) |
| Tempo | 0.92 | 1.06 |

`validate.mjs --kind character`: PASS, 0 warnings for both (exact clip lengths, event frames, loop seams,
one-shots ending on idle's first pose, IK reach, look response, springs settling, proportions, 1 page).

Deltas from ANIMATION_SET 5.1 / 5.2, forced by the approved masters:

- Gumbo: the body is one `torso` mesh (skin + tank top + belly painted together, belly jiggle through
  `phys_belly` weights), legs are one mesh each (`leg_L/R`: jeans + shin + boot, weighted hips → thigh → shin
  → foot), `neck` is a mesh with the jowl weighted to `phys_jowl_1`; the jaw is a rigid piece and the
  **mouth slot is the mouth interior behind it** (tongue, teeth, gold tooth) at four jaw angles:
  `jawsync.py` writes the mouth timeline from the jaw rotation, so an open jaw never shows a gap. No
  `teeth_upper`, `nostrils`, `brow_*` slots (painted into the head). The cooler stands at his near side,
  hip high, under the right fist (`cooler_body` behind the legs, `cooler_lid` hinged).
- Gumbo's far hand is **FK, no `ik_hand_L`**: in the landscape layout the lower-cabinet top (y ≈ 532) is
  above his head (rect top y 557, feet 1053), so the forearm cannot rest on it. The `lean` hand exists;
  the lean returns when the layout puts the cabinet top at chest height (≈ y 800) or he is scaled up.
- Croak: no `cable` (the master has none), no separate `lid_*` / `eye_bulge_*` (lids are the eye states,
  the bulges are part of the head), `shirt` is part of `torso` (the open shirt over the tank), the near
  sleeve rides `upper_arm_L`, the `cap` is part of the head piece and follows every nod and look; the cups
  (`cup_L/R`) ride their own bones under `neck`, not the head.

## Runtime needs (for the later `src/` integration)

- **Files:** `chr_<id>.json` + `chr_<id>.atlas` (PMA) + page PNG; `@0.5x` for low tier. The JSON's
  `skeleton.images` is a build path; the runtime loads the atlas. Target per ANIMATION_SET 0:
  `public/assets/bass-drop/spine/`, atlases `bd_chr_gumbo`, `bd_chr_croak`.
- **Tracks:** 0 body (every clip below), 1 additive overlays (`wild_land_react`, Croak `pouch_pump`:
  `trackEntry.mixBlend = add`, alpha 1, no mix-in), 2 face (`blink`, every 4–7 s at random, never while a
  track-0 clip keys the eyes), 3 look (runtime).
- **Mixes:** `defaultMix` 0.25 s (0.15 s in turbo); `bass_drop_charge → bass_drop` 0 (Croak; the charge
  ends on the drop's first pose); every one-shot returns to `idle` with the default mix (they end on
  idle's first pose, so the crossfade never swims); start `idle` at a random phase per mascot.
- **Look-at:** move `ctrl_look` (child of `root`, setup Gumbo (357, 818), Croak (−282, 1006) in skeleton
  units) in `spine.beforeUpdateWorldTransforms`, as an offset from its setup position: head +5° per 100
  units (clamped ±12°, mix 0.6), pupils 3 units per 100 (clamped Gumbo [5, 1.5], Croak [5, 4]); aim it at
  the meter on `meterHeat` / big wins, at the reels on anticipation, at the crowd (camera) otherwise.
  Pupils hide in `half` / `closed` / `wide` (those states carry their own pupil).
- **Events (frames at 30 fps):** Gumbo `win_big` `sfx:cooler_slam` f24, `fs_trigger` `sfx:cooler_slam` f36.
  Croak `react_small` `sfx:dj_scratch` f4, `bass_drop_charge` `drop_hit` + `sfx:button_slam` f14,
  `win_big` `sfx:dj_scratch` f10, `fs_trigger` `sfx:mic_drop` f36. Gameplay sync stays on the
  `BASS_DROP_TIMING` timeline; these events are foley. Timescale Croak's `bass_drop_charge` to the charge
  length (15 f at 1.0 = 500 ms).
- **Physics:** call `skeleton.physicsTranslate` / rely on the keyed hip jolts; springs settle in ≤ 2.5 s.
  Gumbo's boom (`bass_drop` f15) is a keyed 24-unit hip push, so the tail, belly and jowl react on their own.
- **Cue → clip** (DESIGN 20 / ANIMATION_SET 5): bored → `idle_bored`; meterHeat → Gumbo `meter_heat`,
  Croak `anticipation`; smallWin → `react_small`; point → `react_point`; bass drop → Croak
  `bass_drop_charge` → `bass_drop`, Gumbo `bass_drop` (its f15 = the boom); wild land → `wild_land_react`
  (track 1); spotUpgrade → Croak `pouch_pump` (track 1); big win → `win_big` → `celebrate`; feature
  trigger → `fs_trigger`; feature end → `fs_end`.
- **Empty runtime slots:** Gumbo `fx_sweat`, Croak `fx_note` (additive; code-drawn per ART_PLAN).

## Licence

Built from Higgsfield generations (Nano Banana Pro): build and preview only until the written Higgsfield
clearance is filed (`licenses/allowlist.json` → `higgsfield`). The shipped copies are release blockers:
`pnpm licence:audit` warns, `pnpm licence:audit --release` refuses them until the clearance is filed.
