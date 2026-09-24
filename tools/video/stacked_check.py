#!/usr/bin/env python3
"""Decode a stacked-alpha MP4 back and compare it with the source RGBA frames (what the runtime
recombine shader will show). Needs numpy + pillow; ffmpeg from $FFMPEG.

  FFMPEG=... python tools/video/stacked_check.py 'frames/fx_%04d.png' 1 out.mp4 [--report qa.json]
Gates: frame count equal; mean |alpha error| <= 3/255 and p99 <= 24/255; mean |premultiplied
colour error| <= 6/255 (H.264 4:2:0 chroma costs a little at hard colour edges).
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("pattern")
    ap.add_argument("start", type=int)
    ap.add_argument("mp4")
    ap.add_argument("--report")
    ap.add_argument("--max-alpha-mae", type=float, default=3.0)
    ap.add_argument("--max-alpha-p99", type=float, default=24.0)
    ap.add_argument("--max-colour-mae", type=float, default=6.0)
    a = ap.parse_args(argv)
    ff = os.environ.get("FFMPEG", "ffmpeg")
    src = []
    i = a.start
    while Path(a.pattern % i).is_file():
        src.append(np.asarray(Image.open(a.pattern % i).convert("RGBA"), np.float32))
        i += 1
    if not src:
        print(f"error: no frames match {a.pattern} from {a.start}", file=sys.stderr)
        return 2
    h, w = src[0].shape[:2]
    probe = subprocess.run([ff, "-hide_banner", "-nostdin", "-i", a.mp4], capture_output=True, text=True).stderr
    import re
    m = re.search(r"Video: .*?(\d{2,5})x(\d{2,5})", probe)
    vw, vh = int(m.group(1)), int(m.group(2))
    raw = subprocess.run([ff, "-hide_banner", "-loglevel", "error", "-nostdin", "-i", a.mp4, "-f", "rawvideo",
                          "-pix_fmt", "rgb24", "-"], capture_output=True, check=True).stdout
    frames = np.frombuffer(raw, np.uint8).reshape(-1, vh, vw, 3).astype(np.float32)
    half = vh // 2
    # a height-capped encode is compared after scaling the source to the encoded size
    scale = half / h
    amae, ap99, cmae = [], [], []
    for s, f in zip(src, frames):
        if abs(scale - 1) > 1e-6:
            s = np.asarray(Image.fromarray(s.astype(np.uint8), "RGBA").resize((round(w * scale), half),
                                                                               Image.Resampling.LANCZOS), np.float32)
        sh, sw = s.shape[:2]
        top, bot = f[:sh, :sw], f[half:half + sh, :sw]
        alpha = bot[..., 0]
        ea = np.abs(alpha - s[..., 3])
        amae.append(float(ea.mean()))
        ap99.append(float(np.percentile(ea, 99)))
        pm = s[..., :3] * (s[..., 3:4] / 255.0)
        cmae.append(float(np.abs(top - pm).mean()))
    rep = {"tool": "tools/video/stacked_alpha.sh", "mp4": a.mp4, "sourceFrames": len(src), "videoFrames": int(len(frames)),
           "videoSize": [vw, vh], "frameSize": [w, h], "alphaMAE": round(max(amae), 3), "alphaP99": round(max(ap99), 3),
           "colourMAE": round(max(cmae), 3)}
    rep["passed"] = (len(src) == len(frames) and rep["alphaMAE"] <= a.max_alpha_mae and rep["alphaP99"] <= a.max_alpha_p99
                     and rep["colourMAE"] <= a.max_colour_mae and vw % 2 == 0 and vh % 2 == 0)
    if a.report:
        Path(a.report).write_text(json.dumps(rep, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(rep))
    return 0 if rep["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
