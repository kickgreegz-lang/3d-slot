# {{TITLE}}: animation set

Every animated asset in the game: symbols, background, board, FX, and UI the game adds. The machine-readable coverage lives in [`animation-states.json`](animation-states.json) and is checked by `pnpm kit:check {{ID}}`. This file holds the **acting brief and the numbers**.

Rules: [ANIMATION_STATES](../../new-slot/ANIMATION_STATES.md) (states, techniques, budgets) and [ANIMATION_CONTRACT](../../ANIMATION_CONTRACT.md) (names, frame windows, events, Spine rules). Everything is authored at 30 fps on the 360×360 @2x symbol canvas.

---

## 1. Symbol states (all symbols)

| Id | spin | land | miss | connect | explode | idle | anticipation |
|---|---|---|---|---|---|---|---|
| H1 | `_blur` swap | Spine `land` (12 f, sy 0.85) | procedural deflate | Spine `win` (24 f) → `win_loop` | Spine `explode` (15 f, burst f2) + shards | Spine `idle` (90 f) | — |
| … | | | | | | | |
| W | | | Spine `miss` (shrug) | | | | Spine `anticipation` |
| S | | | Spine `miss` (tease fail) | | | | Spine `anticipation` |
| L1–L5 | `_blur` swap | procedural (light) | procedural | low-kind `win` | low-kind `explode` + colour shards | — | — |

### 1.x Per-symbol acting brief (one block per symbol)

**H1 — TODO name**
- Parts and bones (≤ 30 bones, ≤ 250 mesh vertices, ≤ 8 slots): TODO
- `land`: TODO. What overlaps after the contact frame (antennae, tail, cape)?
- `connect` (`win`): TODO. The pop and the character beat at `win_peak`.
- `explode`: TODO. What it breaks into, the colours, `explode_burst` on frame 2–3.
- `miss`: TODO (premium tier: procedural; no rig needed).
- Physics chains: TODO (preset `default` 3.5 Hz ζ 0.25 unless noted).

## 2. Background states

| State | Trigger | What this world does | Layers involved | Technique |
|---|---|---|---|---|
| idle | always | TODO (e.g. lanterns sway, embers drift) | lights, fog | drift + breath (LayeredEnvironment) |
| spin | `round:start` | TODO | all | zoom hold |
| land | per column impact | TODO | near layers most | lift kick |
| miss | dead spin | TODO | plates | dim hold |
| connect | `board:showWins` | TODO, in the winner's colour | lights | light + tint hold, pulse |
| explode | `board:burst` | TODO | all | light + zoom kick |
| anticipation | book-qualified reveal | TODO | all | dim + push-in + heartbeat |
| bigwin | `bigwin:show` | TODO | all | light hold + pulse |
| feature | `fs:trigger` → `mode:change` | TODO (look crossfade) | look swap | crossfade |

Optional Spine env rigs (kind `env`) and FX that sit in the background: TODO.

## 3. Board (frame, panel)

Frame reactions on connect, explode and feature (an emissive trim layer, or a light sweep), and how the board pieces are sliced per layout.

## 4. FX library

| FX id | Look | Trigger | Budget (particles, filter) |
|---|---|---|---|
| `fx_explode` | TODO, per-symbol colours | `explode_burst` | ≤ 24 debris per symbol |
| TODO | | | |

## 5. Feature and UI skeletons the game adds

The new mechanic's UI (meter, collector, counter): clips, events, frame windows. **No baked text**: text slots are runtime BitmapText.

## 6. Budgets and pooling

Simultaneous Spine instances in the worst frame (≤ 24 high tier, ≤ 12 low tier), particles (≤ 1,000 / 400), live filters (≤ 3 / 1), texture memory per bundle. Show the worst-case frame for this design.
