# Swamp Funk — AAA animation-first slot for Stake Engine

A 7×5 cluster-pays tumble slot with multiplier spots, real-time 3D toon mascots, physics-driven
symbol landings and a fully AI-controllable art/animation pipeline. The front end is a static
Vite build that talks to the Stake Engine RGS; the math comes later (a 7×5 fixture set generated
with the Stake math-sdk drives everything today).

> "Swamp Funk" (gator bouncer + bullfrog DJ in a neon bayou juke joint) is a **placeholder theme**.
> Every symbol, colour and label lives in `src/config/game.ts` and `art/bible/`; swapping themes
> is a data change.

## Quick start

```bash
pnpm install
pnpm dev                 # http://localhost:5173/  — plays against the built-in mock RGS
pnpm lab                 # ?dev=lab     — animation lab: tune every timing live, scenarios, inspector
pnpm gallery             # ?dev=gallery — every symbol in every animation state
pnpm build               # typecheck + static build in dist/ (upload the CONTENTS of dist/)
pnpm qa:approval         # Stake approval smoke test: 7 viewports, host allowlist, zero console
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
| Art | `src/assets`, `src/scene` | manifest-first art with procedural cel-shaded placeholders, juke-joint background, frame + logo |
| QA | `src/dev`, `tools/capture`, `tools/qa` | animation lab, frame-exact capture, contact sheets, motion curves, approval checks |
| Pipeline | `tools/*`, `art/bible` | Spine rig generator/validator/packer, headless Blender toon renders + actions, matting, video keying, audio mastering, generation wrappers with provenance + licence audit |

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
