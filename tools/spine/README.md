# tools/spine: AI-authored Spine 4.3 symbols

Claude writes a small `rig.yaml`. The tools here turn it into a Spine 4.3 skeleton that follows
[ANIMATION_CONTRACT](../../docs/ANIMATION_CONTRACT.md) §2–§4, then gate it on the official runtime and
render it on the real Pixi runtime for review. No Spine editor is needed until the canonical `.spine`
import and the production pack (PIPELINE 3.4).

```
parts.json (split stage)  ┐
rig.yaml (Claude)         ┴─► gen.py ─► skeleton.json ─► validate.mjs ─► pack.py ─────────► preview/capture.mjs ─► critique
                                              │            (gate)        (AI-rig atlas)      (spine-pixi-v8 frames)      │
                                              └────────► export.sh: Spine CLI import / clean / export binary / pack ◄─────┘
                                                          (licensed workstation, production)                 edit rig.yaml
```

| File | What it does |
|---|---|
| `gen.py` | `rig.yaml` + `parts.json` → Spine 4.3 JSON: bones, slots, skins, meshes, one `constraints[]`, physics, and the full animation set with events |
| `spinegen/` | Generator library: `easing` (presets → absolute beziers), `timeline`, `motion` (contract animations + accents), `mesh` (grid / alpha-trace + weights), `physics`, `rig`, `provenance` |
| `contract.json` | Machine-readable copy of the contract (windows, events, budgets, physics presets, runtime aliases). Both `gen.py` and `validate.mjs` read it |
| `validate.mjs` | Contract gate on `@esotericsoftware/spine-core` 4.3.13 |
| `pack.py` | Deterministic `.atlas` (4.x text, PMA) + page PNG packer, so generated rigs load in-engine without the Spine editor |
| `make_blur.py` | `<part>_blur.png` spin-blur variants (vertical box blur on a padded canvas) |
| `export.sh` | Spine CLI wrapper: pinned patch, stdout teed, **fails on any warning line** |
| `config/pack-symbols.json` | Default Spine CLI pack settings (contract §2.2). Production copy belongs in `config/spine/pack-symbols.json`; `export.sh` prefers that file when it exists |
| `preview/` | Vite-free preview page (`index.html` + `preview.mjs`, import map into `node_modules`), `serve.mjs` static server, and `capture.mjs` (Playwright contact sheets) |
| `examples/demo_symbol/` | End-to-end demo: `make_parts.mjs` (resvg-js cel-shaded parts), `rig.yaml`, `parts.json`, `images/`, `build.sh`, `provenance.json` |
| `test/` | `run.sh` (everything), `test_spinegen.py`, `validate.test.mjs` (20 negative cases), `export.test.sh` + `fake-spine.sh` |

Shipped demo: `public/assets/spine/demo/{sym_demo.json, sym_demo.atlas, sym_demo.png}` (PMA, 568×512).

## Setup

```bash
python3 -m venv .venv-spine && .venv-spine/bin/pip install -r tools/requirements-spine.txt   # PyYAML, numpy, pillow, shapely
export PYTHON=$PWD/.venv-spine/bin/python
pnpm install     # spine-core, spine-pixi-v8, pixi.js, @resvg/resvg-js, playwright are already in package.json
```

## The AI workflow (who does what)

| Step | Who | Command | Output | Gate |
|---|---|---|---|---|
| 1. Parts | split stage (`tools/split`, PIPELINE 3.1) or `make_parts.mjs` for vector art | – | `images/sym_<ID>/<part>.png` (2x, 2–4 px padding) + `parts.json` | rest-pose SSIM/IoU (split stage) |
| 2. Blur variants | script | `$PYTHON tools/spine/make_blur.py <parts.json>` | `<part>_blur.png`, `blur: true` in parts.json | – |
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
PYTHON=$PWD/.venv-spine/bin/python tools/spine/examples/demo_symbol/build.sh \
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
compat: {runtime_aliases: false}   # true = also emit anticipation_loop, impact, burst (today's src/)
```

**parts.json** (written by the split stage): `{symbol, canvas: [360, 360], images: "images", parts: [{name, bbox: [x, y, w, h], z, bone, parent?, joint?, tip?, blend?, color?, blur?}]}`. Images live at `<images>/sym_<ID>/<name>.png`. `bbox` must match the PNG size.

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

**Headroom:** `land` must stay inside the 300×300 cell, and the validator applies the runtime physics kick with both signs. A full-height symbol stretched by the 6% rebound overflows the cell. Keep the content at about 85% of the cell height, or lower `motion.land.rebound`. The demo is 257 px tall on a 300 px cell.

## validate.mjs

```bash
node tools/spine/validate.mjs <skeleton.json> [--atlas <file.atlas>] [--kind auto|high|special|royal|any] \
     [--cell 300] [--kick 26] [--report out.json] [--strict] [--quiet]
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
- `land` stays inside the cell with the kick applied.

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
tools/spine/export.sh [--dry-run] [--log-dir build/spine/logs] [--settings file] clean|export|pack …
```

- Every step tees stdout to `build/spine/logs/<step>.log`. A step fails on a non-zero exit **or** on any line matching `warn|error|exception|missing|not found|could not|unable to|failed` (override with `SPINE_FAIL_PATTERN`), because the CLI exits 0 on missing images.
- It **cannot run in a cloud session**: there is no Spine licence there.
- Argument handling is tested with `test/fake-spine.sh` (`test/export.test.sh`, 26 cases).

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
- **−27** is the contract research sign: the parts overshoot downward.
- **+26** is what `SpineRig.kick` does today (ANIMATION_CONTRACT §10.4).

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

Until ANIMATION_CONTRACT §10 items 1–2 land, today's `SpinePool`/`SymbolRig` listen for `impact`/`burst` and use `anticipation_loop`. Generate with `compat: {runtime_aliases: true}` to also emit those names.

## Provenance

- `gen.py` and `pack.py` accept `--provenance <rows.json>` and `--manifest art/manifest.json`. They append rows that are compatible with `art/manifest.schema.json`:
  - `route: code`, `vendor: self`;
  - `refHashes` = the sha256 of every input (rig, parts, images);
  - ids are content-addressed (`<asset>.<sha8>`), so re-runs never duplicate rows.
- The default `licenseId` is `owned-code`. That id must be added to `licenses/allowlist.json` before licence-audit runs (see the report). Pass `--license-id` to override.

## Known limits

- `pack.py` never rotates regions and does no polygon packing, so production atlases still come from the Spine CLI.
- The skeleton is exported as JSON. Binary `.skel` needs the editor (`export.sh export`).
- Deform (FFD) timelines are not generated: jelly comes from weighted meshes plus physics bones.
- `spine-rigc` 1.1.0 (PIPELINE 3.2 "evaluate first") has not been evaluated. This generator covers the same ground and is contract-specific.
