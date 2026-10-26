#!/usr/bin/env python3
"""sym_W Bandit Mask parts, cut from the approved master (art/source/magpie-heist/symbols/W/master_1024.png, row
mh.symbols.w.master_1024.*):
  - mask:    the black satin domino mask with its gold trim (eye holes stay transparent), in front of everything;
  - tie_L / tie_R: the ribbon ties at the mask's sides (meshes on a 2-bone flutter chain each); each continues a few px
             under the mask edge and under the banner, so a fluttering tie never shows a cut;
  - banner:  the cream ribbon banner with its gold borders (a grid mesh on three bones: a slight wave), continued up
             under the mask's bottom edge; the word WILD is NOT baked: the runtime mounts live text in `txt_wild`;
  - lid_L:   the mask's own left eye (viewer's right) closed: the eye hole filled with satin and a gold closed-eye
             arch, hidden at rest (the `win` wink);
  - fx:      `sheen_1..6` (a light band sweeping across the satin) + `glint` (a star glint on the left eye's trim), all
             attachments of the normal-blend slot fx_sheen on the mask bone; `glow` (additive halo, fx_glow).
Writes art/source/magpie-heist/spine/images/sym_W/*.png, art/source/magpie-heist/symbols/W/parts.json, QA in
build/qa/rigs/mh_sym_W/ (cut.json also carries `txt_wild`: the live text's centre on the canvas).

    tools/.venv/bin/python tools/mhart/rigs/cut_W.py
"""
from __future__ import annotations

import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
import mhcut as mc  # noqa: E402

cl = mc.cl

# master px (2048)
# the mask's outer outline seen from each tie (tie | mask), top to bottom, x at y
TIE_L_CUT = [(400, 560), (397, 700), (395, 800), (393, 880), (392, 950), (405, 1050), (415, 1120), (430, 1170)]
TIE_R_CUT = [(1648, 560), (1650, 700), (1654, 800), (1655, 880), (1652, 950), (1637, 1050), (1620, 1120), (1610, 1170)]
TIE_BOTTOM = 1166            # the banner tails' top outline starts below this
# mask | banner: just under the mask's bottom outline (the banner's back strip shows below it at the sides)
MASK_BOTTOM = [(330, 1172), (450, 1184), (520, 1191), (600, 1198), (680, 1191), (800, 1172), (1022, 1120), (1250, 1172),
               (1370, 1191), (1450, 1198), (1530, 1191), (1600, 1184), (1720, 1172)]
UNDER = 22                   # px a part continues under the part in front of it
TEXT_CENTRE = (1025, 1442)   # the banner face's optical centre (live WILD)


def side_mask(shape, cut, left: bool) -> np.ndarray:
    """True on the tie's side of a top-to-bottom polyline (x as a function of y)."""
    h, w = shape[:2]
    ys = np.array([p[1] for p in cut], float)
    xs = np.array([p[0] for p in cut], float)
    xb = np.interp(np.arange(h) + 0.5, ys, xs)
    X = np.arange(w)[None, :] + 0.5
    return (X < xb[:, None]) if left else (X > xb[:, None])


def main() -> int:
    R = mc.Rig("W")
    M, shp = R.M, R.shape
    H, S, V, A = R.H, R.S, R.V, R.alpha
    sil = A > 0.02
    yy = np.arange(shp[0])[:, None] + np.zeros((1, shp[1]))
    below_mask = cl.curve_below(shp, MASK_BOTTOM) > 0.5
    side_l = side_mask(shp, TIE_L_CUT, True)
    side_r = side_mask(shp, TIE_R_CUT, False)
    tie_l_vis = side_l & (yy < TIE_BOTTOM) & ~below_mask
    tie_r_vis = side_r & (yy < TIE_BOTTOM) & ~below_mask
    mask_vis = ~below_mask & ~side_l & ~side_r
    banner_vis = ~tie_l_vis & ~tie_r_vis & ~mask_vis

    # each part continues UNDER the part in front of it, over that part's dark outline only (never its gold trim):
    # a fluttering tie or a mask squash shows ink there, not a gap and not a doubled trim
    ink = mc.shrink(A > 0.99, 2) & (V < 0.22)
    near = lambda m: mc.grow(m, UNDER)  # noqa: E731
    tie_l = tie_l_vis | (near(tie_l_vis) & ink & (mask_vis | banner_vis))
    tie_r = tie_r_vis | (near(tie_r_vis) & ink & (mask_vis | banner_vis))
    banner = banner_vis | (near(banner_vis) & ink & mask_vis & (yy > 1100))

    # ---------------------------------------------------------------- eye holes (enclosed transparent areas in the mask)
    holes = []
    for c in mc.components((A < 0.5) & ~below_mask, 8000):
        x, y, w, h = c["bbox"]
        if x > 0 and y > 0 and x + w < shp[1] - 1 and y + h < shp[0] - 1 and c["cy"] < 1050:
            holes.append(c)
    holes = sorted(holes, key=lambda c: c["cx"])[:2]
    if len(holes) != 2:
        raise SystemExit(f"cut_W: expected 2 eye holes, found {len(holes)}")
    eye_l = holes[1]           # the mask's own LEFT eye = the viewer's right
    lid = make_lid(M, eye_l["mask"])

    # ---------------------------------------------------------------- satin (for the sheen) and the eye glint
    satin = mask_vis & sil & (S < 0.35) & (V < 0.75) & ~(mc.hue_in(H, 25, 60) & (S > 0.3))
    satin = mc.shrink(mc.close(satin, 3), 4)

    # ---------------------------------------------------------------- write the parts (back to front)
    gc = R.pt(1022, 960)
    R.add_sprite("glow", mc.ring_glow(360, (1.0, 0.8, 0.3), alpha=0.9, r0=0.66, width=0.24), gc, scale=2, slot="fx_glow", z=0, bone="fx_glow",
                 blend="additive", color="ffffff00")
    R.add("tie_L", cl.layer(M, tie_l.astype(np.float32)), z=1, bone="mask")      # mesh: tie_L + phys_tie_*_L
    R.add("tie_R", cl.layer(M, tie_r.astype(np.float32)), z=1.1, bone="mask")
    R.add("banner", cl.layer(M, banner.astype(np.float32)), z=2, bone="banner")  # mesh: banner_L / banner / banner_R
    R.add("mask", cl.layer(M, mask_vis.astype(np.float32)), z=3, bone="mask")
    R.add("lid_L", lid, despeckle=0, z=4, bone="lid_L", color="ffffff00")
    satin_c = R.to_canvas(cl.layer(M, satin.astype(np.float32)))[..., 3]
    for i, fr in enumerate(mc.sheen_frames(R.canv["mask"], 6, angle=58, width=10.0, strength=0.55, rgb=(0.85, 0.92, 1.0),
                                           travel=(-0.1, 1.1), mask=satin_c), 1):
        R.add_canvas(f"sheen_{i}", fr, pad=2, z=5, bone="mask", slot="fx_sheen", **({"hidden": True} if i == 1 else {}))
    # star glint on the upper-left of the left (viewer's) eye trim
    eye_v = holes[0]
    gx, gy = eye_v["bbox"][0] + eye_v["bbox"][2] * 0.22, eye_v["bbox"][1] - 12
    R.add_sprite("glint", mc.star_glint(64, (1.0, 0.95, 0.75)), R.pt(gx, gy), z=5, bone="mask", slot="fx_sheen")

    tl = R.pt(*TEXT_CENTRE)
    ex, ey, ew, eh = eye_l["bbox"]
    kp = {"mask_centre": (1022, 800), "mask_bottom": (1022, 1150), "lid_top": (ex + ew / 2, ey + 4),
          "lid_bottom": (ex + ew / 2, ey + eh), "eye_glint": (gx, gy),
          "tie_L_knot": (378, 780), "tie_L_mid": (285, 935), "tie_L_end": (215, 1100), "tie_L_end2": (325, 1150),
          "tie_R_knot": (1668, 780), "tie_R_mid": (1765, 935), "tie_R_end": (1835, 1100), "tie_R_end2": (1725, 1150),
          "banner_centre": (1025, 1440), "banner_L": (300, 1360), "banner_Lin": (560, 1420), "banner_Rin": (1490, 1420),
          "banner_R": (1750, 1360), "text": TEXT_CENTRE}
    comment = ("sym_W Bandit Mask parts: master-cut mask / tie_L / tie_R / banner from "
               "art/source/magpie-heist/symbols/W/master_1024.png (ties and banner continued under the mask); lid_L (the "
               "wink) and the fx sprites (sheen_1..6, glint, glow: a halo ring, so the eye holes stay dark) drawn by tools/mhart/rigs/cut_W.py. The word WILD is "
               "live text (slot txt_wild). Canvas 360 @2x, content = cellScale 1.04 x 300.")
    R.finish(comment, rest=["tie_L", "tie_R", "banner", "mask"], blur=["tie_L", "tie_R", "banner", "mask"],
             keypoints=kp, extra={"txt_wild": [round(tl[0], 1), round(tl[1], 1)]},
             previews={"ties": ["tie_L", "tie_R"], "banner_alone": ["banner"], "mask_alone": ["mask"],
                       "wink": ["tie_L", "tie_R", "banner", "mask", "lid_L"],
                       "sheen_3": ["tie_L", "tie_R", "banner", "mask", "sheen_3"],
                       "glint": ["tie_L", "tie_R", "banner", "mask", "glint"]})
    return 0


def make_lid(M: np.ndarray, hole: np.ndarray) -> np.ndarray:
    """The closed eye: the hole (grown under the trim's inner outline) filled with satin, a gold arch across it."""
    shp = M.shape
    lid_m = mc.grow(hole, 7)
    ys, xs = np.nonzero(hole)
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    yy = np.arange(shp[0])[:, None] + np.zeros((1, shp[1]))
    t = np.clip((yy - y0) / max(1, y1 - y0), 0, 1)
    lid = np.zeros(shp[:2] + (4,), np.float32)
    top, bot = np.array([0.30, 0.30, 0.36]), np.array([0.07, 0.07, 0.09])
    lid[..., :3] = top * (1 - t[..., None]) + bot * t[..., None]
    lid[..., 3] = cl.feather(lid_m.astype(np.float32), 0.8)
    # gold closed-eye arch (a happy "^"), ink outline around it
    ss = 4
    im = Image.new("L", (shp[1] // ss * ss, shp[0] // ss * ss), 0)
    cx, cy = (x0 + x1) / 2, y0 + (y1 - y0) * 0.62
    w2, hh = (x1 - x0) * 0.40, (y1 - y0) * 0.30
    pts = [(cx + w2 * u, cy - hh * (1 - u * u)) for u in np.linspace(-1, 1, 41)]
    d = ImageDraw.Draw(im)
    d.line(pts, fill=255, width=22, joint="curve")
    for p in (pts[0], pts[-1]):
        d.ellipse([p[0] - 11, p[1] - 11, p[0] + 11, p[1] + 11], fill=255)
    gold = np.asarray(im, np.float32)[: shp[0], : shp[1]] / 255.0
    gold = np.pad(gold, ((0, shp[0] - gold.shape[0]), (0, shp[1] - gold.shape[1])))
    ink = cl.feather(mc.grow(gold > 0.5, 7).astype(np.float32), 0.8)
    lid = cl.over(np.concatenate([np.zeros(shp[:2] + (3,), np.float32) + 0.02, (ink * lid[..., 3])[..., None]], -1), lid)
    g = cl.feather((gold > 0.5).astype(np.float32), 0.8)
    gy = np.clip((yy - (cy - hh)) / max(1.0, hh * 1.4), 0, 1)[..., None]
    gold_rgb = np.array([1.0, 0.86, 0.42]) * (1 - gy) + np.array([0.78, 0.5, 0.16]) * gy
    lid = cl.over(np.concatenate([gold_rgb.astype(np.float32), (g * lid[..., 3])[..., None]], -1), lid)
    return lid


if __name__ == "__main__":
    sys.exit(main())
