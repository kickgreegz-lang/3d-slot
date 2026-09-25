# Research record (provenance)

This folder holds **reference copies** of the research behind the stack and the front-end architecture. The maintained, decision-ready docs are one level up: [STACK](../STACK.md), [PIPELINE](../PIPELINE.md), [ANIMATION_CONTRACT](../ANIMATION_CONTRACT.md), [ART_BIBLE](../ART_BIBLE.md) and [STAKE_ENGINE](../STAKE_ENGINE.md). When they disagree with these copies, the maintained docs win, because they reconcile the two research rounds with the code in `src/`.

| File | What it is | Original |
|---|---|---|
| [stack-final.md](stack-final.md) | Final recommended AI production stack: decision log, per-stage primary/fallback/tier/cost/licence, MCP servers, hardware, costs, 35 workflow steps, animation contract, human steps, folder conventions, open risks. | research round 2, `final.md` |
| [frontend-decisions.md](frontend-decisions.md) | Front-end architecture critique: gaps filled, contradictions resolved, render core, layer stack, timing profile, budgets, CI gates, art pipeline (Higgsfield-first version), open questions. | research round 1, `critic.md` |

## How the research was made

- **Date:** 2026-09-24. Prices, versions and vendor terms are a snapshot from that day.
- **Method:** a multi-agent run with adversarial verification.
  - **Round 1** covered the reference layout, Stake Engine, Higgsfield, the asset pipeline and AAA animation. A critic agent then reconciled the briefs into `critic.md`.
  - **Round 2** covered the full AI production stack. It produced eight stage deep-dives (image generation, layer split, Spine authoring, 3D character, 3D props, video/VFX, engine feel, audio/orchestration) and three competing panel proposals (maximum autonomy, production safety, technical art direction). A judge scored the proposals and merged them into `final.md`.
  - Every claim was checked by a second agent and tagged `[confirmed]`, `[corrected]` or left open.
- **Hands-on checks** happened in a sandbox, not just on paper. The following were run end to end:
  - the three.js→Pixi shared-context render target;
  - Vite 8 console stripping;
  - a Spine 4.3 JSON generator validated by `spine-core` 4.3.13;
  - a Blender toon symbol render;
  - a juice harness that measured the feel values;
  - math-sdk 7x5 fixture books, which now live in `mock/games/swamp-funk/books/`.
- **Limits.** The sandbox egress proxy blocked many vendor sites, including higgsfield.ai, openai.com, esotericsoftware.com, scenario.com, recraft.ai, elevenlabs.io, fal.ai, tripo3d.ai, meshy.ai, hyper3d.ai and stake-engine.com. Where a primary page could not be read, the claim was checked against GitHub repos, SDK source, npm/PyPI metadata or search-index snippets. If none of those confirmed it, the claim is tagged **UNVERIFIED** or **(U)**. Those tags are carried into the maintained docs. **Check every (U) price and every vendor term yourself before paying or shipping.**
- **Not legal advice.** Licence and ToS findings are research notes. Written clearance from each vendor and a review by gaming/IP counsel remain release gates (see [STACK § Where a human is still needed](../STACK.md#where-a-human-is-still-needed)).

## Edits made to the copies

Only one kind of edit was made. Absolute paths into the temporary research workspace were replaced with `[research sandbox]/…`, and the reference screenshot path with `[reference screenshot]`. The text is otherwise verbatim, including statements that later docs supersede. For example:

- Round 1 made Higgsfield the production image source; round 2 demoted it (see [STACK § Image route](../STACK.md#image-route-higgsfield-or-vertex--scenario-you-decide)).
- Round 1 said "no KTX2 in v1"; round 2 uses KTX2 with self-hosted transcoders (see [ANIMATION_CONTRACT § 3D mascots](../ANIMATION_CONTRACT.md#7-3d-mascots-gltf)).
