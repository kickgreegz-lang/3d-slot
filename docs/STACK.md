# The recommended AI-controllable production stack

**Snapshot: 2026-09-24.** This is the stack to buy, install and run so that Claude (Opus 5.5) can drive the production of a premium, animation-first Stake Engine slot end to end, with humans only where they add something AI cannot.

It is distilled from two research rounds; see [research/](research/README.md) for the reference copies. Workflow steps are in [PIPELINE](PIPELINE.md), naming and timing in [ANIMATION_CONTRACT](ANIMATION_CONTRACT.md), and look in [ART_BIBLE](ART_BIBLE.md).

**How to read prices.** A price with a link was verified on the vendor's page. **(U)** means unverified: the vendor page was blocked from the research sandbox. **Check every (U) at checkout.** Nothing here is legal advice.

---

## TL;DR

1. **Conductor.** Claude Code on `claude-opus-5-5` drives everything; `claude-fable-5-1` does the final AAA critiques.
   - It runs on a **Linux GPU workstation** via Remote Control, in **Anthropic cloud sessions** for code, API work and QA, and in **GitHub Actions** for nightly QA.
   - Production = committed scripts. Every file produced gets a provenance row in `art/manifest.json`.
2. **2D art.**
   - **Recommended production route:** Nano Banana Pro on **Vertex AI** + a **Scenario** style LoRA + **Recraft** vectors.
   - **Higgsfield** (which you asked for) is fully supported. It serves the same Nano Banana Pro model. Use it now for exploration and animatics; use it for production after the written clearances in [§ Image route](#image-route-higgsfield-or-vertex--scenario-you-decide).
3. **Symbol animation.** **Spine 4.3.** Claude writes the skeleton JSON in code, the official Spine CLI imports, packs and exports it, and `spine-core` validates it headlessly. A human Spine animator is optional, for the Wild, Scatter and top pay.
4. **3D mascots.**
   1. A mesh bake-off between **Tripo / Meshy / Rodin**.
   2. **Blender 5.2** headless cleanup, rig and actions, keyed from Claude-written animation JSON.
   3. GLB export, rendered **three.js toon** inside Pixi's WebGL context.
   4. A human animator polishes faces and hero clips.
5. **3D inserts, VFX and cinematics.** Blender EEVEE toon renders for true 3D turns and shatters. About 70% of effects are live Pixi code. Cinematics are rendered from the **real rigs**, not AI video.
6. **Audio.** **ElevenLabs** (SFX v2 + Music, under an **Enterprise** agreement) plus **Stable Audio** plus ffmpeg mastering. **A human does the listening.**
7. **QA.** Deterministic frame capture → contact sheets → **Claude + Gemini** blind critique → numeric feel gates → real phones + EA IRIS.
8. **Governance.** `licenses/allowlist.json` / `denylist.json`, a manifest row per asset, and a required `licence-audit` check (`pnpm licence:audit`, [tools/licence](../tools/licence/README.md)). **OpenAI models are excluded** unless OpenAI clears real-money gambling in writing.
9. **Budget.**
   - **Phase 1 (lean):** about **$200–400/mo + ~$300 one-off**, no workstation.
   - **Full AAA:** about **$14–22k one-off + $400–900/mo + contracts + people** ([§ Shopping list](#shopping-list)).

**Control tiers:**
- **T1:** Claude drives an official API, CLI or MCP headlessly.
- **T2:** Claude writes the tool's file format directly (e.g. Spine JSON) and official tools validate it.
- **T3:** GUI via a browser or computer-use agent.
- **T4:** a human does it.

**Where work runs:**
- **[W]** Linux GPU workstation (Remote Control / self-hosted runner).
- **[C]** Anthropic cloud session (4 vCPU, 16 GB, no GPU).
- **[CI]** GitHub Actions.
- **[B]** browser agent on your Mac/Windows machine.
- **[H]** human.

---

## Stage table

| # | Stage | Primary | Fallback | Tier | How Claude drives it | Cost | Licence notes |
|---|---|---|---|---|---|---|---|
| 0 | Orchestration | Claude Code (`@anthropic-ai/claude-code` 2.1.281) on Opus 5.5; Fable 5.1 for sign-off. Remote Control on [W], cloud sessions [C], `anthropics/claude-code-action@v1` [CI] | Gemini 3.1 Pro as blind second judge; Codex CLI + GPT-6 Astra **only after OpenAI clearance** | T1 | `claude -p … --mcp-config .mcp.json --output-format json`; `claude --cloud`; committed scripts with one npm script each (`pnpm gen:*`, `spine:*`, `blender:*`, `gltf:*`, `matte*`, `video:*`, `audio:*`, `assets:pack`, `licence:audit`, `qa:*`; see [PIPELINE § Tooling status](PIPELINE.md#tooling-status)); PostToolUse hook `tools/validate-asset.ts` (planned) | Claude Max from $100/mo ([pricing](https://claude.com/pricing)); API Opus 5.5 $4/$20 per MTok, Fable 5.1 $10/$50 ([models](https://platform.claude.com/docs/en/models/overview)) | Ask Anthropic to confirm its usage policy covers building a licensed real-money game (U) |
| 1 | Art direction + style lock | `artbible.json` + prompt templates. [H] picks 1 of 4 directions; [H] paints over 10–20 heroes. **Scenario** trains a style LoRA + one LoRA per mascot on Apache-2.0 bases (Qwen Image, Z-Image, FLUX.2 Klein 4B). **Recraft** Create Style → `style_id` | Layer.ai reference sets (only if they win an A/B); self-host the winning LoRA in ComfyUI | T1 (training) · T4 (pick, paintover) | Scenario MCP (`?toolsets=full`), `sample_prompts`, ≤ 4 epochs, dry-run pricing; DINOv2 + vision pick the winner | Scenario Pro ~$45/mo or Max ~$75/mo (U); paintover artist by quote | Never FLUX.2 dev / Klein 9B as a base (non-commercial). Recraft outputs never go into training. Get a legal opinion before training on NBP-derived images (Gemini no-competing-models clause). The paintover gives copyright authorship. |
| 2 | 2D images (symbols, sheets, props, backgrounds, UI, logo) | **Nano Banana Pro on Vertex** (`gemini-3-pro-image`, ≤ 14 refs, 2K/4K) + **Scenario LoRA** batches at 2048² on a key colour + **Recraft V4 Styles** SVG (royals, UI, frame, logo) rasterised with resvg. **Higgsfield** = the same NBP via MCP/CLI (see § Image route) | NB2 / NB2 Lite drafts; ComfyUI + Qwen-Image-2512 / Edit-2511 (Apache, owned); Ideogram V3 Transparent via Scenario (after clearance) | T1 | Python `google-genai`, Batch API for bulk; prompts rendered from templates; auto-gates regenerate failures (capped) | NBP $0.134 per 1K/2K, $0.24 per 4K; NB2 $0.067/$0.101/$0.15; Batch ~50% off ([Vertex pricing](https://cloud.google.com/vertex-ai/generative-ai/pricing)). Recraft ~$0.08/SVG (U) | Google policy has no gambling clause; EEA/UK needs a paid tier; SynthID cannot be removed. Recraft: paid plan or Recraft owns outputs. **No GPT Image anywhere.** |
| 3 | Alpha matting + Spine part split | ToonOut (MIT) matte, A/B against Lucida and `rembg -m birefnet-general`. **SAM 3.1** masks from Claude-written `parts.json`. Hidden-area fill: FLUX.1 Fill [pro] → NBP edit → Qwen-Edit-2511, with visible pixels locked and ECC re-registration. `psd-tools` writes a tagged PSD | SAM 2.1 (Apache); Qwen-Image-Layered as mask hints only; human edge cleanup | T1 | `tools/split/*.py` on [W] (planned); closed-outline key matte `pnpm matte` and the guarded `tools/matte/rembg_matte.sh` (birefnet only) exist ([tools/matte](../tools/matte/README.md)); FLUX Fill via `POST https://api.bfl.ai/v1/flux-pro-1.0-fill` | FLUX Fill ~$0.05/image; SAM 3 on fal ~$0.005/request or free locally | Never rembg's default model (BRIA RMBG-2.0, non-commercial). See-through excluded (weights licence unstated). |
| 4 | Spine 4.3 authoring | Spine Editor + CLI 4.3.x (Linux `Spine.sh`, one pinned patch). Claude-owned [`tools/spine`](../tools/spine/README.md): `gen.py` (rig.yaml + parametric motion → 4.3 JSON; `spine-rigc` 1.1.0 not evaluated), `validate.mjs` on `spine-core` 4.3.13, contact sheets with `preview/capture.mjs` on spine-pixi-v8 (instead of `spine-canvaskit`) | Contract Spine animator (T4) for W, S and the top high pay; Claude keeps merging new animations into their rig with `-a <anim> --replace -r` | T2 authoring · T1 tooling | `pnpm spine:gen` → `spine:validate` → `spine:capture`. `pnpm spine:export symbol <ID>` wraps `Spine.sh -u 4.3.XX -i build/spine/x.json … -r` / `-m` / `-e binary` / `-p`: it **tees stdout and fails on any warning line**, because missing images still exit 0. The wrapper has only run against a fake Spine binary so far | Professional: one-time per seat, sources conflict at $299 / $369 / $379 (U, [purchase page](https://esotericsoftware.com/spine-purchase)). **Enterprise** by quote (~$7–11k/yr per Vendr, U) | EULA copies say Essential/Pro are void at ≥ $500k/yr revenue + financing, so plan for **Enterprise**. One seat per person who touches rigs or the integrated runtime (≤ 2 computers per seat). All community Spine MCPs excluded. |
| 5 | 3D mascots | Bake-off of 3 candidates each: **Tripo** v3.1 (`tripo-cli` 0.5.1), **Meshy-7** (official MCP 0.5.2), **Rodin Gen-2.5** (official plugin). **Blender 5.2.2 LTS** headless: weld, decimate (or QuadriFlow, untested) to 8–20k faces, 4–8 flat toon colours, procedural eyes, 8–15 shape keys, Rigify / vendor biped rig + face/spring/squash bones, SkinTokens weights, **Actions built from Claude-written `anim/<clip>.json`**. Runtime: three r186 toon in Pixi's GL context | 12 fps baked fallback for low-tier devices; Uthana text-to-motion as a biped base layer (×1.3 exaggeration); **human character animator for faces and hero clips (recommended)** | T1 (+T4 polish/veto) | `tripo make front.png left.png back.png right.png --model tripo-v3.1 -p face_limit=15000 --dry-run --json`; [`tools/blender`](../tools/blender/README.md): `pnpm blender:turntable` / `blender:cleanup` (`cleanup_mascot.py`) / `anim:check` + `blender:actions` / `blender:export --rigify-names` (`rig_mascot.py` planned); `pnpm gltf:optimize raw.glb out.glb --mascot` ([tools/gltf](../tools/gltf/README.md): gltf-transform + budget gate). Tested with bpy as a module; the `blender -b -P` binary path is unverified | Tripo 100–130 credits/task, $/credit (U); Meshy **Pro** required (meshy-7 20–35 credits, rig 5, animate 3); Rodin 0.5 credit/gen, Business plan ~$120/mo (U); Uthana $0.02–0.10 per motion-second (U) | Paid plans only (free outputs are non-commercial or CC BY). Gambling and EU/UK terms (U) for all three; Tripo is Beijing-based, so also check data transfer. Excluded: Hunyuan3D / HY-Motion (no EU/UK/KR), TRELLIS.2 default (nvdiffrast is NC), Mixamo, Cascadeur. |
| 6 | 3D-rendered symbol inserts + props | Blender 5.2.2 headless `render_symbol.py`. EEVEE toon (Diffuse → Shader-to-RGB → constant ColorRamp), inverted-hull outline, `view_transform 'Standard'`. Voronoi-chunk shatter (no Cell Fracture add-on). Procedural bpy letters/coins/gems. Bake **only** true 3D turns and shatters | Cycles CPU emission toon (deterministic cloud/CI reference; the repo tool measured ≈ 0.3–0.5 s/frame at 512 px on shared vCPUs); burst render on RunPod or Modal | T1 | `pnpm blender:symbol --glyph K --clip spin --size 256 --ss 2 --frames 24 --engine BLENDER_EEVEE` → `build/frames/L2_spin/` (outputs use the game id; W and S need `--mesh`). EEVEE on a GPU is unverified | Free apart from GPU time (full 1,152-frame set ≈ 31 CPU-min) | Blender is GPL, but renders are yours |
| 7 | VFX | **Live** (~70%): Pixi `ParticleContainer` + SoA integrator, MeshRope trails, lightning, pixi-filters (Shockwave, AdvancedBloom at half resolution, RGBSplit, MotionBlur, ZoomBlur), custom GLSL filters, GSAP physics; three.quarks for the mascot layer. **Baked**: Blender toon flipbooks (3–5 seeds). **Cinematics**: Blender renders from the real rigs → ffmpeg stacked-alpha H.264 (≤ 2160 px). Titles stay live text | Houdini FX 22 + hython (only if Blender pyro fails art review); self-hosted Wan 2.1/2.2 (Apache) organic loops; Wan-Alpha (MIT). **Higgsfield Kling 3.0 / Seedance 2.0 for animatics only** until cleared | T1 | `blender -b -noaudio -P tools/fx/explosion_toon.py -- --seed N --res 512 --frames 32` (planned); `basisu -ktx2 …`; `pnpm video:stacked` (the stacked-alpha recipe plus a decode-back check) and `pnpm video:key` for key-colour loops ([tools/video](../tools/video/README.md)) | Runtime and Blender free; Houdini FX ~$4,495 perpetual (secondary, U); GPU rental per second (U) | Excluded: MatAnyone (NC), VideoMaMa / SAM2Matting (NC), TransPixeler (NC), Houdini Indie (> $100k). **No text baked into video** (Stake tests every language). |
| 8 | In-engine feel + physics | One clock (Pixi ticker → `gsap.updateRoot(gameTime)`, Spine `autoUpdate:false`), exact damped springs, trauma shake, hit-stop, Spine 4.3 physics (`setPositionInheritance`, `physicsTranslate`), fixed 1/120 s step, Tweakpane lab. **Already partly built** (`src/core/clock.ts`, `src/symbols/spring.ts`, `src/fx/shake.ts`, `?dev=lab`) | Rapier2D deterministic (non-compat, lazy) for coin piles only; lil-gui | T1 | Parameters as data in `src/core/timing.ts` plus each module's `registerTiming` table; all tuned live and exported in `pnpm lab` (`?dev=lab`); asserted on traces (planned) | Free | GSAP Standard "no charge" licence; never bundle Theatre.js studio (AGPL) |
| 9 | Audio | **ElevenLabs** SFX v2 (`eleven_text_to_sound_v2`, `pcm_48000`) + **Eleven Music** (composition plans, stems, `video_to_music`), under an **Enterprise** agreement. ffmpeg 2-pass loudnorm → WebM-Opus + AAC | Stable Audio 2.5/3.0 API (variations, seam inpainting); human sound designer if Enterprise is refused | T1 gen/post · T4 listening | `audio/cues.yaml` (start from `tools/audio/cues.example.yaml`) → `pnpm gen:sfx` / `pnpm gen:music` → `pnpm audio:master` ([tools/audio](../tools/audio/README.md): 2-pass loudnorm asserted linear, else static gain + limiter; WebM-Opus + AAC). Machine pre-filter (Gemini audio critique, LAION-CLAP, ebur128, seam test, spectrogram PNGs) → HTML audition page: only the ebur128/seam part (`audio_qa.py`) exists. ElevenLabs calls tested against a mock server only | ElevenLabs Pro while prototyping, Enterprise by quote (U); Stability $0.20 / $0.26 per generation | Self-serve ElevenLabs reportedly excludes "studio games" (secondary sources), hence Enterprise. Excluded: Suno, Udio, MusicGen/AudioGen/MMAudio, ACE-Step for shipped cues, Higgsfield Mirelo/Sonilo until cleared. Stake requires unique audio. |
| 10 | Packaging → Stake | AssetPack 1.7.0 (2048 pages, **one `{tps}` folder per clip**, WebP; KTX2/Basis only with **self-hosted** transcoders), Spine CLI packs (PMA), glTF-Transform, audio files; Vite static `dist/` | free-tex-packer-core | T1 | `pnpm assets:pack` ([tools/assets](../tools/assets/README.md): frame counts, page sizes, relative srcs; output `public/assets/pack`, not yet read by the runtime); `pnpm gltf:optimize`; `pnpm qa:approval` (`tools/qa/approval.mjs`: relative URLs, request-host allowlist, console silence) | Free | Ship `LICENSES.json` (Spine runtime notice, fonts) + `art/manifest.json` |
| 11 | QA + compliance | Playwright deterministic stepping (`pnpm capture`, `pnpm qa:review`, `pnpm spine:capture`), ffmpeg contact sheets ≤ 2576 px, **Claude vision + Gemini blind second judge**, spine-core validator (`pnpm spine:validate`), golden traces (planned), chrome-devtools-mcp perf traces, real devices (BrowserStack MCP or adb), **EA IRIS**, Stake docs MCP checklist | `@playwright/mcp` for exploratory sessions | T1 | Numeric gates: squash 0.80–0.88, settle ±2% ≤ 150 ms, no column overlap, big-win shake 6–14 px, ≤ 3 flashes/s, p95 frame < 16.7 ms on real mid-range Android + iPhone, IRIS pass, licence-audit green (`pnpm licence:audit`) | Opus vision ≈ $5.18 per 1,000 1-MP images; BrowserStack (U); IRIS/Playwright free | IRIS is BSD-3 and is not a certification |

---

## Image route: Higgsfield or Vertex + Scenario? (you decide)

Both routes call **the same model**. Higgsfield's CLI id `nano_banana_2` **is Nano Banana Pro**, the model Vertex calls `gemini-3-pro-image`. They also use the **same prompt templates** (`art/bible/prompts/`), the same QA gates and the same manifest. The difference is licensing, control and cost, not image quality.

| | **Higgsfield** (MCP + CLI) | **Vertex (NBP) + Scenario (LoRA) + Recraft** |
|---|---|---|
| Model access | NBP plus many others (Seedream, Flux 2, Kling, Seedance, Recraft…) in one account. Great for A/B and **the best one-stop shop for animatics** | NBP first-party; Scenario hosts LoRA training and many models; Recraft for true SVG |
| Style lock | References (≤ 14) + frozen formula only. **No custom style training** (Soul ID is for photoreal faces) | **Trained style LoRA + per-mascot LoRAs**: the strongest cross-batch lock for 20+ symbols |
| Seeds / negatives | None on any image or video model | NBP: none. Scenario LoRA runs keep a seed |
| Agent control | Official hosted MCP (OAuth) + official CLI 1.1.26 + skills. **Open bugs as of 2026-09-24**: [#76](https://github.com/higgsfield-ai/cli/issues/76) (Claude Code OAuth) and [#93](https://github.com/higgsfield-ai/cli/issues/93) (generate schema), so batch through the CLI | `google-genai` SDK + Batch API; Scenario official MCP + REST; all key-based and CI-safe |
| Cost | Credits: Plus $39/mo for 1,000, Ultra $99/mo for 3,000 (annual; monthly $59/$129; from search snippets). MCP/CLI **always** consume credits. NBP ≈ 10–12 credits at 2K via MCP (another source says ~2; measure with `higgsfield generate cost`) | NBP $0.134 per 2K image, **~50% off via Batch**; Scenario Pro ~$45/mo (U) |
| Your content | Terms effective 2026-08-27: no ownership claim, commercial use not restricted (ToS §4.4, from search snippets). **Content trains Higgsfield's models by default; Enterprise can opt out** | Scenario: you own outputs, LoRA weights and training data. Google asserts no ownership of outputs |
| Gambling clause | Not found; page unreadable from research (U) | Google's Prohibited Use Policy has no gambling clause (verified); Scenario none found (U) |
| Indemnity | None known | Vertex runs a generative-AI indemnity programme; confirm this model is on the list |

**Recommendation.** Use both, in this order:

1. **Now:** Higgsfield for exploration, multi-model A/B and animatics or motion reference. It is fast, and you already want it.
2. **Production images:** default to **Vertex NBP + Scenario LoRA + Recraft**. The LoRA lock is the biggest consistency lever, it is cheaper per image, and it has none of the training-on-your-uploads exposure for unreleased mascots.
3. **If you prefer Higgsfield for production images,** get written answers to the questions below first. Then its `nano_banana_2` outputs are as shippable as Vertex's, because it is the same model. Record `route: "higgsfield-cli"` in the manifest.

**What to clear with Higgsfield in writing before shipping anything made there:**
1. Training opt-out for your workspace (Enterprise), plus deletion and retention of uploaded references and generated mascots.
2. Real-money gambling use is permitted, including distribution in the EU/UK.
3. Output ownership and confidentiality for unreleased game IP.
4. That upstream model terms pass through as expected. Google's terms apply to NBP. Confirm no OpenAI models were used; `gpt_image_2` / `gpt_image_2_5` are on the denylist.
5. Terms for its audio models (`mirelo_text_to_audio`, `sonilo_music`) if you want them beyond drafts.
6. Whether the free-plan watermark (reported, unverified) and plan tiers affect commercial rights.

File the replies in `licenses/clearances/higgsfield.pdf` and flip `clearance` to `cleared` in `licenses/allowlist.json`.

## OpenAI, GPT-6 Astra and ChatGPT Atlas

You asked for ChatGPT Astra (GPT-6 Astra) alongside Claude. It is a strong model, and its image models (GPT Image 2.5) are technically the best at native transparent PNGs and on-image text. The problem is policy, not quality:

- **OpenAI's Usage Policies (effective 2025-10-29) list "real money gambling" as a prohibited use**, and its Commerce Policies bar gambling services ([archived text](https://github.com/OpenTermsArchive/genai-versions/blob/main/ChatGPT/Acceptable%20Use%20Policy.md)).
- That applies whether you call OpenAI directly or through **Higgsfield, fal, Replicate, Layer or Scenario**.
- So GPT Image 2/2.5 art, and GPT-6 Astra as co-orchestrator or reviewer, stay **off until OpenAI confirms in writing** that building art and tooling for a licensed real-money slot is allowed. If they do, GPT-6 Astra slots in as a blind second judge through Codex CLI (MCP via `config.toml`), and GPT Image 2.5 gives native alpha.
- **Meanwhile** Gemini 3.1 Pro is the second judge. Alpha comes from ToonOut/BiRefNet matting (or Ideogram V3 Transparent after clearance).
- **ChatGPT Atlas** reportedly shut down on 2026-08-09. That comes from **secondary sources only**; openai.com was unreachable. Web-only chores go to Claude in Chrome on your own machine.

---

## Shopping list

### Phase 1: lean start (weeks 1–6, no workstation)

**Goal:** lock the art direction, generate and approve the symbol set, rig symbols in Spine, stand up the QA loop and prototype audio. The 3D mascot bake-off can start on hosted APIs.

**Where it runs:** Spine and Blender (CPU/Cycles) on **your existing Mac or PC**; API work and QA in cloud sessions.

| Item | Type | Price | Note |
|---|---|---|---|
| Claude Max | monthly | from **$100** ([verified](https://claude.com/pricing)) | Needed for Remote Control, cloud API credentials and Chrome |
| Anthropic API (CI + vision critique) | usage | ~$50–150/mo (estimate) | Opus 5.5 $4/$20 per MTok |
| Google Cloud (Vertex, paid tier) | usage | ~500 NBP 2K images ≈ **$67**, half that via Batch | Exploration + symbols |
| Higgsfield | monthly | Plus **$39**/mo (1,000 credits) or Ultra **$99**/mo (3,000), annual billing; monthly $59/$129 (search snippets) | Exploration and animatics; production after clearance |
| Scenario Pro | monthly | ~**$45** (U) | First tier with LoRA training |
| Recraft API units | usage | ~$0.08/SVG (U) | Paid plan or API only |
| FLUX.1 Fill [pro] (BFL) | usage | ~$0.05/call → ~$25 per 500 | Hidden-area fill |
| ElevenLabs Pro | monthly | (U) | **Prototype only**; open the Enterprise conversation now |
| Spine Professional | one-off | $299 / $369 / $379 (sources conflict, U) | **Only while revenue + financing < $500k/yr**; otherwise start Enterprise talks |
| Paintover artist | one-off | by quote | 10–20 hero images; also your copyright record |
| Test phones | one-off | ~$600–1,500 (estimate) | 1 mid-range Android (Snapdragon 7-class) + 1 iPhone on iOS ≥ 17.4. Or start with BrowserStack |

**Phase 1 total:** roughly **$200–400/mo** (Claude Max $100 + API $50–150 + Scenario ~$45 + Higgsfield $0–99), plus ElevenLabs Pro (U), plus **~$100–300 of usage** (Vertex, FLUX Fill, Recraft), plus **~$300–380 one-off** for Spine Pro, plus the paintover quote and phones.

### Full AAA: add once the direction is locked

| Item | Type | Price | Note |
|---|---|---|---|
| Linux GPU workstation (RTX PRO 6000 Blackwell 96 GB, 16–32 cores, 128 GB RAM, 2× 4 TB NVMe) | one-off | ~**$12–15k** complete; the card alone ~$8–9k (U) | Runs Qwen-Edit BF16 (~40 GB), Wan 2.2 A14B (~80 GB), SAM 3, SkinTokens, EEVEE, Spine and ComfyUI at once |
| …or budget box (RTX 5090 32 GB) | one-off | ~**$5k** (U) | FP8/offload; cannot run Wan 2.2 A14B unoffloaded |
| Spine **Enterprise** | annual | by quote; ~$7–11k/yr (Vendr, U) | Assume it for a real-money operator |
| ElevenLabs **Enterprise** | annual | by quote (U) | Written real-money + EU/UK coverage; unlocks `conditioning_ref`/inpainting |
| Scenario Max | monthly | ~$75 (U) | Up to 25 users |
| Meshy Pro | monthly | (U) | Required for API access |
| Hyper3D Business | monthly | ~$120 if the Gen-2.5 API requires it (U) | Rodin candidate |
| Tripo API credits | usage | 100–130 credits/task; $/credit (U) | API credits are separate from the web plan |
| 3D credits across the three vendors | usage | ~$200–500 total (estimate) | |
| Stable Audio API | usage | $0.20 (SA 2.5) / $0.26 (SA 3.0) per generation → ~$40–52 per 200 | |
| BrowserStack Automate | monthly | (U) | Optional |
| RunPod / Modal burst GPU | usage | per second (U) | Optional; Wan-Alpha needs 8×H100 |
| Houdini FX | one-off | ~$4,495 perpetual (secondary, U) | **Only** if Blender pyro fails art review |
| **People** | quotes | **the largest line** | Paintover artist; character animator/rigger (mascot faces, hero clips); optional Spine animator; typographer + trademark search; gaming/IP counsel (~12 vendor ToS) |

**Full AAA indicative totals** (research estimate):
- **One-off** hardware + perpetual licences: **~$14–22k** (excluding people).
- **Subscriptions:** **~$400–900/mo**, plus the Spine Enterprise and ElevenLabs Enterprise contracts.
- **Generation APIs** over the whole production: **~$1.5–4k**.
  - NBP: 3,000 images at 2K ≈ $402, or ~$201 with Batch.
  - NB2: 5,000 at 1K ≈ $335.
  - Opus vision QA: 10,000 frames ≈ $52.
- **Human specialists will cost more than all the AI tooling combined.**

### Cost control (do these on day 1)

- Set a **spend cap in every vendor dashboard** before creating a key.
- **Preview cost before every batch:** `tripo … --dry-run`, `meshy make --dry-run`, the Scenario `dry_run`, `higgsfield generate cost …`.
- Use the **Gemini/Vertex Batch API** for bulk runs (~50% off).
- Log `cost` per asset in `art/manifest.json`, with a monthly CI spend report.
- Pin model ids (never `-preview` in production), and archive every raw output in `art/_raw/` so nothing has to be regenerated.

---

## Install checklist

Run these in order. Items marked **[H]** need you, because they involve payment, legal acceptance, OAuth or GUI activation. Everything else Claude can run on the workstation via Remote Control.

### Step 0: accounts, keys, caps, clearances [H]

- [ ] **Claude Max** (claude.ai login). Remote Control and Chrome need the subscription login, not an API key. Create an **Anthropic API key** for CI.
- [ ] **Google Cloud** project with Vertex AI enabled on a **paid** tier. Then run `gcloud auth application-default login`.
- [ ] **Scenario** (Pro/Max), **Recraft** (API units / paid plan), **Higgsfield** (Plus/Ultra), **BFL** (FLUX Fill), **Tripo** developer console (prepaid credits), **Meshy** Pro, **Hyper3D**, **ElevenLabs** (Pro now, Enterprise talks), **Stability**, optionally **fal**, **BrowserStack**, **RunPod**.
- [ ] **Spend cap in every dashboard.** Keys go in your shell profile or secret store, never in git.
- [ ] **Hugging Face:** request gated access to `facebook/sam3`, then run `hf auth login`.
- [ ] **Clearance questionnaire (day 1, via counsel)** to Google Cloud, Scenario, Recraft, BFL, Ideogram, Tripo/VAST, Meshy, Hyper3D, ElevenLabs, Stability, Higgsfield, Esoteric (Spine Enterprise + the build-machine seat) and Anthropic. Contact OpenAI only if you want GPT Image / GPT-6 Astra.
  - Ask each about: real-money gambling; EU/UK distribution; output ownership; training on your inputs; data residency.
  - Save replies to `licenses/clearances/<vendor>.pdf` and ToS snapshots to `licenses/tos/<vendor>/<yyyy-mm-dd>.pdf`.
  - **Clearances gate shipping, not building.**

### Step 1: Claude Code everywhere

```bash
npm i -g @anthropic-ai/claude-code          # research pinned 2.1.281
claude                                       # log in with the claude.ai account (Max)
claude remote-control                        # on the workstation: steer it from web/phone
```

### Step 2: workstation OS and GPU (Linux, Ubuntu 24.04 LTS)

- Why Linux: headless EEVEE over EGL, `Spine.sh`, CUDA and a self-hosted runner all run natively, with no `cmd /c npx` quirks. GUI and computer-use work stays on your own Mac or Windows machine.
- Install the NVIDIA driver with **EGL + Vulkan**, and **CUDA ≥ 12.6** (e.g. `sudo ubuntu-drivers install`, then the CUDA toolkit).
- Register the machine as a **GitHub self-hosted runner** with label `gpu`.

### Step 3: toolchain

```bash
# Node + pnpm (repo pins pnpm 10.33.0 via packageManager)
#   Node >= 22.12 via nvm or your distro, then:
corepack enable && corepack prepare pnpm@10.33.0 --activate
# Python tooling
curl -LsSf https://astral.sh/uv/install.sh | sh
uv venv ~/.venvs/bpy  --python 3.13 && uv pip install --python ~/.venvs/bpy  bpy==5.2.2 fake-bpy-module-5.2
uv venv ~/.venvs/sam3 --python 3.12 && uv pip install --python ~/.venvs/sam3 sam3==0.1.4
uv venv ~/.venvs/art  --python 3.13 && uv pip install --python ~/.venvs/art \
    google-genai==2.25.0 psd-tools==1.19.0 "rembg[gpu,cli]==2.0.85" shapely==2.1.2 mapbox-earcut==2.1.0 \
    scikit-image opencv-python-headless pillow numpy fal-client==1.0.3
```

The repo's own pipeline tools pin their Python dependencies separately: `tools/requirements.txt` (gen, matte, video, audio, assets, spine; Python ≥ 3.11) and `tools/blender/requirements.txt` (bpy 5.2.2, Python 3.13). See [PIPELINE § Tool setup](PIPELINE.md#tool-setup).

Install these separately:
- **Blender 5.2.2 LTS** (blender.org) on `PATH`. The `pnpm blender:*` scripts use it when `$BLENDER` points at it, otherwise bpy as a module (`$BPY_PYTHON`).
- **ffmpeg 8.** Use a static build; Ubuntu 24.04's apt package is older.
- **KTX-Software ≥ 4.4** (`ktx` on `PATH`, needed by `gltf-transform --texture-compress ktx2`).
- **basisu 2.x.**
- **CMake + vcpkg** for EA IRIS.

### Step 4: Spine [H once]

1. Buy the seat: Professional below $500k/yr revenue + financing, otherwise Enterprise.
2. Install the Linux launcher (e.g. `/opt/spine/Spine.sh`).
3. **Activate once interactively** under VNC/Xvfb. There is no documented CLI activation.
4. Pin the patch:

```bash
export SPINE=/opt/spine/Spine.sh SPINE_VERSION=4.3.XX
$SPINE -u 4.3.XX --version        # choose one stable 4.3 patch; never save projects with a beta
pnpm spine:export version         # the same check through tools/spine/export.sh, which refuses betas and "latest"
```

### Step 5: vendor CLIs and SDKs

```bash
npm i -g @higgsfield/cli@1.1.26 && higgsfield auth login && higgsfield workspace list && higgsfield workspace set <id>
npm i -g tripo-cli@0.5.1          # also provides `tripo mcp`
npm i -g meshy-cli
npm i -g @elevenlabs/cli          # research: 1.3.2
```

### Step 6: MCP servers, skills and plugins

Details and the OAuth vs API-key split are in [MCP_SETUP](MCP_SETUP.md).

```bash
cp .mcp.json.example .mcp.json   # remove unused entries, export the ${VARS}
claude mcp add --transport http --scope user higgsfield https://mcp.higgsfield.ai/mcp
claude mcp add --transport http --scope user recraft    https://mcp.recraft.ai/mcp
claude mcp add --transport http scenario "https://mcp.scenario.com/mcp?toolsets=full"
claude mcp add meshy -e MESHY_API_KEY=$MESHY_API_KEY -- npx -y @meshy-ai/meshy-mcp-server
claude mcp add tripo -e TRIPO_API_KEY=$TRIPO_API_KEY -- tripo mcp
claude mcp add playwright -- npx @playwright/mcp@latest --headless --caps vision,devtools --output-dir qa/mcp
claude mcp add chrome-devtools -- npx chrome-devtools-mcp@latest
git clone https://github.com/StakeEngine/docs ~/stake-docs && (cd ~/stake-docs/mcp-server && pnpm i && pnpm build)
claude mcp add stake-docs -- node ~/stake-docs/mcp-server/dist/index.js
npx skills add scenario-labs/skills
# inside Claude Code:
#   /plugin marketplace add higgsfield-ai/skills      then  /plugin install higgsfield@higgsfield
#   /plugin marketplace add DeemosTech/rodin3d-skills then  /plugin install rodin3d-skill@rodin3d-skills
#   /mcp  -> authenticate higgsfield, recraft, scenario; call select_workspace on higgsfield
```

**[H]:** complete each OAuth login, and redo it when the token expires.

### Step 7: local ML tools (workstation, optional in Phase 1)

```bash
pip install comfy-mcp 'comfy-cli>=1.14.0' && comfy install     # ComfyUI 0.37.0 hub; load ONLY allowlisted weights
```

Also install:
- ToonOut and Lucida (matting);
- SkinTokens (≥ 14 GB GPU) or `skin-tokens.cpp` (CPU/Vulkan);
- Practical-RIFE 4.25/4.26;
- EA IRIS (CMake + vcpkg);
- optionally the Blender Lab MCP for look-dev, in its own venv.

### Step 8: project control plane (Claude does this in a PR you review)

- `.claude/settings.json`: Bash allowlist plus the asset-validation hook, *planned*:

```json
{
  "permissions": { "allow": ["Bash(ffmpeg:*)", "Bash(blender:*)", "Bash(pnpm gen:*)", "Bash(npx playwright:*)", "Bash(./Spine.sh:*)"] },
  "hooks": { "PostToolUse": [ { "matcher": "Write|Edit|Bash", "hooks": [ { "type": "command", "command": "npx tsx tools/validate-asset.ts" } ] } ] }
}
```

- `art/manifest.json` (schema: `art/manifest.schema.json`), plus `licenses/allowlist.json` and `licenses/denylist.json`. These already exist.
- `.github/workflows/qa.yml`: **exists**, with the `licence-audit`, `build` (typecheck, build, approval smoke) and `pipeline-tools` jobs. It has not run on GitHub yet. Still to add: `anthropics/claude-code-action@v1` jobs with `claude_args: --model claude-opus-5-5 --mcp-config .mcp.json --max-turns 30`, and GPU jobs on `runs-on: [self-hosted, gpu]`. Make **`licence-audit`** a **required** status check.
- `qa/rubric.md` with the Stake approval checklist pulled via the `stake-docs` MCP.
- Runtime dependencies from research round 2 (**the `src/` owners decide; not installed here**):
  - `pnpm add howler@2.2.4 @pixiv/three-vrm-springbone@3.5.5 three.quarks@0.17.1 postprocessing@6.39.5`
  - `pnpm add -D @tweakpane/plugin-essentials@0.2.1 stats-gl`
  - Already in `package.json`: `@esotericsoftware/spine-core@4.3.13` (the validator), `@assetpack/core`, `@gltf-transform/cli`, `@resvg/resvg-js`, `playwright`.
  - Not needed by the current tools: `@esotericsoftware/spine-canvaskit` (previews run on spine-pixi-v8) and `@elevenlabs/elevenlabs-js` (`tools/audio` calls the REST API directly).

### Step 9: cloud environment [H once]

- In the Claude Code cloud environment settings, set **Network: Custom**.
- Allowlist the vendor API hosts you call (e.g. `api.elevenlabs.io`, `api.stability.ai`, `api.meshy.ai`, your Vertex endpoint).
- Store the API credentials there.
- Add a **setup script** that installs ffmpeg 8, Playwright chromium, `ktx` ≥ 4.4 and `basisu`.
- Without the Custom allowlist, vendor calls from cloud sessions fail silently.

### Step 10: smoke test

```bash
pnpm i && pnpm dev                                  # then open http://localhost:5173/?dev=lab (or: pnpm lab)
pnpm capture --url "http://localhost:5173/?dev=lab" --scenario symbolLand --frames 90 --sheet --out screenshots/smoke
pnpm gen:higgsfield --template symbol.txt --symbol H1 --resolution 1k --dry-run   # prints the exact request, writes nothing
higgsfield generate cost nano_banana_2 --prompt "test" --aspect_ratio 1:1 --resolution 1k
tripo make front.png --model tripo-v3.1 --dry-run --json
pnpm spine:export version && blender -b --version && ffmpeg -version | head -1
PYTHON=tools/.venv/bin/python pnpm spine:test      # offline self-test of the Spine tools (see PIPELINE § Tool setup)
```

---

## Excluded tools and why

The full machine-readable list, with sources, is in [`licenses/denylist.json`](../licenses/denylist.json). CI fails if a manifest row, workflow or dependency references one of these.

| Excluded | Why | Use instead |
|---|---|---|
| **OpenAI GPT Image 2 / 2.5, GPT-6 Astra, Sora 2**, on any platform (incl. Higgsfield `gpt_image_*`) | OpenAI Usage Policies prohibit real-money gambling; the Sora 2 API shut down 2026-09-24 | NBP + matting; Gemini as second judge. Unblock with written OpenAI clearance |
| **ChatGPT Atlas** | Reportedly shut down 2026-08-09 (secondary sources) | Claude in Chrome |
| **Midjourney** | No official API; its ToS prohibits automation; litigation | Human moodboards only |
| **Tencent Hunyuan** (HunyuanImage 3, Hunyuan3D, HY-Motion, HunyuanVideo-Foley) | Licence excludes EU/UK/South Korea, including outputs | Tripo / Meshy / Rodin; Qwen |
| **Self-hosted FLUX.1 [dev], FLUX.1 Fill [dev], FLUX.2 [dev], Klein 9B** | FLUX Non-Commercial | BFL API (Fill [pro]); Klein **4B** (Apache) |
| **Qwen-Image-2.1**, **Ideogram 4.0 weights** | Research / non-commercial licences | Qwen-Image-Layered / Edit-2511; Ideogram API |
| **rembg default model** (BRIA RMBG-2.0) | CC BY-NC; picked silently when no `-m` flag is given | `rembg -m birefnet-general`, ToonOut, Lucida |
| **TRELLIS.2** default install | nvdiffrast/nvdiffrec are NVIDIA non-commercial | Tripo / Meshy / Rodin |
| **MatAnyone, VideoMaMa, SAM2Matting, TransPixeler** | Non-commercial | SAM tracked mask + BiRefNet; Wan-Alpha |
| **MusicGen / AudioGen / MMAudio** | CC BY-NC weights | ElevenLabs, Stable Audio |
| **Suno, Udio** | No API (Suno) / exports disabled (Udio); ownership conditions | ElevenLabs Music |
| **ACE-Step** (shipped cues), **Stable Audio 3 open weights** (> $1M revenue) | Undisclosed training data / licence terminates above $1M | ElevenLabs, Stable Audio API |
| **Higgsfield Mirelo / Sonilo** (audio) | Terms unknown; drafts only | ElevenLabs, Stable Audio |
| **See-through** | Weights licence unstated; scraped Live2D training data | SAM + fill |
| **All community Spine MCPs**, **Genielabs spine-animation-ai** | 4.2/3.8 formats (4.3 silently drops constraints), a cracked build in one README, PolyForm-NC | Official Spine CLI + our generator |
| **MoMask / MotionGPT** | SMPL / HumanML3D licences | Claude-written anim JSON; Uthana for bipeds |
| **Mixamo, Cascadeur, EmberGen/IlluGen** | GUI-only / no API; kept out of the automated path | Blender headless |
| **Houdini Indie/Apprentice**, **Theatre.js studio** | Revenue cap / non-commercial; AGPL | Houdini FX if needed; Tweakpane |
| **Stake web-sdk sample assets**, **`stake-engine` npm client**, **any runtime CDN request** (Google Fonts, KTX2 transcoder defaults, hot-linked vendor URLs) | Approval: unique assets, console silence, strict no-external-request policy | Original assets; our `src/rgs` client; bundle everything |

---

## Where a human is still needed

Being honest about this saves money. These steps are **T4 by design**, not because tooling is missing:

| Human step | Why AI cannot own it | Effort |
|---|---|---|
| **Pick 1 of 4 art directions** | Taste and brand are your call; Claude and Gemini only score against a rubric | 1–2 h |
| **Hero paintover** (10–20 images) | Removes AI tells, sets the canonical style pack, and **creates the human-authorship record**. Purely AI images are not copyrightable in the US (Thaler v. Perlmutter; cert denied 2026-03-02) | Artist, days |
| **Batch sign-off** on every final 2D asset and mascot turnaround, including the **child-likeness check** | Stake rejects child-like characters; final accountability is yours | ~30 min per batch |
| **Mascot face and acting polish** (character animator/rigger) | Claude keys motion from JSON and critiques frames, but facial acting and hero-clip timing still need a character animator for AAA feel | Contract |
| **3D bake-off veto and per-clip video sign-off** | A judgement call on appeal | Short sessions |
| **Optional Spine animator** for W, S and the top pay | The highest-visibility loops benefit from hand polish; Claude keeps extending their rigs | Contract |
| **Logo:** typographer finish + trademark search | Legal clearance and a unique mark | Contract |
| **Audio A/B listening** and the final mix listen | **Neither Claude nor GPT-6 Astra can hear.** Gemini and metrics only pre-filter | ~30 min per batch |
| **Legal:** vendor clearances + counsel sign-off | Written authority from vendors and your lawyer | Counsel |
| **Purchases, OAuth logins, Spine activation, spend caps** | Payment and licence acceptance need a human; a browser agent may assist, but you approve every purchase | Hours |
| **Real-device check + IRIS review record** | Accountability for photosensitivity and performance on devices BrowserStack does not cover | Per release |
| **Stake submission** (ACP upload and submit) | Not verified as scriptable | Per release |

---

## Hardware

1. **Production workstation: Linux (Ubuntu 24.04 LTS).**
   - GPU: **NVIDIA RTX PRO 6000 Blackwell 96 GB** (~$8–9k street, U).
   - CPU 16–32 cores, **128 GB RAM**, 4 TB NVMe (OS, models, cache) + 4 TB (git-LFS, renders).
   - NVIDIA driver with EGL/Vulkan, CUDA ≥ 12.6.
   - It runs `claude remote-control`, the self-hosted `gpu` runner, and one Spine seat (≤ 2 computers per seat).
   - **Budget option:** RTX 5090 32 GB (~$2k MSRP, U), with FP8 or offload. It cannot run Wan 2.2 A14B unoffloaded, which only matters for self-hosted AI video loops.
2. **Your own Mac or Windows machine:**
   - Claude Desktop computer use (T3 fallback; CLI computer use is macOS-only);
   - Claude in Chrome ≥ 1.0.36 for vendor dashboards (not supported in WSL);
   - human polish in Spine, Blender and Krita/Photoshop;
   - a colour-calibrated monitor and good headphones or speakers for audio A/B.
3. **Anthropic cloud sessions** (4 vCPU, 16 GB, 30 GB disk, no GPU): TypeScript, API-based generation, audio post, SwiftShader correctness QA. Network set to Custom, with stored credentials (Pro/Max).
4. **Real test devices:** one mid-range Android (Snapdragon 7-class) and one iPhone on iOS ≥ 17.4 (needed for WebM-Opus). BrowserStack covers the rest. **Performance numbers from SwiftShader or emulation never count.**
5. **Optional burst GPU:** RunPod or Modal (8×H100 for Wan-Alpha), billed per second (U).

**What runs where:**

| Work | [C] cloud session | [W] workstation | [CI] | [B]/[H] |
|---|---|---|---|---|
| TypeScript, runtime, docs | yes | yes | typecheck | — |
| API image/audio generation (Vertex, Scenario, ElevenLabs, BFL) | yes (Custom network) | yes | nightly (API keys) | — |
| Higgsfield / Recraft MCP (OAuth) | interactive only | interactive | **no** | login |
| SAM 3, ComfyUI, Qwen-Edit, Wan, SkinTokens | no GPU | **yes** | `gpu` runner | — |
| Blender EEVEE renders | Cycles CPU fallback only | **yes** | `gpu` runner | — |
| Spine CLI import/export/pack | no (needs the activated seat) | **yes** | `gpu` runner | activation |
| Capture + contact sheets + vision critique | yes (SwiftShader) | yes | nightly | — |
| Real-device performance | — | adb | BrowserStack | phones |
| Vendor dashboards, purchases, Stake submission | — | — | — | **yes** |

---

## Top open risks

Full list: [research/stack-final.md § openRisks](research/stack-final.md).

1. **Vendor terms are unconfirmed.** Gambling, EU/UK and ownership clauses were unreadable for most vendors, so nothing ships before written clearance. If a vendor refuses, that stage falls back to open weights on the workstation or to human work.
2. **ElevenLabs is a single point of failure for audio.** If Enterprise is refused: Stable Audio API or a human sound designer.
3. **Spine.** Enterprise pricing is quote-only. Headless activation is undocumented. The CLI exits 0 on warnings, so builds must fail on warning lines. Sequence attachments stay off until spine-pixi-v8 ≥ 4.3.14.
4. **The 3D mascot path is the least proven on low-end Android** (shared context + outline pass + 35 physics skeletons + filters). Profile on real devices in month 1 and keep the baked fallback ready.
5. **The feel values were measured in a SwiftShader harness.** Tune by eye against 60 fps captures, and never trust emulated performance.
6. **Young tools:**
   - spine-rigc (1 month old);
   - comfy-mcp (beta);
   - Meshy multi-image (beta), Tripo P2 (preview);
   - Higgsfield MCP (open bugs #76/#93);
   - howler (no release since 2023).

   Pin everything and archive every raw output.
