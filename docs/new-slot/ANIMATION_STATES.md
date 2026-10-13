# Animation states: every symbol, the background, the board

The rule for a new game:
- **Every symbol, the low symbols included, has the five core states**: `spin`, `land`, `miss`, `connect`, `explode`.
- **The background reacts to the same moments**, plus anticipation, big win and feature.
- **Nothing is ever static.** A symbol or plate that does not react caps a reviewer at 2 stars ([STAKE_3_STAR §3](STAKE_3_STAR.md#3-the-3-star-scorecard-our-rubric)).

This page defines:
- each state;
- the **cheapest technique** that still looks AAA, per symbol tier;
- the budgets that keep it smooth on mobile;
- the engine hooks, and what still needs building.

Names, frame windows and events stay as in [ANIMATION_CONTRACT](../ANIMATION_CONTRACT.md); this page only adds what a new game needs on top. Per game, the coverage lives in `docs/games/<id>/animation-states.json` and is gated by `pnpm kit:check <id>` ([AGENTS](AGENTS.md#verification-loop)).

---

## 1. The five core symbol states

| State | When (scene event) | Contract name(s) | Window @30 fps | Must read as |
|---|---|---|---|---|
| **spin** | fall-out (`round:start`) and the gravity drop-in (`board:reveal`), while speed exceeds the blur threshold | `blur` (1–2 f, region swap to `<part>_blur`) + the runtime stretch along the fall | loops while falling | motion and weight, not a smear. A clean silhouette at turbo |
| **land** | contact with the cell (frame 0 = contact) | `land`, event `land_impact` on f0 | 9–15 f (300–500 ms) | **weight per symbol** (light / medium / heavy / special): squash sy 0.83–0.87, sx = 1/√sy, one rebound, settle ≤ 150 ms. Appendages overlap after contact |
| **miss** | the symbol is **not** part of any winning connection when wins show (`board:showWins`); for specials, an anticipation that ends without a trigger | procedural `SymbolView.setMiss` (`FEATURES.missState`, on in scaffolded games); Spine `miss` for specials (E5) | 180 ms in, held, 140 ms out | "not this time": a short deflate (sy ~0.94), a desaturate toward the dim tint, and a small sink. Never comic, never long |
| **connect** | the symbol is in a winning cluster (`board:showWins`) | `win` → `win_loop` (event `win_peak`) + glow texture + cluster outline / links | 18–27 f pop (≤ 900 ms), then a 30–60 f loop | an anticipation dip, a pop to ~125%, a settle at ~110%, a character beat at `win_peak`; the cluster reads as **one** connected shape |
| **explode** | the winners leave in a tumble (`board:tumble`; the Board emits `board:burst` at the burst frame) | `explode`, events `explode_burst` (f2–3) + `explode_done` | 9–18 f (300–600 ms) | it breaks into **its own** material (shards, splashes, petals, sparks) in its own colours, then a 100 ms hit-stop on the first burst. Ends at alpha 0 |

Plus, per tier: **idle** (an accent on 1–2 random premium or special symbols, never in unison) and **anticipation** (specials, only when the book's `reveal.anticipation` says so: never a fabricated near-miss).

### 1.1 Mechanic-specific symbols (tumble + board multipliers + dropping multipliers)

Games in the "board multiplier + dropping multiplier" family (the Sugar-Gates-like concept in [`docs/games/`](../games/)) add two animated families. Their states are planned in `animation-states.json` like any symbol.

**Multiplier symbol** (a blank-faced coin or gem; the ×value is **live text** on a slot):

| State | When | Notes |
|---|---|---|
| spin | as above | |
| land | contact | heavier than any premium: a slam with a dust ring |
| hold | stays through the tumble chain | slow glint plus the value pulsing. It does **not** explode with clusters |
| collect | end of the tumble sequence, when the sequence won | value pop → flight to the win display → sum → slam on the total |
| miss | sequence ended with no win | the coin dims and the value fades. No flight |

**Board multiplier spots** (cell tiles behind the symbols, `spots:update` / `spots:reset`):

| State | When | Notes |
|---|---|---|
| mark | first explosion on a cell | a soft ring imprint: the cell is "primed" |
| upgrade | each later explosion | the number rolls ×2 → ×4 → …, punch 1 → 1.3 → 1, tier colour change + one flash (≤ 3 flashes/s overall) |
| apply | a cluster wins over spots | spots under the cluster pulse in sync with the cluster's `win_peak` |
| reset | base spin start (free spins keep them) | quick fade; instant on `board:set` (resume / replay) |

---

## 2. Technique per tier (the "tech-stack combo")

The board shows 35 symbols (7×5) and up to 49 during a tumble. A Spine skeleton per symbol per state would blow the mobile budget, so each state uses the cheapest technique that still reads as hand-animated.

### 2.1 What each technique costs

| Technique | Engine path | Cost | Use for |
|---|---|---|---|
| **texture** | atlas sprite swap (`_blur`, `_glow`), batched | ~0 (1–3 draw calls for the whole board) | spin, static rest |
| **procedural** | `SymbolRig`: GSAP + damped springs + `JellyMesh` (pooled 10×10 MeshPlane) | low: CPU tweens, one mesh per animating symbol | land squash, miss deflate, royal pops |
| **shader** | `symbolFxShader` (shine, flash, dissolve in one draw, no render target) | low | connect shine, explode dissolve, miss desaturate |
| **spine** | pooled `spine-pixi-v8` instances (`SpinePool`, **≤ 24 active, 12 on the low tier**, 4 prewarmed per rig) | medium: skinning + physics per instance | land / connect / explode / idle of premium and special symbols; character beats |
| **flipbook** | baked Blender toon or AI-video frames → AssetPack `AnimatedSprite` (attached to a Spine slot with `addSlotObject`) | texture memory | true 3D turns, shatters, hero explosions |
| **particles** | pooled `ParticleContainer` emitter (**≤ 1,000 particles, 400 on the low tier**) | low per particle | debris, sparkles, coin showers, dust |
| **layered** | `LayeredEnvironment` (src/environment): plates + light layers driven by spring channels | one draw per layer, no filters | every background state |
| **video** | stacked-alpha H.264 loop (`pnpm video:stacked`) | decode + one texture | high-tier ambient background only |

### 2.2 Default matrix (what the scaffold writes into `animation-states.json`)

| State | Premium (H) | Special (W, S, multiplier) | Low (L1–L5) |
|---|---|---|---|
| spin | texture `_blur` + stretch | texture `_blur` | texture `_blur` |
| land | **spine** `land` (+ procedural fallback past the pool cap) | **spine** `land` + `land_special` FX | **procedural** squash spring + jelly mesh (one land weight per royal) |
| miss | **procedural** deflate + sink + dim (`FEATURES.missState`; never Spine: up to 30 losers at once) | **spine** `miss` (tease fail, shrug; E5), procedural until then | **procedural** |
| connect | **spine** `win` → `win_loop` + `_glow` + outline | **spine** | **spine (low kind)** `win` + shader shine |
| explode | **spine** `explode` + particles in the symbol's colours | **spine** + optional flipbook shatter | **spine (low kind)** `explode` + shards in the royal's colour |
| idle | **spine** `idle` accent | **spine** | none (shader glint once E3 lands) |
| anticipation | — | **spine** loop (+ intro / out) | — |

**Why low symbols use procedural lands.** All 35 cells land within about 1 s. With Spine on every royal, the pool cap (24 / 12) would be hit, and the overflow falls back to procedural. The board would then mix two land looks. A tuned procedural land is identical on every royal, and it already meets the feel gates (squash 0.854, one rebound to 1.059, settle ±2% in 150 ms).

**Why connect and explode can be Spine for low symbols.** Only the winners animate, and a cluster of 5–15 fits the pool.

### 2.3 Budgets (enforced or gated)

- Spine per symbol: ≤ 30 bones, ≤ 250 mesh vertices, ≤ 8 slots, ≤ 4 physics chains, no clipping (`pnpm spine:validate`).
- Low-kind rigs (E4): ≤ 12 bones, ≤ 120 vertices, ≤ 5 slots, ≤ 2 physics chains.
- Simultaneous Spine instances: ≤ 24 (12 on the low tier) at the worst frame of a big cascade.
- Live filters: ≤ 3 (1 on the low tier); particles ≤ 1,000 (400); flashes ≤ 3 per second.
- One symbol atlas page set at 2048 (with @0.5x); background plates loaded per orientation; a plate halved on the GPU when the screen shows it at ≤ 0.6 display px per texel (0.75 on the low tier).

---

## 3. Background states

The background reacts to the same moments as the board. In a new game, `LayeredEnvironment` (`src/environment/`) does this out of the box: [`tools/new-game/template/game/environment.ts`](../../tools/new-game/template/game/environment.ts) is the spec, and procedural placeholders show until the Higgsfield plates land. The state logic is `EnvironmentDirector` (pure, unit-tested by `pnpm test:kit`). Every number is in `ENV_TIMING`, lab section `environment`: tune it live in `?dev=lab` and export it from there.

| State | Trigger (scene event) | What moves | Default |
|---|---|---|---|
| idle | always | per-layer drift; a slow light breath | breath 0.07 over 4.6 s |
| spin | `round:start` | the scene leans in (zoom about the board centre, more on near layers) and the lights rise; **held** until the first land | zoom +1%, light +0.12 |
| land | one per column impact (the board's per-column land SFX: `land_*`, `tumble_drop`, `scatter_land_*`) | a parallax thump: near layers dip and spring back, weighted like the symbol | lift 4 px × weight (0.7–1.6) |
| miss | `round:end` with no win | the plates exhale (dim), then recover | dim 0.14 for 650 ms |
| connect | `board:showWins` | the light layers glow and **tint to the top winner's colour**, pulsing; **held** until the tumble | light 0.55, tint 1, pulse 2.2 Hz |
| explode | `board:burst` | a light flash + zoom punch + upward jolt, spaced ≥ 334 ms (≤ 3/s, IRIS) | light 0.6, zoom +1.6%, lift −6 px |
| anticipation | `board:reveal` with any `anticipation > 0` (book-driven only) | dim + slow push-in + heartbeat light in the anticipation colour; **held** until wins, the trigger or the round end | dim 0.28, zoom +2.4%, pulse 1.9 Hz |
| bigwin | `bigwin:show` | full light, pulsing in the big-win colour; **held** to the round end | light 0.85, pulse 2.4 Hz |
| feature | `fs:trigger`, then `mode:change` | a light kick in the feature colour, then the look crossfades to the feature plates (loaded at the trigger) | crossfade 1.4 s |

Rules:
- **Reduced motion** zeroes zoom, lift and drift; light stays.
- A **hit-stop freezes** the background with the board.
- Nothing uses a filter or a render target, so the background costs the same on a low-tier phone as a static plate.
- Optional extras sit on top: Spine `env_*` rigs (validator kind `env`), keyed ambient FX loops, and a high-tier video loop. Each listens to the same events or to `director.state`.

**Plates** come from Higgsfield ([HIGGSFIELD_PLAYBOOK §3.3](HIGGSFIELD_PLAYBOOK.md#33-background-from-one-plate-to-a-reactive-scene)): a 4k plate, split into 3–5 depth layers plus one emissive light layer, per look (base, feature).

---

## 4. Board, frame and screen

| Element | Reacts to | How |
|---|---|---|
| Board grid | land, explode, big drops | `board:thump` (9 Hz spring, ≤ 3 px dip), the Board's explode hit-stop + `fx:shake` budget |
| Frame | connect, explode, feature | emissive trim layer (light pulse in the winner's colour), sweep on the feature trigger |
| Spot tiles | mark / upgrade / apply / reset | §1.1 |
| Screen | big win, feature | `fx:flash` (limited to ≤ 3/s), trauma shake 6–14 px at the big-win tiers, zoom punch |

---

## 5. Engine deltas (build these in phase B; owner: `gameplay-engineer`)

These are what the runtime still lacks for the full state set. Each is a small, contained change. **Verify each one with `pnpm typecheck && pnpm test:kit`, `pnpm qa:review` captures, and both existing games still building.**

| Id | Delta | Where |
|---|---|---|
| **E1** | **Done (procedural part).** `SymbolView.setMiss`: the losers of `Board.showWins` deflate (sy −6%, sx +2.5%) toward their feet and sink 3 px on top of the win dim, then spring back with it (`SYMBOL_TIMING.miss`, lab section `symbol`). It is opt-in per game with `FEATURES.missState` (the scaffold turns it on; Swamp Funk and Bass Drop are unchanged). **Still to do:** play a rig's Spine `miss` for specials once E5 exists, and an optional desaturate in `symbolFxShader` | `src/symbols/SymbolRig.ts` (`setMiss`, `applyBody`), `src/board/Board.ts` (`dim(…, miss)`), `src/symbols/types.ts`, `src/symbols/symbolTiming.ts` (`miss`), `src/config/game.ts` (`GameFeatures.missState`) |
| **E2** | `board:land {reel, weight}` scene event per column impact, so the background, frame and feature modules stop reading SFX ids | `src/board/Board.ts:414-428` (per-column land SFX), `src/game/events.ts` |
| **E3** | Idle accents for low symbols when they have a rig or a glint (`Board.idleTick` skips royals) | `src/board/Board.ts:947-950` |
| **E4** | Low-kind Spine rigs for L1–L5: contract kind `low` (budgets in §2.3), `symbolKinds` L1–L5 → `low`, the spinegen kind whitelist, the validator kind lists, and the royal-only branches in `SymbolRig` only when there is no rig | `tools/spine/contract.json` (`kinds` :74, `symbolKinds` :86), `tools/spine/spinegen/rig.py:171-173`, `tools/spine/validate.mjs:118,121`, `src/symbols/SymbolRig.ts:406,443,661,1103`, the game's `SYMBOL_SPINE` |
| **E5** | Spine `miss` in the contract (`loop: false`, 6–12 f, required for `special`, ends on its held pose) + a spinegen builder | `tools/spine/contract.json` `animations`, `tools/spine/spinegen/motion.py` (`DEFAULTS` :23, `ORDER` :89, `BUILDERS` :436), `tools/spine/README.md`, the rig template's `x_miss` |
| **E6** | WebGL context loss: `webglcontextlost` → pause the clock and show a reload overlay; `restored` → re-upload. Today nothing handles it, and Stake can disable a game for "rendering failures" | `src/render/app.ts`, `src/main.ts` |
| **E7** | Read the AssetPack output at runtime (`Assets.init({ basePath: './assets/pack/', manifest })`, `@0.5x` on the low tier). The pack is built today but not loaded | `src/assets/loader.ts`, `tools/assets/assetpack.config.mjs` |
| **E8** | Pre-warm before features: `renderer.prepare.upload` of the feature look, the FX atlases and the big-win skeletons at the trigger, so the first feature frame never hitches | `src/environment/LayeredEnvironment.ts`, `src/present/*` |

Mechanic-specific deltas for the Sugar-Gates-like concept (dropping multiplier symbols with live values, the spot doubling rule, buy modes) are listed in its concept doc under `docs/games/`.

---

## 6. How a state gets made (per asset)

1. **Brief.** Write the acting brief in `docs/games/<id>/ANIMATION_SET.md`: what happens on `land_impact`, `win_peak` and `explode_burst`.
2. **Art.** Make the Higgsfield rig-ready master, then the master cut into parts ([HIGGSFIELD_PLAYBOOK §3.2](HIGGSFIELD_PLAYBOOK.md#32-symbols-from-master-to-animatable-parts)).
3. **Rig.** Write `rig.yaml` from [`templates/rig.symbol.yaml`](templates/rig.symbol.yaml), then run `pnpm spine:gen`, `spine:validate` and `spine:capture`.
4. **Critique.** Claude critiques the sheets, and a blind second judge reviews them ([AGENTS](AGENTS.md): `animation-critic`). Fix and repeat until no "major" issue remains.
5. **In game.** Register the rig in the game's art manifest, capture `pnpm qa:review --scenarios symbolLand:<ID>,symbolStates:<ID>`, and tune in `pnpm lab`.
6. **Track.** Flip the state's `status` to `done` in `animation-states.json`. `pnpm kit:check <id> --release` must pass before submission.
