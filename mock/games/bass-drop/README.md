# Swamp Funk: Bass Drop — mock books and event contract

The mock Stake RGS (`mock/rgsMockPlugin.ts`) serves these books to the front end while the real math-sdk game doesn't exist yet. `tools/mockmath/bass-drop/` generates them with a deterministic, seeded simulator. It follows the mechanics below exactly, but the math is **not** certified or RTP-tuned.

```bash
node tools/mockmath/bass-drop/generate.mjs              # rebuild every book (validated before writing)
node tools/mockmath/bass-drop/validate.mjs [--all]      # replay-check the books (--all adds dev_fixture.json)
node tools/mockmath/bass-drop/stats.mjs --spins 200000 --buys 200   # sanity statistics
```

The same code and the same `config.mjs` always produce byte-identical files. Tune the mock in `tools/mockmath/bass-drop/config.mjs`: paytable, reel strips, drop table, multiplier weights, feature spins and win levels all live there.

## Files

| File | Content | ids |
|---|---|---|
| `base_fixtures.json` | `{scenario: book}`, see the table below | 1001–1010 |
| `books_base_200.json` | 200 random BASE rounds (natural distribution: mostly losses and small wins) | 10001–10200 |
| `books_bonus_50.json` | 50 BONUS buys (100x), each ends in Juke Jam | 20001–20050 |
| `books_super_50.json` | 50 SUPER buys (300x), each ends in Mega Mix | 30001–30050 |
| `dev_fixture.json` | hand-written book (not generated) | 1 |
| `mock.json` | bet modes: BASE x1 → `base`, BONUS x100 → `bonus`, SUPER x300 → `super` | |

To force a scenario in the dev server, use `?book=<scenario>` or `?book=<id>`.

| Scenario | What it shows |
|---|---|
| `loss` | no win (0x) |
| `small_win` | one cluster, one tumble, win under 1x |
| `tumble_chain` | 4 tumbles, and a bass-drop wild is part of a later cluster |
| `meter_10` | one bass drop (meter 10–19); the dropped wild wins |
| `meter_30` | three bass drops (meter 30–39: 1 + 1 + 2 wilds) |
| `bonus_trigger` | base meter ≥ 40 → Juke Jam, 8 spins with x2..x5 multiplier wilds, no upgrade |
| `super_trigger` | base meter ≥ 60 → Mega Mix, 10 spins; sticky wilds respawn and grow |
| `bonus_upgrade` | Juke Jam reaches 60 → `featureUpgrade` → Mega Mix (+4 spins) |
| `bigwin` | a base-game-only win of 15x or more (no feature) |
| `wincap` | Mega Mix capped at 5000x (forced on the `wcap` reelset) |

`criteria` is one of `'0'` (no win), `'basegame'`, `'bonus'`, `'super'` or `'wincap'`. `baseGameWins` and `freeGameWins` are bet multiples, as in the math-sdk.

## Event contract

This is the contract as specified. Amounts are bet multiple x100.

```
EVENT CONTRACT (Stake book events; amounts bet-multiple x100; board [reel][paddedRow] 6 reels x 8 padded rows, rows 0 and 7 are off-screen padding, visible rows 1..6; positions use padded rows):
  reveal {board, gameType:'basegame'|'freegame', anticipation:number[6]}
  winInfo {totalWin, wins:[{symbol, clusterSize, win, positions, meta:{globalMult, clusterMult, winWithoutMult, overlay:{reel,row}, wildMult}}]}
  meterUpdate {value, delta, thresholds:number[]}   // after winInfo: delta = exploding count; thresholds = multiples of 10 newly crossed
  updateTumbleWin {amount}
  tumbleBoard {newSymbols, explodingSymbols}        // newSymbols[reel][0] is top-most (Stake web-sdk rule: combined = new ++ survivors)
  wildDrop {threshold, wilds:[{reel,row,multiplier,sticky}]}  // AFTER tumbleBoard refill; each wild REPLACES the symbol at its cell
  stickyWilds {wilds:[{reel,row,multiplier}]}      // Mega Mix: current sticky set, right after each free-spin reveal
  setWin {amount, winLevel}; setTotalWin {amount}
  featureTrigger {feature:'bonus'|'super', meter, totalFs}   // at base round end
  featureUpgrade {from:'bonus', to:'super', addFs}           // meter hit 60 during Juke Jam
  updateFreeSpin {amount, total}; freeSpinEnd {amount, winLevel}; finalWin {amount}
Order per tumble step: winInfo → meterUpdate → updateTumbleWin → tumbleBoard → (wildDrop per crossed threshold) → next winInfo...
```

### Round skeletons

```
base:      reveal · [winInfo · meterUpdate · updateTumbleWin · tumbleBoard · wildDrop*]* · setWin? · setTotalWin
           · featureTrigger?  (meter >= 40)
feature:   per free spin: updateFreeSpin · reveal(freegame) · stickyWilds (Mega Mix only) · [tumble steps]* · setWin? · setTotalWin
           · featureUpgrade?  (Juke Jam only, after the spin in which the meter reached 60)
end:       freeSpinEnd (only after a feature) · finalWin
win cap:   ... winInfo · meterUpdate · updateTumbleWin · wincap · setWin · setTotalWin · [freeSpinEnd] · finalWin
```

### Rules behind the events

The contract leaves these points open. The generator decides them as follows, and `validate.mjs` enforces them.

**Board and symbols**
- A symbol is `{name}`. A wild is `{name:'W', wild:true}`. A multiplier wild is `{name:'W', wild:true, multiplier:n}`, and it only appears on a reveal board at a Mega Mix sticky home.
- `newSymbols` never carry multipliers. Natural `W` can land from the reel strips: base and Juke Jam only, and rarely.
- `reveal` also has `paddingPositions` (the reel stops), like the Swamp Funk books. `anticipation` is always `[0,0,0,0,0,0]` because this game has no scatters.

**Clusters and pays**
- A cluster is 5+ orthogonally connected identical symbols on visible rows 1–6. W substitutes and can belong to several clusters. A group made only of wilds pays nothing.
- `positions` are the full maximal cluster. `overlay` is the cluster cell nearest its centroid.
- `wildMult` is the sum of the wild multipliers (≥ 2) in the cluster, or 0 when there are none. `clusterMult = wildMult || 1`, `globalMult` is always 1, and `win = winWithoutMult × clusterMult`.
- Every winning cell explodes, wilds included, and that includes Mega Mix sticky wilds. So `explodingSymbols` is the union of all win positions, with each cell listed once.

**Groove meter**
- `meterUpdate.value` is the running count of exploded symbols, and `delta` is the size of `explodingSymbols`.
- The meter resets to 0:
  - on every base reveal;
  - at `featureTrigger`, so the feature starts a fresh 0/60;
  - at `featureUpgrade`, so Mega Mix starts a fresh 0/60.
- Within a feature phase the meter persists across free spins and only goes up.
- `thresholds` lists only the multiples of 10 that drop wilds, which means 10..60. The value can pass 60 (it is not clamped), but nothing above 60 is listed or dropped in any phase. `featureTrigger.meter` is the raw base value, for example 79.

**Bass drops**
- Each listed threshold is followed by exactly one `wildDrop`, in ascending order, after that step's `tumbleBoard`.
- Wilds per drop: 10→1, 20→1, 30→2, 40→2, 50→3, 60→3. A drop only has fewer wilds when the board has too few free cells.
- Each target is a uniformly random visible cell that is not already wild and is not a Mega Mix sticky home. The wild replaces that symbol, and the next `winInfo` evaluates the board with the wild in place.
- The exception is the win cap: a `meterUpdate` on the capping step may list thresholds, but no drop follows because the round stops there.

**Multipliers by phase**
- Base-game drop wilds are `multiplier 1, sticky false`.
- Juke Jam drop wilds are x2..x5 (weights 20/30/28/22) and `sticky false`.
- Mega Mix drop wilds are x2..x10, heavily weighted toward x2 and x3.

**Mega Mix sticky wilds**
- A sticky wild's home is the cell it dropped on. `sticky: true` is set on the first 5 drops only (`FEATURES.super.maxSticky`). Later Mega Mix drops are one-shot x2..x10 wilds with `sticky: false`.
- Within a spin a sticky wild behaves like any wild: it explodes when it wins (so it counts for the meter) and falls with gravity when something under it explodes.
- On every later Mega Mix reveal it respawns at its home. The reveal board already has `W` + `multiplier` there, so a morph onto an already-wild cell is a no-op. `stickyWilds` then lists the whole registry (home cell and current multiplier).
- Each `winInfo` a sticky wild is part of adds +1 to its multiplier, capped at x25. The new value applies from the next reveal and shows in the next `stickyWilds`. The front end may show the +1 at win time.
- The front end's sticky set should be keyed by home cell, not by the cell the wild currently occupies.

**Juke Jam upgrade**
- `featureUpgrade` comes after the `setTotalWin` of the free spin in which the Juke Jam meter reached 60.
- The rest of that spin is still Juke Jam, so its 60-drop wilds are x2..x5 and not sticky.
- The next `updateFreeSpin.total` includes the +4 spins. The upgrade happens at most once.

**Amounts and win levels**
- `updateTumbleWin.amount` is cumulative within the spin.
- `setWin` is only emitted for a winning spin. `setTotalWin` is the running round total.
- `freeSpinEnd.amount` is the free-spin wins only, without the base spin, as in the math-sdk.
- `finalWin` equals the last `setTotalWin`, which equals `payoutMultiplier`.
- Win levels follow the math-sdk tables in `config.mjs`:
  - `setWin` uses `standard`: 0.1 / 1 / 2 / 5 / 15 / 30 / 50 / 100 / cap.
  - `freeSpinEnd` uses `endFeature`: 1 / 5 / 10 / 20 / 50 / 100 / 250 / 1000 / cap.

**Win cap (5000x)**
- When the round total reaches the cap, `updateTumbleWin` is truncated so the round pays exactly 500000.
- `wincap {amount: 500000}` follows, then the spin closes (no `tumbleBoard`) and the feature ends with no further spins.

**Bonus buys**
- The base spin of a buy book is a real spin. It is re-drawn from the same seed (attempt 0, 1, 2 …) until its meter earns exactly the bought feature: 40–59 for BONUS, ≥ 60 for SUPER. This is the math-sdk "repeat until criteria" approach.
- So `featureTrigger.meter` is always a genuine value, and a buy book looks exactly like a natural trigger.

**Not used:** `freeSpinTrigger` and `freeSpinRetrigger` (`featureTrigger` and `featureUpgrade` replace them), and `updateGrid`.

### Examples (from `base_fixtures.json` → `bonus_upgrade`)

A Juke Jam tumble step that crosses 10, followed by the drop and the multiplied win it enables:

```json
{"index":41,"type":"winInfo","totalWin":30,"wins":[{"symbol":"L5","clusterSize":6,"win":30,"positions":[{"reel":3,"row":3},{"reel":3,"row":4},{"reel":4,"row":4},{"reel":3,"row":5},{"reel":4,"row":5},{"reel":4,"row":6}],"meta":{"globalMult":1,"clusterMult":1,"winWithoutMult":30,"overlay":{"reel":3,"row":4},"wildMult":0}}]}
{"index":42,"type":"meterUpdate","value":11,"delta":6,"thresholds":[10]}
{"index":43,"type":"updateTumbleWin","amount":30}
{"index":44,"type":"tumbleBoard","newSymbols":[[],[],[],[{"name":"H2"},{"name":"H4"},{"name":"H4"}],[{"name":"H4"},{"name":"L4"},{"name":"L1"}],[]],"explodingSymbols":[{"reel":3,"row":3},{"reel":3,"row":4},{"reel":3,"row":5},{"reel":4,"row":4},{"reel":4,"row":5},{"reel":4,"row":6}]}
{"index":45,"type":"wildDrop","threshold":10,"wilds":[{"reel":3,"row":4,"multiplier":3,"sticky":false}]}
{"index":46,"type":"winInfo","totalWin":450,"wins":[{"symbol":"H4","clusterSize":8,"win":450,"positions":[{"reel":1,"row":4},{"reel":2,"row":4},{"reel":1,"row":5},{"reel":3,"row":4},{"reel":3,"row":3},{"reel":3,"row":2},{"reel":3,"row":1},{"reel":2,"row":2}],"meta":{"globalMult":1,"clusterMult":3,"winWithoutMult":150,"overlay":{"reel":3,"row":3},"wildMult":3}}]}
```

The upgrade, then a later Mega Mix reveal with four sticky homes (the reveal board already holds `{"name":"W","wild":true,"multiplier":n}` at each home):

```json
{"index":92,"type":"featureUpgrade","from":"bonus","to":"super","addFs":4}
{"index":93,"type":"updateFreeSpin","amount":7,"total":12}
{"index":136,"type":"stickyWilds","wilds":[{"reel":0,"row":5,"multiplier":3},{"reel":4,"row":2,"multiplier":4},{"reel":4,"row":6,"multiplier":2},{"reel":1,"row":3,"multiplier":2}]}
```

The trigger at the end of a base round (from `bonus_trigger`) and the end of a feature:

```json
{"index":32,"type":"featureTrigger","feature":"bonus","meter":54,"totalFs":8}
{"index":98,"type":"freeSpinEnd","amount":2000,"winLevel":5}
{"index":99,"type":"finalWin","amount":2740}
```

The win cap (from `wincap`). The capping step has no `tumbleBoard`:

```json
{"index":178,"type":"meterUpdate","value":352,"delta":24,"thresholds":[]}
{"index":179,"type":"updateTumbleWin","amount":198040}
{"index":180,"type":"wincap","amount":500000}
{"index":181,"type":"setWin","amount":198040,"winLevel":9}
{"index":182,"type":"setTotalWin","amount":500000}
{"index":183,"type":"freeSpinEnd","amount":498760,"winLevel":9}
{"index":184,"type":"finalWin","amount":500000}
```

## Mock math at a glance (`stats.mjs`, 200k base spins, 200 buys per mode)

| | |
|---|---|
| Base hit rate | 46.7% (1 in 2.14) |
| Tumbles per spin | 0: 53.3%, 1: 32.3%, 2: 9.2%, 3: 3.8%, 4+: 1.5% |
| Base meter | 0: 53.3%, 1–9: 27.4%, 10–19: 15.1%, 20–29: 3.2%, 30–39: 0.59%, 40–49: 0.17%, 50–59: 0.05%, 60+: 0.08% |
| Juke Jam (natural) | 2.2 per 1000 spins (1 in 451), average 51x; 28% upgrade to Mega Mix |
| Mega Mix (natural) | 0.77 per 1000 spins (1 in 1299), average 292x |
| RTP estimate (BASE) | about 89% (base 57.6%, features 31.4%); max seen 1942x |
| BONUS buy (100x) | average 48x, median 17x, max 538x, 28% upgrade |
| SUPER buy (300x) | average 274x, median 199x, max 1654x |

These numbers only check that the mock behaves like a slot. The real math package will replace them.
