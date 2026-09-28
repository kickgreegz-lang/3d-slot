# tools/spine/examples/bass_drop: the Bass Drop production rigs

`sym_W`, `sym_H1`..`sym_H4` and `ui_groove_meter`, built from the approved Phase C art
([ART_PLAN](../../../../docs/games/bass-drop/ART_PLAN.md), `art/plan/approvals.json`) to
[ANIMATION_SET](../../../../docs/games/bass-drop/ANIMATION_SET.md) §2, §3, §10 and §12 (CR-8).
No Spine licence and no network are needed; the production `.skel` + shared atlases come later from
`tools/spine/export.sh` (PIPELINE 3.4).

```bash
PYTHON=$PWD/tools/.venv/bin/python
tools/spine/examples/bass_drop/build.sh <W|H1|H2|H3|H4|meter> [--cut] [--capture build/qa/rigs/<skel>/capture] [--scenarios a,b]
tools/.venv/bin/python tools/spine/examples/bass_drop/provenance_bd.py      # rows for the part images -> art/manifest.json
```

`build.sh`: `--cut` re-cuts the parts from the approved masters (`cut/cut_<ID>.py`) and makes the `_blur` variants,
then `bdgen.py` → `validate.mjs --strict` (CR-8 kinds: W = `wild`, meter = `ui`) → `check_bd.mjs --strict` →
`pack.py` → `validate.mjs --atlas --strict`, and `--capture` renders contact sheets on spine-pixi-v8.

| File | Does |
|---|---|
| `cut/cutlib.py` | Master-cut helpers: masks, fits, premultiplied canvas fit (`Fit`), inpainting, strokes, glows, reassembly check, parts.json writer |
| `cut/cut_W.py` … `cut_H4.py`, `cut/cut_meter.py` | One per rig: the parts, their hidden-area fills, the fx sprites, `parts.json`, QA previews in `build/qa/rigs/<skel>/` |
| `bdgen.py` | The stock generator (`tools/spine/spinegen`, unmodified) + the rig's `bassdrop.yaml`: CR-8 / meter clips (pose-to-pose keys, named easings), skins (`skins`, `skins_copy`, `skin_rename`), empty runtime slots, `clone` (one slot's attachments into others), `rename`, `untouched` (fx slots that are not glows), `override` (replace a generated timeline), `radial_weights` (a mesh bulge that keeps its rim), `region_scale` (soft art stored at half size) |
| `check_bd.mjs` | ANIMATION_SET's own tables, read from the doc: exact clip lengths and event frames per symbol (§2.0 / §2.6), the meter clip table (§3: tracks, loops, events, the pose each clip ends on), budgets (§10), the CR-8 rules (§12) |
| `capture_bd.mjs` | Contact sheets through `tools/spine/preview`: the contract scenarios + `bass_react`, the wild's `drop` / `sticky` / `mult_up` / `unlock` / `tiers` sequences, the meter clips and skins |
| `provenance_bd.py` | Append-only, sha256-addressed `layer-split` rows for every part image (parents = the approved master / sheet / piece rows) |

Sources: `art/source/symbols/<ID>/{parts.json, rig.yaml, bassdrop.yaml}`, `art/source/ui/meter/{parts.json, rig.yaml, bassdrop.yaml}`,
images in `art/source/spine/images/<skeleton>/`. Outputs (ignored): `build/spine/bd/<skeleton>.{json,atlas,png}`,
QA in `build/qa/rigs/<skeleton>/` (`capture_final/` = the last full capture set).

## The rigs

Every visible pixel at rest comes from the approved art (the reassembly check compares the rest pose with the master on
the canvas: IoU ≥ 0.998, SSIM ≥ 0.995, except the documented changes below). Hidden areas a motion can reveal are filled
under the part that hides them.

| Rig | Slots | Bones | Mesh verts | Physics | Notes |
|---|---|---|---|---|---|
| `sym_W` (wild) | 12 / 12 | 19 / 34 | 92 / 300 | 2 / 4 | ANIMATION_SET 2.6 slot list. Skins `default` / `mult` / `sticky`; `txt_wild`, `txt_mult` empty; `badge` = `badge_t1..t5`; `clamp_L` / `clamp_R` = `clamp`, `clamp_open`. Chain: 2 floppy bones (apex + right drop) instead of 4 |
| `sym_H1` | 8 / 8 | 12 / 30 | 24 / 250 | 3 / 4 | Speakers (bezel ellipses), hinged tape door, handle deformed about its socket line, **antenna added from the c11 sheet** (the master has none; ANIMATION_SET lists one) |
| `sym_H2` | 6 / 8 | 9 / 30 | 0 / 250 | 0 / 4 | The whole record rebuilt from the master's radial profile (slides out 40 units, spins); reflections = a non-rotating sheen (`fx_groove`, normal blend, on the slide bone `record`); the label has a small printed arc on its hidden side so a spin reads. Explode: `disc_cracked` (f2) → `disc_shards` (f4) |
| `sym_H3` | 8 / 8 | 14 / 30 | 214 / 250 | 4 / 4 | Outline-bounded cuts; claws are meshes with a `pincer_*` bone each (snaps open, closes to contact); eyes = `open` / `half` / `closed` / `wide` from the c11 variants; antennae = 2-bone stiff chains (`phys_antenna_1_R`, `_2_R`, `_1_L`, `_2_L`: the physics budget is 4 and the name pattern allows L/R only at the end) |
| `sym_H4` | 7 / 8 | 15 / 30 | 49 / 250 | 3 / 4 | Cork cut along the glass rim (pops 30 units at `win_peak`; the bottle shows the rim back + open neck under it), sauce = a mesh band whose meniscus rides 3 jelly bones between 4 anchors, parchment label, flame wisp from the c11 sheet (`fx_flame`, normal blend on part bone `flame`, alpha 0 at rest) |
| `ui_groove_meter` (ui) | 22 / 30 | 22 / 40 | 49 / 400 | 0 | The woofer remapped radially onto DESIGN 6.1's bands (R = 320 units; round), cabinet 704 × 840 units, 20 notch badges (5 icons × 4 states), fx glow / swirl / burst / cap flash; skins `base` / `jukejam` / `megamix` / `bare`. One 2048² page |

All symbol clips have ANIMATION_SET §2.0's exact lengths (idle 90 / 75 / 105 / 84, land 12, win 24 with `win_peak` f8,
win_loop 45, explode 15 with `explode_burst` f2 and `explode_done` f13, blur 1, appear 9, bass_react 8 on track 1
starting and ending on the setup pose). The highs are gated on their 360 authoring canvas (`--cell 360`) and the wild on
368: a 95-97 % fill plus the contract land squash leaves a literal 300-unit cell (ANIMATION_CONTRACT 3.1, open decision).

## Registering in the game (runtime integration is a later step; `src/` is not touched here)

Until the Spine CLI export, the generated JSON + per-rig atlases load as they are
(`public/assets/bass-drop/spine/<skeleton>.{json,atlas,png}`; production: `.skel` + the shared `symbols` / `bd_ui`
atlases from `export.sh`). `ART_MANIFEST.spine` entries (`src/assets/manifest.ts`, `ManifestSpine`):

```ts
{ id: 'W',  skeleton: './assets/bass-drop/spine/sym_W.json',  atlas: './assets/bass-drop/spine/sym_W.atlas' },   // skin by mode at runtime
{ id: 'H1', skeleton: './assets/bass-drop/spine/sym_H1.json', atlas: './assets/bass-drop/spine/sym_H1.atlas' },
{ id: 'H2', skeleton: './assets/bass-drop/spine/sym_H2.json', atlas: './assets/bass-drop/spine/sym_H2.atlas' },
{ id: 'H3', skeleton: './assets/bass-drop/spine/sym_H3.json', atlas: './assets/bass-drop/spine/sym_H3.atlas' },
{ id: 'H4', skeleton: './assets/bass-drop/spine/sym_H4.json', atlas: './assets/bass-drop/spine/sym_H4.atlas' },
// the meter is not a symbol: load it where the Groove Meter view is built (skin base | jukejam | megamix | bare)
{ id: 'ui_groove_meter', skeleton: './assets/bass-drop/spine/ui_groove_meter.json', atlas: './assets/bass-drop/spine/ui_groove_meter.atlas' },
```

**sym_W**
- Skins: `default` (base game), `mult` (Juke Jam, badge), `sticky` (Mega Mix, badge + clamps). A sticky wild flies and
  lands in `mult`; switch to `sticky` when `sticky_lock` starts (it keys the clamps in from ±210 units). `setSkin` +
  `setupPoseSlots()` resets `badge` to `badge_t1`: set the tier again after a skin change.
- Slots for live objects (`addSlotObject`): `txt_wild` ("WILD", i18n `bd.wild`, on the ribbon), `txt_mult` ("×N",
  Lilita One, cap height 90 units). Tier: `setAttachment('badge', 'badge_t1'..'badge_t5')` at `mult_swap`.
  `ctrl_badge_scale` is the runtime's plate scale.
- Events: `drop_release` (drop_launch f2), `land_impact` (drop_impact f0: wild impact reaction), `lock_snap`
  (sticky_lock f6), `mult_swap` (mult_up f4), plus the contract `land_impact` / `win_peak` / `explode_burst` / `explode_done`.
- Mixes (ANIMATION_SET 2.6): drop_launch→drop_fall 0, drop_fall→drop_impact 0.03, drop_impact→idle 0.1,
  drop_impact→sticky_lock 0, sticky_lock→sticky_idle 0, sticky_idle→win 0.06, win_loop→mult_up 0.05, mult_up→sticky_idle 0.05.
- Rotation and the flight path of the drop belong to the runtime (`WildProxy`).

**sym_H1..H4**: the contract set + `bass_react` (track 1, additive: `SymbolRig.bassReact` already plays it when the
skeleton has it). H3 has no `blink` clip: its eye states are attachments of slot `eyes` (`open` / `half` / `closed` /
`wide`), keyed inside its clips. Rigs are authored upright; `restAngle` stays a runtime rotation.

**ui_groove_meter**
- Root = the ring centre; R = 320 units (2× the 160 px landscape radius); scale the skeleton for portrait / compact.
- Skins: `base` (teal trim), `jukejam` (gold), `megamix` (pink), `bare` (no cabinet). A compact feature mode: skin
  `bare` + `setAttachment('rim_trim', 'trim_jukejam' | 'trim_megamix')` (the three trims also live in the default skin).
- Runtime mounts (empty slots, `addSlotObject`): `led_arc` (the 60-tick LED arc, under the cone), `txt_count` (the
  counter, rides the cone's pump), `fx_blast` (`fx_speaker_blast` flipbook), `chip` (the next-drop chip plate, bone
  `chip_anchor` in the gauge gap, rides the cabinet squash).
- Notch slots `notch_1..6` (−100°, −50°, 0°, +50°, +100°, +150° clockwise from 12 o'clock, on 0.94 R) each carry all
  20 badges `notch_{w1,w2,w3,jj,mm}_{off,next,lit,spent}`; setup = the `off` badge of 10 / 20 / 30 / 40 / 50 / 60
  (w1, w1, w2, jj, w3, mm). The runtime sets the state with `setAttachment`.
- `fx_notch` (the burst star): the runtime moves it to the active notch (setup = the 0° notch) before
  `threshold_minor` / `threshold_major`; `ctrl_cone` = the runtime's additive beat pump; `fx_glow` is tinted by state
  (white in the art).
- Tracks: 0 `idle` / `heat_loop` / `armed_loop` / `overdrive_loop` / `charge` / `charge_chained` / `boom` /
  `feature_trigger`; 1 `tick` / `pump` / `drain`; 2 `threshold_minor` / `threshold_major`. `charge` and
  `charge_chained` end on `boom` f0, `boom` on `idle` f0, `feature_trigger` on `overdrive_loop` f0 (mix 0).
  Garnish events: `charge_start` f0, `boom` f0, `threshold_hit` f2, `pump_hit` f0 / f18 / f36.
- Not built (P2, fallback only): `lap_1..5` slots and the `lap` clip.
