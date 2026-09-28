# tools/bdart: Bass Drop environment + UI art without generation credits

Phase C track "environment + UI art" (ART_PLAN batches c12–c15, c21/c22). On 2026-09-28 the Higgsfield balance was
7.5 credits, below the 8-credit floor, so no batch of this track could be generated. Everything here is built from the
**approved** art only (`art/plan/approvals.json`) and implements each plan row's own `fallback`
(`art/plan/bass-drop.json`), with the art-director review done on the outputs. Deterministic: a rebuild writes the
same bytes. Provenance rows go to `art/manifest.json` through the shared locked writer (`tools/gen/provenance.py`).

```bash
PY=tools/.venv/bin/python
(cd tools/bdart && $PY backgrounds.py [--provenance])      # plates, neon layers, variants, tile  (~3 min)
(cd tools/bdart && $PY jukebox_crack.py [--provenance])    # cracked Juke Jam emblem + 6 shards
(cd tools/bdart && $PY cards.py [--provenance])            # 3 intro card illustrations
(cd tools/bdart && $PY logo.py [--provenance])             # logo emblem, no letters (blank banner)
tools/bdart/build_env.sh speaker_stack [--cut] [--capture build/qa/rigs/env_speaker_stack/capture]
```

| Script | Plan rows (fallback used) | Outputs |
|---|---|---|
| `backgrounds.py` | `bg_base_landscape` export; `bd_bg_base_{landscape,portrait}_neon` (procedural extraction); `bd_bg_{jukejam,megamix}_{landscape,portrait}` (grade + fog / lights in code); c22 variant neon (procedural extraction); c21 `bd_bg_tile` (brighten in code) | `art/source/backgrounds/bass-drop/*.webp` + `backgrounds.json` (sizes, crops, gates) |
| `jukebox_crack.py` | `bd_emblem_jukebox_cracked` (procedural cracks); notGenerated `shards` (cut of the approved art) | `art/source/ui/bass-drop/emblems/jukebox_cracked.png`, `jukebox_shards/shard_1..6.png` + `shards.json` |
| `cards.py` | `bd_card_meter`, `bd_card_jukejam`, `bd_card_megamix` (composite of approved art over a background crop); c21 buy cards = crops of these | `art/source/ui/bass-drop/cards/art_{meter,jukejam,megamix}.png` |
| `logo.py` | `bd_logo_emblem` (plan fallback: typeset word-mark alone; this adds an emblem from approved art, banner blank) | `art/source/ui/bass-drop/logo/logo_emblem.png` + `.json` (the banner text box) |
| `env_speaker_stack.py`, `build_env.sh`, `envgen.py`, `check_env.py`, `capture_env.mjs` | `bd_speaker_stack_master` / `_parts` (meter cabinet art reused) → rig `env_speaker_stack` (ANIMATION_SET 4.1) | parts `art/source/env/spine/images/env_speaker_stack/`, rig `art/source/env/speaker_stack/{parts.json,rig.yaml,bassdrop.yaml}`, build `build/spine/bd/env_speaker_stack.*` |

Library: `bglib.py` (plates, colour, gates: darker centre in L*, `layoutMatch` edge IoU), `prov.py` (manifest rows).

## Backgrounds

- **Base landscape**: the 21:9 anchor (ab1 `924d3637`) centre-cropped to 2:1 fails the darker-centre gate by itself
  (centre L\* 0.301 vs edges 0.277: the violet haze and the lit floor sit in the middle), so the reel area gets a
  calm-centre grade (linear light × (1 − 0.42·gx·gy), full inside the central 32 % of the width, none past 82 %; the
  frame covers 26–74 % of the 1920 screen anyway). After: centre 0.245 < edges 0.277.
- **Neon layers** (additive; black = no change; the runtime adds them at α 0..1 on the beat): emissive masks of the
  plate (teal / magenta tubes gated at V ≥ 0.86 so the lit booth edges stay out, warm bulbs and firefly jars, white-hot
  cores but not the cool moon), gated by local contrast at two scales, plus their painted halo. Variant neon layers use
  the base mask on the variant's own colours (aligned by construction); Juke Jam's dimmed string lights pulse less;
  Mega Mix adds its beams + specks at 50 % so the party lights pulse too.
- **Juke Jam (after hours)**: palette to cyan/teal (channel mix + split tone), string lights dimmed 62 % toward their
  surroundings, firefly jars kept warm gold, gator tubes kept, moonlit windows (pale cyan screen + bloom on the cool
  panes), clumped ground fog (2D fbm, 4:1, finer at the back) with moonlit tops.
- **Mega Mix (party lights)**: palette to magenta/gold, string lights at full brightness (cores + two-radius bloom),
  hot-pink and gold spotlight beams from lamp heads inside the 16:9 cover crop (x 5.6–94.4 % of the plate), faded over
  the reel area, ~150 soft mirror-ball specks on the side walls only.
- **Tile (P2)**: lifted exposure with a soft shoulder, warm daylight balance, pastel wash, lighter edges (no dark
  vignette), mean L\* 0.69. A stop-gap until `background.txt#D` can run.
- Sizes: landscape 2560 × 1280, portrait 1536 × 3072 (the same crop as `base_portrait.webp`), WebP q92 (neon layers
  lossless), 0.13–0.36 MB each.

## env_speaker_stack

Canvas 720 × 1440 (2 × the 304 × 320 landscape design size); root = canvas centre = the cabinet's bottom centre.
9 slots / 13 bones / ~170 mesh vertices / 2 physics (limits: ANIMATION_SET 4.1 ≤ 12 slots, ≤ 20 bones; env kind 200
vertices, 3 physics). Parts: `cabinet` (9-slice of the approved meter cabinet, face re-laid as a clean lacquered panel),
`woofer_rim` (meter rim + neutral trim, static), `woofer` (meter cone + surround + dust cap as a **polar mesh**: 5 rings
× 20 spokes, radially weighted so the dust cap pushes out rigidly and the cone edge holds; a grid mesh warped the round
cap into a polygon at the 1.18 punch), `port_L/R` (meter rim at 0.19 × + shaded port hole), `cable_1/2` (procedural
formula-D tubes with gold jack plugs; trace meshes on `phys_cable_*` floppy), `floor_light` + `fx_glow` (additive).
Clips (bassdrop.yaml): `idle` 72 f loop (breathes per beat at 100 BPM), `pump` 6 f overlay (track 1, woofer 1.06),
`boom_follow` 18 f (woofer 1.18 at f2, cabinet hop 6 units, cables whip through physics), `feature_follow` 54 f
(pumps at f2 / f20 / f38). No events (env rigs are garnish). `envgen.py` wraps the unmodified
`tools/spine/examples/bass_drop/bdgen.py` and adds the CR-8 `env` budgets and the `radial_weights.<mesh>.polar` option.
