#!/usr/bin/env python3
"""Synthetic cel-shaded test art on a key colour, with exact ground-truth alpha.

Draws an art-bible-style object (bottle body + round head + a handle ring with an ENCLOSED
key-coloured opening, flat base + two hard-edged shadow tones + a white specular streak, plum
extrusion to the lower right, thick pure-black outline and thinner interior lines) at 4x
supersampling and box-downsamples it, so every edge is anti-aliased exactly like a render.

  python tools/matte/make_synthetic.py OUT_DIR --key 00FF00 [--size 768] [--slop] [--gap PX] [--palette warm|teal]
Writes OUT_DIR/{art.png (RGB), gt_alpha.png (L, coverage), gt.json (colours, geometry)}.
--slop adds what image models add despite the prompt: a soft cast shadow and a faint glow
OUTSIDE the outline (ground truth excludes them). --gap cuts the outline open by PX px.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi

PALETTES = {
    # base, shadow1, shadow2, specular, extrusion (art bible §4)
    "warm": ["#FF5A2A", "#C8361A", "#6B1608", "#FFFFFF", "#4B283D"],
    "teal": ["#35F2E0", "#1FA9A8", "#0B3B52", "#FFFFFF", "#4B283D"],
    "gold": ["#FFC629", "#E2861A", "#9A4A0C", "#FFFFFF", "#4B283D"],
}


def hexrgb(h: str) -> np.ndarray:
    h = h.lstrip("#")
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], np.float32)


def mask(size: int, draw_fn) -> np.ndarray:
    im = Image.new("L", (size, size), 0)
    draw_fn(ImageDraw.Draw(im))
    return np.asarray(im) > 127


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("out_dir")
    ap.add_argument("--key", default="00FF00")
    ap.add_argument("--size", type=int, default=768, help="output edge (px); drawn at 4x")
    ap.add_argument("--ss", type=int, default=4, help="supersampling factor")
    ap.add_argument("--palette", choices=sorted(PALETTES), default="warm")
    ap.add_argument("--slop", action="store_true", help="add a cast shadow + glow outside the outline")
    ap.add_argument("--gap", type=float, default=0, help="cut the outline open by this many output px")
    a = ap.parse_args(argv)
    S = a.size * a.ss
    u = S / 1000.0                                   # drawing unit (1/1000 of the canvas)
    key = hexrgb(a.key)
    base, sh1, sh2, spec, extr = (hexrgb(c) for c in PALETTES[a.palette])
    ink = np.zeros(3, np.float32)
    t_out = 26 * u                                   # outer outline ~3.5% of the object height
    t_in = 12 * u                                    # interior lines

    # body: bottle (rounded rect) + head (ellipse) + ring handle on the right (annulus)
    body = mask(S, lambda d: d.rounded_rectangle([330 * u, 330 * u, 630 * u, 820 * u], radius=90 * u, fill=255))
    body |= mask(S, lambda d: d.ellipse([360 * u, 170 * u, 600 * u, 400 * u], fill=255))
    ring_outer = mask(S, lambda d: d.ellipse([560 * u, 430 * u, 790 * u, 690 * u], fill=255))
    ring_inner = mask(S, lambda d: d.ellipse([625 * u, 500 * u, 725 * u, 620 * u], fill=255))
    body |= ring_outer & ~ring_inner
    hole = ring_inner
    # plum extrusion toward the lower right (6-10 design px -> ~2.5% here)
    e = int(round(22 * u))
    ext = np.zeros_like(body)
    for k in range(1, e + 1):
        ext[k:, k:] |= body[:-k, :-k]
    ext &= ~body
    ext &= ~hole
    sil = body | ext
    dist_out = ndi.distance_transform_edt(~sil)
    cover = sil | (dist_out <= t_out)                # outline = silhouette dilated by t_out
    cover &= ~(hole & (ndi.distance_transform_edt(hole) > t_out))   # the opening stays open
    if a.gap > 0:
        g = a.gap * a.ss
        yy, xx = np.mgrid[0:S, 0:S]
        # a thin wedge through the outline on the left of the bottle, down to the fill
        cut = (np.abs(yy - 600 * u) < g / 2) & (xx < 335 * u) & (xx > 280 * u)
        cover &= ~(cut & ~sil)
        body_cut = cut & body & (xx < 334 * u)
        cover &= ~body_cut

    img = np.empty((S, S, 3), np.float32)
    img[:] = key
    if a.slop:
        yy, xx = np.mgrid[0:S, 0:S]
        shadow = ((xx - 520 * u) / (260 * u)) ** 2 + ((yy - 900 * u) / (45 * u)) ** 2 < 1
        shadow = ndi.gaussian_filter(shadow.astype(np.float32), 12 * u) * 0.55
        img = img * (1 - shadow[..., None])
        d = ndi.distance_transform_edt(~cover)
        glow = np.clip(1 - d / (40 * u), 0, 1) * 0.35 * (d > 0)
        img = img * (1 - glow[..., None]) + 255 * glow[..., None]
    img[cover] = ink
    # cel shading inside the body: base, then two hard-edged shadow tones toward the lower right
    yy, xx = np.mgrid[0:S, 0:S]
    diag = (xx + yy) / S
    fill = body & (ndi.distance_transform_edt(body) > 0)
    colour = np.where((diag > 1.12)[..., None], sh1, base)
    colour = np.where((diag > 1.30)[..., None], sh2, colour)
    img[fill] = colour[fill]
    # specular streak (upper left) and interior lines (a label band + one groove)
    streak = mask(S, lambda d: d.rounded_rectangle([385 * u, 250 * u, 420 * u, 560 * u], radius=16 * u, fill=255))
    img[streak & body] = spec
    band = mask(S, lambda d: d.line([340 * u, 700 * u, 620 * u, 700 * u], fill=255, width=int(t_in)))
    img[band & body] = ink
    img[ext] = extr
    # outline over everything outside the fill (re-assert the ring edge and extrusion edge)
    edge = cover & ~sil
    img[edge] = ink
    inner_edge = sil & (ndi.distance_transform_edt(sil) <= t_in * 0.8) & ~body
    img[inner_edge] = ink

    # box-downsample: exact area coverage -> anti-aliased edges
    def down(x):
        x = x.reshape(a.size, a.ss, a.size, a.ss, *x.shape[2:])
        return x.mean(axis=(1, 3))

    rgb = np.clip(np.round(down(img)), 0, 255).astype(np.uint8)
    gt = np.clip(np.round(down(cover.astype(np.float32)) * 255), 0, 255).astype(np.uint8)
    out = Path(a.out_dir)
    out.mkdir(parents=True, exist_ok=True)
    Image.fromarray(rgb, "RGB").save(out / "art.png", optimize=False)
    Image.fromarray(gt, "L").save(out / "gt_alpha.png", optimize=False)
    (out / "gt.json").write_text(json.dumps({
        "key": "#" + a.key.lstrip("#").upper(), "size": a.size, "ss": a.ss, "palette": a.palette,
        "colours": {"base": PALETTES[a.palette][0], "extrusion": PALETTES[a.palette][4]},
        "baseProbe": [round(480 * u / a.ss), round(480 * u / a.ss)], "slop": a.slop, "gap": a.gap,
        "outlinePx": round(t_out / a.ss, 2)}, indent=2) + "\n")
    print(out / "art.png")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
