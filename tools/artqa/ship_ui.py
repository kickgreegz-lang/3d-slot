#!/usr/bin/env python3
"""Ship the Bass Drop meter / stage / screen art into the runtime (ART_STATUS 7.3 and 7.6, the meter + stage + screens
integration track).

    tools/.venv/bin/python tools/artqa/ship_ui.py [--check] [--no-provenance]

Inputs (build outputs = byte-identical rebuilds of approved art, plus approved art/source files):
  build/spine/bd/ui_groove_meter.{json,atlas,png}          tools/spine/examples/bass_drop/build.sh meter
  build/spine/bd/env_speaker_stack.{json,atlas,png}        tools/bdart/build_env.sh speaker_stack
  build/spine/bd_half/<rig>@0.5x.{atlas,png}               tools/spine/pack.py --scale 0.5 (same skeleton, half texels):
      pack.py --images art/source/spine/images     --skeleton build/spine/bd/ui_groove_meter.json   --out build/spine/bd_half --name ui_groove_meter   --scale 0.5
      pack.py --images art/source/env/spine/images --skeleton build/spine/bd/env_speaker_stack.json --out build/spine/bd_half --name env_speaker_stack --scale 0.5
  art/source/ui/bass-drop/emblems/{jukebox,jukebox_cracked,mega_speaker}.png, jukebox_shards/shard_1..6.png
  art/source/ui/bass-drop/cards/art_{meter,jukejam,megamix}.png
Outputs (shipped; the runtime uses relative urls './assets/bass-drop/ui/...'):
  public/assets/bass-drop/ui/spine/<rig>.{json,atlas,webp}   full texel density (authored 2x landscape)
  public/assets/bass-drop/ui/spine/<rig>_half.{atlas,webp}   half density (phones / low tier; same skeleton JSON)
      PMA pages as LOSSLESS WebP (premultiplied texels survive exactly); atlas page lines renamed; the editor-only
      `skeleton.images` / `skeleton.audio` paths dropped from the JSON
  public/assets/bass-drop/ui/emblems/<name>.webp             768 px canvases (feature intro / upgrade / outro)
  public/assets/bass-drop/ui/emblems/<name>_icon.webp        256 px (feature plate icon: no 8x minification at runtime)
  public/assets/bass-drop/ui/emblems/shard_<n>.webp          x0.75 of the 1024-canvas cut (shards.json boxes x 0.75)
  public/assets/bass-drop/ui/cards/art_<key>.webp            768 px (intro + buy card illustrations; cropped at runtime)
Every written file gets a provenance row in art/manifest.json through tools/gen/provenance.py (locked append):
stage packaging, route code, shipped true, parents = the rows of its inputs found by CURRENT sha256 (rigs: every part
image the atlas packs), licence inherited (higgsfield wins over owned-code, so the release audit walks the pending
clearance). Deterministic (fixed encoder settings, LANCZOS resize): a re-run writes the same bytes; ids end in the
output sha256, so an unchanged re-run adds no rows.
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

TOOL = "tools/artqa/ship_ui.py"
VERSION = "phase-d"
OUT = REPO / "public/assets/bass-drop/ui"
FULL = REPO / "build/spine/bd"
HALF = REPO / "build/spine/bd_half"
# rig -> the images root its atlas regions are relative to
RIGS = {
    "ui_groove_meter": REPO / "art/source/spine/images",
    "env_speaker_stack": REPO / "art/source/env/spine/images",
}
EMBLEMS = REPO / "art/source/ui/bass-drop/emblems"
CARDS = REPO / "art/source/ui/bass-drop/cards"
EMBLEM_PX = 768
ICON_PX = 256
SHARD_SCALE = 0.75
CARD_PX = 768
# straight-alpha art (Pixi premultiplies on upload): near-lossless alpha, lossy colour
WEBP_ART = dict(quality=90, alpha_quality=100, method=6)
WEBP_CARD = dict(quality=88, method=6)
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
    hit = [r for r in by_sha.get(sha, []) if r["path"] == P.rel(path)] or by_sha.get(sha, [])
    if not hit:
        raise SystemExit(f"ship_ui: no art/manifest.json row for {P.rel(path)} (sha256 {sha[:12]}); "
                         "write its provenance with the tool that produced it first")
    return hit[-1]


def licence_of(parents: list[dict]) -> str:
    ids = [p.get("licenseId") for p in parents if p.get("licenseId")]
    return "higgsfield" if "higgsfield" in ids else (ids[0] if ids else "owned-code")


def atlas_regions(atlas_text: str) -> list[str]:
    """Region names of a Spine text atlas (lines without ':' after the page header)."""
    names = []
    for ln in (x.strip() for x in atlas_text.splitlines()):
        if not ln or ":" in ln or ln.endswith((".png", ".webp")):
            continue
        names.append(ln)
    return names


def resized(src: Path, px: int) -> Image.Image:
    im = Image.open(src)
    im = im.convert("RGBA" if im.mode in ("RGBA", "LA", "P") else "RGB")
    if im.size != (px, px):
        im = im.resize((px, px), Image.LANCZOS)
    return im


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="write nothing; exit 1 when a shipped file would change")
    ap.add_argument("--no-provenance", action="store_true")
    a = ap.parse_args()
    by_sha = rows_by_sha(P.read_manifest(P.MANIFEST)["rows"])
    files: list[tuple[Path, bytes, list[dict], str]] = []

    # ---- Spine rigs: full + half atlases, one JSON
    for name, images in RIGS.items():
        skel = json.loads((FULL / f"{name}.json").read_text(encoding="utf-8"))
        for k in ("images", "audio"):
            skel.get("skeleton", {}).pop(k, None)
        skel_bytes = (json.dumps(skel, separators=(",", ":"), ensure_ascii=False) + "\n").encode("utf-8")
        skel_parents: list[dict] = []
        for variant, src_dir, src_name, out_name in (
            ("full", FULL, name, name),
            ("half", HALF, f"{name}@0.5x", f"{name}_half"),
        ):
            atlas = (src_dir / f"{src_name}.atlas").read_text(encoding="utf-8")
            first = atlas.splitlines()[0].strip()
            if first != f"{src_name}.png":
                raise SystemExit(f"ship_ui: unexpected page line in {src_name}.atlas: {first!r} (one page expected)")
            if "pma: true" not in atlas:
                raise SystemExit(f"ship_ui: {src_name}.atlas is not PMA")
            if atlas.count(".png") != 1:
                raise SystemExit(f"ship_ui: {src_name}.atlas has more than one page")
            regions = atlas_regions(atlas)
            parents = [parent_row(by_sha, images / f"{r}.png") for r in regions]
            skel_parents = parents
            page = Image.open(src_dir / f"{src_name}.png")
            if max(page.size) > 2048:
                raise SystemExit(f"ship_ui: {src_name}.png page {page.size} exceeds 2048")
            page_bytes = webp_bytes(page.convert("RGBA"), **WEBP_PMA)
            atlas_out = atlas.replace(f"{src_name}.png", f"{out_name}.webp", 1)
            note = f"{name} rig, {variant} texel density (PMA, page {page.size[0]}x{page.size[1]})"
            files.append((OUT / "spine" / f"{out_name}.webp", page_bytes, parents, note + ": atlas page, lossless WebP"))
            files.append((OUT / "spine" / f"{out_name}.atlas", atlas_out.encode("utf-8"), parents, note + ": atlas"))
        files.append((OUT / "spine" / f"{name}.json", skel_bytes, skel_parents, f"{name} rig: skeleton JSON (4.3)"))

    # ---- emblems (feature screens) + plate icons + upgrade shards
    for name in ("jukebox", "jukebox_cracked", "mega_speaker"):
        src = EMBLEMS / f"{name}.png"
        par = [parent_row(by_sha, src)]
        files.append((OUT / "emblems" / f"{name}.webp", webp_bytes(resized(src, EMBLEM_PX), **WEBP_ART), par,
                      f"emblem {name}: {EMBLEM_PX} px WebP (q{WEBP_ART['quality']})"))
        if name != "jukebox_cracked":
            files.append((OUT / "emblems" / f"{name}_icon.webp", webp_bytes(resized(src, ICON_PX), **WEBP_ART), par,
                          f"emblem {name}: {ICON_PX} px icon for the feature plate"))
    for i in range(1, 7):
        src = EMBLEMS / "jukebox_shards" / f"shard_{i}.png"
        im = Image.open(src).convert("RGBA")
        w, h = max(1, round(im.width * SHARD_SCALE)), max(1, round(im.height * SHARD_SCALE))
        im = im.resize((w, h), Image.LANCZOS)
        files.append((OUT / "emblems" / f"shard_{i}.webp", webp_bytes(im, **WEBP_ART), [parent_row(by_sha, src)],
                      f"jukebox shard {i}: x{SHARD_SCALE} of the 1024-canvas cut ({w}x{h})"))

    # ---- card illustrations (intro + buy)
    for key in ("meter", "jukejam", "megamix"):
        src = CARDS / f"art_{key}.png"
        files.append((OUT / "cards" / f"art_{key}.webp", webp_bytes(resized(src, CARD_PX).convert("RGB"), **WEBP_CARD),
                      [parent_row(by_sha, src)], f"card art {key}: {CARD_PX} px WebP (q{WEBP_CARD['quality']})"))

    changed = [f for f, data, _, _ in files if not f.exists() or f.read_bytes() != data]
    if a.check:
        for f in changed:
            print(f"ship_ui: DRIFT {P.rel(f)}")
        known = {r.get("path") + "|" + r.get("sha256", "") for rs in by_sha.values() for r in rs}
        norow = [f for f, data, _, _ in files if f"{P.rel(f)}|{P.sha256_bytes(data)}" not in known]
        for f in norow:
            print(f"ship_ui: NO ROW {P.rel(f)}")
        print(f"ship_ui --check: {len(files)} files, {len(changed)} drift, {len(norow)} without a row")
        return 1 if changed or norow else 0
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
            id=P.safe_id(f"bd_ship_ui.{f.parent.name}.{f.stem}.{f.suffix.lstrip('.')}.{sha[:8]}"), path=f,
            stage="packaging", sha256=sha, vendor="self", model=TOOL, version=VERSION,
            license_id=licence_of(parents), route="code", ref_hashes=sorted({p["sha256"] for p in parents}),
            parents=sorted({p["id"] for p in parents}), shipped=True, notes=note))
    added = 0 if a.no_provenance else P.append_rows(P.MANIFEST, rows, generated_by="tools/artqa")
    print(f"ship_ui: {len(files)} files ({len(changed)} written, {total / 1024:.0f} KiB), "
          f"{added} provenance row(s) added")
    return 0


if __name__ == "__main__":
    sys.exit(main())
