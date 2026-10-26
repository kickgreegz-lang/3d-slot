#!/usr/bin/env python3
"""sym_R Shooting Star parts, cut from the approved master (art/source/magpie-heist/symbols/R/master_1024.png, row
mh.symbols.r.master_1024.*):
  - star:    the plump gold star with its rim and outline (one region on bone `star`: it spins in `win`);
  - tail:    the three comet ribbons (violet / teal / white) with their outlines, one alpha-traced mesh on a 3-link
             rotate-physics chain; the ribbons continue under the star's edge (extended from their own colours), so
             a whipping tail or a spinning star never opens a gap;
  - fx (drawn here, additive, root fx bones): `glow` (warm halo), `rays` (a 10-ray sun-burst: a loop may turn it by
             36 deg seamlessly), `rim` (an electric outline glow of the star's silhouette, the anticipation charge),
             `spark_1..3` (jagged electric arcs around the star, flicker frames), `twinkle` (4-point twinkles, two slots).
Writes art/source/magpie-heist/spine/images/sym_R/*.png, art/source/magpie-heist/symbols/R/parts.json, QA in
build/qa/rigs/mh_sym_R/.

    tools/.venv/bin/python tools/mhart/rigs/cut_R.py
"""
from __future__ import annotations

import math
import sys
from pathlib import Path

import numpy as np
from scipy import ndimage

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
import mhcut as mc  # noqa: E402

cl = mc.cl

TAIL_REGION = (820, 940)     # the tail lives at x < 820, y > 940 (master px)
UNDER = 70                   # px the ribbons continue under the star's edge
OUTLINE_BIAS = 16            # shared outline pixels go to the star (it is in front) unless clearly the tail's


def main() -> int:
    R = mc.Rig("R")
    M, shp = R.M, R.shape
    H, S, V, A = R.H, R.S, R.V, R.alpha
    sil = A > 0.02
    yy, xx = np.mgrid[0:shp[0], 0:shp[1]]
    reg = (xx < TAIL_REGION[0]) & (yy > TAIL_REGION[1])
    a = A > 0.5
    ribbon = a & reg & ((mc.hue_in(H, 255, 320) & (S > 0.25) & (V > 0.3)) |
                        (mc.hue_in(H, 140, 186) & (S > 0.25) & (V > 0.3)) |
                        ((S < 0.3) & (V > 0.7) & ~(mc.hue_in(H, 180, 235) & (S > 0.12))))
    # the star's light-blue rim line runs along the ribbons' top: never part of the tail
    rim_line = mc.grow(a & mc.hue_in(H, 180, 235) & (S > 0.12) & (V > 0.6) & (yy < 1120), 2)
    ribbon = ndimage.binary_fill_holes(mc.close(ribbon & ~rim_line, 6)) & ~rim_line
    ribbon = mc.keep_components(ribbon, 5000)
    rim_px = a & ~ribbon & mc.hue_in(H, 186, 230) & (S > 0.2) & (V > 0.5)      # the star's light-blue rim line
    starc = mc.keep_components(a & ~ribbon & mc.hue_in(H, 10, 62) & (S > 0.3) & (V > 0.3), 1500) | rim_px
    d_t, d_s = mc.dist_to(ribbon), mc.dist_to(starc)
    other = sil & ~ribbon & ~starc
    tail_vis = (ribbon | (other & (d_t + OUTLINE_BIAS < d_s))) & reg
    tail_vis = mc.keep_components(tail_vis, 5000)
    star_vis = sil & ~tail_vis

    # ---------------------------------------------------------------- the ribbons continue under the star
    tail = cl.layer(M, tail_vis.astype(np.float32))
    ys, xs = np.nonzero(ribbon & (xx > 680))
    under = mc.grow(ribbon, UNDER) & star_vis & (A > 0.99) & reg
    under &= (yy >= ys.min()) & (yy <= ys.max() + 20)
    tail[..., 3] = np.where(under, 1.0, tail[..., 3])
    tail = mc.fill_from(tail, under, tail_vis & mc.shrink(tail_vis, 1), sigma=1.5)
    # the extension takes the nearest pixel of the visible tail (ribbon colours AND their black edges)

    # ---------------------------------------------------------------- canvas parts (back to front)
    star_layer = cl.layer(M, star_vis.astype(np.float32))
    ys, xs = np.nonzero(starc)
    sc_m = (float(xs.mean()), float(ys.mean()))              # the star's centroid (master px): its spin pivot
    sc = R.pt(*sc_m)
    R.add_sprite("glow", mc.radial_glow(340, (1.0, 0.82, 0.3), alpha=0.85), (sc[0], sc[1] + 6), scale=2, slot="fx_glow", z=0,
                 bone="fx_glow", blend="additive", color="ffffff00")
    R.add_sprite("rays", mc.ray_burst(380, 10, (1.0, 0.92, 0.55), inner=0.2, width=0.45, alpha=0.9), sc, scale=2, slot="fx_rays",
                 z=0.5, bone="fx_rays", blend="additive", color="ffffff00")
    R.add("tail", tail, z=1, bone="tail")                 # mesh: tail + phys_tail_1..3
    R.add("star", star_layer, z=2, bone="star")
    star_c = R.canv["star"]
    rim = mc.rim_glow(star_c[..., 3], 7.0, (0.55, 0.95, 1.0), inside=0.5, strength=1.0)
    R.add_canvas("rim", rim, pad=2, z=3, slot="fx_rim", bone="fx_rim", blend="additive", color="ffffff00",
                 joint=[round(sc[0], 1), round(sc[1], 1)])
    # electric arcs hugging the star's outline: 3 flicker frames, each with 3 arcs at different points of the rim
    sil_c = star_c[..., 3] > 0.5
    edge_pts = boundary_points(sil_c, 8.0)
    rng = np.random.default_rng(11)
    for k in range(3):
        lay = np.zeros((mc.CANVAS, mc.CANVAS, 4), np.float32)
        picks = rng.choice(len(edge_pts), 3, replace=False)
        for j, i in enumerate(picks):
            (px, py), (nx, ny) = edge_pts[i]
            ang = math.degrees(math.atan2(-nx, ny)) + rng.uniform(-25, 25)   # along the edge
            b = mc.bolt(96, seed=31 + 7 * k + j, rgb=(0.55, 0.95, 1.0), segments=6, width=4.4, spread=0.7,
                        angle=ang, length=0.85)
            cx, cy = px + nx * 10, py + ny * 10
            lay = cl.over(cl.paste((mc.CANVAS, mc.CANVAS), b, mc.place(b, (cx, cy))), lay)
        R.add_canvas(f"spark_{k + 1}", lay, pad=2, z=4, slot="fx_spark", bone="fx_spark", blend="additive",
                     color="ffffff00", joint=[round(sc[0], 1), round(sc[1], 1)])
    tw = mc.twinkle(64, (1.0, 0.95, 0.7))
    R.add_sprite("twinkle", tw, (70.0, 70.0), slot="fx_twinkle_1", z=5, bone="fx_twinkle_1", blend="additive",
                 color="ffffff00")
    # the second twinkle slot shows the same image (bdgen `clone`), on its own bone (lower right)
    kp = {"star_centre": sc_m, "star_top": (1090, 300), "tail_root": (735, 1265), "tail_1": (600, 1310),
          "tail_2": (470, 1420), "tail_3": (400, 1580), "tail_end": (380, 1750)}
    comment = ("sym_R Shooting Star parts: master-cut star / tail from art/source/magpie-heist/symbols/R/master_1024.png "
               "(the ribbons continued under the star's edge); fx sprites (glow, rays, rim, spark_1..3, twinkle) drawn by "
               "tools/mhart/rigs/cut_R.py. Canvas 360 @2x, content = cellScale 1.06 x 300.")
    R.finish(comment, rest=["tail", "star"], blur=["tail", "star"], keypoints=kp,
             previews={"tail_alone": ["tail"], "star_alone": ["star"], "charged": ["rays", "tail", "star", "rim", "spark_1"],
                       "sparks": ["tail", "star", "spark_1", "spark_2", "spark_3"]})
    return 0


def boundary_points(sil: np.ndarray, step: float):
    """[((x, y), (nx, ny))] along the silhouette's outer contour every `step` px, with the outward normal."""
    import cv2
    cs, _ = cv2.findContours(sil.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    c = max(cs, key=len)[:, 0, :].astype(float)
    out = []
    n = len(c)
    k = max(1, int(step))
    for i in range(0, n, k):
        p0, p1 = c[(i - 3) % n], c[(i + 3) % n]
        tx, ty = p1 - p0
        L = math.hypot(tx, ty) or 1.0
        nx, ny = ty / L, -tx / L
        q = c[i] + np.array([nx, ny]) * 3
        if 0 <= int(q[1]) < sil.shape[0] and 0 <= int(q[0]) < sil.shape[1] and sil[int(q[1]), int(q[0])]:
            nx, ny = -nx, -ny
        out.append(((c[i][0], c[i][1]), (nx, ny)))
    return out


if __name__ == "__main__":
    sys.exit(main())
