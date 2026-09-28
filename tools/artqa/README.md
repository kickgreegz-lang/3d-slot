# tools/artqa: art-direction and technical review for Bass Drop (phase C)

CPU only, no credits. Needs `tools/.venv` (tools/requirements.txt) and the Playwright Chromium used by
`tools/capture`. Outputs go to `build/qa/artqa/` (gitignored).

| Script | What it does |
|---|---|
| `render_rest.mjs [--jobs <jobs.json>]` | Renders Spine rigs on the real runtime (spine-pixi-v8 via `tools/spine/preview`) to straight-alpha PNGs: every job is drawn on black and on white and the alpha is recovered from the difference. Default pose = setup pose; `anim` + `t` for a frame. |
| `contact_sheet.py` | The in-game contact sheets: every approved asset at its in-game size on the real background in the `src/games/bass-drop/layout.ts` rects (landscape and portrait, base / Juke Jam / Mega Mix, HUD footprints, neon pulse, greyscale), the symbol strip at 124 px / 64 px with greyscale and silhouettes (pairwise silhouette IoU), background-calm numbers, and a side-by-side with the Dragonspire reference when the (never committed) capture exists. `--frame-dir` picks the frame pieces. |
| `board_sprites.py [--provenance]` | Board sprites (ART_PLAN open decision 1): the rig's setup pose on the 360 @2x canvas for H1–H4 / W, the canvas-fitted royals for L1–L5, plus `_blur` / `_glow` through `tools/matte/variants.py`, into `build/pack/symbols{tps}/`. |
| `check_art.py [--strict]` | Every image / Spine file under `art/source`: a manifest row with the current sha256, a parent chain that reaches a generation row (jobId + promptHash) or an owned licence, every generation ancestor approved in `art/plan/approvals.json`; the size policy; nothing from `art/_raw`, `art/_work`, `build/`, `art/_reference` tracked or staged. |
| `key_table.py` | `keyUniform` (tools/matte's gate) on the raw of every approved and not-approved job, with the drift from the requested key. |
| `prov_mascots.py` | Provenance rows for `art/source/mascots/**` (the mascot build does not write them); idempotent. |

Rebuild the review set:

```bash
node tools/artqa/render_rest.mjs            # every rig's setup pose -> build/qa/artqa/rest (after the rig builds)
tools/.venv/bin/python tools/artqa/contact_sheet.py
tools/.venv/bin/python tools/artqa/board_sprites.py
tools/.venv/bin/python tools/artqa/check_art.py --strict
```
