# Swamp Funk: Bass Drop (`bass-drop`)

The second game in the Swamp Funk world: a 6×6 cluster tumble with a **Groove Meter**. Every 10 connected symbols drop Wilds from a speaker stack; 40 in one spin opens **Juke Jam** (8 free spins, multiplier wilds) and 60 opens **Mega Mix** (10 free spins, sticky wilds up to ×25).

| File | What it is |
|---|---|
| [DESIGN.md](DESIGN.md) | Binding game/presentation spec: mechanics, event contract, states, meter UX, bass-drop choreography, screens, layouts, mascots, audio, speed profiles, accessibility, Stake notes, QA acceptance |
| [ANIMATION_SET.md](ANIMATION_SET.md) | Every Spine rig, flipbook and code-drawn effect: parts, animations, frames, events, budgets, contract deltas |
| [layout.json](layout.json) | Machine-readable layout rects for the 4 design spaces, plus the intro and buy screens |
| [wireframes/](wireframes/) | SVG wireframes rendered from `layout.json` (`python3 docs/games/bass-drop/wireframes/render.py`) |

The book-level rules (meter resets, drops only up to 60, sticky homes that respawn each Mega Mix spin, win cap) follow the mock math contract in [mock/games/bass-drop/README.md](../../../mock/games/bass-drop/README.md); DESIGN.md §2 lists them as [M-1]…[M-10].

Reference timings from Dragonspire Frostfall are still to be captured. The network now reaches the demo hosts, but the supplied demo session had expired (RGS HTTP 400 "session not found"), so no frame was captured (DESIGN.md §22.1). DESIGN.md §22 has the protocol, every value that needs it is tagged **[RM]**, and [reference-timings.json](reference-timings.json) holds the (still empty) measurements.

## Implementation status (phase B)

Every feature of DESIGN.md runs in the front end with **procedural placeholder art** (cel-shaded, baked at display resolution). Each visual is one class with methods named after its ANIMATION_SET clips, so the Spine rigs of phase C replace them one by one. The contract requests and their status are in DESIGN.md §23.

| Feature (DESIGN) | Module (`src/games/bass-drop/`) | Status |
|---|---|---|
| Groove Meter, states, orbs, threshold bursts, drain, skins, next-drop chip (§6) | `meter/` (`GrooveMeter`) | Done. Orbs launch on the Board's `board:burst`; the counter always ends on `meterUpdate.value` |
| Connection links + count pops (§7) | `connect/` (`Connections`) | Done |
| Bass drop: charge, boom, flight, impact handoff, chains (§8) | `drop/` (`BassDrop`) | Done. The wild leaves the woofer inside the meter's `fx_blast` slot (`meter:blastSlot`) and takes `winLayer` at the rim |
| Multiplier badges, label sums (§7 step 6), Mega Mix homes / returns / `mult_up` (§9) | `drop/` | Done (`FEATURES.wildMultSum: 'external'`) |
| Trigger, wipe, feature intro, upgrade, outro, feature plate (§10) | `screens/` (`FeatureScreens`) | Done. The HUD keys are held off while a screen is up: SPACE / ENTER are the screen's tap |
| Game intro (§12), 2-card buy screen (§13) | `screens/` (`IntroScreen`, `BuyScreen`) | Done (`FEATURES.buyScreen: 'game'`) |
| Lower cabinet, frame horns, DJ booth (§15) | `stage/` (`Stage`) | Done. Boom, trigger and big-win reactions share the meter's beat formula |
| Board physics scale, explode shake table (§5, §18.2) | engine `Board` + `FEATURES.physicsScale` / `explodeShake` | Done |
| Audio (§17) | engine `src/audio/` (`synthBassDrop.ts`, `music:stem`, `music:duck`) | Procedural voices and the `megamix` groove; production stems pending |
| Mascot cues (§16) | engine `src/mascots/` | Mapped onto the 3D placeholder mascots; the 2D Spine mascots are phase C |

Open (see DESIGN.md §23): `music:beat` (CR-6: meter, booth and horns run a 600 / 566 / 536 ms clock beat), the ANIMATION_CONTRACT / `contract.json` update (CR-8), `intro:show` (dropped: the intro opens on the first idle HUD state), the `fx_wild_impact` / `fx_speaker_blast` flipbooks (live particles stand in), a `sticky_cap` (×25) fixture from math, and badges for one-shot multiplier wilds after a resume mid-spin (their sums then show the final value only).

## See each feature

Run `pnpm dev:bass-drop` and open `http://localhost:5173/?book=<scenario>` (or `?book=<id>`; ids 20001–20050 are BONUS buys, 30001–30050 SUPER buys). Add `&sessionID=<anything new>` to start fresh (the mock RGS resumes an unfinished round of the same session). The game intro opens at boot; press ENTER or tap to close it.

| To see | Book | What happens |
|---|---|---|
| Idle meter 0/60, stage, intro cards | any | Intro cards at boot, then the idle meter, cabinets, horns and booth |
| Links, count pop, orbs | `small_win` | One cluster: links draw on, the `+5` pop and 5 orbs fly into the meter |
| One bass drop | `meter_10` | Threshold 10 burst → armed notch → charge → boom (shockwave, horns, booth) → the wild flies from the woofer, lands with the impact squash; the next win links gold through it |
| Three drops | `meter_30` | 1 + 1 + 2 wilds, one per step |
| Chained drops | `super_trigger` (base step with `[50, 60]`), `30030` (`[40, 50, 60]`, try super turbo) | Short chained charges, stacked booms |
| Juke Jam | `bonus_trigger` | 40 lock, trigger pumps, wipe, JUKE JAM intro, plate `n / 8`, multiplier wilds and label sums, outro |
| Mega Mix | `super_trigger` | 60 lock, MEGA MIX intro, sticky homes (markers, clamps), returns + `mult_up` from spin 3, 5 homes by spin 5 |
| Juke Jam → Mega Mix | `bonus_upgrade` | Upgrade screen (crack, shatter, MEGA MIX slam, +4), meter drain and reskin, plate retitled |
| Win cap | `wincap` | No orbs or drop after the capping `meterUpdate`; the counter snaps |
| Buy screen | click the bonus-buy hex | JUKE JAM ×100 / MEGA MIX ×300, confirm step; `&social=true&currency=XSC` for stake.us wording |
| Portrait / tablet / compact | resize the window (compact: `min(w, h) ≤ 480`) | The meter chip carries `JUKE JAM 3/8` in portrait and compact free spins |

Automation (`window.__slot`, dev build): `await __slot.flow.spin()`, `__slot.flow.forceBook('meter_10')`, `__slot.events(true)` (scene-event log), `__slot.emit(type, payload)`; the speed profile follows the player's choice at each round start, so switch it with `__slot.ctx.ui.broadcast('ui:turbo')`. Frame-exact captures: `tools/capture/shot.mjs` (see the root README).

## Measured round timings

Frame-exact (manual 60 fps clock, 960×540, mock RGS), from `round:start` to `round:end` on the wall clock (hit-stops included). The RGS request overlaps the fall-out; the small-win count is included. Compare with DESIGN.md §18.1.

| Book | Normal | Turbo | Super turbo |
|---|---|---|---|
| `loss` | 1.42 s | 0.47 s | 0.38 s |
| `small_win` (one cluster, no drop) | 4.08 s (3.47 s before the count) | 1.73 s (1.42 s) | 1.22 s (1.00 s) |
| `meter_30` (6 tumble steps, drops of 1 + 1 + 2 wilds) | 20.2 s | 9.2 s | 6.3 s |

Phases (normal / turbo / super turbo, ms): drop-in 1,067 / 333 / 233; cluster present 950 / 483 / 317; tumble step 1,050–1,183 / 417–483 / 300–333; one-wild drop 1,600 / 767 / 517; two-wild drop 1,750 / 817 / 550; `board:transform 'impact'` resolves 360 ms of game time after its call. The 18.1 model for `meter_30` (6 × (cluster + tumble) + 3 drops + drop-in + count) gives 21.4 / 8.9 / 5.9 s.
