# {{TITLE}}: game design and presentation spec

This is the binding spec for the front end and the brief for the math. **Fill it in during phase A** ([WORKFLOW](../../new-slot/WORKFLOW.md#phase-a-design-the-mechanic-and-the-world)), before writing any feature code or generating production art. Every `TODO` must be resolved, or moved to §14 with an owner, before phase B starts.

- **Game id:** `{{ID}}` (folder `src/games/{{ID}}/`, `GAME={{ID}}`)
- **Status:** draft
- **Owners:** `game-designer` (this file), `math-engineer` (§3, §4), `art-director` (§9), `environment-artist` (§10), `stake-compliance-auditor` (§13)

---

## 0. Pitch (≤ 5 lines)

- **Hook:** TODO. In one sentence: what the player hopes for on every spin.
- **Signature moment:** TODO. The 3-second clip that sells the game. This is the moment reviewers remember (3-star pillar P1).
- **World:** TODO. Setting, era, mood, two adjectives. Original IP, adult characters only.
- **Why it is new on Stake:** TODO. Name the closest existing games and say how this one differs.

## 1. Pillars (3, ranked)

1. TODO, e.g. "every connection visibly charges the feature"
2. TODO
3. TODO

## 2. Board and base mechanic

| Item | Value |
|---|---|
| Grid | TODO (reels × rows; the engine supports any cluster grid, e.g. 7×5 or 6×6) |
| Pay type | TODO: cluster ≥ N / ways / lines / scatter pays |
| Removal | TODO: tumble (exact Stake tumble rule) / none |
| Specials | TODO: Wild, Scatter, multiplier, collector, transformer … |
| New mechanic | TODO: rules in numbered steps, with every edge case (caps, resets, overlaps) |
| Book events it adds | TODO: event name + payload (math-sdk `events.py` style), e.g. `meterUpdate {value, thresholds}` |

**Readability check:** a first-time player must understand the mechanic within 3 spins without opening the rules. Say how the board teaches it: a counter, links, labels or a tutorial card.

## 3. Features and bet modes

| Mode | Cost | Contents | RTP target | Max win |
|---|---|---|---|---|
| BASE | 1× | TODO | TODO (90–98%) | TODO |
| TODO (e.g. BONUS buy) | TODO | TODO | within 0.5% of BASE | TODO |

- Trigger and retrigger conditions: TODO.
- **Bet modes cannot be added after approval.** Freeze this table before phase B.
- Every mode costing more than 2× needs a confirmation screen (approval rule).

## 4. Math contract (with `math-engineer`; details in MATH_BRIEF.md)

- RTP per mode, max win per mode, base hit rate (target 1 in 3–8), max-win hit rate (better than 1 in 10M), volatility label.
- **Stateless:** no jackpots, no gamble, no persistence between bets.
- Fixture books the front end needs from day one (`mock/games/{{ID}}/books/`): `loss`, `small_win`, `tumble_chain`, `anticipation_hit`, `anticipation_miss`, `feature_trigger`, `retrigger`, `big_win`, `mega_win`, `wincap`, plus one per new mechanic state.

## 5. Event contract (math → front end)

| Book event | Payload | Handler → scene events | Holds the round? |
|---|---|---|---|
| `reveal` | board, anticipation | `board:reveal` | yes (drop-in) |
| `winInfo` | wins | `board:showWins` | yes |
| `tumbleBoard` | explodingSymbols, newSymbols | `board:tumble` | yes |
| TODO new event | TODO | TODO new scene event(s) in `src/games/{{ID}}/events.ts` | TODO |

Resume and replay: how each new event folds into the snapshot (`foldGameEvent`, `restoreGameScene` in `book.ts`). Cosmetic randomness is seeded from the round id.

## 6. Round flow and states

Write a beat sheet for the base round and for each feature round, with timings at normal / turbo / super turbo (ms):

| Beat | Normal | Turbo | Super turbo | Skippable |
|---|---|---|---|---|
| fall-out | TODO | | | slam |
| drop-in + lands | TODO | | | slam |
| connect presentation | TODO | | | tap |
| explode + refill | TODO | | | slam |
| new mechanic beat | TODO | | | |

## 7. Symbol set

| Id | Name | Tier | Colour | Land weight | Silhouette (must differ from all others at 64 px) |
|---|---|---|---|---|---|
| H1 | TODO | premium | | heavy | |
| … | | | | | |
| L1–L5 | TODO | low | | light | |
| W | TODO | special | | special | |
| S | TODO | special | | special | |

Every symbol needs all five states (spin, land, miss, connect, explode); see ANIMATION_SET.md and `animation-states.json`.

## 8. Presentation of wins

Connection read (links, outlines, labels), tumble pitch ladder, count-up, the big-win tiers (`WIN_TIERS`), and what changes from tier to tier.

## 9. Art direction (with `art-director`)

- Style formula (verbatim, frozen once picked): TODO
- Environment formula: TODO
- Palette (5–7 swatches), outline rule, light direction: TODO
- Banned prompt words for this game: TODO
- Higgsfield batches: `docs/games/{{ID}}/hf/*.spec.json` ([HIGGSFIELD_PLAYBOOK](../../new-slot/HIGGSFIELD_PLAYBOOK.md))

## 10. Environment (with `environment-artist`)

- Looks: base, feature (and super feature?).
- Layers per look (depth 0..1), and the emissive layer.
- How each background state reads in **this** world: idle, spin, land, miss, connect, explode, anticipation, bigwin, feature ([ANIMATION_STATES §3](../../new-slot/ANIMATION_STATES.md#3-background-states)).

## 11. Layouts (4 design spaces)

Landscape 1920×1080, portrait 1080×1920, tablet 1920×1920, compact 960×540 (popouts, no heavy FX). Rects for any new board-side UI (meters, collectors) per space. Touch targets ≥ 44 CSS px at 320×568.

## 12. Audio

Cue list keyed by `SfxId` (new ids for the new mechanic), music stems per mode, ducking rules.

## 13. Compliance notes (with `stake-compliance-auditor`)

Social-mode wording for every new label, no baked text, the rules sections the new mechanic adds, replay behaviour, and jurisdiction flags (turbo, autoplay, slam-stop, buy feature).

## 14. Open decisions

| # | Decision | Options | Owner | Due |
|---|---|---|---|---|
| D-1 | TODO | | | |

## 15. Acceptance (what QA captures)

The scenarios to record (`pnpm qa:review --scenarios …`), the fixture book for each, and the numeric gates (ANIMATION_CONTRACT §9, PERFORMANCE.md budgets).
