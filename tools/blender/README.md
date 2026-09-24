# tools/blender — headless Blender production pipeline

Committed, deterministic scripts for everything 3D in [docs/PIPELINE.md](../../docs/PIPELINE.md) phases 4 and 5.1:
baked symbol inserts, turntables for mesh bake-offs, vendor-mesh cleanup, animation from Claude-written JSON, and GLB export.
The glTF optimiser and budget gate live next door in [tools/gltf](../gltf/README.md).

Every script runs **both ways** with the same arguments:

```bash
blender -b --factory-startup --python-exit-code 1 -P tools/blender/<x>.py -- <args>    # Blender 5.2.2 binary
python tools/blender/<x>.py <args>                                                       # bpy 5.2.2 as a module
tools/blender/run.sh <x> <args>          # picks $BLENDER if set, else $BPY_PYTHON (default python3)
```

- **Exit codes:** `0` ok · `1` error (message on stderr) · `2` usage · `3` a QA or budget gate failed (the outputs are still written, for inspection).
- **Setup:** `uv venv -p 3.13 ~/.venvs/bpy && uv pip install --python ~/.venvs/bpy -r tools/blender/requirements.txt`, then `export BPY_PYTHON=~/.venvs/bpy/bin/python`.
- **Pure-Python steps:** `frames_post.py` and `sheet_post.py` need numpy and Pillow. Inside the Blender binary (bundled Python has no Pillow) they run as a subprocess in `$SLOT_PYTHON` (default `python3`).

## Scripts

| Script | What it does | Main outputs |
|---|---|---|
| `render_symbol.py` | Toon-shaded, outlined, alpha PNG sequences: `turn`, `spin`, `shatter`, `land`, `static`. Subject: royal glyph (Text object with the bundled font), procedural `coin`/`gem`, or any GLB/OBJ/FBX prop | `build/frames/<SYM>_<clip>/<SYM>_<clip>_0001.png…`, `build/qa/blender/<SYM>_<clip>/{sheet.png,qa.json,anim.json,manifest.json,qa_*.png}` |
| `frames_post.py` | Lanczos-down in premultiplied alpha, QA gates, contact sheet, `anim.json`, manifest row. Called by render_symbol | (as above) |
| `build_actions.py` | Animation JSON → slotted Actions on the armature and shape keys, then `.blend` and GLB | `--out-blend`, `--export-glb`, `<glb>.report.json`, `<glb>.manifest.json` |
| `export_glb.py` | GLB export with the fixed settings of PIPELINE §4.4; optional action filter; Rigify `DEF-*` or explicit bone renames | `<out>.glb`, `<out>.export.json`, `<out>.manifest.json` |
| `cleanup_mascot.py` | Vendor mesh → weld, clear custom normals, smooth by angle, feet at the origin, facing −Y, height; decimate or QuadriFlow; 4–8 flat toon colours on one palette material; budget report | `<out>.glb`, `<out>.report.json`, `<out>.manifest.json`, optional `.blend` |
| `turntable.py` | 8-angle toon turntable, or a contact sheet of an action, in the runtime mascot look | `<out>/<name>_turntable{.png,_aNNN.png,.json}` / `<name>_<action>{.png,_fNNNN.png,.json}` |
| `sheet_post.py` | Pure-Python post step for turntable.py | — |
| `tests/run_tests.sh` | End-to-end verification (units, every script, gates, determinism, optimize) | `art/_work/test_run/` |
| `tests/make_fixtures.py` | Deterministic stand-ins for vendor output (dense textured blob, textured jar) | `art/_work/fixtures/` |
| `tests/sim_blender.py` | Runs a script with Blender's argv layout and Pillow hidden, as inside the Blender binary | — |
| `tests/compare_frames.py` | Two frame folders: bit-exact, or within tolerance (reported) | — |

Shared code is in `slotbl/`: `cli`, `provenance`, `palette`, `easing`, `imgtools` and `animspec` never import bpy; `scene` does.

## render_symbol.py: baked 3D inserts (PIPELINE §5.1, ANIMATION_CONTRACT §8.1)

```bash
# 'K' royal (game id L2) turn, deterministic CI reference (Cycles CPU emission toon)
python tools/blender/render_symbol.py --glyph K --clip turn --size 256 --frames 24 --samples 16
# procedural gold coin spin on the GPU workstation (EEVEE, Shader-to-RGB)
python tools/blender/render_symbol.py --sym coin --proc coin --clip spin --engine BLENDER_EEVEE
# image-to-3D prop, shatter on a 1.6x canvas
python tools/blender/render_symbol.py --sym W --mesh art/source/3d/props/W.glb --clip shatter
# frame-1 reference, then gate a clip against it
python tools/blender/render_symbol.py --glyph K --clip static
python tools/blender/render_symbol.py --glyph K --clip turn --static build/frames/L2_static/L2_static_0001.png
```

**Names.** Outputs use the game id (`--glyph K` resolves to `L2` through `art/bible/artbible.json`), so frames are `build/frames/L2_turn/L2_turn_0001.png`. The frame folder holds frames only: it is one AssetPack `{tps}` folder. Sidecars go to `build/qa/blender/<SYM>_<clip>/`, and supersampled raws to `art/_work/blender/raw/` (deleted after post unless `--keep-raw`).

**Look.** One shared template for every symbol:
- **Light:** the key light is fixed in camera space, using `TOON.keyDir` from `src/mascots/toon.ts` (top-left, slightly in front).
- **Bands:** 3 hard bands from a CONSTANT ColorRamp.
  - EEVEE: Diffuse → Shader to RGB → ramp (`--shading lit`, the default with EEVEE).
  - Cycles: dot(Normal, key) → ramp → Emission (`--shading emission`; deterministic).
  - Both map `0.5·N·L+0.5` with the same thresholds (`--bands 0.02,0.35`). Measured difference between EEVEE and Cycles on the K turn: MAD ≤ 0.4/255.
- **Shadow tones:** they shift toward the plum shadow hue `#6A1030`, or use the bible's explicit shade. Gold uses the bible's gold ramp.
- **Royals:**
  - enamel face on the front and back caps;
  - bevel = black interior line;
  - plum `#4B283D` side walls (the extrusion);
  - camera slightly low and to the right, so the extrusion reads lower-right like the 2D royals.
- **Props:** a white specular streak on parts facing the key (`--spec`). There is no rim light and no baked glow.
- **Outline:** an inverted-hull Solidify (offset +1, flipped normals, back faces transparent for Cycles, culled in EEVEE).
  - Width defaults to 4.6 design px on the 180 px canvas: `--outline-px`, 6.5 px at 256.
  - Counters (A, Q, 0, …) are found from the font's spline nesting and get a thinner hull (`--counter-outline 0.4`), so they stay open.
  - Even-offset is used only on convex subjects (gems); on letters it spikes at concave corners.
- **Colour:** `view_transform Standard`, dither 0, film transparent, no metadata stamps.
- **Framing:** the rest pose fills `cellScale·150/180` of the canvas height (royals 71.7 %) on the static-sprite framing. The object origin is bottom-centre, and the pivot is written to `anim.json`.

**Clips.**
- **turn / spin:** yaw loop with `angle = 2π·revs·(f−1)/F`, so frame F+1 == frame 1 by construction. `spin` defaults to 2 turns per loop; `--bob` adds a periodic bob.
- **shatter:** solid Voronoi chunks with no Cell Fracture add-on. For each seed, bisect by the perpendicular-bisector plane to every other seed and cap each cut with `triangle_fill`.
  - The intact mesh is shown until the burst frame (frame 3 = `explode_burst`), so frame 1 equals the static render. After that, ballistic chunks spin, shrink and end at alpha 0.
  - The canvas is `--canvas-scale` (1.6) larger at the same pixel density (`anim.json → canvasScale`).
- **land (optional):** volume-preserving squash spring from rest (`--spring-hz 3.2 --zeta 0.33 --squash 0.85`, sx = 1/√sy, anchored at the feet).
- **static:** one frame of the rest pose.

**Gates** (written to `qa.json`; exit 3 on failure unless `--no-gates`):

| Gate | Pass |
|---|---|
| `frameCount` | frames written = F |
| `alphaBounds` | no opaque pixel within 1 px of the canvas edge; no empty frame (except the last shatter frame) |
| `loopSeamExact` | loops: frame F+1 (rendered for QA, not shipped) vs frame 1, MAD ≤ 0.5/255 |
| `loopSeamRatio` | loops: MAD(F→1) / median MAD(f→f+1) in [0.25, 2.0] |
| `frame1VsRest` | shatter: frame 1 vs the intact render, MAD ≤ 1.5/255 |
| `frame1VsStatic` | with `--static`: frame 1 vs the static sprite, MAD ≤ 3/255 |
| `outlineWidth` | median hull width ≥ `--outline-min-px` (3), measured as the distance from the silhouette of the frame to the same frame rendered without the hull |
| `hullBleed` | no counter or hole of the no-hull render loses more than 70 % of its area to the hull |
| `pivotDrift` | turn/spin: the union bbox is centred on the pivot column (≤ max(1.5 px, 0.6 %)); land: the bottom row moves ≤ 2 px |
| `endsEmpty` | shatter: last-frame coverage ≤ 0.2 % |

**Determinism.** Cycles CPU frames are bit-exact across runs and thread counts: 6/6 identical coin renders at 1–3 threads, and the K turn is identical between suite runs. The exception is geometry with **exact ray ties** (coincident faces or T-junction edges): Embree builds its BVH multithreaded, so the tie can resolve differently. That showed up as 6 pixels ±4/255 at the coin's star emblem until the star was sunk 4 mm into the field. Keep procedural and prop geometry free of coincident surfaces. EEVEE on a GPU is not a bit-exact reference.

**Manifest row.** There is one row per clip folder: `stage 3d-render`, `route blender`, `licenseId blender-5.2`.
- `sha256` is the digest of the `'<file>:<sha256>\n'` lines of the folder, sorted.
- The id embeds that digest (`frames.l2_turn.<8 hex>`). A re-render with identical output keeps its id and date, so the sidecar is byte-identical.
- `refHashes` holds the font or mesh sha256.
- `--manifest art/manifest.json` also appends the row (append-only, by id).

## Animation JSON

Claude writes one file per mascot or clip set: `art/source/3d/mascot_<id>/anim/<clip>.json`. The schema is [`anim.schema.json`](anim.schema.json), and the working example is [`examples/celebrate_test.json`](examples/celebrate_test.json).

```jsonc
{
  "version": 1,
  "fps": 30,                                   // the contract authors everything at 30 fps
  "defaults": { "space": "world", "ease": "SINE_IN_OUT" },
  "clips": [{
    "name": "celebrate",                       // canonical names: ANIMATION_CONTRACT §7.2
    "loop": true,
    "length": 72,                              // clip spans frames 0..72 (2.4 s)
    "base": { "action": "idle", "frame": 0 },  // or "rest": pose the deltas are added to
    "tracks": [
      { "bone": "hips", "channel": "loc", "keys": [
          { "f": 0,  "v": [0, 0, 0] },
          { "f": 6,  "v": [0, 0, -0.05], "ease": "QUAD_OUT" },              // anticipation dip
          { "f": 13, "v": [0, 0, 0.08],  "ease": "BACK_OUT", "hold": 3 },   // pop, overshoot, 3-frame hold
          { "f": 24, "v": [0, 0, 0],     "ease": "BOUNCE_OUT" } ] },
      { "bone": "head", "channel": "rot", "offset": 3, "keys": [             // follow-through 3 frames late
          { "f": 0, "v": [0, 0, 0] },
          { "f": 14, "v": [-12, 0, 8], "ease": { "type": "ELASTIC", "dir": "OUT", "amplitude": 0.7, "period": 4 } } ] },
      { "chain": ["upper_arm_L", "forearm_L", "hand_L"], "channel": "rot", "offsetStep": 2, "falloff": 0.6,
        "keys": [ { "f": 0, "v": [0, 0, 0] }, { "f": 13, "v": [0, -120, 0], "ease": "OVERSHOOT" } ] },
      { "bone": "spine", "channel": "squash", "keys": [ { "f": 0, "v": 1 }, { "f": 6, "v": 0.9 }, { "f": 12, "v": 1.06, "ease": "EXPO_OUT" }, { "f": 18, "v": 1, "ease": "SETTLE" } ] },
      { "morph": "surprised", "channel": "morph", "keys": [ { "f": 9, "v": 0 }, { "f": 13, "v": 1, "ease": "BACK_OUT", "hold": 5 }, { "f": 26, "v": 0 } ] }
    ]
  }]
}
```

**Semantics:**

- **Channels:**
  - `rot`: Euler degrees [x, y, z].
  - `loc`: metres.
  - `scale`: [x, y, z] or a single number.
  - `squash`: sy along the bone, with sx = sz = 1/√sy.
  - `morph`: a weight. The name matches case-insensitively on every mesh that has it, or only on `mesh`.
- **Space** (rot/loc):
  - `world` (the default) uses Blender world axes at the base pose. The character faces −Y and +Z is up: +X nods forward/down, +Z turns toward the character's left, +Y rolls.
  - `local` uses the bone's own axes.
  - `build_actions.py --describe rig.json` dumps every bone's rest axes, morph names and existing actions for the author.
- **Values are deltas** on the `base` pose. With a base action, every bone holds that pose for the whole clip.
- **Ease:**
  - `ease` describes how the motion **arrives** at that key (GSAP `to()` semantics). The builder writes it onto the Blender keyframe that starts the segment.
  - Presets: `<TYPE>[_IN|_OUT|_IN_OUT]` with TYPE in `CONSTANT LINEAR BEZIER SINE QUAD CUBIC QUART QUINT EXPO CIRC BACK BOUNCE ELASTIC`.
  - Aliases: `STEP`/`HOLD`, `SMOOTH`, `EASE`, `ANTICIPATE` (BACK_IN), `OVERSHOOT` (BACK_OUT), `SETTLE` (ELASTIC_OUT), `SNAP` (EXPO_OUT), `DROP` (QUAD_IN), `THUD` (BOUNCE_OUT).
  - Object form: `{type, dir, back, amplitude, period}`. `amplitude` is a **fraction of the segment's change**; Blender's raw keyframe amplitude is in absolute units and explodes on quaternion channels. `period` is in frames.
- **Timing:**
  - `hold: n` adds a same-value key n frames later.
  - `offset` shifts a track in time: overlap and follow-through. On loops it wraps (the curve is resampled per frame through a Cycles modifier).
  - `chain` expands into one track per bone, delayed `offsetStep·i` frames and scaled `falloff^i`.
- **Loops:** every track must end on its first value at `length`. The closing key is added when missing; a different explicit value is an error. The report measures the seam (`loopSeamMaxDiff`, 0.0 on the example).
- **Contract checks:**
  - Research aliases (`idle_loop`, `win_small`, …) are errors that name the canonical clip.
  - A canonical clip with the wrong loop flag or length window warns, and is an error with `--strict`.
  - A non-canonical name warns (the runtime would never play it).

**Build and export:**

```bash
python tools/blender/build_actions.py --check art/source/3d/mascot_gumbo/anim/*.json          # JSON only, no Blender
blender -b art/source/3d/mascot_gumbo/mascot_gumbo.blend --python-exit-code 1 \
  -P tools/blender/build_actions.py -- art/source/3d/mascot_gumbo/anim/*.json --save \
  --export-glb art/_work/mascots/gumbo/raw.glb --rigify-names
python tools/blender/turntable.py art/_work/mascots/gumbo/raw.glb --action celebrate --frames 8 --out qa/mascots/celebrate
```

- Each clip is one **slotted Action**: an armature slot plus one slot per touched shape-key datablock. It is stashed on a muted NLA track, as the glTF importer does. The frame range is 0..length and `use_cyclic` follows the loop flag. The export samples it at 30 fps.
- **GLB rigs (`--glb`):** before building, `prepare_rig_for_export` makes the import round-trip safe.
  1. Every action gets constant keys for the bones it leaves unkeyed. They take the glTF **node default pose**, recovered from the node matrices and inverseBindMatrices. Blender's exporter otherwise resets them to the bind pose, which collapsed the placeholder's clips.
  2. Meshes rigidly parented to bones are converted to 100 %-weight skinned meshes. Blender's glTF IO misplaced them by up to 0.65 m.
  - Verified: after a cleanup round-trip, the placeholder's `Wave` matches the original within ~2 cm on a 4 m rig.
- **Export settings** (`slotbl.scene.GLTF_EXPORT_SETTINGS`): `export_animation_mode='ACTIONS'`, `export_morph=True`, `export_def_bones=True`, `export_apply=False`, `export_skins=True`, `export_influence_nb=4`, forced sampling, reset pose bones.

## cleanup_mascot.py and turntable.py: mesh bake-off (PIPELINE §4.1–4.2)

```bash
blender -b -P tools/blender/turntable.py -- art/_work/mascots/gumbo/cand_tripo.glb --out art/_work/mascots/gumbo/tt  # 8 angles
python tools/blender/cleanup_mascot.py art/_work/mascots/gumbo/cand_tripo.glb --out art/_work/mascots/gumbo/clean.glb \
  --height 1.8 --target-tris 14000 --colors 6 --out-blend art/_work/mascots/gumbo/clean.blend --strict
```

**The palette:**
- **Clustering:** k-means over-clusters (16) in CIELAB, then merges the closest pair until `--colors` remain. The merge distance down-weights L\* (`--lightness-weight 0.35`), so baked-light variants of one hue merge first, while small but distinct colours survive (eye white, pupils, gold tooth).
  - On the fixture, a plain area-weighted k-means spent 3 of 5 slots on the body green.
  - The merged version recovers skin `#3E9A39` (art bible `#3F9D3A`), belly, eye white, pupil and gold.
- **Per-face colour:** each face takes the majority of 4 samples of the **original** surface (BVH nearest), then a neighbour majority filter.
- **Output:** one `toon_palette` material with an 8 px-per-colour texture (Closest filtering → glTF NEAREST, UVs at cell centres), or `--palette-mode vertex` (COLOR_0; the runtime `toonify` enables vertexColors).

**Geometry:**
- `--relax 2` Laplacian passes after decimation remove the normal noise that toon ramps turn into band speckles.
- Rigged inputs keep their rig: only a root transform is set, and the round-trip prep above is applied.
- Meshes with shape keys are not decimated. Blender cannot apply Decimate to them; the tool warns.

**Budgets:** < 15k tris, deform bones ≤ 65 (target 30–60), ≤ 2 materials, textures ≤ 1024 px. They go into `<out>.report.json`; `--strict` exits 3 on a breach.

**turntable.py** previews the **runtime** shader (`src/mascots/toon.ts`):
- bands at N·L = −1/3 and +1/3 with 0.42 / 0.70 / 1.00 × albedo;
- a ~3 px outline at the output size.

Options: `--recolor 'Main=#3F9D3A,…'` for untextured placeholders; `--pose ACTION --frame F` for posed turntables.

## Where things go (PIPELINE folder rules)

`art/_raw`, `art/_work` and `build/` are scratch or generated. Only committed scripts write `public/assets/`. Nothing here writes `art/manifest.json` unless `--manifest` is passed; every run writes a manifest-shaped sidecar instead (validated against `art/manifest.schema.json` before writing).

## Verified here (2026-09-24, bpy 5.2.2 module, 4 shared vCPUs, no GPU)

`tools/blender/tests/run_tests.sh` covers the following, with outputs in `art/_work/test_run/`:
- **Unit tests** (15).
- **`--help`** for every script, in both invocation styles.
- **Symbol renders:** the K turn at 256 px × 24 f, coin spin, A shatter, Q land, gem turn, and the K static with the frame-1 gate.
- **An expected gate failure (exit 3).**
- **The Blender-binary argv path**, with Pillow hidden.
- **Determinism and idempotency:** frame-by-frame identical re-renders of the coin and the K, and an unchanged manifest row after an in-place re-run.
- **Animation:** build_actions, then export, then the clip sheet, then the action-filtered and renamed export.
- **Cleanup:** fixture and rigged placeholder cleanup, with turntables.
- **glTF:** optimize on the placeholder, the exported and the cleaned GLBs, two expected budget breaches, and optimize determinism.
- **Manifest:** schema validation of every sidecar row.

Timing: Cycles CPU emission toon renders a 512 px (256×2) frame in ≈ 0.3–0.5 s. EEVEE on llvmpipe (no GPU) needs ≈ 15 s for its first frame (shader compile).

**Not verified here:** the real `blender` binary. Its argv and missing-Pillow behaviour are simulated by `tests/sim_blender.py`, and the binary download is blocked from this sandbox.
