#!/usr/bin/env python3
"""Ship one Magpie Heist rig: provenance for its part images, the ship-ready rig files, the board sprites rendered
from the rig, and the ship-spec items. Run by `tools/mhart/rigs/build.sh <ID> --ship` after a passing build (it then
runs tools/licence/ship.py on the spec).

    tools/.venv/bin/python tools/mhart/rigs/ship_rig.py <ID> [--no-board] [--dry-run]

1. part images (art/source/magpie-heist/spine/images/sym_<ID>/*.png): one `layer-split` row each, content-addressed
   (re-runs add nothing). Parts cut from the master (parts.json `$src: master`) get parent = the master row and
   licence `higgsfield`; procedural fx sprites (`$src: code`: glows, star glints, twinkles, rays) are `owned-code`;
   `<part>_blur.png` takes its base part's row as parent (tools/spine/make_blur.py).
2. the ship-ready rig, next to the images: art/source/magpie-heist/spine/sym_<ID>.json (the generated skeleton
   minus the editor-only `skeleton.images` / `skeleton.audio`), sym_<ID>.atlas (page renamed sym_<ID>.webp: the
   shipped page) and sym_<ID>.png (the PMA page; ship.py re-encodes it as LOSSLESS WebP, exact, so the
   premultiplied texels survive). Rows: parents = every part image the atlas packs.
3. board sprites: render_board.mjs renders the rig's setup pose on the 360 @2x canvas (+ the live-text stand-in for a
   rig with txt_wild) -> art/source/magpie-heist/symbols/<ID>/board.png (row: parents = the master + the rig page),
   then tools/matte/variants.py (GAME=magpie-heist restAngle) -> board_blur.png / board_glow.png with their rows.
4. tools/licence/ship/magpie_heist.json: merges the items for the three board files and the three rig files
   (public/assets/magpie-heist/{symbols/sym_<ID>[_blur|_glow]@2x.webp, spine/sym_<ID>.{json,atlas,webp}}), keeping
   every other track's items.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
sys.path.insert(0, str(REPO / "tools/gen"))
import provenance as P  # noqa: E402

TOOL = "tools/mhart/rigs/ship_rig.py"
PY = str(REPO / "tools/.venv/bin/python")
IMAGES = REPO / "art/source/magpie-heist/spine/images"
SPINE_SRC = REPO / "art/source/magpie-heist/spine"
SYMBOLS = REPO / "art/source/magpie-heist/symbols"
BUILD = REPO / "build/spine/mh"
SPEC = REPO / "tools/licence/ship/magpie_heist.json"


def sha12(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()[:12]


def current_row(rows: list[dict], path: Path) -> dict | None:
    rel, sha = P.rel(path), P.sha256_file(path)
    hit = [r for r in rows if r.get("path") == rel and r.get("sha256") == sha]
    return hit[-1] if hit else None


def licence_of(parents: list[dict]) -> str:
    ids = [p.get("licenseId") for p in parents if p.get("licenseId")]
    return "higgsfield" if "higgsfield" in ids else (ids[0] if ids else "owned-code")


def row(path: Path, rid: str, stage: str, model: str, version: str, parents: list[dict], notes: str,
        licence: str | None = None) -> dict:
    sha = P.sha256_file(path)
    return P.make_row(id=P.safe_id(f"{rid}.{sha[:8]}"), path=path, stage=stage, sha256=sha, vendor="self", model=model,
                      version=version, license_id=licence or licence_of(parents), route="code",
                      ref_hashes=sorted({p["sha256"] for p in parents}), parents=[p["id"] for p in parents], notes=notes)


def append(rows: list[dict], new: list[dict], dry: bool) -> None:
    have = {r["id"] for r in rows}
    fresh = [r for r in new if r["id"] not in have]
    if fresh and not dry:
        P.append_rows(P.MANIFEST, fresh, generated_by=TOOL)
    rows.extend(fresh)
    print(f"ship_rig: {len(new)} row(s), {len(fresh)} new")


def atlas_regions(text: str) -> list[str]:
    out = []
    for ln in text.splitlines():
        s = ln.strip()
        if s and ":" not in s and not s.endswith((".png", ".webp")):
            out.append(s)
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("id")
    ap.add_argument("--no-board", action="store_true", help="keep the current board sprites")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    sid, sk = a.id, f"sym_{a.id}"
    rows = P.read_manifest(P.MANIFEST)["rows"]
    master = SYMBOLS / sid / "master_1024.png"
    mrow = current_row(rows, master)
    if not mrow:
        raise SystemExit(f"ship_rig: no art/manifest.json row for {P.rel(master)} at its current sha256")
    parts_doc = json.loads((SYMBOLS / sid / "parts.json").read_text(encoding="utf-8"))
    src_of = {p["name"]: p.get("$src", "master") for p in parts_doc["parts"]}
    cut = HERE / f"cut_{sid}.py"
    cut_ver = sha12(cut)

    # ------------------------------------------------------------------ 1. part images
    made: dict[str, dict] = {}
    new = []
    files = sorted((IMAGES / sk).glob("*.png"), key=lambda p: (p.stem.endswith("_blur"), p.stem))
    for f in files:
        name = f.stem
        if name.endswith("_blur"):
            base = made.get(name[: -len("_blur")])
            if base is None:
                raise SystemExit(f"ship_rig: {P.rel(f)} has no base part")
            r = row(f, f"mh.{sk}.{name}", "layer-split", "tools/spine/make_blur.py", "1.0.0", [base],
                    f"{sk}: spin-blur variant of {base['path'].rsplit('/', 1)[-1]} (vertical box blur)")
        elif src_of.get(name) == "code":
            r = row(f, f"mh.{sk}.{name}", "layer-split", f"tools/mhart/rigs/cut_{sid}.py", cut_ver, [],
                    f"{sk}: fx sprite '{name}' drawn in code ({cut.name})", licence="owned-code")
        else:
            r = row(f, f"mh.{sk}.{name}", "layer-split", f"tools/mhart/rigs/cut_{sid}.py", cut_ver, [mrow],
                    f"{sk}: part '{name}' cut from the approved master ({cut.name}: masks in master px, hidden areas "
                    "filled under the part that hides them; fx overlays from the part's own silhouette)")
        made[name] = r
        new.append(r)
    append(rows, new, a.dry_run)

    # ------------------------------------------------------------------ 2. the ship-ready rig
    atlas = (BUILD / f"{sk}.atlas").read_text(encoding="utf-8")
    first = atlas.splitlines()[0].strip()
    if first != f"{sk}.png" or "pma: true" not in atlas:
        raise SystemExit(f"ship_rig: unexpected atlas header in {sk}.atlas ({first!r}); rebuild with build.sh {sid}")
    regions = atlas_regions(atlas)
    part_rows = []
    for reg in regions:
        f = IMAGES / f"{reg}.png"
        r = current_row(rows, f) or made.get(Path(reg).name)
        if not r:
            raise SystemExit(f"ship_rig: atlas region {reg} has no part-image row")
        part_rows.append(r)
    skel = json.loads((BUILD / f"{sk}.json").read_text(encoding="utf-8"))
    for k in ("images", "audio"):
        skel.get("skeleton", {}).pop(k, None)
    out_json, out_atlas, out_png = SPINE_SRC / f"{sk}.json", SPINE_SRC / f"{sk}.atlas", SPINE_SRC / f"{sk}.png"
    if not a.dry_run:
        SPINE_SRC.mkdir(parents=True, exist_ok=True)
        out_json.write_text(json.dumps(skel, separators=(",", ":"), ensure_ascii=False) + "\n", encoding="utf-8")
        out_atlas.write_text(atlas.replace(f"{sk}.png", f"{sk}.webp", 1), encoding="utf-8")
        out_png.write_bytes((BUILD / f"{sk}.png").read_bytes())
    gen_ver = sha12(HERE / "mhgen.py")
    new = [
        row(out_json, f"mh.{sk}.skeleton", "spine-authoring", "tools/mhart/rigs/mhgen.py", gen_ver, part_rows,
            f"{sk} skeleton (Spine 4.3 JSON) from art/source/magpie-heist/symbols/{sid}/{{rig,heist}}.yaml + parts.json; "
            "editor-only skeleton.images dropped (tools/mhart/rigs/build.sh)"),
        row(out_atlas, f"mh.{sk}.atlas", "packaging", "tools/spine/pack.py", sha12(REPO / "tools/spine/pack.py"),
            part_rows, f"{sk} atlas (PMA, {len(regions)} regions); page line renamed to {sk}.webp (the shipped page)"),
        row(out_png, f"mh.{sk}.page", "packaging", "tools/spine/pack.py", sha12(REPO / "tools/spine/pack.py"),
            part_rows, f"{sk} atlas page (PMA PNG; shipped as lossless WebP)"),
    ] if not a.dry_run else []
    append(rows, new, a.dry_run)
    page_row = new[2] if new else None

    # ------------------------------------------------------------------ 3. board sprites from the rig
    sdir = SYMBOLS / sid
    if not a.no_board and not a.dry_run:
        board = sdir / "board.png"
        subprocess.run(["node", str(HERE / "render_board.mjs"), "--skel", str(BUILD / f"{sk}.json"), "--atlas",
                        str(BUILD / f"{sk}.atlas"), "--out", str(board)], check=True, cwd=REPO)
        has_txt = any(s["name"] == "txt_wild" for s in skel.get("slots", []))
        brow = row(board, f"mh.symbols.{sid.lower()}.board", "packaging", "tools/mhart/rigs/render_board.mjs",
                   sha12(HERE / "render_board.mjs"), [mrow, page_row],
                   f"board sprite {sid}: the {sk} rig's setup pose rendered on the 360 @2x canvas (spine-pixi-v8, PMA "
                   "black/white difference matte), so the static -> Spine swap cannot pop"
                   + ("; live-text stand-in: WILD in the txt_wild slot (BitmapText, bundled Luckiest Guy, "
                      "src/games/magpie-heist/glint/wildWord.json)" if has_txt else ""))
        append(rows, [brow], False)
        env = dict(os.environ, GAME="magpie-heist")
        subprocess.run([PY, "tools/matte/variants.py", str(board), "--symbol", sid, "--parent-id", brow["id"],
                        "--manifest", "art/manifest.json", "--qa-dir", f"build/qa/rigs/mh_{sk}/variants"],
                       check=True, cwd=REPO, env=env, stdout=subprocess.DEVNULL)
        print(f"ship_rig: board sprites -> {P.rel(sdir)}/board{{,_blur,_glow}}.png")

    # ------------------------------------------------------------------ 4. ship spec
    items = [
        {"src": P.rel(sdir / "board.png"), "dst": f"public/assets/magpie-heist/symbols/{sk}@2x.webp",
         "encode": {"webp": {"lossless": True}}},
        {"src": P.rel(sdir / "board_blur.png"), "dst": f"public/assets/magpie-heist/symbols/{sk}_blur@2x.webp",
         "encode": {"webp": {"quality": 88}}},
        {"src": P.rel(sdir / "board_glow.png"), "dst": f"public/assets/magpie-heist/symbols/{sk}_glow@2x.webp",
         "encode": {"webp": {"quality": 88}}},
        {"src": P.rel(out_json), "dst": f"public/assets/magpie-heist/spine/{sk}.json", "encode": "copy",
         "note": "rig skeleton (tools/mhart/rigs/build.sh)"},
        {"src": P.rel(out_atlas), "dst": f"public/assets/magpie-heist/spine/{sk}.atlas", "encode": "copy",
         "note": f"rig atlas (page {sk}.webp)"},
        {"src": P.rel(out_png), "dst": f"public/assets/magpie-heist/spine/{sk}.webp",
         "encode": {"webp": {"lossless": True, "exact": True, "quality": 100, "method": 6}},
         "note": "PMA atlas page, lossless WebP (premultiplied texels kept exactly)"},
    ]
    spec = json.loads(SPEC.read_text(encoding="utf-8")) if SPEC.exists() else {"name": "magpie-heist", "items": []}
    mine = {it["dst"] for it in items}
    kept = [it for it in spec.get("items", []) if it["dst"] not in mine]
    spec["items"] = kept + items
    if not a.dry_run:
        SPEC.write_text(json.dumps(spec, indent=1) + "\n", encoding="utf-8")
    print(f"ship_rig: {P.rel(SPEC)}: {len(spec['items'])} items ({len(items)} for {sk})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
