# Workflow: a new slot, a new mechanic, a new world

This is the end-to-end path from an idea, or a reference game you want to match, to a Stake Engine submission aiming at **3 stars**. Every phase lists:
- the **owner agent** ([AGENTS.md](AGENTS.md));
- the **commands**;
- the **outputs** (paths);
- the **gate** that ends it.

**You are the producer and decide at the ★ points.** Everything else can run through the agents.

Related: [TECH_STACK](TECH_STACK.md) · [ANIMATION_STATES](ANIMATION_STATES.md) · [PERFORMANCE](PERFORMANCE.md) · [HIGGSFIELD_PLAYBOOK](HIGGSFIELD_PLAYBOOK.md) · [STAKE_3_STAR](STAKE_3_STAR.md) · the tool-by-tool [PIPELINE](../PIPELINE.md).

```
 0 setup ─► A design ─★─► B build on placeholders ─┬─► E animation ─► G feel + perf ─► H verify + 3★ review ─★─► I submit
                         C math (parallel) ────────┤
                         D art (Higgsfield) ───────┤
                         F audio ──────────────────┘
```

Typical calendar for one game with the engine as it is (one person + agents): A 1 week · B 2–3 weeks · C 2–3 weeks (parallel) · D 3–4 weeks · E 3–4 weeks · F 1–2 weeks · G 1 week · H 1 week. That is **about 8–12 weeks** to submission. The longest path is art + animation.

---

## Phase 0: setup (once per machine)

- **Do:**
  - [STACK § Install checklist](../STACK.md#install-checklist) (Node 22, pnpm, Python venv for tools, optional Blender, the Spine Editor seat);
  - `pnpm install`;
  - `python3 -m venv tools/.venv && tools/.venv/bin/pip install -r tools/requirements.txt`.
- **MCP:**
  - copy `.mcp.json.example` → `.mcp.json` (Higgsfield, stake-docs, Playwright, chrome-devtools);
  - in Claude Code run `/mcp` and authenticate Higgsfield; call `select_workspace` on Higgsfield when it lists several.
- **Gate:** `pnpm typecheck && pnpm test:kit && pnpm build:all` pass.

## Phase A: design the mechanic and the world

**Owner:** `/new-slot <id> "<Title>"` (game-designer + math-engineer + art-director in parallel, then the compliance auditor and a concept rating).

1. **Scaffold.** `pnpm new-game <id> --title "<Title>"` (template game swamp-funk: 7×5 cluster tumble with board multiplier spots).
   - It creates `src/games/<id>/`, `mock/games/<id>/`, `tsconfig.<id>.json`, the npm scripts and `docs/games/<id>/` (DESIGN, ANIMATION_SET, MATH_BRIEF, scorecard, `animation-states.json`, `hf/x01.spec.json`).
   - The game runs at once (`pnpm dev:<id>`) with placeholder art and a reactive layered background.
2. **Design.** `docs/games/<id>/DESIGN.md`: pitch and signature moment, the mechanic in numbered steps, features, **bet modes**, book events, beat sheets per speed, symbol set, layouts, audio, compliance notes.
3. **Math brief.** `docs/games/<id>/MATH_BRIEF.md`: RTP per mode (all within 0.5%), max win and its odds, hit rate, the event list with units, and the fixture book list.
4. **Theme and style.**
   - 4 directions, with references described in words (**never upload another studio's art** as a generation reference: derivative assets fail Stake's originality rule).
   - Then the x01 exploration batch through `/hf-batch docs/games/<id>/hf/x01.spec.json --max-credits 40`.
5. **Verify.** `stake-compliance-auditor` on the design; `star-rating-reviewer` (brief C) on pillars P1/P2.

**★ You decide:**
- the theme and direction;
- the title (unique; no Megaways/Xways, no Stake/Kick);
- the **bet modes and max win**: they cannot change after approval.

**Gate:** no TODO left in DESIGN.md §0–§7 and §9–§13; the compliance auditor has no FAIL on the design.

## Phase B: build the game on placeholders

**Owner:** gameplay-engineer. **Verifiers:** engine-reviewer, qa-verifier.

1. Config:
   - `src/games/<id>/config.ts`: GRID, SYMBOLS, WIN_TIERS, SPOT_BANDS, FEATURES, BET_MODES, ATTRACT;
   - `layout.ts`: the 4 design spaces;
   - `gameInfo.ts`: rules with every value;
   - `i18n.ts`: copy plus social wording.
2. Book events → handlers → scene events (`book.ts`, `events.ts`), with resume and replay folding.
3. Feature modules in `modules.ts`, one job each, all events and timing tables (`registerTiming`).
4. **Engine deltas** E1–E8 ([ANIMATION_STATES §5](ANIMATION_STATES.md#5-engine-deltas-build-these-in-phase-b-owner-gameplay-engineer)) plus the mechanic deltas from the design.
5. Fixture books for every scenario in `mock/games/<id>/books/` (math-engineer) until the certified books land.
6. Wire your existing menus and UI to the `ui:*` / `hud:*` events.

**Gate (`/verify-slot <id>`):**
- `pnpm typecheck` (all games), `pnpm test:kit`, `pnpm kit:check <id>` (0 fail), `pnpm build:all`;
- `GAME=<id> pnpm qa:approval` (7 viewports, zero console);
- every scenario plays on placeholders: `?book=<fixture>`.

## Phase C: math (parallel with B)

**Owner:** math-engineer.

- **Do:**
  - write the math-sdk game (`game_config.py`, `gamestate.py`, `run.py`);
  - run 100k–1M simulations per mode;
  - optimise to the RTP target;
  - check every rule in [STAKE_3_STAR §2.2](STAKE_3_STAR.md#22-math);
  - export the books and configs.
- **Front end:** the real books replace the fixtures in `mock/games/<id>/books/`, and the rules numbers are copied verbatim from `config_fe.json`.
- **Gate:** the math report shows RTP per mode, the spread ≤ 0.5%, max win better than 1 in 10M, base hit rate 1 in 3–8, and no distribution gaps. The stake-compliance-auditor signs off the rules text.

## Phase D: art production (Higgsfield)

**Owner:** art-director + higgsfield-artist ([HIGGSFIELD_PLAYBOOK](HIGGSFIELD_PLAYBOOK.md)).

1. Lock the style:
   - the frozen style formula + environment formula in DESIGN.md §9;
   - 10–20 hero images painted over by a person (authorship + the canonical reference pack).
2. Batches (each through `/hf-batch`, with ledger and manifest rows):
   - `s01` symbol masters (beauty + rig-ready);
   - `s02` royals;
   - `s03` alternates and fills;
   - `b01` board/frame pieces;
   - `e01` plates base + feature + tile;
   - `e02` layers (`image_decompose`, outpaint portrait);
   - `v01` loops and FX.
3. Matte, variants and master cuts:
   - `pnpm matte`, `matte:variants`;
   - the master cut into parts (SSIM > 0.98 reassembly).
4. Background:
   - plates into `public/assets/<id>/bg/`;
   - set `src` in `environment.ts`.

**★ You approve** every batch (child-likeness, IP, quality) and file the Higgsfield clearance (`licenses/clearances/higgsfield.pdf`) before anything ships.

**Gate:**
- art gates: no halo, canvas and pivot, a 64 px silhouette matrix without confusable pairs, calm BG centre, no text;
- `pnpm licence:audit` green.

## Phase E: animation production

**Owner:** symbol-animator, environment-artist, vfx-engineer. **Verifier:** animation-critic.

- **Do:**
  - `/symbol-states <id> <SYMBOL>` for every symbol, so all five states exist (spin, land, miss, connect, explode) + idle/anticipation;
  - the background layers react to all 9 states;
  - the board/frame reactions;
  - the multiplier symbol and spot-tile states;
  - feature intro/outro and big-win presentation.
- **Gate:**
  - every state in `animation-states.json` is `done`;
  - `pnpm kit:check <id>` shows no animation warnings;
  - `pnpm spine:validate` passes on every rig;
  - no "major" from the critic.

## Phase F: audio

**Owner:** audio-director (+ a person listening).

- **Do:**
  - write the cue sheet keyed by SfxId (new cues for every new mechanic beat);
  - generate, pre-filter, then have a person run an A/B listen;
  - master and fill the manifest.
- **Gate:** loudness targets met, seamless loops, a person signs off the final mix.

## Phase G: feel and performance

**Owner:** game-designer + performance-engineer.

- **Do:**
  - tune every timing table live in `pnpm lab:<id>` and export;
  - capture the golden runs: `pnpm qa:review --scenarios spin,tumbleChain,anticipation,bigWin:mega,shakeFlash --out qa/<id>/golden`;
  - trace on real devices ([PERFORMANCE](PERFORMANCE.md)).
- **Gate:**
  - feel gates: squash 0.80–0.88, settle ≤ 150 ms, big-win shake 6–14 px, ≤ 3 flashes/s;
  - p95 < 16.7 ms on the reference Android and iPhone;
  - no hitch at the feature start.

## Phase H: verify and predict the rating

**Owner:** the producer with the verification team.

- **Do:**
  - `/verify-slot <id> --release` must report READY;
  - `/star-review <id>` must predict 3 stars with margin (every reviewer ≥ 2.67, no pillar < 2.33);
  - a person plays 50 spins on a phone and fills a scorecard too;
  - run EA IRIS on the big-win, feature and anticipation captures.
- **Gate:** READY + the rating margin + `pnpm licence:audit --release --strict` green + IRIS pass.

## Phase I: package and submit

**★ You submit** (it is not scriptable):
1. `pnpm build:<id>`.
2. Upload the **contents** of `dist/<id>/` in the ACP (Files → import folder → Publish Game → Front End).
3. Test through Developer → Start game session.
4. Build the tile in the Tile Editor: a bright background, the foreground in the key-focus box, no text in the images.
5. Fill in the replay event ids per mode from MATH_BRIEF §6.

After approval only minor visual fixes are allowed. The game is re-ranked every Friday (AU time) by player performance.

---

## Worked example

The "Sugar-Gates-like" concept is the first game run through this workflow. Its themes, Higgsfield board mockups and mechanics spec are in `docs/games/` (see [docs/new-slot/README.md](README.md#worked-example)). Its mechanics are a 7×5 cluster tumble, board multiplier spots on every connection, and dropping multiplier symbols.
