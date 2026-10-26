# Magpie Heist mascot: MONTY (`chr_monty`)

Production Spine 4.3 rig of MONTY, the lanky adult magpie cat burglar who stands left of the reels facing
screen-right, built without the Spine editor on the Bass Drop mascot tooling
([art/source/mascots/README.md](../../mascots/README.md), [tools/spine/README.md](../../../../tools/spine/README.md)).
This folder is the source of truth; the game loads the shipped copies in `public/assets/magpie-heist/mascot/`
through `src/games/magpie-heist/mascots/` (`Monty.ts` module, `SpineMonty.ts` controller, `assets.ts` loader,
`MontyStatic.ts` = the static cut-out stand-in, kept as the fallback when the rig cannot load).

```
art/source/magpie-heist/mascot/
  monty_static.png     the approved three-quarter view (862x1448, straight alpha) = the rig master / setup pose
  spine2d/             cut.yaml, rig.yaml, parts.json, points.json, images/chr_monty/**      <- authoring set
  spine/               chr_monty.json + chr_monty.atlas + chr_monty.png (+ @0.5x atlas/page)   <- runtime set
tools/mhart/mascot/
  build.sh             end to end (cut -> gen -> validate --strict -> pack -> validate --atlas -> capture/publish/ship)
  cut.py               the master cut: imports art/source/mascots/pipeline/mastercut.py (unchanged) + smooth seams
  hands.py             paints the fist / point gloves under the master's own cuff (no part sheets exist)
  owners.py            ownership QA at full resolution (for authoring seeds / cut lines)
  prov_monty.py        provenance rows of the part images and the runtime set
  ship_monty.py        public/assets/magpie-heist/mascot/chr_monty{,_half}.* + provenance rows (shipped)
```

## Build

```bash
tools/mhart/mascot/build.sh --cut --capture build/qa/mascots --scenarios all --publish --ship
tools/.venv/bin/python tools/mhart/mascot/ship_monty.py --check      # shipped files == runtime set, every file has a row
node tools/licence/audit.mjs                                          # 0 errors (Higgsfield clearance = release blocker)
```

About 1 min (+ ~1 min capture). Needs `tools/.venv` (OpenCV, numpy, scipy, shapely, PIL, PyYAML) and Node deps.
QA: `build/qa/chr_monty/cut/` (`rest.png` = rest | master | diff x4, `rot_*.png` rotation tests, `pieces.png`,
`variants.png` eye states + glove poses, `report.json`), `build/qa/chr_monty/validate.json`,
`build/qa/mascots/monty/<clip>.png` contact sheets (+ every frame) and in game `build/qa/mascots/ingame/`.

## Why a master cut

Exactly as Bass Drop did for Gumbo and Croak: no registered part sheets exist (image generation was
rate-limited; the design sheet `mh_mascot_monty_sheet.raw.v01` has four views but only open hands), so the
**setup pose is the approved master, pixel for pixel**. `mastercut.py` partitions it with a watershed on the
painted image (seed shapes per part, cut lines through continuous paint at the elbows, the throat, the knees
and ankles), hands outline ink to the front part, takes joint discs into the child, and fills every area a
moving part uncovers (inpaint + painted gradients, then an ink stroke on the new silhouette only where hidden
at rest). `tools/mhart/mascot/cut.py` adds: smoothed seam rims, per-part `seamExact` / `strokeKeep` (the far
wing, far thigh and tail are behind the body, so their hidden rims get a clean ink edge instead of the
stair-stepped watershed comb when they swing away).

**Reassembly: SSIM 0.9985 (native 0.9938), alpha IoU 1.000** (gate 0.98 / 0.99).

Hidden areas filled: the body side under the near shoulder patch (black back to white belly), the chest and
neck base under the neckerchief, the belly under the thigh tops, the skull crown under the cap (the cap lifts
on the tug and twirls on `win_big`), the tail root behind the near leg, the shin tops under the thigh feather
fringes, the far wing root behind the chest.

## Parts and rig

Canvas 880x1448 @2x (= 2x the landscape rect 440x724), root = feet point (master 430, 1440), scale 1.0.

| Slot (back to front) | Bone | Notes |
|---|---|---|
| `tail` | `phys_tail_1..3` (mesh, IDW hips + 3 springs) | long floppy magpie tail |
| `shin_L`, `foot_L`, `thigh_L` | biped far leg | thigh fringe in front of the shin; heel bent backward (bird) |
| `upper_arm_L` | far upper arm + far shoulder patch | behind the torso |
| `torso` | `spine` (mesh: chest / spine / hips) | chest, belly, sides |
| `forearm_L`, `hand_L` (`open`, `fist`, `point`) | far forearm / glove | drawn in front of the torso (invisible at rest), so the far glove can meet the near one |
| `shin_R`, `foot_R`, `thigh_R` | biped near leg | |
| `neck` | mesh, head above the cut line, neck at the kerchief | bends with every nod, no seam |
| `kerchief` | mesh, IDW neck / chest / `phys_kerchief_1..2` | band rides the neck, the flap swings |
| `head` | `head` | beak and grin included (no clean jaw line in the master) |
| `eye_R` / `eye_L` (`open`, `half`, `closed`, `wide`) | `face_eye_*` | the master's own eye patch, lids painted over it |
| `pupil_R` / `pupil_L` | `face_pupil_*` | the master pupil / catchlight (look-at moves them 3 units) |
| `cap` | `cap` (pivot at its centre) | tug, toss, scaleX twirl |
| `upper_arm_R`, `forearm_R`, `hand_R` (`open`, `fist`, `point`) | near wing-arm, in front | |

31 bones, 22 slots, 322 mesh vertices, 5 physics springs (tail 2.6-3.0 Hz zeta 0.38-0.42 mix 0.6, kerchief
3.8-4.2 Hz zeta 0.38-0.4 rotate 0.6 mix 0.75), foot IK, look (`ctrl_look`: head 5 deg / 100 units, max 12,
mix 0.6; pupils 2 / 100, max 3x2). Head 21.0% of the height (adult gate 27%). Atlas 1360x1024 PMA, one page
(@0.5x 728x512); shipped JSON 193 KB, WebP 657 KB / 233 KB (half). Tempo 1.08.

`validate.mjs --kind character --strict` (+ `--atlas`): **PASS, 0 warnings** (exact clip lengths, event
frames, loop seams, one-shots ending on idle's first pose, IK reach, springs within 75 deg / 90 units and
settled, look response, proportions, one page). Contract entry: `tools/spine/contract.json`
`characters.rigs.chr_monty` (+ the generic windows of `spin_start`, `react_tumble`, `feature_upgrade` and the
bone / spring words `cap`, `kerchief`).

## Clips (30 fps)

| Clip | Frames | Acting | Events |
|---|---|---|---|
| `idle` (loop) | 150 | two breaths, weight shift, tail sway, kerchief stir, a sly head tilt with a squint f56-f100 | |
| `idle_bored` (loop) | 180 | shifty glances back and forward, polishes his glove on his chest, admires it | |
| `spin_start` | 24 | reaches back and tugs the cap down over his brow, smug squint | |
| `anticipation` (loop) | 36 | leans toward the reels rubbing his gloves together, tense head | |
| `react_small` | 36 | finger snap, then a finger gun at the board and a smug nod | `sfx ui_click` f9 |
| `react_tumble` | 24 | quick double wing pump, wide eyes | |
| `win_big` | 60 | crouch, leap with both wings up (fists), the cap pops and twirls, lands, "yes!" fist pump | `sfx wild_whoosh` f11, `land_light` f31 |
| `celebrate` (loop) | 72 | points at the board with the near hand, then fist pumps high | |
| `fs_trigger` | 75 | deep crouch, big leap, heavy landing, ta-da | `sfx wild_whoosh` f19, `land_heavy` f41 |
| `feature_upgrade` | 54 | greedy glove rub, double finger guns at the board with a wink | |
| `fs_end` | 54 | the gentleman thief's bow, hand on heart, cap tipped | |
| `blink` (track 2) | 5 | lids closed f1-f3 | |

## Runtime (src/games/magpie-heist/mascots/)

- **Fit:** contain the 880x1448 canvas into `layout.mascots.left` (landscape k = 0.5, portrait k = 0.312),
  feet (root) on the rect's bottom centre; hidden in compact (nothing loads). Density: half page unless the
  screen needs > 0.62 px per unit (0.9 on the low tier); low tier steps the skeleton at 30 Hz.
- **Tracks:** 0 body (one-shots return to the held loop with TIMING.mascot 0.25 s / 0.15 s turbo, started
  before the clip ends), 2 blink every 3-6 s (seeded, never across an authored eye swap), 3 look + kicks
  (applied in `beforeUpdateWorldTransforms`, undone after).
- **Look-at:** resting aim at the board centre (weight 0.55, off during `idle_bored` so his glances read),
  full aim at the best cluster (`board:showWins`), the Shooting Star (`star:activate`), a collecting nest
  (`loot:collect`), a cue's `look` point, the player while celebrating the big-win screen.
- **Cue -> clip:** `round:start` -> `spin_start` (a lean kick instead while a clip runs or with reduced
  motion); `anticipation` -> loop + look at the board (released by the next reveal / showWins / round end);
  `reactSmall` -> `react_small`; `reactTumble` -> `react_tumble`, every other one a nod kick; `winBig` ->
  `win_big` then `celebrate` held; `celebrate` -> `celebrate` loop; `fsTrigger` -> `fs_trigger`;
  `featureUpgrade` -> `feature_upgrade`; `fsEnd` -> `fs_end`; `spotUpgrade` -> nod kick; `featureLock` ->
  `react_small` / `win_big`; `idle`, `round:end`, `win:final`, `fs:update`, `board:set` release held loops.
- **Foley:** the rig's `sfx` events are broadcast as `sfx` (ui_click 0.45, wild_whoosh 0.5, land_light 0.55,
  land_heavy 0.6).
- **Fallback:** a rig that fails to load or build hands over to `MontyStatic` (the cut-out with code acting).
- **QA (DEV):** `window.__mhMonty.stats()`, `window.__mhMonty.cue('winBig')`.

## Licence

Built from a Higgsfield generation (Nano Banana Pro, `mh_mascot_monty_sheet.raw.v01` -> `monty_static.png`):
build and preview only until the written Higgsfield clearance is filed. Every shipped file has a row whose
chain reaches the approved raw; `pnpm licence:audit --release` refuses them until the clearance is filed.
