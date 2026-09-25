# Mock math (book generators)

These are seeded simulators that write Stake book JSON for games whose real math-sdk package doesn't exist yet. The mock RGS (`mock/rgsMockPlugin.ts`) serves the output from `mock/games/<game>/books/`. None of this is certified math: the paytables, reel strips and weights are only there so the front end gets realistic rounds.

| Game | Folder | Contract and fixtures |
|---|---|---|
| Swamp Funk: Bass Drop | [`bass-drop/`](bass-drop/) | [`mock/games/bass-drop/README.md`](../../mock/games/bass-drop/README.md) |

```bash
node tools/mockmath/bass-drop/generate.mjs      # fixtures + pools; every book validated before writing; deterministic
node tools/mockmath/bass-drop/validate.mjs      # independent replay checker (--all adds hand-written books)
node tools/mockmath/bass-drop/stats.mjs --spins 200000 --buys 200
```

`bass-drop/` holds:
- `config.mjs`: all rules and numbers.
- `rng.mjs`: seeded sfc32.
- `engine.mjs`: the round simulator that emits events.
- `generate.mjs`, `validate.mjs`, `stats.mjs`: the scripts above.

The scripts are plain Node ESM with no dependencies (Node 22 or later).
