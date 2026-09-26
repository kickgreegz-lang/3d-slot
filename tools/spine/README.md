# tools/spine: AI-authored Spine 4.3 symbols and 2D characters

Claude writes a small `rig.yaml`. The tools here turn it into a Spine 4.3 skeleton that follows
[ANIMATION_CONTRACT](../../docs/ANIMATION_CONTRACT.md) §2–§4, then gate it on the official runtime and
render it on the real Pixi runtime for review. No Spine editor is needed until the canonical `.spine`
import and the production pack (PIPELINE 3.4).

The same path builds **2D Spine characters** (`kind: character`: the Bass Drop mascots `chr_gumbo` and
`chr_croak`, [ANIMATION_SET §5](../../docs/games/bass-drop/ANIMATION_SET.md#5-mascots-2d-spine-characters)):
a biped rig from part landmarks, foot/hand IK, look-at, spring bones, attachment swaps and the whole §5
clip list, authored from named motion presets. See [2D characters](#2d-characters-kind-character) and the
[character parts contract](#character-parts-contract-what-the-split-stage-delivers) that the Higgsfield
mascot part sheets must follow.

```
parts.json (split stage)  ┐
rig.yaml (Claude)         ┴─► gen.py ─► skeleton.json ─► validate.mjs ─► pack.py ─────────► preview/capture.mjs ─► critique
                                              │            (gate)        (AI-rig atlas)      (spine-pixi-v8 frames)      │
                                              └────────► export.sh: Spine CLI import / clean / export binary / pack ◄─────┘
                                                          (licensed workstation, production)                 edit rig.yaml
```

| File | What it does |
|---|---|
| `gen.py` | `rig.yaml` + `parts.json` → Spine 4.3 JSON: bones, slots, skins, meshes, one `constraints[]`, physics, and the full animation set with events. `kind: character` rigs go to `spinegen/character.py` |
| `spinegen/` | Generator library: `easing` (presets → absolute beziers), `timeline`, `motion` (contract animations + accents), `mesh` (grid / alpha-trace + weights), `physics`, `rig`, `provenance`; for characters `character` (biped rig builder) and `acting` (poses, motion presets, overlap, FK/IK helpers, Hermite key fitter) |
| `contract.json` | Machine-readable copy of the contract (windows, events, budgets, physics presets, runtime aliases). Both `gen.py` and `validate.mjs` read it. `characters` holds the ANIMATION_SET §5/§10/§12 character kind: budgets, bone words, clip windows and, per rig, the exact clip lengths, tracks, events and attachment sets |
| `validate.mjs` | Contract gate on `@esotericsoftware/spine-core` 4.3.13; `--kind character` runs `validate-character.mjs` |
| `pack.py` | Deterministic `.atlas` (4.x text, PMA) + page PNG packer, so generated rigs load in-engine without the Spine editor |
| `make_blur.py` | `<part>_blur.png` spin-blur variants (vertical box blur on a padded canvas) |
| `export.sh` | Spine CLI wrapper: pinned patch, stdout teed, **fails on any warning line** |
| `config/pack-symbols.json` | Default Spine CLI pack settings (contract §2.2). Production copy belongs in `config/spine/pack-symbols.json`; `export.sh` prefers that file when it exists |
| `preview/` | Vite-free preview page (`index.html` + `preview.mjs`, import map into `node_modules`), `serve.mjs` static server, and `capture.mjs` (Playwright contact sheets) |
| `examples/demo_symbol/` | End-to-end demo: `make_parts.mjs` (resvg-js cel-shaded parts), `rig.yaml`, `parts.json`, `images/`, `build.sh`, `provenance.json` |
| `examples/character_demo/` | Both mascots on procedural placeholder parts: `make_parts.mjs`, `gumbo/` + `croak/` (`rig.yaml`, `parts.json`, `images/`), `build.sh` |
| `test/` | `run.sh` (everything), `test_spinegen.py`, `test_character.py`, `validate.test.mjs` (baseline + 21 negative cases), `validate_character.test.mjs` (baseline + 22), `export.test.sh` + `fake-spine.sh` |

Shipped demo: `public/assets/spine/demo/{sym_demo.json, sym_demo.atlas, sym_demo.png}` (PMA, 568×512).

## Setup

```bash
python3 -m venv tools/.venv && tools/.venv/bin/pip install -r tools/requirements-spine.txt   # PyYAML, numpy, pillow, shapely
export PYTHON=$PWD/tools/.venv/bin/python
pnpm install     # spine-core, spine-pixi-v8, pixi.js, @resvg/resvg-js, playwright are already in package.json
```

## The AI workflow (who does what)

| Step | Who | Command | Output | Gate |
|---|---|---|---|---|
| 1. Parts | split stage (`tools/split`, PIPELINE 3.1) or `make_parts.mjs` for vector art | – | `images/sym_<ID>/<part>.png` (2x, 2–4 px padding) + `parts.json` | rest-pose SSIM/IoU (split stage) |
| 2. Blur variants | script | `$PYTHON tools/spine/make_blur.py <parts.json> [--provenance f]` | `<part>_blur.png`, `blur: true` in parts.json | – |
| 3. Rig | **Claude writes `rig.yaml`** (bones, physics, meshes, motion overrides, accents, events) | – | `art/source/symbols/<ID>/rig.yaml` | – |
| 4. Generate | script | `$PYTHON tools/spine/gen.py art/source/symbols/<ID>/rig.yaml -o build/spine/sym_<ID>.json` | 4.3 JSON | generator errors (names, budgets, phys pairing, windows) |
| 5. Validate | script | `node tools/spine/validate.mjs build/spine/sym_<ID>.json` | report (`--report file.json`) | **exit 0 required** |
| 6a. Test atlas | script | `$PYTHON tools/spine/pack.py --images art/source/spine/images --skeleton build/spine/sym_<ID>.json --out build/spine --name sym_<ID>` | `.atlas` + `.png` | `validate.mjs … --atlas` exit 0 |
| 6b. Production | [W] licensed seat | `tools/spine/export.sh symbol <ID>` | `.spine`, `.skel`, `symbols.atlas` (+@0.5x) | no warning line in the Spine output |
| 7. Review | script + Claude vision | `node tools/spine/preview/capture.mjs --skel … --atlas … --out qa/sym_<ID>/spine` | `<scenario>.png` sheets, `trace.json` | PIPELINE 3.5 critique: no "major" issue |
| 8. Iterate | Claude | edit `rig.yaml` (`motion.*`, `accents`, `physics`) and repeat from 4 | – | – |

Claude never types keyframes or curve numbers: every key comes from the motion library, and every curve is computed from a named easing preset.

### Demo, end to end

```bash
PYTHON=$PWD/tools/.venv/bin/python tools/spine/examples/demo_symbol/build.sh \
    --build-dir build/spine/demo --capture build/spine/demo/capture
```

The script renders the parts, adds blur variants, runs `gen.py` → `validate.mjs` → `pack.py` → `validate.mjs --atlas`, publishes to `public/assets/spine/demo/`, and appends provenance rows to `examples/demo_symbol/provenance.json`. With `--capture` it also records contact sheets on spine-pixi-v8. Nothing is published unless every gate passes.

Test everything: `PYTHON=… tools/spine/test/run.sh [--capture]`.

## rig.yaml reference

All coordinates are **image space of the 360×360 @2x canvas** (x right, y down), the same space as `parts.json`. The generator converts them to Y-up skeleton space with `root` at the canvas centre.

```yaml
symbol: H3                     # required → skeleton sym_H3, attachment paths sym_H3/<part>
parts: parts.json              # default parts.json next to rig.yaml
kind: high                     # high | special | royal | any (validator profile; default from contract.json)
spine_version: 4.3.23          # skeleton.spine; pin the editor patch (default contract.json)
feet_y: auto                   # squash bone y (skeleton units); auto = bottom of opaque content
body_y: auto                   # body bone y; auto = centre of content
bones:                         # extra bones (root/squash/body are automatic). joint = origin, tip = direction+length
  - {name: phys_antenna_2, parent: phys_antenna_1, joint: [262, 125], tip: [268, 86]}
  - {name: ctrl_look, parent: body, joint: [180, 200]}          # or rotation: <deg world>, length: <px>
meshes:                        # parts drawn as meshes instead of regions
  body: {type: trace, spacing: 40, weights: {mode: vertical, stops: [[body, 300], [phys_jelly, 170]]}}
  antenna: {type: grid, cols: 2, rows: 6, weights: {mode: idw, bones: [phys_antenna_1, phys_antenna_2]}}
physics:                       # strength = (2πf)²·mass, damping = exp(−2ζ·2πf/60); limit 12000, fps 60
  - {bone: phys_antenna_1, preset: default, rotate: 1, inertia: 0.6}     # presets floppy|default|stiff|jelly
  - {bone: phys_jelly, f: 5, zeta: 0.3, x: 1, y: 1, rotate: 0}
constraints:                   # optional IK / transform / slider maps (4.3 format); physics goes above
  - {type: transform, name: eyes_follow, bones: [face_eye_L], source: ctrl_look, properties: {x: {to: {x: {}}}}}
motion:                        # per-symbol overrides of the contract defaults (see table below); false disables
  land: {squash: 0.85, rebound: 0.06, frames: 12}
  dim: {enabled: true}
accents:                       # overlap on top of the base motion; at = frame or marker[+/-n]
  land: [{bone: face_eye_L, type: squash, amount: 0.25, at: impact+1}]
  win_loop: [{bone: face_speaker_L, type: pulse, amount: 0.1, beats: 2}]
events:                        # extra payload events: sfx = SfxId, vfx = FX id, shake = trauma 0-1
  win: [{name: vfx, at: peak, string: fx_sparkle}]
skins: {gold: {body: body_gold}}   # optional skins: part → variant image (same size)
compat: {runtime_aliases: false}   # true = also emit the legacy names anticipation_loop, impact, burst
```

**parts.json** (written by the split stage): `{symbol, canvas: [360, 360], images: "images", parts: [{name, bbox: [x, y, w, h], z, bone, parent?, joint?, tip?, blend?, color?, blur?}]}`. Images live at `<images>/sym_<ID>/<name>.png`, with `<images>` relative to parts.json. In the production layout (parts.json in `art/source/symbols/<ID>/`, parts in `art/source/spine/images/sym_<ID>/`) that is `"images": "../../spine/images"`, and `gen.py -o build/spine/sym_<ID>.json` then writes the contract's `skeleton.images` = `../../art/source/spine/images/`. `bbox` must match the PNG size.

Unknown keys anywhere in rig.yaml (top level, `bones[]`, `meshes.*`, `physics[]`, `accents.*[]`, `events.*[]`, `compat`, `roles`) and `accents`/`events` for an animation that is not generated are errors, so a typo never silently falls back to the defaults. Keys starting with `$` or `x_` are comments.

**Bone rules**:
- Names are snake_case with contract prefixes: `ctrl_`, `ik_`, `phys_`, `face_`, `fx_`.
- `fx_*` bones are children of `root`.
- Every `phys_*` bone has a physics constraint with the same name.
- Rotation physics needs a bone length, so give the bone a `tip`.
- Bones named `face_eye*` get blinks.
- Part bones other than body and fx fly apart in `explode`.

**Mesh rules**:
- `trace` outlines the part's alpha with shapely and places Delaunay interior points. The triangles are rasterised to prove every opaque pixel is covered; if not, it retries with more padding.
- `grid` is a regular grid.
- Weights come from `vertical` (smoothstep between bone stops) or `idw` (inverse distance to bone segments). Every vertex gets at least 1 bone, and weights are rounded so they sum to 1.
- `pack.py` never strips whitespace from mesh regions.

### Motion parameters (defaults = contract; override under `motion.<anim>`)

| Anim | Frames | Key parameters (defaults) | Events / markers |
|---|---|---|---|
| `idle` (loop) | 90 | `breath` 0.015 (sy), `breaths` 1, `sway` 1.5°, `blink_frame` 62 | markers `start`, `end` |
| `land` | 12 | `pre_stretch` 0.05, `squash` 0.85, `rebound` 0.06, `settle` 0.015, `keys` [0, 2, 5, 8], `volume` 1 (sx = 1/√sy), `impact_frame` 0, `sfx`/`vfx` | `land_impact` @impact; markers `impact`, `squash`, `rebound` |
| `win` | 24 (≤ 27) | `dip` 0.9 @4, `pop` 1.25 @8, `under` 1.05 @13, `over` 1.13 @18, `settle` 1.10, `wiggle` 4°, `glow_peak` 1, `glow_scale` 1.12 | `win_peak` @peak; markers `dip`, `peak` |
| `win_loop` (loop) | 40 | `pulse` 0.04, `beats` 2, `sway` 2°, `bounce` 0.03, `glow` [0.6, 0.95] | markers `beat0…` |
| `anticipation` (loop) | 16 | `lub` 1.06, `dub` 1.045, `shake` 1.5°, `glow` [0.35, 0.9], `sfx` | markers `lub`, `dub` |
| `anticipation_intro` / `_out` | 9 / 8 | `pop` 1.08 / `dip` 0.97 | – |
| `explode` | 12 | `burst_frame` 2, `squeeze` 0.9, `burst_scale` 1.3 @4, `end_scale` 1.38, `scatter` 150, `spin` 70°, `body_fade` [3, 9], `fade_from` 5, `vfx`/`sfx`/`shake` | `explode_burst` @2, `explode_done` @end |
| `appear` | 9 | `from` 0.55, `over` 1.08, `fade_frames` 3 | – |
| `blur` (loop) | 2 | swaps every slot with a `_blur` image | – |
| `blink` (overlay, track 2) | 5 | `closed` 0.1 | – |
| `dim` (overlay, track 1) | 0 | disabled by default; `tint` 7f7f7f | – |

These hold by construction, and the validator checks them:
- Loops end exactly on their first key.
- `win` ends on `win_loop`'s first pose, so the mix can be 0.
- `land`, `appear` and `anticipation_out` end on the setup pose.
- `explode` ends at alpha 0.

Accent types:
- `pump`: uniform scale pop.
- `squash`: sx up, sy down, then overshoot.
- `wiggle`: damped rotation.
- `hop`: translate y.
- `pulse`: loop-safe scale beats.
- `sway`: loop-safe rotation.

An accent on a bone/property the base motion already keys is an error, so the conflict is never silent.

**Headroom (open contract conflict):** the validator's `land` gate is the contract's literal rule: the pose, with the physics kick applied in both directions, stays inside ±150 skeleton units around `root`. But `SymbolRig.fit()` rescales every rig so its rest content fills `cellScale` of the cell (highs 0.95–0.97, specials 1.02–1.12; ART_BIBLE cellFill = 288–300 / 306–345 px @2x). So authoring the art smaller buys no headroom in the game, and a special sized per the art bible fails this gate at rest. The validator's `runtimeFit` info line shows what the game will show, for example the demo: rest 112 % of the cell at cellScale 1.12, and land adds +9.8 % at the top. Until [ANIMATION_CONTRACT §3.1](../../docs/ANIMATION_CONTRACT.md#31-land-contact-frame-and-cell-gate-open-decision) decides (allow overflow into the gap, cap the rebound, require headroom, or define the gate relative to the rest silhouette), pass `--cell <units>` for specials and review with `runtimeFit`. The demo is 257 px tall (86 %) and does not follow the art bible fill.

## validate.mjs

```bash
node tools/spine/validate.mjs <skeleton.json> [--atlas <file.atlas>] [--kind auto|high|special|royal|any|character] \
     [--cell 300] [--kick 36] [--cell-scale f] [--report out.json] [--strict] [--quiet]
```

**Static checks** (on the JSON):
- a `4.3.x` header and fps 30;
- no 4.2 root `ik`/`transform`/`path`/`physics` arrays. spine-core 4.3 silently drops those;
- constraint order IK → transform → path → physics → slider;
- bone names and prefixes; `root` → `squash` → `body` hierarchy; `fx_*` under root;
- each `phys_*` bone paired with a physics constraint of the same name; limit ≥ 10,500; the 100/0.85 editor default flagged; the implied Hz and ζ printed;
- budgets: ≤ 30 bones, ≤ 250 mesh vertices, ≤ 8 slots, no clipping;
- no sequence attachments; no file extensions in region names; additive blend only on `fx_*` slots;
- weighted vertices valid (≥ 1 bone, weights sum to 1);
- curve arity (4 numbers per channel);
- `sfx` payloads are `SfxId`s (parsed from `src/game/events.ts`); `vfx` payloads are FX ids.

**Runtime checks** (`SkeletonJson` + `AtlasAttachmentLoader`; a synthetic atlas unless `--atlas` is given):
- the required animations exist for the kind;
- frame windows hold, and `win` ≤ 900 ms;
- no NaN. Every animation is stepped with physics at 60 Hz until 2 frames past its end;
- required events fire, and `explode_burst` lands on frame 2–3;
- loop seams match, sampled with loop=false;
- the end poses match (see the list under the motion table);
- `land` squashes the `squash` bone to sy 0.83–0.87 (warning), inside the 0.80–0.88 feel gate (error), with sx = 1/√sy (warning beyond ±0.03);
- `land` stays inside the cell with the kick applied (default ±36 = `SpineRig`'s 26 × the largest runtime land multiplier 1.378, a `special` landing at max velocity), plus the `runtimeFit` report line described under **Headroom**.

Exit codes: 0 = pass; 1 = failure (with `--strict`, warnings also fail); 2 = usage error.

## pack.py (AI-rig atlases)

```bash
$PYTHON tools/spine/pack.py --images <root> (--skeleton <json> ... | --prefix sym_H1) --out <dir> --name <atlas> \
    [--scale 1 --scale 0.5] [--max 2048] [--padding 2] [--no-strip] [--no-pma] [--pot] [--check] [--provenance f]
```

- Output is a Spine 4.x text atlas:
  - `pma: true`, with the page pixels actually premultiplied;
  - `bounds`, plus `offsets` when whitespace was stripped;
  - page sizes are multiples of 4.
- Packing is MaxRects with fixed tie-breaks, so identical inputs give byte-identical outputs. `--check` fails on drift.
- Regions are never rotated. The production atlas still comes from the Spine CLI: polygon packing and rotation.

## export.sh (Spine CLI; licensed workstation only)

```bash
export SPINE=/opt/spine/Spine.sh SPINE_VERSION=4.3.23      # an exact 4.3 patch; betas and "latest" are refused
tools/spine/export.sh symbol H1              # import -r → clean -m → export -e binary (+ json copy in build/) → pack -p
tools/spine/export.sh import build/spine/sym_H1.json art/source/spine/sym_H1.spine
tools/spine/export.sh import-anims build/spine/sym_W.anims.json art/source/spine/sym_W.spine sym_W win win_loop
tools/spine/export.sh version                # runs $SPINE -u $SPINE_VERSION --version (PIPELINE phase 0 pin check)
tools/spine/export.sh [--dry-run] [--log-dir build/spine/logs] [--settings file] clean|export|pack …
```

- Every step tees stdout to `build/spine/logs/<step>.log`. A step fails on a non-zero exit **or** on any line matching `warn|error|exception|missing|not found|could not|unable to|failed` (override with `SPINE_FAIL_PATTERN`), because the CLI exits 0 on missing images.
- Skeleton, animation and atlas names must match `[A-Za-z0-9_][A-Za-z0-9_.-]*`: they go into Spine's `--to`/`-a`/`-n` and into log file names.
- It **cannot run in a cloud session**: there is no Spine licence there.
- Argument handling is tested with `test/fake-spine.sh` (`test/export.test.sh`, 34 cases, including name sanitising for log paths).

## Preview and capture (real runtime, no Vite)

```bash
node tools/spine/preview/serve.mjs --port 5231
#   → http://127.0.0.1:5231/tools/spine/preview/index.html?skel=/public/assets/spine/demo/sym_demo.json&atlas=/public/assets/spine/demo/sym_demo.atlas
node tools/spine/preview/capture.mjs --skel public/assets/spine/demo/sym_demo.json --atlas public/assets/spine/demo/sym_demo.atlas \
     --out qa/sym_demo/spine [--scenarios land,win,explode,idle,anticipation,appear,blur] [--kick -27] [--tile 224]
```

`capture.mjs` binds the rig the same way as ANIMATION_CONTRACT §5:
- `land` is a scripted reel stop. The symbol falls in `blur` with position inheritance off. At contact the script calls `setPositionInheritance(0, 0.6)` and `physicsTranslate(0, kick)`, then `land` (mixInterpolation smooth) → `idle`.
- The contract mixes are set (default 0.08, land→idle 0.15, win→win_loop 0, …).
- The clock is stepped at exactly 1/60 s, one screenshot per 30 fps frame.

Each sheet shows the frame number, ms and events, plus a motion plot: squash sy, body scale, and each physics bone's rotation or dy. Tiles are 224 px, so the 300 px cell reads at about 160 px, the in-game review size.

`--kick` uses runtime y-down units:
- **−27** is the contract research value (`−impact·0.006`): the parts overshoot downward.
- The runtime (`SpineRig.impact`) now calls `physicsTranslate(0, −26·squash)`, the same sign. The validator still checks both signs (±36 by default) until ANIMATION_CONTRACT §10.4 is signed off in `?dev=lab`.

## Registering a rig in the game (`src/assets/manifest.ts`, owned by src)

The loader accepts only relative `./` URLs and loads the skeleton and atlas with `Assets.load` (spine-pixi-v8 registers the `.json`/`.skel` and `.atlas` loaders). The entry shape is `ManifestSpine`:

```ts
// src/assets/manifest.ts  (ART_MANIFEST.spine)
spine: [
  // production (Spine CLI export, shared PMA atlas)
  { id: 'H1', skeleton: './assets/spine/sym_H1.skel', atlas: './assets/spine/symbols.atlas' },
  // the AI demo rig, borrowed by the H1 cell for an in-game test
  { id: 'H1', skeleton: './assets/spine/demo/sym_demo.json', atlas: './assets/spine/demo/sym_demo.atlas' },
],
```

`id` is the `SYMBOLS` key; add `skin: 'gold'` for a non-default skin. For a quick in-game check without editing `src/`, the dev harness can load it with `await __symbolsDemo(__slot.ctx, { ids: ['H1'] }).loadSpine('H1', { skeleton: './assets/spine/demo/sym_demo.json', atlas: './assets/spine/demo/sym_demo.atlas' })`.

`SpinePool` (`SPINE_EVENT`, `SPINE_ANIM`) accepts both the contract names (`land_impact`, `explode_burst`, `anticipation`) and the legacy ones (`impact`, `burst`, `anticipation_loop`), and sets the §3 per-pair mixes, so generated rigs need no aliases. `compat: {runtime_aliases: true}` still emits the legacy names for older runtimes.

## Provenance

- `gen.py` and `pack.py` accept `--provenance <rows.json>` and `--manifest art/manifest.json`. They append rows that are compatible with `art/manifest.schema.json`:
  - `route: code`, `vendor: self`;
  - `refHashes` = the sha256 of every input (rig, parts, images);
  - ids are content-addressed (`<asset>.<sha8>`), so re-runs never duplicate rows.
- The default `licenseId` is `owned-code`. That id must be added to `licenses/allowlist.json` before licence-audit runs (see the report). Pass `--license-id` to override.

## 2D characters (kind: character)

ANIMATION_SET §11 assumed character rigs need the Spine Editor and a human animator. They do not have
to: the character path authors the rig and the whole §5 clip list from data, gates it on spine-core
and renders contact sheets, so Claude can iterate on the acting the same way it does on symbols. A
human animator can still polish the result in the editor (the JSON imports like any symbol rig).

```
Higgsfield part sheets
  └─ matte, split, register to the rig master (split stage) ─► parts.json + images/chr_<id>/… ─┐
rig.yaml (Claude: stance, poses, clips from motion presets) ─────────────────────────────────────┤
                                                                                                  ▼
gen.py ─► chr_<id>.json ─► validate.mjs --kind character ─► pack.py (1 page) ─► validate.mjs --atlas
                 └───────► capture.mjs contact sheets (spine-pixi-v8) ─► critique ─► edit rig.yaml
```

| Step | Command | Gate |
|---|---|---|
| 1. Parts | split stage, or `node tools/spine/examples/character_demo/make_parts.mjs` for the placeholders | [parts contract](#character-parts-contract-what-the-split-stage-delivers) |
| 2. Generate | `$PYTHON tools/spine/gen.py art/source/mascots/gumbo/rig.yaml -o build/spine/chr_gumbo.json` | generator errors (names, budgets, contract clip lengths/events, poses, presets) |
| 3. Validate | `node tools/spine/validate.mjs build/spine/chr_gumbo.json` (`chr_*` → `--kind character`) | exit 0 |
| 4. Atlas | `$PYTHON tools/spine/pack.py --images <images root> --skeleton build/spine/chr_gumbo.json --out build/spine --name chr_gumbo` then `validate.mjs … --atlas build/spine/chr_gumbo.atlas` | one page ≤ 2048² |
| 5. Review | `node tools/spine/preview/capture.mjs --skel build/spine/chr_gumbo.json --atlas build/spine/chr_gumbo.atlas --out qa/chr_gumbo [--scenarios idle,bass_drop,fs_trigger\|all]` | PIPELINE 3.5 critique |
| 6. Iterate | edit `poses`, `clips.*.keys` / `layers` / `drag`, springs | – |

Demo, end to end (placeholder parts for both mascots, about 15 s without capture):

```bash
PYTHON=$PWD/tools/.venv/bin/python tools/spine/examples/character_demo/build.sh --capture qa/character_demo
```

It renders the parts, then per mascot runs gen → validate (synthetic atlas) → pack → validate (real atlas),
writes provenance rows and, with `--capture`, the idle / bass_drop / fs_trigger sheets
(`--scenarios all` for every clip plus `charge_drop`, `look` and `win_celebrate`). Output goes to
`build/spine/character_demo/`; nothing is published.

### Coordinates, facing and signs

- **Canvas** = 2× the landscape design rect of the mascot (layout.json `mascots.*`): Gumbo 868×992, Croak
  720×1260 units. Image space (x right, y down), like `parts.json`.
- **`root`** = the feet point (`anchor: [0.5, 1.0]`, the bottom centre = layout.json `mascots.*.feet`). Never keyed.
- **Facing**: `facing: right` (Gumbo) or `left` (Croak). Every pose value is **facing-normalised**, so the two
  mascots share one vocabulary and the generator mirrors a left-facing rig:
  - `rot` = degrees, + = counter-clockwise *as if the character faced right* (bow forward, nod down,
    jaw open are negative; lean back, raise an arm forward are positive);
  - `x` / `y` = screen units, + x = **forward** (toward the reels), + y = up. They are converted into
    the parent bone's setup frame;
  - `sx` / `sy` = bone-local scale factors (sx along the bone, sy across), `s` = both.
- `_L` / `_R` are the character's own sides. Gumbo's near side is R, Croak's is L (ART_BIBLE `bassDrop.mascots.*.nearSide`).

### rig.yaml (kind: character)

```yaml
kind: character
skeleton: chr_gumbo            # required, chr_<id>; attachment paths chr_gumbo/<slot>[/<variant>]
parts: parts.json
facing: right                  # right | left
tempo: 0.92                    # 0.5-2: drag lag and settle lengths scale by 1/tempo (ANIMATION_SET: Gumbo 0.92, Croak 1.06)
template: biped                # bones from parts.json `landmarks` (see the parts contract)
ik: {feet: true, hands: [L]}   # foot IK (feet ride ik_foot_*), optional hand IK targets ik_hand_* (mix keyed per clip)
landmarks: {look: [800, 200]}  # optional overrides of parts.json landmarks
bones:                         # extra bones (springs, props, fx): joint / tip in canvas image space
  - {name: phys_tail_1, parent: hips, joint: [352, 646], tip: [262, 700]}
inherit: {neck: noScale}       # default; never put noScale on an IK chain (spine-core 2-bone IK assumes normal inheritance)
slots: {fx_sweat: {bone: fx_sweat, blend: additive}}   # empty runtime slots; per-slot blend / color / setup / z
draw_order: [...]              # optional explicit back-to-front slot list (default: parts.json z)
meshes: {torso: {type: trace, spacing: 56, weights: {mode: vertical, stops: [[chest, 380], [spine, 520], [hips, 650]]}}}
physics: [{bone: phys_tail_1, preset: floppy, rotate: 1, inertia: 0.5}]   # limit defaults to 6000 for characters
look: {head: {mix: 0.6, deg_per_100: 5, max: 12}, pupils: {per_100: 3, max: [6, 5]}}
face: {hide_pupils: [half, closed]}   # eye states whose art carries its own pupil
drag: {lag: 2, gain: 0.45, body: 0.5} # default overlap for body clips
stance: stance                 # the in-game base pose (Gumbo leaning on the cabinet, Croak on the decks)
poses: {...}
clips: {...}
```

Every key is checked; a typo is an error (`$…` / `x_…` keys are comments). `match_ik: true` (default)
writes the FK angles that reproduce each IK chain into the stance, so an IK → FK blend starts where the
limb really is.

**Generated rig** (template biped): `root` › `hips` › `spine` › `chest` › `neck` (noScale) › `head` › `jaw`;
`upper_arm_X` › `forearm_X` › `hand_X` off the chest; `thigh_X` › `shin_X` off the hips; `ik_foot_X` under
root with `foot_X` riding it (planted feet); `ik_hand_X` under root when listed; `ctrl_look` under root in
front of the face. Constraints, in the 4.3 order: `ik_foot_L/R` (+ `ik_hand_*`) with `bendPositive` taken
from the setup pose (`cross(knee − hip, ankle − knee) > 0` in y-up space), `look` (transform:
`ctrl_look` local y → head rotation, additive, clamped, mix 0.6), `look_eyes` (`ctrl_look` x/y → pupil
x/y, mix 1), then the springs.

### Poses

```yaml
poses:
  stance:                          # base: none = from the setup pose; every other pose defaults to base: stance
    base: none
    hips: {y: -8}
    upper_arm_R: {rot: 4}
    place: {ik_hand_L: [300, 482]} # put a bone (IK target, ctrl_look, prop) on a canvas point
    ik: {ik_hand_L: 1}             # IK mixes (0 = FK)
    attach: {hand_L: lean, mouth: closed_pick, eyes: open}   # slot or group (eyes, pupils, brows, lids, hands)
  slam:
    hips: {x: 24, y: -44}
    spine: {rot: -26}
    reach: {hand_R: [640, 716]}    # FK solve: upper arm + forearm put the wrist on the canvas point
    look: [300, -40]               # ctrl_look offset (x forward, y up)
```

A pose is the base pose with its own channels **replaced**; unmentioned bones keep the base values.
`reach` is re-solved in every derived pose, so a pose that bends the torso keeps the hand on its target.

### Clips

The clip list, lengths, loop flags, tracks and events come from `contract.json characters.rigs.<skeleton>`
(= ANIMATION_SET §5.1 / §5.2). A rig.yaml may omit them; if it states a different length, loop, track or
event frame, `gen.py` fails. Missing required clips fail.

```yaml
clips:
  bass_drop:
    keys:                          # pose-to-pose; `ease` = how the move ARRIVES at the pose
      8: {pose: brace, ease: sine_in_out}
      14: {pose: brace_deep, ease: hold_out}      # anticipation
      15: {pose: blown, ease: expo_out}           # action (the boom)
      27: {pose: recover_over, ease: sine_in_out} # follow-through / overshoot
      36: {pose: rest, ease: sine_in_out}
    swap: {eyes: {3: half, 15: wide, 28: open}, mouth: {15: open, 30: closed_pick}}
    layers:
      - {preset: flick, bone: toothpick, at: 15, amount: 170, frames: 18}
    events: [{name: sfx, string: cooler_slam, at: 24}]   # contract events are added automatically
    drag: {lag: 1, gain: 0.3}      # per clip; false = off
```

- Frame 0 and the last frame default to `rest`. For body clips (track 0) `rest` of a one-shot is **idle's
  first frame**, so every one-shot starts and ends where the base loop starts (the return crossfade never
  swims). Loops end exactly on their first pose (checked). `end: hold` keeps the last key (used by
  `bass_drop_charge`, whose last pose is `bass_drop`'s first: the mix is 0).
- Body clips reset every swappable slot on frame 0 (a clip never inherits the previous mouth or hand).
- Tracks: **0** body; **1** additive overlays (`wild_land_react`, `pouch_pump`: base `none`, keys are
  deltas from the setup pose, played with `trackEntry.additive = true`); **2** face (`blink`: attachment
  swaps only, never a body bone); **3** look: the runtime moves `ctrl_look` (offset from its setup
  position, skeleton units) in `spine.beforeUpdateWorldTransforms`, after the state is applied.
- `rot`/`x`/`y` of `ctrl_look` may also be keyed by a clip (`meter_heat` looks at the meter); a runtime
  look drive overrides it.

**Motion presets** (`layers`; loop-safe presets need whole cycles in loops, which is checked):

| Preset | Principle | Parameters (defaults) |
|---|---|---|
| `breathe` | breathing | `bone` chest, `amount` 0.02 (along), `width` (across, amount/2), `cycles` 1, `belly` (bone to swell), `hold: [f0, f1]` (held breath) |
| `weight_shift` | weight shift | `amount` 8 (hips x), `dip` 3, `cycles` 1, `tilt` 0.8°, `counter` 1.4° (spine counter-rotation, chest share 0.5), `stabilize` 0.8 (head stays level); feet stay planted through the IK |
| `nod` | nod on the beat | `every` 18 f (= 100 BPM), `amount` 5°, `attack` 3 (fast down, slow up), `neck`/`chest` shares, `bob` 3 (knee bounce through the IK), `on_beat: start\|bottom`, `at` + `count` for one-shots |
| `sway` | overlapping action (FK wave) | `bone` or `chain`, `amount`, `cycles`, `lag` frames per link, `grow` per link, `channel` rot/x/y, `at` + `frames` window, starts at rest |
| `pulse` | squash & stretch pops | `bone`, `amount`, `every` or `at: [..]`, `attack` 3, `release` 9, `axes` both/along/across |
| `flick` | follow-through | `bone`, `at`, `amount`, `frames` (settle, / tempo), `cycles` 1.5, `windup` 0.25 (anticipation the other way) |
| `jolt` | keyed kick (drives the springs) | `bone` hips, `at`, `x`/`y`/`rot`, `attack` 2, `hold` 1, `recover` 14 (/ tempo), `overshoot` 0.15 |
| `tremble` | tension | `bone`, `amount`, `hz`, `channel`, optional window |
| `blink` | face | `at: [..]`, `slots` eyes, `soft` (half / closed / half) |
| `puff` | fx | `slot` (additive fx_*), `every`/`at`, `rise`, `drift`, `scale`, alpha fade |
| `release` | props leaving the hand (mic drop) | `bone`, `at`, `frames`, `fall`, `forward`, `spin`, `slot` (hidden at the end); FK-compensated ballistic path in world space, parent chain must be FK |

Anticipation → action → follow-through is authored with `keys` (anticipation pose, a fast `expo_in`/`expo_out`
move on the contact frame, an overshoot pose, the settle). **Overlap** comes from `drag` (every chain
link lags the accumulated rotation of the links above it by `lag` frames: successive breaking of joints;
a fast hip translation also bends the spine back) and from the springs (tail, jowl, belly, chain, pouch,
cable, toothpick), which react to the keyed motion at runtime.

**How keys are written.** Everything is summed on a dense grid (8 samples per frame) and refitted into
whole-frame keys with cubic Hermite beziers (control points at thirds, one-sided tangents at kinks,
pose and contact frames always keyed). The error is measured the way spine-core evaluates a curve
(10 linear pieces per bezier): rotation ≤ 0.2°, translation ≤ 0.2 units, scale ≤ 0.001, IK mix ≤ 0.005.
IK timelines carry `bendPositive: false` on every key where the constraint bends negative (a missing
flag would flip the knee).

### validate.mjs --kind character

Static: 4.3 header, constraint order, required bones (`root`, `hips`, `spine`, `chest`, `neck`, `head`,
`ctrl_look`, both arm and leg chains), bone words/prefixes and spring words, budgets from ANIMATION_SET
§10 (≤ 80 bones, ≤ 40 slots, ≤ 2,400 mesh vertices, ≤ 12 physics constraints, no clipping), physics
limit ≥ 6000, `look` / `look_eyes` constraints, `eye_L/R` and `pupil_L/R` slots present and every `eye_*`
slot with `open`, `half`, `closed`, `wide`, the per-rig mouth and hand sets, face clips (track 2) that key
no body bone or IK (error: they would freeze the body track), no clip keying `root`, additive
blend only on `fx_*`, curve arity (IK keys 8 numbers), SfxIds.

Runtime (spine-core, 60 Hz with physics): required clips and exact lengths, events on their frames
(error beyond ±1 frame), loop seams, overlays with zero deltas on the first and last frame,
`bass_drop_charge` ending on `bass_drop`'s first pose, one-shots ending on idle's first pose (warning),
NaN, spring deflection (warning above 75° / 90 units) and settling (still 2–2.5 s after the end), IK
reach (a planted limb that misses its target), a setup pose that IK leaves in place, the look response
(error when a 100-unit `ctrl_look` offset turns the head < 0.5°: a dead look-at),
**adult proportions** (head attachments ≤ 27% of the setup height, excluding headphones, cable, mic,
toothpick) and, with `--atlas`, one page ≤ 2048².

### Preview and capture for characters

`capture.mjs` recognises `chr_*` skeletons (or `--mode character`): portrait canvas, root on the floor
line, auto-fit, a pink cross on `ctrl_look`, mixes 0.25 s (`bass_drop_charge → bass_drop` 0). Any clip
name is a scenario (its contract loop flag and track; overlays additive over idle), plus `charge_drop`,
`look` (runtime sweep of `ctrl_look`) and `win_celebrate`; `all` captures everything. The motion plot
shows hips dx/dy, head rotation, chest scale and the tip of each spring chain against its parent. The
preview page (`index.html?mode=character&skel=…&atlas=…`) has buttons per clip and a look sweep.

## Character parts contract (what the split stage delivers)

The art plan's mascot sheets (`mascot_parts_sheet.txt` A–E: ART_PLAN rows `chr_<id>_rig_master` and `chr_<id>_parts_{body,face,hands,props}`) are matted, cut into
pieces, registered to the approved rig master and hidden-area filled by the split stage. Its output must
match this contract; then the demo `rig.yaml` works on the real art with at most landmark and joint edits.

**Canvas and scale.**
- One canvas per mascot at **2× the landscape design rect**: Gumbo **868×992**, Croak **720×1260** units
  (`bassDrop.mascots.*.authoringHeightUnits`). The rig master (sheet A) defines the setup pose, view and scale.
- Every piece stays at that final resolution: body and face sheets are 4k so that no piece is upscaled
  (ART_BIBLE: never upscale); hands and props are 2k.
- `root` = the feet point, `anchor: [0.5, 1.0]` (bottom centre, soles on the bottom edge).
- Figure: adult proportions, **head ≤ 27% of the total height**, measured by the tools from the part
  bounding boxes (head, jaw, eyes, brows, mouth, jowl vs everything but fx; headphones, cable, mic,
  toothpick excluded).

**Key colour and matte.** Sheets are generated on the mascot key (`mascots.<id>.keyHex`: Gumbo `#FF00FF`,
Croak `#0000FF`), matted with the closed-outline key matte (`tools/matte/outline_matte.py`, no canvas
fit) and delivered as straight-alpha PNG, 2–4 px transparent padding, zero key-tinted edge pixels,
closed black outline of 6–8 units at 2×, no text.

**Files.**

```
images/chr_<id>/<slot>.png                 single-attachment slot (torso, head, thigh_R, …)
images/chr_<id>/<slot>/<variant>.png       variants: eye_L/open.png, mouth/grin.png, hand_R/fist.png, …
parts.json
```

```json
{ "skeleton": "chr_gumbo", "kind": "character", "canvas": [868, 992], "anchor": [0.5, 1.0], "images": "images",
  "landmarks": { "hips": [420, 628], "chest": [430, 420], "…": [0, 0] },
  "parts": [
    { "slot": "thigh_R", "bbox": [306, 588, 162, 284], "z": 27 },
    { "slot": "eye_R", "attachment": "open", "bbox": [478, 132, 60, 52], "z": 19, "bone": "face_eye_R", "parent": "head", "joint": [506, 156] },
    { "slot": "eye_R", "attachment": "half", "bbox": [476, 128, 64, 58] }
  ] }
```

- `bbox` = the PNG's position on the canvas (image space) and must equal its size.
- `z` = draw order (back to front). **Near-side limbs in front of the torso, far-side limbs behind it.**
- `bone` = the bone the slot rides (default: the slot name, which the biped template creates for
  every body limb). `joint` / `tip` / `parent` create part bones (face bones, props).
- `setup: true` marks the setup attachment of a slot with variants (default: the first listed), and
  `hidden: true` means none (the mic).

**Landmarks** (canvas points on the rig master, written by the split stage from the registered pieces):
`hips` (pelvis centre), `chest` (rib-cage centre), `neck` (neck base), `head` (skull base, the nod pivot),
`head_top`, optional `spine` (default halfway between hips and chest), `jaw` + `chin` (jaw hinge and
tip; no jaw bone without them), and per side X ∈ {L, R}: `shoulder_X`, `elbow_X`, `wrist_X`, `hand_X`
(knuckles), `hip_X`, `knee_X`, `ankle_X`, `toe_X`, optional `look`. Limbs must be **slightly bent** in
the setup pose (the IK bend direction is read from it; a straight limb is an error). Knees bend toward
the facing direction.

**Pivots and overlap caps.** Each piece is complete (hidden areas painted in) and ends in a **rounded
overlap cap centred on its joint**, radius about half the limb width there, so the joint can rotate
±35° without a gap (ART_PLAN parts gate). The cap belongs to the child piece when the child is drawn in
front, else to the parent.

| Piece | Rides bone | Pivot (joint) → tip | Cap / notes |
|---|---|---|---|
| `torso`, `tank_top` / `shirt` | `spine` (mesh weighted chest / spine / hips) | – | includes the shoulders and hip tops under the limb caps; the garment matches the torso silhouette |
| `belly` | `phys_belly` (mesh) | belly centre | Gumbo; lower edge free to jiggle |
| `neck` | `neck` | neck base → skull base | cap under the head |
| `head` | `head` | skull base → top of head | Gumbo: skull + upper snout, no lower jaw; Croak: without eyes |
| `jaw` | `jaw` (mesh) | jaw hinge → chin | includes the dark mouth interior reaching up behind the head, so an open jaw shows no gap |
| `teeth_upper`, `gold_tooth`, `nostrils` / `teeth_lower` | `head` (`snout`) / `jaw` | – | small overlays, same scale |
| `eye_L/R` | `face_eye_L/R` | eye centre | **4 variants at identical size and centre**: `open`, `wide` = sclera/iris *without* pupil; `half`, `closed` = complete with lid (and pupil where visible) |
| `pupil_L/R` | `face_pupil_L/R` | pupil centre | drawn upright (the look constraint moves it in screen x/y) |
| `brow_L/R`, `lid_L/R`, `eye_bulge_L/R` | `face_brow_*`, `face_lid_*`, `face_bulge_*` | centre | Croak's bulges carry his eyes |
| `mouth` | `head` | mouth corner | variants at the same registration: Gumbo `closed_pick`, `grin`, `open`, `roar`; Croak `closed`, `smile`, `open`, `O` |
| `jowl` / `pouch` | `phys_jowl_1` / `pouch` › `phys_pouch_*` (mesh) | attachment line at the top | Croak's pouch inflates from its top pivot |
| `upper_arm_X` | `upper_arm_X` | shoulder → elbow | cap at the shoulder under the torso edge (far) or over it (near) |
| `forearm_X` | `forearm_X` | elbow → wrist | cap at the elbow |
| `hand_X` | `hand_X` | wrist → knuckles | **every hand pose pivots at the same wrist point and points from it toward the `hand_X` landmark (the setup hand direction)**, cap at the wrist; Gumbo `open`, `fist`, `point` (+ `lean` on L); Croak `open`, `point`, `fist` + `scratch`, `press` (R) / `fader` (L); constant finger count |
| `thigh_X` / `shin_X` | same | hip → knee / knee → ankle | caps at hip and knee |
| `foot_X` | `foot_X` (rides `ik_foot_X`) | ankle → toe | flat on the canvas bottom |
| `tail` | `phys_tail_1..4` (mesh) | tail root at the back of the hips | Gumbo: rests on the ground behind the far leg, clear of both legs |
| `chain` | `phys_chain_1..n` (mesh) | neck centre | hangs on the chest |
| `band`, `cup_L/R`, `cable` | `band`, `cup_*`, `phys_cable_1..3` (mesh) | top of head / ear / cup bottom | Croak's headphones; the cable hangs clear of the body |
| `toothpick`, `mic`, `cooler_body`, `cooler_lid` | `phys_toothpick`, `mic` (on `hand_R`), `cooler`, `cooler_lid` | grip point / hinge | the mic is drawn in the setup hand, hidden at setup |
| `fx_sweat`, `fx_note` | `fx_*` under root | – | code-drawn per ART_PLAN (empty slots are fine), additive |

Real part sheets drop in by replacing `images/` and `parts.json` (same names); keep `rig.yaml` and edit
only what is tied to the drawing: landmarks, part joints, spring bone joints, and the canvas points of
`place` / `reach` (cabinet ledge, deck and fader, cooler lid). Then gen → validate → pack → capture and
re-judge the sheets.

## Known limits

- `pack.py` never rotates regions and does no polygon packing, so production atlases still come from the Spine CLI.
- The skeleton is exported as JSON. Binary `.skel` needs the editor (`export.sh export`).
- Deform (FFD) timelines are not generated: jelly comes from weighted meshes plus physics bones.
- `spine-rigc` 1.1.0 (suggested in [PIPELINE 3.2](../../docs/PIPELINE.md#phase-3-2d--spine-symbols) as a format reference) has not been evaluated. This generator covers the same ground and is contract-specific.
- Characters:
  - poses are FK plus IK blends; `reach` and the IK stance match are solved in Python for 2-bone chains only;
  - no draw-order timelines yet (a far hand behind the torso stays behind it in every clip);
  - no FFD/deform timelines: jowl, belly, pouch and tail bend through weighted meshes and springs;
  - `capture.mjs` shows the rig alone: the cabinet, the booth and the cooler contact points are approximated
    on the placeholder canvas, not the layout;
  - multi-link rotation springs ring at a lower frequency than each constraint's nominal Hz (a 4-link
    floppy tail swings at about 1 Hz), which is why the validator measures settling instead of trusting the preset.
