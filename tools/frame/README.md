# tools/frame: formula-D reel frame pieces, 0 credits

`build_frame.py` paints the three pieces the Frame module already accepts as production art (env keys
`frame_beam`, `frame_post`, `frame_sill`; `src/games/swamp-funk/scene/Frame.ts` → `prodPart`, a 3-slice
NineSliceSprite with 20 % fixed ends): warm stained cypress with painterly grain, key light upper left, a thin cool
rim, a clean near-black outline, thin dark seam lines and polished gold bolts (brass straps on the posts). It is the
stand-in for the unfunded `frame_*` rows (c12/c13): the phase-B flat-cel code frame broke the cohesion of the
formula-D set on the in-game contact sheet.

```bash
tools/.venv/bin/python tools/frame/build_frame.py [--out DIR] [--provenance]
```

Output and slicing contract: `art/source/ui/bass-drop/frame/{frame_beam,frame_post,frame_sill}.png` + `frame.json`
(@2x of the landscape design rects, so landscape draws unstretched). Deterministic (seeded noise).
