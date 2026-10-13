---
name: hf-batch
description: Run one paid Higgsfield generation batch from a spec file through the ledger route (plan, generate, record, wait, record, ingest) with a credit cap, then show the results. Use whenever production or exploration images must be generated for a game.
argument-hint: <spec.json> --max-credits <n>
disable-model-invocation: true
---

Run the Higgsfield batch: $ARGUMENTS

Delegate to the `higgsfield-artist` agent with these exact steps (docs/new-slot/HIGGSFIELD_PLAYBOOK.md §3.1):
1. `balance`; refuse if the cap exceeds the balance.
2. `pnpm gen:hf-ingest plan --spec <spec> --max-credits <n>` (fix the spec and re-plan on exit 2; exit 4 = over the cap).
3. For each calls[i]: generate_image_batch → save the reply → `pnpm gen:hf-ingest record --plan <plan> --from <reply>` at once.
4. jobs_wait in groups of at most 12 → `pnpm gen:hf-ingest record --from <wait reply>`.
5. `NODE_USE_ENV_PROXY=1 pnpm gen:hf-ingest --batch <batch>`; on exit 6 report the CDN host to allow in the environment's network settings.
6. One show_generation_by_ids call; report credits spent, job ids, art/_raw paths, and hand the images to `art-director` for verdicts.
Never use OpenAI models; never resubmit a timed-out job before its id is resolved.
