---
name: new-slot
description: Start a new slot game in this engine - scaffold it, then run phase A (design, math brief, theme and style exploration) with the agent team and stop at the user's decisions. Use when the user wants to create a new game, a new mechanic or a new theme/world.
argument-hint: <game-id> "<Title>" [reference notes]
disable-model-invocation: true
---

Create and kick off the new game described by: $ARGUMENTS

Follow docs/new-slot/WORKFLOW.md. Concretely:

1. **Scaffold** (if src/games/<id>/ does not exist yet):
   `node tools/new-game/scaffold.mjs <id> --title "<Title>"`, then `pnpm typecheck`, `pnpm kit:check <id>` and `pnpm build:<id>`. Report failures with their output; do not continue past a failing typecheck.
2. **Phase A in parallel** (Agent tool, one message, several agents):
   - `game-designer`: fill docs/games/<id>/DESIGN.md from the brief and any references (mechanic in numbered steps, features, bet modes, event contract, beat sheets);
   - `math-engineer`: docs/games/<id>/MATH_BRIEF.md targets + the fixture book list;
   - `art-director`: 4 style directions + the x01 Higgsfield spec in docs/games/<id>/hf/x01.spec.json (references of other games are described in words, never uploaded).
3. **Verify the design** in parallel: `stake-compliance-auditor` on DESIGN.md + MATH_BRIEF.md, and `star-rating-reviewer` (brief C) on the concept alone (P1, P2 pillars). Apply the fixes, or list them as open decisions.
4. **Exploration art** (only with the user's credit go-ahead): `higgsfield-artist` runs x01 through the ledger route and shows the results.
5. **Stop** and give the user: the decisions to make (theme/direction, bet modes, max win, open questions), the cost so far, and the next phase. Do not start phase B before the user picks the direction and freezes the bet modes.
