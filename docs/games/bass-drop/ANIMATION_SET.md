# Swamp Funk: Bass Drop — animation set

The complete list of animated assets for Bass Drop: every Spine skeleton, flipbook and code-drawn effect, with parts, animations, frame windows, loop flags, events and budgets. The choreography that uses them is in [DESIGN.md](DESIGN.md). This file says **what to build**; DESIGN says **when it plays**.

Naming follows [ANIMATION_CONTRACT.md](../../ANIMATION_CONTRACT.md): contract names are used wherever they exist. Every new name (animations, events, FX ids, skeleton ids) is listed in §9 and §12. They go into the contract and `tools/spine/contract.json` in the same PR as the first rig that uses them (CR-8 in DESIGN §23). **Do not invent a third name.**

---

## 0. Conventions (apply to every rig here)

| Topic | Rule |
|---|---|
| Versions | Spine Editor **4.3.x** (one pinned patch) → `@esotericsoftware/spine-pixi-v8` 4.3.13. 4.3 JSON with one root `constraints[]` (IK → transform → physics); 4.2-format files are rejected |
| Frame rate | Everything authored at **30 fps**. Frame counts below are exact authored lengths. The runtime `timeScale` handles speed profiles (`speedScale()`) and tempo (UI loops run at `bpm / 100`) |
| Axes / units | Y-up in the editor. Symbols use the **360×360 @2x canvas** (cell = 300 units, `root` at the centre). Every other rig is authored at **2× its landscape design size** (e.g. the meter ring Ø 320 design px = 640 units) with `root` at the anchor stated per rig |
| Style | **Formula D** ([STYLE_DECISION.md](STYLE_DECISION.md), `artbible.bassDrop.styleFormula`; ART_BIBLE §2.1): a clean, confident, single-weight bold black outline (≈ 3% of the cell for symbols, 6–8 units for characters at 2×) with thinner dark interior lines; painterly layered shading with soft gradients, glossy highlights and crisp white specular hotspots; key light from the upper left plus a warm bounce light and a thin cool rim light. **No plum extrusion**: depth comes from the rendering. **No baked glow/bloom/blur**: glow lives only in `fx_*` slots (additive). Backgrounds use the painted-environment formula. Every part piece keeps the same outline weight as its master, so a split rig reads as one drawing |
| Text | **Never baked.** Every word or number is runtime BitmapText attached with `addSlotObject` to an **empty `txt_*` slot** (a bone + slot with no attachment at setup). Royal glyphs are the only lettering in art |
| Tracks | Symbols: 0 state · 1 overlay (additive FX, `bass_react`, dim) · 2 face · 3 look. Characters: 0 body · 1 additive overlays (`wild_land_react`, `pouch_pump`) · 2 face (blink, mouth swaps) · 3 look (`ctrl_look` driven by the runtime). UI/env: 0 state · 1 one-shot overlays (tick, pump, hover) · 2 notch/button overlays |
| Mixes | `defaultMix` 0.08 plus the contract §3 pairs, plus the pairs listed per rig below |
| Events | Symbol rigs keep the contract roles (`land_impact`, `win_peak`, `explode_burst`, `explode_done`). **UI, env and meter rigs emit timing events for garnish only (SFX, VFX).** Gameplay-synchronous effects (shake, flash, hit-stop, wild launch) are fired by the runtime timeline from `BASS_DROP_TIMING`, so they stay tunable and deterministic. Character rigs may carry `sfx` / `vfx` foley events |
| Colour changes | By attachment or skin swap. Tint keys only on `fx_*` slots |
| Physics | Contract §2.5 presets: `floppy` 3.0 Hz/ζ 0.20 (tails, cables, chains), `default` 3.5/0.25 (jowls, pouch, belly), `stiff` 4.0/0.30 (toothpick, antennae), `jelly` 5.0/0.30 (sauce). `limit` ≥ 12,000 on symbols; characters 6,000 (they never fall) |
| Packing | PMA, 2048² max pages, `pot:false`, padding 2, polygons, no extensions in region names; packs at `[1, 0.5]` (@2x and @0.5x). **No clipping attachments, no sequence attachments** (contract §2.4) |
| Files | Shared symbol rigs keep their Swamp Funk paths (`public/assets/spine/sym_<ID>.skel`, `symbols.atlas`). Bass Drop–only rigs go in `public/assets/bass-drop/spine/<id>.skel` with atlases `bd_ui`, `bd_env`, `bd_chr_gumbo`, `bd_chr_croak`, and flipbooks in `public/assets/bass-drop/fx/` (implementation may move the folder; ids stay) |
| Validation | `GAME=bass-drop pnpm spine:validate <json> --kind <auto\|high\|royal\|wild\|ui\|env\|character>`. Today the validator accepts only `auto\|high\|special\|royal\|any`; the new kinds, their budgets (§10) and the `wild` mapping (§12) are CR-8 |

Priorities:
- **P0**: first playable with the full bass-drop loop;
- **P1**: feature-complete;
- **P2**: polish.

---

## 1. Master inventory

| Id | Type | Atlas / file | Used for | Priority |
|---|---|---|---|---|
| `sym_H1`…`sym_H4` | Spine (existing Swamp Funk rigs + `bass_react`) | `symbols` | High pays | P0 (reuse), P1 (`bass_react`) |
| `sym_L1`…`sym_L5` | Spine (**new**, light rig) | `symbols` | Royals | P1 (procedural GSAP until then) |
| `sym_W` | Spine (**extended**) | `symbols` | Wild: drop, multiplier, sticky | **P0** |
| `ui_groove_meter` | Spine | `bd_ui` | Groove Meter + upper cabinet | **P0** |
| `env_speaker_stack` | Spine | `bd_env` | Lower cabinet, cables, floor light | P1 |
| `env_dj_booth` | Spine | `bd_env` | Croak's turntable crate + drop button | P1 |
| `env_horn` | Spine (×2, right one flipped) | `bd_env` | Frame corner horn speakers | P1 |
| `chr_gumbo` | Spine 2D character | `bd_chr_gumbo` | Left mascot | **P0** (idle, bass_drop, react_small, fs_trigger), P1 rest |
| `chr_croak` | Spine 2D character | `bd_chr_croak` | Right mascot | **P0** (idle, bass_drop_charge, bass_drop, react_small, fs_trigger), P1 rest |
| `ui_intro_cards` | Spine UI | `bd_ui` | Game intro 3 cards | P1 |
| `ui_buy_cards` | Spine UI | `bd_ui` | Bonus buy 2 cards + confirm | P1 |
| `ui_feature_intro` | Spine UI (skins `jukejam`, `megamix`) | `bd_ui` | Feature intro | **P0** |
| `ui_feature_upgrade` | Spine UI | `bd_ui` | Juke Jam → Mega Mix | P1 |
| `ui_feature_outro` | Spine UI (skins) | `bd_ui` | Feature summary | **P0** |
| `ui_bigwin` | Spine UI (existing contract §6, skin `bassdrop`) | `bd_ui` | Big-win tiers | P1 (the existing procedural big win until then) |
| `ui_spin_btn` | Spine UI (existing) | `ui` | Spin button | unchanged |
| `fx_speaker_blast`, `fx_wild_impact`, `fx_feature_blast`, `fx_title_shine` | Flipbooks | `bd_fx` pages | Boom, impact, trigger, titles | P1 (live-particle fallbacks at P0) |
| Orbs, links, LED arc, reticles, shadows, count pops, lap pips, chip, plates, rings | **Code** (Pixi) | small regions in `bd_ui` | §8 | **P0** |
| Background variants: base, Juke Jam (after-hours), Mega Mix (party lights) | Static layers + neon additive layer | `bg_*` | DESIGN §10 | P1 |
| Logo: "SWAMP FUNK / BASS DROP" emblem | Static + existing shine sweep | `logo_bd` | Top right | P1 |

---

## 2. Symbols

### 2.0 Shared symbol rules

- Rigs, bones (`root`, `squash`, `body`, `ctrl_*`, `phys_*`, `face_*`, `fx_*`), slots, skins, the land contact frame and the event roles follow ANIMATION_CONTRACT §2–§5 unchanged. The 124 px cell only changes the runtime fit (0.827), never the authoring canvas.
- **One new overlay animation for every symbol: `bass_react`.**
  - Track 1, additive (`MixBlend.add`), no loop, **8 f**.
  - Played by the runtime on every boom, staggered by distance from the meter (DESIGN §5).
  - Motion: `squash` bone sy 0.95 / sx 1.03 at f1, rebound sy 1.03 at f4, back to 0 at f8 (additive deltas), plus each symbol's themed part motion.
  - No events.
- Frame choices inside the contract windows (varied idle lengths so the board never breathes in unison):

| Anim | H1 | H2 | H3 | H4 | Contract window | Events |
|---|---|---|---|---|---|---|
| `idle` (loop) | 90 f | 75 f | 105 f | 84 f | 60–120 | none |
| `land` | 12 f | 12 f | 12 f | 12 f | 9–15 | `land_impact` f0 |
| `win` | 24 f | 24 f | 24 f | 24 f | 18–27, ≤ 900 ms | `win_peak` f8 |
| `win_loop` (loop) | 45 f | 45 f | 45 f | 45 f | 30–60 | none |
| `explode` | 15 f | 15 f | 15 f | 15 f | 9–18 | `explode_burst` f2, `explode_done` f13 |
| `blur` (loop) | 1 f | 1 f | 1 f | 1 f | 1–2 | none |
| `appear` | 9 f | 9 f | 9 f | 9 f | 6–12 | none. Used when a symbol is set without a drop (intro deal, resume) |
| `bass_react` (overlay) | 8 f | 8 f | 8 f | 8 f | new | none |

### 2.1 H1 Golden Boombox (heavy, −6°)

- **Slots (8):** `handle`, `body`, `cassette_door`, `speaker_L`, `speaker_R`, `antenna`, `fx_glint`, `fx_glow`.
- **Bones (≤ 14):** `root`, `squash`, `body`, `handle`, `cassette_door`, `speaker_L`, `speaker_R`, `phys_antenna_1..3`, `fx_glint`, `fx_glow`.
- **Physics:** `phys_antenna_*` stiff.

| Anim | Motion notes |
|---|---|
| `idle` | Speakers breathe 1.0→1.03 on f0/f45; the antenna settles; one glint sweep at f60 |
| `land` | Contract squash sy 0.85; the speakers pump 1.08 at f2 |
| `win` | Dip f0–f4, pop to 1.25 at f8 (`win_peak`), the cassette door flips open f8–f14, settle to 1.10 |
| `win_loop` | Speakers pump on f0/f22 (≈ 100 BPM, 2 beats); the door rattles |
| `explode` | Speakers blow out first (f0–f2), burst at f2, parts fly, alpha 0 at f15 |
| `bass_react` | **Both speaker cones punch 1.15 at f1** (the signature: every boombox on the board pumps with the drop) |

### 2.2 H2 Vinyl Record (medium, 0°)

- **Slots (6):** `sleeve`, `disc`, `label`, `fx_glint`, `fx_glow`, `fx_groove` (additive groove sheen).
- **Bones (≤ 10):** `root`, `squash`, `body`, `sleeve`, `disc`, `label`, `fx_*`.

| Anim | Motion notes |
|---|---|
| `idle` | Disc slides out 6 units and back; one glint |
| `win` | The disc slides out of the sleeve 40 units at f8 (`win_peak`) with a 90° spin |
| `win_loop` | The disc spins 360° per 45 f (loop-exact) |
| `explode` | The disc shatters (6 shard attachments swapped in at f2) |
| `bass_react` | The disc wobbles ±8° (f1–f6) |

### 2.3 H3 Crawfish (medium, −14°)

- **Slots (8):** `tail_fan`, `body`, `claw_L`, `claw_R`, `antenna_L`, `antenna_R`, `eyes` (attachments `open` / `half` / `closed` / `wide`), `fx_glow`.
- **Bones (≤ 24):** `root`, `squash`, `body`, `tail_fan`, `claw_L`, `claw_R`, `pincer_L`, `pincer_R`, `phys_antenna_L_1..3`, `phys_antenna_R_1..3`, `face_eyes`, `fx_glow`.
- **Physics:** antennae stiff.

| Anim | Motion notes |
|---|---|
| `idle` | Claws snap at f40 and f80; antennae sway; blink at f60 |
| `win` | Claws up, "swagger" hip sway, eyes `wide` at f8 |
| `win_loop` | Claws pump alternately on 2 beats |
| `bass_react` | Claws flinch up 12°, eyes `wide` f1–f5; the physics antennae whip |

### 2.4 H4 Hot Sauce (medium, −12°)

- **Slots (7):** `bottle`, `sauce` (mesh, jelly physics), `label`, `cap`, `fx_flame`, `fx_glint`, `fx_glow`.
- **Bones (≤ 14):** `root`, `squash`, `body`, `cap`, `phys_sauce_1..3`, `fx_flame`, `fx_*`.

| Anim | Motion notes |
|---|---|
| `idle` | Sauce slosh settles; flame wisp flicker (3 keys) |
| `win` | The cap pops 30 units up at f8 (`win_peak`), the flame flares |
| `bass_react` | Sauce slosh kick + cap hop 8 units |

### 2.5 L1–L5 Royals (A K Q J 10), new light Spine rig (P1)

The runtime keeps the shine **shader** for the band sweep, because there is no clipping in Spine. The rig adds squash, jelly and glint.

- **Slots (3):** `letter` (mesh 4×4 = 16 verts, the whole carved-wood letter with its enamel face and painterly gradient shading; no extrusion under formula D), `fx_glint` (additive star at the top-left), `fx_glow`.
- **Bones (≤ 8):** `root`, `squash`, `body`, `bend_top`, `bend_bottom` (mesh weights), `fx_glint`, `fx_glow`.

| Anim | f | Loop | Events | Notes |
|---|---|---|---|---|
| `idle` | 90 | yes | — | Optional glint at f50 |
| `land` | 12 | no | `land_impact` f0 | Contract squash (light weight) |
| `win` | 21 | no | `win_peak` f7 | Pop 1.22, jelly top lag |
| `win_loop` | 45 | yes | — | |
| `explode` | 12 | no | `explode_burst` f2, `explode_done` f10 | Splinters (4 chip attachments) |
| `blur` | 1 | yes | — | `letter_blur` region |
| `appear` | 9 | no | — | |
| `bass_react` | 8 | overlay | — | Hop 6 units |

### 2.6 W — Wild, extended rig (P0)

It keeps the Swamp Funk design: a gold-capped gator-tooth charm with a teal enamel inlay, and the word **WILD as live text** on a ribbon. Bass Drop adds a multiplier badge, sticky clamps, a flight trail and an impact ring.

**Budget exception** (special kind `wild`): ≤ 34 bones, **≤ 12 slots**, ≤ 300 mesh verts, ≤ 4 physics constraints.

**Slots (12, back to front):**

| # | Slot | Attachments | Notes |
|---|---|---|---|
| 1 | `fx_glow` | `glow` | Additive, tinted per badge tier by the runtime |
| 2 | `fx_trail` | `trail_streak` | Additive speed streak, visible in `drop_fall` only |
| 3 | `chain` | mesh | `phys_chain_1..4`, floppy |
| 4 | `tooth` | mesh 5×5 | Main body |
| 5 | `cap` | `cap` | Gold cap |
| 6 | `ribbon` | `ribbon` | Plate for the WILD word |
| 7 | `txt_wild` | **empty** | Runtime BitmapText "WILD" (i18n `bd.wild`) |
| 8 | `clamp_L` | `clamp`, `clamp_open` | Sticky only (skin `sticky`) |
| 9 | `clamp_R` | `clamp`, `clamp_open` | Sticky only |
| 10 | `badge` | `badge_t1` … `badge_t5` | Multiplier plate per tier (DESIGN §9 colours); t5 has a flame crown |
| 11 | `txt_mult` | **empty** | Runtime BitmapText "×5" |
| 12 | `fx_ring` | `ring` | Additive impact ring |

**Badge geometry** (on the 360 canvas, cell = 300 units):
- plate 192 × 120 units (64% × 40% of the cell), centred **129 units below `root`**, so it overlaps the cell's bottom edge by 30 units (10%);
- `txt_mult` cap height **90 units (30% of the cell)**, Lilita One BitmapText (installed at 72 px, runtime-scaled), gold-white fill, 4 px black stroke.

**Bones (≤ 26):**
- `root`, `squash`, `body`, `tooth`, `cap`, `ribbon`, `txt_wild`;
- `badge`, `txt_mult`, `clamp_L`, `clamp_R`;
- `phys_chain_1..4`, `fx_glow`, `fx_trail`, `fx_ring`, `ctrl_badge_scale`.

**Skins:**
- `default`: base game; badge slot empty;
- `mult`: Juke Jam; badge visible;
- `sticky`: Mega Mix; badge visible, clamps start `clamp_open` off-screen.

The runtime picks the skin from the wild's mode and attaches the tier attachment.

**Animations:**

| Anim | f | Loop | Events | Motion |
|---|---|---|---|---|
| `idle` | 90 | yes | — | Chain sway, inlay glint at f45 |
| `land` | 12 | no | `land_impact` f0 | Natural landing (special weight), contract squash |
| `win` | 24 | no | `win_peak` f8 | Pop 1.25; badge punch 1.15 |
| `win_loop` | 45 | yes | — | Tooth rocks ±4°, glow pulse |
| `explode` | 15 | no | `explode_burst` f2, `explode_done` f13 | Tooth cracks, cap flies, the badge spins away. On skin `sticky` the clamps spring open first (f0–f2): a winning Mega Mix sticky explodes like any wild and returns at its home next spin (DESIGN §9), so it must read "released", not "lost" |
| `blur` | 1 | yes | — | `_blur` regions |
| `appear` | 9 | no | — | |
| `bass_react` | 8 | overlay | — | Chain jingle, glow flare |
| **`drop_launch`** | **8** | no | `drop_release` f2 | f0 compressed (sy 0.8, sx 1.15); f2 released (stretch sy 1.25 / sx 0.86 along the body axis); the chain whips; `fx_glow` flare 1.4; ends on `drop_fall` f0 (mix 0). **Rotation and path belong to the runtime** |
| **`drop_fall`** | **12** | yes | — | Stretch pulses sy 1.10↔1.14, chain trails (physics + keyed lag), `fx_trail` alpha 0.6↔1.0 flicker; first key = last key |
| **`drop_impact`** | **15** | no | `land_impact` f0 | f0 contact; **f1 sy 0.72 / sx 1.18**; f5 rebound sy 1.10 / sx 0.95; f9 sy 0.97; f15 setup pose. `fx_ring` scale 0.3→1.6, alpha 1→0 over f0–f9; badge drops 12 units at f1 and springs back by f7. The runtime plays the impact SFX, dust, flipbook, shake and hit-stop at the event |
| **`sticky_lock`** | **12** | no | `lock_snap` f6 | Clamps slide in from ±210 units (`clamp_open` → `clamp`) f0–f6, overshoot 6 units f7, settle f10; glow flash f6–f10; ends on `sticky_idle` f0 |
| **`sticky_idle`** | **60** | yes | — | Bolt glints alternate L/R (f10, f40); badge heartbeat 1.0→1.04 at f0 and f30; chain sway 30% of idle |
| **`mult_up`** | **12** | no | `mult_swap` f4 | Badge squash sy 0.85 f0–f3, **text/tier swap at f4**, punch 1.35 at f5, settle by f12; glow flare; ends on `sticky_idle` f0 |
| **`sticky_unlock`** | **9** | no | — | Clamps spring open and slide out; glow fade |

New mixes: `drop_launch→drop_fall` 0 · `drop_fall→drop_impact` 0.03 · `drop_impact→idle` 0.1 · `drop_impact→sticky_lock` 0 · `sticky_lock→sticky_idle` 0 · `sticky_idle→win` 0.06 · `win_loop→mult_up` 0.05 · `mult_up→sticky_idle` 0.05.

Validator entries (CR-8):
- `drop_impact` has its own squash gate: sy **0.70–0.76** on `squash`, ends at the setup pose, and may leave the cell by ≤ 20% (the depth slam is meant to spill);
- `drop_fall` loop seam;
- `mult_up` and `sticky_lock` end on `sticky_idle` f0;
- event frames: `drop_release` f1–f3, `lock_snap` f5–f7, `mult_swap` f3–f5.

### 2.7 Symbol pooling (runtime note for the art budget)

- Normal symbols borrow pooled Spine instances only for actions (≈ 4 per type).
- **Sticky wilds are live instances while they are on the board** (at most 5 homes in the mock, plus one-shot multiplier wilds). A sticky W is an ordinary board symbol within a spin (it wins, explodes and tumbles) and returns at its home on the next reveal (DESIGN §9). At most **24** animated symbol instances at once. Above that, the oldest sticky wilds fall back to a static sprite + runtime glint (low tier: above 12).

---

## 3. Groove Meter — `ui_groove_meter` (P0)

**Anchor:** `root` = ring centre. Authored at 2× landscape (ring Ø 640 units; the upper cabinet 704 × 840 units, its bottom edge at y = −428 from the ring centre). Portrait and compact scale the rig; compact hides the cabinet (skin `bare`).

**Bones (≤ 40):**
- `root`, `cabinet` (pivot at the cabinet's bottom centre, for squash/stretch), `cabinet_top`;
- `ring`, `cone`, `ctrl_cone` (runtime additive scale for beat pumps), `dust_cap`, `txt_count`;
- `swirl`, `notch_1..6` (on radius 0.94 R at −100°, −50°, 0°, +50°, +100°, +150°), `fx_notch` (runtime rotates it to the active notch), `lap_1..5` (fallback laps only, P2);
- `fx_glow`, `fx_burst`, `fx_blast`, `led_arc`, `chip_anchor`.

**Slots (≤ 30, back to front):**

| Slot | Attachments | Notes |
|---|---|---|
| `cabinet_back` | `cabinet_back` | Plum-black wood + bolts |
| `grill` | `grill_cloth` | |
| `cabinet_front` | `cabinet_front` | Frame of the woofer opening |
| `rim` | `rim` | Chunky metal ring |
| `rim_trim` | `trim_base`, `trim_jukejam`, `trim_megamix` | Skin-driven colour band |
| `led_arc` | **empty** | Runtime inserts the code-drawn 60-tick LED arc here (§8) |
| `cone_surround` | `surround` | |
| `cone` | `cone` (mesh 6×6 for the punch bulge) | |
| `dust_cap` | `dust_cap` | Dark glass disc |
| `txt_count` | **empty** | Runtime counter "23/60" |
| `notch_1..6` | `notch_w1`, `notch_w2`, `notch_w3` (pip variants), `notch_jj`, `notch_mm`, each in states `_off` / `_next` / `_lit` / `_spent` | Runtime sets states; icons carry **no text** |
| `lap_1..5` | `pip_off`, `pip_on` | Fallback laps (DESIGN §6.7): only if a book lists a threshold above 60, which the current math never does. P2 |
| `fx_swirl` | `swirl` | Additive, rotates in `charge` / `armed_loop` |
| `fx_glow` | `glow_ring` | Additive rim glow, tinted by state |
| `fx_burst` | `burst_star` | Additive notch burst on `fx_notch` |
| `fx_blast` | **empty** | Runtime attaches the `fx_speaker_blast` flipbook |

**Skins:** `base` (teal trim), `jukejam` (gold), `megamix` (pink; lap pips shown only in the fallback), `bare` (compact: no cabinet slots).

**Animations** (the runtime conducts; events are garnish hooks):

| Anim | Track | f | Loop | Events | Notes |
|---|---|---|---|---|---|
| `idle` | 0 | 72 | yes | — | 4 beats @100 BPM: cone breathe 1.00→1.02 per beat, dim glow. The runtime also pumps `ctrl_cone` on `music:beat` |
| `heat_loop` | 0 | 16 | yes | — | ≈ 1.9 Hz cone flutter + rim shimmer (DESIGN §6.2) |
| `armed_loop` | 0 | 15 | yes | — | 2 Hz: swirl turning slowly, cone vibration ±1.5 units |
| `overdrive_loop` | 0 | 24 | yes | — | ≥ 60 in every mode (the MAX state, DESIGN §6.7): pink sparks, rim pulse 1.25 Hz |
| `tick` | 1 | 4 | no | — | Orb arrival: cone 1.00→1.03→1.00, dust-cap flash |
| `pump` | 1 | 6 | no | — | Big-win tier punch / music accents: cone 1.08 |
| `threshold_minor` | 2 | 15 | no | `threshold_hit` f2 | `fx_notch` burst star 0→1.6, rim flash sweep once around (`fx_glow` rotation) |
| `threshold_major` | 2 | 27 | no | `threshold_hit` f2 | Bigger burst, glow wave twice around, badge scale 1.4 at f3 |
| `charge` | 0 | **15** | no | `charge_start` f0 | Cone pulls to 0.88 (`power2.in` feel), cabinet sy 0.94, swirl 0→720°/s, glow ramps to 1; last frame = `boom` f0 pose |
| `charge_chained` | 0 | **6** | no | `charge_start` f0 | Short version (swirl already spinning) |
| `boom` | 0 | **18** | no | `boom` f0 | **f1 cone 1.20**, f5 0.96, f8 1.04, f14 1.00; cabinet sy 1.08 at f1 → settle f12; `fx_glow` flash; `fx_blast` flipbook starts at f0 (runtime). Ends on the `idle` pose |
| `drain` | 1 | 12 | no | — | Cone relax + glow fade; the LEDs are drained by code over the same 400 ms. Plays at base spin start, behind the feature wipe and behind the upgrade screen (the math restarts the meter at both) |
| `feature_trigger` | 0 | **54** | no | `pump_hit` f0, f18, f36 | Three pumps on the beat (cone 1.12 / 1.16 / 1.30); f36 is the big one (cabinet stretch 1.12); ends in `overdrive_loop` pose |
| `lap` | 2 | 9 | no | — | Fallback only (P2). Ring flash; the runtime lights the next pip |

Runtime timeScale: `charge`, `charge_chained` and `boom` are scaled so their lengths equal `s(BASS_DROP_TIMING.drop.charge)` etc. The 15 f `charge` therefore always ends exactly on the boom, in every speed profile.

---

## 4. Environment rigs

### 4.1 `env_speaker_stack`: lower cabinet (P1)

**Anchor:** bottom centre of `lowerCabinet`.

| Item | Spec |
|---|---|
| Parts / slots (≤ 12) | `cabinet`, `woofer` (mesh), `port_L`, `port_R`, `cable_1`, `cable_2` (meshes, `phys_cable_*` floppy), `floor_light` (additive cone), `fx_glow` |
| Bones | ≤ 20 |

| Anim | f | Loop | Events | Notes |
|---|---|---|---|---|
| `idle` | 72 | yes | — | Woofer breathe per beat, cables settle |
| `pump` | 6 | overlay | — | Woofer 1.06 |
| `boom_follow` | 18 | no | — | Woofer punches at **f2** (2 frames behind the meter: the energy "travels down"), cabinet hop 6 units, cables whip (physics kick keyed on the root) |
| `feature_follow` | 54 | no | — | Pumps at f2, f20, f38 |

### 4.2 `env_dj_booth`: Croak's turntable crate (P1)

**Anchor:** bottom centre.

| Item | Spec |
|---|---|
| Slots (≤ 16) | `crate`, `deck`, `platter` (rotates), `label`, `tonearm`, `fader_track`, `fader_knob`, `drop_button` (`button_up`, `button_down`), `button_glow` (additive), `led_1..4` (`led_off`, `led_on`), `cable` (`phys_cable` floppy) |
| Bones | ≤ 24 |

| Anim | f | Loop | Events | Notes |
|---|---|---|---|---|
| `idle` | 72 | yes | — | Platter 1 rev / 72 f; LEDs chase once per beat |
| `scratch` | 36 | no | `sfx: dj_scratch` f4 | Platter back-and-forth ×2, tonearm jitter |
| `drop_press` | 15 | no | — | Button glow ramps f0–f13, `button_down` at **f14–f15** (in sync with Croak's `bass_drop_charge` f14) |
| `boom_follow` | 18 | no | — | Crate hop, LEDs all on and fading |
| `frenzy_loop` | 24 | yes | — | Celebrate: LEDs strobe at 2.5 Hz (≤ 3 Hz), platter fast |

### 4.3 `env_horn`: frame corner horns (×2, the right one mirrored with scaleX −1) (P1)

**Anchor:** the bolt point on the beam corner.

| Item | Spec |
|---|---|
| Slots (≤ 6) | `bracket`, `horn_body`, `bell` (mesh), `fx_glow`, `fx_puff` |
| Bones | ≤ 10 |

| Anim | f | Loop | Events | Notes |
|---|---|---|---|---|
| `idle` | 72 | yes | — | Tiny bell breathe |
| `pump` | 6 | overlay | — | Bell flare 1.05 |
| `boom_follow` | 18 | no | — | Bell flares 1.18 at f2, the horn recoils 8 units, dust puff (`fx_puff`) |
| `feature_follow` | 54 | no | — | Pumps at f2, f20, f38 |

---

## 5. Mascots: 2D Spine characters

These replace the three.js GLBs **for Bass Drop only** (DESIGN §16). The `MascotCue` interface is unchanged; the clip names follow ANIMATION_CONTRACT §7.2 so the cue → clip table carries over.

**Common rules:**
- **Canvas:** authored at 2× the landscape rect height; `root` = the feet anchor (`layout.json → mascots.*.feet`).
- **View:** three-quarter, turned toward the reels (Gumbo faces screen-right, Croak faces screen-left).
- **Near and far side** (ART_BIBLE `bassDrop.mascots.*.nearSide`): `_L`/`_R` are the character's own sides. Facing screen-right puts Gumbo's **right** side nearer the viewer, and facing screen-left puts Croak's **left** side nearer. The near-side limbs, eye and headphone cup are drawn **in front of** the torso; the far side is drawn behind it. The slot lists below are back to front in that order, and the part sheets name the pieces "near …" and "far …" the same way (`artbible.bassDrop.mascots.*.sheets`).
- **Parts:** cut from the formula-D part sheets by `tools/split` onto the rig master (the parts contract in `tools/spine/README.md`). Every limb piece ends in a round overlap cap centred on its joint.
- **Proportions:** adult (head bbox ≤ 27% of total height, ART_BIBLE §7). Outline 6–8 units at 2× (3–4 px on screen).
- **Bone names** (contract §7.5 words, so `procedural`-style helpers can find them):
  - core: `hips`, `spine`, `chest`, `neck`, `head`;
  - limbs: `upper_arm_L/R`, `forearm_L/R`, `hand_L/R`, `thigh_L/R`, `shin_L/R`, `foot_L/R`;
  - IK: `ik_foot_L/R` (feet planted), `ik_hand_L/R`;
  - look: `ctrl_look` (runtime-driven aim target) with a `look` transform constraint on `head` (mix 0.6) and the pupils (mix 1.0);
  - springs: `phys_<part>_<n>` with `<part>` ∈ tail, jowl, belly, chain, pouch, cable, toothpick.
- **Faces:** attachment swaps on track 2 (no morphs in 2D). Every eye slot has `open`, `half`, `closed`, `wide`; the mouth slots are listed per character.
- **Budgets (kind `character`):** ≤ 80 bones · ≤ 40 slots · ≤ 2,400 weighted mesh verts · ≤ 12 physics constraints · **1 atlas page 2048² @2x** (+ @0.5x) · 1 draw call (normal blend; any `fx_*` slots are additive and batch after).
- **Loops** match their first and last keys. Physics is excluded from the seam check, as in the contract.
- **Additive overlays** (track 1) are authored as deltas from the setup pose.

### 5.1 `chr_gumbo`: heavyset adult alligator bouncer (left)

- **Build:** wide, low centre of mass, slow tempo (clips authored at tempo 0.92: weight lands late, holds are longer).
- **Wardrobe** (the adopted formula-D design `ab2/D_gumbo`): tight maroon tank top, dark blue work jeans, black rubber boots, one gold tooth, a toothpick. **No gold chain**: the adopted design has none, so there is no `chain` slot and no `phys_chain_*` (`artbible.bassDrop.mascots.gumbo.rigDeltas`). A chain comes back only with a new design sheet that draws it.
- **Near side = his R** (facing screen-right): the near (R) limbs are in front of the torso; the far (L) limbs are behind it.
- **Pose (landscape):** stands in front-right of the lower cabinet with his **far (left) forearm resting on the cabinet top** behind him (`hand_L` `lean`, `ik_hand_L`), so every boom physically shoves him. The cooler sits at his feet for the slams, within reach of the near (right) fist.

**Slots (≈ 35, back to front):**
- `tail` (mesh; rests on the ground behind the far leg, clear of both legs);
- far side, behind the torso: `thigh_L`, `shin_L`, `foot_L` (boot); `upper_arm_L`, `forearm_L`, `hand_L` (`open`, `fist`, `point`, `lean`);
- `torso` (mesh), `tank_top` (mesh), `belly` (mesh);
- `neck`, `jaw` (mesh), `teeth_lower`, `head` (mesh, skull + snout top), `teeth_upper`, `gold_tooth`, `nostrils`;
- `eye_L` (far), `eye_R` (near) (4 states each), `pupil_L`, `pupil_R`, `brow_L`, `brow_R`;
- `mouth` (`closed_pick`, `grin`, `open`, `roar`), `toothpick`, `jowl` (mesh);
- near side, in front of the torso: `thigh_R`, `shin_R`, `foot_R` (boot); `upper_arm_R`, `forearm_R`, `hand_R` (`open`, `fist`, `point`);
- `cooler_body`, `cooler_lid`, `fx_sweat` (additive, bored/heat).

**Bones (≈ 60):**
- core chain + limbs as above;
- `jaw`, `snout`, `face_eye_L/R`, `face_pupil_L/R`, `face_brow_L/R`, `toothpick`, `phys_toothpick`;
- `phys_jowl_1..2`, `phys_belly`, `tail_1..5` + `phys_tail_1..5`;
- `cooler`, `cooler_lid`, `ik_*`, `ctrl_look`.

**Physics (9 constraints, budget ≤ 12):** tail floppy (`phys_tail_1..5`), belly default (`phys_belly`), jowl default (`phys_jowl_1..2`), toothpick stiff (`phys_toothpick`). The dropped chain would have added 4 constraints (13, over the budget).

| Clip | f | Loop | Track | Events | Acting |
|---|---|---|---|---|---|
| `idle` | **168** (5.6 s) | yes | 0 | — | Breathing (chest 1.00→1.02 twice), slow weight shift, tail swish, toothpick flick at f96 |
| `idle_bored` | 180 | yes | 0 | — | Yawns (`open` f40–f70), inspects claws, glances at the stack |
| `anticipation` | 36 | yes | 0 | — | Leans toward the reels, holds breath (chest held) |
| `meter_heat` | 48 | yes | 0 | — | Looks up at the meter (`ctrl_look` keyed), cracks knuckles at f12 and f30 |
| `react_small` | 45 | no | 0 | — | Fist pump f10–f25, `grin` |
| `react_point` | 30 | no | 0 | — | Points at the meter at f8, nod |
| `bass_drop` | **36** | no | 0 | — | f0–f14: braces (hunches, squints `half`, left hand grips the cabinet, `mouth` `closed_pick`). **f15 hit** (= the boom): hips pushed back 24 units f15–f18, eyes `wide`, toothpick flips; physics kicked by the keyed hip jolt. Recovers by f36 |
| `wild_land_react` | 12 | no | **1** (additive) | — | Flinch: head dips 6 units f1, blink |
| `win_big` | 60 | no | 0 | `sfx: cooler_slam` f24 | Slams the cooler lid at f24 with the right fist, lid bounces, `roar` |
| `celebrate` | **72** | yes | 0 | — | 4 beats @100 BPM: shoulder bounce, tail wags on beats, belly jiggles |
| `fs_trigger` | **75** | no | 0 | `sfx: cooler_slam` f36 | Wind-up f0–f30, **two-fisted slam at f36** (= feature-trigger pump 3), roar hold, return |
| `fs_end` | 54 | no | 0 | — | Nod + two-finger salute |
| `blink` | 5 | no | **2** | — | `closed` f1–f3 |

Aliases for the orchestrator's names: `bored` → `idle_bored`, `feature_trigger` → `fs_trigger`, "bass_drop reaction" → `bass_drop`.

### 5.2 `chr_croak`: lanky adult bullfrog DJ (right)

- **Build:** tall, springy, quick (tempo 1.06).
- **Design** (adopted v2 brief `ab1/ab_croak_v2`, re-made in formula D as plan row `mascot_croak_sheet`): flat-brim cap worn backwards; open hot-pink bowling shirt with a black lightning pattern over a black tank top; baggy black cargo shorts; big over-ear headphones **around the neck**; a heavy gold chain with a vinyl-record pendant; a large throat pouch. Rest face: eyes open and a very wide confident grin. `half` eyes are a blink frame only, never a rest pose (they would give the meme-frog read, `artbible.bassDrop.mascots.croak.avoid`).
- **Near side = his L** (facing screen-left): the near (L) limbs, eye and headphone cup are in front; the far (R) side is behind.
- **Pose:** stands behind the `env_dj_booth`, near (left) hand on the fader (`ik_hand_L`), far (right) hand on the deck (`ik_hand_R`).

**Slots (≈ 34, back to front):**
- far side, behind the torso: `upper_arm_R`, `forearm_R`, `hand_R` (`open`, `point`, `fist`, `scratch`, `press`), `mic` (hidden until `fs_trigger`);
- `thigh_R`, `shin_R`, `foot_R` (far), `thigh_L`, `shin_L`, `foot_L` (near);
- `torso` (mesh), `shirt` (mesh);
- headphones around the neck, far side: `band` (over the back of the collar), `cup_R`;
- `chain` (mesh, record pendant), `pouch` (mesh, inflates), `head` (mesh), **`cap`** (new: the backwards flat-brim cap on the `head` bone; it follows every nod and look), `eye_bulge_R`, `eye_bulge_L`, `eye_R`, `eye_L` (4 states), `pupil_R`, `pupil_L`, `lid_R`, `lid_L`;
- `mouth` (`closed`, `smile`, `open`, `O`);
- headphones, near side: `cup_L` (resting on the near collarbone, in front of the pouch), `cable` (mesh, hangs clear of the body);
- near side, in front of the torso: `upper_arm_L`, `forearm_L`, `hand_L` (`open`, `point`, `fist`, `fader`), `fx_note` (additive music notes, celebrate).

**Bones (≈ 70):**
- core chain + long limbs;
- `pouch`, `phys_pouch_1..2`;
- headphones: `band`, `cup_L`, `cup_R`, all **parented to `neck`**, not the head. The headphones rest around the neck, so a nod or look turn moves the head and cap but leaves the headphones on the collar; the cups rock only with the neck and chest. `phys_cable_1..3` hang from `cup_L`;
- `phys_chain_1..3` on `chest`, `face_*` (the bulges carry the eyes: `face_bulge_*` › `face_eye_*` › `face_pupil_*`, `face_lid_*`), `mic` (on `hand_R`), `ik_hand_L` (pinned to the fader), `ik_hand_R` (deck), `ik_foot_*`, `ctrl_look`. The `cap` slot rides `head` and needs no bone of its own.

**Physics (8 constraints, budget ≤ 12):**
- pouch default (`phys_pouch_1..2`), cable floppy (`phys_cable_1..3`), chain floppy with ζ 0.3 (`phys_chain_1..3`: a 3-link chain rings longer than one spring);
- if the art director wants the cups to bounce on their own, `phys_cup_L/R` (default) make 10, still within the budget;
- nothing else springs: the cap is stiff on the head.

**Look constraints** (track 3, `ctrl_look`, contract `characters.look`):
- `look` = transform `ctrl_look` → `head` rotation, additive, mix 0.6, clamped to ±12° (5° per 100 units);
- `look_eyes` = `ctrl_look` x/y → `face_pupil_L/R`, mix 1, 3 units per 100, clamped to **[8, 5]** (x, y) so the narrow horizontal pupils never leave the golden iris. The pupils ride `face_eye_*` under the bulges, so the offset is applied in the bulge's frame;
- the cap follows the head (same bone); the headphones and cable do not (neck);
- lids are driven by `blink` only, never by the look;
- the pupil slots are hidden in the `half` / `closed` eye states (`face.hide_pupils`).

| Clip | f | Loop | Track | Events | Acting |
|---|---|---|---|---|---|
| `idle` | **144** (4.8 s = 8 beats @100 BPM) | yes | 0 | — | Head nod every 18 f, pouch breath every 36 f, left hand rides the fader |
| `idle_bored` | 150 | yes | 0 | — | Adjusts headphones, taps the deck, looks at the crowd |
| `anticipation` | 36 | yes | 0 | — | Hand hovering over the fader, leaning toward the meter (also used for `meterHeat`) |
| `react_small` | 36 | no | 0 | `sfx: dj_scratch` f4 | Scratch with the right hand (the runtime plays booth `scratch` in sync) |
| `react_point` | 30 | no | 0 | — | Points at the meter at f8 |
| `bass_drop_charge` | **15** | no | 0 | `drop_hit` f14, `sfx: button_slam` f14 | Raises the right hand f0–f8, **palm hits the drop button at f14**; the runtime plays booth `drop_press` in sync. Timescaled to the charge length like the meter `charge` |
| `bass_drop` | 30 | no | 0 | — | Follow-through: the cable and chain whip (physics), the cups rock with the neck, pouch balloons to 1.4 at f4, recovers |
| `wild_land_react` | 12 | no | **1** | — | Additive flinch |
| `pouch_pump` | 12 | no | **1** | — | Pouch 1.00→1.35→1.00 (sticky `mult_up`, `spotUpgrade` cue) |
| `win_big` | 60 | no | 0 | `sfx: dj_scratch` f10 | Double scratch + headbang |
| `celebrate` | **72** | yes | 0 | — | 4 beats: arms up, fist pumps on beats, `fx_note` puffs |
| `fs_trigger` | **75** | no | 0 | `sfx: mic_drop` f36 | The mic appears in hand at f10, held high f10–f30, **drop at f36** (= trigger pump 3) |
| `fs_end` | 54 | no | 0 | — | Bow, a hand on the headphones |
| `blink` | 5 | no | **2** | — | Lids close f1–f3 |

**Mixes (both characters):** `defaultMix` 0.25 s (0.15 in turbo: `TIMING.mascot.crossFade*`); `bass_drop_charge→bass_drop` 0; `*→wild_land_react` additive, no mix; loops start phase-offset (`idlePhase` per `characters.ts`).

---

## 6. UI screens (Spine UI skeletons with live text)

The shared rule: every word and number is a runtime BitmapText on an empty `txt_*` slot. Card-frame meshes are weighted to **corner bones** (`<card>_tl/_tr/_bl/_br`), so the runtime can set any card size from `layout.json` (Spine's 9-slice equivalent). Animations key only **offsets relative to those card roots**, so one rig serves every layout.

### 6.1 `ui_intro_cards` (P1)

- **Bones (≤ 40):** `root`, `logo`, `press`, `footer`; per card N ∈ 1..3: `card_N`, `card_N_tl/tr/bl/br`, `card_N_art`, `card_N_title`, `card_N_body`, `card_N_shine`.
- **Slots (≤ 26):** `fx_rays` (additive); per card: `card_N_back` (mesh), `card_N_art` (`art_meter`, `art_jukejam`, `art_megamix`), `card_N_frame` (mesh: cypress wood + neon edge + speaker-bolt corners), `fx_card_N_shine` (additive), `txt_title_N`, `txt_body_N`; plus `logo` (region `logo_bd`), `txt_footer`, `txt_press`.
- **Skins:** `landscape` (tall card art crops), `portrait` (wide art crops, art left / text right).

| Anim | Track | f | Loop | Events | Notes |
|---|---|---|---|---|---|
| `in` | 0 | 27 | no | `card_land` f12 / f16 / f20, `title_hit` f18 | Cards drop from −300 units with −4°/+3°/−2° settle, 4 f apart; logo scales 0.6→1.05→1.0 f6–f18 |
| `loop` | 0 | 60 | yes | — | Cards bob ±4 units out of phase; one shine sweep per card per loop |
| `press_loop` | 1 | 30 | yes | — | `txt_press` alpha 0.55↔1.0, scale 1.0↔1.04 (1 Hz) |
| `out` | 0 | 12 | no | — | Cards lift 80 units and fade, logo last |

Card art (illustrations, no text): the meter firing a W; a glowing jukebox with ×-badged wilds; a crowned speaker stack with clamped wilds.

### 6.2 `ui_buy_cards` (P1)

- **Bones (≤ 40):** `root`, `title`, `close`, `confirm_btn`, `cancel_btn`; per card N ∈ 1..2: `card_N` + corners, `card_N_art`, `card_N_title`, `card_N_spins`, `card_N_price`, `card_N_btn`.
- **Slots (≤ 30):**
  - `fx_rays`;
  - per card: `card_N_back`, `card_N_art` (`art_jukejam_buy`, `art_megamix_buy`), `card_N_frame` (pink neon edge), `fx_card_N_shine`, `txt_title_N`, `txt_spins_N`, `txt_price_N`, `txt_x_N`, `btn_N` (`btn_normal`, `btn_hover`, `btn_pressed`, `btn_disabled`), `txt_btn_N`;
  - `txt_title_main`, `close_btn`, `confirm_plate`, `txt_confirm`, `cancel_plate`, `txt_cancel`.

| Anim | Track | f | Loop | Events | Notes |
|---|---|---|---|---|---|
| `in` | 0 | 18 | no | `card_land` f10 / f14 | Title drops, cards rise |
| `loop` | 0 | 60 | yes | — | Shine sweeps, gentle bob |
| `hover_1` / `hover_2` | 1 | 6 | no | — | Card lift 12 units + frame glow |
| `select_1` / `select_2` | 0 | 12 | no | — | The chosen card moves to the confirm rect (the runtime sets `card_N` there; the anim keys scale 1.08 and fades the other card) |
| `confirm_loop` | 0 | 30 | yes | — | Confirm plate pulse (1 Hz) |
| `back` | 0 | 12 | no | — | Reverse of select |
| `btn_press` | 2 | 4 | no | — | Button squash 0.92 (`TIMING.ui.pressScale`) |
| `out` | 0 | 12 | no | — | |

### 6.3 `ui_feature_intro` (P0), skins `jukejam`, `megamix`

- **Bones (≤ 24):** `root`, `rays`, `emblem`, `banner`, `title`, `count`, `sub`, `press`, `sparks`, `shine`.
- **Slots (≤ 16):** `fx_rays` (additive), `fx_glow` (additive), `emblem` (`jukebox` / `mega_speaker`), `banner_plate`, `txt_title`, `txt_count`, `txt_sub`, `txt_press`, `fx_shine`, `fx_sparks`.

| Anim | f | Loop | Events | Notes |
|---|---|---|---|---|
| `in` | 36 | no | `title_hit` f10, `count_hit` f20, `vfx: fx_title_shine` f24 | The emblem drops and slams at f10 (squash sy 0.8), the banner unfurls f10–f18, the count slams from 2.2× at f20 |
| `loop` | 60 | yes | — | Emblem pumps once per 15 f (runtime timeScale = bpm / 120 so it lands on beats); rays rotate |
| `out` | 12 | no | — | Scale 1.1 + fade |

The whole `in` + hold fits `TIMING.freeSpins.introDuration` 2,600 ms.

### 6.4 `ui_feature_upgrade` (P1)

- **Slots (≤ 16):** `fx_rays`, `emblem_old` (jukebox), `shard_1..6` (jukebox shards, hidden until f18), `emblem_new` (mega speaker), `banner_plate`, `txt_title`, `txt_add` ("+4"), `txt_sub`, `fx_flash` (additive).
- **Bones:** ≤ 24.

| Anim | f | Loop | Events | Notes |
|---|---|---|---|---|
| `in` | 42 | no | `crack` f12, `shatter` f18, `title_hit` f28, `count_hit` f34 | Crack lines appear on `emblem_old` at f12; shards burst outward at f18; `emblem_new` slams at f28; "+4" slams at f34 |
| `loop` | 60 | yes | — | |
| `out` | 12 | no | — | |

Total with hold: 2,200 ms (DESIGN §10.4).

### 6.5 `ui_feature_outro` (P0), skins `jukejam`, `megamix`

- **Slots (≤ 12):** `fx_rays`, `emblem`, `banner_plate`, `txt_title`, `txt_sub`, `txt_amount`, `fx_coins` (empty; runtime attaches coin particles), `fx_shine`.

| Anim | Track | f | Loop | Events |
|---|---|---|---|---|
| `in` | 0 | 30 | no | `title_hit` f12 |
| `loop` | 0 | 60 | yes | — |
| `amount_punch` | 1 | 9 | no | — (runtime plays it when the count lands) |
| `out` | 0 | 12 | no | — |

### 6.6 `ui_bigwin` (P1): existing contract §6, new skin `bassdrop`

- Tiers `tier_<t>_in` / `_loop` / `_out` for big / super / mega / epic / max, with `title_hit` and optional `vfx: fx_coin_shower`, `vfx: fx_title_shine`.
- Slots `txt_title`, `txt_amount` stay runtime text.
- **Bass Drop dressing:** a spinning vinyl sunburst behind the title (`fx_rays` region swap), two speaker cones flanking the plate that pump at each `title_hit`, and the tier colours from `TIER_TINT`.
- Loops must hold for any count duration (contract).

### 6.7 `ui_spin_btn`

Unchanged (contract §6).

---

## 7. FX: flipbooks vs live particles vs filters

**Rule:** anything that must be **cheap, tintable or data-driven** is live (Pixi particles, sprites, MeshRope). Anything that must look **volumetric** (smoke, dust crowns, blasts) is a flipbook. Flipbooks are rendered once (Blender/EmberGen, cel-shaded with a black outline pass per the ART_BIBLE, no soft bloom), trimmed, and packed at **1x** into the `bd_fx` pages. They play as `AnimatedSprite` at **30 fps**, attached through `addSlotObject` where a rig hosts them.

### 7.1 Flipbooks

| FX id | Frames | Cell size (1x) | Blend | Loop | Host / trigger | Fallback (P0, low tier) |
|---|---|---|---|---|---|---|
| `fx_speaker_blast` | 16 | 384² (displayed ×1.6) | normal (cel smoke) + additive core | no | Meter `fx_blast` slot at `boom` f0 | 3 ring sprites + 20 smoke particles |
| `fx_wild_impact` | 14 | 320² | normal | no | Target cell at `drop_impact` `land_impact` | 16 dust particles + shock ring |
| `fx_feature_blast` (alias of the contract's `fx_explosion_big`) | 20 | 512² (displayed ×2.5) | normal + additive | no | Meter at `feature_trigger` pump 3 | Existing big burst preset |
| `fx_title_shine` | 12 | 512×128 | additive | no | UI titles (`vfx` event) | Existing shine shader |

Budget: all flipbooks trimmed into **≤ 2 pages of 2048²** at 1x (32 MiB; 8 MiB at @0.5x on the low tier).

### 7.2 Live effects (src/fx presets + code)

| FX id | Trigger | Count / shape | Life | Notes |
|---|---|---|---|---|
| `fx_orb` | Orb flights | 1 core + 1 halo sprite per orb (≤ 36; super turbo ≤ 6 comets at 1.6× size) | Flight | Code (§8) |
| `fx_orb_trail` | Per orb | 1 particle / 16 ms | 220 ms | Size 10→0·k, tint lerps symbol colour → teal |
| `fx_link_spark` | Link snap | 6 per link | 300 ms | |
| `fx_threshold_sparks` | Minor / major burst | 24 / 48 radial | 500 / 700 ms | From the notch |
| `fx_bass_rings` | Boom | 3 additive ring sprites, 90 ms apart | 520 ms | Radius → 900·k |
| `fx_wild_trail` | Wild flight | MeshRope, 12 points | Flight | Additive, tier-tinted |
| `fx_wild_dust` | Impact | 16 | 450 ms | Plum-grey dust |
| `fx_mult_spark` | Badge slam, `mult_up` | 10 | 350 ms | Tier colour |
| `fx_lock_glint` | `lock_snap` | 6 | 300 ms | Gold |
| `fx_crush` | Crushed symbol | Existing `fx_explode` at power 0.6 | — | No orb |
| `fx_explode`, `fx_dust`, `fx_sparkle`, `fx_coins`, `fx_confetti` | Existing | — | — | Unchanged |

Particle budget: ≤ 1,000 live (low tier 400). A worst-case step (36 orbs with trails + explode bursts) peaks at ≈ 36 × 14 + 36 × 18 / 2 ≈ 830. The low tier halves trails and explode counts.

### 7.3 Filters (≤ 3 live, low tier 1)

| Filter | When | Priority |
|---|---|---|
| `ShockwaveFilter` (existing) | Boom, feature trigger pump 3 | 1 |
| `ChromaticFilter` pulse | Boom, upgrade (high tier only) | 2 |
| `GodRays` | Feature intro/outro, big win | 3 |

---

## 8. Code-drawn elements (and why they are not Spine)

| Element | Built from | Why code |
|---|---|---|
| LED arc (60 ticks + glow arc) | One `led_tick` region ×60 sprites on radius 0.70–0.85 R, one `led_glow_arc` sprite masked by angle (a radial-wipe shader); inserted in the meter's `led_arc` slot | 60 independently lit ticks would need 60 slots |
| Groove links | `MeshRope` + a 128×32 `link_wave` region (UV scroll) | Topology depends on the cluster shape |
| Orbs + trails | `orb_core`, `orb_halo` regions + particles | Up to 36 at once, data-driven paths |
| Count pop `+N` | BitmapText (Titan One) | Live number |
| Target reticle | `reticle_ring` region (dashed ring, drawn once to a texture) | Positioned per target |
| Landing shadow | `shadow_ellipse` region, multiply | |
| Lap pips (fallback) / chip / plates | Existing `Plate` + `pip` regions | Live text |
| Mega Mix home marker | `home_rim` (gold 3 px rounded-rect ring) + 4 `home_clamp` corner brackets, on the tile layer | Stays for the whole feature, also while the home's wild is away |
| Sticky `+1` preview | BitmapText (Titan One), teal | Live number, popped off the badge at win time (DESIGN §9.2) |
| Neon-tube charge pulse | The Frame's tube + a moving additive `tube_pulse` sprite | Reuses the existing tube |
| Board thump, neighbour push | Container springs | Physics |

All regions live in `bd_ui` (one page with the UI skeletons).

---

## 9. Event registry (Bass Drop additions in **bold**)

| Event | Payload | Emitted by (frame) | Runtime reaction |
|---|---|---|---|
| `land_impact` | — | symbol `land` f0; **W `drop_impact` f0** | `land`: land SFX/dust. **`drop_impact`: `wild_impact` SFX, `fx_wild_impact`, board thump, neighbour push, trauma 0.2, hit-stop 40** (the runtime distinguishes by animation name) |
| `win_peak` / `explode_burst` / `explode_done` | — | symbols (contract) | Unchanged. **`explode_burst` also launches that cell's orb** |
| **`drop_release`** | — | W `drop_launch` f2 | `wild_launch` SFX (pitch by wild index) |
| **`lock_snap`** | — | W `sticky_lock` f6 | `sticky_lock` SFX, `fx_lock_glint`, trauma 0.05, the tile gold rim fades in |
| **`mult_swap`** | — | W `mult_up` f4 | Swap `txt_mult` text + `badge_tN` attachment; `sticky_mult_up` SFX; `fx_mult_spark` |
| **`threshold_hit`** | — | meter `threshold_minor` / `threshold_major` f2 | `fx_threshold_sparks`; SFX `meter_threshold` / `meter_lock_*` (garnish; shake/flash/hit-stop come from the timeline) |
| **`charge_start`** | — | meter `charge` / `charge_chained` f0 | `bass_charge` SFX, music HPF sweep, neon-tube pulse |
| **`boom`** | — | meter `boom` f0 | Garnish only: `fx_bass_rings` stagger. Shockwave, flash, shake, hit-stop and launches come from the timeline at the same instant |
| **`pump_hit`** | — | meter `feature_trigger` f0 / f18 / f36 | `fs_trigger` SFX on the third |
| **`drop_hit`** | — | Croak `bass_drop_charge` f14 | Nothing else (the SFX is in the clip) |
| **`card_land`** | — | `ui_intro_cards` / `ui_buy_cards` | `intro_card` SFX |
| `title_hit` | — | UI titles | Punch + trauma (contract §4): `BASS_DROP_TIMING.shake.titleHit` 0.2; the feature intro emblem uses `introTitle` 0.35 and the upgrade uses `upgrade` 0.5 |
| **`count_hit`** | — | `ui_feature_intro` f20, `ui_feature_upgrade` f34 | `fs_intro` accent, trauma `shake.countHit` 0.2 |
| **`crack`**, **`shatter`** | — | `ui_feature_upgrade` f12 / f18 | `feature_upgrade` SFX layers, shard sparks, trauma 0.3 at `shatter` |
| `sfx` | `SfxId` string | character / booth clips | Play the cue (round-robin take) |
| `vfx` | FX id string | UI / characters | `fx:burst` / flipbook |
| `shake` | float | **not used in Bass Drop rigs** (runtime-owned), except the contract's `title_hit` | — |

---

## 10. Budgets summary

| Rig (kind) | Bones | Slots | Mesh verts | Physics | Atlas |
|---|---|---|---|---|---|
| `sym_H1..H4` (symbol) | ≤ 30 | ≤ 8 | ≤ 250 | ≤ 4 | `symbols` |
| `sym_L1..L5` (symbol, light) | ≤ 8 | ≤ 4 | ≤ 64 | 0 | `symbols` |
| `sym_W` (wild) | ≤ 34 | ≤ 12 | ≤ 300 | ≤ 4 | `symbols` |
| `ui_groove_meter` (ui) | ≤ 40 | ≤ 30 | ≤ 400 | 0 | `bd_ui` |
| `env_speaker_stack` / `env_dj_booth` / `env_horn` (env) | ≤ 20 / 24 / 10 | ≤ 12 / 16 / 6 | ≤ 200 / 200 / 100 | ≤ 3 / 3 / 0 | `bd_env` |
| `chr_gumbo`, `chr_croak` (character) | ≤ 80 | ≤ 40 | ≤ 2,400 | ≤ 12 | own page each |
| `ui_intro_cards` / `ui_buy_cards` (ui) | ≤ 40 | ≤ 26 / 30 | ≤ 300 | 0 | `bd_ui` |
| `ui_feature_intro` / `_upgrade` / `_outro` (ui) | ≤ 24 | ≤ 16 | ≤ 200 | 0 | `bd_ui` |

**Texture pages** (2048², PMA, RGBA8 = 16 MiB each at @2x; @0.5x pages are 1024² = 4 MiB):

| Atlas | Pages | @2x | @0.5x |
|---|---|---|---|
| `symbols` (shared, + W/royal additions) | 2 | 32 MiB | 8 MiB |
| `bd_ui` | 2 | 32 MiB | 8 MiB |
| `bd_env` | 1 | 16 MiB | 4 MiB |
| `bd_chr_gumbo` | 1 | 16 MiB | 4 MiB |
| `bd_chr_croak` | 1 | 16 MiB | 4 MiB |
| `bd_fx` (1x flipbooks) | 2 | 32 MiB | 8 MiB |
| **Total (excl. background)** | 9 | **144 MiB** | **36 MiB** |

- The high tier picks @2x only when `stageScale × resolution ≥ 1.25` (desktop). Phones use @0.5x.
- This replaces the 3D mascots' render targets (28 MB) and GLBs.
- Verify real GPU memory with the capture tooling before sign-off.

**Live instances (worst case):**
- symbol Spines ≤ 24 animated (§2.7);
- meter 1, env 4, mascots 2, overlay 1–2;
- p95 frame < 16.7 ms on the mid-tier device with 36 orbs + 3 flying wilds (DESIGN §24).

**Draw calls:** ≤ 60 per frame in the heaviest moment. Keep each rig on a single page and use additive `fx_*` slots sparingly.

---

## 11. Production order and gates

1. **P0 rigs** (first playable bass-drop loop): `sym_W` (drop + multiplier + sticky), `ui_groove_meter`, `chr_gumbo` / `chr_croak` (P0 clips), `ui_feature_intro`, `ui_feature_outro`, code elements (§8). Flipbooks use their live fallbacks.
2. **P1:**
   - `bass_react` on H1–H4;
   - royal rigs;
   - env rigs;
   - intro/buy cards;
   - upgrade;
   - `ui_bigwin` skin;
   - flipbooks;
   - background variants;
   - logo.
3. **P2:** `idle_bored`, `meter_heat`, `react_point`, and the extra acting passes.

Per-asset gates:
- **Style:** ART_BIBLE §10 (outline histogram, palette ΔE, halo, no text via OCR, adult proportions for characters, light direction);
- **Spine:** `spine:validate` with the Bass Drop kinds (budgets, loop seams, event frames, the `drop_impact` squash gate, empty `txt_*` slots present);
- **In game:** the DESIGN §24 capture checkpoints at all 4 viewports;
- **Feel:** ANIMATION_CONTRACT §9 plus DESIGN §24.

Character rigs: `tools/spine/gen.py` covers symbol-class rigs only. Characters are authored in the Spine Editor, recommended by a human animator (docs/STACK.md, "people and contracts"). Claude writes the part lists, bone skeleton JSON and clip specs from this file, and the animator does the acting passes.

---

## 12. Contract deltas (CR-8)

Add to `docs/ANIMATION_CONTRACT.md` and `tools/spine/contract.json` in the same PR as the first rig that uses them:

```json
{
  "animations": {
    "bass_react":    { "loop": false, "frames": [6, 10],  "required": [], "events": [], "overlay": 1 },
    "drop_launch":   { "loop": false, "frames": [6, 10],  "required": ["wild"], "events": ["drop_release"], "endsAt": "drop_fall",
                       "eventFrames": { "drop_release": { "target": [2, 2], "hard": [1, 3] } } },
    "drop_fall":     { "loop": true,  "frames": [8, 16],  "required": ["wild"], "events": [] },
    "drop_impact":   { "loop": false, "frames": [12, 18], "required": ["wild"], "events": ["land_impact"], "endsAtSetup": true,
                       "squash": { "bone": "squash", "sy": [0.70, 0.76], "gate": [0.68, 0.78], "volumeTol": 0.05 }, "cellOverflow": 0.2 },
    "sticky_lock":   { "loop": false, "frames": [9, 15],  "required": ["wild"], "events": ["lock_snap"], "endsAt": "sticky_idle",
                       "eventFrames": { "lock_snap": { "target": [6, 6], "hard": [5, 7] } } },
    "sticky_idle":   { "loop": true,  "frames": [45, 90], "required": ["wild"], "events": [] },
    "mult_up":       { "loop": false, "frames": [9, 15],  "required": ["wild"], "events": ["mult_swap"], "endsAt": "sticky_idle",
                       "eventFrames": { "mult_swap": { "target": [4, 4], "hard": [3, 5] } } },
    "sticky_unlock": { "loop": false, "frames": [6, 12],  "required": [], "events": [] }
  },
  "events": { "drop_release": {}, "lock_snap": {}, "mult_swap": {}, "threshold_hit": {}, "charge_start": {}, "boom": {},
              "pump_hit": {}, "drop_hit": {}, "card_land": {}, "count_hit": {}, "crack": {}, "shatter": {} },
  "kinds": {
    "wild":      { "budgets": { "bones": 34, "meshVertices": 300, "slots": 12, "clipping": 0 }, "requiredEmptySlots": ["txt_wild", "txt_mult"] },
    "ui":        { "budgets": { "bones": 40, "meshVertices": 400, "slots": 30, "clipping": 0 } },
    "env":       { "budgets": { "bones": 24, "meshVertices": 200, "slots": 16, "clipping": 0 } },
    "character": { "budgets": { "bones": 80, "meshVertices": 2400, "slots": 40, "clipping": 0, "physics": 12 },
                   "requiredClips": ["idle", "idle_bored", "anticipation", "react_small", "win_big", "celebrate", "fs_trigger", "fs_end"] }
  },
  "fxIds": ["fx_orb", "fx_orb_trail", "fx_link_spark", "fx_threshold_sparks", "fx_bass_rings", "fx_speaker_blast",
            "fx_wild_trail", "fx_wild_dust", "fx_wild_impact", "fx_mult_spark", "fx_lock_glint", "fx_crush", "fx_feature_blast"]
}
```

How the validator applies it (the contract's `required` lists hold kind names, and `--kind auto` maps a symbol through `symbolKinds`):
- `wild` **extends** `special`: an animation whose `required` lists `special` is also required for `wild`, plus the ones above that list `wild`. Swamp Funk's W stays `special`.
- `--kind auto` maps `sym_W` to `wild` when `GAME=bass-drop` (the validator already reads `src/games/$GAME/config.ts`, where the Bass Drop W has `kind: 'wild'`), and to `symbolKinds.W` (`special`) otherwise.
- `overlay` (track index) and `cellOverflow` (allowed spill outside the cell, the opposite of the existing `inCell`) are new rule keys the validator must learn. `ui`, `env` and `character` are skeleton kinds with budgets only, no symbol rules.

Plus these ANIMATION_CONTRACT prose changes:
- §1: add the Bass Drop skeleton ids (§1 here).
- §3: list the W-specific rows. `mult_up` is the concrete name for the planned `upgrade` slot, and `sticky_lock` is now defined.
- §6: add the UI skeleton names.
- §7: add a "2D Spine mascots (Bass Drop)" subsection pointing to §5 here. The GLB rules stay for Swamp Funk.
- §8.2 / §8.3: add the FX ids above and the DESIGN §17 `SfxId`s.
