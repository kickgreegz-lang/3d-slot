# Magpie Heist — art plan

**Status (2026-10-26).** Probe `mh_probe1` is generated, ingested and adopted (5 jobs, 14 credits; [STYLE_DECISION.md](STYLE_DECISION.md)). Higgsfield then refused further jobs: the account is in a **"grace period" with a daily generation limit** (5 jobs accepted that day). Batches `mh_c01`–`mh_c03` are planned, rendered and cost-checked (30 credits; balance 148.7) and run as soon as the account accepts jobs. Everything else in the game is built and shipped. Until `mh_c01` runs, H2–H5 and the Safe ship as **owned-code vector stand-ins** drawn to formula M's rules (`tools/mhart/vector/standins.mjs`: bold outer outline, thinner inner lines, hard cel shadows, gloss; `build_art.py standins`); loot pieces and plates fall back to painted / procedural stand-ins.

Pipeline (the same one Bass Drop used, [docs/PIPELINE.md](../../PIPELINE.md)):

1. **Values**: `art/bible/artbible.json` → `magpieHeist` (formula M, environment formula, palette, briefs per symbol / loot / mascot / plates).
2. **Specs**: `python3 art/plan/magpie-heist/spec.py <batch> > art/_work/hf-plans/<batch>.spec.json` renders every prompt from the shared templates (`art/bible/prompts/*.txt`, genlib) with the batch's references (Higgsfield job ids of the approved anchors; nothing local is uploaded).
3. **Plan → pay → record → ingest**: `pnpm gen:hf-ingest plan --spec … --max-credits N` prints the exact `generate_image_batch` call; the Higgsfield MCP pays it (model `nano_banana_pro`, never an OpenAI model); `pnpm gen:hf-ingest record --plan … --from <reply>` (and again with the `jobs_wait` reply); `NODE_USE_ENV_PROXY=1 pnpm gen:hf-ingest --batch <batch>` downloads into `art/_raw/<asset>/vNN/` with provenance rows. Ledger: `art/ledger/higgsfield-jobs.json`.
4. **Build**: `tools/.venv/bin/python tools/mhart/build_art.py [symbols] [standins] [crest] [bg] [mascot] [ship-spec]` → `art/source/magpie-heist/**` (matte with the measured key, 360 @2x board sprites, _blur / _glow, plates, the Monty cut-out, the logo crest), one provenance row per file.
5. **Rigs**: symbols `tools/mhart/rigs/build.sh <ID>` (cut → generator → validate → pack; [tools/mhart/rigs/README.md](../../../tools/mhart/rigs/README.md)); Monty: [art/source/magpie-heist/mascot/README.md](../../../art/source/magpie-heist/mascot/README.md).
6. **Ship**: `tools/.venv/bin/python tools/licence/ship.py tools/licence/ship/magpie_heist.json` → `public/assets/magpie-heist/**` (+ rows, `shipped: true`); `node tools/licence/audit.mjs` must stay at 0 errors.

## 1. Asset table

| # | Asset | What | Template | Model · res · aspect | Batch | Credits | Status |
|---|---|---|---|---|---|---|---|
| 1 | `sym_H1` | Jeweled Crown (formula D) | `symbol.txt` | NBP · 2k · 1:1 | mh_probe1 | 2 | **adopted**, shipped, rig |
| 2 | `sym_W` | Bandit Mask wild over a blank banner | `symbol.txt` | NBP · 2k · 1:1 | mh_probe1 | 2 | **adopted**, shipped, rig |
| 3 | `sym_R` | Shooting Star | `symbol.txt` | NBP · 2k · 1:1 | mh_probe1 | 2 | **adopted**, shipped, rig |
| 4 | `mascot_monty_sheet` | Monty design sheet, 4 views | `mascot_turnaround.txt#A` | NBP · 4k · 21:9 | mh_probe1 | 4 | **adopted**; 3/4 view = rig master |
| 5 | `bg_base_landscape` | Museum treasure hall plate | `background.txt#A` | NBP · 4k · 21:9 | mh_probe1 | 4 | **adopted** (clean-up edit planned) |
| 6–9 | `sym_H2`…`sym_H5` | Jeweled Egg, Pocket Watch, Ruby Chalice, Key Ring | `symbol.txt` | NBP · 2k · 1:1 | mh_c01 | 8 | planned (refs H1, W, R); vector stand-ins ship |
| 10 | `sym_S` | Crimson safe scatter | `symbol.txt` | NBP · 2k · 1:1 | mh_c01 | 2 | planned; vector stand-in ships |
| 11 | `prize_coins` | bronze / silver / gold coins with blank centres | `symbol.txt` | NBP · 2k · 16:9 | mh_c01 | 2 | planned (painted stand-ins ship) |
| 12 | `prize_diamond` | brilliant diamond in a gold claw setting (#FF00FF) | `symbol.txt` | NBP · 2k · 1:1 | mh_c01 | 2 | planned (painted stand-in ships) |
| 13 | `prize_nest` | twig nest heaped with loot | `symbol.txt` | NBP · 2k · 1:1 | mh_c01 | 2 | planned (painted stand-in ships) |
| 14 | `bg_base_landscape_fix` | plate without the stray slot machine | `background.txt#G` (new clean-up section) | NBP · 4k · 21:9 | mh_c02 | 4 | planned |
| 15 | `bg_base_portrait` | portrait reframe | `background.txt#F` | NBP · 4k · 9:16 | mh_c02 | 4 | planned (centre column of the landscape plate ships) |
| 16 | `bg_heist_landscape` | alarm variant for the heists | `background.txt#E` | NBP · 4k · 21:9 | mh_c02 | 4 | planned (code tint + alarm wash ship) |
| 17 | `monty_hands` | hand poses (point, fist, thumbs up, wave) | `mascot_parts_sheet.txt#D` | NBP · 2k · 3:2 | mh_c03 | 2 | planned |

Not generated on purpose (made in code, 0 credits): royals A K Q J 10 (engine glyph builder), the glint tile and the velvet loot cushion (`glint/art.ts`), the gilded frame (`scene/Frame.ts`), the logo word-mark (live text) and crest (the W master without text), the comet / trails / lightning / beams (code FX), feature emblems (the W, S and R art).

## 2. Budget

Balance 162.71 at start → 148.71 after `mh_probe1`. Planned P0/P1: `mh_c01` 16 + `mh_c02` 12 + `mh_c03` 2 = **30**. Retry allowance: 2 regenerations per asset (ART_BIBLE). Top-ups worth spending on next: second candidates for H2–H5 / S (+10), a generated gilded frame (beam / post / sill / corner, +8), heist emblem illustrations for the intro cards (+6).

## 3. Running the next batches

```bash
python3 art/plan/magpie-heist/spec.py mh_c01 > art/_work/hf-plans/mh_c01.spec.json
pnpm gen:hf-ingest plan --spec art/_work/hf-plans/mh_c01.spec.json --max-credits 20 > art/_work/hf-plans/mh_c01.calls.json
# pass calls[0].requests to the Higgsfield MCP generate_image_batch, save the reply, then:
pnpm gen:hf-ingest record --plan art/_work/hf-plans/mh_c01.plan.json --from <reply.json>
NODE_USE_ENV_PROXY=1 pnpm gen:hf-ingest --batch mh_c01
# review, add the picks to tools/mhart/build_art.py SYMBOLS / BG / LOOT (an id in SYMBOLS overrides its vector
# stand-in in STANDINS), rebuild, rig, ship
```

## 4. Review rubric

ART_BIBLE §10 gates plus `keyUniform` (automated in the matte). Per foreground asset: single-weight black outline with no sketchy double line, no drips, no glow painted in, no text or pseudo-letters, light from the upper left, readable at 64 px. Symbols: same finish and camera as the anchors; distinct silhouettes (crown, egg, watch, chalice, keys, safe, mask, star). Plates: no characters / UI / text, calmer darker centre 60 %, brightest masses at the sides, no stray objects (the slot machine lesson).

## 5. Licence

Every row: `route: higgsfield-mcp`, `licenseId: higgsfield` (clearance **pending**): builds and previews, refused by `pnpm licence:audit --release` until the written clearance is filed. SynthID is in every Nano Banana image.
