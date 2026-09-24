# Production pipeline

This page takes the game from an empty art folder to a Stake Engine submission. Every step lists **who** does it, its **inputs**, the **tool or command**, its **outputs** (exact paths) and the **automated gate** it must pass.

What to buy and install: [STACK](STACK.md). Names, frame windows and events: [ANIMATION_CONTRACT](ANIMATION_CONTRACT.md). Look: [ART_BIBLE](ART_BIBLE.md). Approval rules: [STAKE_ENGINE](STAKE_ENGINE.md).

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
- Every file gets a row in `art/manifest.json` ([schema](../art/manifest.schema.json)).
- Anything whose `licenseId` is not in [`licenses/allowlist.json`](../licenses/allowlist.json) fails CI.

## Tooling status

| Tool | Status | What it does |
|---|---|---|
| `tools/capture/shot.mjs` (+ `browser.mjs`) | **exists** | Deterministic capture: manual clock, step N frames, PNGs + `sheet.png` contact sheet; `--scenario <name>` |
| `tools/qa/animation-review.mjs` | **exists** | Per scenario at an exact 60 fps: frames, `sheet.png`, MP4/WebM, `motion.svg`, `review.json`, and an `index.html` for the AI or a human reviewer |
| `tools/qa/approval.mjs` | **exists** | Stake smoke tests on the production build: dist URL grep, 7 viewports, request-host allowlist, zero console output |
| `?dev=lab`, `?dev=gallery`, `window.__slot` | **exists** | Animation lab with Tweakpane (live `TIMING` edit/export) and a symbol × state gallery. Scenarios: `spin`, `anticipation`, `clusterWin`, `tumbleChain`, `spots`, `bigWin`, `fsTrigger`, `mascots`, `particles`, `shakeFlash`, `symbolLand`, `symbolStates` |
| `mock/rgsMockPlugin.ts` + `mock/books/*` | **exists** | Local RGS plus 7x5 fixture books (loss, tumble chain, FS trigger, big win, wincap …) |
| `art/bible/*`, `licenses/*`, `art/manifest.schema.json`, `.mcp.json.example` | **exists** | Style lock, prompt templates, licence governance, MCP config |
| `tools/split/*.py`, `tools/spine/{gen.py,validate.mjs,preview.ts}` | planned | 2D → Spine |
| `tools/blender/{render_symbol,turntable,cleanup,rig_mascot,build_actions}.py`, `tools/fx/*.py` | planned | 3D and baked FX. A `render_symbol.py` prototype was tested during research |
| `tools/audio/{gen-sfx,gen-music,sprite,prefilter}.ts`, `audio/cues.yaml` | planned | Audio generation and post |
| `tools/validate-asset.ts` (PostToolUse hook + `licence-audit` CI check), `pnpm gen:*` scripts | planned | Governance and one-command generation |

**Order of work.** Phases 3 and 4 run in parallel. Phase 6 runs continuously from phase 3 on. Phase 8's nightly loop starts as soon as the first real asset lands.

---

## Phase 0: Setup and clearances

**0.1 Clearance questionnaire** · [H + counsel]
- **In:** the vendor list in [STACK § Install checklist, Step 0](STACK.md#step-0-accounts-keys-caps-clearances-h).
- **Do:** ask every vendor, in writing, about real-money gambling use, EU/UK distribution, output ownership, training on your inputs and data residency. Ask OpenAI only if you want GPT Image or GPT-6 Astra.
- **Out:** `licenses/clearances/<vendor>.pdf` and `licenses/tos/<vendor>/<yyyy-mm-dd>.pdf`. Set `clearance: "cleared"` in `licenses/allowlist.json`.
- **Gate:** `licence-audit` blocks any `shipped: true` manifest row whose vendor is not cleared. **Clearances gate shipping, not building.**

**0.2 Buy, keys, caps, activations** · [H] (+[B] for dashboards)
- **Do:**
  - Accounts and API keys, with a **spend cap in every dashboard**.
  - Activate Spine once under VNC/Xvfb, then pin the patch with `$SPINE -u 4.3.XX --version`.
  - Request gated `facebook/sam3` access and run `hf auth login`.
  - Complete the OAuth logins for Scenario, Recraft and Higgsfield (`/mcp`, then `select_workspace` on Higgsfield).
- **Gate:** the smoke test in [STACK Step 10](STACK.md#step-10-smoke-test) passes.

**0.3 Control plane** · [W/C], delivered as a PR you review
- **Out:**
  - `.mcp.json` (from `.mcp.json.example`);
  - `.claude/settings.json` (Bash allowlist + `tools/validate-asset.ts` PostToolUse hook);
  - `art/manifest.json` (`{"schemaVersion":1,"rows":[]}`);
  - `.github/workflows/qa.yml` (`anthropics/claude-code-action@v1`, GPU jobs on `[self-hosted, gpu]`);
  - the cloud environment: Custom network, stored credentials, a setup script with ffmpeg 8, Playwright chromium, `ktx` ≥ 4.4 and `basisu`;
  - `qa/rubric.md`, with the Stake checklist pulled through the `stake-docs` MCP.
- **Gate:** `licence-audit` is a **required** GitHub status check.

**0.4 Toolchain** · [W]
- **Do:** see [STACK § Install checklist, Steps 3–7](STACK.md#step-3-toolchain). It covers Node/pnpm, uv venvs (bpy 5.2.2 on Python 3.13; SAM 3 on 3.12), Blender 5.2.2, ComfyUI with allowlisted weights only, ToonOut, Lucida, SkinTokens, Practical-RIFE and IRIS.

---

## Phase 1: Art direction and style lock

**1.1 Art bible and templates** · [C]. **Done:** `art/bible/artbible.json` and `art/bible/prompts/*.txt`.
- From now on every prompt is **rendered** from them (see [prompts/README](../art/bible/prompts/README.md)). Nobody writes prompts by hand.

**1.2 Explore 4 directions** · [C]
- **In:** 4 variants of the style formula's palette/shape block, with the locks unchanged.
- **Do:** for each direction, make 3 probe assets (L1 'A', H1, W) plus mascot key art.
  - **Route A (recommended):** Nano Banana Pro on Vertex at 2K; NB2 Lite for volume.
  - **Route B (Higgsfield):** `higgsfield generate create nano_banana_2 … --resolution 2k --wait --json`, plus optional multi-model A/B on the same prompt.
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

**2.1 Symbols** (H1–H4, W, S) · [C] + [H] batch sign-off
- **In:** `symbol.txt` + `artbible.symbols.<ID>` + the style pack or LoRA.
- **Do:** make two masters per symbol: **beauty**, and **rig-ready** (`{RIG_READY_LINE}` set, parts clear of the body, mouth closed). Use one of these routes:
  - **Route A (Vertex + Scenario, recommended).**
    - Scenario custom-model endpoint with the style LoRA at 2048² on the key colour, *or*
    - NBP `gemini-3-pro-image` with 6–10 style refs at `image_size="2K"`, via the Batch API for bulk.
  - **Route B (Higgsfield).**

    ```bash
    higgsfield generate cost   nano_banana_2 --prompt "$(cat prompt.txt)" --aspect_ratio 1:1 --resolution 2k
    higgsfield generate create nano_banana_2 --prompt "$(cat prompt.txt)" --image art/source/refs/style/01.png \
      --image art/source/refs/style/02.png --image art/source/refs/style/03.png --aspect_ratio 1:1 --resolution 2k --wait --json | tee job.json
    ```

    For interactive work, use the Higgsfield MCP instead: `models_explore` to resolve the Pro id (it may show as `nano_banana_pro`), then `generate_image` → `job_status`. Download every result into `art/_raw/` (manifest `route: "higgsfield-mcp"`). Ships only after the Higgsfield clearance (see [STACK § Image route](STACK.md#image-route-higgsfield-or-vertex--scenario-you-decide)).
  - **Then, either route:**
    1. Matte with ToonOut, or the closed-outline key matte.
    2. Fit onto the **360×360 @2x** canvas at the `cellFill` height, upright.
    3. Make the variants: `_blur` (ffmpeg `avgblur=sizeX=1:sizeY=14` on a padded canvas) and `_glow` (`gblur` sigma 14, gold `#FFD54A`).
- **Out:**
  - `art/_raw/sym_<ID>/v<NN>/{prompt.txt,args.json,refs/,job.json,raw.png}`
  - `art/source/symbols/<ID>/master_2048.png` (straight alpha)
  - `build/pack/symbols{tps}/sym_<ID>{,_blur,_glow}.png` (AssetPack input)
  - manifest rows
- **Gate:** palette ΔE, outline histogram, silhouette confusion, DINOv2 style similarity, halo on black and white, no text, canvas and pivot. Failures regenerate automatically (at most 2), then go to [H] **batch sign-off**.

**2.2 Royals, UI, logo, backgrounds, frame** · [C] + [H] for the logo
- **Royals (L1–L5).**
  - Build vector glyphs from the bundled Lilita One / Titan One: 8 px black stroke @2x, plum `#4B283D` extrusion 12–20 px @2x toward the lower right, face hue per the art bible.
  - Rasterise with `@resvg/resvg-js`.
  - Optional `royal_material_pass.txt` (NBP edit), then re-matte and ECC-register back onto the vector alpha.
  - **Out:** `art/source/ui/royal_<ID>.svg`, `build/pack/symbols{tps}/sym_L<n>*.png`.
- **UI.** Recraft V4 Styles SVG with the `style_id` (hex buttons in 4 states, icons) → resvg at 1x/2x. **Out:** `art/source/ui/*.{svg,png}`.
- **Logo.** An NBP emblem (no letters) + Recraft vectorise. [H] a typographer sets the word-mark; [H] trademark search. **Out:** `art/source/logo/*.svg`.
- **Backgrounds.**
  - `background.txt` A at 4K: 21:9 cropped to 2:1, and 9:16 outpainted to 1:2.
  - B: separate back/mid/front layers.
  - C: the neon-only additive layer.
  - D: the bright game-tile plate.
  - **Out:** `art/source/backgrounds/bg_{16x9,9x16}_{back,mid,front}.png` + neon layers, and the free-spins variants.
- **Frame.** `frame_piece.txt` for beam, post, sill and corner cap on `#FF00FF` → matte → 3-slice. **Out:** `art/source/ui/frame_{beam,post,sill,cap}.png`.
- **Gate:** the same gates as 2.1. Backgrounds are also checked for readable text or signage (OCR) and a darker centre (mean luminance of the central 60% below the edges).

**2.3 Mascot sheets** · [C] + [H] approval
- **Do:**
  1. `mascot_turnaround.txt` A: the design model sheet at 4K 21:9, ≤ 14 refs. [H] approves identity and **adult proportions**.
  2. `mascot_turnaround.txt` B: one **unlit, outline-free, grey-background** image per view: front, left, back, right.
  3. `mascot_expressions.txt` A–D: expressions, mouth/eye shapes, hands, key poses.
- **Out:** `art/source/mascots/<name>/turnaround/{front,left,back,right}.png`, `art/source/mascots/<name>/sheets/*.png`.
- **Gate:** DINOv2 identity vs the approved front view; adult-proportions check (head ≤ ~¼ of height); no forbidden words in the rendered prompts.

---

## Phase 3: 2D → Spine (symbols)

**3.1 Matte and split into parts** · [W]
- **In:** the rig-ready `master_2048.png`.
- **Do** (`tools/split/*.py`):
  1. **Matte.** ToonOut by default; A/B against Lucida and `rembg -m birefnet-general -dc`. Never the default rembg model.
  2. **Plan.** Claude writes **`parts.json`** against the taxonomy: `body`, `head`, `eye_L/R`, `pupil_L/R`, `lid_L/R`, `mouth_{closed,open,smile}`, `prop`, `fx_glow`, plus the per-symbol parts in the art bible. Each part has a parent, z-index, bbox, 2–5 positive/negative points and a joint guess.
  3. **Masks.** **SAM 3.1** from those boxes and points, resolved into one exclusive partition by z-order, with edges refined by BiRefNet on each crop.
  4. **Hidden-area fill.** FLUX.1 Fill [pro] (`POST https://api.bfl.ai/v1/flux-pro-1.0-fill`, `output_format: png`). Fallbacks: NBP edit (`symbol_parts_sheet.txt#C`), then local Qwen-Image-Edit-2511. Composite so **original visible pixels stay locked**, then re-register with OpenCV ECC/SIFT.
  5. **Joints.** joint = centroid of dilate(child) ∩ parent, snapped to the child's round overlap cap.
  6. **State variants.** Blink and mouth shapes (`symbol_parts_sheet.txt#D`), registered to the same canvas.
  7. **PSD.** `psd-tools` writes a tagged PSD (`[bone:*]`, `[slot:*]`, `[origin]`) for artist round-trips.
- **Out:** `art/source/spine/images/sym_<ID>/<part>.png` (2x, 2–4 px padding), `art/source/symbols/<ID>/{parts.json, rig.yaml, master.psd}`.
- **Gate:** rest-pose reassembly **SSIM > 0.98** and **alpha IoU > 0.99**; **no holes** when any bone rotates ±35° or scales ±15%; fill colour **< 3 ΔE** against the visible part.

**3.2 Generate the skeleton** · [C]
- **Do:** `python tools/spine/gen.py art/source/symbols/<ID>/rig.yaml -o build/spine/sym_<ID>.json`. Evaluate `spine-rigc` 1.1.0 as the generator or format reference first. The generator emits 4.3 JSON:
  - one root `constraints[]`;
  - code-computed absolute beziers;
  - shapely meshes with inverse-distance weights;
  - physics defaults 484 / 0.833;
  - every animation and event in [ANIMATION_CONTRACT §3–4](ANIMATION_CONTRACT.md#3-symbol-animations).

**3.3 Validate** · [C]
- **Do:** `node tools/spine/validate.mjs build/spine/sym_<ID>.json` (on `@esotericsoftware/spine-core` 4.3.13).
- **Gate:**
  - no NaN;
  - loop seams checked with `loop=false`;
  - required events present, stepping 2 frames past the end;
  - duration windows;
  - `land` inside the cell;
  - budgets (≤ 30 bones, ≤ 250 vertices, ≤ 8 slots, no clipping);
  - 4.3 constraint format;
  - no sequence attachments.

**3.4 Spine CLI** · [W]. **Tee stdout and fail on any warning line**, because missing images still exit 0.

```bash
$SPINE -u 4.3.XX --hide-license --disable-audio -i build/spine/sym_<ID>.json -o art/source/spine/sym_<ID>.spine --to sym_<ID> --replace -r
$SPINE -u 4.3.XX -i 'art/source/spine,**/*.spine' -m                                         # clean up animations
$SPINE -u 4.3.XX -i 'art/source/spine,**/*.spine' -o public/assets/spine --set nonessential=false -e binary
$SPINE -u 4.3.XX -i art/source/spine/images -o public/assets/spine -n symbols -j 'art/source/spine,sym_*.spine' -p config/spine/pack-symbols.json
```

- **Out:** `art/source/spine/sym_<ID>.spine` (git-LFS), `public/assets/spine/sym_<ID>.skel`, `symbols.atlas` + `symbols.png` + `symbols@0.5x.*` (PMA, 2048, polygons). Keep a `-e json` export in `build/` for diffs.

**3.5 Visual critique loop** · [C/W]
- **Do:**
  1. Render bulk previews (`tools/spine/preview.ts` on `spine-canvaskit`) and **in-game** captures at 128–160 px cells with onion skins:

     ```bash
     node tools/qa/animation-review.mjs --url http://localhost:5173/ --scenarios symbolLand:H1,symbolStates:H1 --every 2 --out qa/sym_H1
     node tools/capture/shot.mjs --url "http://localhost:5173/?dev=gallery" --frames 120 --every 4 --sheet --out qa/sym_H1/gallery
     ```

  2. Claude (Opus per iteration, **Fable 5.1 for the final pass**) and Gemini critique **blind** against the rubric: timing and spacing, anticipation and overshoot, squash and stretch, overlap, arcs, silhouette at cell size, loop pop, jitter, AI-slop tells.
  3. Claude edits `rig.yaml` or the motion parameters and repeats from 3.2.
- **Out:** `qa/sym_<ID>/critique.json`.
- **Gate:** no issue rated "major" by either judge.

**3.6 Optional human polish** · [H]
- **Do:** a contract Spine animator polishes W, S and H1. Claude validates the JSON export of their rig, then keeps adding animations to it: `$SPINE … -i build/spine/sym_W.anims.json -o art/source/spine/sym_W.spine --to sym_W -a <anim> --replace -r`.

---

## Phase 4: 3D mascots (runs in parallel with phase 3)

**4.1 Mesh bake-off** · [W]
- **In:** `art/source/mascots/<name>/turnaround/{front,left,back,right}.png` (3D-input views).
- **Do:** make 3 candidates per mascot.

  ```bash
  tripo make front.png left.png back.png right.png --model tripo-v3.1 -p face_limit=15000 --dry-run --json   # then without --dry-run
  ```

  - Meshy MCP: `meshy-7` multi-image (beta) **and** a single-image run with `ultra_mode`.
  - Rodin Gen-2.5-High (Raw) via the `rodin3d-skill` plugin.
  - Then `blender -b -P tools/blender/turntable.py -- cand.glb out/` renders 8-angle EEVEE toon turntables.
- **Out:** `art/_work/mascots/<name>/cand_*.glb` + turntables. Claude ranks the candidates against the art.
- **Gate:** [H] **veto**.

**4.2 Cleanup and rig** · [W]
- **Do:** `blender -b -P tools/blender/cleanup.py` then `blender -b -P tools/blender/rig_mascot.py`:
  - weld, clear custom normals, QuadriFlow to **8–20k faces**;
  - **discard the AI texture** in favour of 4–8 flat toon colours;
  - procedural eyes and lids with a UV-offset pupil atlas; 8–15 shape keys (names in [ANIMATION_CONTRACT §7.4](ANIMATION_CONTRACT.md#74-morph-targets--15));
  - rig: Rigify (non-humanoid parts: `limbs.spline_tentacle`, `face.skin_eye`, `face.skin_jaw`), or a Tripo/Meshy biped rig, plus face, `spring_*` and squash bones;
  - weights: SkinTokens `--use_skeleton --use_transfer`;
  - Claude reviews range-of-motion renders for candy-wrapper twisting and weight tearing.
- **Out:** `art/source/3d/mascot_<id>/mascot_<id>.blend` (id = `gumbo` | `croak`).

**4.3 Animate from JSON** · [W] + [H]
- **Do:**
  1. Claude writes `art/source/3d/mascot_<id>/anim/<clip>.json` for every clip in [ANIMATION_CONTRACT §7.2](ANIMATION_CONTRACT.md#72-clip-names-canonical--what-the-runtime-loads): key poses per control, BACK/ELASTIC/BOUNCE easing, 2–4 frame holds, offset overlap, loop flag.
  2. `blender -b mascot_<id>.blend -P tools/blender/build_actions.py -- anim/*.json` builds the Actions. Loops get matched first and last keys.
  3. MP4 previews and contact sheets go to Claude + Gemini for critique.
  4. **[H] A character animator polishes faces and hero clips** (recommended). **[H] Sign-off per clip.**
- **Optional (bipeds only):** an Uthana motion seed, exaggerated ×1.3.

**4.4 Export, optimise, integrate** · [W]
- **Do:**
  - Export with `export_scene.gltf(export_animation_mode='ACTIONS', export_morph=True, export_def_bones=True, export_apply=False, export_skins=True, export_influence_nb=4)`, renaming `DEF-*` bones to the runtime names (`hips`, `spine`, `chest`, `neck`, `head`, …).
  - Optimise:

    ```bash
    npx gltf-transform optimize raw.glb public/assets/mascots/mascot_<id>.glb --compress meshopt \
      --texture-compress webp --texture-size 1024 --join false --simplify false
    npx gltf-transform validate public/assets/mascots/mascot_<id>.glb && npx gltf-transform inspect public/assets/mascots/mascot_<id>.glb
    ```

    Research 2 used `--texture-compress ktx2 --palette true`; research 1 used WebP and `--palette false`. **Default to WebP** until the runtime self-hosts the KTX2 transcoder. Keep whichever palette setting preserves the `eye_*`/`mouth_*` meshes.
  - Integrate: point `url` in `src/mascots/characters.ts` at the GLB. The runtime handles the render target in Pixi's GL context, toon ramp, outline, mixer and spring bones.
- **Gate:** < 15k triangles, ≤ 65 bones, 1–2 draw calls, ≤ ~1.5 MB; every canonical clip present; `surprised`/`angry` morphs present. `node tools/qa/animation-review.mjs --scenarios mascots` gets a clean critique.

**4.5 Low-tier fallback** · [W]
- **Do:** bake `idle` + `react_small` at 12 fps from the same rig (EEVEE, `film_transparent`, orthographic camera).
- **Out:** `public/assets/mascots/mascot_<id>_fallback.{webp|ktx2,json}`.

---

## Phase 5: 3D inserts, VFX, cinematics

**5.1 Baked 3D symbol inserts** · [W]
- **Do:** EEVEE from one shared scene template. Only the W and S 3D turns, the coin spin and the shatter:

  ```bash
  python tools/blender/render_symbol.py --engine BLENDER_EEVEE --clip turn --glyph W --size 256 --ss 2 --frames 24 --out build/frames/W_turn
  ```

- **Out:** `build/frames/<ID>_<clip>/<ID>_<clip>_0001.png`: 2x then Lanczos down, bottom-centre pivot, 24 fps. AssetPack packs **one `{tps}` folder per clip**; at runtime each clip is an `AnimatedSprite` attached with `addSlotObject`.
- **Gate:** frame 1 equals the static sprite; loop seam; alpha bounds; pivot drift; outline ≥ 3 px; no hull bleed in concave counters. Cycles CPU emission-toon is the deterministic CI reference.

**5.2 Live FX library** · [C]
- **Do:** write the FX style guide (look-dev frames from `vfx_keyframe.txt`) and extend `src/fx`:
  - coin shower (SoA);
  - sparkle, land puff;
  - MeshRope trail, lightning;
  - neon flicker (the frame beam's tube lives here);
  - shockwave, title shine, background smoke.

  They are triggered by Spine `vfx` events and the win tier (FX ids in [ANIMATION_CONTRACT §8.2](ANIMATION_CONTRACT.md#82-fx-ids)).
- **Gate:** each effect captured at 390×844 and 1920×1080 with 4× CPU throttling (`?dev=lab` scenarios `particles`, `shakeFlash`, `bigWin`). ≤ 3 filters live (1 on the low tier); ≤ 1,000 particles (400 low).

**5.3 Baked flipbooks** · [W]
- **Do:** `blender -b -noaudio -P tools/fx/explosion_toon.py -- --seed N --res 512 --frames 32`. Explosion, poof and smoke, 3–5 seeds each, posterised and outlined.
- **Out:** `art/source/fx/<fx_id>/seed_<n>/*.png` → `public/assets/fx/*.{webp,json}` (Basis ETC1S only with self-hosted transcoders).
- **Fallback:** Houdini FX hero pyro, **only** if art review rejects the Blender versions.

**5.4 Cinematics** (bonus intro, big-win backdrop) · [W]
- **Do:** render in Blender **from the real mascot rigs**, then encode ffmpeg stacked alpha:

  ```bash
  ffmpeg -framerate 30 -i f_%03d.png -filter_complex '[0:v]format=rgba,split[c][a];[a]alphaextract[am];[c]premultiply=inplace=1[cp];[cp][am]vstack=inputs=2,format=yuv420p[v]' \
    -map '[v]' -c:v libx264 -crf 20 -preset slow -movflags +faststart public/assets/video/<name>.mp4
  ```

  - At most 2160 px tall.
  - **Titles stay live text.**
- **AI video:**
  - **Higgsfield Kling 3.0 / Seedance 2.0 are for animatics and motion reference** (`video_loop.txt`) until cleared.
  - Organic loops use **self-hosted Wan 2.x** (Apache) through this chain:
    1. seam SSIM ≥ 0.97;
    2. Practical-RIFE on the RGB clip;
    3. SAM 2.1/3.1 tracked mask;
    4. BiRefNet matte;
    5. despill + premultiply + posterise.

---

## Phase 6: In-engine feel (continuous from phase 3)

**6.1 Constants** · [C]
- **Do:** apply the [ANIMATION_CONTRACT §9](ANIMATION_CONTRACT.md#9-game-feel-constants-research--srccoretimingts) table to `src/core/timing.ts` (runtime owners):
  - the 7.5 Hz ζ 0.32 land spring;
  - soft trauma stacking;
  - the hit-stop set;
  - zoom punch, board thump, coins, flash;
  - the jurisdiction flags (`disabledTurbo`, `disabledSuperTurbo`, `disabledSlamstop`, `minimumRoundDuration`, `socialCasino`);
  - cosmetics seeded from the round id.

**6.2 Tune and lock** · [C] + [H] eye check
- **Do:** tune live in `?dev=lab` (Tweakpane) and export back into `timing.ts`. Capture the golden run:

  ```bash
  node tools/qa/animation-review.mjs --url http://localhost:5173/ --scenarios spin,tumbleChain,anticipation,bigWin:mega,shakeFlash --out qa/golden
  ```

- **Out:** `qa/golden/{trace.json, feelgraph.png}` (planned format: per-frame y, sy, trauma, shake offset, zoom, flash, frozen).
- **Gate (CI, ±5% vs golden):**
  - squash 0.80–0.88;
  - settle ±2% ≤ 150 ms;
  - rebound ≤ 8% SH;
  - no column overlap on any frame;
  - big-win shake 6–14 px;
  - hit-stop frame counts match params;
  - ≤ 3 flashes/s.

---

## Phase 7: Audio

**7.1 Generate** · [C]
- **In:** `audio/cues.yaml` (planned): global key and BPM; per cue (keyed by `SfxId` / `MusicStem`) the bus, prompt (rendered from `sfx.txt` / `music.txt`), loop flag, 4–8 takes and loudness target.
- **Do:**
  - `pnpm gen:sfx`: ElevenLabs SFX v2 → `pcm_48000` → WAV. Risers use `loop=true`.
  - `pnpm gen:music`:
    1. a composition plan in chunks with **no lyric lines**;
    2. the base loop with `store_for_inpainting`;
    3. `conditioning_ref` from every other cue to that base;
    4. `six_stems_v1` stems;
    5. `video_to_music` on the 5.4 big-win render.
  - Stable Audio for variations and seam repair.
  - Higgsfield `mirelo_text_to_audio` / `sonilo_music` are acceptable for **drafts and temp tracks only**, until their terms are cleared (`licenses/denylist.json` → `higgsfield-audio`).
- **Out:** `art/_raw/audio/<cue>_<take>.wav` + sidecars.

**7.2 Pre-filter, then a human picks** · [C] then [H]
- **Do:** the machine pre-filter runs `ebur128`, a double-render seam test, librosa BPM/key, spectrogram PNGs for Claude vision, a LAION-CLAP rank and a Gemini audio critique. Claude then builds an HTML audition page.
- **[H]:** about **30 minutes of A/B listening per batch**.
- **Out:** `art/source/audio/masters/<cue>_<take>.wav` (48 kHz).

**7.3 Post and integrate** · [C]
- **Do:**
  - **Loudness:** 2-pass loudnorm (`I=-16`, `TP=-1`, `-ar 48000`; assert `normalization_type == linear`), or static gain + `alimiter` for loops; peak ceilings for SFX.
  - **Encode:** WebM-Opus 96–128k + AAC `.m4a`.
  - **Integrate:** fill `AUDIO_MANIFEST` in `src/audio/manifest.ts` (round-robin arrays per `SfxId`, `.{webm,m4a}` alternation).
  - **QA capture:** record the runtime mix with `MediaRecorder` in Playwright (`--autoplay-policy=no-user-gesture-required`).
- **Out:** `public/assets/audio/sfx/<SfxId>_<nn>.{webm,m4a}`, `public/assets/audio/music/{base,freegame,bigwin}.{webm,m4a}`.
- **Gate:** loudness targets met; loop seams clean; unique cues (layered and post-processed, with provenance rows); **[H] final in-game mix listen**.

---

## Phase 8: QA, packaging, release

**8.1 Nightly loop** · [CI nightly] (+ `gpu` runner)
- **Do:**
  - `licence-audit` (manifest ↔ allow/deny lists, clearances);
  - the Spine validators;
  - deterministic captures of every scenario with forced fixture books: idle, spin, each land tier, tumble chain, anticipation, FS trigger, big/mega/epic wins:

    ```bash
    node tools/qa/animation-review.mjs --url http://localhost:5173/ \
      --scenarios spin,anticipation,clusterWin,tumbleChain,spots,bigWin:big,bigWin:mega,bigWin:epic,fsTrigger,mascots --out qa/nightly
    ```

  - Claude + Gemini critique the contact sheets (≤ 2576 px) and videos against `qa/rubric.md`. Claude opens **auto-fix PRs** until no "major" issue remains.
- **Out:** `qa/<scenario>/{frames/, sheet.png, feel.mp4, trace.json, critique.json}`.
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
  - AssetPack: 2048 pages, one `{tps}` folder per clip, WebP. Basis/KTX2 only with self-hosted transcoders and `import 'pixi.js/ktx2'`.
  - Spine atlases, GLBs and audio.
  - `pnpm build` → `dist/`.
  - Freeze `art/manifest.json` and write `LICENSES.json` (Spine runtime notice, fonts, open models).

  ```bash
  pnpm build && node tools/qa/approval.mjs --serve --port 4173 --out screenshots/approval
  ```

- **Gate:** frame counts equal the animation lengths; page sizes are multiples of 4; every asset loads from a relative path; **approval.mjs green** (7 viewports, host allowlist, zero console output, no failed requests).

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
 build/dev server ──► deterministic capture ──► contact sheets + MP4 + trace.json
  (?dev=lab, mock RGS)  (manual clock, 60 fps)    (tools/capture, tools/qa)
          ▲                                                  │
          │                                                  ▼
   fix PR (Claude) ◄── critique.json ◄── Claude vision (Opus / Fable) + Gemini (blind)
          ▲                                                  │
          │                                                  ▼
          └────── numeric gates (feel, perf, IRIS, licence, approval.mjs) ──► [H] sign-off
```

The judges see **frames**, not motion, and neither can hear. So numeric traces, real devices and a human watching and listening remain mandatory.
