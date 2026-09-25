# Art bible: SWAMP FUNK (working theme)

This is the style lock for every 2D, 3D, VFX and UI asset. The machine-readable copy is [`art/bible/artbible.json`](../art/bible/artbible.json), and prompts are rendered from it by [`art/bible/prompts/`](../art/bible/prompts/README.md). **If this page and the JSON disagree, the JSON wins.** Fix this page.

> **Working theme.** SWAMP FUNK is a placeholder you can swap. Changing the theme means a new palette, new briefs and new mascots. The *rules* on this page stay the same: outline, light, extrusion, canvas, readability and gates. We match the quality, layout and energy of the reference screenshot (a premium 7x5 Stake Engine cluster slot). We never match its IP, characters, names or look-as-identity.

---

## 1. Pitch

**A neon bayou juke joint at night.**

- **Setting:** string lights, cypress silhouettes behind the windows, a shelf of glowing firefly jars on the left, a neon gator-silhouette sign and a magenta booth on the right.
- **Symbols:** a golden boombox, a vinyl record, a crawfish and a bottle of hot sauce, plus chunky carved-wood royals with enamel faces.
- **Mascots:** two adult hosts flank the reels. **Gumbo** is a heavyset alligator bouncer. **Baron Croak** is a lanky bullfrog DJ.

## 2. Style formula (paste byte-identical into every image prompt)

> Premium 2D slot-game art, bold cel shading: one flat base tone, two hard-edged shadow tones and one crisp white specular streak, no soft gradients, no texture noise. Uniform thick pure-black outline around every shape with thinner black interior lines; chunky rounded exaggerated forms with a short dark-plum extrusion toward the lower right. Key light from the upper left on every object. Warm saturated candy colours for symbols and characters, molten gold for special features; foreground objects carry no rim light or glow, neon exists only in the deep violet-indigo environment. Clean readable silhouettes, adult characters.

**Why this wording.** The earlier Higgsfield-brief formula asked for a dark-plum outline, a cyan rim light, a glossy sheen and one frontal ¾ view. The reference was then **measured pixel by pixel** and showed something different:

- outlines are **pure black**, 3–5 px on a 149 px cell;
- plum appears **only in the extrusion**;
- **no foreground asset has a rim light or neon**; neon lives only in the background;
- specials are tilted.

The formula above is the corrected version (research round 1 critic). Research round 2 suggested outlines "in a darkened local hue". That is **rejected** because it does not match the reference.

Formula rules:
- Keying and background words go in the per-kind suffix, never in the formula.
- Never name a brand, studio, artist or existing game.

## 3. The five locks

| Lock | Value | Notes |
|---|---|---|
| **Outline** | Pure black `#000000`. Outer **4.6 design px** (≈ 3% of the 150 px cell; 9 px on the 360 @2x canvas; ≈ 52 px on a 2048 master). Interior 2.6 design px. Heavier bottom-right, up to ~7 px where it merges into shadow. | Mascots 3–4 px at display size. UI text stroke 2–3 px. Logo 6–13 px. Background linework ~2 px and lower contrast. The runtime placeholder art already uses these numbers (`src/assets/placeholder/palette.ts`). Research-2's "14 px at 2048" would render ~1.2 design px and is superseded. |
| **Extrusion** | Plum `#4B283D`, **6–10 design px** (12–20 px @2x) toward the **lower right**. | The outline wraps face and extrusion together. |
| **Light** | Key light **top-left at 45°** on every asset, 2D and 3D. Cel shading: 1 flat base + 2 hard-edged shadow tones + 1 white specular streak. Shadows shift toward warm plum, never grey. | **No** rim light on foreground. **No** baked glow, bloom, blur or cast shadow; the engine adds them. |
| **Camera** | Object symbols: one shared camera, frontal three-quarter, slight low angle. Royals: straight-on. Mascots: three-quarter, turned toward the reels. Background: wide, eye level. | A different perspective per symbol is the #1 slop tell after lighting. |
| **Canvas / fill** | Masters at 2048² with straight alpha → fitted onto the **360×360 @2x canvas** (180 design px = 1.2× the cell), anchor 0.5, Lanczos down, never upscaled. Content height: royals **85–90%** of the cell, highs **95–100%**, specials **102–115%**. | Matches `cellScale` in `src/games/swamp-funk/config.ts`. **Deliver upright.** The runtime applies `restAngle` (−6…−18°). For a negative tilt, ask for the key light "slightly more from above" so it still reads top-left after rotation. |

## 4. Palette (roles)

| Group | Swatches |
|---|---|
| Line / shade | ink `#000000` · extrusion `#4B283D` · extrusion lit `#6B3A57` · specular `#FFFFFF` · cel light `#FFF6D8` · shadow hue shift toward `#6A1030` |
| Gold (specials) | base `#FFC629` · shade `#E2861A` · deep `#9A4A0C` · light `#FFF0A0` |
| Environment (background only) | walls `#2A0F5E` · ambient `#4B3BFF` · floor/app clear `#0A0420` · neon cyan `#35F2E0` · neon magenta `#FF3FA8` |
| Frame | cypress face `#B8742F` · underside `#5A2A18` |
| Board (drawn in code) | panel `#0C3149` → `#080418` · unlit tile `#1F2E4D` |
| Royals (enamel faces) | A `#D13242` · K `#F1C81C` · Q `#75D92A` · J `#E6A37F` · 10 `#AA621B`. **One hue per royal**, so they read at thumbnail size. |
| High pays | H1 `#FFC629`/`#8A4B0A` · H2 `#FF3FA8`/`#5A0F3C` · H3 `#FF5A2A`/`#6B1608` · H4 `#E8262E`/`#5C0B10` |
| Specials | Wild `#35F2E0`/`#0B3B52` (teal enamel + gold) · Scatter `#FFD54A`/`#7A3E00` |
| Mascots | Gumbo skin `#3F9D3A`, shade `#2B6B2A`, belly `#EEE0AB`, gold `#F2C230` · Croak skin `#8FBF3A`, shade `#5F8A26`, belly `#F2E79A`, pink `#FF5FA2` |
| UI | labels `#F8D828` · values `#FFFFFF` · icons `#E8E8E8` · hex stroke `#8A8A8A` · **bonus-buy accent `#F828C8` (the only saturated UI colour)** |

Hue logic: warm, saturated symbols (hue 0–60°) sit on a cool dark panel (200–260°), which sits in front of a mid-saturation violet background.

> **Watch these hue clashes.** H2's pink and W's teal equal the background neon hues. They must read as **flat enamel**, never glowing. The palette gate compares each symbol against the background plate at 64 px.

The multiplier-spot heat tiers (T0–T5) are drawn in code: see `artbible.json → heatTiers`. The SWAMP FUNK reskin proposal is lily pads under glass, going teal → lime → orange → gold.

## 5. Key colours

- `#00FF00` is the default.
- Use `#FF00FF` for green or teal assets: L3 'Q', W, Gumbo, frame pieces.
- Use `#0000FF` when both clash: Baron Croak (green + pink).
- The same hex goes into the prompt and the keyer, and the keyer clears **enclosed** key regions too.
- Alternative for Nano Banana: render the same edit on white and on black, then difference-matte.

## 6. Symbol briefs

Ids and tilts come from `src/games/swamp-funk/config.ts`. Rig parts follow the [animation contract](ANIMATION_CONTRACT.md#2-spine-symbol-skeletons-43-json).

| Id | Subject | Tilt | Brief | Rig parts (Spine) |
|---|---|---|---|---|
| H1 | Golden Boombox (top pay, heavy) | −6° | Chunky retro boombox in molten gold, two big round speaker cones, carry handle, cassette door. Gold, black and white specular only. | body, handle, speaker_L/R (pump on `land_impact`/`win_peak`), cassette_door, `phys_antenna` |
| H2 | Vinyl Record | 0° | Glossy black record half out of a hot-pink sleeve. Blank label (no text). Grooves drawn as 2–3 interior lines. | sleeve, disc (spins in `win_loop`), label, `fx_glint` |
| H3 | Crawfish | −14° | Adult-proportioned cartoon crawfish, red-orange shell, claws raised in a swagger pose, two long antennae. Attitude, not cute. | body, tail_fan, claw_L/R, `phys_antenna_L/R`, eye/lid L/R |
| H4 | Hot Sauce | −12° | Bayou hot-sauce bottle, deep red sauce, cork cap, blank label with a chili pictogram (no words), small cartoon flame wisp. | bottle, `phys_sauce` (slosh), cap (pops on `win_peak`), label, `fx_flame` |
| L1–L5 | A K Q J 10 | 0° | Chunky **carved-wood** letterform with a glossy enamel face (hue per §4), black outline, plum extrusion. **Built as vector** from the bundled display fonts (Lilita One / Titan One), rasterised with resvg, with an optional AI material pass that is re-registered to the vector alpha. | None. Animated by GSAP pop, shine shader and particles. |
| W | Wild (*proposal*) | 0° | Gold-capped alligator-tooth charm on a short chain with a teal enamel inlay. Heraldic and bold. The word "WILD" is **live text**, never painted. | tooth, cap, `phys_chain`, `fx_glow` |
| S | Golden Mic (scatter) | −18° | Vintage golden ribbon microphone, oversized grille, short coiled cable. It must read as the most precious object on the board. | grille, body, `phys_cable`, `fx_glint` |

Every object symbol gets **two masters**:
- a *beauty* master;
- a *rig-ready* master, with every part clear of the body, mouth closed, eyes open and no motion blur.

Win, blur and glow variants are made in the engine, not in the art.

## 7. Mascot briefs

**Rules for both mascots:**
- **Adult proportions:** the head is about ¼ of total height (head:body ≥ 1:3), with adult body language and attire. Stake rejects "artistic depictions of children or child-like characters".
- **Never** use *kid, child, cute, chibi* or *baby* in any prompt.
- Identity lock wording (used on every sheet): *exactly the same character as the references: same face, markings, outfit and colours; nothing added, removed or recoloured; same proportions*.

| | **Gumbo** (left) | **Baron Croak** (right) |
|---|---|---|
| Who | Heavyset adult alligator bouncer: tank top, gold tooth, toothpick, arms crossed, stands beside a cooler | Lanky adult bullfrog DJ: headphones, gold chain, turntable on a crate |
| Build (`characters.ts`) | width 1.14, height 0.97, tempo 0.92 (slow, heavy) | width 0.93, height 1.05, tempo 1.06 (quick, springy) |
| Acting | Idle breathing, tail swish, slow weight shifts. Big win: slams the cooler. | Idle head-nod on the beat, scratching during tumbles, throat-pouch pump on a multiplier upgrade, mic-drop on the feature trigger |
| Spring bones | `tail`, `jowl`, `belly` | `jowl` (throat pouch), `chain`, `belly` |
| Key colour | `#FF00FF` | `#0000FF` |

**3D look.** The real-time mascots must sit in the 2D language:
- `MeshToonMaterial` with a 3-step hard ramp;
- the same top-left key light;
- a black `OutlineEffect` at ~3 px on screen;
- 4–8 flat colours (the AI texture's lighting is thrown away);
- no rim light.

Turnaround inputs for image-to-3D are **unlit, outline-free, one figure per image on 50% grey**. That is deliberately different from the styled design sheet (see `mascot_turnaround.txt`).

## 8. Environment, frame, logo, UI, tile

### Background

- **Masters:** 2:1 landscape (3072×1536) and 1:2 portrait (1536×3072). Generate at 21:9 / 9:16 in 4K, then crop or outpaint. Cover-scaling onto 21:9 crops top and bottom, so plan for that.
- **Layers:** separate back, mid and front generations, plus a **neon-only additive layer** (an edit that keeps only the neon on black) so the engine can pulse it.
- **Composition:**
  - brightest neon masses at the far left (firefly jars, cyan light bar) and the far right (gator-silhouette sign, magenta booth), backlighting the mascots;
  - a **darker, low-detail centre 60%** behind the grid;
  - linework thinner and lower in contrast than the foreground;
  - a dark floor.
- **No text or readable signage.** The research concept's "GATOR LOUNGE" sign is **corrected to an icon-only sign**, because of localisation and social-mode rules.
- **Free-spins variant** (*proposal*): the same set after hours, with denser fog, a moonlit window and a cyan-leaning palette.

### Frame

- Weathered cypress planks with a rope wrap and black iron rivets.
- Generated as orthographic **beam / post / sill / corner cap** pieces on the key colour, then assembled as 3-slice: posts tile vertically, and the beam stretches only in its centre segment.
- The **neon tube along the beam is a runtime effect**, not painted.
- The frame sits **above** the scissor-masked board. Anything that spills over it goes on the `winLayer`.

### Logo

- The working title is **your decision**. It must be unique, avoid "Megaways"/"Xways", and carry no Stake/Kick branding.
- AI makes only the emblem (no letters). A typographer sets the word-mark as vector:
  - chunky slanted letters;
  - 6–13 px black outline;
  - 5–15 px extrusion to the lower right;
  - *proposed* tri-band fill: swamp green, gold, hot pink.
- A trademark search is required before release.

### UI

- Translucent, minimal hex buttons:
  - small buttons: 72×70, 85% black fill, 2 px `#8A8A8A` stroke;
  - spin button: 293×271, 30% black fill, 2 px white stroke at 60%, tilted 20°.
- States: default, hover, pressed, disabled.
- Built as vector (Recraft SVG or hand SVG), then resvg.
- Fonts: labels Bebas Neue / Anton in caps `#F8D828` with a 2 px black stroke; values Titan One in white; spot numbers and royals Lilita One. All are already bundled as woff2.
- **No words are baked into any art**, because of i18n and Stake.us social-mode phrase replacement.

### Game tile (ACP Tile Editor)

- A brighter, light-edged daytime background variant (no dark edges; it must be brighter than the Stake lobby).
- A transparent foreground of both mascots rendered from the real GLBs at 2048 px.
- No text or multipliers in either image.

## 9. Polished vs slop checklist

**Polished**, as seen in the reference:

- [ ] One outline weight across all foreground art (~3% of the cell).
- [ ] One light direction everywhere, including 3D.
- [ ] Hue separation: warm symbols, a cool dark panel, a mid-saturation violet background.
- [ ] A distinct hue for every royal.
- [ ] Premium and special symbols bigger and tilted; royals upright and smaller.
- [ ] Small, translucent, low-chroma UI with a single accent (bonus buy).
- [ ] Cell states readable at a glance through the heat ramp.
- [ ] Background lower in contrast and thinner-lined than the foreground.
- [ ] Symbols have extrusion and weight; nothing floats flat on a tile.

**Slop tells:** reject on sight, and the gates catch most of them.

- [ ] Airbrushed gradients, or soft outlines that vary per symbol.
- [ ] Mixed light directions between separately generated assets.
- [ ] Photoreal texture next to flat art; plastic AI sheen; baked bloom.
- [ ] Gibberish text or pseudo-letters anywhere.
- [ ] Extra or merged fingers; asymmetric duplicates; melted details.
- [ ] Bevel/emboss text; heavy opaque UI bars.
- [ ] A background as detailed and saturated as the symbols.
- [ ] A different perspective per symbol.
- [ ] In video: outline "boiling", background drift, facing flips, camera zoom (subject bbox height changing by more than 10 points between first and last frame).
- [ ] Anything child-coded in the mascots.

## 10. QA gates

Automated first, then the human batch sign-off. Values marked *calibrate* are starting thresholds, tuned on the approved paintover pack. Each gate's result is written into the asset's manifest row (`qa`).

| Gate | Method | Pass |
|---|---|---|
| **64 px readability** | Contact sheet of all symbols at 64 px, plus 150 and 75 px on the real panel colour. Claude and Gemini each identify every symbol blind. | Every symbol identified by both judges |
| **Silhouette confusion** | Greyscale/alpha silhouettes; pairwise aligned-IoU confusion matrix | No pair ≥ 0.85 (*calibrate*) |
| **Palette ΔE** | k-means dominant colours vs the §4 role colours (CIEDE2000) | Every cluster within 10 ΔE of an allowed role colour (*calibrate*); hidden-area fills < 3 ΔE vs the visible part (from research) |
| **Outline histogram** | OpenCV width histogram of dark boundary pixels (max RGB < 70) at final display size | Outer outline 3–5 design px (bottom-right up to 7); ≥ 3 px for baked 3D inserts |
| **Style similarity** | DINOv2 cosine similarity to the paintover pack; mascot identity vs the canonical front view | Above the pack baseline (*calibrate*) |
| **Halo** | Composite on pure black and pure white | Zero key-tinted edge pixels |
| **No text** | OCR spot-check | No text except royal glyphs |
| **Canvas / pivot** | 360×360 @2x, content height within the fill range, centred, straight alpha | All true |
| **Adult proportions** | Head bbox / total height + vision rubric | ≤ 0.27 and judged adult by both judges (*calibrate*) |
| **Light direction** | Vision rubric on the rotated in-game composite | Reads top-left |
| **Spine split** | Rest-pose reassembly vs master; rotate each bone ±35° | SSIM > 0.98, alpha IoU > 0.99, no holes |
| **Baked 3D insert** | Frame 1 vs static sprite; loop seam; alpha bounds; pivot drift; hull bleed | All pass |
| **Video loop** (if used) | Last frame vs first after keying | Mean abs diff < 2/255 |

**Retry budget:** 2 automatic regenerations per asset, then the best result goes to a human.

## 11. Human gates and authorship

- **You or your art director pick one direction** out of the 4 explored.
- **A paintover artist paints over 10–20 hero images.** They become the canonical, ordered reference pack in `art/source/refs/style/` and the LoRA training set.
- **Batch sign-off** on every final 2D asset and mascot turnaround, including the child-likeness check.
- **Why the paintover matters legally:** purely AI-generated images are not protectable by copyright in the US (Thaler v. Perlmutter, D.C. Cir. 2025; cert denied 2026-03-02). The paintover log plus the manifest's `humanEditor` / `humanEditSummary` fields are your authorship record.
- **Nano Banana images carry SynthID**, which cannot be removed. Decide a disclosure policy with counsel.
