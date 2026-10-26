# Magpie Heist — mock books and event contract

The mock Stake RGS (`mock/rgsMockPlugin.ts`) serves these books until the real math-sdk game exists. `tools/mockmath/magpie-heist/` generates them with a deterministic, seeded simulator that follows the mechanics below exactly. The math is **not** certified or RTP-tuned (stats are sanity numbers only).

```bash
node tools/mockmath/magpie-heist/generate.mjs           # rebuild every book (validated before writing)
node tools/mockmath/magpie-heist/validate.mjs [--all]   # replay-check the books
```

Tune the mock in `tools/mockmath/magpie-heist/config.mjs`: paytable, reel strips, star chances, item tables, free-spin rules, bet modes and win levels all live there.

## Files

| File | Content | ids |
|---|---|---|
| `base_fixtures.json` | `{scenario: book}`, see below | 1001–1013 |
| `books_base_300.json` | 300 BASE rounds (x1) | 10001–10300 |
| `books_hunt_100.json` | 100 Bonus Hunt rounds (x3, five times the Safes) | 40001–40100 |
| `books_stars_100.json` | 100 Star Spins rounds (x10, a Shooting Star on every reveal) | 50001–50100 |
| `books_prowl_50.json` | 50 Night Prowl buys (x100) | 20001–20050 |
| `books_vault_50.json` | 50 Vault Raid buys (x250) | 30001–30050 |
| `mock.json` | bet modes BASE / HUNT / STARS / PROWL / VAULT → pools | |

`?book=<scenario>` or `?book=<id>` forces a book in the dev server.

| Scenario | What it shows |
|---|---|
| `loss` | no win |
| `small_win` | one cluster, one tumble, glint squares appear and reset (no star) |
| `cascade_chain` | 4+ tumbles with super cascades (every instance of the winning type explodes) |
| `star_coins` | a Shooting Star activates 7+ squares: coins only |
| `star_diamond` | activation with a diamond that boosts its neighbours |
| `star_nest` | activation with nests: coins fly into the nests, emptied squares re-reveal |
| `prowl_trigger` | 3 Safes → Night Prowl, squares persist until a star activates them |
| `prowl_retrigger` | Night Prowl with a +2 / +4 retrigger |
| `prowl_upgrade` | 4 Safes during Night Prowl → upgrade to Vault Raid (+4) |
| `vault_trigger` | 4 Safes → Vault Raid, squares never reset |
| `bigwin` | a base-game win of 20x or more |
| `starfall_trigger` | 5 Safes → Starfall: a star every spin, no bronze coins |
| `wincap` | a Vault Raid capped at 10,000x |

## Event contract

Amounts are bet multiple x100. Boards are `[reel][paddedRow]`: 6 reels x 7 padded rows, rows 0 and 6 are off-screen padding, visible rows 1..5. Every position uses padded rows.

```
reveal {board, paddingPositions, gameType:'basegame'|'freegame', anticipation:number[6]}
   board cells: {name} | {name:'W', wild:true} | {name:'S', scatter:true}; 'R' = Shooting Star (never pays, blocks clusters)
glintState {squares}                         // free spins: the persisting squares, right after each reveal
winInfo {totalWin, wins:[{symbol, clusterSize, win, positions, meta:{globalMult, clusterMult, winWithoutMult, overlay}}]}
glintSquares {added, squares}                // after every winInfo: the winning positions that became squares, and the full set
updateTumbleWin {amount}                     // running spin win (cluster pays + glint payout)
tumbleBoard {newSymbols, explodingSymbols}   // super cascade: every instance of a winning type explodes (+ cluster wilds)
starActivate {stars, squares}                // the cascade settled with a star on the board and squares to activate
glintReveal {round, items:[{reel,row, kind:'coin', tier:'bronze'|'silver'|'gold', value} | {kind:'diamond', mult} | {kind:'nest', value:0}]}
diamondBoost {reel,row, mult, targets:[{reel,row, kind:'coin'|'nest', from, to}]}   // one per revealed diamond, reading order
nestCollect {reel,row, from, to, sources:[{reel,row, kind:'coin', value}]}           // one per NEW nest, reading order
glintPayout {amount, items:[{reel,row, kind, value}]}   // every remaining coin + every nest (value > 0)
glintReset {squares, keep}                   // squares left after the spin (keep = the items were paid, squares stay)
setWin {amount, winLevel}; setTotalWin {amount}
featureTrigger {feature:'prowl'|'vault'|'starfall', scatters, totalFs, positions}   // base round end
featureRetrigger {feature, addFs, total, positions}     // after a free spin with 2+ Safes
featureUpgrade {from:'prowl', to:'vault', addFs, total, positions}   // 4+ Safes during Night Prowl
updateFreeSpin {amount, total}; freeSpinEnd {amount, winLevel}; finalWin {amount}; wincap {amount}
```

### Round skeletons

```
spin:      reveal · glintState? · [winInfo · glintSquares · updateTumbleWin · tumbleBoard]*
           · [starActivate · (glintReveal · diamondBoost* · nestCollect*)+ · glintPayout · updateTumbleWin]?
           · glintReset? · setWin? · setTotalWin
base:      spin · featureTrigger?
feature:   per free spin: updateFreeSpin · spin · (featureUpgrade | featureRetrigger)?
end:       glintReset? · freeSpinEnd (after a feature) · finalWin
win cap:   ... updateTumbleWin · wincap · glintReset? · setWin · setTotalWin · [glintReset · freeSpinEnd] · finalWin
```

### Rules behind the events

- **Clusters:** 5+ orthogonally connected, W substitutes, a group of wilds alone pays nothing. S (Safe) and R (Shooting Star) never pay and block clusters.
- **Super cascade:** every instance of a winning symbol type explodes, not only the cluster; wilds explode when they are part of a winning cluster. Refill follows the Stake web-sdk rule (per reel: newSymbols ++ survivors).
- **Glint squares:** only winning cluster positions become squares. They belong to the cell, not to the symbol.
- **Shooting Star:** not on the reel strips: a reveal board carries one with a per-phase chance and a tumble refill can bring one in. When the cascade settles with a star on the board and at least one square, the star activates every square:
  1. every empty square reveals an item (coins: bronze 0.2–4x, silver 5–20x, gold 25–500x; diamond x2/x3/x4/x5/x10; nest);
  2. each new diamond (reading order) multiplies the coins and nests (value > 0) in the 8 surrounding cells, then leaves its square empty;
  3. each new nest (reading order) collects every coin on the board (each nest of a round gets the full sum); the collected coins leave their squares;
  4. if a nest appeared, the empty squares reveal again (round 2, 3 …, max 8 rounds); otherwise the activation ends;
  5. `glintPayout` pays every remaining coin and every nest.
- **Square lifetime:** base game: cleared at the end of every spin (`glintReset`). Night Prowl: kept from spin to spin until a star activates them. Vault Raid and Starfall: never cleared (`keep: true` after an activation; the paid items are cleared). Every square is cleared before `freeSpinEnd`.
- **Free spins:** 3 / 4 / 5 Safes on the final base board → Night Prowl (8) / Vault Raid (12) / Starfall (12). Each free spin with 2 / 3+ Safes retriggers +2 / +4 (Night Prowl) or +2 / +3 (Vault Raid, Starfall). 4+ Safes during Night Prowl upgrade it to Vault Raid (+4). Starfall has a star on every reveal and no bronze coins.
- **Anticipation:** base reveals only; reels after the second Safe count 1, 2, 3 ….
- **Bet modes:** HUNT (x3) uses a reelset with five times the Safes; STARS (x10) puts a star on every base reveal; PROWL (x100) and VAULT (x250) re-draw the base spin until it lands exactly 3 / 4 Safes (math-sdk "repeat until criteria"). Starfall cannot be bought.
- **Win cap:** 10,000x; the round stops at the capping event.
