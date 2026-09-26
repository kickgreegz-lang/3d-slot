# Production pipeline

This page takes the game from an empty art folder to a Stake Engine submission. Every step lists **who** does it, its **inputs**, the **tool or command**, its **outputs** (exact paths) and the **automated gate** it must pass.

What to buy and install: [STACK](STACK.md). Names, frame windows and events: [ANIMATION_CONTRACT](ANIMATION_CONTRACT.md). Look: [ART_BIBLE](ART_BIBLE.md). Approval rules: [STAKE_ENGINE](STAKE_ENGINE.md). Every tool's flags, outputs and exit codes: its own README, linked from each step.

**Who does each step:**
- **[C]** Claude in an Anthropic cloud session.
- **[W]** Claude on the Linux GPU workstation (Remote Control or the self-hosted `gpu` runner).
- **[CI]** GitHub Actions.
- **[H]** a human gate.
- **[B]** a browser/computer-use agent on your own machine, with you approving.

**Production rule.** MCP servers are for exploring. **Everything that ships is produced by a committed script.**
- Raw vendor output goes to `art/_raw/` (gitignored), with a `.json` sidecar.
- Approved sources go to `art/source/` (git-LFS).
- Shipped files go to `public/assets/`, written only by scripts.
- Every file gets a row in `art/manifest.json` ([schema](../art/manifest.schema.json)). The generation wrappers (`tools/gen`, `tools/audio/gen-*`) append rows by default. The other tools write a manifest-shaped sidecar next to their QA output and append only when given `--manifest art/manifest.json`.
- Anything whose `licenseId` is not in [`licenses/allowlist.json`](../licenses/allowlist.json) fails CI.

## Tooling status

Snapshot 2026-09-24. **exists** means the tool is committed and its own test suite passes in a cloud session (no GPU, no API keys). **planned** means it is not in the repo yet. Run any tool through its npm script: `pnpm <script> <args>` appends the arguments to the script's command (with npm, put `--` before them).

| Tool | npm scripts | Status | What it does |
|---|---|---|---|
| [`tools/capture/shot.mjs`](../tools/capture/shot.mjs) (+ `browser.mjs`) | `capture` | **exists** | Deterministic capture: manual clock, step N frames, PNGs + `sheet.png` contact sheet; `--scenario <name>` |
| [`tools/qa/animation-review.mjs`](../tools/qa/animation-review.mjs) | `qa:review` | **exists** | Per scenario at an exact 60 fps: frames, `sheet.png`, MP4/WebM, `motion.svg`, `review.json`, and an `index.html` for the AI or a human reviewer |
| [`tools/qa/approval.mjs`](../tools/qa/approval.mjs) | `qa:approval` (runs `vite build` first) | **exists** | Stake smoke tests on the production build: dist URL grep, 7 viewports, request-host allowlist, zero console output |
| `?dev=lab`, `?dev=gallery`, `window.__slot` | `lab`, `gallery` | **exists** | Animation lab with Tweakpane and a symbol × state gallery. **Every timing table is tunable live**: the core `TIMING` plus each module's table registered with `registerTiming` (`TIMING_SECTIONS`: board, symbol, HUD, presentation, FX, audio, scene). The export button writes them back. Scenarios: `spin`, `anticipation`, `clusterWin`, `tumbleChain`, `spots`, `bigWin`, `fsTrigger`, `mascots`, `particles`, `shakeFlash`, `symbolLand`, `symbolStates` |
| `?spineDemo=<symbolId>` | none (DEV only) | **exists** | Binds the AI-authored demo rig (`public/assets/spine/demo/`) to that symbol in the running game (`src/assets/loader.ts`). `vite build` removes the demo from `dist/` |
| `mock/rgsMockPlugin.ts` + `mock/games/<game>/books/*` | none | **exists** | Local RGS plus per-game fixture books (Swamp Funk 7x5: loss, tumble chain, FS trigger, big win, wincap …; Bass Drop 6x6: dev fixture until its generator lands) |
| `art/bible/*`, `licenses/*`, `art/manifest.schema.json`, `.mcp.json.example` | none | **exists** | Style lock, prompt templates, licence governance, MCP config |
| [`tools/gen/`](../tools/gen/README.md): `higgsfield.mjs`, `nbp.py`, `scenario.py`, `genlib` | `gen:higgsfield`, `gen:nbp`, `gen:scenario` | **exists** | Prompt rendered from the art bible → vendor request → `art/_raw/<asset>/vNN/` + manifest rows. Licence gate (exit 3), fail-closed cost caps (exit 4), `--dry-run` |
| [`tools/matte/`](../tools/matte/README.md): `outline_matte.py`, `variants.py`, `rembg_matte.sh` | `matte`, `matte:variants` | **exists** | Key-colour + closed-outline matte, fit onto the 360×360 @2x canvas, halo and canvas gates; `_blur` / `_glow` variants |
| `tools/split/*.py` | none | planned | SAM 3.1 part masks, hidden-area fill, tagged PSD (step 3.1) |
| [`tools/spine/`](../tools/spine/README.md): `gen.py`, `validate.mjs`, `pack.py`, `make_blur.py`, `export.sh`, `preview/capture.mjs`, `contract.json` | `spine:gen`, `spine:validate`, `spine:pack`, `spine:blur`, `spine:export`, `spine:preview`, `spine:capture`, `spine:demo`, `spine:test` | **exists** | `rig.yaml` → Spine 4.3 JSON, contract gate on spine-core 4.3.13, deterministic test atlas, blur parts, Spine CLI wrapper, contact sheets on spine-pixi-v8. `capture.mjs` replaces the planned `preview.ts` on spine-canvaskit |
| [`tools/blender/`](../tools/blender/README.md): `render_symbol.py`, `turntable.py`, `cleanup_mascot.py`, `build_actions.py`, `export_glb.py` | `blender:symbol`, `blender:turntable`, `blender:cleanup`, `blender:actions`, `blender:export`, `anim:check`, `test:blender` | **exists** | Baked toon symbol inserts with QA gates, bake-off turntables, vendor-mesh cleanup, animation JSON → Actions, GLB export with the runtime bone names |
| `tools/blender/rig_mascot.py` | none | planned | Rigify or vendor rig, procedural eyes, face shape keys, spring and squash bones (step 4.2) |
| [`tools/gltf/`](../tools/gltf/README.md): `optimize.sh`, `budget.mjs` | `gltf:optimize`, `gltf:budget` | **exists** | gltf-transform optimise (meshopt, WebP), validate, and the budget gate (`--mascot`) |
| `tools/fx/*.py` | none | planned | Baked Blender flipbooks (step 5.3) |
| [`tools/video/`](../tools/video/README.md): `key_video.sh`, `stacked_alpha.sh`, `flipbook.py` | `video:key`, `video:stacked` | **exists** | Keyed seamless loops, stacked-alpha MP4 with a decode-back check, AssetPack clip folders |
| [`tools/audio/`](../tools/audio/README.md): `gen-sfx.mjs`, `gen-music.mjs`, `master.sh`, `sprite.mjs`, `audio_qa.py` | `gen:sfx`, `gen:music`, `audio:master`, `audio:sprite` | **exists** | ElevenLabs generation from the cue sheet, EBU R128 mastering, WebM-Opus + AAC, sprites |
| Audio pre-filter (CLAP rank, BPM/key, Gemini audio critique, audition page); `audio/cues.yaml` | none | planned | Step 7.2. Start the cue sheet from `tools/audio/cues.example.yaml` |
| [`tools/assets/`](../tools/assets/README.md): `pack.mjs`, `assetpack.config.mjs` | `assets:pack` | **exists** | AssetPack `build/pack` → `public/assets/pack`, with gates. **The runtime does not read the pack output yet** |
| [`tools/licence/audit.mjs`](../tools/licence/README.md) | `licence:audit` | **exists** | The `licence-audit` check: manifest ↔ allow/deny lists, clearances, sha drift, uncovered public files |
| [`.github/workflows/qa.yml`](../.github/workflows/qa.yml) | none | **exists** | Jobs `licence-audit`, `build` (typecheck, build, approval smoke) and `pipeline-tools` (every tool's offline tests). Nightly, GPU and Claude-review jobs are planned |
| `tools/validate-asset.ts` (PostToolUse hook) | none | planned | Validate each asset as it is written |

**Not verified yet.** These parts are built but have only run against stand-ins:
- **Spine CLI.** `tools/spine/export.sh` has only run against a fake Spine binary; there is no Spine licence in the cloud sessions. Its warning pattern may need tuning to the real 4.3 output, importing the generated JSON into the Spine editor is untested, and `spine-rigc` was not evaluated.
- **Blender.** The scripts ran with bpy 5.2.2 as a Python module. The real `blender -b -P` binary path is only simulated (`tools/blender/tests/sim_blender.py`), and EEVEE ran only on a CPU software renderer, never on a GPU.
- **Vendors.** No live call was made to Higgsfield, Vertex (including the Batch file format), Scenario or ElevenLabs. Tests used a fake CLI and mock REST servers; cost and result field names come from docs and SDK source.
- **Media.** Tests used ffmpeg 7.0.2, not 8.x. Gapless Opus/AAC loops were checked with ffmpeg, not on real devices. The video and audio shell tools need bash ≥ 4.4 (macOS ships 3.2).
- **CI.** `qa.yml` has never run on GitHub. The licence audit ([tools/licence](../tools/licence/README.md), `pnpm licence:audit`) passes on the current repo: 0 errors, with warnings only for placeholder exemptions (the CC0 robot, the dev-only Spine demo rig) that `--release` turns into errors until production art replaces them.

### Tool setup

```bash
pnpm install                                         # Node tools: spine-core, gltf-transform, AssetPack, Playwright, resvg-js
python3.11 -m venv tools/.venv && tools/.venv/bin/pip install -r tools/requirements.txt   # gen, matte, video, audio, assets, spine (Python >= 3.11)
export PYTHON=$PWD/tools/.venv/bin/python            # read by spine:*, gen:nbp, gen:scenario, matte*, anim:check
uv venv -p 3.13 ~/.venvs/bpy && uv pip install --python ~/.venvs/bpy -r tools/blender/requirements.txt
export BPY_PYTHON=~/.venvs/bpy/bin/python            # blender:* use $BLENDER (the real binary) when set, else $BPY_PYTHON
```

- `tools/requirements.txt` includes `imageio-ffmpeg`, a full static ffmpeg that the shell tools find through `tools/video/ffenv.sh` when `$FFMPEG` is not set.
- `tools/requirements-spine.txt` is a strict subset of it with the same pins.
- Offline self-tests: `pnpm spine:test`, `pnpm test:blender` (needs `BPY_PYTHON`), and the per-tool `test/` commands in each README; CI runs the same ones.

**Order of work.** Phases 3 and 4 run in parallel. Phase 6 runs continuously from phase 3 on. Phase 8's nightly loop starts as soon as the first real asset lands.

---

## How Claude runs the pipeline

The loop Claude repeats for every asset, shown for symbol `H1`. Each step is one command; details are in the phase sections below.

1. **Render the prompt** from the art bible. Nobody types prompts: `python3 tools/gen/genlib.py render --template symbol.txt --symbol H1 --rig-ready --json`
2. **Generate, dry run first:** `pnpm gen:nbp --template symbol.txt --symbol H1 --rig-ready --ref art/source/refs/style/01.png --dry-run`, then the same command without `--dry-run`. The alternatives are `pnpm gen:higgsfield … --max-credits 30` and `pnpm gen:scenario … --price`.
3. **Matte and variants:**
   - `pnpm matte art/_raw/sym_H1/v01/raw.png "build/pack/symbols{tps}/sym_H1.png" --symbol H1 --key 00FF00 --emit-master art/source/symbols/H1/master_2048.png`
   - `pnpm matte:variants "build/pack/symbols{tps}/sym_H1.png" --symbol H1`
4. **Animate.**
   - Spine symbol:
     - `pnpm spine:blur art/source/symbols/H1/parts.json`
     - `pnpm spine:gen art/source/symbols/H1/rig.yaml -o build/spine/sym_H1.json`
     - `pnpm spine:validate build/spine/sym_H1.json`
     - `pnpm spine:pack --images art/source/spine/images --skeleton build/spine/sym_H1.json --out build/spine --name sym_H1`
   - 3D:
     - `pnpm blender:symbol --sym W --mesh art/source/3d/props/W.glb --clip turn`
     - `pnpm anim:check art/source/3d/mascot_gumbo/anim/*.json`
     - `pnpm blender:actions …` (step 4.3)
     - `pnpm gltf:optimize raw.glb public/assets/mascots/mascot_gumbo.glb --mascot`
5. **Contact sheets:**
   - `pnpm spine:capture --skel build/spine/sym_H1.json --atlas build/spine/sym_H1.atlas --out qa/sym_H1/spine` (standalone, on the real runtime).
   - With `pnpm dev` running: `pnpm qa:review --scenarios symbolLand:H1,symbolStates:H1 --out qa/sym_H1/game`.
   - Blender clips write their own `build/qa/blender/<ID>_<clip>/sheet.png`.
   - Mascot clips: `pnpm blender:turntable raw.glb --action celebrate --frames 8 --out qa/mascots/celebrate`.
6. **Vision critique.**
   - Claude reads the sheets and `index.html` frames against the rubric: timing, spacing, squash, overlap, arcs, silhouette at cell size, loop pop. Gemini is the blind second judge.
   - Claude writes `qa/<asset>/critique.json` (format planned), edits `rig.yaml` (`motion.*`, `accents`, `physics`) or the animation JSON, and repeats from step 4. Fable 5.1 does the final pass.
7. **Tune the feel in the lab:** `pnpm lab`, run the scenario (e.g. `symbolLand`), then adjust any section in the TIMING tab. From a script, use `__slot.setTiming('land.springStiffness', 1400)` inside `pnpm capture --script "…"`.
8. **Export the timings.** Click **Export → timing.ts + sections JSON**. It downloads a patched `timing.ts` and `timing-sections.json`, and copies the JSON to the clipboard; `__slot.timingChanges()` lists every edit. Commit `timing.ts` and copy the changed module values into their `registerTiming` tables. Then re-capture the golden run (step 6.2).
9. **Licence audit:** `pnpm licence:audit` (placeholder exemptions only warn). Before a release: `pnpm licence:audit --release --strict`.
10. **Approval smoke:** `pnpm typecheck && pnpm qa:approval`.

**Where it runs.** A cloud session [C] can run all of this except `pnpm spine:export`, which needs the activated Spine seat on [W], and GPU EEVEE (use the default Cycles CPU engine instead). Vendor calls also need API keys and the Custom network allowlist ([STACK Step 9](STACK.md#step-9-cloud-environment-h-once)).

---

## Phase 0: Setup and clearances

**0.1 Clearance questionnaire** · [H + counsel]
- **In:** the vendor list in [STACK § Install checklist, Step 0](STACK.md#step-0-accounts-keys-caps-clearances-h).
- **Do:** ask every vendor, in writing, about real-money gambling use, EU/UK distribution, output ownership, training on your inputs and data residency. Ask OpenAI only if you want GPT Image or GPT-6 Astra.
- **Out:** `licenses/clearances/<vendor>.pdf` and `licenses/tos/<vendor>/<yyyy-mm-dd>.pdf`. Set `clearance: "cleared"` in `licenses/allowlist.json`. The generation wrappers record the newest archived ToS in each row's `tosVersion`.
- **Gate:** `pnpm licence:audit` ([tools/licence](../tools/licence/README.md)) fails any shipped row, and any ancestor of a shipped row, whose licence is not cleared. Every file under `public/assets` counts as shipped. **Clearances gate shipping, not building.**

**0.2 Buy, keys, caps, activations** · [H] (+[B] for dashboards)
- **Do:**
  - Accounts and API keys, with a **spend cap in every dashboard**.
  - Activate Spine once under VNC/Xvfb, then pin the patch: `SPINE=/opt/spine/Spine.sh SPINE_VERSION=4.3.XX pnpm spine:export version` (runs `$SPINE -u 4.3.XX --version`).
  - Request gated `facebook/sam3` access and run `hf auth login`.
  - Complete the OAuth logins for Scenario, Recraft and Higgsfield (`/mcp`, then `select_workspace` on Higgsfield).
- **Gate:** the smoke test in [STACK Step 10](STACK.md#step-10-smoke-test) passes.

**0.3 Control plane** · [W/C], delivered as a PR you review
- **Out:**
  - `.mcp.json` (from `.mcp.json.example`);
  - `.claude/settings.json` (Bash allowlist + the planned `tools/validate-asset.ts` PostToolUse hook);
  - `art/manifest.json` (`{"schemaVersion":1,"rows":[]}`);
  - `.github/workflows/qa.yml`: **exists**, with the `licence-audit`, `build` and `pipeline-tools` jobs. Still to add: `anthropics/claude-code-action@v1` review jobs and GPU jobs on `[self-hosted, gpu]`;
  - the cloud environment: Custom network, stored credentials, a setup script with ffmpeg 8 (or `tools/requirements.txt`, whose static ffmpeg the tools find), Playwright chromium, `ktx` ≥ 4.4 and `basisu`;
  - `qa/rubric.md`, with the Stake checklist pulled through the `stake-docs` MCP.
- **Gate:** the `licence-audit` job is a **required** GitHub status check.

**0.4 Toolchain** · [W]
- **Do:** see [STACK § Install checklist, Steps 3–7](STACK.md#step-3-toolchain). It covers Node/pnpm, uv venvs (bpy 5.2.2 on Python 3.13; SAM 3 on 3.12), Blender 5.2.2, ComfyUI with allowlisted weights only, ToonOut, Lucida, SkinTokens, Practical-RIFE and IRIS. The repo's own tools install as in [Tool setup](#tool-setup).

---

## Phase 1: Art direction and style lock

**1.1 Art bible and templates** · [C]. **Done:** `art/bible/artbible.json` and `art/bible/prompts/*.txt`.
- From now on every prompt is **rendered** from them (see [prompts/README](../art/bible/prompts/README.md)). Nobody writes prompts by hand.
- The reference renderer is `python3 tools/gen/genlib.py render --template <file>[#SECTION] --symbol <ID>` ([tools/gen](../tools/gen/README.md)). Its Python and Node twins give byte-identical text, and it fails on unfilled placeholders and forbidden words.

**1.2 Explore 4 directions** · [C]
- **In:** 4 variants of the style formula's palette/shape block, with the locks unchanged.
- **Do:** for each direction, make 3 probe assets (L1 'A', H1, W) plus mascot key art.
  - **Route A (recommended):** Nano Banana Pro on Vertex at 2K (`pnpm gen:nbp`); NB2 Lite for volume.
  - **Route B (Higgsfield):** `pnpm gen:higgsfield --template symbol.txt --symbol H1 --resolution 2k --dry-run`, then without `--dry-run`. It wraps `higgsfield generate cost` and `generate create nano_banana_2 … --wait --json`. Optionally A/B several models on the same prompt.
- **Out:** `art/_work/direction_<n>/` containing the probes, a 64 px readability sheet, a greyscale silhouette matrix, and `critique.json` from Claude and Gemini against the rubric.
- **Gate:** none. This is exploration; the output feeds 1.3.

**1.3 Pick and paint over** · [H]
- **Do:** the art director picks **one** direction. A paintover artist paints over **10–20 hero images** in Krita/Photoshop.
- **Out:** `art/source/refs/style/01..NN.png`, one canonical ordered pack, plus a paintover log. Manifest rows carry `stage: "human-paintover"`, `humanEditor` and `humanEditSummary`.

**1.4 Train the style lock** · [C]
- **Do:**
  - The Scenario MCP trains **one style LoRA** and **one LoRA per mascot** on Qwen Image, Z-Image and FLUX.2 Klein 4B Base in parallel (`sample_prompts` set, ≤ 4 epochs, dry-run priced).
  - Claude compares them with DINOv2 and vision, and keeps the winner.
  - Recraft Create Style on the paintovers returns a `style_id`.
- **Out:** LoRA ids, dataset hashes and the `style_id`, recorded in `art/manifest.json`.
- **Gate:** the winning LoRA's samples pass the [ART_BIBLE gates](ART_BIBLE.md#10-qa-gates) at the pack baseline.

---

## Phase 2: 2D generation

Tools: [tools/gen](../tools/gen/README.md), [tools/matte](../tools/matte/README.md).

**2.1 Symbols** (H1–H4, W, S) · [C] + [H] batch sign-off
- **In:** `symbol.txt` + `artbible.symbols.<ID>` + the style pack or LoRA.
- **Do:** make two masters per symbol: **beauty**, and **rig-ready** (`--rig-ready` sets `{RIG_READY_LINE}`: parts clear of the body, mouth closed). Use one of these routes:
  - **Route A (Vertex + Scenario, recommended).**
    - Scenario custom-model endpoint with the style LoRA at 2048² on the key colour: `pnpm gen:scenario --template symbol.txt --symbol <ID> --model-id <lora> --base qwen-image --price`, then without `--price`. *Or*
    - NBP `gemini-3-pro-image` with 6–10 style refs at 2K: `pnpm gen:nbp --template symbol.txt --symbol <ID> --rig-ready --ref art/source/refs/style/01.png …`. For bulk, stage a Batch API job with `--batch-jsonl`, then `batch-submit` / `batch-collect` (see the README).
  - **Route B (Higgsfield).**

    ```bash
    pnpm gen:higgsfield --template symbol.txt --symbol <ID> --image art/source/refs/style/01.png \
      --image art/source/refs/style/02.png --image art/source/refs/style/03.png --resolution 2k --max-credits 30 --dry-run
    ```

    The wrapper runs `higgsfield generate cost`, then `generate create nano_banana_2 … --wait --json`, downloads every result into `art/_raw/` and writes the rows (`route: "higgsfield-cli"`). `--max-credits` fails closed (exit 4) when the cost preview has no figure it recognises.

    **Or through the Higgsfield MCP** (route `higgsfield-mcp`). MCP ids differ from the CLI's: `nano_banana_pro` is Nano Banana Pro (its jobs report `nano_banana_2`, which the row records; 2 credits at 2k, 4 at 4k) and the MCP's `nano_banana_2` is Nano Banana 2. Never `gpt_image_2`, `gpt_image_2_5` or `openai_hazel` (denylisted). Every paid job is recorded in the committed ledger `art/ledger/higgsfield-jobs.json`, and [`hf-ingest.mjs`](../tools/gen/README.md#higgsfield-mcp-route-plan--pay--record--ingest-pnpm-genhf-ingest) turns it into the same raw layout and rows as the CLI route:

    ```bash
    pnpm gen:hf-ingest plan --spec spec.json --max-credits 20     # rendered prompts -> exact generate_image_batch arguments
    #   MCP: generate_image_batch(calls[i]) -> save the reply as submit.json; jobs_wait(...) -> save as wait.json
    pnpm gen:hf-ingest record --plan art/_work/hf-plans/<batch>.plan.json --from submit.json   # record paid jobs at once
    pnpm gen:hf-ingest record --from wait.json                    # status + result_url
    pnpm gen:hf-ingest                                            # download -> art/_raw/<asset>/vNN/{raw.png,prompt.txt,job.json,manifest.json} + rows
    pnpm gen:hf-ingest status                                     # credits per batch, downloaded or not, row ids for --parent-id
    ```

    Ingest re-renders each prompt and checks its `promptHash` (falling back to the stored copy in `art/ledger/prompts/`), verifies the PNG (CRCs, IEND, size vs resolution and aspect, sha256 vs the ledger), resumes interrupted downloads, never overwrites a different file, and writes `shipped: false` rows (`licenseId: higgsfield`, `seed: null`, `jobId`). In a cloud session the CDN host (`d8j0ntlcm91z4.cloudfront.net`) must be allowed in the environment's Network access settings; until then ingest stops with exit 6 and names the host. Ships only after the Higgsfield clearance (see [STACK § Image route](STACK.md#image-route-higgsfield-or-vertex--scenario-you-decide)).
  - **Then, either route:**
    1. **Matte:** `pnpm matte <raw.png> "build/pack/symbols{tps}/sym_<ID>.png" --symbol <ID> --key <KEY_HEX> --emit-master art/source/symbols/<ID>/master_2048.png`. The closed-outline key matte is exact on bible-compliant art. Art without a closed outline goes through ToonOut or `tools/matte/rembg_matte.sh birefnet-general` (never rembg's default model), then `--alpha-from`.
    2. **Fit:** the matte also fits the art: content = `cellScale × 300 px` from `src/games/$GAME/config.ts` (default swamp-funk), measured on the longer side (`--fit height` is available), because the runtime `SymbolRig.fit` scales by `max(w,h)`. It is centred on the **360×360 @2x** canvas, in straight alpha, and never upscaled.
    3. **Variants:** `pnpm matte:variants "build/pack/symbols{tps}/sym_<ID>.png" --symbol <ID>` makes:
       - `_blur`: the runtime's own blur recipe; `--blur-mode box` gives the ffmpeg `avgblur sizeY=14` recipe instead;
       - `_glow`: Gaussian σ 14, **white**, because the runtime tints it with the symbol colour.
- **Out:**
  - `art/_raw/sym_<ID>/v<NN>/{prompt.txt,args.json,refs/,cost.json,job.json,raw.png,manifest.json}`
  - `art/source/symbols/<ID>/master_2048.png` (straight alpha)
  - `build/pack/symbols{tps}/sym_<ID>{,_blur,_glow}.png` (AssetPack input)
  - `build/qa/matte/sym_<ID>/{qa.json,qa_on_black.png,qa_on_white.png,manifest.json}`
  - manifest rows
- **Gate:**
  - **Implemented** (matte, exit 1): no halo (zero key-tinted edge pixels, straight and composited on black and on white), and canvas and pivot (360×360, content within 2 px of target).
  - **Planned:** palette ΔE, outline histogram, silhouette confusion, DINOv2 style similarity, no text. Failures will regenerate automatically (at most 2), then go to [H] **batch sign-off**.

**2.2 Royals, UI, logo, backgrounds, frame** · [C] + [H] for the logo
- **Royals (L1–L5).**
  - Build vector glyphs from the bundled Lilita One / Titan One: 8 px black stroke @2x, plum `#4B283D` extrusion 12–20 px @2x toward the lower right, face hue per the art bible.
  - Rasterise with `@resvg/resvg-js`. There is no royal script yet; `tools/spine/examples/demo_symbol/make_parts.mjs` shows the resvg-js route.
  - Optional `royal_material_pass.txt` (NBP edit), then re-matte and ECC-register back onto the vector alpha.
  - **Out:** `art/source/ui/royal_<ID>.svg`, `build/pack/symbols{tps}/sym_L<n>*.png`.
- **UI.** Recraft V4 Styles SVG with the `style_id` (hex buttons in 4 states, icons) → resvg at 1x/2x. **Out:** `art/source/ui/*.{svg,png}`.
- **Logo.** An NBP emblem (no letters) + Recraft vectorise. [H] a typographer sets the word-mark; [H] trademark search. **Out:** `art/source/logo/*.svg`.
- **Backgrounds.**
  - `background.txt` A at 4K (`pnpm gen:nbp --template background.txt#A --image-size 4K …`): 21:9 cropped to 2:1, and 9:16 outpainted to 1:2.
  - B: separate back/mid/front layers.
  - C: the neon-only additive layer.
  - D: the bright game-tile plate.
  - **Out:** `art/source/backgrounds/bg_{16x9,9x16}_{back,mid,front}.png` + neon layers, and the free-spins variants.
- **Frame.** `frame_piece.txt` for beam, post, sill and corner cap on `#FF00FF` → matte (`pnpm matte … --key FF00FF`) → 3-slice. **Out:** `art/source/ui/frame_{beam,post,sill,cap}.png`.
- **Gate:** the same gates as 2.1. Backgrounds are also checked for readable text or signage (OCR) and a darker centre (mean luminance of the central 60% below the edges). Both of those checks are planned.

**2.3 Mascot sheets** · [C] + [H] approval
- **Do:**
  1. `mascot_turnaround.txt` A: the design model sheet at 4K 21:9, ≤ 14 refs (`pnpm gen:nbp --template mascot_turnaround.txt#A --mascot gumbo --image-size 4K --aspect-ratio 21:9`). [H] approves identity and **adult proportions**.
  2. `mascot_turnaround.txt` B: one **unlit, outline-free, grey-background** image per view: front, left, back, right.
  3. `mascot_expressions.txt` A–D: expressions, mouth/eye shapes, hands, key poses.
- **Out:** `art/source/mascots/<name>/turnaround/{front,left,back,right}.png`, `art/source/mascots/<name>/sheets/*.png`.
- **Gate:** no forbidden words in the rendered prompts (enforced by the renderer). Planned: DINOv2 identity against the approved front view, and an adult-proportions check (head ≤ ~¼ of height).

---

## Phase 3: 2D → Spine (symbols)

Tools: [tools/spine](../tools/spine/README.md). Steps 3.2, 3.3 and 3.5 run in a cloud session; 3.4 needs the licensed Spine seat [W]. The whole chain on the demo rig: `pnpm spine:demo --build-dir build/spine/demo --capture build/spine/demo/capture` (with `PYTHON` set).

**3.1 Matte and split into parts** · [W]
- **In:** the rig-ready `master_2048.png`.
- **Do** (`tools/split/*.py`, planned):
  1. **Matte.** ToonOut by default; A/B against Lucida and `rembg -m birefnet-general -dc` (`tools/matte/rembg_matte.sh`). Never the default rembg model.
  2. **Plan.** Claude writes **`parts.json`** against the taxonomy: `body`, `head`, `eye_L/R`, `pupil_L/R`, `lid_L/R`, `mouth_{closed,open,smile}`, `prop`, `fx_glow`, plus the per-symbol parts in the art bible. Each part has a parent, z-index, bbox, 2–5 positive/negative points and a joint guess. The file format is in the [tools/spine README](../tools/spine/README.md#rigyaml-reference). In the production layout `parts.json` sits in `art/source/symbols/<ID>/` with `"images": "../../spine/images"`.
  3. **Masks.** **SAM 3.1** from those boxes and points, resolved into one exclusive partition by z-order, with edges refined by BiRefNet on each crop.
  4. **Hidden-area fill.** FLUX.1 Fill [pro] (`POST https://api.bfl.ai/v1/flux-pro-1.0-fill`, `output_format: png`). Fallbacks: NBP edit (`symbol_parts_sheet.txt#C`), then local Qwen-Image-Edit-2511. Composite so **original visible pixels stay locked**, then re-register with OpenCV ECC/SIFT.
  5. **Joints.** joint = centroid of dilate(child) ∩ parent, snapped to the child's round overlap cap.
  6. **State variants.** Blink and mouth shapes (`symbol_parts_sheet.txt#D`), registered to the same canvas.
  7. **Blur parts** (exists): `pnpm spine:blur art/source/symbols/<ID>/parts.json` writes `<part>_blur.png` and sets `blur: true`.
  8. **PSD.** `psd-tools` writes a tagged PSD (`[bone:*]`, `[slot:*]`, `[origin]`) for artist round-trips.
- **Out:** `art/source/spine/images/sym_<ID>/<part>.png` (2x, 2–4 px padding), `art/source/symbols/<ID>/{parts.json, rig.yaml, master.psd}`.
- **Gate:** rest-pose reassembly **SSIM > 0.98** and **alpha IoU > 0.99**; **no holes** when any bone rotates ±35° or scales ±15%; fill colour **< 3 ΔE** against the visible part.

**3.2 Generate the skeleton** · [C]
- **Do:** Claude writes `rig.yaml`: bones, meshes, physics presets, motion overrides, accents and events. It never types keyframes or curve numbers. Then:

  ```bash
  pnpm spine:gen art/source/symbols/<ID>/rig.yaml -o build/spine/sym_<ID>.json
  ```

  The generator (`tools/spine/gen.py`) emits 4.3 JSON:
  - one root `constraints[]`;
  - code-computed absolute beziers from named easing presets;
  - shapely meshes (alpha-traced or grid) with inverse-distance or vertical weights;
  - physics from the presets in `tools/spine/contract.json` (default 484 / 0.833, limit 12,000);
  - every animation and event in [ANIMATION_CONTRACT §3–4](ANIMATION_CONTRACT.md#3-symbol-animations).

  Unknown keys in `rig.yaml` are errors, and `--check` fails when the committed output has drifted. `spine-rigc` 1.1.0 (suggested as a format reference) has not been evaluated; this generator covers the same ground and is contract-specific.

**3.3 Validate** · [C]
- **Do:**

  ```bash
  pnpm spine:validate build/spine/sym_<ID>.json --report build/spine/sym_<ID>.validate.json
  pnpm spine:pack --images art/source/spine/images --skeleton build/spine/sym_<ID>.json --out build/spine --name sym_<ID>   # test atlas
  pnpm spine:validate build/spine/sym_<ID>.json --atlas build/spine/sym_<ID>.atlas
  ```

  The validator runs on `@esotericsoftware/spine-core` 4.3.13. `pack.py` is a deterministic PMA packer (no rotation, no polygons) for loading the rig in engine; the production atlas comes from 3.4.
- **Gate** (exit 0 required; `--strict` also fails on warnings):
  - no NaN, with every animation stepped with physics at 60 Hz until 2 frames past its end;
  - loop seams checked with `loop=false`, and end poses;
  - required events present; `explode_burst` on frame 2–3;
  - duration windows, and `win` ≤ 900 ms;
  - `land` squash depth: sy 0.83–0.87 warns, outside 0.80–0.88 fails, and sx = 1/√sy;
  - `land` inside the cell with the physics kick applied both ways (±36 by default). This rule is an **OPEN DECISION** for symbols sized to the art bible: see [ANIMATION_CONTRACT §3.1](ANIMATION_CONTRACT.md#31-land-contact-frame-and-cell-gate-open-decision). The `runtimeFit` report line shows the in-game numbers; use `--cell <units>` for specials until the decision is made;
  - budgets (≤ 30 bones, ≤ 250 vertices, ≤ 8 slots, no clipping);
  - 4.3 constraint format and order; no sequence attachments; no file extensions in region names; additive blend only on `fx_*` slots;
  - physics paired with `phys_*` bones and limit ≥ 10,500. Warnings for inertia outside 0.5–0.8 and implied frequency outside 2–8 Hz;
  - `sfx` / `vfx` payloads are real `SfxId`s / FX ids.

**3.4 Spine CLI** · [W]. **Unverified:** `export.sh` has only run against a fake Spine binary.

```bash
export SPINE=/opt/spine/Spine.sh SPINE_VERSION=4.3.XX   # one exact patch; betas and "latest" are refused
pnpm spine:export symbol <ID>                           # import -r → clean -m → export -e binary (+ JSON copy in build/) → pack -p
```

`tools/spine/export.sh` runs the Spine CLI steps below. It tees each step to `build/spine/logs/<step>.log` and **fails on a non-zero exit or on any warning line**, because missing images still exit 0. `SPINE_FAIL_PATTERN` overrides the pattern, which may need tuning to the real CLI output.

```bash
$SPINE -u 4.3.XX --hide-license --disable-audio -i build/spine/sym_<ID>.json -o art/source/spine/sym_<ID>.spine --to sym_<ID> --replace -r
$SPINE -u 4.3.XX -i 'art/source/spine,**/*.spine' -m                                         # clean up animations
$SPINE -u 4.3.XX -i 'art/source/spine,**/*.spine' -o public/assets/spine --set nonessential=false -e binary
$SPINE -u 4.3.XX -i art/source/spine/images -o public/assets/spine -n symbols -j 'art/source/spine,sym_*.spine' -p config/spine/pack-symbols.json
```

- **Pack settings:** `export.sh` uses `config/spine/pack-symbols.json` when it exists, otherwise `tools/spine/config/pack-symbols.json`. The production copy in `config/spine/` has not been created yet.
- **Out:** `art/source/spine/sym_<ID>.spine` (git-LFS), `public/assets/spine/sym_<ID>.skel`, `symbols.atlas` + `symbols.png` + `symbols@0.5x.*` (PMA, 2048, polygons). Keep a `-e json` export in `build/` for diffs.

**3.5 Visual critique loop** · [C/W]
- **Do:**
  1. Render sheets on the real runtime (spine-pixi-v8), no game needed:

     ```bash
     pnpm spine:capture --skel build/spine/sym_<ID>.json --atlas build/spine/sym_<ID>.atlas --out qa/sym_<ID>/spine
     ```

     You get one sheet per animation (`land`, `win`, `explode`, `idle`, `anticipation`, `appear`, `blur`) plus `trace.json`. Tiles are 224 px, so the cell reads at about 160 px. Each tile shows the frame number, ms and events, and each sheet has a motion plot. The rig is bound like the runtime: position inheritance, the land kick and the §3 mixes.
  2. Capture **in-game** at 128–160 px cells. This works once the rig is registered in `ART_MANIFEST.spine` by the `src/` owners (entry shape in the [tools/spine README](../tools/spine/README.md#registering-a-rig-in-the-game-srcassetsmanifestts-owned-by-src)). The demo rig can be bound to any symbol with DEV `?spineDemo=<ID>`:

     ```bash
     pnpm qa:review --scenarios symbolLand:H1,symbolStates:H1 --every 2 --out qa/sym_H1
     node tools/qa/animation-review.mjs --url "http://localhost:5173/?spineDemo=H1" --scenarios symbolLand:H1 --out qa/sym_demo
     pnpm capture --url "http://localhost:5173/?dev=gallery" --frames 120 --every 4 --sheet --out qa/sym_H1/gallery
     ```

  3. Claude (Opus per iteration, **Fable 5.1 for the final pass**) and Gemini critique **blind** against the rubric: timing and spacing, anticipation and overshoot, squash and stretch, overlap, arcs, silhouette at cell size, loop pop, jitter, AI-slop tells.
  4. Claude edits `rig.yaml` (`motion.*`, `accents`, `physics`) and repeats from 3.2.
- **Out:** `qa/sym_<ID>/critique.json` (format planned).
- **Gate:** no issue rated "major" by either judge.

**3.6 Optional human polish** · [H]
- **Do:** a contract Spine animator polishes W, S and H1. Claude validates the JSON export of their rig, then keeps adding animations to it: `pnpm spine:export import-anims build/spine/sym_W.anims.json art/source/spine/sym_W.spine sym_W <anim> …`, which wraps `$SPINE … --to sym_W -a <anim> --replace -r`.

---

## Phase 4: 3D mascots (runs in parallel with phase 3)

Tools: [tools/blender](../tools/blender/README.md), [tools/gltf](../tools/gltf/README.md). Every Blender script runs both as `blender -b --python-exit-code 1 -P tools/blender/<x>.py -- <args>` and with bpy as a Python module. `pnpm blender:*` picks `$BLENDER` when set, else `$BPY_PYTHON`. **Only the bpy-module path has been run**; the binary path is simulated. Exit codes: 0 ok, 1 error, 2 usage, 3 a QA or budget gate failed (outputs are still written).

**4.1 Mesh bake-off** · [W]
- **In:** `art/source/mascots/<name>/turnaround/{front,left,back,right}.png` (3D-input views).
- **Do:** make 3 candidates per mascot.

  ```bash
  tripo make front.png left.png back.png right.png --model tripo-v3.1 -p face_limit=15000 --dry-run --json   # then without --dry-run
  ```

  - Meshy MCP: `meshy-7` multi-image (beta) **and** a single-image run with `ultra_mode`.
  - Rodin Gen-2.5-High (Raw) via the `rodin3d-skill` plugin.
  - Then render 8-angle toon turntables in the runtime shader look: `pnpm blender:turntable art/_work/mascots/<name>/cand_<vendor>.glb --out art/_work/mascots/<name>/tt`.
- **Out:** `art/_work/mascots/<name>/cand_*.glb` + turntables. Claude ranks the candidates against the art.
- **Gate:** [H] **veto**.

**4.2 Cleanup and rig** · [W]
- **Cleanup** (exists):

  ```bash
  pnpm blender:cleanup art/_work/mascots/<name>/cand_<vendor>.glb --out art/_work/mascots/<name>/clean.glb \
    --height 1.8 --target-tris 14000 --colors 6 --out-blend art/_work/mascots/<name>/clean.blend --strict
  ```

  - weld, clear custom normals, smooth by angle, feet at the origin facing −Y, then decimate to the target. `--remesh quadriflow` is implemented but untested (it falls back to decimate). The Laplacian relax runs only on meshes that were reduced;
  - **discard the AI texture** in favour of 4–8 flat toon colours on one palette material (CIELAB clustering that keeps small distinct colours such as eye white and pupils);
  - rigged inputs keep their rig (root transform only). Meshes with shape keys are not decimated;
  - the budget report goes to `<out>.report.json`, and `--strict` exits 3 on a breach.
- **Rig** (planned: `tools/blender/rig_mascot.py`; until it exists, use a vendor biped rig or rig by hand [H]):
  - procedural eyes and lids with a UV-offset pupil atlas; 8–15 shape keys (names in [ANIMATION_CONTRACT §7.4](ANIMATION_CONTRACT.md#74-morph-targets--15));
  - rig: Rigify (non-humanoid parts: `limbs.spline_tentacle`, `face.skin_eye`, `face.skin_jaw`), or a Tripo/Meshy biped rig, plus face, `spring_*` and squash bones;
  - weights: SkinTokens `--use_skeleton --use_transfer`;
  - Claude reviews range-of-motion renders for candy-wrapper twisting and weight tearing.
- **Out:** `art/source/3d/mascot_<id>/mascot_<id>.blend` (id = `gumbo` | `croak`).

**4.3 Animate from JSON** · [W] + [H]
- **Do:**
  1. Claude writes `art/source/3d/mascot_<id>/anim/<clip>.json` for every clip in [ANIMATION_CONTRACT §7.2](ANIMATION_CONTRACT.md#72-clip-names-canonical--what-the-runtime-loads): key poses per control, BACK/ELASTIC/BOUNCE easing, 2–4 frame holds, offset overlap, loop flag.
     - The format is in the [tools/blender README § Animation JSON](../tools/blender/README.md#animation-json), with schema `tools/blender/anim.schema.json` and example `tools/blender/examples/celebrate_test.json`.
     - `pnpm blender:actions --blend art/source/3d/mascot_<id>/mascot_<id>.blend --describe art/_work/mascots/<id>/rig.json` dumps every bone's rest axes, the morph names and the existing actions for the author.
  2. Check the JSON without Blender: `pnpm anim:check art/source/3d/mascot_<id>/anim/*.json`. Research alias names are errors. A wrong loop flag or length window warns, and fails with `--strict`.
  3. Build the Actions and export:

     ```bash
     pnpm blender:actions --blend art/source/3d/mascot_<id>/mascot_<id>.blend art/source/3d/mascot_<id>/anim/*.json \
       --save --export-glb art/_work/mascots/<id>/raw.glb --rigify-names
     ```

     There is one slotted Action per clip. Loops close exactly: the closing key is added when missing, and the report measures the seam.
  4. Clip contact sheets go to Claude + Gemini for critique: `pnpm blender:turntable art/_work/mascots/<id>/raw.glb --action celebrate --frames 8 --out qa/mascots/celebrate`. MP4 previews are planned.
  5. **[H] A character animator polishes faces and hero clips** (recommended). **[H] Sign-off per clip.**
- **Optional (bipeds only):** an Uthana motion seed, exaggerated ×1.3.

**4.4 Export, optimise, integrate** · [W]
- **Do:**
  - **Export** (or use `--export-glb` from 4.3):

    ```bash
    pnpm blender:export --blend art/source/3d/mascot_<id>/mascot_<id>.blend --out art/_work/mascots/<id>/raw.glb --rigify-names
    ```

    - Fixed settings: `export_animation_mode='ACTIONS'`, `export_morph=True`, `export_def_bones=True`, `export_apply=False`, `export_skins=True`, `export_influence_nb=4`.
    - `--rigify-names` renames `DEF-*` bones to the runtime names (`hips`, `spine`, `chest`, `neck`, `head`, …; `DEF-x.L` → `x_L`). A Rigify control bone that already holds one of those names is moved aside to `<name>_ctrl`. Only deform bones are exported, so nothing shipped changes. A real name collision is an error. `--rename-map` takes an explicit map.
  - **Optimise and gate:**

    ```bash
    pnpm gltf:optimize art/_work/mascots/<id>/raw.glb public/assets/mascots/mascot_<id>.glb --mascot
    ```

    - `tools/gltf/optimize.sh` runs `gltf-transform optimize --compress meshopt --texture-compress webp --texture-size 1024 --join false --simplify false --flatten false --palette false`, then `validate` (exit 2 on errors), `inspect`, and `budget.mjs` (exit 3 on a breach).
    - A failed optimise never leaves a stale output behind (exit 1).
    - `palette` stays off so material names survive (the placeholder recolours by material name). `join`, `flatten` and `simplify` stay off so the `eye_*`/`mouth_*` meshes, skins and node names survive.
    - **WebP is the default.** KTX2 is opt-in (`--texture-compress ktx2 --allow-ktx2`), and only once the runtime self-hosts the Basis transcoder. This settles the research split (ktx2 + palette vs WebP + no palette).
  - **Integrate:** point `url` in `src/mascots/characters.ts` at the GLB. The runtime handles the render target in Pixi's GL context, toon ramp, outline, mixer and spring bones.
- **Gate** (`budget.mjs --mascot`):
  - < 15k triangles; ≤ 65 bones (30–60 target); textures ≤ 1024 px; ≤ 1.5 MiB; ≤ 4 weights per vertex; no Draco; ≤ 2 draw calls;
  - every canonical clip present;
  - `surprised`/`angry` morphs present (fail). `blink_L`, `blink_R`, `smile` and `frown` only warn: an **OPEN DECISION**, see [ANIMATION_CONTRACT §7.4](ANIMATION_CONTRACT.md#74-morph-targets--15);
  - the RobotExpressive placeholder fails `--mascot` (placeholder clip names, 19 draw calls), as expected;
  - then `pnpm qa:review --scenarios mascots` gets a clean critique.

**4.5 Low-tier fallback** · [W]
- **Do:** bake `idle` + `react_small` at 12 fps from the same rig (EEVEE, `film_transparent`, orthographic camera). No script exists for this yet.
- **Out:** `public/assets/mascots/mascot_<id>_fallback.{webp|ktx2,json}`.

---

## Phase 5: 3D inserts, VFX, cinematics

**5.1 Baked 3D symbol inserts** · [W] ([tools/blender](../tools/blender/README.md#render_symbolpy-baked-3d-inserts-pipeline-51-animation_contract-81))
- **Do:** render from one shared scene template. Only the W and S 3D turns, the coin spin and the shatter:

  ```bash
  pnpm blender:symbol --sym W --mesh art/source/3d/props/W.glb --clip turn --engine BLENDER_EEVEE   # workstation GPU
  pnpm blender:symbol --sym coin --proc coin --clip spin                                         # default Cycles CPU: deterministic reference
  pnpm blender:symbol --sym W --mesh art/source/3d/props/W.glb --clip static                     # frame-1 reference
  pnpm blender:symbol --sym W --mesh art/source/3d/props/W.glb --clip turn --static build/frames/W_static/W_static_0001.png
  ```

  - Subjects: `--mesh` (a prop GLB/OBJ/FBX, e.g. an image-to-3D result), `--proc coin|gem`, or `--glyph` for a royal letter. `--glyph W` would only render the letter W as a placeholder; the Wild and Scatter need their prop mesh.
  - Output names use the game id: `--glyph K` resolves to `L2`, so its frames go to `build/frames/L2_turn/`.
- **Out:**
  - `build/frames/<ID>_<clip>/<ID>_<clip>_0001.png`: frames only, one AssetPack `{tps}` folder per clip. 2x supersampled, Lanczos down in premultiplied alpha, bottom-centre pivot, 24 fps. The shatter uses a 1.6× canvas ([ANIMATION_CONTRACT §8.1](ANIMATION_CONTRACT.md#81-baked-3d-inserts)).
  - `build/qa/blender/<ID>_<clip>/{sheet.png,qa.json,anim.json,manifest.json}`.
  - Trim for packing: `tools/.venv/bin/python tools/video/flipbook.py build/frames/W_turn "build/pack/W_turn{tps}" --name W_turn --pivot bottom-center --expect-frames 24`.
  - At runtime each clip is an `AnimatedSprite` attached with `addSlotObject`.
- **Gate** (implemented, in `qa.json`, exit 3): frame count; alpha bounds; loop seam (exact and ratio); frame 1 equals the intact render (shatter) or the static sprite (`--static`); outline ≥ 3 px; no hull bleed in concave counters; pivot drift; the shatter ends empty.
  - Cycles CPU emission toon is the deterministic CI reference. The K turn is bit-exact; the coin matches within ≤ 8/255 on ≤ 0.05% of pixels (`tools/blender/tests/compare_frames.py`).
  - EEVEE on a GPU is unverified and is not a bit-exact reference.

**5.2 Live FX library** · [C]
- **Do:** write the FX style guide (look-dev frames from `vfx_keyframe.txt`) and extend `src/fx`:
  - coin shower (SoA);
  - sparkle, land puff;
  - MeshRope trail, lightning;
  - neon flicker (the frame beam's tube lives here);
  - shockwave, title shine, background smoke.

  They are triggered by Spine `vfx` events and the win tier (FX ids in [ANIMATION_CONTRACT §8.2](ANIMATION_CONTRACT.md#82-fx-ids)).
- **Gate:** each effect captured at 390×844 and 1920×1080 with 4× CPU throttling (`pnpm qa:review --scenarios particles,shakeFlash,bigWin:mega --viewport 390x844`). ≤ 3 filters live (1 on the low tier); ≤ 1,000 particles (400 low).

**5.3 Baked flipbooks** · [W]
- **Do:** `blender -b -noaudio -P tools/fx/explosion_toon.py -- --seed N --res 512 --frames 32` (planned script). Explosion, poof and smoke, 3–5 seeds each, posterised and outlined.
- **Keyed AI loops** (exists, [tools/video](../tools/video/README.md)):
  1. `pnpm video:key art/_raw/fx_smoke/v02/raw.mp4 build/frames/fx_smoke fx_smoke --size 256 --fps 24 --fade 12 --key 00FF00` gives a seamless loop crossfade, a key, despill and the frames.
  2. `tools/.venv/bin/python tools/video/flipbook.py build/frames/fx_smoke "build/pack/fx_smoke{tps}" --name fx_smoke --every 2` makes the pack folder.
- **Out:** `art/source/fx/<fx_id>/seed_<n>/*.png` → `build/pack/<fx_id>{tps}/` → AssetPack (Basis ETC1S only with self-hosted transcoders).
- **Fallback:** Houdini FX hero pyro, **only** if art review rejects the Blender versions.

**5.4 Cinematics** (bonus intro, big-win backdrop) · [W]
- **Do:** render in Blender **from the real mascot rigs**, then encode stacked alpha:

  ```bash
  pnpm video:stacked build/frames/<name> public/assets/video/<name>.mp4 --fps 30 --crf 20 --shipped
  ```

  `tools/video/stacked_alpha.sh` encodes the graph below (premultiplied colour on top, alpha below, even sizes, BT.709 tags) and decodes the result back to verify it; tests measured an alpha error of about 0.2–0.3/255.

  ```bash
  ffmpeg -framerate 30 -i f_%03d.png -filter_complex '[0:v]format=rgba,split[c][a];[a]alphaextract[am];[c]premultiply=inplace=1[cp];[cp][am]vstack=inputs=2,format=yuv420p[v]' \
    -map '[v]' -c:v libx264 -crf 20 -preset slow -movflags +faststart public/assets/video/<name>.mp4
  ```

  - At most 2160 px tall (the stacked height is capped).
  - **Titles stay live text.**
- **AI video:**
  - **Higgsfield Kling 3.0 / Seedance 2.0 are for animatics and motion reference** (`video_loop.txt`, `pnpm gen:higgsfield --template video_loop.txt --model seedance_2_0 …`) until cleared.
  - Organic loops use **self-hosted Wan 2.x** (Apache) through this chain:
    1. seam SSIM ≥ 0.97;
    2. Practical-RIFE on the RGB clip;
    3. SAM 2.1/3.1 tracked mask;
    4. BiRefNet matte;
    5. despill + premultiply + posterise.

    Steps 2–5 are planned. Clips generated on a key colour can already go through `pnpm video:key`.

---

## Phase 6: In-engine feel (continuous from phase 3)

**6.1 Constants** · [C]
- **Do:** apply the [ANIMATION_CONTRACT §9](ANIMATION_CONTRACT.md#9-game-feel-constants-research--srccoretimingts) table to `src/core/timing.ts` and the module timing tables (runtime owners).
- **Done:**
  - the land spring: `land.springStiffness` 1400 / `springDamping` 24, about **6 Hz, ζ 0.32**. Measured in the lab: squash 0.854, one rebound to 1.059, settles within ±2% in 150 ms. This is below the research's 7.5 Hz but meets the gate;
  - shake `maxOffset` 22 (was 12);
  - the jurisdiction flags (`disabledTurbo`, `disabledSuperTurbo`, `disabledSlamstop`, `minimumRoundDuration`, `socialCasino`, in `src/flow/jurisdiction.ts`).
- **Still to add:** soft trauma stacking; the hit-stop set; zoom punch, board thump, coins; `drop.maxVelocity`; cosmetics seeded from the round id.

**6.2 Tune and lock** · [C] + [H] eye check
- **Do:** tune live in `pnpm lab` (Tweakpane). Every section registered with `registerTiming` appears there, not just the core `TIMING`. **Export → timing.ts + sections JSON** downloads a patched `timing.ts` plus `timing-sections.json` for the module tables. Then capture the golden run:

  ```bash
  pnpm qa:review --scenarios spin,tumbleChain,anticipation,bigWin:mega,shakeFlash --out qa/golden
  ```

- **Out:** today `qa/golden/<scenario>/{sheet.png,video.mp4,motion.svg}` + `review.json` + `index.html`. Planned: `qa/golden/{trace.json, feelgraph.png}` with per-frame y, sy, trauma, shake offset, zoom, flash and frozen.
- **Gate (CI, ±5% vs golden; planned, no CI job yet):**
  - squash 0.80–0.88;
  - settle ±2% ≤ 150 ms;
  - rebound ≤ 8% SH;
  - no column overlap on any frame;
  - big-win shake 6–14 px;
  - hit-stop frame counts match params;
  - ≤ 3 flashes/s.

---

## Phase 7: Audio

Tools: [tools/audio](../tools/audio/README.md). Live ElevenLabs calls are unverified; the wrappers were tested against a mock server.

**7.1 Generate** · [C]
- **In:** `audio/cues.yaml`, not created yet: copy `tools/audio/cues.example.yaml`. It holds the global key and BPM, and per cue (keyed by `SfxId` / `MusicStem`) the bus, prompt (rendered from `sfx.txt` / `music.txt`), loop flag, 4–8 takes and loudness target. Cue ids are validated against `src/game/events.ts`.
- **Do:**
  - `pnpm gen:sfx --cue <SfxId> --takes 6 [--dry-run]`: ElevenLabs SFX v2 → `pcm_48000` → WAV. Risers use `loop=true`. A partly failed batch resumes take by take.
  - `pnpm gen:music --stem base`, then `--stem freegame --stem bigwin`:
    1. a composition plan in chunks with **no lyric lines**;
    2. the base loop with `store_for_inpainting`;
    3. `conditioning_ref` from every other cue to that base;
    4. `six_stems_v1` stems;
    5. `video_to_music` on the 5.4 big-win render.
  - Stable Audio for variations and seam repair (no wrapper yet).
  - Higgsfield `mirelo_text_to_audio` / `sonilo_music` are acceptable for **drafts and temp tracks only**, until their terms are cleared (`licenses/denylist.json` → `higgsfield-audio`). The generation wrappers refuse them.
- **Out:** `art/_raw/audio_sfx_<SfxId>/vNN/raw_<take>.wav` (music likewise per stem) + sidecars and manifest rows.

**7.2 Pre-filter, then a human picks** · [C] then [H]
- **Do:** the machine pre-filter runs `ebur128`, a double-render seam test, librosa BPM/key, spectrogram PNGs for Claude vision, a LAION-CLAP rank and a Gemini audio critique. Claude then builds an HTML audition page. Today `tools/audio/audio_qa.py` covers loudness, peaks, silence and the loop seam; the rest is planned.
- **[H]:** about **30 minutes of A/B listening per batch**.
- **Out:** `art/source/audio/masters/<cue>_<take>.wav` (48 kHz).

**7.3 Post and integrate** · [C]
- **Do:**
  - **Master** with `pnpm audio:master <master.wav> <out_base> --mode sfx|loop|music --shipped --manifest art/manifest.json`, e.g.:

    ```bash
    pnpm audio:master art/source/audio/masters/land_heavy_01.wav public/assets/audio/sfx/land_heavy_01 --mode sfx --peak -6 --shipped --manifest art/manifest.json
    pnpm audio:master art/source/audio/masters/base.wav public/assets/audio/music/base --mode loop --crossfade-ms 250 --shipped --manifest art/manifest.json
    ```

  - **Loudness:**
    - Music uses 2-pass loudnorm (`I=-16`, `TP=-1`, 48 kHz) and asserts `normalization_type == linear`. When loudnorm refuses linear mode, the tool falls back to a deterministic static gain plus a limiter, never loudnorm's dynamic mode.
    - Loops get an equal-power seam crossfade, and their length is snapped to whole AAC frames so `.m4a` loops have no padding gap.
    - SFX are trimmed, and their peak ceiling is checked on the PCM master (±0.1 dB). The lossy encodes only have to stay unclipped (≤ −0.1 dBFS), because AAC/Opus overshoot sharp attacks by 2–5 dB; the overshoot is reported.
  - **Encode:** WebM-Opus + AAC `.m4a` (optional `.ogg`).
  - **Integrate:** fill `AUDIO_MANIFEST` in `src/audio/manifest.ts` (round-robin arrays per `SfxId`, `.{webm,m4a}` alternation). `pnpm audio:sprite` builds sprites, but the runtime does not read them yet.
  - **QA capture:** record the runtime mix with `MediaRecorder` in Playwright (`--autoplay-policy=no-user-gesture-required`). Planned.
- **Out:** `public/assets/audio/sfx/<SfxId>_<nn>.{webm,m4a}`, `public/assets/audio/music/{base,freegame,bigwin}.{webm,m4a}`, QA and sidecars in each tool's `qa.json`.
- **Gate:** loudness targets met; loop seams clean (gapless playback not yet tested on real devices); unique cues (layered and post-processed, with provenance rows); **[H] final in-game mix listen**.

---

## Phase 8: QA, packaging, release

**8.1 Nightly loop** · [CI nightly] (+ `gpu` runner). The nightly workflow is planned; today `qa.yml` runs on push and PR.
- **Do:**
  - `pnpm licence:audit` (manifest ↔ allow/deny lists, clearances);
  - the Spine validators (`pnpm spine:validate` on every skeleton, `pnpm spine:test`);
  - deterministic captures of every scenario with forced fixture books: idle, spin, each land tier, tumble chain, anticipation, FS trigger, big/mega/epic wins:

    ```bash
    pnpm qa:review --scenarios spin,anticipation,clusterWin,tumbleChain,spots,bigWin:big,bigWin:mega,bigWin:epic,fsTrigger,mascots --out qa/nightly
    ```

  - Claude + Gemini critique the contact sheets (≤ 2576 px) and videos against `qa/rubric.md`. Claude opens **auto-fix PRs** until no "major" issue remains.
- **Out:** `qa/nightly/<scenario>/{f0000.jpg…, sheet.png, video.mp4|webm, motion.svg}` + `review.json` + `index.html`. Planned: `trace.json` and `critique.json` per scenario.
- **Gate:** golden trace within ±5%; feel gates green; licence-audit green.

**8.2 Real devices and photosensitivity** · [W] + BrowserStack/adb + [H]
- **Do:** run a big win with filters on, on a real mid-range Android and an iPhone.
- **Gate:**
  - **p95 frame time < 16.7 ms** from raw traces (chrome-devtools-mcp `performance_start_trace` with `reload:false`, `autoStop:false`, `filePath`) plus rAF/LoAF logs and stats-gl GPU timings;
  - texture memory within budget (≤ 120 MB low tier, ≤ 250 MB desktop);
  - about 100 draw calls or fewer;
  - **EA IRIS** on the big-win, feature and anticipation MP4s fails on Luminance or Red ≥ 2, or Pattern = 1;
  - the `prefers-reduced-motion` and mini-player paths are checked.
- SwiftShader or emulated numbers never count.

**8.3 Package** · [C]
- **Do:**
  - **AssetPack:** `pnpm assets:pack --shipped --manifest art/manifest.json` ([tools/assets](../tools/assets/README.md)). It packs `build/pack` into `public/assets/pack` with 2048 pages, one `{tps}` folder per clip, WebP + PNG, and `@0.5x` for the low tier. It gates relative srcs, page sizes and clip lengths, and refuses any output or cache folder that is or contains the repo, `public/assets`, the entry tree, `$HOME` or `/`, because AssetPack deletes those folders. Basis/KTX2 only with self-hosted transcoders and `import 'pixi.js/ktx2'`. **The runtime does not read `public/assets/pack` yet**: it needs `Assets.init({ basePath: './assets/pack/', manifest })` in `src/`.
  - Spine atlases, GLBs and audio.
  - `pnpm build` → `dist/`. The Vite build strips never-requested library URLs (Pixi banner, KTX/Basis CDN defaults, a GSAP warning, a three.js comment) and drops the dev-only `assets/spine/demo`.
  - Freeze `art/manifest.json` and write `LICENSES.json` (Spine runtime notice, fonts, open models).

  ```bash
  pnpm typecheck && pnpm qa:approval && pnpm licence:audit --release --strict
  ```

- **Gate:** frame counts equal the animation lengths; page sizes are multiples of 4; every asset loads from a relative path; **approval.mjs green** (7 viewports, host allowlist, zero console output, no failed requests); licence audit green in release mode.

**8.4 Sign-off and submission** · [H] (+[B])
- **Do:**
  1. Final video and audio sign-off.
  2. Counsel confirms every clearance, and `licence-audit` is green.
  3. Walk the Stake checklist via the docs MCP ([STAKE_ENGINE §0](STAKE_ENGINE.md#0-the-short-list-what-reviewers-will-hit-first)).
  4. Prepare replay event ids per mode (normal win, big win, wincap, loss, bonus trigger).
  5. Upload the **contents** of `dist/` in ACP and submit.

---

## The QA loop at a glance

```
 build/dev server ──► deterministic capture ──► contact sheets + MP4 + review.json
  (?dev=lab, mock RGS)  (manual clock, 60 fps)    (pnpm capture, qa:review, spine:capture)
          ▲                                                  │
          │                                                  ▼
   fix PR (Claude) ◄── critique.json ◄── Claude vision (Opus / Fable) + Gemini (blind)
          ▲                                                  │
          │                                                  ▼
          └────── numeric gates (feel, perf, IRIS, licence, approval.mjs) ──► [H] sign-off
```

The judges see **frames**, not motion, and neither can hear. So numeric traces, real devices and a human watching and listening remain mandatory.
