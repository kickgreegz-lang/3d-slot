#!/usr/bin/env python3
"""Mascot pre/post steps around tools/matte + tools/split (Bass Drop chr_gumbo / chr_croak).

  mirror  RAW OUT            flip a raw sheet left-right (Gumbo's masters came back facing screen-left;
                             the rig faces right, so every Gumbo raw is mirrored before the split)
  inkfix  RGBA_PNG... --key HEX [--band 6] [--dark 0.35] [--inplace | --out DIR]
                             Nano Banana tints the black outline toward the key (#20001E on magenta,
                             #000033 on blue). Despill the dark pixels inside a band along the alpha
                             edge (and the dark ink everywhere with --all-ink) so the halo gate reads 0.
  halo    RGBA_PNG... --key HEX   print the art-bible halo report (tools/matte mattelib.halo_report)

Run with tools/.venv/bin/python from the repo root.
"""
from __future__ import annotations
import argparse, json, sys
from pathlib import Path
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

REPO = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPO / "tools" / "matte"))
import mattelib as ml  # noqa: E402


def hex_rgb(h: str) -> np.ndarray:
    h = h.lstrip("#")
    return np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)], np.float32)


def load_rgba(p) -> tuple[np.ndarray, np.ndarray]:
    a = np.asarray(Image.open(p).convert("RGBA"), np.float32) / 255
    return a[..., :3].copy(), a[..., 3].copy()


def save_rgba(p, rgb, alpha):
    out = np.dstack([np.clip(rgb, 0, 1), np.clip(alpha, 0, 1)])
    Image.fromarray((out * 255 + 0.5).astype(np.uint8), "RGBA").save(p, optimize=True)


def inkfix(rgb, alpha, key, band=6, dark=0.35, all_ink=False):
    vis = alpha > 0
    near_edge = ndi.distance_transform_edt(vis) <= band
    luma = rgb @ np.array([0.299, 0.587, 0.114], np.float32)
    zone = vis & (luma < dark)
    if not all_ink:
        zone &= near_edge
    # the matte's own edge texels: despill every semi-transparent pixel too (unmixed ink)
    zone |= vis & (alpha < 1 - 1 / 255)
    out = ml.despill(rgb, key, mask=zone.astype(np.float32))
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    m = sub.add_parser("mirror"); m.add_argument("src"); m.add_argument("dst")
    f = sub.add_parser("inkfix"); f.add_argument("files", nargs="+"); f.add_argument("--key", required=True)
    f.add_argument("--band", type=int, default=6); f.add_argument("--dark", type=float, default=0.35)
    f.add_argument("--all-ink", action="store_true"); f.add_argument("--inplace", action="store_true")
    f.add_argument("--out")
    h = sub.add_parser("halo"); h.add_argument("files", nargs="+"); h.add_argument("--key", required=True)
    a = ap.parse_args()
    if a.cmd == "mirror":
        im = Image.open(a.src)
        Path(a.dst).parent.mkdir(parents=True, exist_ok=True)
        im.transpose(Image.FLIP_LEFT_RIGHT).save(a.dst)
        print(f"mirrored {a.src} -> {a.dst}")
        return 0
    key = hex_rgb(a.key)
    rep = {}
    for p in a.files:
        rgb, al = load_rgba(p)
        before = ml.halo_report(rgb, al, key)
        if a.cmd == "halo":
            rep[p] = before
            continue
        fixed = inkfix(rgb, al, key, a.band, a.dark, a.all_ink)
        after = ml.halo_report(fixed, al, key)
        dst = p if a.inplace else str(Path(a.out) / Path(p).name)
        Path(dst).parent.mkdir(parents=True, exist_ok=True)
        save_rgba(dst, fixed, al)
        rep[p] = {"before": before["keyTintedEdgePx"], "after": after["keyTintedEdgePx"], "out": dst}
    print(json.dumps(rep, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
