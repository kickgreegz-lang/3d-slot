#!/usr/bin/env python3
"""Ship the Bass Drop 2D mascot rigs into the runtime (ART_STATUS 7.4, the 2D Spine mascots + layout track).

    tools/.venv/bin/python tools/artqa/ship_mascots.py [--check] [--no-provenance]

Inputs: the published runtime sets (art/source/mascots/pipeline/build.sh <id> --publish; a rebuild is byte-identical):
  art/source/mascots/<id>/spine/chr_<id>.json                 skeleton (4.3 JSON)
  art/source/mascots/<id>/spine/chr_<id>.{atlas,png}          full texel density (authored at 2x landscape)
  art/source/mascots/<id>/spine/chr_<id>@0.5x.{atlas,png}     half density (same skeleton)
Outputs (shipped; the runtime loads relative urls './assets/bass-drop/mascots/...', src/games/bass-drop/mascots/assets.ts):
  public/assets/bass-drop/mascots/chr_<id>.json               the editor-only `skeleton.images` / `skeleton.audio` paths dropped
  public/assets/bass-drop/mascots/chr_<id>.{atlas,webp}       full density
  public/assets/bass-drop/mascots/chr_<id>_half.{atlas,webp}  half density (phones, low tier)
      PMA pages as LOSSLESS WebP (premultiplied texels survive exactly); atlas page lines renamed
Every written file gets a provenance row in art/manifest.json through tools/gen/provenance.py (locked append):
stage packaging, route code, shipped true, parents = the rows of the runtime-set files it is made from (found by
CURRENT sha256), licence inherited (higgsfield: `pnpm licence:audit --release` refuses these rows until the written
Higgsfield clearance is filed). Deterministic: a re-run writes the same bytes; ids end in the output sha256, so an
unchanged re-run adds no rows.
"""
from __future__ import annotations

import argparse
import io
import json
import sys
from pathlib import Path

from PIL import Image

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "tools/gen"))
import provenance as P  # noqa: E402

TOOL = "tools/artqa/ship_mascots.py"
VERSION = "phase-d"
OUT = REPO / "public/assets/bass-drop/mascots"
SRC = REPO / "art/source/mascots"
IDS = ("gumbo", "croak")
WEBP_PMA = dict(lossless=True, quality=100, method=6, exact=True)


def webp_bytes(img: Image.Image, **kw) -> bytes:
    b = io.BytesIO()
    img.save(b, "WEBP", **kw)
    return b.getvalue()


def rows_by_sha(rows: list[dict]) -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = {}
    for r in rows:
        out.setdefault(r.get("sha256", ""), []).append(r)
    return out


def parent_row(by_sha: dict[str, list[dict]], path: Path) -> dict:
    sha = P.sha256_file(path)
    hit = [r for r in by_sha.get(sha, []) if r["path"] == P.rel(path)]
    if not hit:
        raise SystemExit(f"ship_mascots: no art/manifest.json row for {P.rel(path)} (sha256 {sha[:12]}); "
                         "write its provenance with the tool that produced it first (tools/artqa/prov_mascots.py)")
    return hit[-1]


def licence_of(parents: list[dict]) -> str:
    ids = [p.get("licenseId") for p in parents if p.get("licenseId")]
    return "higgsfield" if "higgsfield" in ids else (ids[0] if ids else "owned-code")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="write nothing; exit 1 when a shipped file would change or has no row")
    ap.add_argument("--no-provenance", action="store_true")
    a = ap.parse_args()
    by_sha = rows_by_sha(P.read_manifest(P.MANIFEST)["rows"])
    files: list[tuple[Path, bytes, list[dict], str]] = []
    gpu = 0
    for mid in IDS:
        name = f"chr_{mid}"
        src = SRC / mid / "spine"
        skel_src = src / f"{name}.json"
        skel = json.loads(skel_src.read_text(encoding="utf-8"))
        for k in ("images", "audio"):
            skel.get("skeleton", {}).pop(k, None)
        skel_bytes = (json.dumps(skel, separators=(",", ":"), ensure_ascii=False) + "\n").encode("utf-8")
        files.append((OUT / f"{name}.json", skel_bytes, [parent_row(by_sha, skel_src)], f"{name} rig: skeleton JSON (4.3, compact)"))
        for variant, src_name, out_name in (("full", name, name), ("half", f"{name}@0.5x", f"{name}_half")):
            atlas_path, page_path = src / f"{src_name}.atlas", src / f"{src_name}.png"
            atlas = atlas_path.read_text(encoding="utf-8")
            first = atlas.splitlines()[0].strip()
            if first != f"{src_name}.png" or atlas.count(".png") != 1:
                raise SystemExit(f"ship_mascots: {src_name}.atlas must have exactly one page named {src_name}.png (got {first!r})")
            if "pma: true" not in atlas:
                raise SystemExit(f"ship_mascots: {src_name}.atlas is not PMA")
            page = Image.open(page_path)
            if max(page.size) > 2048:
                raise SystemExit(f"ship_mascots: {src_name}.png page {page.size} exceeds 2048")
            gpu += page.size[0] * page.size[1] * 4
            parents = [parent_row(by_sha, atlas_path), parent_row(by_sha, page_path)]
            note = f"{name} rig, {variant} texel density (PMA, page {page.size[0]}x{page.size[1]})"
            files.append((OUT / f"{out_name}.webp", webp_bytes(page.convert("RGBA"), **WEBP_PMA), parents,
                          note + ": atlas page, lossless WebP"))
            files.append((OUT / f"{out_name}.atlas", atlas.replace(f"{src_name}.png", f"{out_name}.webp", 1).encode("utf-8"),
                          parents, note + ": atlas"))

    changed = [f for f, data, _, _ in files if not f.exists() or f.read_bytes() != data]
    known = {r.get("path") + "|" + r.get("sha256", "") for rs in by_sha.values() for r in rs}
    if a.check:
        for f in changed:
            print(f"ship_mascots: DRIFT {P.rel(f)}")
        norow = [f for f, data, _, _ in files if f"{P.rel(f)}|{P.sha256_bytes(data)}" not in known]
        for f in norow:
            print(f"ship_mascots: NO ROW {P.rel(f)}")
        stale = sorted(p for p in OUT.glob("*") if p.is_file() and p not in {f for f, *_ in files})
        for f in stale:
            print(f"ship_mascots: STRAY {P.rel(f)} (not written by this tool)")
        print(f"ship_mascots --check: {len(files)} files, {len(changed)} drift, {len(norow)} without a row, {len(stale)} stray")
        return 1 if changed or norow or stale else 0
    rows = []
    total = 0
    for f, data, parents, note in files:
        f.parent.mkdir(parents=True, exist_ok=True)
        if f in changed:
            tmp = f.with_name(f".{f.name}.tmp")
            tmp.write_bytes(data)
            tmp.replace(f)
        total += len(data)
        sha = P.sha256_bytes(data)
        rows.append(P.make_row(
            id=P.safe_id(f"bd_ship_mascots.{f.stem}.{f.suffix.lstrip('.')}.{sha[:8]}"), path=f,
            stage="packaging", sha256=sha, vendor="self", model=TOOL, version=VERSION,
            license_id=licence_of(parents), route="code", ref_hashes=sorted({p["sha256"] for p in parents}),
            parents=sorted({p["id"] for p in parents}), shipped=True, notes=note))
    added = 0 if a.no_provenance else P.append_rows(P.MANIFEST, rows, generated_by="tools/artqa")
    print(f"ship_mascots: {len(files)} files ({len(changed)} written, {total / 1024:.0f} KiB on disk; "
          f"GPU pages full+half {gpu / 1048576:.2f} MiB, one density resident per character), "
          f"{added} provenance row(s) added")
    return 0


if __name__ == "__main__":
    sys.exit(main())
