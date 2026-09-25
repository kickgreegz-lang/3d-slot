# Swamp Funk — AAA animation-first slots for Stake Engine

One shared slot engine and one folder per game, with real-time 3D toon mascots, physics-driven
symbol landings and a fully AI-controllable art/animation pipeline. The front end is a static
Vite build per game that talks to the Stake Engine RGS; fixture books generated with the Stake
math-sdk drive everything until the certified math lands.

| Game (`GAME=`) | Folder | What it is |
|---|---|---|
| `swamp-funk` (default) | `src/games/swamp-funk/` | 7×5 cluster-pays tumble with heat-tier multiplier spots, scatter free spins |
| `bass-drop` | `src/games/bass-drop/` | **Swamp Funk: Bass Drop** — 6×6 cluster tumble with a Groove Meter: a Bass Drop of Wilds every 10 connected symbols, Juke Jam at 40, Mega Mix at 60 ([design](docs/games/bass-drop/README.md)) |

> "Swamp Funk" (gator bouncer + bullfrog DJ in a neon bayou juke joint) is a **placeholder theme**.
> Every symbol, colour and label lives in the game folder (`src/games/<game>/config.ts`, `i18n.ts`)
> and `art/bible/`; swapping themes is a data change.

## Quick start

```bash
pnpm install
pnpm dev                 # http://localhost:5173/  — Swamp Funk against the built-in mock RGS
pnpm dev:bass-drop       # the same for Bass Drop (any game: GAME=<id> pnpm dev)
pnpm lab                 # ?dev=lab     — animation lab: tune every timing live, scenarios, inspector
pnpm gallery             # ?dev=gallery — every symbol in every animation state (both: GAME=<id> works)
pnpm typecheck           # the engine against every game (tsconfig.json + tsconfig.bass-drop.json)
pnpm build               # typecheck + static build of Swamp Funk in dist/swamp-funk/
pnpm build:bass-drop     # ... of Bass Drop in dist/bass-drop/
pnpm build:all           # every game in src/games/ -> dist/<game>/ (upload the CONTENTS of dist/<game>/)
pnpm qa:approval         # Stake approval smoke test: 7 viewports, host allowlist, zero console
                         # (another game: GAME=bass-drop pnpm qa:approval)
```

Useful dev URL params: `&book=tumble_chain&bookMode=base` (force a fixture), `&tier=low`,
`&social=true&currency=XSC` (stake.us wording), `&jurisdiction=disabledTurbo,minimumRoundDuration:3000`,
replay: `?replay=true&game=g7x5&version=1&mode=BONUS&event=177&amount=1000000&currency=USD`.

## What's in the box

| Area | Where | Highlights |
|---|---|---|
| Core | `src/core`, `src/game`, `src/render` | one frame clock (GSAP + Spine + three + particles), hit-stop, deterministic stepping; typed scene/UI/HUD event contracts; WebGL2 layer stack; 4 responsive design spaces |
| Symbols | `src/symbols` | squash/stretch landing on a damped spring, jelly mesh deformation, shine/dissolve shaders, win/explode/anticipation, Spine 4.3 backend with physics kicks |
| Board | `src/board` | gravity drop-in, anticipation beams, cluster outlines, exact Stake tumble rule, heat-tier multiplier spots |
| Presentation | `src/present`, `src/fx` | pooled particles, trauma shake, shockwave/chromatic filters, big-win tiers, free-spins intro/outro |
| Mascots | `src/mascots` | three.js toon characters rendered into Pixi's WebGL context, constant-width outlines, procedural life layers |
| Flow / RGS | `src/flow`, `src/rgs`, `src/book`, `mock/` | Stake RGS client, book player, FSM, autoplay, replay, resume, all 12 jurisdiction flags, mock RGS |
| UI | `src/ui`, `src/i18n` | hex HUD, spin/skip button, dark-glass menus (paytable, rules, UI guide, settings), social-mode wording |
| Audio | `src/audio` | procedural placeholder SFX + funk groove, buses, ducking, voice limiting; manifest swaps in production files |
| Art | `src/assets`, `src/games/swamp-funk/scene` | manifest-first art with procedural cel-shaded placeholders, juke-joint background, frame + logo |
| QA | `src/dev`, `tools/capture`, `tools/qa` | animation lab, frame-exact capture, contact sheets, motion curves, approval checks |
| Pipeline | `tools/*`, `art/bible` | Spine rig generator/validator/packer, headless Blender toon renders + actions, matting, video keying, audio mastering, generation wrappers with provenance + licence audit |

## Multi-game layout

```
src/
  games/<id>/           one folder per game — the ONLY game-specific code
    meta.json           id, title (index.html <title>), mock RGS game id, localStorage prefix
    config.ts           GRID, SYMBOLS, WIN_TIERS, SPOT_BANDS, FEATURES, BET_MODES, ATTRACT,
                        DEV_FIXTURE_ALIASES (+ game data, e.g. Bass Drop GROOVE)
    layout.ts           LAYOUTS: landscape / portrait / tablet / compact LayoutSpecs (HUD anchors, optional
                        plate placement `present`) + game extras (Bass Drop meter / cabinet rects)
    modules.ts          createModules(ctx): the ordered visual modules
    book.ts             game book events + handlers (GameBookEvent, gameBookHandlers, fold/restore)
    events.ts           game scene events (GameSceneEvents) for its feature modules
    gameInfo.ts         paytable / rules facts (modes, specials, feature rule sections)
    i18n.ts             game copy merged over the engine strings
    art.ts              placeholder symbol builders + production ART_MANIFEST
  config/game.ts, config/layout.ts, ui/dom/gameInfo.ts
                        engine shims: generic types + helpers, `export * from '@game/...'`
  everything else       the engine (board, symbols, flow, rgs, present, fx, mascots, audio, ui, dev)
mock/games/<id>/        mock.json (bet modes) + books/ (fixtures; every file optional)
```

- `GAME=<id>` (default `swamp-funk`) selects the game at build time: Vite aliases `@game` to
  `src/games/<id>`, defines `__GAME_ID__`, sets the page title, serves `mock/games/<id>/` from the mock
  RGS and builds to `dist/<id>/`. TypeScript maps `@game` per config (`tsconfig.json` = swamp-funk,
  `tsconfig.bass-drop.json`).
- Engine code never imports `src/games/**` except through `@game/*` or the shims; a game may import
  engine modules and, when it shares a world, another game's modules (Bass Drop reuses Swamp Funk's
  scene and placeholder symbols).
- New game: copy a game folder, add `mock/games/<id>/`, a `tsconfig.<id>.json` (exclude the other game
  folders) and `dev:<id>` / `build:<id>` scripts; `pnpm build:all` picks it up automatically.

## Documentation

Start with **[docs/README.md](docs/README.md)**. The key documents:

- **[docs/STACK.md](docs/STACK.md)** — the recommended AI-controllable tool stack: what to buy, costs, install checklist, what still needs a human.
- **[docs/PIPELINE.md](docs/PIPELINE.md)** — the end-to-end production workflow, step by step.
- **[docs/ANIMATION_CONTRACT.md](docs/ANIMATION_CONTRACT.md)** — names, frames, events and feel constants the art must hit.
- **[docs/ART_BIBLE.md](docs/ART_BIBLE.md)** + `art/bible/prompts/` — the style lock and prompt templates (Higgsfield / Vertex / Scenario).
- **[docs/STAKE_ENGINE.md](docs/STAKE_ENGINE.md)** — RGS integration and approval checklist.
- **[docs/MCP_SETUP.md](docs/MCP_SETUP.md)** + `.mcp.json.example` — MCP servers for Claude Code.

## Licences

Fonts: SIL OFL / Apache 2.0 (`public/assets/fonts/licenses`). Placeholder 3D model: CC0
(`public/assets/characters/placeholder/LICENSE.txt`). Tool/model allow- and denylists: `licenses/`.
The Spine runtime requires a Spine Editor licence at integration time (see docs/STACK.md).
