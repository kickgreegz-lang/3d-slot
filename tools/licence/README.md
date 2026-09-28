# tools/licence: licence-audit

`audit.mjs` is the `licence-audit` check (make it a **required** status check, docs/PIPELINE.md 0.3).
Dependency-free (Node 22): `schema-lite.mjs` validates the JSON Schema subset the manifest uses.

```bash
node tools/licence/audit.mjs                     # dev / preview: release blockers warn (pnpm licence:audit)
node tools/licence/audit.mjs --release           # release: release blockers fail
node tools/licence/audit.mjs --release --strict  # release gate: blockers and every warning fail
node tools/licence/audit.mjs --json build/qa/licence-audit.json
```

**Release blockers** (a warning per shipped row in the dev audit, an error with `--release`):

- a shipped chain (the row and every ancestor) holding a licence whose allowlist `clearance` is
  **`pending`**: a vendor whose written answer (real-money gambling incl. EU/UK, output ownership,
  training on inputs) is not filed yet. Dev builds, previews and `qa:approval` may ship it; the
  release audit refuses it with `RELEASE REFUSED: …` until the clearance is filed in
  `licenses/clearances/<vendor>.pdf` and the entry says `cleared`;
- a shipped chain holding a vendor generation without an archived ToS (`tosVersion: null`);
- a `placeholder` exemption still shipped.

Each blocker is reported once per shipped row, with the pending licences, how many rows of the
chain carry them and the generations without a ToS; a summary line says what to file. The JSON
report has `info.releaseBlockers` (`rows`, `pendingByLicence`, `rowsWithoutTos`). Any clearance
other than `cleared` / `not-required` / `pending` is an error in every mode.

## Shipping art: `ship.py`

`tools/.venv/bin/python tools/licence/ship.py <spec.json> [--dry-run | --check]` copies (or
re-encodes to WebP, deterministically) approved `art/source` files into `public/assets` and appends
one provenance row per shipped file through the locked writer `tools/gen/provenance.py`:
stage `packaging`, route `code`, `shipped: true`, parent = the source's current row (same path and
sha256; a source without one is refused), licence inherited from it. Row ids end in the output's
sha256[:8], so a re-run adds nothing and a changed output gets a new row. `--check` verifies that
every shipped file equals what the spec writes and has its row.

| Spec | Ships |
|---|---|
| `ship/bass_drop_env.json` | Bass Drop plates + neon layers (base / Juke Jam / Mega Mix × landscape / portrait, byte copies), the formula-D frame pieces (`frame_*@2x.webp`), the logo crest (`logo_emblem.webp`) → `public/assets/bass-drop/{bg,frame,logo}/` |

It fails on (every mode):

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
- **shipping** a licence whose clearance is not `cleared` / `not-required` / `pending`, for the row
  **and every ancestor** — every file under `public/assets` counts as shipped whatever its `shipped`
  flag says (`pending` is a release blocker, above);
- any `tosVersion` file that does not exist (an unshipped generation without an archived ToS only
  warns; a shipped one is a release blocker);
- a file in `public/assets` with no row and no exemption;
- a `package.json` dependency named in the denylist (`@theatre/studio`, `stake-engine`, …).

`exemptions.json` covers the bundled OFL/Apache fonts (each `.woff2` must have its
`fonts/licenses/<Family>-*.txt`), their licence texts, and the CC0 RobotExpressive placeholder
(with its `LICENSE.txt`; `placeholder: true`).

## Tests

```bash
node --test tools/licence/test/audit.test.mjs   # 15 tests
```
A clean fixture passes (with a "no archived ToS" warning); each single mutation fails: OpenAI model
via Higgsfield, unknown and denylisted licenseId, missing `tosVersion` key / wrong `schemaVersion` /
uppercase id, an uncovered public file, a clearance other than cleared / not-required / pending, sha
drift on a file and on a folder row, a model outside `modelIds`, a missing ToS PDF, a dangling
parent, a denylisted dependency, a font without its licence. A pending licence shipped directly /
via an ancestor / via a `shipped:false` row covering a public file, and a shipped derivative of a
Vertex generation without an archived ToS (while the derivative itself passes the `modelIds` check),
are release blockers: dev passes with one warning per row, `--release` fails with `RELEASE REFUSED`;
the same chain with the clearance filed and the ToS archived passes `--release`. Placeholder
exemptions warn in dev and fail with `--release`; CLI exit codes 0/1/2, `--strict`, and the
dev-pass / release-fail pair on a pending chain; every provenance sidecar written by the other tools'
tests passes the schema.

**Current repo state (2026-09-28):** `pnpm licence:audit` passes; the shipped Higgsfield-derived
Bass Drop art is reported as release blockers (Higgsfield `clearance: pending`, no archived ToS), so
`pnpm licence:audit --release` fails until the clearance is filed (docs/games/bass-drop/ART_STATUS.md §5).
