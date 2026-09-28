# Swamp Funk: Bass Drop: art status (phase C production review)

**As of 2026-09-28.** Reviewer: Claude (art director and technical reviewer for phase C). Read with [ART_PLAN.md](ART_PLAN.md)
(the plan and its rules), [STYLE_DECISION.md](STYLE_DECISION.md) (formula D and the painted environment),
[ANIMATION_SET.md](ANIMATION_SET.md) (every rig, slot and clip) and [ART_BIBLE §10](../../ART_BIBLE.md) (gates).

## 1. Verdict

**The P0 set is production quality and cohesive. It is ready for runtime integration as a build and preview set,
but not to ship until the Higgsfield clearance is filed (§5).** The P1 and P2 extras that have no credits are
0-credit stand-ins. They are clean, but they are flatter than generated art.

The in-game contact sheets (§3) show one consistent finish across the set. Symbols, wild, meter, lower cabinet,
emblems and both mascots share the same single-weight black outline, painterly soft-gradient rendering, glossy
highlights, key light from the upper left and thin cool rim. That finish matches the Dragonspire Frostfall
reference, without taking its identity (no dragons, no ice, no frame design, no names).

The weakest elements against that reference:

- **the frame**: a painted stand-in that is clean but plain next to Dragonspire's ornate dragon frame;
- **the missing hero props**: the corner horns and Croak's DJ booth are unfunded;
- **the logo**: a crest with a blank banner that is waiting for its word-mark.

**Credits.** The ledger holds **160 credits in 17 batches**, all downloaded and verified. The Higgsfield balance is
**7.5 credits**, below the 8-credit floor, so this review generated nothing. The account shows **134.25 credits spent
outside the ledger** on 2026-09-28 between 11:02 and 11:39 UTC:

| Model | Credits |
|---|---|
| Seedance 2.5 (video) | 96 |
| Seedance 2.5 (video) | 35 |
| GPT Image 2.5 Flare | 0.25 |
| GPT Image 2.5 Flare | 0.25 |
| GPT Image 2.5 Flare | 2.75 |

No Bass Drop track made those calls, and the GPT Image spend breaks the plan's no-OpenAI rule. **Someone must find
out which session or person spent them.**

## 2. What this review changed (0 credits)

| Change | Why | Where |
|---|---|---|
| **Formula-D frame pieces** `frame_beam` / `frame_post` / `frame_sill`. Painted cypress with gold bolts, brass post straps, outline, key light upper left and a cool rim | On the contact sheet, the phase-B flat-cel code frame was the worst cohesion break. The generated frame rows (`c12`/`c13`) are unfunded. The Frame module already takes these env keys (3-slice) | `art/source/ui/bass-drop/frame/` + `frame.json`; `tools/frame/` |
| **Formula-D royals** L1–L5 (A K Q J 10). Lilita One glyphs painted with bevel light, gloss, bounce and rim | Royals are more than half the board. The plan route was "vector + painterly gradient" (open decision 2), and nothing existed yet | `art/source/symbols/L1..L5/master_1024.png`; `tools/royals/` |
| **Board sprites = rig setup pose** (360 @2x) plus `_blur` / `_glow`, for all 10 symbols | Open decision 1: a beauty-matte board sprite pops when the runtime swaps to Spine. H2/H4's beauty sprites are superseded (new manifest rows) | `build/pack/symbols{tps}/` (build); `tools/artqa/board_sprites.py` |
| **Approval fix**: `chr_gumbo_rig_master` job id was **wrong** (156d6517 = the rejected curled-tail c1). It is corrected to **44daef4c** (c2, raw v02, the image the rig is cut from) | The ledger, the manifest raw rows (sha256) and the image content all agree. Side effect, already paid: batch `bd_c10` used the rejected image as the Gumbo view reference | `art/plan/approvals.json` (`correction` field) |
| **Provenance** for the 86 mascot files (parts, rig masters, runtime sets, design sheet), which the mascot build never recorded; rows for royals, frame and board sprites | Every `art/source` file must have a row | `art/manifest.json` (380 rows); `tools/artqa/prov_mascots.py` |
| Plan tests fixed: 2 tests assumed `bd_c01` was not in the real ledger | They now use the pre-production ledger (the real one without `bd_*` batches) | `art/plan/test/test_plan.py` |
| `tools/spine/test/run.sh` now defaults to `tools/.venv` | With the system `python3` it failed on the missing shapely | `tools/spine/test/run.sh` |
| `build.sh` for the symbol rigs was not executable | Mode is now `+x` | `tools/spine/examples/bass_drop/build.sh` |
| The `hf-ingest` egress message and README name `NODE_USE_ENV_PROXY=1` | Node's fetch ignores `HTTPS_PROXY`. The direct connection then gets `403 host_not_allowed` even for allowed hosts | `tools/gen/hf-ingest.mjs`, `tools/gen/README.md` |
| Stale docs updated: ART_PLAN status, keyUniform (now automated), tools/split (exists), CR-8 kinds, open decisions 1/2/8; PIPELINE tooling row and step 3.1, which now record the master-cut route that production actually used | Docs contradicted the repo | `docs/games/bass-drop/ART_PLAN.md`, `docs/PIPELINE.md` |
| Review tooling: rest-pose renderer, in-game contact sheets, board sprites, art audit, key table | Repeatable review | `tools/artqa/` |

## 3. In-game review (contact sheets)

`tools/.venv/bin/python tools/artqa/contact_sheet.py` → `build/qa/artqa/`. Every approved asset is composed at its
in-game size on the real plates, in the `src/games/bass-drop/layout.ts` rects:

- symbols fitted as `SymbolRig.fit()` does: cellScale × cell, restAngle;
- mascots from their Spine setup poses, canvas contain-fitted with the feet on the rect bottom;
- the meter and the lower cabinet from their rigs.

Sheets:

- `landscape_{base,jukejam,megamix}.png`, `landscape_base_{hud,neon,grey,phaseBframe}.png`;
- `portrait_{base,jukejam,megamix}.png` (+ `_hud`, `_neon`, `_grey`);
- `symbols_124.png`;
- `vs_reference.png`.

The Dragonspire captures are study-only and never committed.

**What holds (AAA finish):**

- **One style.** Outline weight reads the same on symbols, meter, cabinets and mascots at display size (about 3 px at a
  124 px cell).
- **Light.** It comes from the upper left everywhere, including the mirrored Gumbo.
- **Palette.** Plum-black cabinets, gold, teal enamel and hot pink sit together in the violet-teal night room.
- **Background calm behind the reels.** Landscape panel L* is 0.231 against 0.333 on the left and 0.228 on the right.
  Detail (Laplacian) is 3.2 in the panel against 6.8 on the left and 4.4 on the right. Portrait panel L* is 0.216 against
  0.265 on the left and 0.211 on the right. The painted plate is darker and calmer behind the reels.
- **Readability at 124 px, greyscale.** Every symbol keeps a distinct silhouette. The largest pairwise silhouette IoU is
  **0.806 (H1 boombox vs H2 sleeve)**, under the 0.85 gate. Royals differ by glyph.
  - Value against the tier-0 tile (luminance 44): the darkest symbols are A (68), H2 (78) and H3 (84). All read.
  - H3 is the one that relies most on its silhouette: thin limbs, and antennae that make its fitted body small.
- **Characters.** Both are appealing, adult-proportioned and on-model:
  - head share: Gumbo 22.0 %, Croak 22.8 %;
  - facing: Gumbo faces screen-right, Croak screen-left;
  - Croak's rest face is the wide grin, far from the meme-frog read;
  - at 1:1 on skeleton units: no halo (the edge ring is dark ink, measured) and no seams.

**Open composition defects** (not art-fixable, so owners are named):

1. **The HUD overlaps both mascots in landscape.** The spin button (Ø 250 at 1747,800) covers Croak's torso, and
   menu and bonus buy sit on Gumbo's head and belly. Dragonspire keeps its HUD in a bottom bar. *Owner:
   DESIGN §15 / layout.json.*
2. **Portrait: the horn rects overlap the mascots' feet and tail** (horn R 930,486 against Croak's feet; horn L against
   Gumbo's tail) once the horns exist. *Owner: DESIGN §15.*
3. **The logo rect doesn't fit the emblem.** The rect is 428×236 (1.81:1) and the emblem is 1.12:1, so the emblem
   shows small until the word-mark is set on its banner. In portrait, the 600×110 rect is a word-mark shape. *Owner:
   typographer and DESIGN.*
4. **Gumbo cannot lean on the lower cabinet.** The cabinet top (y 532) is above his head. The `lean` hand exists.
   *Owner: DESIGN (move the cabinet top to about y 800 or scale Gumbo).*
5. The portrait meter cabinet at scale 300/640 comes out about 330×394, while its rect is 320×360. The runtime has to
   fit the ring, not the cabinet.

## 4. Inventory and verdict per asset

Ids and jobs: `art/plan/approvals.json`. Rows: `art/manifest.json`. Measured keys: `build/qa/artqa/key_table.json`. Every
keyed job passes the automated keyUniform gate. Olive drift was keyed on the measured colour: D_H1, H3 rig, H3 eyes,
H3 parts.

Verdicts:

- **A**: ship-ready once the clearance is filed.
- **B**: good, with a noted caveat.
- **C**: 0-credit stand-in; replace when funded.
- **—**: missing.

### 4.1 Symbols

| Asset | Files | Rig | Verdict |
|---|---|---|---|
| H1 Golden Boombox | `symbols/H1/master_rig_1024.png`; parts `spine/images/sym_H1/` | `sym_H1`: 12 bones / 8 slots / 3 physics. Tape door, speaker pump, antenna | **A**. The rig master is the board sprite. The antenna comes from the c11 sheet, because the master lacks one |
| H2 Vinyl Record | `symbols/H2/master{,_rig}_1024.png`; `sym_H2/` | 9 / 6. The record rolls out and spins | **B**. The sleeve is loose brushwork (paintover candidate). The board sprite is now the rig pose |
| H3 Crawfish | `symbols/H3/master_rig_1024.png`; `sym_H3/` | 14 / 8 / 214 verts / 4 physics. Eye states from c11 | **A**. Lowest value contrast of the highs. Relies on its silhouette |
| H4 Hot Sauce | `symbols/H4/master{,_rig}_1024.png`; `sym_H4/` | 15 / 7 / 3 physics. Cork pop, slosh | **A** |
| W Wild | `symbols/W/master_rig_1024.png`, `pieces/` (ribbon, badge t1–t5, flame, clamps), `parts/`; `sym_W/` | 19 / 12 / 92 verts / 2 physics. Skins `default` / `mult` / `sticky` | **A**. Badge t1–t3 are close in luminance (hue map only), so DESIGN's greyscale check fails there. The clamps come from c1 job 3c70a485 (partial use, noted) |
| L1–L5 Royals | `symbols/L1..L5/master_1024.png` | none (the ANIMATION_SET 2.5 light rig is not built; the runtime animates the sprite) | **B/C**. Procedural formula-D glyphs, clean and on-palette. Glossy "candy" rather than carved wood. An AI material pass is optional |

### 4.2 Groove Meter, stage and frame

| Asset | Files | Verdict |
|---|---|---|
| `ui_groove_meter` | `ui/bass-drop/groove_meter/master.png`, `ui/meter/{parts.json,rig.yaml,bassdrop.yaml}`, `spine/images/ui_groove_meter/` (34) | **A**. 22 bones / 22 slots, kind ui, all 13 ANIMATION_SET §3 clips. Woofer remapped radially to DESIGN 6.1 bands. The parts sheet was rejected (perspective), and the plan fallback was used. Skins base / jukejam / megamix / bare |
| Notch icons | `ui/bass-drop/emblems/notch/` | **B**. Downscaled emblems. At 40 px the speaker icon is busy |
| `env_speaker_stack` (lower cabinet) | `env/speaker_stack/`, `env/spine/images/env_speaker_stack/` | **C+**. Built from the meter cabinet (plan fallback); the cables and ports are procedural. 9 slots / 13 bones |
| `env_dj_booth` | — | **— unmade** (`c12`/`c13`). The runtime keeps the code-drawn phase-B booth (`src/games/bass-drop/stage/boothArt.ts`) |
| `env_horn` ×2 | — | **— unmade** (`c12`/`c13`; no 0-credit fallback). The runtime keeps the phase-B code horn |
| Frame beam / post / sill | `ui/bass-drop/frame/` | **C**. Formula-D stand-in (this review). Cohesive; plain next to Dragonspire's ornate frame. The generated `frame_*` rows are unfunded. No corner cap: the horns take the corners |

### 4.3 Backgrounds (`backgrounds/bass-drop/`, WebP)

| Asset | Verdict |
|---|---|
| `base_landscape` (2560×1280, a 2:1 crop of the adopted plate + a calm-centre grade), `base_portrait` (1536×3072) | **A**. The darker-centre gate passes. The gator sign sits at the right edge after the 1:2 crop, so phones taller than 1:2 clip it |
| `base_{landscape,portrait}_neon` | **B**. Procedural neon extraction (plan fallback); aligned by construction |
| `jukejam_*`, `megamix_*` (+ `_neon`) | **C+**. Code grades of the base plates (fog, beams, wall specks). Shapes cannot swim in the crossfade. They are not painted repaints |
| `tile_landscape` | **C**. Brightened night plate, stop-gap for the P2 tile |

### 4.4 Emblems, cards, logo (`ui/bass-drop/`)

| Asset | Verdict |
|---|---|
| `emblems/jukebox.png` | **A**. The rainbow lamp bands will fail palette ΔE. The arched silhouette evokes the classic 1946 jukebox: include it in the trademark search |
| `emblems/mega_speaker.png` | **A**. A wall of six cabinets, not the three-high stack in the brief |
| `emblems/jukebox_cracked.png` + `jukebox_shards/` (6 + `shards.json`) | **B**. Procedural cracks that match the shatter exactly |
| `cards/art_{meter,jukejam,megamix}.png` | **C**. Composites of approved pieces over a plate crop (plan fallback). Clean, but no shared scene lighting |
| `logo/logo_emblem.png` + `logo_emblem.json` (banner text box) | **C**. Crest from approved parts with a blank banner. The mirrored right fang is lit upper right |

### 4.5 Mascots (`mascots/`, 2D Spine, master cut)

| Asset | Verdict |
|---|---|
| `chr_gumbo`: `gumbo/spine/chr_gumbo.{json,atlas,png}` + `@0.5x`, `spine2d/` sources | **A**. 37 bones / 23 slots / 395 verts / 7 physics. Reassembly SSIM 0.9985, IoU 0.9985. Acting is readable but moderate: near-arm raises stop at about 100°, so pump, point and party use the far arm |
| `chr_croak`: `croak/spine/chr_croak.{json,atlas,png}` + `@0.5x`, `spine2d/`, `sheets/design_sheet.webp` | **A**. 37 / 22 / 369 / 5. SSIM 0.9986, IoU 0.9979. `bass_drop` reads but is understated for the game's biggest beat; an animator polish pass is recommended |
| Deltas from ANIMATION_SET 5.1 / 5.2 | Forced by the approved masters (no tank_top, belly or teeth_upper slots on Gumbo; no cable or lids on Croak; the cap is in the head). Documented in `art/source/mascots/README.md` |

## 5. Missing, unfunded or blocked

**Needs credits** (top up first, in this order; spec with `build_plan.py`, none of these batches is in the ledger):

1. **`c12` (8) + `c13` (12)**: horn, DJ booth and lower-cabinet masters and parts, frame beam / post / sill / cap. The
   stage props are on screen all the time.
2. `c14` (12): a generated logo emblem and intro cards, only if the composites are judged not enough.
3. `c15` (24): painted Juke Jam / Mega Mix plates and neon layers (the code grades exist).
4. P2: `c21` (10: tile plate, right horn, 2 buy-card illustrations) and `c22` (16: variant neon layers).
5. Reserves not used: NB2 masked fills (`fills_p0` 6, `fills_p1` 4.5). One use would be a raised-arm part for the
   mascots' near arms.

**No credits needed, not built:**

- **UI screen rigs:** `ui_intro_cards`, `ui_buy_cards`, `ui_feature_intro` / `_upgrade` / `_outro`, and the `ui_bigwin`
  `bassdrop` skin (ANIMATION_SET §6). The art for them exists (emblems, cracked + shards, cards, logo). The runtime
  draws code placeholders today.
- **Royal light rig:** ANIMATION_SET 2.5.
- **Meter:** the `lap_1..5` slots and the `lap` clip (P2).
- **FX flipbooks:** Blender, PIPELINE phase 5; live-particle fallbacks exist.
- **Word-mark:** SWAMP FUNK / BASS DROP, from a typographer, on the blank banner.
- **Production exports:** `.skel` files and the shared `symbols` / `bd_ui` / `bd_env` atlases from `tools/spine/export.sh`,
  which needs a licensed Spine seat.
- **Demos:** the character demo rigs under `tools/spine/examples/character_demo` still show the old slot lists (Gumbo
  chain, Croak cable). They are test fixtures only.

**Clearance (blocks shipping, not building):**

- **Higgsfield written clearance.** It must be filed in `licenses/clearances/` (`licenses/allowlist.json` →
  `higgsfield`: `clearance: pending`). It covers training opt-out, real-money gambling use including EU/UK, output
  ownership and pass-through of Google's terms.
- **Higgsfield ToS archive.** No `licenses/tos/higgsfield/` exists: all 66 generation rows have `tosVersion: null`.
- **Trademark search.** It covers the word-mark and the jukebox silhouette.
- **SynthID disclosure policy.** To agree with counsel.
- Until the clearance is filed, **nothing from `art/source` may enter `public/assets`**. `pnpm licence:audit` fails any
  shipped file whose chain holds a non-cleared licence.

## 6. Technical status

| Check | Result |
|---|---|
| Provenance | `tools/artqa/check_art.py --strict`: 263 files, **0 errors**. Every file has a current-sha256 row. Every chain reaches a Higgsfield generation row (jobId + promptHash) or an owned licence. Every generation ancestor is an approved job. Warnings: the W clamps' partial use of 3c70a485 (noted in approvals), and one superseded H3 source row (append-only history). `pnpm licence:audit`: **PASS** (380 rows, 0 errors; the 73 warnings are the known `tosVersion: null` and exemptions) |
| Ingest | `NODE_USE_ENV_PROXY=1 pnpm gen:hf-ingest status`: 17 batches, 160 credits, 66/66 downloaded. `check`: ok |
| Key uniformity | `tools/artqa/key_table.py`: all 38 keyed jobs (approved and not approved) pass |
| Tests | Details below. All green |
| Rigs | Every rig rebuilds **byte-identical** from its sources. Strict validation results below |
| Size policy | Every file ≤ 1.36 MB (largest: `emblems/mega_speaker.png`). Symbols and parts ≤ 1024 px. Character masters ≤ 1536 tall (the Croak design sheet is a 2560×1086 WebP). Backgrounds ≤ 2560 wide. Atlas pages ≤ 2048. Frame strips at 2× runtime size (1876 × 132). `art/source` totals 38.7 MB |
| Git hygiene | Nothing from `art/_raw`, `art/_work`, `art/_reference`, `build/` or `tools/.venv` is tracked or staged. No commits were made by this review |

Test results:

| Suite | Result |
|---|---|
| `tools/gen` | 36/36 |
| `tools/gen` hf-ingest | 12/12 |
| `tools/matte` | 21/21 |
| `tools/split` | 14/14 (578 s) |
| `tools/spine/test/run.sh` | all passed: units, demo chain, 22 + 23 CR-8 + 23 character validator tests, export tests |
| `art/plan/test/test_plan.py` | 16/16 |
| `build_plan.py --check` | up to date (68 rows) |

Rig validation:

| Rig | Command | Result |
|---|---|---|
| `sym_H1..H4` | `validate.mjs --strict` (high, `--cell 360`) + `check_bd --strict` | 0 warnings, with and without the atlas |
| `sym_W` | `validate.mjs --strict` (wild, `--cell 368`) + `check_bd --strict` | 0 warnings, with and without the atlas |
| `ui_groove_meter` | `validate.mjs --strict` (ui) | 0 warnings, with and without the atlas |
| `env_speaker_stack` | `validate.mjs --strict` (env) + `check_env` | 0 warnings |
| `chr_gumbo`, `chr_croak` | `validate.mjs --kind character --strict` | **PASS, 0 warnings**, against both the @1x and @0.5x atlases |

## 7. Runtime integration list (the later `src/` + `public/assets` step)

**Precondition:** the Higgsfield clearance is filed (§5). Until then, previews load from `build/` or `art/source`.
Target folder: `public/assets/bass-drop/`. Relative URLs only. Never list a file that is not shipped.

### 7.1 `ART_MANIFEST` (`src/games/bass-drop/art.ts`)

**`symbols`**, 30 entries: `{id, variant: 'static'|'blur'|'glow', src: './assets/bass-drop/symbols/sym_<id>[_blur|_glow]@2x.webp'}` for
H1–H4, W and L1–L5.

- Source: `build/pack/symbols{tps}/sym_<id>{,_blur,_glow}.png`, built by `tools/artqa/board_sprites.py` (360 @2x
  canvases; board sprite = rig setup pose).
- Convert to WebP and name the files `@2x`.
- The glow is white: the runtime tints it with `SYMBOLS[id].color`.

**`spine`** (`ManifestSpine`):

- `H1`–`H4`, `W` → `./assets/bass-drop/spine/sym_<id>.{json,atlas}` (from `build/spine/bd/`, built by
  `tools/spine/examples/bass_drop/build.sh <ID>`).
- Production swaps in `.skel` + the shared `symbols` atlas via `export.sh`.
- Royals: no rig. They use the static-sprite motion.

**`env`** (`EnvArtKey`):

| Key | File |
|---|---|
| `bg_landscape` | `base_landscape.webp` |
| `bg_portrait` | `base_portrait.webp` |
| `frame_beam` / `frame_post` / `frame_sill` | `ui/bass-drop/frame/*.png`, loaded at resolution 2 (the Frame module's `prodPart` slicing is the contract; `frame.json`) |
| `logo` | the logo emblem composited with the typeset word-mark (after the trademark search) |
| `panel` | none: keep the code glass |

**Missing keys.** `EnvArtKey` has only one `bg_fs_*` pair, but Bass Drop has **two** feature looks and **neon layers**.
Add keys, or let the Bass Drop stage module load them directly:

- `bg_jukejam_{landscape,portrait}` and `bg_megamix_{landscape,portrait}`;
- `*_neon` for base, jukejam and megamix;
- the tablet plate (open decision 10).

### 7.2 Backgrounds (swap and pulse)

- Cover-fit the 2:1 and 1:2 plates.
- The neon layer is an **additive** sprite over its plate. Pulse its alpha on the beat (base 600 ms, Juke Jam 566, Mega
  Mix 536, `STAGE_LOOK.beatMs`).
- Crossfade base → jukejam / megamix behind the feature intro wipe (1.4 s, `modeCrossfade`). The shapes are identical,
  so nothing swims.
- The tile plate is for the ACP tile only.

### 7.3 Stage props

**Groove Meter** (`ui_groove_meter.{json,atlas}`), in the meter module (`src/games/bass-drop/meter/MeterRig.ts`):

- Root = ring centre. Scale = `ringOuterD / 640` (landscape 0.5).
- Skin by mode: `base` / `jukejam` / `megamix`, and `bare` + `setAttachment('rim_trim', …)` in compact.
- Mounts: `led_arc`, `txt_count`, `fx_blast`, `chip`.
- Notch states: `setAttachment('notch_N', 'notch_<w1|w2|w3|jj|mm>_<off|next|lit|spent>')`. Move `fx_notch` to the
  active notch.
- Tracks:
  - 0: idle / heat_loop / armed_loop / overdrive_loop / charge / charge_chained / boom / feature_trigger;
  - 1: tick / pump / drain;
  - 2: threshold_minor / threshold_major.
- Events (all garnish): `charge_start`, `boom`, `threshold_hit`, `pump_hit`.

**Lower cabinet** (`env_speaker_stack`), replacing `stage/LowerCabinet.ts`'s code art:

- Anchor = bottom centre (248, 852), scale 0.5. Not shown in compact.
- Track 0: `idle` / `boom_follow` (on the meter's boom) / `feature_follow`.
- Track 1: `pump` on beats.
- Tint `fx_glow` per mode.

**Booth and horns:** keep `stage/Booth.ts` and `stage/Horn.ts` (code) until `c12`/`c13` are funded. They are phase-B
flat-cel and will clash like the old frame did.

**Frame:** the env keys above. The neon tube, the panel glass and the tube light stay code.

### 7.4 Mascots

Files: `chr_gumbo` / `chr_croak` `.{json,atlas,png}` (+ `@0.5x` for the low tier) → `public/assets/bass-drop/spine/`.
Atlases are `bd_chr_gumbo` and `bd_chr_croak` (PMA). This replaces the 3D placeholder module (`src/mascots/`) with 2D
Spine characters:

- Fit the 2× canvas into `layout.mascots.left` / `.right` (contain), with the feet on the rect bottom centre
  (landscape scale exactly 0.5).
- Tracks: 0 body; 1 additive overlays (`wild_land_react`, Croak `pouch_pump`); 2 face (`blink` every 4–7 s); 3 look.
- Mixes: default 0.25 s (turbo 0.15 s). Croak `bass_drop_charge → bass_drop` 0.
- **Look-at:** offset `ctrl_look` from its setup position (Gumbo (357, 818), Croak (−282, 1006)) in
  `beforeUpdateWorldTransforms`:
  - head +5° per 100 units, clamp ±12°, mix 0.6;
  - pupils 3 per 100 units, clamp Gumbo [5, 1.5] and Croak [5, 4].
- Cue → clip mapping: `art/source/mascots/README.md`.
- Events: Gumbo `sfx:cooler_slam` (win_big f24, fs_trigger f36). Croak `sfx:dj_scratch`, `drop_hit` +
  `sfx:button_slam` (bass_drop_charge f14), `sfx:mic_drop`.
- Empty fx slots: `fx_sweat` (Gumbo), `fx_note` (Croak).

### 7.5 Wild specifics (`sym_W`)

- Skins: `default` (base), `mult` (Juke Jam), `sticky` (Mega Mix).
- A sticky wild flies and lands in `mult`, then switches to `sticky` at `sticky_lock`.
- After any `setSkin` + `setupPoseSlots`, set the badge tier again (`badge_t1..t5`) at `mult_swap`.
- Live text on `txt_wild` ("WILD", i18n) and `txt_mult` ("×N").
- Mixes as in `tools/spine/examples/bass_drop/README.md`.

### 7.6 Emblems in the screens

| Screen | Art |
|---|---|
| `ui_feature_intro` / `_outro` | `emblem` = `jukebox.png` (skin jukejam) or `mega_speaker.png` (skin megamix) |
| `ui_feature_upgrade` | `emblem_old` = `jukebox.png`, swapped to `jukebox_cracked.png` at the `crack` event f12. `shard_1..6` show at f18 at their `shards.json` boxes (1024 canvas) and fly along `burst`. `emblem_new` = `mega_speaker.png` |
| `ui_intro_cards` | `card_1..3_art` = `art_meter` / `art_jukejam` / `art_megamix`. Square masters with the subject in the central 2/3: tall crop for landscape, wide crop for portrait |
| `ui_buy_cards` | Until P2: `card_1_art` = crop of `art_jukejam`, `card_2_art` = crop of `art_megamix` |
| Meter notches | the 20 notch badges already live in the meter rig |

The code-drawn screen art in `src/games/bass-drop/screens/art/` is what these replace.

## 8. How to reproduce this review

```bash
NODE_USE_ENV_PROXY=1 pnpm gen:hf-ingest status            # ledger vs local raws
for id in H1 H2 H3 H4 W meter; do tools/spine/examples/bass_drop/build.sh $id; done
tools/bdart/build_env.sh speaker_stack
art/source/mascots/pipeline/build.sh gumbo; art/source/mascots/pipeline/build.sh croak
node tools/artqa/render_rest.mjs                           # every rig's setup pose -> build/qa/artqa/rest
tools/.venv/bin/python tools/artqa/contact_sheet.py        # in-game contact sheets + metrics.json
tools/.venv/bin/python tools/artqa/board_sprites.py        # board sprites + blur/glow
tools/.venv/bin/python tools/artqa/check_art.py --strict   # provenance, approvals, sizes, git hygiene
tools/.venv/bin/python tools/artqa/key_table.py            # keyUniform per job
pnpm licence:audit
```
