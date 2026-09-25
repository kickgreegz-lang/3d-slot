# Swamp Funk: Bass Drop (`bass-drop`)

The second game in the Swamp Funk world: a 6×6 cluster tumble with a **Groove Meter**. Every 10 connected symbols drop Wilds from a speaker stack; 40 in one spin opens **Juke Jam** (8 free spins, multiplier wilds) and 60 opens **Mega Mix** (10 free spins, sticky wilds up to ×25).

| File | What it is |
|---|---|
| [DESIGN.md](DESIGN.md) | Binding game/presentation spec: mechanics, event contract, states, meter UX, bass-drop choreography, screens, layouts, mascots, audio, speed profiles, accessibility, Stake notes, QA acceptance |
| [ANIMATION_SET.md](ANIMATION_SET.md) | Every Spine rig, flipbook and code-drawn effect: parts, animations, frames, events, budgets, contract deltas |
| [layout.json](layout.json) | Machine-readable layout rects for the 4 design spaces, plus the intro and buy screens |
| [wireframes/](wireframes/) | SVG wireframes rendered from `layout.json` (`python3 docs/games/bass-drop/wireframes/render.py`) |

Reference timings from Dragonspire Frostfall are still to be captured (network blocked at writing time). DESIGN.md §22 has the protocol, and every value that needs it is tagged **[RM]**.
