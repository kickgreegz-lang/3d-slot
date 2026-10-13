# The agent team

Fifteen Claude Code subagents (`.claude/agents/*.md`) and five skills (`.claude/skills/*/SKILL.md`) ship with the repo. Open the repo in Claude Code and they are available.

**Your main session is the producer:**
- it runs the skills;
- it spawns agents (independent ones in parallel, in one message);
- it merges their reports;
- it asks you only for decisions that are yours.

Subagents cannot spawn subagents, so orchestration always lives in the main session or in a skill.

## Roster

### Build team

| Agent | Owns | Typical hand-off |
|---|---|---|
| `game-designer` | the mechanic, features, bet modes, event contract, beat sheets → `docs/games/<id>/DESIGN.md` | → math-engineer (numbers), gameplay-engineer (deltas) |
| `math-engineer` | math-sdk rules, RTP split, odds, `MATH_BRIEF.md`, fixture books in `mock/games/<id>/books/` | → gameplay-engineer (events), stake-compliance-auditor |
| `art-director` | style + environment formulas, symbol briefs, readability and IP gates, tile, Higgsfield specs | → higgsfield-artist (paid runs), symbol-animator / environment-artist (approved masters) |
| `higgsfield-artist` | **every paid Higgsfield job**, through plan → generate → record → wait → record → ingest, under a credit cap | → art-director (verdicts) |
| `symbol-animator` | Spine rigs for every symbol state (rig.yaml → gen → validate → capture loop), `animation-states.json` | → animation-critic, gameplay-engineer (manifest registration) |
| `environment-artist` | BG plate layers, `environment.ts`, ENV_TIMING, feature looks, env rigs, frame reactions | → animation-critic, performance-engineer |
| `vfx-engineer` | per-symbol explode materials, particles, flights, flashes, shake, hit-stop budgets | → animation-critic, performance-engineer |
| `gameplay-engineer` | `src/games/<id>/`, new book and scene events, feature modules, engine deltas E1–E9 + the mechanic deltas | → engine-reviewer, qa-verifier |
| `audio-director` | cue sheet (SfxId), generation, mastering, manifest | → **a human listens** |
| `performance-engineer` | tiers, budgets, pre-warm, context loss, device traces | → qa-verifier |

### Verification team (read-only: no Write or Edit tools)

| Agent | Checks | When |
|---|---|---|
| `qa-verifier` | every automated gate: typecheck, `test:kit`, `kit:check`, `build:all`, approval smoke, captures, Spine validation, licence audit, plus resume/replay/social spot checks | after any change; before any "done" |
| `stake-compliance-auditor` | the whole official approval checklist + content/IP | end of phase A, each milestone, before submission |
| `animation-critic` | blind frame critique against the AAA rubric | after every rig, FX or background iteration |
| `engine-reviewer` | adversarial code review: correctness, other games, determinism, performance, Stake rules, contract drift | every engine or game-code diff |
| `star-rating-reviewer` | one anonymous Stake reviewer on the 0–3 scale in thirds (spawn ×3 with briefs A/B/C) | `/star-review` |

The verifiers report; they never fix. A builder fixes, and a verifier runs again. **Nothing is "done" until a verifier has run its gates and reported PASS with evidence.**

## Skills (slash commands)

| Skill | What it does |
|---|---|
| `/new-slot <id> "<Title>" [notes]` | scaffold → phase A in parallel (designer, math, art) → compliance + concept rating → optional exploration art → stops at your decisions |
| `/verify-slot <id> [--release]` | fast gates, then qa-verifier + stake-compliance-auditor + animation-critic + engine-reviewer in parallel → one READY / NOT READY report |
| `/star-review <id>` | evidence pack → three blind reviewers → Stake's formula (average, round, below 1.0 = rejected) → top fixes |
| `/hf-batch <spec> --max-credits <n>` | one paid Higgsfield batch through the ledger route, then art-director verdicts |
| `/symbol-states <id> <SYMBOL>` | one symbol from master to all five states, critiqued and gated |

`/new-slot` and `/hf-batch` only run when you type them (`disable-model-invocation`), because they create files or spend credits.

## Verification loop

```
 builder agent ──► change ──► fast gates (typecheck · test:kit · kit:check · build)
       ▲                              │ fail → back to builder with the output
       │                              ▼
       │            parallel read-only verifiers (qa-verifier · compliance · critic · engine-reviewer)
       │                              │
       └──── fixes (owner per finding) ◄── merged report ──► READY → commit / next phase
```

Rules the producer follows:
- Spawn independent agents **in one message** so they run in parallel.
- Give each one the game id, the exact paths and the question.
- When two agents disagree, re-check the evidence yourself.
- Report every gate truthfully: NOT RUN is a valid answer; "probably passes" is not.
- Paid generation needs your go-ahead and a cap. Submission is always a human step.

## Models

Every agent uses `model: inherit` (your session model). To spend more on judgment, set `model: fable` (or a full model id) on `animation-critic` and `star-rating-reviewer` for final passes. A cheaper model (`sonnet`) is fine for `higgsfield-artist`, whose work is procedural.
