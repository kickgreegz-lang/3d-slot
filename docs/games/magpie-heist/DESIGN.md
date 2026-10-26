# Magpie Heist — game and presentation design

**What it is.** A Le Bandit-style cluster slot under a new brand: **Monty**, a lanky adult magpie cat burglar, raids a moonlit museum treasure hall. The mechanics follow the reference genre (6×5 cluster pays, super cascades, golden squares turned into coins by a reveal symbol, three free-spin tiers, feature spins and buys). The branding, characters, art, names and copy are original: no raccoon, no rainbow, no clover, no pot of gold, no names from the reference game.

Read with: [ART_PLAN.md](ART_PLAN.md) (what is generated and how), [STYLE_DECISION.md](STYLE_DECISION.md) (the finish), [mock/games/magpie-heist/README.md](../../../mock/games/magpie-heist/README.md) (the book event contract, binding), [ANIMATION_CONTRACT](../../ANIMATION_CONTRACT.md) (clip names, frames, events).

## 1. Mechanics → theme map

| Reference genre mechanic | Magpie Heist | Where |
|---|---|---|
| 6×5 grid, clusters of 5+ (orthogonal), wild substitutes | same; **Bandit Mask** wild (W) | `config.ts`, engine Board |
| Super cascade: every symbol of the winning type explodes | same; lightning arcs show which extra symbols go | `connect/Connections.ts` |
| Golden squares on winning positions | **Glint squares**: vault-gold tiles under the cell | `glint/Glint.ts` |
| Rainbow symbol activates the squares | **Shooting Star** (R): a comet tours the squares and reveals loot | `glint/Glint.ts` |
| Bronze / silver / gold coins | bronze 0.2–4×, silver 5–20×, gold 25–500× loot coins | `glint/LootView.ts`, `glint/art.ts` |
| Clover multiplies adjacent coins | **Diamond** ×2/×3/×4/×5/×10 multiplies the 8 neighbours | `loot:boost` |
| Pot of gold collects, then the squares re-reveal | **Nest** collects every coin; emptied squares reveal again (max 8 rounds) | `loot:collect`, `loot:reveal` round ≥ 2 |
| 3 / 4 / 5 scatters → three free-spin tiers | 3 / 4 / 5 **Safes** → **Night Prowl** (8) / **Vault Raid** (12) / **Starfall** (12) | `screens/HeistScreens.ts` |
| Tier 1 keeps squares until activation; tier 2/3 never reset; tier 3 star every spin, no bronze | same rules | mock math + `glint:reset` |
| Bonus-hunt / rainbow feature spins, two buys | **Bonus Hunt** ×3 and **Star Spins** ×10 (feature spins), **Night Prowl** ×100 and **Vault Raid** ×250 buys | `screens/BuyScreen.ts`, engine `ui:spinMode` |
| 10,000× max win | 10,000× (mock) | `config.ts` HEIST.wincapX |

Exact rule text (with the numbers) is in the rules pages (`gameInfo.ts` + `i18n.ts`) and the contract in `mock/games/magpie-heist/README.md`.

## 2. Book events → scene events

Book events (game-specific) are played by `book.ts` and become scene events (`events.ts`):

| Book event | Scene event | Owner | Holds the round |
|---|---|---|---|
| `glintSquares` | `glint:add` | Glint: gilds on the next `board:burst` | no |
| `glintState` | `glint:state` | Glint: instant set (free-spin reveal, resume) | no |
| `glintReset` | `glint:reset` | Glint: squares fade (stagger) or stay (keep) | ~200 ms |
| `starActivate` | `star:activate` | Glint: star charge, board focus, square pulse wave, hit-stop | 520 ms |
| `glintReveal` | `loot:reveal` | Glint: comet tour (round 1) / wave out of the nests (2+) | per square |
| `diamondBoost` | `loot:boost` | Glint: beams + value rolls + float "×N" | ~900 ms |
| `nestCollect` | `loot:collect` | Glint: coins arc into the nest, nest counts up | per coin |
| `glintPayout` | `loot:payout` | Glint: values stream into the LOOT plate, plate drops into the win | ~2–3 s |
| `featureTrigger` | `heist:trigger` → `mode:change` → `heist:mode` | HeistScreens intro behind a wipe; Background look | until tap / auto |
| `featureRetrigger` | `heist:retrigger` + `fs:update` | HeistScreens "+N FREE SPINS" | 1.4 s |
| `featureUpgrade` | `heist:upgrade` + `heist:mode` + `fs:update` | HeistScreens UPGRADE → VAULT RAID | 2 s |

Core events (`reveal`, `winInfo`, `tumbleBoard`, `setWin`, `freeSpinEnd`, …) drive the engine Board, WinPresenter, BigWin and HUD unchanged.

## 3. Choreography (normal speed; turbo / super turbo divide by 2 / 3; all lab-tunable in section `heist`)

**Win (connection) step.** `board:showWins` → per cluster (cluster stagger) gold threads draw on along the cluster's link tree from the label cell (45 ms per depth, 110 ms grow), a bead of light runs root → leaves; symbols play `win` → `win_loop` (Spine) with the cluster label; **super cascade**: every other symbol of a winning type gets a flickering lightning arc from the nearest cluster cell and a ring flash (+220 ms). On the explode burst (`board:burst`) threads snap to sparks and the winning cells gild: gold tiles pop in with back.out(2.6) over 320 ms, staggered 26 ms (cap 360), a white flash and a sparkle each.

**Idle gold.** Squares shimmer in a travelling diagonal wave (2.6 s period), random twinkles pop on lit squares.

**Shooting Star.** `star:activate`: the board dims to the star(s); the star plays `win` → `win_loop`; a gold halo charges (520 ms); every square pulses in a wave; hit-stop 50 ms, shake 0.28, flash. `loot:reveal` round 1: the comet (star + glow + twinkle cross + violet/gold trail) leaves the star and visits every square on a nearest-neighbour tour (first leg 260 ms, then 120 ms per square, shorter for big sets); each square flips its loot in (scale-x through 0, back.out, halo flash) on a velvet display cushion that hides the symbol; gold coins, diamonds and nests add a burst. Rounds 2+: the nests pulse and the empty squares flip in a wave outward from them.

**Diamond.** Punch + sparkle (300 ms), beams shoot to each target (110 ms), each target's value rolls (360 ms) with a floating "×N"; the spent diamond shatters.

**Nest.** Punch; each coin flies in an arc into the nest (460 ms, 45 ms stagger, trail), the nest gulps (squash) and its value counts up with rising ticks; coins leave their squares; final punch + coin burst.

**Payout.** The LOOT plate pops at the board centre, every remaining coin / nest streams into it (520 ms flights, 50 ms stagger), the amount rolls with ticks, lands with coins + shake + mascot cue, holds 650 ms, then drops into the win display (380 ms) as `updateTumbleWin` updates the HUD; the board un-dims.

**Heists.** Safes celebrate (win clip, scatter burst, coins) → wipe → INTRO: heist emblem (mask / safe / star) on god rays, the heist title in its palette (moonlight / gold / violet), the spin count slam, FREE SPINS, the one-line rule; tap or auto. Retrigger: "+N FREE SPINS" flies into the plate. Upgrade: UPGRADE! → emblem → VAULT RAID → +N, background crossfades. Outro: TOTAL WIN count-up with confetti and coins.

## 4. Screens and HUD

- **Intro** (boot, once, skippable via the settings key): three cards (Glint Squares, Shooting Star, The Heists) + max win.
- **The Heist Board** (bonus-buy hex): four cards. BONUS HUNT / STAR SPINS switch FEATURE SPINS on (engine `ui:spinMode`; every spin and autoplay round then plays that mode); NIGHT PROWL / VAULT RAID buy one round. Every choice > 2× has the confirm step; unaffordable cards are greyed. While feature spins are on, a pill above the spin button names them and switches them off on tap.
- **Heist plate** (bonus-buy slot during free spins): heist name + `n / total`, punches on update, flashes red on a retrigger.

## 5. Layout (`layout.ts`)

| Space | Grid | Monty | Logo | HUD |
|---|---|---|---|---|
| Landscape 1920×1080 | 140 px cells, 6 px gap, grid at (576, 136), gilded frame (494, 58, 1034, 886) | left column (40, 262, 440, 724), facing the reels | top left over Monty | right column; balance bottom left; win under the frame |
| Portrait 1080×1920 | 150 px cells at (75, 640) | top left (24, 128, 318, 452) | top right band | bottom band |
| Tablet 1920×1920 | landscape moved down 420 | | | |
| Compact 960×540 | 78 px cells | none | one-line word-mark | Swamp Funk compact HUD |

## 6. Scene

- **Background** (`scene/Background.ts`): the painted museum hall, cover-fitted; living light on bgFx (moonbeam dust motes in the upper side bands, four crimson lasers sweeping under the dome, moon and vault glows breathing); heist looks tint the plate and add a crimson alarm double-pulse (Night Prowl moonlit, Vault Raid gold, Starfall violet), crossfaded in 1.4 s. Nothing moves behind the reels.
- **Frame** (`scene/Frame.ts`): the reels hang like a masterpiece in an ornate gilded frame: bevelled moulding bands, carved cove scallops, crimson velvet liner, pearl bead lip, ruby corner rosettes, a mask cartouche on top; a light sweep runs across the gold every 5.5 s; rubies breathe. Midnight velvet damask panel behind the grid.
- **Logo** (`scene/Logo.ts`): live word-mark MAGPIE / HEIST (moonlight over gold, glyph baker) with the Bandit Mask crest; shine sweep every 6 s, crest bob.

## 7. Mascot cues (Monty)

| Cue | When | Acting |
|---|---|---|
| `spinStart` | spin pressed | cap tug |
| `anticipation` | 2+ Safes | lean toward the reels, rub hands |
| `reactSmall` / `reactTumble` | small wins, nest collect | finger snap / wing pump |
| `celebrate` | Shooting Star activates | point at the board, fist pump |
| `winBig` | big payout, big win | jump, wings up |
| `fsTrigger` / `featureUpgrade` / `fsEnd` | heists | leap / celebrate / bow |

## 8. Audio

Placeholder procedural SFX from the engine bank: gilds `spot_mark`, comet ticks `counter_tick` with rising rate, diamond / nest `spot_upgrade`, payout `win_cluster` → `counter_end`, star charge `scatter_land_3` + `bigwin_tier`, heist stings `fs_*`. Production stems and dedicated SFX ids are an open item (§10).

## 9. QA

`?book=<scenario>` with the fixtures in the mock README (`star_coins`, `star_diamond`, `star_nest`, `cascade_chain`, `prowl_trigger`, `prowl_upgrade`, `vault_trigger`, `starfall_trigger`, `wincap`, …). Captures: `node tools/capture/shot.mjs --url "http://localhost:5173/?book=star_nest&sessionID=x" --script "await __slot.flow.spin()" --frames 1500 --every 50 --sheet --until-done`.

## 10. Open items

1. **Art still to generate** (Higgsfield daily cap, ART_PLAN §3): H2–H5, Safe, loot pieces, plate clean-up, portrait plate, heist plate variant, Monty hand poses. Until then: engine placeholder glyphs for H2–H5 / S and painted loot.
2. **Certified math**: the books are a deterministic mock (`tools/mockmath/magpie-heist`), not RTP-tuned.
3. **Dedicated SFX ids and music** (engine `SfxId` union) for the glint / loot / star beats.
4. **Word-mark** by a typographer and a trademark search for the title.
5. **Higgsfield clearance** before release (the licence audit refuses shipping uncleared vendor output in `--release`).
