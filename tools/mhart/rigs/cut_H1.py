#!/usr/bin/env python3
"""sym_H1 Jeweled Crown parts, cut from the approved master (art/source/magpie-heist/symbols/H1/master_1024.png, row
mh.symbols.h1.master_1024.*):
  - band:    the gold band with its gems and the crimson inside of the ring (everything below the band's top rim line);
  - points:  the five gold prongs + the valleys between them (one alpha-traced mesh weighted to the band rim and the
             five prong bones, so the prongs bend without seams); it continues a few px under the band, and under every
             pearl a rounded prong tip is painted (a pearl that flies off in `explode` leaves a finished prong);
  - pearls:  the five pearls with their outline rings, ONE slot drawn as a multi-island mesh (one quad per pearl,
             100 % weighted to its pearl bone: the pearls ride the prong tips and can fly off on their own);
  - velvet:  the crimson cap, filled behind the prongs (inpainted crimson + the dome's outline continued), so a
             bending prong reveals velvet, never a hole;
  - fx:      `gems_lit` (the gem stones lightened: the win_peak flash, normal blend on the band bone), `sheen_1..6`
             (a light band sweeping across the gold band, attachment frames on the band bone), `glint` (a star glint,
             additive, fx_glint) and `glow` (additive halo, fx_glow): drawn here.
Writes art/source/magpie-heist/spine/images/sym_H1/*.png, art/source/magpie-heist/symbols/H1/parts.json, QA in
build/qa/rigs/mh_sym_H1/.

    tools/.venv/bin/python tools/mhart/rigs/cut_H1.py
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
import mhcut as mc  # noqa: E402

cl = mc.cl

# master px (2048). The band's top rim line (just above its dark-brown top edge), left to right.
BAND_TOP = [(330, 1118), (400, 1112), (450, 1102), (550, 1088), (700, 1066), (850, 1046), (1000, 1031), (1025, 1030),
            (1150, 1033), (1300, 1048), (1450, 1074), (1550, 1092), (1640, 1106), (1720, 1118)]
UNDER = 26           # px the prongs and the velvet continue under the band
OUTLINE = 26         # the sticker outline's width (px)
# prong bases on the band rim (pivots) -> the pearls are the tips (measured: pearl components)
PRONG_BASE = {"1_L": (455, 1092), "2_L": (655, 1062), "mid": (1024, 1032), "2_R": (1393, 1062), "1_R": (1592, 1092)}


def main() -> int:
    R = mc.Rig("H1")
    M, shp = R.M, R.shape
    H, S, V, A = R.H, R.S, R.V, R.alpha
    sil = A > 0.5
    yy = np.arange(shp[0])[:, None] + np.zeros((1, shp[1]))
    below = cl.curve_below(shp, BAND_TOP)                     # 1 = band territory
    above_b = below < 0.5

    # ---------------------------------------------------------------- colour classes (above the band line)
    crimson = sil & mc.hue_in(H, 320, 15) & (S > 0.45) & (V > 0.2) & above_b
    crimson = mc.keep_components(crimson, 3000)
    pearl_px = sil & (S < 0.22) & (V > 0.62) & (yy < 950)
    pearls = []
    for c in mc.components(pearl_px, 15000)[:5]:
        r = float(np.sqrt(c["area"] / np.pi)) + 1.0
        pearls.append((c["cx"], c["cy"], r))
    if len(pearls) != 5:
        raise SystemExit(f"cut_H1: expected 5 pearls, found {len(pearls)}")
    pearls.sort(key=lambda p: p[0])
    names = ["1_L", "2_L", "mid", "2_R", "1_R"]
    disc = np.zeros(shp[:2], bool)
    for cx, cy, r in pearls:
        disc |= mc.ellipse(shp, cx, cy, r, r) > 0.5
    gold = sil & mc.hue_in(H, 18, 62) & (S > 0.3) & (V > 0.3) & ~disc
    dark = sil & ~crimson & ~gold & ~disc

    # outline pixels go to the class they outline: prongs win ties (they are in front of the velvet), pearls keep
    # their own ring
    d_crim, d_gold, d_pearl = mc.dist_to(crimson), mc.dist_to(gold), mc.dist_to(disc)
    to_pearl = dark & (d_pearl < OUTLINE + 8) & (d_pearl + 6 < d_gold) & (d_pearl < d_crim)
    to_velvet = dark & ~to_pearl & (d_crim + 14 < d_gold) & above_b
    pearl_isl = (disc | to_pearl) & sil
    velvet_vis = (crimson | to_velvet) & above_b
    velvet_vis = mc.close(velvet_vis, 2) & sil & ~pearl_isl

    # ---------------------------------------------------------------- velvet: visible + filled behind the prongs
    dome = mc.hull_mask(shp, crimson)
    dome_ring = mc.grow(dome, OUTLINE) & ~dome
    hidden = (mc.grow(dome, OUTLINE) & sil & ~velvet_vis) & (yy < np.interp(np.arange(shp[1]), [p[0] for p in BAND_TOP],
                                                                           [p[1] for p in BAND_TOP])[None, :] + UNDER)
    velvet = cl.layer(M, velvet_vis.astype(np.float32))
    fill_body = hidden & dome
    velvet[..., 3] = np.where(hidden, 1.0, velvet[..., 3])
    velvet = mc.fill_from(velvet, fill_body, mc.shrink(crimson, 2), sigma=10)
    ink = np.array([0.02, 0.012, 0.02], np.float32)
    ring_hidden = hidden & dome_ring
    velvet[..., :3] = np.where(ring_hidden[..., None], ink, velvet[..., :3])

    # ---------------------------------------------------------------- points (prongs): above the line, under pearls a tip
    points_vis = sil & above_b & ~velvet_vis & ~pearl_isl
    line_y = np.interp(np.arange(shp[1]), [p[0] for p in BAND_TOP], [p[1] for p in BAND_TOP])[None, :]
    ext = sil & (yy >= line_y) & (yy < line_y + UNDER) & mc.shrink(A > 0.99, 3)
    pts = cl.layer(M, (points_vis | ext).astype(np.float32))
    tips = np.zeros(shp[:2], bool)
    for (cx, cy, r) in pearls:
        tip = mc.ellipse(shp, cx, cy + r * 0.62, r * 0.36, r * 0.42) > 0.5
        tips |= tip & pearl_isl
    pts[..., 3] = np.where(tips, 1.0, pts[..., 3])
    pts = mc.fill_from(pts, tips, mc.shrink(gold, 3) & ~tips, sigma=4)
    pts = cl.over(cl.stroke(tips.astype(np.float32) * 1.0, 12, where=tips.astype(np.float32)), pts)

    # ---------------------------------------------------------------- band, pearls, gems
    band = cl.layer(M, below)
    pearl_layer = cl.layer(M, pearl_isl.astype(np.float32))
    gems = sil & ~above_b & ((mc.hue_in(H, 320, 20) & (S > 0.45)) | (mc.hue_in(H, 195, 255) & (S > 0.35))) & (yy < 1420)
    gems = mc.keep_components(mc.close(gems, 6), 2500)
    from scipy import ndimage
    gems = ndimage.binary_fill_holes(gems) & (V > 0.22)
    gems = mc.shrink(gems, 2)
    gems_lit = mc.lighten(cl.layer(M, cl.feather(gems.astype(np.float32), 1.2)), 0.45, white_core=0.08)
    # the sheen sweeps the gold face only (not the crimson inside of the ring, not the outline)
    face = sil & ~above_b & ~(mc.hue_in(H, 320, 15) & (S > 0.45) & (yy > 1400)) & (V > 0.28)
    face = mc.shrink(face, 3)

    # ---------------------------------------------------------------- write the parts (back to front)
    gc = R.pt(1024, 1080)
    R.add_sprite("glow", mc.radial_glow(330, (1.0, 0.78, 0.28), alpha=0.85), gc, scale=2, slot="fx_glow", z=0, bone="fx_glow",
                 blend="additive", color="ffffff00")
    R.add("velvet", velvet, z=1, bone="velvet")
    R.add("points", pts, z=2, bone="band")            # weighted mesh: band_rim + phys_prong_*
    R.add("pearls", pearl_layer, z=3, bone="band")    # island mesh: one quad per pearl -> pearl_* bones
    R.add("band", band, z=4, bone="band")
    R.add("gems_lit", gems_lit, despeckle=0, z=5, bone="band", slot="fx_gems", color="ffffff00")
    band_c = R.canv["band"]
    face_c = R.to_canvas(cl.layer(M, face.astype(np.float32)))[..., 3]
    for i, fr in enumerate(mc.sheen_frames(band_c, 6, angle=68, width=8.0, strength=0.8, travel=(-0.12, 1.12),
                                           mask=face_c), 1):
        R.add_canvas(f"sheen_{i}", fr, pad=2, z=6, bone="band", slot="fx_sheen", **({"hidden": True} if i == 1 else {}))
    ruby = R.pt(985, 1175)
    R.add_sprite("glint", mc.star_glint(72), ruby, slot="fx_glint", z=7, bone="fx_glint", blend="additive",
                 color="ffffff00")

    kp = {f"pearl_{n}": (p[0], p[1]) for n, p in zip(names, pearls)}
    kp.update({f"base_{n}": v for n, v in PRONG_BASE.items()})
    kp.update({"band_centre": (1024, 1300), "band_rim_L": (420, 1106), "band_rim_R": (1628, 1106),
               "velvet_base": (1024, 1060), "velvet_top": (1024, 640), "ruby": (985, 1175)})
    comment = ("sym_H1 Jeweled Crown parts: master-cut band / points (prongs) / pearls / velvet from "
               "art/source/magpie-heist/symbols/H1/master_1024.png; the velvet is filled behind the prongs, a prong tip is "
               "painted under each pearl; fx sprites (gems_lit, sheen_1..6, glint, glow) drawn by "
               "tools/mhart/rigs/cut_H1.py. Canvas 360 @2x, content = cellScale 0.97 x 300.")
    R.finish(comment, rest=["velvet", "points", "pearls", "band"], blur=["velvet", "points", "pearls", "band"],
             keypoints=kp, previews={
                 "velvet_alone": ["velvet"], "points_alone": ["points"], "pearls_alone": ["pearls"],
                 "band_alone": ["band"], "no_pearls": ["velvet", "points", "band"], "no_points": ["velvet", "band"],
                 "gems_flash": ["velvet", "points", "pearls", "band", "gems_lit"],
                 "sheen_3": ["velvet", "points", "pearls", "band", "sheen_3"]})
    return 0


if __name__ == "__main__":
    sys.exit(main())
