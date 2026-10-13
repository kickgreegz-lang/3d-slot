# Stake Engine: approval gates and the 3-star target

A game first has to pass approval. Only then does its star rating decide where it shows in the lobby. This page splits the two:

1. **[What Stake publishes](#1-what-stake-publishes-official)**: the rating process and tiers, quoted from the official docs.
2. **[Hard gates](#2-hard-gates-fail-one-and-the-rating-does-not-matter)**: every approval requirement, with the repo check that covers it.
3. **[The 3-star scorecard](#3-the-3-star-scorecard-our-rubric)**: **our own rubric**, which turns "studio quality, exceptional creativity, uniqueness, attention to detail" into things we can check.
4. **[The internal review protocol](#4-internal-review-protocol-run-before-every-submission)**: three blind reviewer agents plus people, scored with Stake's own formula.

**Sources:** [github.com/StakeEngine/docs](https://github.com/StakeEngine/docs) at commit `fefadc7` (2026-03-17). Pages: `src/routes/docs/approval/{+page,quality,checklist,math-requirements,frontend-requirements,rgs-requirements,game-tile}`, `static/mockchecklist.json`, `src/routes/faq/publishing/*`, `src/routes/changelog/*`. **Check them again before you submit.** The `stake-docs` MCP server ([MCP_SETUP](../MCP_SETUP.md)) serves the same pages to Claude. The full integration rules are in [STAKE_ENGINE.md](../STAKE_ENGINE.md).

---

## 1. What Stake publishes (official)

### 1.1 How the rating is calculated

- **Three anonymous reviewers** each pick one value from a fixed scale: `0 · 0.33 · 0.67 · 1 · 1.33 · 1.67 · 2 · 2.33 · 2.67 · 3`.
- They judge "the game's **quality, creativity, and polish**".
- The three scores are **averaged**, then **rounded to the nearest whole star**.
- **An average below 1.0 means the game is not approved**, whatever the rounding (0.67 does not round up). The approval thread is closed and locked for **7 days**, and then you can resubmit. This has applied since 2026-03-17.

**What 3 stars takes in practice.** Every possible average is a multiple of 1/9. 22/9 = 2.44 rounds down to 2, and 23/9 = 2.56 rounds up to 3. So the three scores must add up to **at least 23 thirds out of 27**. **Across all three reviewers together, you can lose at most 4 thirds.** Combinations that still reach 3 stars:

| Reviewer A | B | C | Average | Stars |
|---|---|---|---|---|
| 3 | 3 | 2 | 2.67 | 3 |
| 3 | 2.67 | 2.33 | 2.67 | 3 |
| 2.67 | 2.67 | 2.33 | 2.56 | 3 |
| 3 | 3 | 1.67 | 2.56 | 3 |
| 2.67 | 2.33 | 2.33 | 2.44 | **2** |
| 3 | 2.33 | 2 | 2.44 | **2** |

**The consequence:** 3 stars needs at least 23 of the 27 thirds. A lukewarm reviewer at 2.0 (6 thirds) is survivable only if the other two add up to at least 17 thirds (3 + 3, or 3 + 2.67); two reviewers at 2.33 sink it whatever the third gives. **Design so that every reviewer gives at least 2.67.**

### 1.2 Tiers and what each one gets you (verbatim descriptions)

| Stars | Stake's description | Visibility |
|---|---|---|
| **3** | "Awarded only to **studio-quality** games showing **exceptional creativity, uniqueness, and attention to detail**." | "Optimal positioning": eligible for prominent display in **Burst Games**, **Stake Exclusives**, and the **featured** section of New Releases |
| 2 | "Games that show considerable creativity or originality. While they may lack polish compared to more established studios, they still demonstrate strong development quality and attention to detail." | Burst Games / Exclusives only if popularity drives it; New Releases placement "depends on space and demand" |
| 1 | "Games of lower polish that still meet publishing requirements." | "Always placed at the bottom of New Releases" |
| 0 | Average below 1.0 | Not published; thread locked 7 days |

**Category placement:** categories update weekly. Every game rated 1 star or more gets the New Release tag. Every game is re-ranked by performance every **Friday (Australian time)**. A new release sits at the bottom of New Releases until the first Friday after launch. So the rating decides your **starting position and promotion eligibility**, and player performance decides everything after that.

### 1.3 Rules that apply after release

- Once a game is approved, only **minor visual fixes** are allowed. No math changes, no new modes and no mechanic changes. **Finalise everything before you submit.**
- Stake can **disable a live game** for: bugs or crashes; math or payout discrepancies; **performance issues ("excessive load times, memory leaks, or rendering failures")**; and compliance problems. If that happens, the existing thread is reopened. Do not make a new submission.

---

## 2. Hard gates (fail one and the rating does not matter)

These come from the approval pages and `mockchecklist.json`. A miss here is a rejection or a bounce. The **Check** column says which repo tool or agent catches it ([AGENTS.md](AGENTS.md)).

### 2.1 Pre-checks and content

| Requirement | Check |
|---|---|
| Authenticates with the RGS on launch; the bet button sends a successful `play` | `pnpm qa:approval` (mock RGS); `qa-verifier` |
| **Unique title**: no "Megaways" or "Xways"; the IP is clean | `stake-compliance-auditor` (title search) + counsel |
| Original design. No web-sdk sample assets, no Stake™/Kick™ branding or themes, nothing licensed from third-party games | `pnpm licence:audit --release --strict`; `art-director` sign-off |
| **No child-like characters** and nothing likely to appeal to minors. Nothing offensive, explicit or in poor taste | `art-director` adult-proportion check (head ≤ ~¼ of height) + human sign-off |
| **Stateless.** No jackpots, gamble features, continuation or early cash-out. Each bet is independent | `math-engineer` + `stake-compliance-auditor` design review |

### 2.2 Math

| Requirement | Check |
|---|---|
| RTP **90.0–98.0%** | math-sdk `run.py` stats; `math-engineer` |
| **Every** mode (bonus buys, side bets, all of them) within **0.5%** of the base RTP | same |
| Advertised max win reachable: about 1 in 10M per the math page, at least 1 in 20M per the checklist. **Aim for better than 1 in 10M.** | same |
| Non-zero win hit rate about 1 in 3–8 for base, **never worse than 1 in 20** | same |
| 100k–1M simulations per mode; varied outcomes; no single result dominates; zero-weight payouts do not dominate | same |
| No gaps in the win distribution (intermediate wins exist between small and max) | same |
| Base-mode standard deviation within industry norms | same |
| Mode costs, max win and RTP in the rules match the math exactly | `stake-compliance-auditor` (rules vs `config_fe.json`) |

### 2.3 RGS, build and network

| Requirement | Check |
|---|---|
| Static files only. **No external requests** (fonts, CDNs, KTX2 transcoder defaults, analytics, hot-linked Higgsfield URLs) | `pnpm qa:approval` host allowlist + dist URL grep |
| Uses the `rgs_url` parameter; a changed `rgs_url` is honoured | `qa:approval`; `src/env` |
| **Zero console output**, no network errors, no game info logged | `qa:approval` |
| Every bet level from `authenticate` is reachable (USD 0.10–1,000, default 1; JPY 10–150,000, default 100; MXN 1–15,000, default 10). Steps follow `minStep` | `qa-verifier` with mock bet-level configs |
| **Reloading mid-spin keeps the selected bet** | `qa-verifier` resume test (`mock` active round) |
| English only is fine, but **other `lang` values must not corrupt text**. Currency and language combinations get tested | `qa-verifier` (`lang` sweep); no baked text anywhere |

### 2.4 Front end

| Requirement | Check |
|---|---|
| Rules: payout per symbol and combination, cluster sizes, **RTP, max win and cost per mode**, every special value, trigger and retrigger conditions, **disclaimer** | `stake-compliance-auditor` |
| UI guide that describes every button | same |
| Balance shown; bet changeable; the final win shown; **the win counter increments up to the final payout** | `qa-verifier` (book playback) |
| **Sound toggle**; **spacebar = bet**; autoplay needs **a confirmation step** | `qa:approval` + `qa-verifier` |
| **Confirmation for any mode costing more than 2×** | `qa-verifier` |
| Works on **Desktop, Mobile, Popout S/M** (7 viewports down to 400×225); the mini-player board is not distorted | `qa:approval` (7 viewports) + real phones |
| **Turbo / fast play**: wins, winning symbols and pop-ups stay legible | `animation-critic` on turbo captures |
| No visual bugs: no broken or missing assets or animations | `kit:check` symbol/BG coverage + `animation-critic` |
| 10 wins per mode checked against the rules | `qa-verifier` |

### 2.5 Jurisdiction (stake.us social mode)

The bet button does not say "bet". The rules contain no restricted words. The bet field is not labelled "bet amount". There is no "AutoBET". The bonus-buy label and its confirmation do not say BUY or BET. The insufficient-funds error is clean. **SC and GC are shown without `$`.** The replay window contains no restricted words. **Never bake text into art or video.** Check: `qa-verifier` social sweep (`&social=true&currency=XSC`) + `stake-compliance-auditor` string scan.

### 2.6 Replay (mandatory since 2025-11-09)

Loads and plays the event. Supports `currency`, `language` and `amount`. Can replay the event again at the end. Shows the bet cost with its multiplier and the real cost ("BONUS 1 USD, 250 USD REAL COST"). Check: `qa-verifier` replay URL per mode.

### 2.7 Game tile (ACP Tile Editor)

- Background **brighter than the Stake lobby, with no dark edges**.
- Foreground fills the key-focus box.
- **No text or multipliers** in either image.
- A light gradient taken from a tile colour, avoiding bright yellow, green or blue.
- Title inside the guide, at most 2 text sizes.

Check: `art-director` + `stake-compliance-auditor` (brightness of the edge 10% band vs the centre).

---

## 3. The 3-star scorecard (our rubric)

> **Not published by Stake.** Stake only says 3 stars means "studio-quality … exceptional creativity, uniqueness, and attention to detail", judged on "quality, creativity, and polish". The pillars below are our way of making that checkable. Treat them as a design target, not a guarantee.

Each reviewer scores **every pillar on Stake's own scale** (0 to 3 in thirds). The pillar scores roll up to one reviewer score: the **weighted mean, capped at the lowest pillar + 0.67**, because one weak area drags a real reviewer's impression down. Weights add up to 100.

| # | Pillar (weight) | What 3.0 looks like | What drops it to 2.0 or lower |
|---|---|---|---|
| **P1** | **Mechanic creativity** (15) | The mechanic has a name and a **signature moment** that is new on Stake (not just "cluster + multipliers"). A first-time player understands it within 3 spins. Base-game hit moments build toward the feature | A reskin of a stock mechanic; a feature that needs the rules to understand; a base game with nothing to watch for |
| **P2** | **World and art uniqueness** (15) | One coherent, ownable world: a style formula locked across symbols, board, background and characters. Hand-finished heroes (paintover). Silhouettes read at 64 px. Nothing looks "generic AI": no melted details, no symmetric clutter, no warped text | Mixed styles; AI tells; symbols that blur together at cell size; a board that looks like a template |
| **P3** | **Animation completeness** (15) | **Every** symbol, royals included, has `spin`, `land`, `miss`, `connect` and `explode` (plus `idle`, and `anticipation` on specials), and the **background reacts to every one of them** ([ANIMATION_STATES](ANIMATION_STATES.md)). There are no hard cuts between states | Static royals; the background is a wallpaper; states that snap or pop; one generic explosion for every symbol |
| **P4** | **Game feel** (15) | Physical, readable timing: squash 0.80–0.88 and settle ≤ 150 ms, a weighted drop, anticipation **only when the book qualifies**, hit-stop and shake within budget, and a tumble rhythm that speeds up. Turbo still feels designed | Floaty or stiff landings, uniform timing, constant shaking, long dead air, unskippable waits |
| **P5** | **Win and feature presentation** (10) | Wins escalate clearly: connection → count-up → tier punch → big-win tiers. The feature intro, upgrade and outro feel like events. Counters tick correctly. Taps skip cleanly | Flat win display; the same celebration for 2× and 500×; abrupt feature transitions |
| **P6** | **Audio** (10) | Unique, layered and mixed: per-symbol land weights, a pitch ladder on tumbles, a riser on anticipation, music stems that follow the state. Ducking under big moments. Mute works everywhere | Stock or sample sounds; one land sound for everything; music that ignores the game state; clipping |
| **P7** | **Smoothness and performance** (10) | A steady 60 fps (p95 frame < 16.7 ms) on a mid-range Android and an iPhone. First spin in ≤ 5 s on 4G. No hitch on a feature start (textures uploaded early). No memory growth over 500 spins | Hitches when a feature starts; jank on tumbles; long loading; frame drops in big wins |
| **P8** | **Attention to detail and UX** (10) | Pixel-clean at all 7 viewports and in the popout; legible in turbo; clear rules with every value; a polished replay screen; a bright, punchy tile; consistent copy; social-mode wording right | Clipped UI at 320×568; misaligned frame pieces; typos; a dark tile; rules missing values |

**Ship gate** (the one gate the whole kit uses: §4 step 6, WORKFLOW phase H, `/star-review`, scorecard.json): every internal reviewer's score (`reviewerScore`) is **at least 2.67** and **no pillar is below 2.33** for any reviewer (which also puts the Stake-formula average at 2.67 or more). That leaves one third of slack per reviewer for a stricter real one.

**Automatic caps** (any one of them caps that reviewer's score at 2.0, whatever the pillars say):
- a royal or any other symbol without the five core states;
- a static background (no state reactions);
- p95 frame time above 20 ms on the reference Android;
- any baked text in art or video;
- any approval gate in §2 failing.

The machine-readable copy is [`templates/scorecard.json`](templates/scorecard.json). The `star-rating-reviewer` agent fills it in.

---

## 4. Internal review protocol (run before every submission)

This mirrors Stake's own process: three independent reviewers, the same scale, the same formula.

1. **Freeze a candidate.** `pnpm build:<id>` succeeds, and every gate in `/verify-slot <id>` is green ([AGENTS.md](AGENTS.md#verification-loop)).
2. **Capture the evidence pack** (`qa/<id>/review/`):
   - `pnpm qa:review` at 60 fps for `spin`, `anticipation`, `clusterWin`, `tumbleChain`, `bigWin:mega`, `fsTrigger` and every game-specific scenario, in landscape **and** 390×844 portrait, at normal **and** turbo speed;
   - the `?dev=gallery` sheet of every symbol × state;
   - the background state sheet;
   - the tile render;
   - the rules screenshots;
   - the device perf traces.
3. **Run three blind reviewers.** `/star-review <id>` spawns `star-rating-reviewer` three times with different reviewer briefs: (A) a lobby player on a phone, (B) a slot-studio art director, (C) a Stake reviewer working from the checklist. They cannot see each other's output, and each fills in `scorecard.json`.
4. **Add at least one person.** A human plays 50 spins on a real phone and fills in the same scorecard. The judges see frames, not motion, and none of them can hear.
5. **Compute the result** with Stake's formula: average, then round, with the below-1.0 rule. Report each reviewer, the average, the predicted stars and the three weakest pillars.
6. **Gate** (the ship gate in §3): submit only when every internal reviewer's score (`reviewerScore`) is **at least 2.67** and **no pillar is below 2.33** for any reviewer (which also puts the Stake-formula average at 2.67 or more). Otherwise fix the weakest pillar first and repeat from step 1.

---

## 5. What usually costs the third star

Collected from the approval pages and from building Swamp Funk and Bass Drop:

- **Static or half-animated low symbols.** Reviewers watch the board, and royals fill half of it.
- **A wallpaper background.** A painted plate that never reacts reads as "template".
- **Generic AI art**: inconsistent outlines, mushy details, warped hands or text. Lock one style formula, paint over the heroes and run the art-bible gates.
- **Hitches on feature start or on the first big win** (shader compile or texture upload). Pre-warm with `renderer.prepare.upload` and `three.compileAsync`.
- **Overlong presentation**: unskippable intros and slow count-ups. Every tap must skip.
- **Fake near-misses.** Anticipation only when the book qualifies. Fabricated teases are a compliance and trust problem.
- **A dark tile** with dark edges, or text in the tile art.
- **Rules that do not match the math**: wrong max win, missing mode costs, missing special values.
- **Console noise or a CDN font** in production: an automatic bounce before anyone rates the game.
