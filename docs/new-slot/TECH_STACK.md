# Tech stack: the combo that keeps a AAA slot fluid on every phone

This is the full stack a new game is built with, extracted from what the engine **actually runs** (with file references) plus the production pipeline around it.
- **Buying, installing and costs:** [STACK.md](../STACK.md).
- **Per-state technique choice:** [ANIMATION_STATES §2](ANIMATION_STATES.md#2-technique-per-tier-the-tech-stack-combo).
- **Budgets and measurement:** [PERFORMANCE.md](PERFORMANCE.md).

## The idea in one paragraph

One WebGL2 canvas and one clock:
- Every animation system (GSAP tweens, Spine skeletons, springs, particles, the background director, optional three.js) is stepped from the **same frame tick**. Hit-stop, turbo and slam-stop therefore affect everything at once, and nothing drifts.
- Each visual job uses the **cheapest technique that still looks hand-made**:
  - atlas textures for spin;
  - springs and a jelly mesh for lands;
  - pooled Spine rigs only where a character beat is needed;
  - shaders instead of render-target filters;
  - layered plates instead of video for backgrounds.
- **Two quality tiers** scale resolution, pools and effects, and everything else is loaded lazily per orientation and per feature.

That combination gives a stable 60 fps on a mid-range Android without giving up the AAA look.

```
                    ┌───────────────────────── ONE WebGL2 canvas (Pixi 8.21) ─────────────────────────┐
 Pixi ticker ──►    │ background  bgFx │ root (contain-scaled): panel · tiles · spots · BOARD · frame  │
 clock.onTick       │ (cover-scaled)   │   · logo · winLayer · [mascots RT] · fx · hud · overlay      │ screenFx
  ├ gsap.updateRoot │ LayeredEnv.      │   SymbolRig ×N: texture → springs/JellyMesh → pooled Spine   │ flash
  ├ Spine.update    │ plates + lights  │   ParticleContainer (SoA) · symbolFxShader · ≤3 GLSL filters │
  ├ springs / env   └──────────────────┴──────────────────────────────────────────────────────────────┘
  └ three (optional mascots → render target → Pixi sprite, same GL context)
 DOM: menus/modals (yours) ◄── ui:* / hud:* events ──► FlowController ◄── book player ◄── RGS client
```

---

## 1. Runtime stack (what ships in `dist/<game>/`)

| # | Layer | Tech (pinned) | What it does here | Smoothness rules |
|---|---|---|---|---|
| 1 | Build | **Vite 8.3** (rolldown) + **TypeScript 7.0** | Static SPA per game (`GAME=<id>` → `dist/<id>/`, `base: './'`), relative URLs, console and debugger stripped by rolldown minify (`vite.config.ts:97-101`), other games' assets pruned | No CDN, no runtime fetch outside the page origin and `rgs_url`; no manual chunks needed (one ~400 kB gzip main chunk) |
| 2 | Renderer | **PixiJS 8.21** on **WebGL2** (`preference: 'webgl'`, `src/render/app.ts`) | One canvas, a 13-layer stack (`src/render/layers.ts`), `RenderLayer` for win pops over the frame; context loss → reload dialog → resume (`src/render/contextLoss.ts`) | `antialias: false`; DPR cap 2 (1.5 on the low tier); batch-friendly atlases; no per-symbol filters |
| 3 | Clock | **GSAP 3.15** driven by the Pixi ticker (`src/core/clock.ts`) | `gsap.updateRoot(gameTime)`; hit-stop (≤ 120 ms, normal speed only); speed profiles ×1 / ×2 / ×3 that retime running tweens (`followSpeed`); manual stepping for frame-exact QA | Every duration goes through `s()`; every feel number lives in a `registerTiming` table, tunable live in `?dev=lab` |
| 4 | Skeletal animation | **Spine 4.3** runtime `@esotericsoftware/spine-pixi-v8` **4.3.13** (`src/symbols/SpinePool.ts`) | Symbol rigs (land / win / explode / idle / anticipation), UI and environment rigs, 2D characters. Physics constraints for overlap | Pooled, `autoUpdate: false`, ≤ 24 active (12 on the low tier), 4 prewarmed per rig, position inheritance armed by the pool; one shared PMA atlas (+ @0.5x) |
| 5 | Procedural motion | `SymbolRig` + damped springs + `JellyMesh` + `symbolFxShader` (`src/symbols/*`) | Gravity drop, weighted land squash (≈ 6 Hz, ζ 0.32), win pop, dissolve, shine, the full fallback for any missing Spine clip | CPU springs; one 10×10 mesh per animating symbol (pooled); shine, flash and dissolve in one draw with no render target |
| 6 | Characters (optional) | **2D Spine** characters first (Bass Drop's `SpineMascot`); **three.js 0.186** toon mascots optional (`src/mascots/*`, rendered into a render target in Pixi's GL context) | Your concept has **no mascot**: the layer is simply not created | 3D: render target 512×768 at MSAA 4 (341×512 at 2× and 30 fps on low), off in compact/popout, skipped when the tab is hidden |
| 7 | Background | **`LayeredEnvironment`** (`src/environment/`, new) + optional Spine `env_*` rigs + optional video loop | Depth-layered Higgsfield plates and an additive light layer react to all 9 BG states through spring channels (zoom, lift, dim, light, tint); looks crossfade for features | No filters, no render targets: transforms, tint and alpha only. Plates per orientation, loaded lazily, placeholders until the art lands |
| 8 | FX | Custom GLSL filters (`ShockwaveFilter`, `ChromaticFilter`), additive god-ray sprites, a pooled `ParticleContainer` emitter (`src/fx/*`) | Explode debris, sparkles, coins, dust, shockwaves, flashes, trauma shake | ≤ 3 live filters (1 on low) at 0.5 resolution on low; ≤ 1,000 particles (400); flash limiter ≤ 3/s; reduced motion scales shake ×0.3. (`pixi-filters` is a dependency but unused) |
| 9 | Audio | Custom **Web Audio** engine (`src/audio/*`): buses (sfx, ui, hero, music, reverb), ducking, limiter, voice limits | SFX decoded after the first gesture; music streamed through `<audio>` → `MediaElementSource` (no 100 MB PCM decode on iOS); **WebM-Opus + AAC** | Lazy `AudioContext`, iOS unlock, suspend when hidden. (`@pixi/sound` is declared but unused) |
| 10 | Assets | WebP @2x on the 360 px symbol canvas; **AssetPack 1.7** (2048 pages, @0.5x); **glTF-Transform 4.5** (meshopt + WebP) | Symbols, env pieces, Spine atlases, plates; fonts are bundled woff2 | No KTX2/Basis until the transcoders are self-hosted (the default CDN fails Stake's no-external-request rule). AssetPack output is built but **not read** by the runtime yet (E7) |
| 11 | Game flow | Own RGS client, book player (for-await over events), awaitable emitter (`broadcastAsync`), flow FSM (`src/rgs`, `src/book`, `src/flow`) | authenticate / play / end-round / event / replay; resume; all 12 jurisdiction flags; social mode; mock RGS with fixture books (`mock/`) | Animation length, not timers, decides when the next book event plays; cosmetic randomness is seeded from the round id |
| 12 | UI | Engine HUD (`src/ui/hud`) + DOM menus (`src/ui/dom`) | **You already have menus and UI**: wire them to the `ui:*` commands (spin, skip, betUp/Down/Set, turbo, autoplay …) and `hud:*` state events (`src/game/events.ts`) | DOM overlays above the canvas; touch targets ≥ 44 CSS px |
| 13 | Dev / QA | Tweakpane lab (`?dev=lab`), gallery (`?dev=gallery`), `window.__slot`, Playwright 1.63 capture + approval smoke, `pnpm kit:check` | Tune, capture, verify | SwiftShader numbers never count for performance; real phones do |

### Pinned versions

| Package | Version | Note |
|---|---|---|
| pixi.js | 8.21.0 | WebGL2 |
| @esotericsoftware/spine-pixi-v8 / spine-core | 4.3.13 | Spine **Editor 4.3.x**, one patch, never a beta |
| gsap | 3.15.0 | standard "no charge" licence |
| three / @types/three | 0.186.0 | only if 3D characters or props are used |
| vite | 8.3.0 | rolldown minify, console drop |
| typescript | 7.0.2 | `pnpm typecheck` covers every game |
| @assetpack/core | 1.7.0 | |
| @gltf-transform/cli + core | 4.5.0 | |
| playwright | 1.63.0 | capture + approval smoke |
| tweakpane | 4.0.5 | dev lab only |
| Node / pnpm | ≥ 22.12 / 10.33.0 | Node 22.7+ for `pnpm test:kit` |

---

## 2. Production pipeline stack (how assets are made)

| Stage | Tool | Repo entry point | Notes |
|---|---|---|---|
| Orchestration | **Claude Code** with the project agents and skills (`.claude/agents`, `.claude/skills`) + MCP servers (`.mcp.json.example`: higgsfield, stake-docs, playwright, chrome-devtools …) | [AGENTS.md](AGENTS.md) | Committed scripts produce; MCP explores |
| 2D images | **Higgsfield** MCP: `nano_banana_pro` (masters, plates), `nano_banana_2` (masked inpaint), `seedream_v4_5`, `flux_2_pro_outpaint`, `image_decompose` (BG layers), `topaz_image` (upscale), `recraft_v4_1` (vector royals) | [HIGGSFIELD_PLAYBOOK.md](HIGGSFIELD_PLAYBOOK.md), `pnpm gen:hf-ingest` (plan → record → ingest, ledger `art/ledger/higgsfield-jobs.json`) | **No OpenAI models** (`gpt_image_*`, `openai_hazel`); ships after the written Higgsfield clearance |
| Video | Higgsfield `kling3_0` / `kling_o3_flf` / `seedance_2_0` (start = end frame loops), `video_background_remover`, `video_deflicker`, `topaz_video` | `pnpm video:key`, `pnpm video:stacked`, `tools/video/flipbook.py` | Ambient BG loops (high tier), FX elements, animatics (reference only) |
| Matte + parts | `tools/matte` (closed-outline key matte, halo gate), master cut scripts, `tools/split` | `pnpm matte`, `pnpm matte:variants` | Measure the key from the corners; SSIM > 0.98 reassembly gate |
| Background plates | `tools/bg/layers.py`: per-depth offline blur (premultiplied), WebP, provenance, `environment.ts` src lines | `tools/.venv/bin/python tools/bg/layers.py --spec …` | Feeds `LayeredEnvironment`; no runtime blur |
| Spine | Claude-written `rig.yaml` → `tools/spine/gen.py` (4.3 JSON) → `validate.mjs` (spine-core) → Spine Editor/CLI 4.3 (licensed seat) | `pnpm spine:gen / spine:validate / spine:pack / spine:capture / spine:export` | Contract: [ANIMATION_CONTRACT](../ANIMATION_CONTRACT.md); template: [`templates/rig.symbol.yaml`](templates/rig.symbol.yaml) |
| 3D (optional) | Blender 5.2 headless (toon inserts, turns, shatters), Higgsfield `generate_3d` for prop meshes | `pnpm blender:*`, `pnpm gltf:optimize` | Only true 3D turns or shatters are baked |
| Audio | ElevenLabs SFX v2 + Music (Enterprise for real-money), ffmpeg 2-pass loudnorm | `pnpm gen:sfx`, `gen:music`, `audio:master`, `audio:sprite` | A human listens; cues keyed by `SfxId` |
| Math | **Stake math-sdk** (Python): game config, gamestate, simulations, optimisation, books + lookup tables | external checkout; fixtures in `mock/games/<id>/books/` | [templates/MATH_BRIEF.md](templates/MATH_BRIEF.md) |
| Packaging | AssetPack, Vite build, licence audit | `pnpm assets:pack`, `pnpm build:<id>`, `pnpm licence:audit --release --strict` | Upload the **contents** of `dist/<id>/` |
| QA | Playwright deterministic capture, approval smoke, kit gates, Claude + Gemini critique, real phones + EA IRIS | `pnpm capture`, `qa:review`, `qa:approval`, `kit:check`, `test:kit` | [AGENTS § verification](AGENTS.md#verification-loop) |

---

## 3. Never add

- web-sdk sample assets;
- the `stake-engine` npm client (it logs);
- Google Fonts, Typekit or any CDN;
- the KTX2/Basis default transcoders;
- Draco (no decoder ships);
- Theatre.js studio (AGPL);
- OpenAI image models;
- Midjourney (no API; its ToS bans automation);
- non-commercial model weights.

The full list with reasons is in [STACK § Excluded tools](../STACK.md#excluded-tools-and-why) and `licenses/denylist.json`.
