# Performance: fluid on every phone

Stake reviewers play on phones, and Stake can **disable a live game** for "excessive load times, memory leaks, or rendering failures" (FAQ: *Why was my game removed*). Performance is a 3-star pillar (P7) and a removal risk. The owner is the `performance-engineer` agent; the verifier is `qa-verifier` ([AGENTS](AGENTS.md)).

## 1. Targets (gates)

| Metric | Target | How it is measured |
|---|---|---|
| Frame time | **p95 < 16.7 ms** (60 fps) on a mid-range Android (Snapdragon 7-class) **and** an iPhone (iOS ≥ 17.4), in a mega win with every effect on; p95 < 20 ms is a hard cap (it caps a reviewer's score at 2.0) | chrome-devtools-mcp `performance_start_trace` on the real device (adb / Safari remote), rAF + Long Animation Frame logs |
| First spin | ≤ 5 s on 4G (cold cache) | Playwright with network throttling + real device |
| Download (gzip) | preload ≤ 3 MB, game ≤ 15 MB, bonus ≤ 8 MB (lazy) | `dist/<id>` sizes, the AssetPack manifest `progressSize` |
| Texture memory | ≤ 120 MB on the low tier, ≤ 250 MB on desktop | budget sums per bundle; `Background` / plate `stats.mib` |
| Draw calls | ≈ 100 or fewer in the heaviest frame | Spector.js / Pixi debug in DEV |
| Hitches | **none** at the feature trigger, the first big win or an orientation change | traces around those moments; pre-warm (E8) |
| Memory over time | no growth across 500 autoplay spins | heap snapshots at spins 0 / 250 / 500 |
| Photosensitivity | ≤ 3 flashes per second; EA IRIS passes on the big-win, feature and anticipation captures | `Fx` flash limiter + the IRIS report |

**Numbers from SwiftShader, emulation or a desktop browser in device mode never count.**

## 2. Tiers today (`src/env/tier.ts`)

There are two tiers. Low is chosen when any of these is true, checked in order:
- `?tier=low` is set;
- `navigator.deviceMemory` ≤ 4;
- iOS with a short screen side ≤ 375;
- there is no WebGL2;
- `MAX_TEXTURE_SIZE` < 4096.

| | Low | High |
|---|---|---|
| Device pixel ratio cap | 1.5 | 2 |
| Particles | 400 | 1,000 |
| Live filters (at 0.5 res on low) | 1 | 3 |
| Active Spine instances | 12 | 24 |
| Symbol idle glint / breath shaders | off | on |
| Mascot render target (if used) | 341×512, 2× MSAA, 30 fps | 512×768, 4× MSAA, 60 fps |
| Half-density Spine atlases | from 0.9 px per unit | from 0.62 px per unit |
| Plates halved on the GPU | at ≤ 0.75 display px per texel | at ≤ 0.6 |
| Bake resolution (procedural art) | 1 | 1.5 |
| Logo / frame shine sweeps | off | on |

**Consider adding a mid tier** (Snapdragon 6/7, iPhone 11–12) if real-device traces show the high tier missing 16.7 ms there. Low then becomes the floor, and mid gets full effects at a DPR cap of 1.75.

## 3. Rules per layer

**Symbols** ([ANIMATION_STATES §2](ANIMATION_STATES.md#2-technique-per-tier-the-tech-stack-combo)):
- Spin is a texture swap.
- Low symbols land procedurally.
- Miss is procedural or shader, **never** a Spine instance per loser.
- Spine only where a character beat is needed, within the pool cap (overflow falls back to procedural automatically).
- One shared symbol atlas page set at 2048 (+ @0.5x).
- No per-symbol filters: glows are pre-baked additive `_glow` textures, and shine and dissolve run in `symbolFxShader` with no render target.

**Background:**
- `LayeredEnvironment` uses no filters or render targets.
- 3–5 plate layers + 1 light layer per look; only the orientation on screen is loaded.
- Feature looks load at the trigger and are dropped after the crossfade back.
- The video loop is high tier only, with one decoder at a time, ≤ 1080 px tall stacked alpha, and a static plate fallback.

**FX:**
- Explosions are particles + sprites, not filters.
- Shockwave and chromatic filters only on hero moments, inside the live-filter budget (`tryAddFilter` refuses beyond it).
- Particle textures share one atlas.

**Text:**
- BitmapText for every number that animates (win counter, multipliers, spot values).
- The glyph cache is released on the low tier (`OverlayStage`).

**Spine rigs:** ≤ 30 bones, ≤ 250 vertices, ≤ 8 slots, ≤ 4 physics chains, no clipping, no sequence attachments, PMA atlas.

**Audio:** SFX decoded once after unlock; music streamed; voice limits per group; the `AudioContext` suspended when hidden.

**Loading:**
- Preload = the loading screen + the base game.
- Feature art is lazy.
- Prefetch the next look on the network 4 s after boot (Bass Drop pattern).
- `renderer.prepare.upload` before first use (E8).

## 4. Known gaps (do these in phase B)

| Id | Gap | Risk |
|---|---|---|
| E6 | No `webglcontextlost` / `restored` handling | A context loss on a backgrounded tab leaves a black game ("rendering failures") |
| E7 | AssetPack output is built but the runtime still loads single files; the low-tier `@0.5x` variants are unused | Extra memory and download on low-end phones |
| E8 | No pre-warm of the feature look, FX atlases or big-win skeletons | A first-use hitch at the most-watched moment |
| — | `?tier=` is honoured in production builds; the dev lab chunk is emitted to `dist/` and reachable with `?dev=lab` | Not a Stake rule, but gate both behind DEV for a clean build |

## 5. How to measure (`performance-engineer` routine)

1. `pnpm build:<id> && pnpm preview:<id>`, then open on the device through adb reverse or a LAN URL with `rgs_url` pointing at the mock.
2. Force the heavy fixtures: `?book=mega_win`, `?book=tumble_chain`, `?book=feature_trigger`.
3. Trace 10 s around each one (chrome-devtools-mcp, `autoStop: false`, `filePath`). Extract p50/p95 frame time, long tasks, GC.
4. Run autoplay 500 spins on the mock (`__slot.flow`) and take heap snapshots.
5. Log results in `qa/<id>/perf/<date>.json`. Fail the gate on any target above; open fixes, re-measure.
