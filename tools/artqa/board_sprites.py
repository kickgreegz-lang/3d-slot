#!/usr/bin/env python3
"""Board sprites for Bass Drop (ART_PLAN open decision 1, decided in the phase-C review): the static symbol texture
is the Spine rig's SETUP POSE rendered on the 360 x 360 @2x canvas (root at the centre, 1 unit = 1 px), so the
runtime's static -> Spine swap (SymbolRig.placeSpine: scale tex.width / 360, content centre aligned) cannot pop.
Royals (no rig yet) are the formula-D royal masters canvas-fitted at cellScale x 300 px.

    tools/.venv/bin/python tools/artqa/board_sprites.py [--rest build/qa/artqa/rest] [--out "build/pack/symbols{tps}"]

Needs the setup renders from tools/artqa/render_rest.mjs (sym_<id>.png). Writes sym_<id>.png and, through
tools/matte/variants.py (GAME=bass-drop restAngle), sym_<id>_blur.png / sym_<id>_glow.png. Build output only
(gitignored): the runtime integration step copies them to public/assets once the Higgsfield clearance is filed.
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image

REPO = Path(__file__).resolve().parents[2]
CELL_SCALE = {"L1": 0.86, "L2": 0.86, "L3": 0.86, "L4": 0.86, "L5": 0.86}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--rest", default=str(REPO / "build/qa/artqa/rest"))
    ap.add_argument("--out", default=str(REPO / "build/pack/symbols{tps}"))
    ap.add_argument("--provenance", action="store_true", help="append art/manifest.json rows (static + variants)")
    a = ap.parse_args()
    sys.path.insert(0, str(REPO / "tools/gen"))
    import provenance as P
    rows = P.read_manifest(P.MANIFEST)["rows"]

    def source_row(rel: str) -> dict:
        sha = P.sha256_file(REPO / rel)
        hit = [r for r in rows if r["path"] == rel and r.get("sha256") == sha]
        if not hit:
            raise SystemExit(f"board_sprites: no manifest row for {rel} (current sha256)")
        return hit[-1]
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    env = {**os.environ, "GAME": "bass-drop"}
    for sid in ("H1", "H2", "H3", "H4", "W", "L1", "L2", "L3", "L4", "L5"):
        dst = out / f"sym_{sid}.png"
        if sid.startswith("L"):
            m = Image.open(REPO / f"art/source/symbols/{sid}/master_1024.png").convert("RGBA")
            al = np.array(m)[..., 3]
            ys, xs = np.nonzero(al > 8)
            c = m.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))
            k = CELL_SCALE[sid] * 300 / max(c.size)
            c = c.resize((round(c.width * k), round(c.height * k)), Image.LANCZOS)
            canvas = Image.new("RGBA", (360, 360), (0, 0, 0, 0))
            canvas.alpha_composite(c, ((360 - c.width) // 2, (360 - c.height) // 2))
            canvas.save(dst)
        else:
            Image.open(Path(a.rest) / f"sym_{sid}.png").convert("RGBA").save(dst)
        extra = []
        if a.provenance:
            src_rel = f"art/source/symbols/{sid}/master_1024.png" if sid.startswith("L") else f"art/source/symbols/{sid}/master_rig_1024.png"
            par = source_row(src_rel)
            sha = P.sha256_file(dst)
            row = P.make_row(
                id=P.safe_id(f"sym_{sid.lower()}.board.{sha[:8]}"), path=dst, stage="packaging", sha256=sha, vendor="self",
                model="tools/artqa/board_sprites.py", version="phase-c", license_id=par.get("licenseId") or "higgsfield",
                route="code", ref_hashes=[par["sha256"]], parents=[par["id"]],
                notes=(f"board sprite {sid}: " + ("formula-D royal canvas-fitted at cellScale 0.86" if sid.startswith("L") else
                       "the Spine rig's setup pose rendered on the 360 @2x canvas (tools/artqa/render_rest.mjs), so the "
                       "static -> Spine swap cannot pop (ART_PLAN open decision 1); supersedes the beauty-matte board sprite")))
            P.append_rows(P.MANIFEST, [row], generated_by="tools/artqa")
            extra = ["--manifest", "art/manifest.json", "--parent-id", row["id"]]
        subprocess.run([sys.executable, str(REPO / "tools/matte/variants.py"), str(dst), "--symbol", sid,
                        "--qa-dir", str(REPO / f"build/qa/artqa/variants/{sid}")] + extra, check=True, env=env, cwd=REPO,
                       stdout=subprocess.DEVNULL)
        print(f"board_sprites: {dst.relative_to(REPO)} (+ _blur, _glow)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
