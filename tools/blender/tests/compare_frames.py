#!/usr/bin/env python3
"""Compare two frame folders (same file names): bit-exact or within tolerance.

    python3 tools/blender/tests/compare_frames.py A/ B/ [--max-diff 8] [--max-share 0.0005]

Cycles CPU renders are bit-exact for well-formed geometry; exact ray ties on coincident
surfaces can flip with the (multithreaded) BVH build order and change a few pixels by a few
levels. Exit 0 when every frame is bit-exact or within tolerance (reported), 1 otherwise.
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import numpy as np  # noqa: E402
from slotbl import imgtools  # noqa: E402

ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
ap.add_argument("a")
ap.add_argument("b")
ap.add_argument("--max-diff", type=int, default=8, help="max per-channel difference (0-255)")
ap.add_argument("--max-share", type=float, default=0.0005, help="max share of differing pixels per frame")
args = ap.parse_args()
fa = sorted(Path(args.a).glob("*.png"))
fb = {p.name: p for p in Path(args.b).glob("*.png")}
if not fa or [p.name for p in fa] != sorted(fb):
    print(f"frame sets differ: {len(fa)} vs {len(fb)}")
    sys.exit(1)
exact, worst, ok = 0, (0, 0.0), True
for p in fa:
    x = imgtools.load_rgba(p).astype(int)
    y = imgtools.load_rgba(fb[p.name]).astype(int)
    if x.shape != y.shape:
        print(f"{p.name}: size differs")
        sys.exit(1)
    d = np.abs(x - y).max(-1)
    if not d.any():
        exact += 1
        continue
    share = float((d > 0).mean())
    worst = max(worst, (int(d.max()), share))
    if d.max() > args.max_diff or share > args.max_share:
        ok = False
        print(f"{p.name}: max diff {d.max()}, {share:.4%} of pixels")
print(f"{exact}/{len(fa)} frames bit-exact; worst other frame: max diff {worst[0]}, {worst[1]:.4%} pixels "
      f"-> {'OK' if ok else 'FAIL'}")
sys.exit(0 if ok else 1)
