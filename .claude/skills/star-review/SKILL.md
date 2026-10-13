---
name: star-review
description: Predict the Stake Engine star rating the way Stake computes it - three blind reviewer agents score the evidence pack on the 0-3 scale in thirds, then average and round, with the below-1.0 rule - and list the fixes that raise it most. Use before submission and after each polish pass.
argument-hint: <game-id>
---

Predict the Stake rating for: $ARGUMENTS

1. Build the evidence pack in qa/<id>/review/ (docs/new-slot/STAKE_3_STAR.md §4): `pnpm build:<id>`, then with the dev server running capture at 60 fps `spin, anticipation, clusterWin, tumbleChain, bigWin:mega, fsTrigger` + the game's own scenarios in landscape and 390x844 portrait at normal and turbo (`pnpm qa:review ... --out qa/<id>/review`), the `?dev=gallery` sheet, the background state captures, the tile render, rules screenshots, and the latest perf report in qa/<id>/perf/.
2. Spawn `star-rating-reviewer` THREE times in one message with briefs A (lobby player on a phone), B (slot-studio art director), C (Stake reviewer with the approval checklist). Give each the same evidence paths; never share one reviewer's output with another.
3. Compute Stake's result: average the three reviewer scores, round to the nearest star; an average below 1.0 is a rejection (0 stars). Note that 3 stars needs >= 23/27 thirds in total.
4. Report: each reviewer's pillar scores, the average, the predicted stars, the three weakest pillars, and the merged top fixes with owners. Ship gate: every reviewer >= 2.67 average and no pillar < 2.33. Remind the user that one person must also play 50 spins on a real phone (the agents see frames, not motion, and cannot hear).
