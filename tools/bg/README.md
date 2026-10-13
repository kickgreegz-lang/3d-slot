# tools/bg: background layers → shipped plates

`layers.py` turns approved background layers into the plates `LayeredEnvironment` (`src/environment/`) loads. The layers come from a Higgsfield plate split with `image_decompose` or generated as separate depth layers, with the holes behind front layers filled ([HIGGSFIELD_PLAYBOOK §3.3](../../docs/new-slot/HIGGSFIELD_PLAYBOOK.md#33-background-from-one-plate-to-a-reactive-scene)).

```bash
tools/.venv/bin/python tools/bg/layers.py --spec docs/games/<game>/bg/base_landscape.layers.json \
    [--out public/assets/<game>/bg] [--manifest art/manifest.json] [--shipped] [--license-id ID] [--dry-run]
```

Per layer:
- **soft focus baked offline:** a Gaussian `blur` (px at output size) in **premultiplied alpha**, so transparent edges keep the layer's colour instead of a dark fringe. Never a runtime blur filter.
- **downscale:** Lanczos, long side ≤ `maxSize` (default 2560).
- **WebP q88:** opaque plates drop alpha.
- **gates:**
  - the source exists;
  - the long side is ≥ 1600 px;
  - the role is `plate` or `light`;
  - the back plate (depth 0) is fully opaque (otherwise parallax shows holes).
- **provenance:** rows with stage `backgrounds` and the licence inherited from each layer's `parentId`, so Higgsfield-derived plates stay unshippable until the clearance is filed.
- **output:** `public/assets/<game>/bg/<look>_<id>_<orient>.webp`, plus `build/qa/bg/<game>_<look>_<orient>/{qa.json,manifest.json}` and the `src` lines for `src/games/<game>/environment.ts`.

The spec format is in the script's docstring. Every gate (source, role, licence, size, holed back plate) runs on every layer before anything is written: one failed layer means no plate, no provenance row and no snippet for the whole spec. Provenance rows carry `route: "code"` (a local derivative, not a vendor call). Exit codes: 0 ok · 1 a gate failed · 2 usage.
