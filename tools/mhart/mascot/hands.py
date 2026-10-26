#!/usr/bin/env python3
"""Paint Monty's extra glove poses (fist, point) under the master's own glove cuff.

No part sheets exist for Monty (the design sheet only shows open hands), so the hand variants of the
master cut (art/source/magpie-heist/mascot/spine2d/cut.yaml `source: {sheet: hR_fist, ...}`) are
painted here, in MASTER px and in place: each variant is a cartoon glove drawn in the hand's own frame
(origin = the centre of the cuff's lower edge, +v toward the knuckles = toward the `hand_X` landmark,
+u across), 4x supersampled, with the master's colours (glove white, lavender shade, cyan rim, ink),
then the master's own cuff pixels are laid over its root, so every pose pivots at the same wrist and
wears the identical cuff. Output: art/_work/magpie-heist/mascot/hands/hand_<R|L>_<fist|point>.png
(master-size straight-alpha RGBA; mastercut reads them as pre-matted sheets) + a QA strip.

    tools/.venv/bin/python tools/mhart/mascot/hands.py [--qa build/qa/chr_monty/cut/hands.png]
"""
from __future__ import annotations

import argparse
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi

REPO = Path(__file__).resolve().parents[3]
MASTER = REPO / "art/source/magpie-heist/mascot/monty_static.png"
OUT = REPO / "art/_work/magpie-heist/mascot/hands"
SS = 4  # supersampling

# per hand: cuff lower-edge centre (master px), a point along the hand axis, which side of +u the thumb
# is on (+1 / -1), the cuff polygon taken from the master (outline included), glove half width at the cuff
HANDS = {
    "R": {"c": (88.6, 807.2), "tip": (60.0, 935.0), "thumb": 1, "hw": 35.5,
          "cuff": [[46, 770], [66, 755], [100, 752], [130, 760], [140, 784], [134, 812], [112, 822], [70, 822], [50, 812], [42, 792]]},
    "L": {"c": (751.5, 784.0), "tip": (808.0, 896.0), "thumb": -1, "hw": 34.0,
          "cuff": [[700, 756], [716, 738], [756, 736], [778, 746], [790, 772], [786, 800], [764, 812], [726, 808], [706, 796], [698, 776]]},
}
LIGHT = np.array([236, 236, 246], np.float32) / 255
MID = np.array([200, 196, 226], np.float32) / 255
SHADE = np.array([142, 132, 182], np.float32) / 255
RIM = np.array([176, 228, 236], np.float32) / 255
OW = 6.5  # outline width (master px), as the master glove


def catmull_closed(pts, n=14):
    P = np.asarray(pts, np.float64)
    m = len(P)
    out = []
    for i in range(m):
        p0, p1, p2, p3 = P[(i - 1) % m], P[i], P[(i + 1) % m], P[(i + 2) % m]
        for t in np.linspace(0, 1, n, endpoint=False):
            t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    return np.asarray(out)


class Frame:
    def __init__(self, h: dict):
        cx, cy = h["c"]
        tx, ty = h["tip"]
        L = math.hypot(tx - cx, ty - cy)
        self.v = np.array([(tx - cx) / L, (ty - cy) / L])
        self.u = np.array([self.v[1], -self.v[0]])
        self.c = np.array([cx, cy])
        self.s = float(h["thumb"])

    def P(self, u, v):
        """canonical (u toward the thumb, v toward the knuckles) -> master px"""
        return self.c + self.u * (u * self.s) + self.v * v


def poly_mask(pts_master, box, ss=SS):
    x0, y0, x1, y1 = box
    im = Image.new("L", ((x1 - x0) * ss, (y1 - y0) * ss), 0)
    ImageDraw.Draw(im).polygon([((x - x0) * ss, (y - y0) * ss) for x, y in pts_master], fill=255)
    return np.asarray(im, np.float32) / 255


def capsule_pts(F: Frame, a, b, r, n=24):
    """closed outline of a capsule from canonical a to b (radius r), in master px"""
    (ua, va), (ub, vb) = a, b
    d = np.array([ub - ua, vb - va], np.float64)
    L = np.hypot(*d)
    d /= L
    nrm = np.array([-d[1], d[0]])
    pts = []
    ang0 = math.atan2(nrm[1], nrm[0])
    for t in np.linspace(0, math.pi, n):
        a2 = ang0 + t
        pts.append((ub + r * math.cos(a2) * 1.0 + 0, vb + r * math.sin(a2)))
    # arc around b goes from +nrm to -nrm through +d; then around a from -nrm to +nrm through -d
    pts = []
    for t in np.linspace(-math.pi / 2, math.pi / 2, n):
        dirv = d * math.cos(t) + nrm * math.sin(t)
        pts.append((ub + r * dirv[0], vb + r * dirv[1]))
    for t in np.linspace(math.pi / 2, 3 * math.pi / 2, n):
        dirv = d * math.cos(t) + nrm * math.sin(t)
        pts.append((ua + r * dirv[0], va + r * dirv[1]))
    return [F.P(u, v) for u, v in pts]


def shade_fill(mask_ss, box, F: Frame, centre_uv, radius, light_dir, rim_side=None):
    """glove colour for every supersampled pixel: light -> lavender away from the light (screen space),
    darker toward the mask edge on the shadow side, a cyan rim on `rim_side` (screen-space unit vector)."""
    x0, y0, x1, y1 = box
    h, w = mask_ss.shape
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    X = x0 + (xx + 0.5) / SS
    Y = y0 + (yy + 0.5) / SS
    cx, cy = F.P(*centre_uv)
    dx, dy = (X - cx) / radius, (Y - cy) / radius
    t = np.clip(0.42 + 0.75 * (dx * light_dir[0] + dy * light_dir[1]), 0, 1)
    col = LIGHT[None, None, :] * (1 - t[..., None]) + MID[None, None, :] * t[..., None]
    t2 = np.clip((t - 0.5) / 0.5, 0, 1) ** 1.2
    col = col * (1 - 0.75 * t2[..., None]) + SHADE[None, None, :] * (0.75 * t2[..., None])
    inside = mask_ss > 0.5
    dist = ndi.distance_transform_edt(inside) / SS  # master px to the edge
    edge = np.clip(1 - dist / 7.0, 0, 1) * np.clip(t * 1.6 - 0.5, 0, 1)
    col = col * (1 - 0.45 * edge[..., None]) + SHADE[None, None, :] * (0.45 * edge[..., None])
    if rim_side is not None:
        rim = np.clip(1 - dist / 4.0, 0, 1) * np.clip(-(dx * rim_side[0] + dy * rim_side[1]) * 1.4 - 0.2, 0, 1)
        col = col * (1 - 0.7 * rim[..., None]) + RIM[None, None, :] * (0.7 * rim[..., None])
    return col


def stroke_mask(lines_master, box, width, taper=True):
    x0, y0, x1, y1 = box
    im = Image.new("L", ((x1 - x0) * SS, (y1 - y0) * SS), 0)
    d = ImageDraw.Draw(im)
    for pts in lines_master:
        n = len(pts)
        for i in range(n - 1):
            f = 1.0
            if taper:
                t0 = i / max(n - 2, 1)
                f = max(0.35, min(1.0, 4 * t0 * (1 - t0) + 0.35))
            ww = max(1, int(round(width * f * SS)))
            (ax, ay), (bx, by) = pts[i], pts[i + 1]
            d.line([((ax - x0) * SS, (ay - y0) * SS), ((bx - x0) * SS, (by - y0) * SS)], fill=255, width=ww)
            r = ww / 2
            d.ellipse([(bx - x0) * SS - r, (by - y0) * SS - r, (bx - x0) * SS + r, (by - y0) * SS + r], fill=255)
    return np.asarray(im, np.float32) / 255


def dilate_ss(m, px):
    if px <= 0:
        return m
    inside = m > 0.5
    d = ndi.distance_transform_edt(~inside) / SS
    return np.clip(px + 0.5 - d, 0, 1) * (d <= px + 0.5) + m * inside


def paint(side: str, kind: str, master_rgba: np.ndarray, ink: np.ndarray) -> np.ndarray:
    h = HANDS[side]
    F = Frame(h)
    hw = h["hw"] - OW  # interior half width at the cuff edge
    H, W = master_rgba.shape[:2]
    # working box around the hand (master px)
    c = F.c
    box = (int(c[0] - 150), int(c[1] - 70), int(c[0] + 150), int(c[1] + 200))
    box = (max(0, box[0]), max(0, box[1]), min(W, box[2]), min(H, box[3]))
    light = np.array([0.55, 0.83])  # light from the upper left (screen)
    light = light / np.hypot(*light)
    rim_side = np.array([-1.0, -0.2]) / np.hypot(1.0, 0.2) if side == "R" else None
    # ---- shapes (canonical u toward the thumb, v toward the knuckles; the cuff covers v < ~6)
    k = hw / 29.0
    # back of the hand: from under the cuff to the knuckle line (the curled fingers hang below it)
    body = catmull_closed([(-hw * 1.00, -8), (-hw * 1.10, 18 * k), (-hw * 1.10, 42 * k), (-hw * 0.70, 58 * k),
                           (hw * 0.10, 62 * k), (hw * 0.80, 58 * k), (hw * 1.16, 40 * k), (hw * 1.14, 16 * k),
                           (hw * 1.02, -8)])
    body_m = [F.P(u, v) for u, v in body]
    # curled fingers: three fat rolls side by side under the knuckle line (their bottoms = the scalloped
    # end of the fist); `point` straightens the thumb-side one
    ROLL_U = (-0.74, 0.0, 0.74)
    rolls = []
    for i, uc in enumerate(ROLL_U):
        if kind == "point" and i == 2:
            rolls.append(None)
            continue
        lo = 92 * k - abs(uc) * 7 * k
        rolls.append(catmull_closed([(hw * (uc - 0.40), 40 * k), (hw * (uc + 0.40), 40 * k), (hw * (uc + 0.44), 70 * k),
                                     (hw * (uc + 0.26), lo - 2 * k), (hw * uc, lo + 1 * k), (hw * (uc - 0.26), lo - 2 * k),
                                     (hw * (uc - 0.44), 70 * k)], 10))
    finger = None
    if kind == "point":
        # index finger straight out along the hand axis from the thumb-side knuckle
        finger = capsule_pts(F, (hw * 0.70, 48 * k), (hw * 0.66, 146 * k), 12.5 * k)
    # the thumb: a short fat bump on the thumb side, pressed over the first finger
    thumb = capsule_pts(F, (hw * 1.18, 22 * k), (hw * 0.62, 50 * k), 12.5 * k)
    # ---- render (supersampled), back to front: body, finger, rolls, thumb
    hh, ww = (box[3] - box[1]) * SS, (box[2] - box[0]) * SS
    rgb = np.zeros((hh, ww, 3), np.float32)
    alpha = np.zeros((hh, ww), np.float32)

    def layer(pts, centre_uv, radius, extra_lines=(), line_w=3.2):
        nonlocal rgb, alpha
        m = poly_mask(pts, box)
        out = dilate_ss(m, OW)
        # outline
        rgb = rgb * (1 - out[..., None]) + ink[None, None, :] * out[..., None]
        alpha = np.maximum(alpha, out)
        fill = np.clip(m, 0, 1)
        col = shade_fill(m, box, F, centre_uv, radius, light, rim_side)
        rgb = rgb * (1 - fill[..., None]) + col * fill[..., None]
        if extra_lines:
            sm = stroke_mask(extra_lines, box, line_w) * fill
            rgb = rgb * (1 - sm[..., None]) + ink[None, None, :] * sm[..., None]
        return m

    # a knuckle crease line across the back of the hand
    kn = [[F.P(-hw * 0.55, 46 * k), F.P(-hw * 0.1, 50 * k), F.P(hw * 0.35, 48 * k)]]
    layer(body_m, (-hw * 0.2, 24 * k), 52 * k, kn, 2.2)
    if finger is not None:
        crease = [[F.P(hw * 0.46, 104 * k), F.P(hw * 0.70, 106 * k)]]
        layer(finger, (hw * 0.62, 90 * k), 46 * k, crease, 2.2)
    for i, r in enumerate(rolls):
        if r is None:
            continue
        rm = [F.P(u, v) for u, v in r]
        layer(rm, (hw * ROLL_U[i] - 2 * k, 60 * k), 30 * k)
    tc = [[F.P(hw * 0.88, 40 * k), F.P(hw * 0.74, 46 * k)]]
    layer(thumb, (hw * 0.95, 30 * k), 26 * k, tc, 2.2)
    # down-sample
    def down(a):
        return a.reshape(a.shape[0] // SS, SS, a.shape[1] // SS, SS, *a.shape[2:]).mean(axis=(1, 3))
    prem = down(rgb * alpha[..., None])
    al = down(alpha)
    # the master cuff over the root (its own pixels, alpha and outline), feathered 2 px at the lower edge
    cm = poly_mask(h["cuff"], box, 1)
    cm = ndi.gaussian_filter(cm, 1.0)
    x0, y0, x1, y1 = box
    mrgb = master_rgba[y0:y1, x0:x1, :3]
    ma = master_rgba[y0:y1, x0:x1, 3] * cm
    prem = mrgb * ma[..., None] + prem * (1 - ma[..., None])
    al = ma + al * (1 - ma)
    out = np.zeros((H, W, 4), np.float32)
    rgb_s = np.where(al[..., None] > 1e-4, prem / np.maximum(al[..., None], 1e-4), 0)
    out[y0:y1, x0:x1, :3] = rgb_s
    out[y0:y1, x0:x1, 3] = al
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--qa", default=str(REPO / "build/qa/chr_monty/cut/hands.png"))
    a = ap.parse_args()
    m = np.asarray(Image.open(MASTER).convert("RGBA"), np.float32) / 255
    lum = m[..., :3] @ np.array([0.299, 0.587, 0.114], np.float32)
    inkpx = m[..., :3][(lum < 0.05) & (m[..., 3] > 0.99)]
    ink = np.median(inkpx, axis=0) if len(inkpx) else np.array([0.03, 0.02, 0.04], np.float32)
    OUT.mkdir(parents=True, exist_ok=True)
    tiles = []
    for side in ("R", "L"):
        for kind in ("fist", "point"):
            img = paint(side, kind, m, ink)
            f = OUT / f"hand_{side}_{kind}.png"
            Image.fromarray((np.clip(img, 0, 1) * 255 + 0.5).astype(np.uint8), "RGBA").save(f)
            c = HANDS[side]["c"]
            box = (max(0, int(c[0] - 110)), int(c[1] - 60), min(862, int(c[0] + 110)), int(c[1] + 190))
            bg = np.full((box[3] - box[1], box[2] - box[0], 3), 0.55, np.float32)
            crop = img[box[1]:box[3], box[0]:box[2]]
            # the arm above for context (master minus the open hand)
            tiles.append(crop[..., :3] * crop[..., 3:4] + bg * (1 - crop[..., 3:4]))
            print(f)
    # open hands from the master for comparison
    for side in ("R", "L"):
        c = HANDS[side]["c"]
        box = (max(0, int(c[0] - 110)), int(c[1] - 60), min(862, int(c[0] + 110)), int(c[1] + 190))
        crop = m[box[1]:box[3], box[0]:box[2]]
        bg = np.full(crop.shape[:2] + (3,), 0.55, np.float32)
        tiles.append(crop[..., :3] * crop[..., 3:4] + bg * (1 - crop[..., 3:4]))
    hmax = max(t.shape[0] for t in tiles)
    row = np.concatenate([np.pad(t, ((0, hmax - t.shape[0]), (0, 4), (0, 0)), constant_values=0.2) for t in tiles], axis=1)
    Path(a.qa).parent.mkdir(parents=True, exist_ok=True)
    im = Image.fromarray((np.clip(row, 0, 1) * 255 + 0.5).astype(np.uint8))
    im = im.resize((im.size[0] * 2, im.size[1] * 2), Image.LANCZOS)
    im.save(a.qa)
    print(a.qa)
    return 0


if __name__ == "__main__":
    sys.exit(main())
