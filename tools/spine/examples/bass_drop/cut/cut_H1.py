#!/usr/bin/env python3
"""sym_H1 Golden Boombox parts (ANIMATION_SET 2.1) from the approved rig master and the c11 part sheet:
  - body, speaker_L, speaker_R, cassette_door, handle: cut from art/source/symbols/H1/master_rig_1024.png
    (sym_H1_rig ae6053be), so the rest pose reassembles to the master exactly. The body under each speaker is a
    shadowed recess (a speaker that dips below scale 1 shows its cavity, not a hole) and the body under the door is
    the empty dark tape well (the door flips open in `win`);
  - the handle is cut above its post sockets: its bone runs along the socket line, so its squash / stretch / shear
    never lift a post out of the body;
  - antenna: the telescopic antenna of the c11 sheet (sym_H1_parts 58680e7f; the master has none, ANIMATION_SET
    lists one with stiff physics), mounted behind the body's top-right corner;
  - fx_glint (additive star) and fx_glow (additive warm halo): drawn here.
Writes art/source/spine/images/sym_H1/*.png, art/source/symbols/H1/parts.json and QA to build/qa/rigs/sym_H1/.

    tools/.venv/bin/python tools/spine/examples/bass_drop/cut/cut_H1.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import cv2
import numpy as np

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
import cutlib as cl  # noqa: E402

R = cl.REPO
SRC = R / "art/source/symbols/H1"
IMG = R / "art/source/spine/images/sym_H1"
QA = R / "build/qa/rigs/sym_H1"
SHEET = R / "art/_work/rigs/split/H1/cut/sheet_rgba.png"   # tools/split cut of art/_raw/sym_H1_parts/v01 (key #03FC04)
CONTENT = 291          # cellScale 0.97 x 300 (src/games/bass-drop/config.ts H1)

# master px (1024 master), measured: bezel ellipses by ray casting from the cone (cv2.fitEllipse), door frame corners
SPK_L = (383.0, 690.1, 135.1, 168.9, 6.6)
SPK_R = (848.4, 579.3, 109.8, 147.8, 1.8)
DOOR = [(546.7, 521.7), (723.3, 491.7), (723.3, 626.7), (546.7, 663.3)]
# handle: everything above the post sockets (left post cut at y 298, right post at y 225)
HANDLE = [(150, 60), (885, 50), (885, 225), (793, 225), (793, 206), (700, 206), (700, 214), (244, 214), (244, 298), (167, 298), (167, 250), (150, 250)]
SOCKET_L, SOCKET_R = (205.0, 298.0), (825.0, 225.0)
# antenna: base hidden behind the top-right corner, leaning 9 degrees right
ANT_BASE, ANT_TIP = (922.0, 290.0), (964.0, 24.0)
ANT_SHEET_BBOX = (190, 80, 580, 460)        # sheet px (component 1 of the cut)
GLINT_AT = (296.0, 566.0)                   # the left bezel's upper-left highlight


def main() -> int:
    IMG.mkdir(parents=True, exist_ok=True)
    QA.mkdir(parents=True, exist_ok=True)
    M = cl.load(SRC / "master_rig_1024.png")
    shp = M.shape
    fit = cl.Fit.symbol(M, CONTENT)
    P = fit.pt

    spkL = cl.rot_ellipse(shp, *SPK_L[:4], SPK_L[4], grow=1.5)
    spkR = cl.rot_ellipse(shp, *SPK_R[:4], SPK_R[4], grow=1.5)
    door = cl.poly(shp, cl.grow_poly(DOOR, 2.0))
    handle = cl.poly(shp, HANDLE)

    # ------------------------------------------------------------------ body with the hidden areas filled
    body = cl.layer(M, 1 - handle)
    for m in (spkL, spkR):
        # the speaker cavity: the speaker's own pixels, blurred and darkened (a recess in shadow)
        rec = cl.blur_rgb(M, 5.0)
        k = (m > 0.02)[..., None]
        body[..., :3] = np.where(k, rec[..., :3] * 0.32, body[..., :3])
    well = cl.blur_rgb(M, 7.0)
    yy = np.mgrid[0:shp[0], 0:shp[1]][0].astype(np.float32)
    top = min(p[1] for p in DOOR)
    grad = np.clip((yy - top) / 170.0, 0, 1)[..., None]          # darker at the top of the tape well
    wk = (door > 0.02)[..., None]
    body[..., :3] = np.where(wk, well[..., :3] * (0.16 + 0.22 * grad), body[..., :3])
    body = cl.over(cl.stroke(door, 5, colour=(0.03, 0.02, 0.01)), body)   # the well's rim line

    parts, canv = [], {}

    def add(name, lay, **kw):
        c = fit.canvas(lay)
        img, bbox = cl.trim(c, 3)
        cl.save(img, IMG / f"{name}.png")
        canv[name] = cl.paste((fit.H, fit.W), img, bbox)
        parts.append(dict({"name": name, "bbox": bbox}, **kw))
        return bbox

    rnd = lambda xy: [round(xy[0], 1), round(xy[1], 1)]
    # fx_glow (back), antenna (behind the body), body, door, speakers, handle, fx_glint (front)
    glow = cl.glow_disc(330, (1.0, 0.78, 0.3), alpha=0.8)
    gc = (180.0, 185.0)
    cl.save(glow, IMG / "glow.png")
    parts.append({"name": "glow", "slot": "fx_glow", "bbox": place(glow, gc), "z": 0, "bone": "fx_glow",
                  "blend": "additive", "color": "ffffff00", "joint": list(gc)})

    sheet = cl.load(SHEET)
    x0, y0, x1, y1 = ANT_SHEET_BBOX
    piece = sheet[y0:y1, x0:x1].copy()
    lab_n, lab = cv2.connectedComponents((piece[..., 3] > 0.5).astype(np.uint8), 8)
    big = np.argmax([(lab == i).sum() if i else 0 for i in range(lab_n)])
    piece[..., 3] *= cv2.dilate((lab == big).astype(np.uint8), np.ones((5, 5), np.uint8)).astype(np.float32)
    c, ax, lo, hi = cl.principal_axis(piece)
    e1, e2 = c + ax * lo, c + ax * hi
    base, tip = (e1, e2) if e1[1] > e2[1] else (e2, e1)                 # the base is the lower-right end
    ant = cl.piece_to_master(piece, base, tip, ANT_BASE, ANT_TIP, shp)
    add("antenna", ant, z=0.5, bone="body")                            # weighted mesh: phys_antenna_1..3

    add("body", body, z=1, bone="body")
    add("cassette_door", cl.layer(M, door), z=2, bone="cassette_door")
    add("speaker_L", cl.layer(M, spkL), z=2.1, bone="speaker_L")
    add("speaker_R", cl.layer(M, spkR), z=2.2, bone="speaker_R")
    add("handle", cl.layer(M, handle), z=3, bone="handle")

    glint = cl.star_glint(80)
    gp = P(*GLINT_AT)
    cl.save(glint, IMG / "glint.png")
    parts.append({"name": "glint", "slot": "fx_glint", "bbox": place(glint, gp), "z": 5, "bone": "fx_glint",
                  "blend": "additive", "color": "ffffff00", "joint": rnd(gp)})

    comment = ("sym_H1 parts (ANIMATION_SET 2.1): master-cut body / speakers / door / handle from "
               "art/source/symbols/H1/master_rig_1024.png (sym_H1_rig ae6053be); antenna from the c11 sheet "
               "(sym_H1_parts 58680e7f); fx sprites drawn by tools/spine/examples/bass_drop/cut/cut_H1.py. "
               "Canvas 360 @2x, content 291 (cellScale 0.97).")
    pj = cl.write_parts(SRC, "H1", parts, comment=comment,
                        blur=["body", "speaker_L", "speaker_R", "cassette_door", "handle"])

    ref = fit.canvas(M)
    rest = [canv["body"], canv["cassette_door"], canv["speaker_L"], canv["speaker_R"], canv["handle"]]
    met, _ = cl.reassembly(rest, ref)
    keys = {"spk_L": SPK_L[:2], "spk_R": SPK_R[:2], "door_hinge": ((DOOR[3][0] + DOOR[2][0]) / 2, (DOOR[3][1] + DOOR[2][1]) / 2),
            "door_hinge_R": DOOR[2], "socket_L": SOCKET_L, "socket_R": SOCKET_R, "ant_base": ANT_BASE, "ant_tip": ANT_TIP,
            "ant_body_top": (930.0, 250.0), "glint": GLINT_AT}
    pts = {k: rnd(P(*v)) for k, v in keys.items()}
    json.dump({"reassembly": met, "fit": {"s": fit.s, "ox": fit.ox, "oy": fit.oy}, "keypoints": pts}, open(QA / "cut.json", "w"), indent=1)
    print("keypoints (canvas):", pts)
    cl.preview([canv["antenna"], canv["body"], canv["cassette_door"], canv["speaker_L"], canv["speaker_R"], canv["handle"]], QA / "rest.png")
    cl.preview([canv["antenna"], canv["body"]], QA / "body_alone.png")
    print(f"cut_H1: {len(parts)} parts -> {pj}; reassembly (without the added antenna) {met}")
    return 0


def place(img: np.ndarray, centre) -> list:
    h, w = img.shape[:2]
    return [int(round(centre[0] - w / 2)), int(round(centre[1] - h / 2)), w, h]


if __name__ == "__main__":
    sys.exit(main())
