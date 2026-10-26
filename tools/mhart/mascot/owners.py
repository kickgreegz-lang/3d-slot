#!/usr/bin/env python3
"""Ownership QA for the Monty master cut: every setup part tinted over the master at full resolution,
part boundaries in black, cropped to a box (for authoring cut.yaml seeds and cut lines).

    tools/.venv/bin/python tools/mhart/mascot/owners.py [--box x0 y0 x1 y1] [--scale 1.5] [--out file.png]
"""
from __future__ import annotations

import argparse
import colorsys
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / "art/source/mascots/pipeline"))
import mastercut as mc  # noqa: E402

SPEC = REPO / "art/source/magpie-heist/mascot/spine2d/cut.yaml"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--spec", default=str(SPEC))
    ap.add_argument("--box", nargs=4, type=int)
    ap.add_argument("--scale", type=float, default=1.0)
    ap.add_argument("--out", default=str(REPO / "build/qa/chr_monty/cut/owners_crop.png"))
    a = ap.parse_args()
    c = mc.Cut(Path(a.spec))
    c.load_master()
    P = c.parts_list()
    c._zmap = {p["pid"]: p["z"] for p in P}
    owned = c.ownership(P)
    H, W = c.H, c.W
    base = c.rgb * c.alpha[..., None] + 0.55 * (1 - c.alpha[..., None])
    tint = np.zeros((H, W, 3), np.float32)
    tm = np.zeros((H, W), np.float32)
    n = max(len(owned), 1)
    for j, (pid, m) in enumerate(owned.items()):
        col = np.asarray(colorsys.hsv_to_rgb((j * 0.381966) % 1.0, 0.8, 1.0), np.float32)
        tint[m] = col
        tm[m] = 0.45
        e = mc.boundary(m)
        tint[e] = 0
        tm[e] = 1.0
    out = base * (1 - tm[..., None]) + tint * tm[..., None]
    im = Image.fromarray((np.clip(out, 0, 1) * 255 + 0.5).astype(np.uint8))
    x0, y0, x1, y1 = a.box or (0, 0, W, H)
    im = im.crop((x0, y0, x1, y1))
    if a.scale != 1:
        im = im.resize((int(im.size[0] * a.scale), int(im.size[1] * a.scale)), Image.NEAREST)
    d = ImageDraw.Draw(im)
    for pid, m in owned.items():
        ys, xs = np.nonzero(m)
        if len(xs):
            cx, cy = (xs.mean() - x0) * a.scale, (ys.mean() - y0) * a.scale
            if 0 <= cx < im.size[0] and 0 <= cy < im.size[1]:
                d.text((cx - 10, cy - 5), pid, fill=(255, 255, 255))
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    im.save(a.out)
    print(a.out, im.size, {k: int(v) for k, v in c.unowned.items()})
    return 0


if __name__ == "__main__":
    sys.exit(main())
