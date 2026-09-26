# tools/gen: generation wrappers (Higgsfield CLI + MCP ingestion, Vertex Nano Banana Pro, Scenario)

Committed scripts that turn **art bible templates** into **vendor requests** and store the result
with provenance. MCP servers are for exploring; anything that may ship comes from these
([docs/PIPELINE.md](../../docs/PIPELINE.md) production rule).

| Script | Vendor / route | Model ids (licence-gated) |
|---|---|---|
| `higgsfield.mjs` | official `@higgsfield/cli` (`higgsfield generate create <model> … --wait --json`), route `higgsfield-cli` | `nano_banana_2` (= **Nano Banana Pro**), `nano_banana_flash`, `nano_banana_2_lite`, `seedance_2_0(_mini)`, `kling3_0(_turbo)` |
| `nbp.py` | Vertex AI via `google-genai` (sync or Batch API), route `vertex` | allowlist `modelIds`: `gemini-3-pro-image` (GA; `-preview` refused), `gemini-3.1-flash-image`, `gemini-3.1-flash-lite-image` |
| `scenario.py` | Scenario REST `POST /v1/generate/custom/{modelId}`, route `scenario` | your LoRA model id; `--base` must be an Apache-2.0 base (`qwen-image`, `z-image`, `flux2-klein-4b-base`) |
| `hf-ingest.mjs` (`pnpm gen:hf-ingest`) | Higgsfield **MCP** jobs, route `higgsfield-mcp`: `plan` (rendered `generate_image_batch` arguments) → `record` (MCP JSON → committed ledger `art/ledger/higgsfield-jobs.json`) → ingest (CDN → `art/_raw` + rows) · `status` · `check` | MCP ids: `nano_banana_pro` (= **Nano Banana Pro**; its jobs report `nano_banana_2`, which the row records), `nano_banana_2` (= Nano Banana **2** on the MCP!), `seedream_v4_5` |
| `lib/hfledger.mjs` | ledger load/validate (schema `art/ledger/higgsfield-jobs.schema.json`) and locked updates, prompt re-render vs stored copy, asset/stage/model resolution, MCP JSON parsing | |
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

## Higgsfield MCP route: plan → pay → record → ingest (`pnpm gen:hf-ingest`)

The MCP generates on Higgsfield's side and hands back CDN URLs, so the wrapper cannot own the call the way
`higgsfield.mjs` owns the CLI. Instead every **paid** MCP job goes into the committed ledger
`art/ledger/higgsfield-jobs.json` (schema next to it; `art/_raw` is gitignored, the ledger survives
container restarts), and `hf-ingest.mjs` turns ledger jobs into the same raw layout and rows as every
other route. It never calls the MCP and needs no credentials. Model ids differ from the CLI's: on the
MCP `nano_banana_pro` is Nano Banana Pro (the finished job reports `nano_banana_2`) and `nano_banana_2`
is Nano Banana 2. Never an OpenAI model (`gpt_image_2`, `gpt_image_2_5`, `openai_hazel`): `plan`,
`record` and ingest all refuse them (exit 3). No seed and no negative prompt on Higgsfield.

```bash
# 1. plan: render every prompt from the art bible and print the exact generate_image_batch arguments
#    (≤ 12 requests per call; `resolution` 1k|2k|4k, medias = media_id/job_id UUIDs with role image_references)
pnpm gen:hf-ingest plan --spec spec.json --max-credits 20      # -> art/_work/hf-plans/<batch>.plan.json + {calls:[{requests}]}
python3 art/plan/build_plan.py spec --batch c01 > spec.json    # the Bass Drop plan emits this spec shape
# 2. pay: pass calls[i] to the MCP tool generate_image_batch; save its JSON reply verbatim (e.g. submit.json)
# 3. record the paid jobs at once (before waiting), then again with the jobs_wait reply
pnpm gen:hf-ingest record --plan art/_work/hf-plans/<batch>.plan.json --from submit.json
pnpm gen:hf-ingest record --from wait.json                     # status, result_url, reported model (never downgrades)
#    re-recording is a no-op; a plan submitted twice keeps the second set of (paid) jobs as <name>.r2, .r3, …
# ad-hoc MCP calls made without a plan (prompt stored verbatim, template null); items may carry "name":
pnpm gen:hf-ingest record --batch ab1 --request req.json --from submit.json [--name 0=ui_emblem_juke] [--purpose …] [--plan-tier "Higgsfield Plus"]
pnpm gen:hf-ingest record --batch ab1 --request staged.json --from staged.json   # [{index,name,params,job_id,result_url}] lists
# 4. download + provenance (idempotent; re-run = no-op; an interrupted download resumes with HTTP Range)
pnpm gen:hf-ingest [--batch B] [--job NAME|JOB_ID] [--dry-run]
pnpm gen:hf-ingest status [--json]      # jobs, credits spent per batch, downloaded or not, target folder / row id
pnpm gen:hf-ingest check [--store-prompts]   # ledger schema + every prompt reproducible + licence gate (offline, CI-safe)
```

MCP JSON accepted by `record --from` (file or `-`): any `{jobs:[…]}` / `results` / top-level array whose items carry
`job_id` (or `id`) plus `index`, `status`, `model`, `type`, `result_url`, also when wrapped as an MCP tool result
(`{content:[{type:"text",text:"<json>"}]}`). The `jobs_wait` reply shape was checked live on 2026-09-26; the
`generate_image_batch` reply is parsed by the same generic rule (items without a `job_id` are reported as not
submitted, no charge). An item with a `result_url` but no `status` counts as completed.

Plan spec (`plan --spec`): `{"batch", "model", "purpose"?, "planTier"?, "date"?, "resolution"?, "aspect_ratio"?,
"jobs": [{"name", "template", "vars": {"symbol"|"mascot"|"rigReady", "UPPER_CASE_PLACEHOLDER": "value"},
"resolution"?, "aspect_ratio"?, "credits"?, "index"?, "request_model"?, "medias"?, "asset"?, "stage"?}]}`.
Credits are estimated from the rates measured on 2026-09-26 (NBP 2 at 2k / 4 at 4k, NB2 1.5 at 1k / 2 at
2k, Seedream 4.5 1); unknown rates make `--max-credits` fail closed (exit 4).

What ingest does for every `completed` job without a local copy:
1. **Gate + prompt first, no network:** licence gate on the request and the reported model; the prompt is
   re-rendered from `template` + `vars` (genlib) and must hash to `promptHash`. If the bible or template
   changed since, the stored copy `art/ledger/prompts/<promptHash>.txt` is used (warning); neither → exit 2.
   `record` stores every recorded prompt there; `check --store-prompts` freezes older jobs.
2. **Download** `result_url` (https on `*.cloudfront.net` / `*.higgsfield.ai` only; `--allow-host` adds one)
   into `art/_raw/.incoming/<job_id>.part`, resuming with `Range` after an interruption (`--retries`, `--timeout-s`).
   The **egress-policy 403** (`x-deny-reason`, or a refused proxy CONNECT) stops at the first job, names the host
   and says to allow it in the environment's Network access settings (exit 6); a CloudFront 403/404 says the URL
   expired: refresh it with `jobs_wait` + `record`.
3. **Verify:** PNG signature, IHDR first, every chunk CRC, IDAT, IEND (truncation); size vs the job
   (exact once the ledger knows it, else aspect within 3 % and ~1024·k px per side or long edge for `k`k);
   sha256 vs the ledger/manifest. A failure keeps the bytes as `.incoming/<job_id>.rejected` and exits 7
   (`--allow-size-mismatch` accepts an odd size and notes it in the row).
4. **Write** `art/_raw/<asset>/vNN/{raw.png, prompt.txt, job.json, manifest.json}`. `<asset>` = the job's
   `asset`, else genlib's `defaultAsset` (the same folder `gen:higgsfield` uses: `sym_H1`, `sym_H1_rig`,
   `mascot_gumbo_turnaround_A`, `background_A`), else the name; candidates of one asset get v01, v02, ….
   A job already in `art/manifest.json` keeps its `vNN` on any machine. Nothing is ever overwritten: an
   existing different `raw.png`/`prompt.txt`/row is a conflict (exit 7).
5. **Rows** (append-only, `art/manifest.json` created if missing): id `<asset>.raw.vNN` (lower-case; the
   `--parent-id` for `pnpm matte`), `route: higgsfield-mcp`, `vendor: Higgsfield`, `model` as reported
   (`nano_banana_2` for NBP), `version: higgsfield-mcp/<request model>@<batch date>`, `seed: null`, `jobId`,
   `promptPath`, `promptHash`, `template`, `refHashes` (from `medias[].sha256`), stage per kind
   (symbols/parts/props/frame/VFX `2d-image`, mascot sheets `mascot-sheets`, backgrounds `backgrounds`;
   `stage` overrides), `licenseId: higgsfield`, `tosVersion` (newest `licenses/tos/higgsfield/*.pdf`, else
   null), `planTier`, `cost` in credits, `shipped: false`. The ledger job gains `sha256/width/height/bytes`.
6. **Licence:** allowlist `higgsfield` is `clearance: pending`, so these rows **build and preview but cannot
   ship**: `pnpm licence:audit` passes (ToS warning); any shipped row or `public/assets` file descending from
   them fails with "licence 'higgsfield' has clearance 'pending'" until `licenses/clearances/higgsfield.pdf`
   is filed and the entry says `cleared`.

Exit codes (`hf-ingest.mjs`): `0` ok/nothing to do · `2` usage, ledger or prompt error · `3` licence refusal ·
`4` cost cap (plan) · `6` download failure incl. the egress block · `7` verification failure or file conflict.

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
tools/.venv/bin/python tools/gen/test/test_gen.py     # 35 tests; also runs with a stdlib-only python3
python3 tools/gen/test/test_hf_ingest.py              # the 11 hf-ingest tests alone
```
Covers: every template/section rendered by Python and Node with identical text + hash; the gate table
(allowed: NBP/NB2/Seedance/Kling/ElevenLabs/Stable Audio 2.5; refused: `gpt_image_2(_5)`, `openai_hazel`,
`sora_2`, `mirelo_*`, `sonilo_*`, `hunyuan_*`, `flux_1_dev`, `-preview` ids, MusicGen, SA3-medium);
Higgsfield via `test/fake-higgsfield.mjs` (dry-run writes nothing, explicit video flags + audio off,
cost preview, download, row, idempotent skip, resume after a failed job); NBP dry-run validated with
the real `google-genai` types, Batch stage → collect; Scenario against a local mock REST server (auth
header, asset upload, polling, CU cost, cost cap); manifest rows validated with `jsonschema`.
`test_hf_ingest.py` runs hf-ingest against a local HTTP server standing in for the Higgsfield CDN:
layout + rows (validated with `jsonschema` when installed and always with the audit's own `schema-lite`),
stage per kind, reported model, idempotent re-run (no request, no file touched), manifest rebuilt from
sidecars, Range resume after a cut connection, bad signature / truncated PNG / wrong size / wrong aspect,
egress 403 (one request, clear message) vs CloudFront 403 vs a non-allowed host, tampered `raw.png` and a
changed CDN file never overwritten, prompt drift → stored-prompt fallback, OpenAI models refused,
`plan` → `record` (submit + wrapped `jobs_wait`, no status downgrade, idempotent) → ingest → `status`,
staged request/result lists, placeholder media ids refused, the real ledger valid and every probe prompt
reproducible, and `pnpm licence:audit` passing on the rows but failing once they are shipped.

## Doc snippets (for docs/PIPELINE.md "Tooling status" and art/bible/prompts/README.md)

```md
| `tools/gen/{higgsfield.mjs,nbp.py,scenario.py}` + `genlib` | **exists** | Rendered-prompt generation (Higgsfield CLI, Vertex NBP sync/Batch, Scenario LoRA REST) into `art/_raw/<asset>/vNN/` with manifest rows; licence gate; `--dry-run` |
| `tools/gen/hf-ingest.mjs` (`gen:hf-ingest`) | **exists** | Higgsfield MCP: `plan` (rendered batch arguments) → `record` (ledger `art/ledger/higgsfield-jobs.json`) → ingest (CDN → `art/_raw` + `higgsfield-mcp` rows; resumable, verified, idempotent) · `status` · `check` |
```
- prompts/README.md minimal renderer: `line.split()[2]` yields `"A:"`, not `"A"`, so `file.txt#A` never
  matches; and `re.sub(r"\n{2,}", "\n")` leaves double spaces from empty placeholders. Point readers
  at `python3 tools/gen/genlib.py render …` as the reference implementation instead.
- artbible.json: H3's brief says "not cute" (the renderer strips it, but the bible should say
  "swaggering, tough"), and W's brief carries the human note "The word WILD is live text…".
