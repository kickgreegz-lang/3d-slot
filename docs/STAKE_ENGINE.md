# Stake Engine: front-end integration and approval checklist

This page summarises what the front-end must do to integrate with Stake Engine's Remote Game Server (RGS) and pass approval. It is condensed from research round 1 (`stake-engine` brief and critic; see [research/frontend-decisions.md](research/frontend-decisions.md)).

**Primary sources:**
- the official docs repo: [github.com/StakeEngine/docs](https://github.com/StakeEngine/docs) (paths below are `src/routes/docs/...` in that repo);
- StakeEngine `web-sdk`, `math-sdk` and `ts-client`.

stake-engine.com itself was unreachable from the research sandbox. **Re-check the live docs before submission.** The easiest way is the official docs MCP (see [MCP_SETUP](MCP_SETUP.md)).

Related: [STACK](STACK.md) · [PIPELINE § phase 8](PIPELINE.md#phase-8--qa-packaging-release) · [ART_BIBLE](ART_BIBLE.md).

---

## 0. The short list (what reviewers will hit first)

- [ ] **Static build** with relative URLs, uploaded from the *contents* of `dist/`, served under a sub-path.
- [ ] **Zero requests** to any host except the page origin and `https://{rgs_url}`. No Google Fonts, analytics or CDN transcoders.
- [ ] **Zero console output** and no network errors in production.
- [ ] Works at **7 viewports**, down to a 400×225 popout.
- [ ] **Replay mode** (`replay=true`): no session calls, a start button showing the real cost, full playback, Play Again.
- [ ] **Resume** of an active round after a reload, keeping the bet.
- [ ] **End-round policy** correct: rounds never left active, and balance never shown before the animation.
- [ ] **All RGS bet levels** usable, spacebar = bet, sound toggle, autoplay confirmation, confirmation for any mode costing more than 2×.
- [ ] **Win counter increments up to the final win.**
- [ ] **Social mode** (stake.us): restricted words replaced everywhere, including images; GC/SC shown without `$`.
- [ ] **Rules/paytable**: RTP, max win and cost per mode, every payout, feature triggers, disclaimer.
- [ ] **Unique, original assets.** No web-sdk samples, no Stake/Kick branding, **no child-like characters**.
- [ ] **Jurisdiction flags enforced.** The web-sdk stores them but enforces none.

Automated in this repo: `tools/qa/approval.mjs` (dist URL grep, the 7 viewports, request-host allowlist, zero console/pageerror/failed requests) and `mock/rgsMockPlugin.ts` + `mock/books/*` (a local RGS with 7x5 fixture books).

---

## 1. Build and upload

- **Any static stack is fine.** The docs call Stake Engine "frontend-agnostic" and list Three.js and pure PixiJS (`architecture/frontend-stack/+page.svx`).
- **Output:** `base: './'`; upload the **contents** of `dist/` so `index.html` is at the root (math-sdk `simple_example`).
- **Launch URL:** `https://{team}.live.stake-engine.com/{game}/v{version}/?…`. The game lives under a sub-path, so absolute `/assets/...` URLs break.
- **Strict XSS policy:**
  - "The game build must consist only of static files and cannot reach external sources." (`approval/rgs-requirements`)
  - "All images and fonts must be loaded from the Stake Engine CDN." (`approval/frontend-requirements`)
  - Traps: the web-sdk `app.html` Typekit link, its S3 image constants, Google Fonts, Sentry, hot-linked Higgsfield/vendor URLs, and the **Pixi/three KTX2/Basis transcoder defaults, which point at a public CDN**. Self-host the transcoders or ship no KTX2.
- **Console silence.** "Check the network tab to ensure no errors or game information is being logged."
  - Tested on Vite 8.3: `build.rolldownOptions.output.minify = {compress:{dropConsole:true, dropDebugger:true}, mangle:true}` leaves zero `console` calls.
  - `esbuild.drop` is **silently ignored** in Vite 8.
  - Also do not ship the `stake-engine` npm client, which logs its version.
- **Upload size:** no documented limit. The web-sdk samples are about 54 MB each; treat size as a load-time and quality concern.

## 2. Launch URL parameters (`reference/url-structure`)

| Param | Meaning |
|---|---|
| `sessionID` | Required. The only credential (sent in request bodies). |
| `rgs_url` | Required. A **hostname without scheme**; the base is `https://${rgs_url}`. Never hardcode it: the checklist tests that a changed `rgs_url` is honoured. In local dev only, `http://` for localhost. |
| `lang` | ISO 639-1. Map `br`→`pt`; accept Polish as both `po` and `pl`; default `en`. |
| `currency` | See §9. |
| `device` | `desktop` or `mobile`. A hint only; layout follows the real canvas. |
| `social` | `true` on stake.us → social mode (§8). |
| `demo` | `true` = no real balance affected. |
| Replay | `replay=true`, `game`, `version`, `mode`, `event`, optional `amount` (raw API units), `currency`, `lang`, `device`, `social`. |

Local dev against the mock: `http://localhost:5173/?sessionID=dev&rgs_url=localhost:5173/__rgs&lang=en&currency=USD&device=desktop` (add `&replay=true&game=g7x5&version=1&mode=base&event=549` for replay).

## 3. RGS API (`docs/api/*`)

All calls are `POST`, JSON, with no auth headers. `sessionID` goes in the body.

| Endpoint | Body | 200 response |
|---|---|---|
| `/wallet/authenticate` (call first; otherwise everything returns `ERR_IS`) | `{sessionID, language?}` | `{balance:{amount,currency}, config:{gameID, minBet, maxBet, stepBet, defaultBetLevel, betLevels[], betModes, jurisdiction{…}}, round: Round\|null}` |
| `/wallet/play` | `{sessionID, amount /* BASE bet, API units */, mode, currency}` (debit = amount × mode cost) | `{balance, round}` |
| `/wallet/end-round` | `{sessionID}` | `{balance}` |
| `/wallet/balance` | `{sessionID}` (the ts-client polls every 60 s while idle) | `{balance}` |
| `/bet/event` | `{sessionID, event: "<index>"}` | `{event}` |
| `GET /bet/replay/{game}/{version}/{mode}/{event}` | no session | `{payoutMultiplier, costMultiplier, state}` |

- **Round object:** `{betID, amount, payout, payoutMultiplier (float), costMultiplier?, active, mode, event, state}`. `state` **is** the book's `events` array. Read the round id from both `betID` (real responses) and `roundID` (OpenAPI).
- **Errors:** `{error, message}`.
  - 400: `ERR_VAL`, `ERR_IPB` (insufficient balance), `ERR_IS` (invalid session; 401 in examples), `ERR_ATE`, `ERR_GLE` (gambling limits), `ERR_LOC`.
  - 500: `ERR_GEN`, `ERR_MAINTENANCE`.
  - Replay 404: `NOT_FOUND`.
  - Throw on `data.error` and on an empty `round.state`. Show a blocking error modal whose wording is social-safe.

## 4. Money: three scales (`architecture/how-rgs-works`, web-sdk `amount.ts`)

| Where | Scale | Example |
|---|---|---|
| RGS API amounts | integer × **1,000,000** | `1000000` = $1.00 |
| Book event amounts (`setWin`, `winInfo.win`, `finalWin`, …) | bet multiple × **100** | `130` = 1.3× the base bet |
| RGS `round.payoutMultiplier` | float | `2.5` |

Do currency math in integers: `winRaw = betRaw * bookAmount / 100`. The repo encodes this as `BOOK_AMOUNT_SCALE` and `API_MONEY_SCALE` in `src/config/game.ts`.

## 5. Books and events (math-sdk `events.py`, web-sdk cluster sample)

- **Padding convention (7x5):**
  - `reveal.board` is `[reel][row]` with **7 rows** (row 0 and row 6 are off-screen padding).
  - `winInfo.positions`, `tumbleBoard.explodingSymbols` and `freeSpinTrigger.positions` use **padded** rows.
  - `updateGrid.gridMultipliers` is **unpadded** 7×5.

  Mixing them up causes off-by-one explosions.
- **Event vocabulary:** `reveal`, `winInfo`, `updateTumbleWin`, `tumbleBoard`, `updateGrid`, `setWin {amount, winLevel 1..10}`, `setTotalWin`, `freeSpinTrigger`, `freeSpinRetrigger`, `updateFreeSpin`, `updateGlobalMult`, `freeSpinEnd`, `finalWin`, `wincap`.
- **Per free spin**, the observed order is:
  1. `updateFreeSpin`
  2. `reveal`
  3. `updateGrid`
  4. repeated `[winInfo, updateTumbleWin, updateGrid, tumbleBoard]`
  5. `setWin`
  6. `setTotalWin`
- **Spot animations** fire on the `updateGrid` that follows `winInfo`, while the exploding symbols are still visible. Animate only cells whose value changed.
- **Unit drift:** `winWithoutMult` is a float in old sample books but int ×100 in the current math-sdk. Derive labels from `win` instead.
- **Architecture to mirror:**
  - a sequential book player (for-await over handlers);
  - an emitter whose `broadcastAsync` = `Promise.all` of subscriber promises;
  - a flow state machine.

  This repo does exactly that (`src/book/*`, `src/core/emitter.ts`, `src/flow/*`).

## 6. Round lifecycle: end-round, resume, `/bet/event` (`faq/rgs/when-to-call-end-round`)

| Case | What to do |
|---|---|
| Payout 0 | The RGS auto-completes the round. Do not call end-round. |
| Win with a **single** reveal | Call `end-round` right after `play`. **Hold the returned balance** until the animation ends. |
| Win with **multiple** reveals (bonus) | `POST /bet/event` with `"${index}"` on every reveal; call `end-round` **after** the animation. |
| `authenticate` returns `round.active === true` | Resume: rebuild a snapshot from `updateGlobalMult` / `freeSpinTrigger` / `updateFreeSpin` / `setTotalWin`, play from `round.event`, then `end-round`. Restore the bet level and mode from `round.amount` / `round.mode` ("Refreshing mid-spin should preserve the bet amount"). |

## 7. Replay (mandatory since 2025-11-09; `api/bet-replay`)

- **Setup:** detect `replay=true` and make **no** authenticate, balance or play calls. Call `GET /bet/replay/...` with a loader showing.
- **Start button:** shows mode, base bet, cost multiplier, currency and **real amount spent** (base × cost), e.g. "BONUS 1 USD, 250 USD REAL COST". If `amount`/`currency` are missing, default to **1 USD** (or **1 SC** in social mode).
- **Playback:** the full animation with sound. Then show cost, multiplier and win, and offer **Play Again**.
- **Hidden during replay:** balance, bet controls and autoplay. There is **no path into real play**.
- **Errors:** handle 404 with a message.
- **Deterministic cosmetics:** seed cosmetic randomness (coins, particles) from the round/event id, so a replay looks identical.
- **For reviewers:** prepare event ids per mode covering a normal win, a big win, the wincap, a loss and a bonus trigger.

## 8. Jurisdiction flags and social mode

**Flags** (`config.jurisdiction`; the authenticate page says "Do not used. Ignore." but other pages document them, so implement them defensively; defaults are false/0):

| Flag | Front-end behaviour |
|---|---|
| `socialCasino` | Social mode (together with `social=true`) |
| `disabledFullscreen`, `disabledTurbo`, `disabledSuperTurbo`, `disabledAutoplay`, `disabledSlamstop`, `disabledSpacebar`, `disabledBuyFeature` | Hide or disable that control. With slam-stop disabled, taps cannot skip. |
| `displayNetPosition`, `displayRTP`, `displaySessionTimer` | Show that widget |
| `minimumRoundDuration` (ms) | Hold the next play until `elapsed ≥ value` |

**Social mode (stake.us, `reference/social-mode`):**
- Always use English with replacements, whatever `lang` says.
- The replacements apply to **rules, UI and images**, so never bake BUY/BET/PAY/`$` into art.
- A sample of the table: bet→play · bets→plays · betting→playing · bonus buy→bonus/feature · buy→play · buy bonus→get bonus · cash/money/credit→coins · currency→token · deposit→get coins · gamble/wager→play · loss limit→stop limit · paid/paid out/pays out→won · pay→win · pay table→win table · purchase→play · rebet→respin · stake→play amount · total bet→total play · withdraw→redeem.
- Use the full table from the docs in `src/i18n` (`en-social`).
- The checklist also requires: the bet button never says "bet"; autoplay is not "AutoBET"; the bonus-buy label has no "BUY"; the insufficient-funds error is clean; GC/SC are shown as `10.00 GC` with no `$`.

## 9. Currencies and languages

- **Currencies:** 36, table-driven (USD `$` 2dp, JPY `¥` 0dp, KRW `₩` 0dp, DKK `KR` after, …). XGC/XSC display as `GC`/`SC` after the amount. Unknown codes render as `{amount} {CODE}` with 2dp.
- **Doc conflicts:** XGC and NGN decimals, and PEN symbol position, differ between the docs and ts-client. Follow the docs.
- **Bet levels:** test ranges are USD $0.10–$1,000 (default $1), JPY ¥10–¥150,000 (default ¥100) and MXN 1–15,000 (default 10). **Every** level returned by authenticate must be reachable; the +/- buttons step through all of them.
- **Languages:** only `en` is required. Other `lang` values must fall back cleanly without corrupting text. Supported codes: ar, zh, en, fi, fr, de, hi, id, ja, ko, pt, ru, es, tr, vi, plus po/pl. **Stake tests currency/language combinations, so no text may be baked into art or video.**

## 10. Viewports and layout (`reference/dimensions`)

Required: **1200×675, 1024×576, 800×450 (Popout L), 400×225 (Popout S), 425×812, 375×667, 320×568.** The checklist covers Desktop, Mobile and Popout S/M.

- The repo uses four design spaces (`src/config/layout.ts`): landscape 1920×1080, portrait 1080×1920, tablet 1920×1920, and **compact 960×540** for popouts and small landscape.
- In compact, **3D mascots are off** and the HUD collapses to a right column, so popups stay legible.
- Touch targets are ≥ 150 design px in portrait (44 CSS px at 320×568).

## 11. Required UI and rules content (`approval/frontend-requirements`, `static/mockchecklist.json`)

**Controls:**
- spin (**spacebar** = bet);
- bet −/+ plus a bet menu covering **all** levels;
- balance, and a win display that **increments up to the final win**;
- **autoplay with a confirmation step** (never one click); the web-sdk offers 10/25/50/75/100/250/500/1000/∞ rounds with loss and single-win limits;
- turbo;
- **sound toggle**;
- menu and interface guide describing every button;
- **confirmation for any mode costing more than 2×**;
- error modal.

**Rules / info:**
- payout per symbol and per cluster size;
- RTP, max win and cost for **each** mode;
- all special-symbol and multiplier values;
- free-spin trigger and retrigger conditions;
- **the disclaimer**.

**Fast-play:** wins and popups stay legible at turbo speed.

**Disclaimer template** (`approval/disclaimer`). Custom wording must still cover the same points:

> Malfunction voids all wins and plays. A consistent internet connection is required. In the event of a disconnection, reload the game to finish any uncompleted rounds. The expected return is calculated over many plays. The game display is not representative of any physical device and is for illustrative purposes only. Winnings are settled according to the amount received from the Remote Game Server and not from events within the web browser. TM and © 2025 Stake Engine.

## 12. Content, math and quality rules (`approval/+page.svx`, `approval/quality`, `approval/math-requirements`)

- **Originality:** the game must be original; the title must be unique and avoid "Megaways"/"Xways"; no Stake™/Kick™ branding or themes; nothing offensive.
- **No underage appeal:** "Games that promote, encourage, or are likely to appeal to underage persons are not permitted. This includes artistic depictions of children or child-like characters in any gambling context." **This is why the mascots are adult-proportioned.**
- **Unique audio and visual assets.** web-sdk sample backgrounds, symbols and animations will not be approved.
- **Stateless games only:** no jackpots, gamble features, continuation or early cash-out.
- **Math:**
  - RTP 90–98%, with all modes within 0.5% of each other;
  - max-win hit rate at least 1 in 20,000,000 per the checklist (the math page says about 1 in 10M);
  - base hit rate typically 1 in 3–8, never worse than 1 in 20.
- **Quality rating:** 3 anonymous reviewers on a 0–3 scale in thirds. An average below 1.0 is a rejection plus a 7-day lock. A 3-star rating gets featured placement.
- **After approval** only minor visual fixes are allowed: no math changes, no new modes, no mechanic changes. **Finalise every bet mode before submitting.**

## 13. Game tile (`approval/game-tile`)

- Built in the ACP Tile Editor from a background (PNG/JPG), a foreground (transparent PNG), a gradient and a title layer.
- The background must be **brighter than the Stake lobby, with no dark edges**. Our dark neon club therefore needs a dedicated bright variant.
- The foreground fills the key-focus box; we render it from the real mascot GLBs at 2048 px.
- **No text or multipliers** in either image.
- The provider logo goes in Team Settings → Branding.

See [ART_BIBLE § 8](ART_BIBLE.md#game-tile-acp-tile-editor).

## 14. Submission

- Upload through ACP → game → Files → import folder → Publish Game → Front End.
- Test through Developer → Start game session → Launch in New Tab.
- Submission is a human step, optionally assisted by a browser agent. It is **not verified as scriptable**.
- Before submitting:
  1. Run `tools/qa/approval.mjs` against `vite preview`.
  2. Test on real phones.
  3. Run the IRIS photosensitivity report on the big-win, feature and anticipation captures (see [PIPELINE phase 8](PIPELINE.md#phase-8--qa-packaging-release)).
