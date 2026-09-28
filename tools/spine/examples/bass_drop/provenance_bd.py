#!/usr/bin/env python3
"""Provenance rows (art/manifest.json, append-only, content-addressed) for the Bass Drop rig part images:
art/source/spine/images/{sym_W, sym_H1..H4, ui_groove_meter}/*.png, written by cut/cut_<ID>.py (+ make_blur.py).

Each row: stage `layer-split`, model = the cut script, version = its sha256[:12], parents = the approved master /
sheet / piece rows it was cut from (or the base part for a `_blur` variant), licenceId `higgsfield` for anything
derived from Higgsfield art and `owned-code` for the procedurally drawn fx sprites.

    tools/.venv/bin/python tools/spine/examples/bass_drop/provenance_bd.py [--manifest art/manifest.json] [--dry-run]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
sys.path.insert(0, str(REPO / "tools/spine"))
sys.dont_write_bytecode = True
from spinegen import provenance as prov  # noqa: E402

IMAGES = REPO / "art/source/spine/images"
PROC = {"glow", "ring", "trail_streak", "glint", "glow_ring", "swirl", "cap_flash", "burst_star"}   # drawn in code


def sha12(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()[:12]


def row_for(path: str, rows: list[dict]) -> str:
    ids = [r["id"] for r in rows if r.get("path") == path]
    if not ids:
        raise SystemExit(f"provenance_bd: no manifest row for {path}")
    return ids[-1]


def sources(rig: str, part: str, rows: list[dict]) -> tuple[list[str], list[Path], str]:
    """-> (parent row ids, input files, note) for one part image."""
    S = lambda p: (row_for(p, rows), REPO / p)
    if rig == "sym_W":
        m = S("art/source/symbols/W/master_rig_1024.png")
        if part == "ribbon":
            p = S("art/source/symbols/W/pieces/ribbon.png")
            return [p[0]], [p[1]], "the approved sym_W_pieces ribbon, rescaled to 206 units"
        if part.startswith("badge_t"):
            p = S(f"art/source/symbols/W/pieces/{part}.png")
            return [p[0]], [p[1]], f"the approved sym_W_pieces {part}, rescaled to the 192-unit plate"
        if part.startswith("clamp_"):
            src = "clamp_open" if "open" in part else "clamp"
            p = S(f"art/source/symbols/W/pieces/{src}.png")
            side = "mirrored for the right side" if part.endswith("_R") else "left side"
            return [p[0]], [p[1]], f"the approved sym_W_pieces {src}, rotated to face the tooth, {side}"
        return [m[0]], [m[1]], "master-cut (tooth socket under the cap inpainted; tooth_cracked = + drawn cracks)"
    if rig == "sym_H1":
        if part == "antenna":
            p = S("art/_raw/sym_H1_parts/v01/raw.png")
            return [p[0]], [p[1]], "the c11 sheet's telescopic antenna (tools/split cut, key #03FC04), similarity-warped to the top-right corner"
        m = S("art/source/symbols/H1/master_rig_1024.png")
        return [m[0]], [m[1]], "master-cut; the body keeps a shadowed recess under each speaker and the dark tape well under the door"
    if rig == "sym_H2":
        m = S("art/source/symbols/H2/master_rig_1024.png")
        note = {"disc": "the whole record rebuilt from the master's radial profile",
                "label": "the label rebuilt from the master's radial profile + a printed arc on its hidden side",
                "fx_groove": "the master's reflections: minimal-alpha unblend over the rebuilt record",
                "sleeve": "master-cut + the lip's shadow (unblended)",
                "disc_cracked": "the rebuilt record with drawn cracks", "disc_shards": "the rebuilt record in 6 wedges"}
        return [m[0]], [m[1]], note.get(part, "master-cut")
    if rig == "sym_H3":
        m = S("art/source/symbols/H3/master_rig_1024.png")
        if part in ("eyes_half", "eyes_closed", "eyes_wide"):
            v = S(f"art/_raw/sym_H3_{part}/v01/raw.png")
            r = S("art/_raw/sym_H3_rig/v01/raw.png")
            return [v[0], r[0]], [v[1], r[1]], "c11 eye variant registered to the master raw (ECC affine), keyed on its measured olive key, eye region only"
        return [m[0]], [m[1]], "outline-bounded cut of the master; hidden areas filled (belly under claw_L mirrored + inpainted, arm / fan continued)"
    if rig == "sym_H4":
        if part == "flame":
            p = S("art/_raw/sym_H4_parts/v01/raw.png")
            return [p[0]], [p[1]], "the c11 sheet's flame wisp, keyed on its measured green (#03FB04) and despilled"
        m = S("art/source/symbols/H4/master_rig_1024.png")
        return [m[0]], [m[1]], "master-cut; the bottle has the rim back / neck opening synthesized under the cork and the sauce inpainted under the label"
    if rig == "ui_groove_meter":
        if part.startswith("notch_"):
            icon = {"w": "notch_w", "jj": "notch_jj", "mm": "notch_mm"}[part.split("_")[1].rstrip("123")]
            p = S(f"art/source/ui/bass-drop/emblems/notch/{icon}.png")
            return [p[0]], [p[1]], "badge plate drawn in code around the approved notch icon (state / pips drawn)"
        m = S("art/_work/c0107/bd_meter_master/matte_full.png")
        return [m[0]], [m[1]], "radially remapped onto DESIGN 6.1's bands (woofer) / affinely onto 704 x 840 units (cabinet)"
    raise SystemExit(f"unknown rig {rig}")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--manifest", default=str(REPO / "art/manifest.json"))
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args(argv)
    doc = json.loads(Path(a.manifest).read_text(encoding="utf-8"))
    rows = doc["rows"]
    cut = {"sym_W": "cut_W.py", "sym_H1": "cut_H1.py", "sym_H2": "cut_H2.py", "sym_H3": "cut_H3.py", "sym_H4": "cut_H4.py",
           "ui_groove_meter": "cut_meter.py"}
    new: list[dict] = []
    for rig, script in cut.items():
        sp = HERE / "cut" / script
        ver = sha12(sp)
        made: dict[str, str] = {}
        files = sorted((IMAGES / rig).glob("*.png"), key=lambda p: (p.stem.endswith("_blur"), p.stem))
        for f in files:
            name = f.stem
            if name.endswith("_blur"):
                base = name[: -len("_blur")]
                if base not in made:
                    raise SystemExit(f"provenance_bd: blur without its base part: {f}")
                r = prov.make_row(asset_id=f"{rig}_{name}.blur", path=f, stage="layer-split",
                                  model="tools/spine/make_blur.py", version="vblur-14", inputs=[IMAGES / rig / f"{base}.png"],
                                  parents=[made[base]], license_id="higgsfield",
                                  notes=f"spin-blur variant of {rig}/{base} (tools/spine/make_blur.py, vertical box blur)")
            elif name in PROC:
                r = prov.make_row(asset_id=f"{rig}_{name}.fx", path=f, stage="layer-split",
                                  model=f"tools/spine/examples/bass_drop/cut/{script}", version=ver, license_id="owned-code",
                                  notes=f"{rig} fx sprite drawn in code ({script})")
            else:
                parents, inputs, note = sources(rig, name, rows)
                r = prov.make_row(asset_id=f"{rig}_{name}.cut", path=f, stage="layer-split",
                                  model=f"tools/spine/examples/bass_drop/cut/{script}", version=ver, inputs=inputs,
                                  parents=parents, license_id="higgsfield", notes=f"{rig} part '{name}': {note}")
            made[name] = r["id"]
            new.append(r)
    have = {r["id"] for r in rows}
    fresh = [r for r in new if r["id"] not in have]
    print(f"provenance_bd: {len(new)} part images, {len(fresh)} new rows")
    if not a.dry_run and fresh:
        n = prov.append_rows(a.manifest, fresh, "tools/spine/examples/bass_drop/provenance_bd.py")
        print(f"provenance_bd: appended {n} rows -> {prov.rel(a.manifest)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
