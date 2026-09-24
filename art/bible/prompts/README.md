# Prompt templates

Every generation prompt in this project is **rendered from these templates plus [`../artbible.json`](../artbible.json)**. Nobody types a prompt by hand. Rendering from templates gives three things:

- **One style.** The same style formula goes byte-identical into every prompt.
- **Provenance.** Each rendered prompt is hashed into `art/manifest.json`, so every asset can be traced and regenerated (schema: [`../../manifest.schema.json`](../../manifest.schema.json)).
- **Route independence.** The same text works on Higgsfield, Vertex and Scenario.

Human-readable rationale: [docs/ART_BIBLE.md](../../../docs/ART_BIBLE.md). Where each template is used: [docs/PIPELINE.md](../../../docs/PIPELINE.md).

| Template | Used for | Default model / route |
|---|---|---|
| `symbol.txt` | High-pay, wild and scatter masters (beauty version + rig-ready version) | Nano Banana Pro, or Scenario LoRA model |
| `symbol_parts_sheet.txt` | Spine-split helpers: A parts sheet, B isolate one part, C hidden-area fill, D state variants | Nano Banana Pro edit (after FLUX.1 Fill [pro] for C) |
| `royal_material_pass.txt` | Optional surface pass on vector royals L1–L5 | Nano Banana Pro edit |
| `mascot_turnaround.txt` | A design model sheet (approval); B one 3D-input view per image | Nano Banana Pro at 4K |
| `mascot_expressions.txt` | A expressions, B mouth/eye, C hands, D key poses | Nano Banana Pro |
| `background.txt` | A plate, B parallax layer, C neon-only layer, D bright game-tile plate | Nano Banana Pro at 4K |
| `frame_piece.txt` | Beam, post, sill and corner cap for 3-slice | Nano Banana Pro (or Recraft SVG) |
| `vfx_keyframe.txt` | Look-dev frames for the FX style guide | Nano Banana Pro / NB2 |
| `video_loop.txt` | Animatics and motion reference; Wan loops | Higgsfield `seedance_2_0` / `kling3_0`; Wan 2.x self-hosted |
| `sfx.txt` | Sound effects (cue id = `SfxId`) | ElevenLabs SFX v2; Stable Audio |
| `music.txt` | Music stems `base` / `freegame` / `bigwin` | Eleven Music |

## File format and rendering rules

1. A line starting with `# ` is a **comment**. The renderer drops it.
2. A line starting with `## SECTION X` starts a **section**. A file with sections holds several prompts; pick one as `file.txt#X` (for example `symbol_parts_sheet.txt#C`).
3. `{PLACEHOLDER}` values come from `artbible.json`, or from the per-asset brief when the template's comment block says so. `{STYLE_FORMULA}` is always `artbible.styleFormula`, verbatim. An empty placeholder renders as nothing.
4. After substitution, collapse runs of blank lines. Then **fail** if any `{…}` is left, or if the text contains a forbidden word (`kid`, `child`, `cute`, `chibi`, `baby`, or any brand/studio/artist/game name).
5. `promptHash` = sha256 of the final UTF-8 string with no trailing newline. Store the rendered text as `prompt.txt` next to the raw output.

A minimal renderer (the production version belongs in the planned `pnpm gen:*` scripts):

```python
import hashlib, json, re, sys
bible = json.load(open("art/bible/artbible.json"))
def render(path, section=None, **vals):
    text, cur, keep = [], None, section is None
    for line in open(path, encoding="utf-8").read().splitlines():
        if line.startswith("## SECTION"):
            cur = line.split()[2]; keep = (cur == section); continue
        if line.startswith("#") or not keep: continue
        text.append(line)
    vals.setdefault("STYLE_FORMULA", bible["styleFormula"])
    out = re.sub(r"\{([A-Z0-9_]+)\}", lambda m: str(vals.get(m.group(1), m.group(0))), "\n".join(text))
    out = re.sub(r"\n{2,}", "\n", out).strip()
    assert not re.search(r"\{[A-Z0-9_]+\}", out), "unfilled placeholder"
    assert not re.search(r"\b(kid|child|cute|chibi|baby)\b", out, re.I), "forbidden word"
    return out, hashlib.sha256(out.encode("utf-8")).hexdigest()
```

---

## Route 1: Higgsfield (MCP or CLI)

**Status (2026-09-24).** Higgsfield is a supported route and you asked for it. It serves the same Nano Banana Pro model as Vertex.

- **Use it now for:** exploration, multi-model A/B, animatics and motion reference.
- **Before its images ship:** clear the items in [STACK § Image route](../../../docs/STACK.md#image-route-higgsfield-or-vertex--scenario-you-decide), mainly training on your uploads (unless opted out on Enterprise) and real-money gambling use.
- **Never run OpenAI models through it** (`gpt_image_2`, `gpt_image_2_5`): see `licenses/denylist.json`.
- **Its audio models** (`mirelo_text_to_audio`, `sonilo_music`) are for drafts only until their terms are known.

### Model-id trap (verify every time)

| What you want | Higgsfield **CLI** id | Note |
|---|---|---|
| Nano Banana **Pro** (finals) | `nano_banana_2` | Yes, "2" is Pro. The MCP may list it as `nano_banana_pro`. |
| Nano Banana 2 (cheap) | `nano_banana_flash` | |
| Nano Banana 2 Lite | `nano_banana_2_lite` | 1k only |
| Video, start+end frames | `seedance_2_0`, `seedance_2_0_mini`, `kling3_0`, `seedance1_5` | `seedance_1_5` on the MCP (community-reported) |
| Vector icons | `recraft_v4_1 --model_type vector` | prompt-only |

Resolve ids live: `models_explore` on the MCP, `higgsfield model list --json` on the CLI. Snapshot the catalog into `art/_raw/_meta/higgsfield-models-<date>.json`.

**No seed and no negative prompt** on any Higgsfield image or video model. Consistency comes from the frozen formula plus 3–6 reference images. Phrase exclusions positively ("tack sharp" rather than "no blur") and keep prompts under about 200 tokens.

### MCP (interactive, in Claude Code or claude.ai)

```bash
claude mcp add --transport http --scope user higgsfield https://mcp.higgsfield.ai/mcp
# in Claude Code: /mcp -> higgsfield -> Authenticate, then call the MCP tool select_workspace once
```

- **Call shape** (observed in Higgsfield's and community skills): `generate_image` with `{model, params:{prompt, aspect_ratio, resolution}, medias:[{value, role}]}`, then `job_status`. `value` is a media_id or a previous job_id.
- **Uploading images:** use `media_upload` → HTTP PUT → `media_confirm`. Import any https URL first.
- **Open bugs (2026-09-24):**
  - [#76](https://github.com/higgsfield-ai/cli/issues/76): the Claude Code OAuth token exchange fails.
  - [#93](https://github.com/higgsfield-ai/cli/issues/93): `generate_image`/`generate_video` advertise an empty schema, so calls fail with `params: Invalid input`.
  - If you hit either, use the claude.ai connector (Customize → Connectors → Add custom connector) or the CLI below.
- **Cost:** MCP generations always use credits. Seedance 1.5 over the MCP defaults to **12 s** when you omit duration, so always pass it.

### CLI (unattended batches; recommended for production runs)

```bash
npm i -g @higgsfield/cli@1.1.26
higgsfield auth login                     # browser PKCE login
higgsfield workspace list && higgsfield workspace set <id>   # NOT `hf …` on npm installs (clashes with Hugging Face)
higgsfield model get nano_banana_2 --json # roles, enums, defaults

# price first, then run
higgsfield generate cost   nano_banana_2 --prompt "$(cat prompt.txt)" --aspect_ratio 1:1 --resolution 2k
higgsfield generate create nano_banana_2 --prompt "$(cat prompt.txt)" \
  --image art/source/refs/style/01.png --image art/source/refs/style/02.png --image art/source/refs/style/03.png \
  --aspect_ratio 1:1 --resolution 2k --wait --json | tee job.json
```

- **Video** (animatics and motion reference only). Always set aspect ratio, duration and resolution, and turn audio off:

```bash
higgsfield generate create seedance_2_0 --prompt "$(cat prompt.txt)" \
  --start-image idle.png --end-image idle.png --image-references front.png --image-references tq.png \
  --aspect_ratio 1:1 --duration 5 --resolution 1080p --mode std --generate_audio false --wait --json
higgsfield generate create kling3_0 --prompt "$(cat prompt.txt)" \
  --start-image s.png --end-image s.png --aspect_ratio 1:1 --duration 3 --mode pro --sound off --wait --json
```

  The key-pose image's aspect ratio must equal the video's. Kling accepts only 1:1, 16:9 or 9:16. If you omit `--aspect_ratio`, a 1:1 pose silently comes back reframed to 3:4.

- **Near-static loops.** Identical start and end frames often produce almost no motion. Use two halves instead:
  1. Clip 1 gets `--start-image A` only.
  2. Take its rendered last frame: `ffmpeg -sseof -0.1 -i c1.mp4 -frames:v 1 B.png`.
  3. Clip 2 gets `--start-image B.png --end-image A_rendered.png`, where A_rendered is clip 1's first frame extracted from the video, not the source image.
  4. Concatenate, dropping the duplicate frames.
- **Credits** (measure with `generate cost`; sources conflict): Nano Banana Pro is roughly 10–12 credits at 2K and 20–25 at 4K via the MCP, while another source says about 2. Plans (annual billing): Plus $39/1,000 credits, Ultra $99/3,000. Top-ups are $5/100 credits and expire after 90 days. MCP and CLI never use "Unlimited".
- **Provenance.**
  - Save `art/_raw/<asset>/v<NN>/{prompt.txt, args.json, refs/, job.json, raw.png|raw.mp4}`.
  - Download the result URL. Never hot-link a vendor URL from the game.
  - Write a manifest row with `route: "higgsfield-cli"`, `model: "nano_banana_2"`, `seed: null`, `jobId`.

---

## Route 2: Nano Banana Pro on Vertex AI (recommended production route)

```bash
pip install google-genai==2.25.0 pillow
```

```python
from google import genai
from google.genai.types import GenerateContentConfig, ImageConfig
from PIL import Image
client = genai.Client(vertexai=True, project=PROJECT_ID, location=LOCATION)
refs = [Image.open(p) for p in ref_paths]            # up to 14 references
resp = client.models.generate_content(
    model="gemini-3-pro-image",                       # GA id; never the -preview id in production
    contents=[prompt, *refs],
    config=GenerateContentConfig(image_config=ImageConfig(image_size="2K", aspect_ratio="1:1")),
)
for part in resp.candidates[0].content.parts:
    if part.inline_data: open("raw.png", "wb").write(part.inline_data.data)
```

- **Sizes:** `image_size` `"2K"` for symbols and sheets; `"4K"` for backgrounds and turnaround sheets (Google marks 4K as preview).
- **Aspect ratios:** 1:1, 3:2, 2:3, 4:3, 3:4, 4:5, 5:4, 9:16, 16:9, 21:9.
- **Price (verified):** $0.134 per 1K/2K image, $0.24 per 4K. NB2 (`gemini-3.1-flash-image`) costs $0.067/$0.101/$0.15. Use the **Batch API** for bulk runs (about 50% off).
- **No alpha, no seed.** Every output carries SynthID + C2PA. Get alpha by keying, or by rendering the same edit on white and on black and difference-matting.
- **EEA/UK/CH users need a paid tier.**

## Route 3: Scenario (style lock; batch symbols)

```bash
claude mcp add --transport http scenario "https://mcp.scenario.com/mcp?toolsets=full"   # OAuth; ?toolsets=full exposes training
npx skills add scenario-labs/skills
```

- **Train.**
  - One style LoRA from the 10–20 human paintovers (`art/source/refs/style/`).
  - One LoRA per mascot (5–15 images).
  - Run three **Apache-2.0** bases side by side: Qwen Image, Z-Image and FLUX.2 Klein 4B Base. **Never FLUX.2 dev / Klein 9B** (non-commercial).
  - Always set `sample_prompts`, cap at **4 epochs**, and price each job with a **dry run** first.
  - Keep the winner, judged by DINOv2 plus Claude vision.
  - Never put Recraft outputs into a training set.
- **Generate.** Use the same rendered prompt with the LoRA model at 2048². Headless batches use REST `POST https://api.cloud.scenario.com/v1/generate/custom/{modelId}`; take parameter names from the MCP's model discovery. Log the LoRA id and dataset hash in `version`.
- **Price (unverified):** Pro ~$45/mo (the first tier with training), Max ~$75/mo.

## Route 4: Recraft (vectors: UI, icons, frame, logo vectorisation)

- **Create a style.** Run "Create Style" on 1–10 paintovers to get a `style_id`. A `style_id` and inline style references are mutually exclusive, and plain V4 ignores style, so use **V4 Styles**.
- **Interactive:** `claude mcp add --transport http --scope user recraft https://mcp.recraft.ai/mcp`.
- **Batch:** the REST API with `RECRAFT_API_KEY`.
- **Paid plan or API only.** Free-plan outputs belong to Recraft.
- **Rasterise** with `@resvg/resvg-js` (already a devDependency) at 1x and 2x.
- **Prompt pattern for UI pieces:** `"Game UI {ELEMENT}, {SHAPE}, flat vector, {FILL}, {STROKE}, no text, no letters"`. Take fills and strokes from `artbible.environment.ui`.

## Audio routes

- **ElevenLabs** (SDK `@elevenlabs/elevenlabs-js` / `@elevenlabs/cli`):
  - SFX uses `eleven_text_to_sound_v2` with output `pcm_48000` (wrap with ffmpeg), `prompt_influence` 0.5–0.8, and `loop=true` only for risers (≤30 s).
  - Music uses Eleven Music `music_v2` / `music_v2_5` with composition plans (no lyric lines).
  - Prototype on Pro. **Ship only under an Enterprise agreement.**
- **Stable Audio 2.5/3.0 API:** $0.20 / $0.26 per generation. Use it for audio-to-audio variations and seam inpainting (uploads must be ≥6 s).
- **Higgsfield** `mirelo_text_to_audio --prompt … --duration 2` and `sonilo_music --prompt … --duration 30`: drafts only until cleared.

## Gates every rendered output passes

The full list is in [docs/ART_BIBLE.md § QA gates](../../../docs/ART_BIBLE.md#qa-gates). The main ones:

- Readability at 64 px.
- Silhouette confusion.
- Palette ΔE.
- Outline histogram.
- Halo on black and on white.
- No text.
- Canvas and pivot.
- Adult proportions (mascots).
- Loop seam (video): mean abs diff < 2/255 after keying.
- Keyed-video background drift: at least 85% of a mid-clip frame's border within distance 90 of its median colour; reroll if the median is more than 300 from the key.

**Retry budget:** 2 automatic regenerations per asset, then the best result goes to human review.
