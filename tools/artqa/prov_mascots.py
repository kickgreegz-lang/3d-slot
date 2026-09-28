#!/usr/bin/env python3
"""Provenance rows for the 2D mascot sources (art/source/mascots/**), which the mascot build does not write
(mastercut.py / gen.py / pack.py ran without --manifest). Appends through the shared locked writer
tools/gen/provenance.py; ids end in the file's sha256[:8], so a rerun on unchanged files adds nothing.

    tools/.venv/bin/python tools/artqa/prov_mascots.py [--dry-run]

Parents (from each mascot's spine2d/cut.yaml):
  rig_master.png, every part image      -> the rig-master raw row (Gumbo bd_c08 c2 v02 mirrored, Croak bd_c09 c1 v01)
  parts whose cut entry has source.sheet -> + that sheet's raw row (face / hands / props)
  atlas pages, .atlas, skeleton .json    -> every part row of that mascot
  croak/sheets/design_sheet.webp         -> mascot_croak_sheet.raw.v01 (bd_c08, 63e2a0a8)
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import yaml

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "tools/gen"))
import provenance as P  # noqa: E402

SCRIPT = "art/source/mascots/pipeline/build.sh"


def raw_row(rows, path):
    hit = [r for r in rows if r["path"] == path and r.get("route") == "higgsfield-mcp"]
    if not hit:
        raise SystemExit(f"prov_mascots: no generation row for {path}")
    return hit[-1]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    doc = P.read_manifest(P.MANIFEST)
    rows = doc["rows"]
    have_paths = {(r["path"], r.get("sha256")) for r in rows}
    out = []

    def add(path: Path, stage: str, parents: list[dict], notes: str):
        relp = path.relative_to(REPO).as_posix()
        sha = P.sha256_file(path)
        if (relp, sha) in have_paths:
            return None
        rid = P.safe_id(f"{relp.replace('art/source/mascots/', 'mascot.').replace('/', '.').rsplit('.', 1)[0]}.{sha[:8]}")
        row = P.make_row(id=rid, path=relp, stage=stage, sha256=sha, vendor="self", model=SCRIPT, version="phase-c",
                         license_id="higgsfield", route="code", ref_hashes=[p["sha256"] for p in parents if p.get("sha256")],
                         parents=[p["id"] for p in parents], notes=notes)
        out.append(row)
        return row

    for mid in ("gumbo", "croak"):
        base = REPO / "art/source/mascots" / mid
        cut = yaml.safe_load((base / "spine2d/cut.yaml").read_text())
        master = raw_row(rows, cut["master"]["image"])
        sheets = {k: raw_row(rows, v["image"]) for k, v in (cut.get("sheets") or {}).items()}
        src = {}
        for part in cut.get("parts", []):
            s = (part.get("source") or {}).get("sheet")
            if s:
                key = part["slot"] + (f"/{part['attachment']}" if part.get("attachment") else "")
                src[key] = sheets[s]
        mirror = " (mirrored)" if cut["master"].get("mirror") else ""
        rm = add(base / "spine2d/rig_master.png", "matting", [master],
                 f"chr_{mid} rig master{mirror}, measured-key matte + despill, downsampled to the size policy; "
                 f"approved job {master.get('jobId')} (art/plan/approvals.json chr_{mid}_rig_master)")
        part_rows = []
        img_root = base / "spine2d/images" / f"chr_{mid}"
        for img in sorted(img_root.rglob("*.png")):
            key = img.relative_to(img_root).as_posix()[:-4]
            pars = [master] + ([src[key]] if key in src else [])
            r = add(img, "layer-split", pars,
                    f"chr_{mid} part {key}: master cut (mastercut.py, {mid}/spine2d/cut.yaml)"
                    + (f"; warped from sheet job {src[key].get('jobId')}" if key in src else "; pixels from the rig master, hidden areas filled"))
            if r is None:  # already recorded: reuse the existing row as a parent
                sha = P.sha256_file(img)
                r = next(x for x in rows if x["path"] == img.relative_to(REPO).as_posix() and x.get("sha256") == sha)
            part_rows.append(r)
        for f in sorted((base / "spine").glob("*")):
            if f.suffix in (".png", ".atlas", ".json"):
                add(f, "spine-export", part_rows,
                    f"chr_{mid} runtime set (tools/spine/gen.py + pack.py via {SCRIPT} --publish); parents = the part images")
    croak_sheet = raw_row(rows, "art/_raw/mascot_croak_sheet/v01/raw.png")
    add(REPO / "art/source/mascots/croak/sheets/design_sheet.webp", "mascot-sheets", [croak_sheet],
        "approved mascot_croak_sheet (bd_c08, formula D), downsampled to 2560 wide WebP; identity reference only")
    print(f"prov_mascots: {len(out)} new rows")
    if a.dry_run:
        for r in out[:5]:
            print(" ", r["id"], r["path"], r["parents"][:3])
        return 0
    n = P.append_rows(P.MANIFEST, out, generated_by="tools/artqa")
    print(f"prov_mascots: appended {n}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
