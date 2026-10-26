#!/usr/bin/env python3
"""Spine parts for the owned-code vector stand-ins (H2 Jeweled Egg, H3 Pocket Watch, H4 Ruby Chalice, H5 Key Ring,
S Safe). Nothing is cut or inpainted: tools/mhart/vector/standins.mjs draws every part as its own vector layer (each
with its own outline, hidden areas drawn whole) and the master is those layers stacked, so the rest pose reassembles
exactly. This script renders the layers (1024 px, one per part, + <ID>.parts.json with the pivots in master px),
checks them against art/source/magpie-heist/symbols/<ID>/master_1024.png (`build_art.py standins` writes it), puts
them on the 360 @2x canvas through mhcut.Rig, and adds the fx sprites every Magpie Heist high has:

  glow        additive halo (fx_glow, alpha 0 at rest)
  <hero>_lit  the hero part lightened: the win_peak flash (normal blend, alpha 0 at rest, on the hero's bone)
  sheen_1..6  a light band sweeping the hero part (attachment frames on the hero's bone)
  glint       a star glint (additive, fx_glint)

    tools/.venv/bin/python tools/mhart/rigs/cut_vector.py <ID>        (cut_<ID>.py wraps this for build.sh --cut)

Bones: every part is on a bone named like the part (rig.yaml wires them); `joint` = the part's pivot (canvas units).
Licence: owned-code (`$src: code` on every part: ship_rig.py records owned-code rows).
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import numpy as np

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
import mhcut as mc  # noqa: E402

cl = mc.cl
VEC = mc.REPO / "art/_work/magpie-heist/vector"

# per symbol: the hero part (sheen + flash), the glint position (master px), the halo colour
FX = {
    "H2": {"hero": "shell", "lit": "shell", "glint": (512, 108), "glow": (0.45, 0.62, 1.0)},
    "H3": {"hero": "case", "lit": "case", "glint": (352, 346), "glow": (1.0, 0.82, 0.36)},
    "H4": {"hero": "bowl", "lit": "bowl", "glint": (250, 266), "glow": (1.0, 0.36, 0.42)},
    "H5": {"hero": "key_gold", "lit": "key_gold", "glint": (462, 380), "glow": (1.0, 0.8, 0.34)},
    "S": {"hero": "body", "lit": "dial", "glint": (236, 220), "glow": (1.0, 0.34, 0.4)},
}


def render(sid: str) -> dict:
    r = subprocess.run(["node", "tools/mhart/vector/standins.mjs", "--out", str(VEC), sid], cwd=mc.REPO,
                       capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit(f"cut_vector: render failed\n{r.stdout}{r.stderr}")
    meta = json.loads((VEC / f"{sid}.parts.json").read_text())
    master = mc.SYMBOLS_ROOT / sid / "master_1024.png"
    if (VEC / f"{sid}.png").read_bytes() != master.read_bytes():
        raise SystemExit(f"cut_vector: {master.relative_to(mc.REPO)} is not the current vector render: run "
                         "`tools/.venv/bin/python tools/mhart/build_art.py standins` first")
    return meta


def main(sid: str) -> int:
    if sid not in FX:
        raise SystemExit(f"cut_vector: {sid} is not a vector stand-in ({', '.join(FX)})")
    meta = render(sid)
    fx = FX[sid]
    R = mc.Rig(sid)
    gc = R.pt(512, 512)
    R.add_sprite("glow", mc.radial_glow(330, fx["glow"], alpha=0.85), gc, scale=2, slot="fx_glow", z=0, bone="fx_glow",
                 blend="additive", color="ffffff00")
    rest: list[str] = []
    kp: dict[str, tuple[float, float]] = {}
    z = 1
    for p in meta["parts"]:
        name = p["name"]
        lay = cl.load(VEC / sid / f"{name}.png")
        kw = {"z": z, "bone": name, "$src": "code"}
        if p.get("joint"):
            kw["joint"] = R.ptr(*p["joint"])
            kp[name] = tuple(p["joint"])
        R.add(name, lay, despeckle=0, **kw)
        rest.append(name)
        z += 1
        if name == fx["lit"]:
            R.add(f"{name}_lit", mc.lighten(lay, 0.45, white_core=0.08), despeckle=0, z=z, bone=name, slot="fx_lit",
                  color="ffffff00", **{"$src": "code"})
            z += 1
        if name == fx["hero"]:
            base = R.canv[name]
            for i, fr in enumerate(mc.sheen_frames(base, 6, angle=66, width=8.0, strength=0.75, travel=(-0.12, 1.12)), 1):
                R.add_canvas(f"sheen_{i}", fr, pad=2, z=z, bone=name, slot="fx_sheen", **({"hidden": True} if i == 1 else {}),
                             **{"$src": "code"})
            z += 1
    R.add_sprite("glint", mc.star_glint(72), R.pt(*fx["glint"]), slot="fx_glint", z=z, bone="fx_glint", blend="additive",
                 color="ffffff00")
    blur = [n for n in rest if n != "sparkle"]
    comment = (f"sym_{sid} parts: owned-code vector layers from tools/mhart/vector/standins.mjs (one layer per part, each "
               f"with its own outline; the master is the layers stacked); fx sprites (glow, {fx['lit']}_lit, sheen_1..6, "
               f"glint) drawn by tools/mhart/rigs/cut_vector.py. Canvas 360 @2x, content = cellScale {R.cell_scale} x 300.")
    previews = {f"{n}_alone": [n] for n in rest}
    previews["flash"] = rest + [f"{fx['lit']}_lit"]
    previews["sheen_3"] = rest + ["sheen_3"]
    R.finish(comment, rest=rest, blur=blur, keypoints=kp, previews=previews)
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    sys.exit(main(sys.argv[1]))
