# New-slot kit

Everything needed to build **a new slot with a new mechanic in a new world** on this engine: AAA, animation-first, fluid on phones, aimed at a **3-star Stake Engine rating**. Higgsfield makes the images, plates and loops; Claude Code agents build and verify.

## Start here

```bash
pnpm install
pnpm new-game my-game --title "My Game"     # scaffold: game folder, mock RGS, tsconfig, scripts, docs
pnpm typecheck && pnpm test:kit             # every game + the kit's own tests
pnpm dev:my-game                            # runs at once: placeholder symbols + a reactive layered background
pnpm kit:check my-game                      # wiring, docs, symbol + background state coverage
```

Then, in Claude Code, opened at the repo root:

```
/new-slot my-game "My Game" <pitch, reference notes>   # phase A with the agent team, stops at your decisions
/verify-slot my-game                                   # all gates + 4 read-only verifiers in parallel
/star-review my-game                                   # 3 blind reviewers, Stake's own formula
```

## The documents

| Doc | What it answers |
|---|---|
| [WORKFLOW.md](WORKFLOW.md) | The full path, phase by phase: owner agent, commands, outputs, gates, your decision points |
| [TECH_STACK.md](TECH_STACK.md) | The runtime "combo" (Pixi 8 + Spine 4.3 + GSAP one clock + springs + shaders + layered environment + optional three.js) and the production pipeline, with pinned versions |
| [ANIMATION_STATES.md](ANIMATION_STATES.md) | spin, land, miss, connect and explode for **every** symbol, the 9 background states, the board, the cheapest technique per tier, budgets, engine deltas E1–E9 |
| [PERFORMANCE.md](PERFORMANCE.md) | Mobile targets (p95 < 16.7 ms), tiers, rules per layer, how to measure, known gaps |
| [HIGGSFIELD_PLAYBOOK.md](HIGGSFIELD_PLAYBOOK.md) | Which Higgsfield model for which asset, the paid-job ledger route, the asset list and credits, prompt rules |
| [STAKE_3_STAR.md](STAKE_3_STAR.md) | Stake's official rating process and tiers, every approval gate mapped to a repo check, our 3-star scorecard, the internal review protocol |
| [AGENTS.md](AGENTS.md) | The 15 agents (10 build, 5 read-only verification) and 5 skills, the hand-offs, the verification loop |
| [templates/](templates/) | DESIGN, ANIMATION_SET, MATH_BRIEF, scorecard, Higgsfield batch spec, symbol rig.yaml |

## What is in the repo for it

| Path | What |
|---|---|
| `src/environment/` | **LayeredEnvironment** + **EnvironmentDirector**: the opt-in background module that plays every background state (unit-tested) |
| `tools/new-game/` | `scaffold.mjs` (`pnpm new-game`, `--remove` to undo), `kit-check.mjs` (`pnpm kit:check`, `--release`, `--init-states`), `lib.mjs`, `template/`, `test/` (`pnpm test:kit`) |
| `tools/build/all.mjs` | `pnpm build:all`: typecheck + build every game into `dist/<id>/` |
| `.claude/agents/`, `.claude/skills/`, `.claude/settings.json` | the agent team, the slash commands, and safe-command permissions. Every credit-spending Higgsfield tool is an `ask` rule under the three names the connector goes by (`Higgsfield` in cloud sessions, `claude_ai_Higgsfield` for the claude.ai connector in the local CLI, `higgsfield` for a hand-added server). If yours differs (`/mcp` shows it), add the same rules for that name |
| `.github/workflows/qa.yml` → `new-game-kit` | CI scaffolds a probe game on every push: unit tests, typecheck, kit gates, build, approval smoke |

## Worked example

The first game through the kit is a **Sugar-Gates-style** concept: a 7×5 cluster tumble where every connection raises a board multiplier and multiplier symbols drop, with no mascot, in a new world. Its theme options, Higgsfield board mockups and mechanics spec are in [`docs/games/`](../games/) (the concept folder).
