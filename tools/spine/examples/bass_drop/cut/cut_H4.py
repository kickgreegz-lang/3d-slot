#!/usr/bin/env python3
"""sym_H4 Hot Sauce parts (ANIMATION_SET 2.4) from the approved rig master (sym_H4_rig 3432f2f5) and the c11 sheet
(sym_H4_parts 6a9d8342: its flame wisp):
  - cap: the cork as painted, cut along the glass rim's outline (it sits IN the rim at rest), with its hidden bottom
    edge inked; it pops 30 units at win_peak;
  - bottle: the rest of the master; under the cork it gets the rim's back half and the dark neck opening (the front
    rim mirrored to the back, the opening inside), so a popped cork shows an open bottle;
  - sauce: the band around the liquid's surface (the shoulder), cut from the master: a mesh whose surface rows ride
    three jelly-physics bones while its edges stay pinned to four anchor bones (top, bottom, both walls), so the
    painted meniscus sloshes inside the glass;
  - label: the parchment (outline-bounded region), with the sauce under it inpainted for its wobble;
  - fx_flame: the c11 flame wisp (keyed on its measured green, despilled), normal blend, alpha 0 at rest;
  - fx_glint, fx_glow: drawn here.
Writes art/source/spine/images/sym_H4/*.png, art/source/symbols/H4/parts.json and QA to build/qa/rigs/sym_H4/.

    tools/.venv/bin/python tools/spine/examples/bass_drop/cut/cut_H4.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
import cutlib as cl  # noqa: E402
from cut_H3 import interior_of  # noqa: E402  (fill sources)
from scipy import ndimage  # noqa: E402

R = cl.REPO
SRC = R / "art/source/symbols/H4"
IMG = R / "art/source/spine/images/sym_H4"
QA = R / "build/qa/rigs/sym_H4"
SHEET = R / "art/_raw/sym_H4_parts/v01/raw.png"
CONTENT = 285          # cellScale 0.95 x 300 (src/games/bass-drop/config.ts H4)

# master px (1024)
# the cork sits IN the glass rim: its region ends on the rim's upper edge (brown outlines: no outline-bounded cut here)
CORK = [(420, 95), (604, 95), (620, 110), (620, 178), (611, 186), (609, 205), (565, 212), (512, 215), (460, 212),
        (415, 205), (413, 186), (403, 178), (403, 110)]
LABEL_BOX = (340, 470, 690, 820)   # the parchment: light, low-saturation pixels, holes filled, grown over its outline
LABEL_OUTLINE = 8
SAUCE = [(430, 292), (582, 292), (642, 330), (682, 370), (695, 420), (698, 486), (324, 486), (327, 420), (340, 370), (380, 330)]
RIM_C = (512.0, 206.0)             # the glass rim's centre line (for the synthesized back half and the opening)
RIM_DEPTH, RIM_BACK = 58.0, 24.0   # the front rim's visible depth below the line, its foreshortened back above it
OPENING = (512.0, 204.0, 92.0, 17.0)
FLAME_SHEET_BOX = (2210, 110, 2545, 610)   # raw sheet px
FLAME_BASE, FLAME_H = (512.0, 206.0), 250.0  # the flame's base in the mouth, its height (master px)
GLINT_AT = (401.0, 432.0)
BONES = {"cap": (512, 160), "cap_tip": (512, 100), "label": (512, 648), "flame": FLAME_BASE,
         "sauce_1": (398, 356), "sauce_2": (510, 350), "sauce_3": (622, 356),
         "top_a": (432, 296), "top_b": (580, 296), "bot_a": (330, 482), "bot_b": (694, 482),
         "wall_La": (342, 336), "wall_Lb": (326, 482), "wall_Ra": (650, 332), "wall_Rb": (697, 482)}


def label_mask(M):
    hsv = cv2.cvtColor((M[..., :3] * 255).astype(np.uint8), cv2.COLOR_RGB2HSV).astype(np.float32)
    lum = M[..., :3] @ np.array([0.299, 0.587, 0.114], np.float32)
    x0, y0, x1, y1 = LABEL_BOX
    parch = (lum > 0.55) & (hsv[..., 1] < 140) & (M[..., 3] > 0.5)
    box = np.zeros_like(parch)
    box[y0:y1, x0:x1] = True
    parch &= box
    n, lab, st, _ = cv2.connectedComponentsWithStats(parch.astype(np.uint8), 8)
    core = lab == 1 + np.argmax(st[1:, 4])
    core = cv2.morphologyEx(core.astype(np.uint8), cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15))) > 0
    core = ndimage.binary_fill_holes(core)
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * LABEL_OUTLINE + 1,) * 2)
    grown = cv2.dilate(core.astype(np.uint8), k).astype(np.float32)
    return cl.feather(grown, 0.7) * (M[..., 3] > 0.02)


def flame_piece():
    im = np.asarray(Image.open(SHEET).convert("RGB")).astype(np.float32) / 255
    x0, y0, x1, y1 = FLAME_SHEET_BOX
    crop = im[y0:y1, x0:x1]
    border = np.concatenate([im[:10].reshape(-1, 3), im[-10:].reshape(-1, 3)], 0)
    key = np.median(border, 0)
    d = np.sqrt(((crop - key) ** 2).sum(-1)) * 255
    a = np.clip((d - 60) / 60, 0, 1)
    rgb = crop.copy()
    # despill: green never above max(red, blue) at the edges
    lim = np.maximum(rgb[..., 0], rgb[..., 2])
    rgb[..., 1] = np.where(a < 1, np.minimum(rgb[..., 1], lim), rgb[..., 1])
    n, lab, st, _ = cv2.connectedComponentsWithStats((a > 0.5).astype(np.uint8), 8)
    big = 1 + np.argmax(st[1:, 4])
    keep = cv2.dilate((lab == big).astype(np.uint8), np.ones((7, 7), np.uint8)) > 0
    a = a * keep
    print(f"flame: sheet key #{''.join(f'{int(v * 255):02X}' for v in key)}, {int((a > 0.5).sum())} px")
    return np.concatenate([rgb, a[..., None]], -1).astype(np.float32)


def main() -> int:
    IMG.mkdir(parents=True, exist_ok=True)
    QA.mkdir(parents=True, exist_ok=True)
    M = cl.load(SRC / "master_rig_1024.png")
    shp = M.shape
    fit = cl.Fit.symbol(M, CONTENT)
    P = fit.pt

    cork_m = cl.poly(shp, CORK) * (M[..., 3] > 0.02)
    label_m = label_mask(M)
    # ------------------------------------------------------------------ cap: the cork, its hidden bottom edge inked
    cap = cl.layer(M, cork_m)
    yy = np.arange(shp[0])[:, None] + np.zeros((1, shp[1]))
    bottom_zone = (yy > 180).astype(np.float32)
    cap = cl.over(cl.stroke(cork_m, 6, where=bottom_zone, colour=(0.12, 0.06, 0.03)), cap)

    # ------------------------------------------------------------------ bottle, with the rim back + opening under the cork
    bottle = cl.layer(M, 1 - np.maximum(cork_m, label_m))
    under = (cork_m > 0.5)
    # the rim's back half: the visible front rim mirrored across the rim's centre line
    # the rim's back half: the visible front rim (RIM_C y .. +RIM_DEPTH px) mirrored, foreshortened into
    # RIM_BACK px above the centre line; above that the popped cork leaves open air
    d = RIM_C[1] - np.arange(shp[0])
    ys_src = np.clip(np.round(RIM_C[1] + d * (RIM_DEPTH / RIM_BACK)), 0, shp[0] - 1).astype(int)
    mir = M[ys_src]
    band = (d[:, None] >= 0) & (d[:, None] <= RIM_BACK)
    back = under & band & (mir[..., 3] > 0.5)
    bottle[..., :3] = np.where(back[..., None], mir[..., :3], bottle[..., :3])
    bottle[..., 3] = np.where(back, mir[..., 3], np.where(under & (d[:, None] > RIM_BACK), 0.0, bottle[..., 3]))
    low = under & (d[:, None] < 0)
    bottle[..., 3] = np.where(low, 1.0, bottle[..., 3])
    bottle = cl.inpaint_rgb(bottle, low.astype(np.float32), radius=9)
    op = cl.rot_ellipse(shp, *OPENING, 0)
    dark = np.array([0.16, 0.07, 0.03], np.float32)
    shade = np.clip((yy - (OPENING[1] - OPENING[3])) / (2 * OPENING[3]), 0, 1)[..., None]
    bottle[..., :3] = bottle[..., :3] * (1 - op[..., None]) + (dark * (0.6 + 0.8 * shade)) * op[..., None]
    bottle = cl.over(cl.stroke(op, 4, colour=(0.05, 0.02, 0.01)), bottle)
    bottle[..., 3] = np.where(op > 0, np.maximum(bottle[..., 3], op), bottle[..., 3])
    # under the label: the sauce continued (the label wobbles in bass_react)
    lab_hole = (label_m > 0.02)          # the whole footprint (its feathered edge too): no ghost label edge
    bottle[..., 3] = np.where(lab_hole, 1.0, bottle[..., 3])
    # sources: the dark-red sauce right around the label (not its brown outline, not the glass reflections)
    ring = cv2.dilate(lab_hole.astype(np.uint8), np.ones((81, 81), np.uint8)) > 0
    red = (M[..., 0] > 2.2 * M[..., 1]) & (M[..., 0] > M[..., 2] + 0.1) & (M[..., 3] > 0.9)
    known = ring & ~cv2.dilate(lab_hole.astype(np.uint8), np.ones((7, 7), np.uint8)).astype(bool) & red
    bottle = cl.inpaint_rgb(bottle, lab_hole.astype(np.float32), radius=6, known=known)

    # ------------------------------------------------------------------ sauce band (same pixels as the bottle under it)
    sauce_m = cl.poly(shp, SAUCE)
    sauce = cl.layer(M, sauce_m)
    label = cl.layer(M, label_m)

    parts, canv = [], {}

    def add(name, lay, **kw):
        c = cl.despeckle(fit.canvas(lay))
        img, bbox = cl.trim(c, 3)
        cl.save(img, IMG / f"{name}.png")
        canv[name] = cl.paste((fit.H, fit.W), img, bbox)
        parts.append(dict({"name": name, "bbox": bbox}, **kw))
        return bbox

    rnd = lambda xy: [round(xy[0], 1), round(xy[1], 1)]
    gc = (180.0, 185.0)
    glow = cl.glow_disc(330, (1.0, 0.35, 0.15), alpha=0.8)
    cl.save(glow, IMG / "glow.png")
    parts.append({"name": "glow", "slot": "fx_glow", "bbox": place(glow, gc), "z": 0, "bone": "fx_glow",
                  "blend": "additive", "color": "ffffff00", "joint": list(gc)})
    add("bottle", bottle, z=1, bone="body")
    add("sauce", sauce, z=2, bone="body")                  # weighted mesh: anchors + phys_sauce_1..3
    add("label", label, z=3, bone="label")
    # flame: base at the mouth, upright, behind the cork
    fp = flame_piece()
    ph, pw = fp.shape[:2]
    s = FLAME_H / ph
    fl = cl.piece_to_master(fp, (pw / 2, ph * 0.97), (pw / 2, 0.0), FLAME_BASE, (FLAME_BASE[0], FLAME_BASE[1] - FLAME_H * 0.97), shp)
    fade = np.clip((FLAME_BASE[1] + 4 - (np.arange(shp[0])[:, None] + 0.5)) / 40.0, 0, 1)   # emerges from the opening
    fl[..., 3] *= fade
    add("flame", fl, z=3.5, bone="flame", slot="fx_flame", color="ffffff00")
    add("cap", cap, z=4, bone="cap")
    glint = cl.star_glint(80)
    gp = P(*GLINT_AT)
    cl.save(glint, IMG / "glint.png")
    parts.append({"name": "glint", "slot": "fx_glint", "bbox": place(glint, gp), "z": 5, "bone": "fx_glint",
                  "blend": "additive", "color": "ffffff00", "joint": rnd(gp)})

    comment = ("sym_H4 parts (ANIMATION_SET 2.4): cork / label outline-bounded cuts and the sauce band of "
               "art/source/symbols/H4/master_rig_1024.png (sym_H4_rig 3432f2f5), bottle with the rim back / neck opening "
               "synthesized under the cork; flame wisp from the c11 sheet (sym_H4_parts 6a9d8342); "
               "tools/spine/examples/bass_drop/cut/cut_H4.py. Canvas 360 @2x, content 285 (cellScale 0.95).")
    pj = cl.write_parts(SRC, "H4", parts, comment=comment, blur=["bottle", "sauce", "label", "cap"])

    ref = fit.canvas(M)
    rest = [canv["bottle"], canv["sauce"], canv["label"], canv["cap"]]
    met, comp = cl.reassembly(rest, ref)
    pts = {k: rnd(P(*v)) for k, v in BONES.items()}
    json.dump({"reassembly": met, "fit": {"s": fit.s, "ox": fit.ox, "oy": fit.oy}, "keypoints": pts}, open(QA / "cut.json", "w"), indent=1)
    print("keypoints (canvas):", json.dumps(pts))
    cl.preview(rest, QA / "rest.png")
    cl.preview([canv["bottle"]], QA / "bottle_alone.png")
    cl.preview([canv["bottle"], canv["sauce"], canv["label"], canv["flame"], cl.paste((360, 360), cl.crop(canv["cap"], [0, 0, 360, 360]), [0, -30, 360, 360])], QA / "popped.png")
    cl.preview([canv["cap"], canv["label"], canv["sauce"]], QA / "cap_label_sauce.png")
    print(f"cut_H4: {len(parts)} parts -> {pj}; reassembly {met}")
    return 0


def place(img: np.ndarray, centre) -> list:
    h, w = img.shape[:2]
    return [int(round(centre[0] - w / 2)), int(round(centre[1] - h / 2)), w, h]


if __name__ == "__main__":
    sys.exit(main())
