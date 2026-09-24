# tools/gen: generation wrappers (Higgsfield CLI, Vertex Nano Banana Pro, Scenario)

Committed scripts that turn **art bible templates** into **vendor requests** and store the result
with provenance. MCP servers are for exploring; anything that may ship comes from these
([docs/PIPELINE.md](../../docs/PIPELINE.md) production rule).

| Script | Vendor / route | Model ids (licence-gated) |
|---|---|---|
| `higgsfield.mjs` | official `@higgsfield/cli` (`higgsfield generate create <model> … --wait --json`), route `higgsfield-cli` | `nano_banana_2` (= **Nano Banana Pro**), `nano_banana_flash`, `nano_banana_2_lite`, `seedance_2_0(_mini)`, `kling3_0(_turbo)` |
| `nbp.py` | Vertex AI via `google-genai` (sync or Batch API), route `vertex` | allowlist `modelIds`: `gemini-3-pro-image` (GA; `-preview` refused), `gemini-3.1-flash-image`, `gemini-3.1-flash-lite-image` |
| `scenario.py` | Scenario REST `POST /v1/generate/custom/{modelId}`, route `scenario` | your LoRA model id; `--base` must be an Apache-2.0 base (`qwen-image`, `z-image`, `flux2-klein-4b-base`) |
| `genlib.py` / `lib/genlib.mjs` | shared: template rendering, licence gate, raw-folder layout (Python and JS twins, parity-tested) | |
| `provenance.py` / `lib/provenance.mjs` | manifest rows (schema `art/manifest.schema.json`), append-only + locked writes; also used by tools/matte, video, audio, assets | |

## What every call does

1. **Licence gate first** (`genlib.gate`): refuses (exit 3) any model on `licenses/denylist.json`
   (matched by id, `vendor:model`, and by model *family* so reseller ids such as `gpt_image_2`,
   `openai_hazel`, `hunyuan_*`, `mirelo_text_to_audio` are caught), any Vertex model not in an
   allowlist entry's `modelIds`, and unknown routes. `clearance: pending` only warns: **clearances
   gate shipping, not building** (the licence audit enforces that on shipped rows).
2. **Prompt rendered, never typed**: `art/bible/prompts/<file>.txt[#SECTION]` + `artbible.json`
   (+ `template-vars.json` defaults copied verbatim from the template comments, + `--var NAME=value`).
3. **Raw folder**: `art/_raw/<asset>/vNN/{prompt.txt, args.json, refs/NN_<ref>, cost.json, job.json, raw.<ext>, manifest.json}`.
   `args.json` holds the request fingerprint (route, model, promptHash, refHashes, params).
   *Idempotent*: an identical request with finished output is skipped ("already generated"); a failed
   one resumes in the same `vNN`; `--force-new` makes a new version. Higgsfield downloads land as
   `.part_N` files renamed to `raw*` only when every result arrived, and a resume whose `job.json`
   already holds a finished job re-downloads it instead of paying for a new generation.
   Cost caps (`--max-credits`, `--max-cu`) **fail closed**: a cost preview without a recognisable
   figure aborts with exit 4 instead of generating unchecked.
4. **Manifest row** per output appended to `art/manifest.json` (`--manifest none` to skip) with
   `promptHash`, `refHashes`, `jobId`, `seed` (null where the vendor has none), `planTier`,
   `tosVersion` (newest `licenses/tos/<vendor>/*.pdf`, else null + warning), `licenseId`, `cost`.
5. **`--dry-run`** prints the exact request (CLI argv / HTTP method+URL+body, secrets redacted), the
   rendered prompt, its hash and the target folder, and writes nothing.

Exit codes: `0` ok/skipped · `2` usage or template error · `3` licence refusal · `4` cost cap · `5` vendor failure · `6` download failure.

## Setup

```bash
python3 -m venv tools/.venv && tools/.venv/bin/pip install -r tools/requirements.txt   # google-genai 2.25.0 etc.
npm i -g @higgsfield/cli@1.1.26 && higgsfield auth login && higgsfield workspace set <id>
gcloud auth application-default login   # Vertex; export GOOGLE_CLOUD_PROJECT=... GOOGLE_CLOUD_LOCATION=global
export SCENARIO_API_KEY=... SCENARIO_API_SECRET=...                    # Scenario > API keys
```

## Examples

```bash
# render only (hash = sha256 of the exact prompt, no trailing newline)
python3 tools/gen/genlib.py render --template symbol.txt --symbol H1 --json
python3 tools/gen/genlib.py list-templates        # every template/section and its placeholders

# Higgsfield: Nano Banana Pro symbol master (cost preview, then create --wait --json)
node tools/gen/higgsfield.mjs --template symbol.txt --symbol H1 \
  --image art/source/refs/style/01.png --image art/source/refs/style/02.png --resolution 2k --max-credits 30 [--dry-run]
# Higgsfield video animatic: aspect, duration, resolution/mode always explicit; audio always off
node tools/gen/higgsfield.mjs --template video_loop.txt --var ACTION="slow breathing, one blink" \
  --model seedance_2_0 --start-image pose.png --end-image pose.png --aspect-ratio 1:1 --duration 5 [--dry-run]
node tools/gen/higgsfield.mjs --snapshot-models   # -> art/_raw/_meta/higgsfield-models-<date>.json

# Vertex NBP (sync), 6 style refs at 2K; mascots at 4K
python tools/gen/nbp.py --template symbol.txt --symbol W --rig-ready --ref art/source/refs/style/0{1..6}.png [--dry-run]
python tools/gen/nbp.py --template mascot_turnaround.txt#A --mascot gumbo --image-size 4K --aspect-ratio 21:9
# Vertex Batch API (50 % price): stage -> upload -> submit -> collect
python tools/gen/nbp.py --template symbol.txt --symbol H1 --batch-jsonl build/nbp/batch.jsonl
gsutil cp build/nbp/batch.jsonl gs://BUCKET/in/batch.jsonl
python tools/gen/nbp.py batch-submit --src gs://BUCKET/in/batch.jsonl --dest gs://BUCKET/out/
python tools/gen/nbp.py batch-collect --jsonl build/nbp/batch.jsonl --results predictions.jsonl --job <name> --template symbol.txt

# Scenario LoRA batch (parameter names from the Scenario MCP model discovery)
python tools/gen/scenario.py --template symbol.txt --symbol H3 --model-id model_XXXX --base qwen-image \
  --lora-version "lora=model_XXXX dataset=sha256:…" --param guidance=3.5 --param numInferenceSteps=28 [--price | --dry-run]
```

## Prompt rendering rules (canonical; the JS and Python renderers agree byte for byte)

1. `# ` lines are comments; `## SECTION X: …` starts section `X` (the id is the token before the colon).
   A sectioned template must be called as `file.txt#X`.
2. Placeholders come from, in increasing precedence: bible globals (`STYLE_FORMULA`, default `KEY_HEX`)
   → `template-vars.json` defaults → the asset's bible context (`--symbol`: `SUBJECT`, `SYMBOL_NAME`,
   `KEY_HEX`, `FILL_PCT`, `LIGHT_NOTE` for negative `restAngle`, `RIG_READY_LINE`, `PART_LIST`,
   royals `GLYPH`/`FACE_HEX`/`FACE_NAME`; `--mascot`: `CHARACTER`, `IDENTITY_LOCK`, `KEY_HEX`) → `--var`.
3. Briefs are sanitised into subjects: a leading `PROPOSAL (...):` tag, negated child-coded words
   ("attitude, not cute") and sentences addressed to humans ("…is live text in code, never painted")
   are dropped, so the model never reads the word *cute* or a word it could paint (WILD).
4. Whitespace: NFC, every line stripped, runs of spaces collapsed, blank lines removed, no trailing newline.
5. Fail on any unfilled `{PLACEHOLDER}` and on forbidden words (`artbible.mascots.rules.forbiddenPromptWords`
   + brand/studio/artist/game names in `forbidden-words.json`, word-boundary match).
6. `promptHash = sha256(utf8(prompt))`.

## Tests (no keys, no network)

```bash
tools/.venv/bin/python tools/gen/test/test_gen.py     # 24 tests; also runs with a stdlib-only python3
```
Covers: every template/section rendered by Python and Node with identical text + hash; the gate table
(allowed: NBP/NB2/Seedance/Kling/ElevenLabs/Stable Audio 2.5; refused: `gpt_image_2(_5)`, `openai_hazel`,
`sora_2`, `mirelo_*`, `sonilo_*`, `hunyuan_*`, `flux_1_dev`, `-preview` ids, MusicGen, SA3-medium);
Higgsfield via `test/fake-higgsfield.mjs` (dry-run writes nothing, explicit video flags + audio off,
cost preview, download, row, idempotent skip, resume after a failed job); NBP dry-run validated with
the real `google-genai` types, Batch stage → collect; Scenario against a local mock REST server (auth
header, asset upload, polling, CU cost, cost cap); manifest rows validated with `jsonschema`.

## Doc snippets (for docs/PIPELINE.md "Tooling status" and art/bible/prompts/README.md)

```md
| `tools/gen/{higgsfield.mjs,nbp.py,scenario.py}` + `genlib` | **exists** | Rendered-prompt generation (Higgsfield CLI, Vertex NBP sync/Batch, Scenario LoRA REST) into `art/_raw/<asset>/vNN/` with manifest rows; licence gate; `--dry-run` |
```
- prompts/README.md minimal renderer: `line.split()[2]` yields `"A:"`, not `"A"`, so `file.txt#A` never
  matches; and `re.sub(r"\n{2,}", "\n")` leaves double spaces from empty placeholders. Point readers
  at `python3 tools/gen/genlib.py render …` as the reference implementation instead.
- artbible.json: H3's brief says "not cute" (the renderer strips it, but the bible should say
  "swaggering, tough"), and W's brief carries the human note "The word WILD is live text…".
