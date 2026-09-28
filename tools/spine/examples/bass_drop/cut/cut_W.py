#!/usr/bin/env python3
"""sym_W parts (ANIMATION_SET 2.6) from the approved masters:
  - tooth, cap (+ chain, one weighted mesh): cut from art/source/symbols/W/master_rig_1024.png (sym_W_rig);
    the tooth top hidden under the cap is inpainted so the cap can fly off in `explode`;
  - ribbon, badge_t1..t5, clamps / clamps_open: the approved sym_W_pieces cuts (art/source/symbols/W/pieces);
    the two clamps are ONE image (left + mirrored right) so one slot carries both, weighted to clamp_L / clamp_R;
  - fx_glow slot attachments glow / trail_streak / ring and the tooth_cracked explode variant: drawn here.
Writes art/source/spine/images/sym_W/*.png, art/source/symbols/W/parts.json and QA to build/qa/rigs/sym_W/.

    tools/.venv/bin/python tools/spine/examples/bass_drop/cut/cut_W.py
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
import cutlib as cl  # noqa: E402

R = cl.REPO
SRC = R / "art/source/symbols/W"
IMG = R / "art/source/spine/images/sym_W"
QA = R / "build/qa/rigs/sym_W"
CONTENT = 306          # cellScale 1.02 x 300 (src/games/bass-drop/config.ts W)

# cap / tooth boundary in master px (drawn along the lower side of the cap's bottom outline, left to right)
CAP_BOTTOM = [(300, 452), (330, 440), (348, 410), (378, 392), (415, 382), (452, 376), (470, 395), (500, 416),
              (540, 432), (580, 438), (620, 436), (655, 424), (685, 404), (700, 392), (725, 398), (765, 418),
              (800, 440), (830, 465), (848, 490), (880, 505)]
# the cap band's top ellipse (cx, cy, rx, ry): the chain is everything above its upper arc
CAP_TOP = (597, 282, 263, 96)
# hidden tooth top under the cap: the tooth continues ~45 px up inside the cap socket
HIDDEN_TOP = [(364, 452), (364, 408), (400, 376), (455, 350), (590, 345), (700, 360), (790, 392), (826, 430), (826, 476)]


def main() -> int:
    IMG.mkdir(parents=True, exist_ok=True)
    QA.mkdir(parents=True, exist_ok=True)
    M = cl.load(SRC / "master_rig_1024.png")
    shp = M.shape
    fit = cl.Fit.symbol(M, CONTENT)
    sil = M[..., 3]

    below = cl.curve_below(shp, CAP_BOTTOM)
    cap_cover = (1 - below)
    tooth_vis = below
    hidden = cl.poly(shp, HIDDEN_TOP) * (1 - below)

    # tooth: visible pixels + the inpainted socket (opaque, under the cap)
    tooth = cl.layer(M, tooth_vis)
    tooth_full = tooth.copy()
    tooth_full[..., 3] = np.maximum(tooth[..., 3], hidden)
    # socket fill: extrude each column's colour from 14 px below the cap boundary straight up (the rims and the
    # teal bands of the fang are near-vertical there), then close the top with the formula-D outline
    ys = np.interp(np.arange(shp[1]) + 0.5, [p[0] for p in CAP_BOTTOM], [p[1] for p in CAP_BOTTOM])
    src_rows = np.clip(np.round(ys + 14).astype(int), 0, shp[0] - 1)
    col_rgb = M[src_rows, np.arange(shp[1]), :3]
    hm = hidden > 0.02
    yy, xx = np.nonzero(hm)
    tooth_full[yy, xx, :3] = col_rgb[xx]
    shade = np.clip((ys[None, :] - np.arange(shp[0])[:, None]) / 60.0, 0, 1)[..., None] * 0.35   # darker deeper in the socket
    tooth_full[..., :3] = np.where(hm[..., None], tooth_full[..., :3] * (1 - shade), tooth_full[..., :3])
    top_edge = cl.stroke(cl.poly(shp, HIDDEN_TOP), 9, where=(1 - below))
    tooth_full = cl.over(top_edge, tooth_full)
    # chain: everything of the cap cover above the band's top ellipse (and right of the band)
    yy_, xx_ = np.mgrid[0:shp[0], 0:shp[1]] + 0.5
    ex, ey, erx, ery = CAP_TOP
    # the silhouette's outer outline hugs the band ~22 px thick: it stays with the cap
    inside = ((xx_ - ex) / (erx + 24)) ** 2 + ((yy_ - ey) / (ery + 24)) ** 2 <= 1.0
    upper = (yy_ < ey) & ~inside & (np.abs(xx_ - ex) <= erx)
    right = (xx_ > ex + erx) & (yy_ < 335)
    chain_cover = cl.feather((upper | right).astype(np.float32), 0.6) * cap_cover
    chain = cl.layer(M, chain_cover)
    cap = cl.layer(M, cap_cover * (1 - chain_cover))

    parts = []
    canv = {}

    def add(name, lay, **kw):
        c = fit.canvas(lay)
        img, bbox = cl.trim(c, 3)
        cl.save(img, IMG / f"{name}.png")
        canv[name] = cl.paste((fit.H, fit.W), img, bbox)
        parts.append(dict({"name": name, "bbox": bbox}, **kw))
        return bbox

    P = fit.pt  # master px -> canvas
    # ---------------------------------------------------------------- fx_glow slot (additive, alpha 0 at setup)
    glow = radial_glow(300, (0.21, 0.95, 0.88))
    gb = place(glow, (180, 184))
    cl.save(glow, IMG / "glow.png")
    parts.append({"name": "glow", "slot": "fx_glow", "bbox": gb, "z": 0, "bone": "fx_glow", "blend": "additive",
                  "color": "ffffff00"})
    trail = streak(170, 320, (0.6, 1.0, 0.96))
    tb = place(trail, (180, 70))
    cl.save(trail, IMG / "trail_streak.png")
    parts.append({"name": "trail_streak", "slot": "fx_glow", "bbox": tb, "z": 0, "bone": "fx_glow"})
    ring = ring_img(230, 16, (0.75, 1.0, 0.97))
    rb = place(ring, (180, 184))
    cl.save(ring, IMG / "ring.png")
    parts.append({"name": "ring", "slot": "fx_glow", "bbox": rb, "z": 0, "bone": "fx_glow"})

    # ---------------------------------------------------------------- tooth (mesh) with the WILD ribbon baked in
    # (8-slot budget of the current contract: the ribbon is static on the tooth, so it shares its slot; the
    #  live WILD text still has its own empty txt_wild slot on top)
    rib = cl.load(SRC / "pieces/ribbon.png")
    rib_img = resize_straight(rib, RIBBON_W / rib.shape[1])
    rib_c = P(*RIBBON_AT)
    rbb = place(rib_img, rib_c)
    cl.save(rib_img, QA / "ribbon_piece.png")
    rib_canvas = cl.paste((360, 360), rib_img, rbb)
    tooth_c = cl.over(rib_canvas, fit.canvas(tooth_full))
    img, tbb = cl.trim(tooth_c, 3)
    cl.save(img, IMG / "tooth.png")
    canv["tooth"] = cl.paste((360, 360), img, tbb)
    tj, tt = P(590, 430), P(250, 790)
    # slot bone `body`: the mesh is weighted to tooth / tooth_tip, and the tooth is the body (it cracks and
    # fades in place in `explode` instead of being scattered like a loose part)
    parts.append({"name": "tooth", "bbox": tbb, "z": 2, "bone": "body"})
    cm = fit.canvas(np.concatenate([np.zeros(shp[:2] + (3,), np.float32), crack_mask(tooth_full)[..., None]], -1))[..., 3]
    cracked = tooth_c.copy()
    dark = np.array([0.03, 0.05, 0.08], np.float32)
    cracked[..., :3] = cracked[..., :3] * (1 - cm[..., None]) + dark * cm[..., None]
    edge = np.clip(np.roll(cm, (-1, -1), (0, 1)) - cm, 0, 1) * (tooth_c[..., 3] > 0.5)
    cracked[..., :3] = np.clip(cracked[..., :3] + edge[..., None] * 0.5, 0, 1)
    cl.save(cl.crop(cracked, tbb), IMG / "tooth_cracked.png")
    parts.append({"name": "tooth_cracked", "slot": "tooth", "bbox": tbb, "z": 2, "bone": "body"})
    canv["ribbon_face"] = rib_c

    # ---------------------------------------------------------------- chain (mesh, behind the cap) and cap
    add("chain", chain, z=1, bone="phys_chain_1")
    cj = P(595, 330)
    add("cap", cap, z=3, bone="cap")

    # ---------------------------------------------------------------- clamps (skin sticky): one image, two islands
    for name, src in (("clamps", "clamp.png"), ("clamps_open", "clamp_open.png")):
        cp = cl.load(SRC / "pieces" / src)
        cp = np.rot90(cp, k=-1).copy()          # opening faces right (toward the tooth) for the left clamp
        s = 84.0 / cp.shape[0]
        left = resize_straight(cp, s)
        right = left[:, ::-1].copy()
        gap = CLAMP_GAP
        W2 = left.shape[1] * 2 + gap
        both = np.zeros((left.shape[0], W2, 4), np.float32)
        both[:, :left.shape[1]] = left
        both[:, left.shape[1] + gap:] = right
        cb = place(both, (CLAMP_CX, CLAMP_CY))
        cl.save(both, IMG / f"{name}.png")
        parts.append({"name": name, "slot": "clamps", "bbox": cb, "z": 6, "bone": "body"})   # weighted to clamp_L / clamp_R
        print(f"{name}: left clamp centre x {cb[0] + left.shape[1] / 2:.1f}, right {cb[0] + cb[2] - left.shape[1] / 2:.1f}, y {CLAMP_CY}")
        if name == "clamps":
            canv["clamps"] = cl.paste((360, 360), both, cb)
    # ---------------------------------------------------------------- badge tiers (skins mult / sticky)
    t3 = cl.load(SRC / "pieces/badge_t3.png")
    s_badge = 192.0 / t3.shape[1]
    plate_h = None
    for t in range(1, 6):
        b = cl.load(SRC / f"pieces/badge_t{t}.png")
        bi = resize_straight(b, s_badge)
        if plate_h is None:
            plate_h = bi.shape[0]
        # all tiers share the plate centre (t5 carries its flame crown above the plate)
        cx, cy = 180.0, 180.0 + 129.0
        top = cy - plate_h / 2 - (bi.shape[0] - plate_h)
        bb = [int(round(cx - bi.shape[1] / 2)), int(round(top)), bi.shape[1], bi.shape[0]]
        cl.save(bi, IMG / f"badge_t{t}.png")
        parts.append({"name": f"badge_t{t}", "slot": "badge", "bbox": bb, "z": 7, "bone": "badge"})

    # blur variants (drop_fall/spin): tooth, cap, ribbon via tools/spine/make_blur.py after parts.json
    comment = ("sym_W parts: master-cut from art/source/symbols/W/master_rig_1024.png (sym_W_rig 7f0557f2) + the "
               "sym_W_pieces cuts (ribbon, badge tiers, clamps); fx sprites drawn by "
               "tools/spine/examples/bass_drop/cut/cut_W.py. Canvas 360 @2x, content 306 (cellScale 1.02).")
    pj = cl.write_parts(SRC, "W", parts, comment=comment)

    # reassembly: rest pose (default skin: fx alpha 0, no badge, no clamps) vs the master on the canvas
    ref = fit.canvas(M)
    rest = [canv["chain"], fit.canvas(tooth_full), canv["cap"]]   # without the added ribbon
    met, comp = cl.reassembly(rest, ref)
    pts = {k: [round(v, 1) for v in P(*xy)] for k, xy in KEYPOINTS.items()}
    json.dump({"reassembly": met, "fit": {"s": fit.s, "ox": fit.ox, "oy": fit.oy}, "keypoints": pts}, open(QA / "cut.json", "w"), indent=1)
    print("keypoints (canvas):", pts)
    cl.preview([canv["chain"], canv["tooth"], canv["cap"]], QA / "rest_default.png")
    cl.preview([canv["chain"], canv["tooth"], canv["cap"], canv["clamps"], cl.paste((360, 360), cl.load(IMG / "badge_t3.png"),
                next(p["bbox"] for p in parts if p["name"] == "badge_t3"))], QA / "rest_sticky.png")
    cl.preview([canv["tooth"]], QA / "tooth_alone.png")
    cl.preview([canv["chain"]], QA / "chain_alone.png")
    cl.preview([canv["cap"]], QA / "cap_alone.png")
    print(f"cut_W: {len(parts)} parts -> {pj}; reassembly {met}")
    return 0


CLAMP_GAP = 133
RIBBON_W = 206.0
RIBBON_AT = (578, 612)
# master px landmarks printed in canvas units for rig.yaml (chain physics chain, tooth tip, ribbon face)
KEYPOINTS = {"chain_ring": (560, 178), "chain_apex": (690, 88), "chain_knee": (822, 150), "chain_end": (866, 300),
             "tooth_socket": (590, 430), "tooth_mid": (560, 650), "tooth_bend": (420, 790), "tooth_tip": (165, 700),
             "cap_centre": (595, 330), "ribbon_face": (578, 600), "content_bottom": (520, 952)}
CLAMP_CX, CLAMP_CY = 202.5, 196.0


def resize_straight(img: np.ndarray, s: float) -> np.ndarray:
    h, w = img.shape[:2]
    nw, nh = max(1, round(w * s)), max(1, round(h * s))
    prem = img.copy()
    prem[..., :3] *= prem[..., 3:4]
    ch = [np.asarray(Image.fromarray(prem[..., c], "F").resize((nw, nh), Image.LANCZOS)) for c in range(4)]
    out = np.clip(np.stack(ch, -1), 0, 1)
    a = out[..., 3:4]
    out[..., :3] = np.where(a > 1e-5, out[..., :3] / np.maximum(a, 1e-5), 0)
    out[..., 3] = np.where(out[..., 3] < 3 / 255, 0, out[..., 3])
    pad = 3
    o = np.zeros((nh + 2 * pad, nw + 2 * pad, 4), np.float32)
    o[pad:-pad, pad:-pad] = out
    return o


def place(img: np.ndarray, centre) -> list:
    h, w = img.shape[:2]
    return [int(round(centre[0] - w / 2)), int(round(centre[1] - h / 2)), w, h]


def radial_glow(d: int, rgb) -> np.ndarray:
    y, x = np.mgrid[0:d, 0:d] + 0.5
    r = np.hypot(x - d / 2, y - d / 2) / (d / 2)
    a = np.clip(1 - r, 0, 1) ** 2.2
    out = np.zeros((d, d, 4), np.float32)
    out[..., :3] = rgb
    out[..., 3] = a * 0.85
    return out


def streak(w: int, h: int, rgb) -> np.ndarray:
    """Speed streak above the wild (it falls DOWN, the trail is above): bright at the bottom, fading up."""
    y, x = np.mgrid[0:h, 0:w] + 0.5
    u = (x - w / 2) / (w / 2)
    v = y / h                      # 0 top .. 1 bottom
    core = np.clip(1 - np.abs(u) / (0.25 + 0.75 * v), 0, 1) ** 1.6
    a = core * np.clip(v, 0, 1) ** 1.4 * np.clip((1 - v) * 6, 0, 1)
    out = np.zeros((h, w, 4), np.float32)
    out[..., :3] = rgb
    out[..., 3] = np.clip(a * 1.35, 0, 1)
    return out


def ring_img(d: int, width: float, rgb) -> np.ndarray:
    y, x = np.mgrid[0:d, 0:d] + 0.5
    r = np.hypot(x - d / 2, y - d / 2)
    R0 = d / 2 - width - 2
    a = np.exp(-((r - R0) / (width / 2.2)) ** 2)
    inner = np.clip((R0 - r) / (R0 * 0.8), 0, 1)
    a = np.maximum(a, 0.18 * (1 - inner) * (r < R0))
    out = np.zeros((d, d, 4), np.float32)
    out[..., :3] = rgb
    out[..., 3] = np.clip(a, 0, 1)
    return out


def crack_mask(lay: np.ndarray, seed: int = 7) -> np.ndarray:
    rng = np.random.default_rng(seed)
    h, w = lay.shape[:2]
    from PIL import ImageDraw
    im = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(im)
    ox, oy = 585, 600
    for ang in (-150, -95, -40, 20, 75, 140):
        x, y = ox, oy
        a = math.radians(ang)
        for _ in range(7):
            a += rng.uniform(-0.45, 0.45)
            L = rng.uniform(40, 75)
            nx, ny = x + math.cos(a) * L, y + math.sin(a) * L
            d.line([(x, y), (nx, ny)], fill=255, width=11)
            x, y = nx, ny
    return cl.feather(np.asarray(im, dtype=np.float32) / 255.0, 1.2) * (lay[..., 3] > 0.5)


def crack(lay: np.ndarray, seed: int = 7) -> np.ndarray:
    """The tooth with dark crack lines (explode f2 swap): a few jagged lines from an impact point."""
    rng = np.random.default_rng(seed)
    h, w = lay.shape[:2]
    im = Image.new("L", (w, h), 0)
    from PIL import ImageDraw
    d = ImageDraw.Draw(im)
    ox, oy = 585, 600
    for ang in (-150, -95, -40, 20, 75, 140):
        x, y = ox, oy
        a = math.radians(ang)
        for _ in range(7):
            a += rng.uniform(-0.45, 0.45)
            L = rng.uniform(40, 75)
            nx, ny = x + math.cos(a) * L, y + math.sin(a) * L
            d.line([(x, y), (nx, ny)], fill=255, width=9)
            x, y = nx, ny
    m = np.asarray(im, dtype=np.float32) / 255.0
    m = cl.feather(m, 1.2) * (lay[..., 3] > 0.5)
    out = lay.copy()
    dark = np.array([0.03, 0.05, 0.08], np.float32)
    out[..., :3] = out[..., :3] * (1 - m[..., None]) + dark * m[..., None]
    # a thin light edge on one side of each crack (formula D: lit from the upper left)
    edge = np.clip(np.roll(m, (-3, -3), (0, 1)) - m, 0, 1) * (lay[..., 3] > 0.5)
    out[..., :3] = np.clip(out[..., :3] + edge[..., None] * 0.45, 0, 1)
    return out


if __name__ == "__main__":
    sys.exit(main())
