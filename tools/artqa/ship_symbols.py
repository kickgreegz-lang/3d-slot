#!/usr/bin/env python3
"""Ship the Bass Drop symbol art into the runtime (ART_STATUS section 7.1, the symbols integration track).

    tools/.venv/bin/python tools/artqa/ship_symbols.py [--check] [--no-provenance]

Inputs (build outputs, byte-identical rebuilds of approved art):
  build/pack/symbols{tps}/sym_<id>{,_blur,_glow}.png   tools/artqa/board_sprites.py (360 x 360 @2x canvases,
                                                        the board sprite = the rig's setup pose)
  build/spine/bd/sym_<H1..H4|W>.{json,atlas,png}       tools/spine/examples/bass_drop/build.sh <ID>
Outputs (shipped, relative URLs './assets/bass-drop/...'):
  public/assets/bass-drop/symbols/sym_<id>{,_blur,_glow}@2x.webp   (Pixi reads resolution 2 from '@2x')
  public/assets/bass-drop/spine/sym_<ID>.{json,atlas,webp}         (PMA page as LOSSLESS WebP: premultiplied
                                                                    texels survive exactly; the atlas page line
                                                                    is renamed; the editor-only `skeleton.images`
                                                                    / `skeleton.audio` paths are dropped)
Every written file gets a provenance row in art/manifest.json (tools/gen/provenance.py, locked append):
stage packaging, route code, shipped true, parents = the rows of its inputs found by CURRENT sha256
(sprites: the board / blur / glow rows; rigs: every part image the atlas packs), licence inherited from them
(higgsfield wins over owned-code, so the release audit walks the pending clearance). Re-runs are
idempotent: WebP encoding is deterministic, ids end in the output sha256.
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

SPRITES = ("H1", "H2", "H3", "H4", "W", "L1", "L2", "L3", "L4", "L5")
RIGS = ("H1", "H2", "H3", "H4", "W")
VARIANTS = ("", "_blur", "_glow")
SRC_SPRITES = REPO / "build/pack/symbols{tps}"
SRC_RIGS = REPO / "build/spine/bd"
IMAGES = REPO / "art/source/spine/images"
OUT = REPO / "public/assets/bass-drop"
TOOL = "tools/artqa/ship_symbols.py"
VERSION = "phase-d"
# static: near-transparent lossy (the swap to Spine must not pop); blur: softer; glow: lossless (tiny, tinted white)
WEBP = {
    "": dict(quality=94, alpha_quality=100, method=6),
    "_blur": dict(quality=90, alpha_quality=100, method=6),
    "_glow": dict(lossless=True, quality=100, method=6, exact=True),
}


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
    hit = [r for r in by_sha.get(sha, []) if r["path"] == P.rel(path)] or by_sha.get(sha, [])
    if not hit:
        raise SystemExit(f"ship_symbols: no art/manifest.json row for {P.rel(path)} (sha256 {sha[:12]}); "
                         "rebuild it with --provenance first")
    return hit[-1]


def licence_of(parents: list[dict]) -> str:
    ids = [p.get("licenseId") for p in parents if p.get("licenseId")]
    return "higgsfield" if "higgsfield" in ids else (ids[0] if ids else "owned-code")


def atlas_regions(atlas_text: str) -> list[str]:
    """Region names of a libGDX/Spine atlas (lines without ':' after the page header block)."""
    names, lines = [], atlas_text.splitlines()
    i = 0
    while i < len(lines):
        ln = lines[i].strip()
        i += 1
        if not ln or ":" in ln or ln.endswith((".png", ".webp")):
            continue
        names.append(ln)
    return names


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="write nothing; exit 1 when a shipped file would change")
    ap.add_argument("--no-provenance", action="store_true")
    a = ap.parse_args()
    by_sha = rows_by_sha(P.read_manifest(P.MANIFEST)["rows"])
    files: list[tuple[Path, bytes, list[dict], str]] = []

    for sid in SPRITES:
        for v in VARIANTS:
            src = SRC_SPRITES / f"sym_{sid}{v}.png"
            img = Image.open(src).convert("RGBA")
            if img.size != (360, 360):
                raise SystemExit(f"ship_symbols: {P.rel(src)} is {img.size}, expected the 360 x 360 @2x canvas")
            par = parent_row(by_sha, src)
            note = (f"board sprite {sid}{v or ' static'} as WebP @2x (360 x 360; " +
                    ("lossless" if v == "_glow" else f"q{WEBP[v]['quality']}") + ")")
            files.append((OUT / "symbols" / f"sym_{sid}{v}@2x.webp", webp_bytes(img, **WEBP[v]), [par], note))

    for sid in RIGS:
        name = f"sym_{sid}"
        atlas = (SRC_RIGS / f"{name}.atlas").read_text(encoding="utf-8")
        if f"{name}.png" not in atlas.splitlines()[0]:
            raise SystemExit(f"ship_symbols: unexpected page line in {name}.atlas: {atlas.splitlines()[0]!r}")
        regions = atlas_regions(atlas)
        parents = [parent_row(by_sha, IMAGES / f"{r}.png") for r in regions]
        page = Image.open(SRC_RIGS / f"{name}.png")
        if max(page.size) > 2048:
            raise SystemExit(f"ship_symbols: {name}.png page {page.size} exceeds 2048")
        if "pma: true" not in atlas:
            raise SystemExit(f"ship_symbols: {name}.atlas is not PMA")
        page_bytes = webp_bytes(page.convert("RGBA"), lossless=True, quality=100, method=6, exact=True)
        atlas_out = atlas.replace(f"{name}.png", f"{name}.webp", 1)
        skel = json.loads((SRC_RIGS / f"{name}.json").read_text(encoding="utf-8"))
        for k in ("images", "audio"):
            skel.get("skeleton", {}).pop(k, None)
        skel_bytes = (json.dumps(skel, separators=(",", ":"), ensure_ascii=False) + "\n").encode("utf-8")
        rig_note = f"{name} rig (tools/spine/examples/bass_drop/build.sh {sid}, PMA, {page.size[0]}x{page.size[1]})"
        files.append((OUT / "spine" / f"{name}.webp", page_bytes, parents, rig_note + ": atlas page, lossless WebP"))
        files.append((OUT / "spine" / f"{name}.atlas", atlas_out.encode("utf-8"), parents, rig_note + ": atlas"))
        files.append((OUT / "spine" / f"{name}.json", skel_bytes, parents, rig_note + ": skeleton JSON (4.3)"))

    changed = [f for f, data, _, _ in files if not f.exists() or f.read_bytes() != data]
    if a.check:
        for f in changed:
            print(f"ship_symbols: DRIFT {P.rel(f)}")
        return 1 if changed else 0
    rows = []
    total = 0
    for f, data, parents, note in files:
        f.parent.mkdir(parents=True, exist_ok=True)
        if f in changed:
            f.write_bytes(data)
        total += len(data)
        sha = P.sha256_bytes(data)
        rows.append(P.make_row(
            id=P.safe_id(f"bd_ship.{f.stem.replace('@', '_')}.{f.suffix.lstrip('.')}.{sha[:8]}"), path=f,
            stage="packaging", sha256=sha, vendor="self", model=TOOL, version=VERSION,
            license_id=licence_of(parents), route="code", ref_hashes=sorted({p["sha256"] for p in parents}),
            parents=[p["id"] for p in parents], shipped=True, notes=note))
    added = 0 if a.no_provenance else P.append_rows(P.MANIFEST, rows, generated_by="tools/artqa")
    print(f"ship_symbols: {len(files)} files ({len(changed)} written, {total / 1024:.0f} KiB), "
          f"{added} provenance row(s) added")
    return 0


if __name__ == "__main__":
    sys.exit(main())
