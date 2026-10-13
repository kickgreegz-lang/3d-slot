# Higgsfield playbook: every image, plate and loop for a new slot

This is how a new game's art comes out of **Higgsfield** and lands in the engine as animatable sources:
- premium symbols, royals, Wild, Scatter and specials;
- the board (frame and panel);
- the background (BG) layers and their feature variants;
- FX elements, ambient loops, the game tile, and characters.

What every asset has to do once it is in the engine is in [ANIMATION_STATES.md](ANIMATION_STATES.md). Who runs each step is in [AGENTS.md](AGENTS.md) (`art-director`, `higgsfield-artist`).

**Model ids** were checked with the Higgsfield MCP `models_explore` on **2026-10-13**. Re-check them before a batch (`models_explore action:get model_id:<id>`); Higgsfield renames and adds models often.

---

## 0. Non-negotiables

1. **Paid jobs go through the ledger.**
   - The MCP is fine for exploring.
   - Every job you pay for is recorded in `art/ledger/higgsfield-jobs.json` with `pnpm gen:hf-ingest record`, and pulled into `art/_raw/` with `pnpm gen:hf-ingest`.
   - Nobody downloads by hand. This keeps provenance, sha256 hashes and costs ([tools/gen/README](../../tools/gen/README.md#higgsfield-mcp-route-plan--pay--record--ingest-pnpm-genhf-ingest)).
2. **Prompts are rendered, never typed.**
   - Templates live in `art/bible/prompts/*.txt` and are filled from `art/bible/artbible.json` (`python3 tools/gen/genlib.py render …`).
   - A new game first gets **its own style formula and symbol briefs** in the bible ([WORKFLOW phase 1](WORKFLOW.md#phase-a-design-the-mechanic-and-the-world)).
3. **Never use an OpenAI model** (`gpt_image_2`, `gpt_image_2_5`, `openai_hazel`). OpenAI's usage policy prohibits real-money gambling. The plan, record and ingest steps all refuse them (exit 3).
   - Higgsfield audio models (`mirelo_text_to_audio`, `sonilo_music`) are for drafts only.
   - The Soul models are for photoreal people; they are useless here.
4. **No text, numbers or multipliers in any image or video.** Stake tests every language and rewrites words in social mode. Labels, values and titles are always live text.
5. **Adult characters only.** Head at most about ¼ of body height. No child-like proportions or faces, on mascots, anthropomorphic symbols or anything else.
6. **Licence state.** Higgsfield is `clearance: pending` in `licenses/allowlist.json`. Its outputs **build and preview but cannot ship** until `licenses/clearances/higgsfield.pdf` is filed: training opt-out, real-money gambling, EU/UK, ownership ([STACK § Image route](../STACK.md#image-route-higgsfield-or-vertex--scenario-you-decide)). `pnpm licence:audit --release` enforces this.
7. **No seeds and no negative prompts** on Higgsfield. `nano_banana_2_1` and `ideogram_4_5` take a seed, but NBP does not.
   - Consistency comes from the **frozen style formula plus 6–14 reference images**.
   - Keep the best output of each batch as a reference for the next one.

---

## 1. Model map

| Job | Model (MCP id) | Settings | Notes |
|---|---|---|---|
| Style exploration (4 directions) | `nano_banana_pro` | 2k, 1:1 | The workhorse (Nano Banana Pro; finished jobs report `nano_banana_2`). A/B against `seedream_v4_5` and `flux_3_image` (up to 10 refs) only when a direction looks generic |
| **Premium symbols**: beauty + rig-ready masters | `nano_banana_pro` | **2k**, 1:1, on the key colour, ≤ 14 refs | Two masters per symbol: **beauty** and **rig-ready** (parts clear of the body, mouth closed, limbs not overlapping). Use `--rig-ready` in the template vars |
| Hidden-area fill / alternates (eyes closed, mouth open, blur parts) | `nano_banana_2` with `is_inpaint` + mask | 2k | Edit the **master** under a mask so the visible pixels stay locked. Generating a fresh part sheet re-draws the object and its pieces will not register (see §3.2) |
| Royals / low symbols | `recraft_v4_1` (`model_type: vector`) → `nano_banana_pro` material pass | 2k | Vector glyph first (clean silhouette and outline), then an NBP edit pass for the material. Royals also need all five states, so plan them as rigs, not stickers |
| Wild / Scatter hero 3D turn | `generate_3d` (image → GLB) | from the beauty master | Feeds `pnpm blender:symbol --mesh … --clip turn` (a baked 3D turn inside the Spine rig). Optional; only when the design wants a real 3D spin |
| **Board**: frame pieces, panel, corner caps | `nano_banana_pro` | **4k**, on magenta `#FF00FF` | Beam, post, sill and cap as separate straight-on pieces → matte → 3- or 9-slice. Never one baked frame image (it cannot adapt to 4 layouts) |
| **Background plate** (base game) | `nano_banana_pro` | **4k**, 21:9 | Crop to 2:1 for landscape. Keep the centre **calm and low-detail** (the board covers it). Its **value depends on the style**: a dark neon world darkens the centre and puts the brightest masses at the edges (Swamp Funk); a bright casual world (Sugar-Gates-style) keeps the centre at the same light value and puts big rounded props in the bottom corners, because the dark board well provides the contrast. Override `background.txt#A`'s darker-centre line with `--var`/spec vars for bright styles |
| Portrait plate | `flux_2_pro_outpaint` (or `outpaint`) from the 21:9 plate | expand top and bottom | Gives the 1:2 portrait master **in the same scene**. Regenerating would give a different scene |
| **BG layers for parallax** | `image_decompose` (`standard`) on the approved plate | — | Splits the plate into back / mid / front / prop layers for parallax and per-layer reactions. If the split is poor, regenerate the plate as separate layers with the same refs: `background.txt#B` |
| BG feature variants (free spins, super feature) | `nano_banana_pro` edit of the base plate | 4k, plate as ref | Same composition, new lighting/mood ("same scene at a blood-moon, red rim light …"). The runtime cross-fades between them |
| Bright **game-tile** background + foreground | `nano_banana_pro` | 4k | Tile rules: brighter than the Stake lobby, no dark edges, no text. Foreground = the hero symbol or character, cut out |
| Upscale finished masters | `topaz_image` (`High Fidelity V2`, or `CGI` for painted art) | target px | Only on approved finals, never on candidates |
| Background removal (fallback) | `image_background_remover` | — | Only when the key-colour matte fails (`pnpm matte` reports a halo). Record it as its own ledger job |
| **BG ambient loop** (high tier only) | `kling3_0` or `kling_o3_flf` | start = end = plate, `sound: off`, `pro`/`4k`, 5–10 s | Identical first and last frames give a seamless loop. Subtle motion only: haze, lights, foliage, water. **No camera move.** Alternative: `seedance_2_0` (start + end frame, 1080p/4k, `generate_audio: false`) |
| Loop clean-up | `video_deflicker`, then `topaz_video` (frame interpolation) | — | Then `pnpm video:key` / `video:stacked` locally (seam crossfade, encode) |
| FX elements (explosion, smoke, energy burst, debris) | `kling3_0` / `seedance_2_0` on a black or key background → `video_background_remover` | 1080p, 2–3 s | → `tools/video/flipbook.py` → an AssetPack folder. Seeded live particles carry most FX; flipbooks are for hero moments |
| **Animatics / motion reference** for symbol states | `kling3_0` (start frame = master) | 720p, 5 s, sound off | Reference only, **never shipped**: "the crab snaps its claws and bursts into gold coins". The Spine animator (Claude via `rig.yaml`, or a human) matches the timing and poses |
| Characters (if the game has any) | Higgsfield character-sheet workflow, then `mascot_turnaround.txt` | 4k 21:9 sheets | Adult proportions, approved by a human. 2D Spine character rigs are cheaper than 3D on mobile; see [TECH_STACK](TECH_STACK.md) (runtime layer 6) |

**Cost** in credits, measured 2026-09-26: NBP 2 per 2k image and 4 per 4k; NB2 1.5 at 1k and 2 at 2k; Seedream 4.5 1. Video and 3D costs vary: take them from the cost preview or `models_explore get` before the batch. `--max-credits` on `hf-ingest plan` fails closed on unknown rates (exit 4).

---

## 2. The asset list for one new game (typical)

The spec template for `hf-ingest plan` is [`templates/art-plan.spec.json`](templates/art-plan.spec.json). The counts assume 4 premium symbols, 5 royals, Wild, Scatter and one special.

| Batch | Assets | Jobs (with candidates) | ≈ NBP credits |
|---|---|---|---|
| `x01` exploration | 4 directions × (H1, W, one royal, BG thumbnail) | 16 × 2k | 32 |
| `s01` symbol masters | 7 specials and highs × (beauty + rig-ready) × 3 candidates | 42 × 2k | 84 |
| `s02` royals | 5 × vector + material pass × 2 | 20 × 2k | 40 |
| `s03` alternates / fills | eyes, mouths, blur, hidden areas (≈ 3 per rigged symbol) | ≈ 30 × 2k (inpaint) | 60 |
| `b01` board | beam, post, sill, cap, panel × 2 | 10 × 4k | 40 |
| `e01` background | base plate × 4, feature plate × 3, tile × 3 | 10 × 4k | 40 |
| `e02` BG layers | `image_decompose` + outpaint portrait | ≈ 6 | (preview) |
| `v01` loops / FX | 2 ambient loops, 4 FX elements, 6 animatics | 12 video | (preview) |
| **Total images** | | **≈ 150** | **≈ 300 credits** + video |

That fits in one Higgsfield **Ultra** month (3,000 credits) with a lot of headroom for regenerations. **Re-check the plan prices**; they are from snapshot search results (STACK.md).

---

## 3. Step by step

### 3.1 Every image batch: plan → pay → record → ingest

```bash
# 1. plan: render every prompt and print the exact MCP arguments (≤ 12 requests per call)
pnpm gen:hf-ingest plan --spec docs/games/<id>/hf/s01.spec.json --max-credits 120
# 2. pay: Claude passes each calls[i] to the MCP tool generate_image_batch and saves the reply (submit.json)
# 3. record at once, then again after jobs_wait (wait.json)
pnpm gen:hf-ingest record --plan art/_work/hf-plans/s01.plan.json --from submit.json
pnpm gen:hf-ingest record --from wait.json
# 4. download + verify + manifest rows
NODE_USE_ENV_PROXY=1 pnpm gen:hf-ingest --batch s01      # NODE_USE_ENV_PROXY only behind an agent proxy
pnpm gen:hf-ingest status
```

In a cloud session, add the CDN host (`d8j0ntlcm91z4.cloudfront.net`) to the environment's network allowlist. Until you do, ingest stops with exit 6.

### 3.2 Symbols: from master to animatable parts

1. **Matte and fit** onto the 360×360 @2x canvas, with no halo:
   `pnpm matte art/_raw/sym_<ID>/vNN/raw.png "build/pack/symbols{tps}/sym_<ID>.png" --symbol <ID> --key <measured hex> --emit-master art/source/symbols/<ID>/master_2048.png`.
   **Measure the key from the corners.** The requested `#00FF00` is not guaranteed: it came back olive once.
2. **Variants:** `pnpm matte:variants … --symbol <ID>` gives `_blur` (the spin state) and `_glow` (the connect state).
3. **Cut parts from the rig-ready master** (the "master cut", the production route since Bass Drop phase C):
   - Every pixel visible at rest comes from the approved master, partitioned along its painted outlines.
   - Areas uncovered by motion are filled with an `nano_banana_2` inpaint under a mask.
   - Sheet pieces are used only for alternates (eyes, mouths, props), placed by 2–3 point pairs.
   - **Gate:** reassembly SSIM > 0.98 and alpha IoU > 0.99. Bass Drop measured 0.996–0.9999 SSIM.
   - Reference scripts: `tools/spine/examples/bass_drop/cut/cut_<ID>.py`.
4. **Rig and animate:** Claude writes `art/source/symbols/<ID>/rig.yaml` from [`templates/rig.symbol.yaml`](templates/rig.symbol.yaml), with every state in ANIMATION_STATES. Then run `pnpm spine:gen`, `spine:validate` and `spine:capture`, critique, and repeat.

### 3.3 Background: from one plate to a reactive scene

1. Approve the **4k 21:9 plate**. Crop it to 2:1, and outpaint it to 1:2 for portrait.
2. Split it into **3–5 depth layers**: `image_decompose`, or the layered regeneration `background.txt#B`.
   - Fill the holes behind the front layers (`nano_banana_2` inpaint), so parallax never reveals empty pixels.
3. Generate the **emissive or light layer**: neon, magic glow, lava, windows, anything that can pulse. It is a separate additive layer (`background.txt#C`) so the runtime can drive its intensity per state.
4. Optionally generate the **ambient loop** for the high tier (`kling3_0`, start = end = plate, no camera move). Then deflicker, key or stack, and encode with `pnpm video:stacked … --shipped`.
5. Make the **feature variants** as edits of the same plate, so the cross-fade lines up pixel for pixel.
6. Hand the layers to `environment-artist`, who wires the state reactions ([ANIMATION_STATES §3](ANIMATION_STATES.md#3-background-states)).

### 3.4 Board

Generate the frame pieces on magenta, matte them with `--key FF00FF`, and assemble them in code as 3- or 9-slices per layout space. Two optional extras:
- an **emissive trim layer**, so the frame can light up on connect, explode and feature;
- a **glass panel** texture behind the symbols.

---

## 4. Prompt rules learned the hard way

- **Never write "extrusion"** (it draws a separate stick) or **"molten"** (it draws drips). Say "polished solid gold".
- Name the **outline style** explicitly ("clean single-weight bold black outline around every shape"). Without it, consecutive batches drift between outlined and painterly.
- **One subject, centred, with the full silhouette inside the frame, on a flat key colour.** No cast shadow on the background (it breaks the matte).
- Symbols must differ in **silhouette and dominant colour**, not just in detail. Gate: a 64 px greyscale silhouette matrix must show no confusable pairs.
- Backgrounds: "no characters, no UI, no text or readable signage, a calm low-detail centre". Darken the centre only for dark, neon styles; bright styles keep it light and rely on the board's dark well.
- Soft-focus backgrounds: generate them only **moderately** soft (shapes still readable, so `image_decompose` can split the layers), then blur each layer **at build time** (offline, per depth). Never put a full-screen runtime blur filter on the background: it costs a filter pass every frame on low-tier phones.
- Avoid meme-adjacent and IP-adjacent designs (Bass Drop's first frog read as a well-known meme frog). The art director checks every character for resemblance to known IP.
- Keep 6–14 references per batch: the approved paintover heroes plus the best of the previous batch. Never re-use a rejected image as a reference.
