# {{TITLE}}: math brief (for the Stake math-sdk)

Owner: `math-engineer`. Source of truth for the numbers is the math-sdk game folder (`games/{{ID}}/` in your math-sdk checkout: `game_config.py`, `gamestate.py`, `run.py`). This brief is what the front end and the rules depend on.

## 1. Targets

| Mode | Cost | RTP | Max win (× bet) | Max-win hit rate | Base hit rate (any win) | Volatility |
|---|---|---|---|---|---|---|
| BASE | 1 | TODO (90–98%) | TODO | better than 1 in 10M | 1 in 3–8 (never worse than 1 in 20) | TODO |
| TODO | TODO | within ±0.5% of BASE | TODO | | | |

## 2. Rules to simulate

Grid, paytable (cluster sizes or ways or lines), specials, the new mechanic in numbered steps (identical to DESIGN.md §2), caps, the wincap behaviour.

## 3. Events (front-end contract)

The core math-sdk events (`reveal`, `winInfo`, `updateTumbleWin`, `tumbleBoard`, `setWin`, `setTotalWin`, `freeSpinTrigger`, `updateFreeSpin`, `freeSpinEnd`, `finalWin`, `wincap`) plus the new ones:

| Event | Payload (units!) | When |
|---|---|---|
| TODO | | |

Units: book amounts are bet multiple × 100; positions use **padded** rows; multiplier grids are unpadded.

## 4. Simulation and optimisation

- 100k–1M simulations per mode, compressed books (`.jsonl.zst`), the optimisation program run to target RTP.
- Checks before handing off: RTP per mode, the spread between modes ≤ 0.5%, the win distribution has no gaps, the most likely outcome does not dominate, zero-weight payouts do not dominate, base standard deviation within norms.
- Outputs for the ACP: `config.json`, `config_fe.json`, `config_math.json`, lookup tables, books. Mode costs, max win and RTP are copied **verbatim** into `src/games/{{ID}}/config.ts` (`BET_MODES`) and `gameInfo.ts`.

## 5. Fixture books for the front end

Until the certified math lands, the front end runs on fixture books in `mock/games/{{ID}}/books/` (format: [mock/rgsMockPlugin.ts](../../../mock/rgsMockPlugin.ts)). Required keys: `loss`, `small_win`, `tumble_chain`, `anticipation_hit`, `anticipation_miss`, `feature_trigger`, `retrigger`, `big_win`, `mega_win`, `wincap`, plus one per new mechanic state. Optionally write a seeded generator like `tools/mockmath/` (Bass Drop).

## 6. Replay event ids for reviewers (fill in before submission)

| Mode | Normal win | Big win | Wincap | Loss | Feature trigger |
|---|---|---|---|---|---|
| BASE | | | | | |
