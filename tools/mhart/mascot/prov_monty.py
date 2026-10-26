#!/usr/bin/env python3
"""Provenance rows for MONTY's 2D rig sources (art/source/magpie-heist/mascot/spine2d/images/** and the published
runtime set art/source/magpie-heist/mascot/spine/*), which the build writes without --manifest. Appends through the
shared locked writer tools/gen/provenance.py; ids end in the file's sha256[:8], so a rerun on unchanged files adds
nothing (run by tools/mhart/mascot/build.sh --publish).

    tools/.venv/bin/python tools/mhart/mascot/prov_monty.py [--dry-run]

Parents:
  every part image (master cut, painted eye states, painted fist / point gloves)
        -> the CURRENT row of the approved master art/source/magpie-heist/mascot/monty_static.png
           (whose chain reaches the approved raw mh_mascot_monty_sheet.raw.v01)
  runtime set (skeleton .json, .atlas, page .png, @0.5x)  -> every part row
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / "tools/gen"))
import provenance as P  # noqa: E402

TOOL = "tools/mhart/mascot/build.sh"
VERSION = "mh-mascot-1"
BASE = REPO / "art/source/magpie-heist/mascot"
MASTER = BASE / "monty_static.png"


def current_row(rows: list[dict], path: Path) -> dict:
    relp = P.rel(path)
    sha = P.sha256_file(path)
    hit = [r for r in rows if r.get("path") == relp and r.get("sha256") == sha]
    if not hit:
        raise SystemExit(f"prov_monty: no art/manifest.json row for {relp} with its current sha256 {sha[:12]}")
    return hit[-1]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    rows = P.read_manifest(P.MANIFEST)["rows"]
    have = {(r["path"], r.get("sha256")): r for r in rows}
    master = current_row(rows, MASTER)
    lic = master.get("licenseId") or "higgsfield"
    out: list[dict] = []

    def add(path: Path, stage: str, parents: list[dict], notes: str) -> dict:
        relp = P.rel(path)
        sha = P.sha256_file(path)
        if (relp, sha) in have:
            return have[(relp, sha)]
        stem = relp.replace("art/source/magpie-heist/mascot/", "mh.mascot.").replace("/", ".").rsplit(".", 1)[0]
        row = P.make_row(id=P.safe_id(f"{stem}.{sha[:8]}"), path=relp, stage=stage, sha256=sha, vendor="self",
                         model=TOOL, version=VERSION, license_id=lic, route="code",
                         ref_hashes=sorted({p["sha256"] for p in parents if p.get("sha256")}),
                         parents=sorted({p["id"] for p in parents}), notes=notes)
        out.append(row)
        have[(relp, sha)] = row
        return row

    part_rows = []
    root = BASE / "spine2d/images/chr_monty"
    for img in sorted(root.rglob("*.png")):
        key = img.relative_to(root).as_posix()[:-4]
        if key.startswith("hand_") and key.split("/")[-1] in ("fist", "point"):
            note = (f"chr_monty part {key}: glove pose painted by tools/mhart/mascot/hands.py in the master's colours "
                    "under the master's own cuff pixels (no part sheets exist), placed by tools/mhart/mascot/cut.py")
            stage = "hidden-area-fill"
        elif key.startswith(("eye_", "pupil_")):
            note = (f"chr_monty part {key}: the master's own eye patch, lid state painted over it "
                    "(tools/mhart/mascot/cut.py, art/source/magpie-heist/mascot/spine2d/cut.yaml)")
            stage = "layer-split"
        else:
            note = (f"chr_monty part {key}: master cut (tools/mhart/mascot/cut.py -> mastercut.py, cut.yaml); "
                    "pixels from the approved master, hidden areas filled")
            stage = "layer-split"
        part_rows.append(add(img, stage, [master], note))
    spine_dir = BASE / "spine"
    for f in sorted(spine_dir.glob("*")):
        if f.suffix in (".png", ".atlas", ".json"):
            add(f, "spine-export", part_rows,
                f"chr_monty runtime set (tools/spine/gen.py + pack.py via {TOOL} --publish); parents = the part images")
    print(f"prov_monty: {len(out)} new row(s) (master row {master['id']})")
    if a.dry_run:
        for r in out[:6]:
            print(" ", r["id"], r["path"])
        return 0
    n = P.append_rows(P.MANIFEST, out, generated_by="tools/mhart")
    print(f"prov_monty: appended {n}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
