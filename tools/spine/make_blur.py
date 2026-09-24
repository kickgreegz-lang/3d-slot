#!/usr/bin/env python3
"""Make `<part>_blur.png` spin-blur variants for Spine parts and flag them in parts.json.

    python tools/spine/make_blur.py tools/spine/examples/demo_symbol/parts.json [--size-y 14] [--only a,b] [--skip fx_]

Vertical box blur of radius --size-y px (PIPELINE 2.1: ffmpeg avgblur sizeX=1:sizeY=14) on a
canvas padded by the same amount top and bottom, done in PREMULTIPLIED space so edges do not
darken. The blur keeps the part's centre, so gen.py places it without extra data. Parts
whose bone starts with a --skip prefix (default: fx_) get no blur. Deterministic; rewrites
parts.json only when it changes. Exit 1 on missing images.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image


def vblur(rgba: np.ndarray, r: int) -> np.ndarray:
    a = rgba[:, :, 3:4].astype(np.float64) / 255.0
    pm = np.concatenate([rgba[:, :, :3].astype(np.float64) * a, a * 255.0], axis=2)
    h = pm.shape[0]
    pad = np.zeros((h + 2 * r, pm.shape[1], 4))
    pad[r:r + h] = pm
    cs = np.cumsum(np.concatenate([np.zeros((1, pm.shape[1], 4)), pad], axis=0), axis=0)
    k = 2 * r + 1
    out = np.zeros((h + 2 * r, pm.shape[1], 4))
    for y in range(h + 2 * r):
        y0 = max(0, y - r)
        y1 = min(h + 2 * r, y + r + 1)
        out[y] = (cs[y1] - cs[y0]) / k
    alpha = out[:, :, 3:4]
    with np.errstate(invalid="ignore", divide="ignore"):
        rgb = np.where(alpha > 0, out[:, :, :3] / (alpha / 255.0), 0)
    res = np.concatenate([rgb, alpha], axis=2)
    return np.clip(np.rint(res), 0, 255).astype(np.uint8)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="make_blur.py", description=__doc__.split("\n\n")[0],
                                 formatter_class=argparse.RawDescriptionHelpFormatter, epilog=__doc__.split("\n", 2)[2])
    ap.add_argument("parts", help="parts.json")
    ap.add_argument("--size-y", type=int, default=14, help="vertical blur radius in px (@2x)")
    ap.add_argument("--only", default="", help="comma-separated part names (default: all but --skip)")
    ap.add_argument("--skip", default="fx_", help="comma-separated bone prefixes to skip")
    a = ap.parse_args(argv)
    pj = Path(a.parts)
    doc = json.loads(pj.read_text(encoding="utf-8"))
    root = pj.parent / doc.get("images", "images")
    prefix = f"sym_{doc['symbol']}"
    only = {s for s in a.only.split(",") if s}
    skip = [s for s in a.skip.split(",") if s]
    r = max(1, a.size_y)
    changed = False
    for p in doc["parts"]:
        if (only and p["name"] not in only) or any(p.get("bone", "body").startswith(s) for s in skip):
            continue
        src = root / p.get("image", f"{prefix}/{p['name']}.png")
        if not src.exists():
            print(f"make_blur.py: ERROR: {src} not found", file=sys.stderr)
            return 1
        rgba = np.asarray(Image.open(src).convert("RGBA"))
        out = vblur(rgba, r)
        dst = src.with_name(f"{src.stem}_blur.png")
        buf = Image.fromarray(out)
        tmp = dst.with_suffix(".tmp.png")
        buf.save(tmp, optimize=False, compress_level=9)
        if dst.exists() and dst.read_bytes() == tmp.read_bytes():
            tmp.unlink()
        else:
            tmp.replace(dst)
        if p.get("blur") is not True:
            p["blur"] = True
            changed = True
        print(f"make_blur.py: {dst.relative_to(root)} {out.shape[1]}x{out.shape[0]}")
    if changed:
        pj.write_text(json.dumps(doc, indent=2) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
