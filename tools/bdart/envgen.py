#!/usr/bin/env python3
"""Env rig generator: tools/spine/examples/bass_drop/bdgen.py (unmodified, imported) plus two additions this track
needs and bdgen does not carry yet:

1. the CR-8 `env` kind budgets (tools/spine/contract.json kinds.env = ANIMATION_SET 10: 24 bones / 16 slots /
   200 mesh vertices / 3 physics), which bdgen's own table (wild / ui / high) does not list;
2. `radial_weights.<mesh>.polar: {radii: [...], spokes: n}` in bassdrop.yaml: the mesh is rebuilt as concentric rings
   round `centre` before the radial reweighting, so a bulge maps circles to circles (a grid mesh warps a round dust
   cap into a polygon at a 1.18 punch). The outermost ring is the hull; keep it outside the visible pixels
   (inradius = r cos(180/spokes)).

    tools/.venv/bin/python tools/bdart/envgen.py art/source/env/speaker_stack/rig.yaml -o build/spine/bd/env_speaker_stack.json
"""
import json
import math
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "tools/spine/examples/bass_drop"))
import bdgen  # noqa: E402

env = json.loads((REPO / "tools/spine/contract.json").read_text())["kinds"]["env"]["budgets"]
bdgen.KIND_BUDGETS.setdefault("env", {k: env[k] for k in ("bones", "slots", "meshVertices", "physics")})

_orig_radial = bdgen.BassDropBuilder._radial_weights


def _radial_weights(self, doc, att, spec):
    spec = dict(spec)
    polar = spec.pop("polar", None)
    if polar:
        part = self.part_by_name.get(att)
        if part is None:
            raise bdgen.RigError(f"radial_weights.{att}: no such part")
        radii = sorted((float(r) for r in polar["radii"]), reverse=True)     # outermost first = the hull
        n = int(polar["spokes"])
        cx, cy = spec["centre"]
        x0, y0, w, h = part.bbox
        uvs = []
        for r in radii:
            for k in range(n):
                a = 2 * math.pi * k / n
                uvs += [round((cx + r * math.cos(a) - x0) / w, 5), round((cy + r * math.sin(a) - y0) / h, 5)]
        uvs += [round((cx - x0) / w, 5), round((cy - y0) / h, 5)]
        if min(uvs) < 0 or max(uvs) > 1:
            raise bdgen.RigError(f"radial_weights.{att}.polar: the outer ring leaves the image (pad the part)")
        tris = []
        for i in range(len(radii) - 1):
            o, q = i * n, (i + 1) * n
            for k in range(n):
                k1 = (k + 1) % n
                tris += [o + k, o + k1, q + k, o + k1, q + k1, q + k]
        c = len(radii) * n
        q = (len(radii) - 1) * n
        for k in range(n):
            tris += [q + k, q + (k + 1) % n, c]
        for skin in doc["skins"]:
            for ent in skin["attachments"].values():
                m = ent.get(att)
                if m and m.get("type") == "mesh":
                    m["uvs"], m["triangles"], m["hull"] = uvs, tris, n
                    m.pop("edges", None)
    _orig_radial(self, doc, att, spec)


bdgen.BassDropBuilder._radial_weights = _radial_weights

if __name__ == "__main__":
    sys.exit(bdgen.main())
