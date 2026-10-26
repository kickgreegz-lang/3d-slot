#!/usr/bin/env python3
"""Magpie Heist art build: approved Higgsfield raws -> art/source/magpie-heist/** with a provenance row per
file (docs/games/magpie-heist/ART_PLAN.md). Shipping into public/assets is tools/licence/ship.py with the spec
this script writes (tools/licence/ship/magpie_heist.json).

    tools/.venv/bin/python tools/mhart/build_art.py [symbols] [bg] [mascot] [ship-spec]   (default: all)

  symbols  matte every approved symbol raw (tools/matte/outline_matte.py: measured key, 360 @2x canvas fit,
           master_1024 emitted), bake the live-text stand-ins (W: "WILD" on its banner, Lilita One via the
           bundled font), then tools/matte/variants.py for _blur / _glow;
  bg       the painted plate: 21:9 4K -> 2:1 centre crop -> 2560 x 1280 WebP (+ a 1:2 portrait stand-in cut
           from the landscape plate until the portrait plate is generated);
  mascot   the approved design sheet: key matte at full resolution, the three-quarter view (2nd figure) cut
           out and fitted to 2x of the landscape mascot rect -> mascot/monty_static.png;
  ship-spec  writes tools/licence/ship/magpie_heist.json for every built file.
Re-runs are idempotent (same inputs -> same bytes -> no new rows).
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "tools/gen"))
import provenance as P  # noqa: E402

TOOL = "tools/mhart/build_art.py"
PY = str(REPO / "tools/.venv/bin/python")
SRC = REPO / "art/source/magpie-heist"
WORK = REPO / "art/_work/magpie-heist"
FONTS = REPO / "art/_work/fonts"

# approved raw per symbol: (raw path, raw row id, requested key)
SYMBOLS = {
    "W": ("art/_raw/mh_sym_W/v01/raw.png", "mh_sym_w.raw.v01", "00FF00"),
    "R": ("art/_raw/mh_sym_R/v01/raw.png", "mh_sym_r.raw.v01", "00FF00"),
    "H1": ("art/_raw/mh_sym_H1_D/v01/raw.png", "mh_sym_h1_d.raw.v01", "00FF00"),
}
BG = ("art/_raw/mh_bg_base_landscape/v01/raw.png", "mh_bg_base_landscape.raw.v01")
MASCOT = ("art/_raw/mh_mascot_monty_sheet/v01/raw.png", "mh_mascot_monty_sheet.raw.v01")


def rows_by_path() -> dict[tuple[str, str], dict]:
    return {(r.get("path"), r.get("sha256")): r for r in P.read_manifest(P.MANIFEST)["rows"]}


def row_for(path: Path) -> dict | None:
    return rows_by_path().get((P.rel(path), P.sha256_file(path)))


def record(path: Path, stage: str, parents: list[str], notes: str) -> str:
    """Append a code-route row for `path` (no-op when its current bytes already have one)."""
    have = row_for(path)
    if have:
        return have["id"]
    sha = P.sha256_file(path)
    lic = P.inherit_license(parents, default="higgsfield")
    rid = P.safe_id(f"mh.{P.rel(path).removeprefix('art/source/magpie-heist/').rsplit('.', 1)[0].replace('/', '.')}.{sha[:8]}")
    parent_rows = [r for r in P.read_manifest(P.MANIFEST)["rows"] if r["id"] in parents]
    row = P.make_row(id=rid, path=P.rel(path), stage=stage, sha256=sha, vendor="self", model=TOOL, version="mh-1",
                     license_id=lic, route="code", ref_hashes=[r["sha256"] for r in parent_rows], parents=parents,
                     notes=notes)
    P.append_rows(P.MANIFEST, [row], generated_by=TOOL)
    return rid


def font(name: str) -> Path:
    """TTF of a bundled woff2 face (fontTools decompress, cached in art/_work/fonts)."""
    FONTS.mkdir(parents=True, exist_ok=True)
    out = FONTS / f"{name}.ttf"
    if not out.exists():
        from fontTools.ttLib import TTFont  # noqa: PLC0415

        f = TTFont(str(REPO / f"public/assets/fonts/{name}.woff2"))
        f.flavor = None
        f.save(str(out))
    return out


def run(*args: str, env_game: bool = True) -> None:
    import os  # noqa: PLC0415

    env = dict(os.environ)
    if env_game:
        env["GAME"] = "magpie-heist"
    r = subprocess.run(list(args), cwd=REPO, env=env, capture_output=True, text=True)
    if r.returncode != 0:
        print(r.stdout[-3000:], r.stderr[-3000:])
        raise SystemExit(f"failed: {' '.join(args[:3])}")


# ----------------------------------------------------------------------------------------------- symbols

def stroke_text(im: Image.Image, text: str, box: tuple[int, int, int, int], ttf: Path, fill: tuple, outline: tuple,
                ow: int, shade: tuple | None = None) -> Image.Image:
    """Centre `text` inside box (x0, y0, x1, y1) at the largest size that fits, black outline, cel shade band."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    size = h
    while size > 8:
        f = ImageFont.truetype(str(ttf), size)
        bb = f.getbbox(text)
        if bb[2] - bb[0] <= w * 0.92 and bb[3] - bb[1] <= h * 0.86:
            break
        size -= 2
    f = ImageFont.truetype(str(ttf), size)
    bb = f.getbbox(text)
    tx = x0 + (w - (bb[2] - bb[0])) / 2 - bb[0]
    ty = y0 + (h - (bb[3] - bb[1])) / 2 - bb[1]
    layer = Image.new("RGBA", im.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.text((tx, ty), text, font=f, fill=fill, stroke_width=ow, stroke_fill=outline)
    if shade:
        # lower-half cel band inside the letters
        mask = Image.new("L", im.size, 0)
        ImageDraw.Draw(mask).text((tx, ty), text, font=f, fill=255)
        band = Image.new("L", im.size, 0)
        mid = int(ty + bb[1] + (bb[3] - bb[1]) * 0.55)
        ImageDraw.Draw(band).rectangle([0, mid, im.size[0], im.size[1]], fill=255)
        m = np.minimum(np.asarray(mask), np.asarray(band))
        sh = Image.new("RGBA", im.size, shade)
        sh.putalpha(Image.fromarray(m))
        layer = Image.alpha_composite(layer, sh)
    return Image.alpha_composite(im, layer)


def build_symbols() -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    for sid, (raw, raw_id, key) in SYMBOLS.items():
        d = SRC / "symbols" / sid
        d.mkdir(parents=True, exist_ok=True)
        master = d / "master_1024.png"
        matte = WORK / "matte" / f"sym_{sid}.png"
        matte.parent.mkdir(parents=True, exist_ok=True)
        run(PY, "tools/matte/outline_matte.py", raw, str(matte), "--symbol", sid, "--expect-key", key,
            "--emit-master", str(master), "--qa-dir", f"build/qa/matte/mh_sym_{sid}")
        mid = record(master, "matting", [raw_id], f"sym_{sid} master: key matte of the approved raw (measured key), full resolution")
        board = Image.open(matte).convert("RGBA")
        if sid == "W":
            # live-text stand-in: WILD on the blank cream banner (rig: txt_wild slot)
            a = np.asarray(board)[..., 3]
            ys, xs = np.nonzero(a > 10)
            y0, y1 = ys.min(), ys.max()
            h = y1 - y0
            box = (int(xs.min() + (xs.max() - xs.min()) * 0.2), int(y0 + h * 0.66), int(xs.max() - (xs.max() - xs.min()) * 0.2), int(y0 + h * 0.86))
            board = stroke_text(board, "WILD", box, font("LuckiestGuy-Regular"), (200, 32, 58, 255), (18, 10, 20, 255), 3, shade=(150, 16, 40, 255))
        path = d / "board.png"
        board.save(path, optimize=True)
        bid = record(path, "packaging", [mid], f"sym_{sid} board sprite: matte fitted on the 360 @2x canvas (cellScale)"
                     + ("; WILD baked on the banner from the bundled Luckiest Guy face (live-text stand-in)" if sid == "W" else ""))
        run(PY, "tools/matte/variants.py", str(path), "--symbol", sid, "--parent-id", bid, "--manifest", "art/manifest.json")
        out[sid] = [P.rel(path), P.rel(d / "board_blur.png"), P.rel(d / "board_glow.png")]
        print(f"symbols: {sid} ok")
    return out


# ----------------------------------------------------------------------------------------------- background

def build_bg() -> list[str]:
    raw, raw_id = BG
    im = Image.open(REPO / raw).convert("RGB")
    W, H = im.size
    cw = H * 2
    land = im.crop(((W - cw) // 2, 0, (W - cw) // 2 + cw, H)).resize((2560, 1280), Image.LANCZOS)
    d = SRC / "bg"
    d.mkdir(parents=True, exist_ok=True)
    lp = d / "base_landscape.webp"
    land.save(lp, "WEBP", quality=90, method=6)
    record(lp, "backgrounds", [raw_id], "base plate landscape: 2:1 centre crop of the 21:9 4K plate, Lanczos 2560x1280, WebP q90")
    # portrait stand-in: the centre 1:2 column of the 21:9 plate, scaled to 1280x2560
    ph = H
    pw = H // 2
    port = im.crop(((W - pw) // 2, 0, (W - pw) // 2 + pw, ph)).resize((1280, 2560), Image.LANCZOS)
    pp = d / "base_portrait.webp"
    port.save(pp, "WEBP", quality=88, method=6)
    record(pp, "backgrounds", [raw_id], "portrait stand-in: centre 1:2 column of the landscape plate (the portrait plate is a planned row)")
    print("bg ok")
    return [P.rel(lp), P.rel(pp)]


# ----------------------------------------------------------------------------------------------- mascot

def build_mascot() -> list[str]:
    raw, raw_id = MASCOT
    full = WORK / "matte" / "monty_sheet.png"
    full.parent.mkdir(parents=True, exist_ok=True)
    run(PY, "tools/matte/outline_matte.py", raw, str(full), "--no-fit", "--expect-key", "FF00FF", "--kind", "special",
        "--qa-dir", "build/qa/matte/mh_monty_sheet", "--no-strict")
    im = Image.open(full).convert("RGBA")
    a = np.asarray(im)[..., 3] > 20
    # figures = the big connected components (a gloved hand or a feather tip may hang off by a few px:
    # components are found on a 9 px dilation, so it stays with its figure), sorted by centroid x
    from scipy import ndimage  # noqa: PLC0415

    lab, n = ndimage.label(ndimage.binary_dilation(a, iterations=9))
    sizes = ndimage.sum(np.ones_like(lab), lab, index=range(1, n + 1))
    big = [i + 1 for i, sz in enumerate(sizes) if sz > a.size * 0.01]
    if len(big) < 2:
        raise SystemExit(f"mascot: expected 4 figures, found {len(big)}")
    cx = {i: ndimage.center_of_mass(lab == i)[1] for i in big}
    pick = sorted(big, key=lambda i: cx[i])[1]
    mask = (lab == pick) & a
    ys, xs = np.nonzero(mask)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    arr = np.asarray(im).copy()
    arr[..., 3] = np.where(lab == pick, arr[..., 3], 0)
    im = Image.fromarray(arr)
    pad = 12
    fig = im.crop((max(0, x0 - pad), max(0, y0 - pad), min(im.width, x1 + pad), min(im.height, y1 + pad)))
    # 2x of the landscape mascot rect height (724 design px) -> <= 1448 px tall, never upscaled
    target_h = min(1448, fig.height)
    k = target_h / fig.height
    fig = fig.resize((max(1, round(fig.width * k)), target_h), Image.LANCZOS)
    d = SRC / "mascot"
    d.mkdir(parents=True, exist_ok=True)
    path = d / "monty_static.png"
    fig.save(path, optimize=True)
    record(path, "matting", [raw_id], "Monty three-quarter view (2nd figure of the approved design sheet): key matte (halo gate overridden: the flagged edge texels are his plum cap and crimson scarf, key-hued by design; checked on navy, no spill), cut out, fitted to 2x of the landscape mascot rect (static stand-in until chr_monty)")
    print(f"mascot ok {fig.size}")
    return [P.rel(path)]


# ----------------------------------------------------------------------------------------------- ship spec

def ship_spec() -> None:
    items = []
    for sid in SYMBOLS:
        for suf, name in [("", "board"), ("_blur", "board_blur"), ("_glow", "board_glow")]:
            items.append({"src": f"art/source/magpie-heist/symbols/{sid}/{name}.png",
                          "dst": f"public/assets/magpie-heist/symbols/sym_{sid}{suf}@2x.webp",
                          "encode": {"webp": {"lossless": True} if suf == "" else {"quality": 88}}})
    for n in ["base_landscape", "base_portrait"]:
        items.append({"src": f"art/source/magpie-heist/bg/{n}.webp", "dst": f"public/assets/magpie-heist/bg/{n}.webp", "encode": "copy"})
    items.append({"src": "art/source/magpie-heist/mascot/monty_static.png", "dst": "public/assets/magpie-heist/mascot/monty_static.webp",
                  "encode": {"webp": {"quality": 92}}})
    spec = {"$comment": "Magpie Heist: board sprites, plates, mascot stand-in. Built by tools/mhart/build_art.py; ship with tools/.venv/bin/python tools/licence/ship.py tools/licence/ship/magpie_heist.json",
            "name": "magpie-heist", "items": items}
    p = REPO / "tools/licence/ship/magpie_heist.json"
    p.write_text(json.dumps(spec, indent=1) + "\n")
    print(f"ship spec: {len(items)} items -> {P.rel(p)}")


def main() -> int:
    steps = sys.argv[1:] or ["symbols", "bg", "mascot", "ship-spec"]
    if "symbols" in steps:
        build_symbols()
    if "bg" in steps:
        build_bg()
    if "mascot" in steps:
        build_mascot()
    if "ship-spec" in steps:
        ship_spec()
    return 0


if __name__ == "__main__":
    sys.exit(main())
