#!/usr/bin/env python3
"""Ship MONTY's 2D Spine rig into the Magpie Heist runtime (adapted from tools/artqa/ship_mascots.py).

    tools/.venv/bin/python tools/mhart/mascot/ship_monty.py [--check] [--no-provenance]

Inputs: the published runtime set (tools/mhart/mascot/build.sh --publish; a rebuild is byte-identical):
  art/source/magpie-heist/mascot/spine/chr_monty.json              skeleton (4.3 JSON)
  art/source/magpie-heist/mascot/spine/chr_monty.{atlas,png}       full texel density (authored at 2x landscape)
  art/source/magpie-heist/mascot/spine/chr_monty@0.5x.{atlas,png}  half density (same skeleton)
Outputs (the runtime loads './assets/magpie-heist/mascot/...', src/games/magpie-heist/mascots/assets.ts):
  public/assets/magpie-heist/mascot/chr_monty.json                 the editor-only `skeleton.images` / `audio` dropped
  public/assets/magpie-heist/mascot/chr_monty.{atlas,webp}         full density
  public/assets/magpie-heist/mascot/chr_monty_half.{atlas,webp}    half density (phones, low tier)
      PMA pages as LOSSLESS WebP (premultiplied texels survive exactly); atlas page lines renamed
Every written file gets a provenance row in art/manifest.json through tools/gen/provenance.py (locked append):
stage packaging, route code, shipped true, parents = the rows of the runtime-set files it is made from (found by
CURRENT sha256, written by tools/mhart/mascot/prov_monty.py), licence inherited (higgsfield: `pnpm licence:audit
--release` refuses these rows until the written Higgsfield clearance is filed). Deterministic: a re-run writes the
same bytes; ids end in the output sha256, so an unchanged re-run adds no rows. The static stand-in
monty_static.webp (the runtime's fallback) is shipped by tools/licence/ship/magpie_heist.json, not here.
"""
from __future__ import annotations

import argparse
import io
import json
import sys
from pathlib import Path

from PIL import Image

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / "tools/gen"))
import provenance as P  # noqa: E402

TOOL = "tools/mhart/mascot/ship_monty.py"
VERSION = "mh-mascot-1"
OUT = REPO / "public/assets/magpie-heist/mascot"
SRC = REPO / "art/source/magpie-heist/mascot/spine"
NAME = "chr_monty"
WEBP_PMA = dict(lossless=True, quality=100, method=6, exact=True)


def webp_bytes(img: Image.Image, **kw) -> bytes:
    b = io.BytesIO()
    img.save(b, "WEBP", **kw)
    return b.getvalue()


def parent_row(rows: list[dict], path: Path) -> dict:
    sha = P.sha256_file(path)
    hit = [r for r in rows if r.get("sha256") == sha and r.get("path") == P.rel(path)]
    if not hit:
        raise SystemExit(f"ship_monty: no art/manifest.json row for {P.rel(path)} (sha256 {sha[:12]}); "
                         "run tools/mhart/mascot/prov_monty.py first (build.sh --publish does)")
    return hit[-1]


def licence_of(parents: list[dict]) -> str:
    ids = [p.get("licenseId") for p in parents if p.get("licenseId")]
    return "higgsfield" if "higgsfield" in ids else (ids[0] if ids else "owned-code")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="write nothing; exit 1 when a shipped file would change or has no row")
    ap.add_argument("--no-provenance", action="store_true")
    a = ap.parse_args()
    rows = P.read_manifest(P.MANIFEST)["rows"]
    files: list[tuple[Path, bytes, list[dict], str]] = []
    gpu = 0
    skel_src = SRC / f"{NAME}.json"
    skel = json.loads(skel_src.read_text(encoding="utf-8"))
    for k in ("images", "audio"):
        skel.get("skeleton", {}).pop(k, None)
    skel_bytes = (json.dumps(skel, separators=(",", ":"), ensure_ascii=False) + "\n").encode("utf-8")
    files.append((OUT / f"{NAME}.json", skel_bytes, [parent_row(rows, skel_src)], f"{NAME} rig: skeleton JSON (4.3, compact)"))
    for variant, src_name, out_name in (("full", NAME, NAME), ("half", f"{NAME}@0.5x", f"{NAME}_half")):
        atlas_path, page_path = SRC / f"{src_name}.atlas", SRC / f"{src_name}.png"
        atlas = atlas_path.read_text(encoding="utf-8")
        first = atlas.splitlines()[0].strip()
        if first != f"{src_name}.png" or atlas.count(".png") != 1:
            raise SystemExit(f"ship_monty: {src_name}.atlas must have exactly one page named {src_name}.png (got {first!r})")
        if "pma: true" not in atlas:
            raise SystemExit(f"ship_monty: {src_name}.atlas is not PMA")
        page = Image.open(page_path)
        if max(page.size) > 2048:
            raise SystemExit(f"ship_monty: {src_name}.png page {page.size} exceeds 2048")
        gpu += page.size[0] * page.size[1] * 4
        parents = [parent_row(rows, atlas_path), parent_row(rows, page_path)]
        note = f"{NAME} rig, {variant} texel density (PMA, page {page.size[0]}x{page.size[1]})"
        files.append((OUT / f"{out_name}.webp", webp_bytes(page.convert("RGBA"), **WEBP_PMA), parents, note + ": atlas page, lossless WebP"))
        files.append((OUT / f"{out_name}.atlas", atlas.replace(f"{src_name}.png", f"{out_name}.webp", 1).encode("utf-8"),
                      parents, note + ": atlas"))

    changed = [f for f, data, _, _ in files if not f.exists() or f.read_bytes() != data]
    known = {f"{r.get('path')}|{r.get('sha256', '')}" for r in rows}
    if a.check:
        for f in changed:
            print(f"ship_monty: DRIFT {P.rel(f)}")
        norow = [f for f, data, _, _ in files if f"{P.rel(f)}|{P.sha256_bytes(data)}" not in known]
        for f in norow:
            print(f"ship_monty: NO ROW {P.rel(f)}")
        stale = sorted(p for p in OUT.glob(f"{NAME}*") if p.is_file() and p not in {f for f, *_ in files})
        for f in stale:
            print(f"ship_monty: STRAY {P.rel(f)} (not written by this tool)")
        print(f"ship_monty --check: {len(files)} files, {len(changed)} drift, {len(norow)} without a row, {len(stale)} stray")
        return 1 if changed or norow or stale else 0
    out_rows = []
    total = 0
    for f, data, parents, note in files:
        f.parent.mkdir(parents=True, exist_ok=True)
        if f in changed:
            tmp = f.with_name(f".{f.name}.tmp")
            tmp.write_bytes(data)
            tmp.replace(f)
        total += len(data)
        sha = P.sha256_bytes(data)
        out_rows.append(P.make_row(
            id=P.safe_id(f"mh_ship_monty.{f.stem}.{f.suffix.lstrip('.')}.{sha[:8]}"), path=f,
            stage="packaging", sha256=sha, vendor="self", model=TOOL, version=VERSION,
            license_id=licence_of(parents), route="code", ref_hashes=sorted({p["sha256"] for p in parents}),
            parents=sorted({p["id"] for p in parents}), shipped=True, notes=note))
    added = 0 if a.no_provenance else P.append_rows(P.MANIFEST, out_rows, generated_by="tools/mhart")
    print(f"ship_monty: {len(files)} files ({len(changed)} written, {total / 1024:.0f} KiB on disk; "
          f"GPU pages full+half {gpu / 1048576:.2f} MiB, one density resident), {added} provenance row(s) added")
    return 0


if __name__ == "__main__":
    sys.exit(main())
