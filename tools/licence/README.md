# tools/licence: licence-audit

`audit.mjs` is the `licence-audit` check (make it a **required** status check, docs/PIPELINE.md 0.3).
Dependency-free (Node 22): `schema-lite.mjs` validates the JSON Schema subset the manifest uses.

```bash
node tools/licence/audit.mjs                     # dev: placeholder exemptions warn
node tools/licence/audit.mjs --release --strict  # release gate: placeholders and warnings fail
node tools/licence/audit.mjs --json build/qa/licence-audit.json
```

It fails on:

- `art/manifest.json` (if present) invalid against `art/manifest.schema.json`, duplicate row ids;
- a `licenseId` missing from `licenses/allowlist.json`, or listed in `licenses/denylist.json`;
- a row `model` matching the denylist: by id, by `vendor:model` (`higgsfield:gpt_image_2`), and by
  model family across resellers (OpenAI image/video, Hunyuan, FLUX dev, MusicGen/MMAudio, Suno, Udio,
  BRIA RMBG, Higgsfield Mirelo/Sonilo, …) — the same matcher the generators use to refuse calls;
- a vendor call (a row whose `route` is a vendor, not `code`/`ffmpeg`/`blender`/…) with a model outside
  its allowlist entry's `modelIds` (e.g. `gemini-3-pro-image-preview`); derivatives inherit the
  upstream `licenseId` and are not model-checked;
- a dangling `parents` id; a `sha256` that no longer matches the file or frame folder on disk
  (an older row of a regenerated path is history, not drift);
- **shipping** a licence whose clearance is not `cleared`/`not-required`, for the row **and every
  ancestor** — every file under `public/assets` counts as shipped whatever its `shipped` flag says;
- a shipped chain containing a vendor generation with `tosVersion: null`, or any `tosVersion` file
  that does not exist (an unshipped generation without an archived ToS only warns);
- a file in `public/assets` with no row and no exemption; `--release` also fails `placeholder` exemptions;
- a `package.json` dependency named in the denylist (`@theatre/studio`, `stake-engine`, …).

`exemptions.json` covers the bundled OFL/Apache fonts (each `.woff2` must have its
`fonts/licenses/<Family>-*.txt`), their licence texts, and the CC0 RobotExpressive placeholder
(with its `LICENSE.txt`; `placeholder: true`).

## Tests

```bash
node --test tools/licence/test/audit.test.mjs   # 14 tests
```
A clean fixture passes (with a "no archived ToS" warning); each single mutation fails: OpenAI model
via Higgsfield, unknown and denylisted licenseId, missing `tosVersion` key / wrong `schemaVersion` /
uppercase id, an uncovered public file, a pending licence shipped directly / via an ancestor / via a
`shipped:false` row covering a public file, a shipped derivative of a Vertex generation without an
archived ToS (while the derivative itself passes the `modelIds` check), sha drift on a file and on a folder row, a model outside
`modelIds`, a missing ToS PDF, a dangling parent, a denylisted dependency, a font without its licence;
placeholder exemption warns in dev and fails with `--release`; CLI exit codes 0/1/2 and `--strict`;
every provenance sidecar written by the other tools' tests passes the schema.

**Current repo state (2026-09-24):** fails only on `public/assets/spine/demo/sym_demo.{atlas,json,png}`
(no rows yet: run `tools/spine/pack.py … --manifest art/manifest.json`, and add an allowlist entry
for the `owned-code` licenseId that tools/spine writes, or switch it to an existing id).
