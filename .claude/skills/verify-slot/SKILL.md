---
name: verify-slot
description: Full verification of a game - automated gates plus independent read-only agents (qa-verifier, stake-compliance-auditor, animation-critic, engine-reviewer) in parallel, merged into one READY / NOT READY report. Use before marking any phase done, before a commit that changes the game, and before submission.
argument-hint: <game-id> [--release]
---

Verify the game: $ARGUMENTS

1. Run the fast gates yourself first and stop early if they fail (paste the failing output):
   `pnpm typecheck && pnpm test:kit && pnpm kit:check <id>` (`--release` when asked) `&& pnpm build:<id>`.
2. Spawn in ONE message (they are independent and read-only):
   - `qa-verifier`: every gate in its checklist for <id> (approval smoke, captures, Spine validation, licence audit, resume/replay/social spot checks);
   - `stake-compliance-auditor`: the full approval checklist against the build and docs/games/<id>/;
   - `animation-critic`: the latest captures under qa/<id>/ (symbols, background, features, turbo);
   - `engine-reviewer`: the diff since the last verified commit (`git diff <base>...HEAD -- src tools`), if any.
3. Merge their reports into one table: gate / finding -> PASS, FAIL or UNVERIFIED, with evidence and owner agent for each fix. Deduplicate; when two agents disagree, re-check the evidence yourself.
4. Verdict: READY only if every gate passed and no "major" critique or high-severity review finding remains. Otherwise list the fixes in priority order. Never report a gate as passed that was not run.
