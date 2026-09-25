#!/usr/bin/env python3
"""Blur and glow variants of a canvas-fitted symbol (360x360 @2x RGBA, straight alpha).

  python tools/matte/variants.py build/pack/symbols{tps}/sym_H1.png --symbol H1
      -> sym_H1_blur.png + sym_H1_glow.png next to the input (or --out-dir)

blur  vertical motion blur IN SCREEN SPACE: the runtime rotates the symbol by restAngle, so the
      smear is applied in the rotated frame and rotated back (same recipe as the runtime's
      placeholder derivation, src/assets/placeholder/variants.ts: squash 0.97 x 1.12, 7 weighted
      ghost copies at +-{4.5,9,14} design px, light vertical blur). --blur-mode box gives the
      docs/PIPELINE.md ffmpeg recipe instead (avgblur sizeY=14 @2x).
glow  soft WHITE silhouette (the runtime tints it with the symbol colour, additive): alpha
      dilated 7 px, Gaussian sigma 14 px, radial fade to zero before the canvas edge.
Both stay on the same canvas and anchor as the static texture. Exit codes: 0 ok, 2 usage.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "gen"))
import mattelib as ml  # noqa: E402
import provenance as prov  # noqa: E402

TOOL = "tools/matte/variants.py"
TAPS = [-14, -9, -4.5, 0, 4.5, 9, 14]           # design px (runtime makeBlur)
WEIGHTS = [0.18, 0.3, 0.5, 1, 0.5, 0.3, 0.18]


def load_rgba(path) -> tuple[np.ndarray, np.ndarray]:
    a = np.asarray(Image.open(path).convert("RGBA"), np.float32) / 255.0
    return a[..., :3], a[..., 3]


def _affine(ch: np.ndarray, angle_deg: float, sx: float = 1.0, sy: float = 1.0, dy: float = 0.0) -> np.ndarray:
    """Rotate (screen-space degrees, clockwise positive like Pixi) + scale about the centre, then
    shift by dy; bilinear, zero outside."""
    h, w = ch.shape
    c = np.array([(h - 1) / 2, (w - 1) / 2])
    t = math.radians(angle_deg)
    # output (y, x) -> input: inverse of  out = R * S * (in - c) + c + (dy, 0)
    R = np.array([[math.cos(t), math.sin(t)], [-math.sin(t), math.cos(t)]])   # rows (y, x), y-down clockwise
    M = R @ np.diag([sy, sx])
    Minv = np.linalg.inv(M)
    offset = c - Minv @ (c + np.array([dy, 0.0]))
    return ndi.affine_transform(ch, Minv, offset=offset, order=1, mode="constant", cval=0.0)


def blur_variant(rgb, alpha, rest_angle: float, mode: str = "runtime", scale2x: float = 2.0):
    """Premultiplied motion blur in the rotated (screen) frame; returns straight rgb, alpha."""
    size = alpha.shape[0]
    big = int(math.ceil(size * 1.45))
    pad = (big - size) // 2
    pm = np.dstack([rgb * alpha[..., None], alpha])
    pm = np.pad(pm, ((pad, pad), (pad, pad), (0, 0)))
    rot = np.dstack([_affine(pm[..., c], rest_angle) for c in range(4)])
    if mode == "runtime":
        acc = np.zeros_like(rot)
        for dy, wgt in zip(TAPS, WEIGHTS):   # 'over' compositing in child order, like the runtime
            layer = np.dstack([_affine(rot[..., c], 0.0, sx=0.97, sy=1.12, dy=dy * scale2x) for c in range(4)]) * wgt
            acc = layer + acc * (1 - layer[..., 3:4])
        acc = ndi.gaussian_filter1d(acc, sigma=2.5 * scale2x, axis=0)
    elif mode == "box":
        r = int(round(7 * scale2x))          # avgblur sizeY=14 @2x -> 29-tap box
        acc = ndi.uniform_filter1d(rot, size=2 * r + 1, axis=0, mode="constant")
    else:
        raise ValueError(f"unknown blur mode {mode}")
    back = np.dstack([_affine(acc[..., c], -rest_angle) for c in range(4)])
    back = back[pad:pad + size, pad:pad + size]
    a = np.clip(back[..., 3], 0, 1)
    a[a < 1 / 512] = 0
    col = np.where(a[..., None] > 1e-4, np.clip(np.minimum(back[..., :3], a[..., None]) / np.maximum(a[..., None], 1e-4), 0, 1), 0)
    return ml.bleed(col, a > 0), a


def glow_variant(alpha, dilate: float = 7.0, sigma: float = 14.0, r0: float = 0.36, r1: float = 0.5):
    size = alpha.shape[0]
    d = ndi.distance_transform_edt(alpha < 0.5)
    sil = np.clip(dilate + 0.5 - d, 0, 1)            # anti-aliased dilated silhouette
    g = ndi.gaussian_filter(sil, sigma=sigma)
    yy, xx = np.mgrid[0:size, 0:size]
    r = np.hypot(xx - (size - 1) / 2, yy - (size - 1) / 2) / size
    u = np.clip((r - r0) / (r1 - r0), 0, 1)
    g *= 1 - u * u * (3 - 2 * u)                   # smoothstep fade: never a square clip
    g = np.clip(g, 0, 1)
    g[g < 1 / 512] = 0
    return np.ones(g.shape + (3,), np.float32), g.astype(np.float32)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("src", help="canvas-fitted static symbol (RGBA)")
    ap.add_argument("--out-dir", help="default: next to the input")
    ap.add_argument("--name", help="output stem (default: input stem) -> <name>_blur.png, <name>_glow.png")
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--symbol", help="read restAngle from src/games/$GAME/config.ts")
    g.add_argument("--rest-angle", type=float, help="degrees (runtime rotation; negative = counter-clockwise)")
    ap.add_argument("--only", choices=["blur", "glow"], help="write just one variant")
    ap.add_argument("--blur-mode", choices=["runtime", "box"], default="runtime")
    ap.add_argument("--glow-dilate", type=float, default=7.0, help="px @2x (runtime: 3.5 design px)")
    ap.add_argument("--glow-sigma", type=float, default=14.0, help="px @2x (docs/PIPELINE.md gblur sigma 14)")
    ap.add_argument("--qa-dir", help="default build/qa/matte/<name>/")
    ap.add_argument("--manifest", default="none", help="also append rows here (e.g. art/manifest.json)")
    ap.add_argument("--parent-id", action="append", default=[], help="row id(s) of the static symbol")
    ap.add_argument("--license-id", help="default: the parent's licenseId, else python-geometry")
    a = ap.parse_args(argv)
    try:
        src = Path(a.src)
        rgb, alpha = load_rgba(src)
        if alpha.shape[0] != alpha.shape[1]:
            raise ValueError(f"{src}: expected a square symbol canvas, got {alpha.shape[::-1]}")
        angle = a.rest_angle
        if a.symbol:
            t = ml.symbol_targets().get(a.symbol)
            if not t:
                raise ValueError(f"unknown symbol {a.symbol}")
            angle = t["restAngle"]
        angle = angle or 0.0
        name = a.name or src.stem
        out_dir = Path(a.out_dir) if a.out_dir else src.parent
        qa_dir = Path(a.qa_dir) if a.qa_dir else prov.REPO / "build" / "qa" / "matte" / name
        outs, rows, report = {}, [], {"tool": TOOL, "src": prov.rel(src), "restAngle": angle}
        if a.only in (None, "blur"):
            brgb, ba = blur_variant(rgb, alpha, angle, a.blur_mode)
            p = out_dir / f"{name}_blur.png"
            ml.save_rgba(p, brgb, ba)
            outs["blur"] = p
            ys = np.nonzero(ba.max(1) > 0.02)[0]
            ys0 = np.nonzero(alpha.max(1) > 0.02)[0]
            report["blur"] = {"mode": a.blur_mode, "alphaMass": round(float(ba.sum() / max(alpha.sum(), 1)), 4),
                              "extentPx": int(ys.max() - ys.min() + 1) if len(ys) else 0,
                              "staticExtentPx": int(ys0.max() - ys0.min() + 1) if len(ys0) else 0}
        if a.only in (None, "glow"):
            grgb, ga = glow_variant(alpha, a.glow_dilate, a.glow_sigma)
            p = out_dir / f"{name}_glow.png"
            ml.save_rgba(p, grgb, ga)
            outs["glow"] = p
            report["glow"] = {"peak": round(float(ga.max()), 4), "edgeMax": round(float(max(ga[0].max(), ga[-1].max(), ga[:, 0].max(), ga[:, -1].max())), 4)}
        qa_dir.mkdir(parents=True, exist_ok=True)
        (qa_dir / "variants.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        lic = a.license_id or prov.inherit_license(a.parent_id, manifest=prov.lookup_manifest(a.manifest), default="python-geometry")
        version = prov.digest_files(sorted(HERE.glob("*.py")), HERE)[:12]
        for kind, p in outs.items():
            digest = prov.sha256_file(p)
            rows.append(prov.make_row(
                id=prov.safe_id(name, kind, digest[:8]), path=p, stage="matting", sha256=digest, vendor="self",
                model=TOOL, version=version, license_id=lic, route="code", ref_hashes=[prov.sha256_file(src)],
                parents=a.parent_id, notes=f"{kind} variant, restAngle {angle}"))
        prov.record(rows, sidecar=qa_dir / "variants.manifest.json", manifest=a.manifest, generated_by=TOOL)
    except (ValueError, OSError) as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
    print(json.dumps({k: prov.rel(v) for k, v in outs.items()} | {"report": report}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
