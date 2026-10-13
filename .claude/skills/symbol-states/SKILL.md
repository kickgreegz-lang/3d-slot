---
name: symbol-states
description: Take one symbol from approved master to all five animated states (spin, land, miss, connect, explode, plus idle/anticipation where required) - parts, rig, validate, capture, blind critique, in-game check - and mark it done in animation-states.json. Use per symbol during art/animation production.
argument-hint: <game-id> <SYMBOL_ID>
---

Animate every state of symbol $ARGUMENTS (docs/new-slot/ANIMATION_STATES.md §6).

1. Preconditions: an approved rig-ready master in art/source/symbols/<ID>/ (else ask `art-director` / `higgsfield-artist`) and the acting brief in docs/games/<id>/ANIMATION_SET.md (else ask `game-designer`).
2. `symbol-animator`: parts.json (master cut), rig.yaml from docs/new-slot/templates/rig.symbol.yaml, then gen -> validate -> pack -> capture until the validator passes. The technique per state comes from docs/games/<id>/animation-states.json (premium/low miss is procedural; low land is procedural).
3. `animation-critic` (blind) on qa/sym_<ID>/spine/*: loop back to step 2 on any "major".
4. `vfx-engineer`: the explode material and colours for this symbol (FX payloads on `explode_burst`).
5. In game: register the rig in the game's art manifest, `pnpm qa:review --scenarios symbolLand:<ID>,symbolStates:<ID>,clusterWin,tumbleChain --out qa/sym_<ID>/game`, critique again.
6. `qa-verifier`: `pnpm spine:validate build/spine/sym_<ID>.json` + `pnpm kit:check <id>`; then set each finished state to "done" in animation-states.json.
