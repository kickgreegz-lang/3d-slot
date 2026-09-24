# tools/gltf — GLB optimise, validate and budget gate

```bash
tools/gltf/optimize.sh raw.glb public/assets/mascots/mascot_gumbo.glb --mascot      # production mascot gate
tools/gltf/optimize.sh in.glb out.glb --report-dir art/_work/gltf/x --max-draw-calls 2
node tools/gltf/budget.mjs some.glb --json report.json                              # gate only, no rewrite
```

## optimize.sh

`optimize.sh` runs `gltf-transform` 4.5.0 (the repo devDependency) with the settings of [PIPELINE §4.4](../../docs/PIPELINE.md#phase-4-3d-mascots-runs-in-parallel-with-phase-3):

```
optimize --compress meshopt --texture-compress webp --texture-size 1024 --join false --simplify false --flatten false --palette false
```

- **Why these flags:**
  - `join`, `flatten` and `simplify` are off, so `eye_*`/`mouth_*` meshes, skins and node names survive.
  - `palette` is off, so material names survive: the placeholder recolours by material name.
  - The runtime already registers the bundled `MeshoptDecoder` (`src/mascots/Mascots.ts`). three's GLTFLoader reads `EXT_texture_webp` natively.
- **KTX2 is opt-in:** `--texture-compress ktx2 --allow-ktx2`. The Basis transcoder's default location is a CDN, which Stake's no-external-request rule forbids, so the runtime must self-host it first.
- **After optimising:**
  - `gltf-transform validate`: exit 2 on validator errors.
  - `gltf-transform inspect`: reports go to `--report-dir` (default `build/qa/gltf/<stem>/`).
  - `budget.mjs`: exit 3 on a budget breach.

## budget.mjs

`budget.mjs` has no dependencies. It reads the GLB JSON chunk and the image headers (PNG/JPEG/WebP/KTX2), so meshopt-compressed files need no decoder.

| Check | Default |
|---|---|
| tris | < 15,000 |
| bones (union of skin joints) | ≤ 65; outside 30–60 only warns |
| texture size | ≤ 1024 px |
| file size | ≤ 1,572,864 bytes (1.5 MiB) |
| `KHR_texture_basisu` | fails unless `--allow-ktx2`; KTX2 sizes must be multiples of 4 |
| Draco | fails (the runtime ships no Draco decoder) |
| draw calls (primitive instances) | info by default; `--max-draw-calls N` gates |
| `--mascot` | the 8 canonical clips of ANIMATION_CONTRACT §7.2, morphs `surprised` + `angry`, ≤ 2 draw calls |
| `--require-clips` / `--require-morphs` | case-insensitive, like the runtime |

Exit codes: 0 pass · 3 breach · 1 error.

## Measured (2026-09-24)

| Input | Result |
|---|---|
| RobotExpressive placeholder | 463,988 → 183,520 bytes, 3,237 tris, 43 bones, 19 draw calls: PASS; `--mascot` fails on clips and draw calls, as expected |
| build_actions export (`celebrate_test` + morph) | 909,020 → 517,560 bytes: PASS |
| cleaned fixture | → 66,484 bytes, 14,000 tris, 1 draw call, WebP 64×8 palette: PASS |
| raw 46k-tri fixture | fails on tris (exit 3) |

Two consecutive optimize runs give byte-identical GLBs.
