# Magpie Heist (`magpie-heist`)

A Le Bandit-style cluster slot under its own brand: **Monty**, a magpie cat burglar, raids a moonlit museum vault. 6×5 cluster pays with **super cascades**; winning positions turn into **glint squares**; a **Shooting Star** reveals loot on them — coins, **diamonds** that multiply their neighbours and **nests** that collect every coin and make the squares reveal again; 3 / 4 / 5 **Safes** open **Night Prowl**, **Vault Raid** or **Starfall**; **Bonus Hunt** and **Star Spins** feature spins and two buys.

| File | What it is |
|---|---|
| [DESIGN.md](DESIGN.md) | Mechanics → theme map, book → scene events, choreography, screens, layout, scene, mascot cues, audio, QA, open items |
| [ART_PLAN.md](ART_PLAN.md) · [STYLE_DECISION.md](STYLE_DECISION.md) | What is generated on Higgsfield and how (rows, budget, commands), the adopted finish (formula M) |
| [mock/games/magpie-heist/README.md](../../../mock/games/magpie-heist/README.md) | The book event contract, rules behind the events, fixtures |

## Run it

```bash
pnpm dev:magpie-heist                 # http://localhost:5173/
pnpm build:magpie-heist               # typecheck + dist/magpie-heist/
GAME=magpie-heist pnpm qa:approval    # Stake approval smoke test
node tools/mockmath/magpie-heist/generate.mjs && node tools/mockmath/magpie-heist/validate.mjs
```

`?book=<scenario>` forces a fixture: `loss`, `small_win`, `cascade_chain`, `star_coins`, `star_diamond`, `star_nest`, `prowl_trigger`, `prowl_retrigger`, `prowl_upgrade`, `vault_trigger`, `starfall_trigger`, `bigwin`, `wincap`; ids 20001–20050 are Night Prowl buys, 30001–30050 Vault Raid buys, 40001–40100 Bonus Hunt spins, 50001–50100 Star Spins. Add `&sessionID=<new>` to start fresh.

## Modules (`src/games/magpie-heist/`)

| Module | Does |
|---|---|
| `scene/Background.ts` | Painted museum plate, motes, sweeping lasers, glows, heist looks + alarm wash |
| `scene/Frame.ts` | Ornate gilded picture frame, velvet panel, light sweep, ruby rosettes |
| `scene/Logo.ts` | Live MAGPIE / HEIST word-mark with the Bandit Mask crest |
| `connect/Connections.ts` | Gold thread links per cluster + super-cascade lightning arcs |
| `glint/Glint.ts` (+ `LootView.ts`, `art.ts`) | Glint squares, the Shooting Star comet, loot reveal / diamond boosts / nest collects / payout plate |
| `screens/HeistScreens.ts` | Heist intros, retriggers, upgrade, plate, outro |
| `screens/BuyScreen.ts` | The Heist Board: feature spins toggles and buys, confirm step, active pill |
| `screens/IntroScreen.ts` | Boot intro cards |
| `mascots/Monty.ts` | Monty (2D Spine rig, static cut-out fallback) |
| `audio/HeistSound.ts` | Heist stings on top of the per-step SFX |

Engine change for this game: persistent **feature spins** (`BetModeDef.spin`, `ui:spinMode`, HUD `spinMode`) in `src/flow/`.
