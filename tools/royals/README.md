# tools/royals: formula-D royals (L1–L5), 0 credits

`build_royals.py` paints A K Q J 10 from the game's own Lilita One (OFL, `public/assets/fonts`; the glyph masks
come from Chromium through `glyph_masks.mjs`, because PIL cannot read WOFF2) in the formula-D finish: single-weight
near-black outline (~3 % of the cell), rounded bevel lit from the upper left, warm bounce, thin cool rim, glossy
specular, low-frequency face noise, a slight forward lean; colours from `SYMBOLS[id].color`
(`src/games/bass-drop/config.ts`), dull hues lifted toward saturation, the darkest (A) lifted in value.

```bash
tools/.venv/bin/python tools/royals/build_royals.py [--only L1,L2] [--out DIR] [--provenance]
```

Writes `art/source/symbols/L<n>/master_1024.png` (straight alpha, content ≈ 0.80 of the canvas). Deterministic.
The light Spine rig of ANIMATION_SET 2.5 is not built yet; until then the runtime animates the static sprite.
