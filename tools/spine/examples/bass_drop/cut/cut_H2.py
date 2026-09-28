#!/usr/bin/env python3
"""sym_H2 Vinyl Record parts (ANIMATION_SET 2.2) from the approved rig master (sym_H2_rig 434527a1):
  - disc + label: the WHOLE record rebuilt from the master's radial profile (a record is rotationally symmetric; the
    master shows only its right half, the c11 sheet's disc is not complete behind the sleeve), so it can slide out of
    the sleeve 40 units and spin. The profile is a low percentile over the visible angles (the unlit vinyl, its groove
    rings and the sticker outline) and the median for the label. The label carries a small printed arc on its
    hidden (left) side, so a spin reads while the rest pose stays the approved look;
  - fx_groove: the painted reflections as a non-rotating sheen on the slide bone (exact minimal-alpha unblend of the
    master over the rebuilt record in the visible area): the rest pose reassembles to the master, the light stays put
    while the record spins;
  - sleeve: master pixels left of the lip, plus the lip's shadow on the record (unblended), so the shadow stays at the
    lip when the record slides;
  - disc_cracked / disc_shards (explode f2 / f4), fx_glint, fx_glow: drawn here.
Writes art/source/spine/images/sym_H2/*.png, art/source/symbols/H2/parts.json and QA to build/qa/rigs/sym_H2/.

    tools/.venv/bin/python tools/spine/examples/bass_drop/cut/cut_H2.py
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
import cutlib as cl  # noqa: E402

R = cl.REPO
SRC = R / "art/source/symbols/H2"
IMG = R / "art/source/spine/images/sym_H2"
QA = R / "build/qa/rigs/sym_H2"
CONTENT = 288          # cellScale 0.96 x 300 (src/games/bass-drop/config.ts H2)

C = (577.0, 510.7)     # record centre (circle fit of the silhouette's right half, master px)
R_OUT = 393.5          # silhouette radius incl. the sticker outline
R_LABEL = 121.0        # label radius (incl. its outline)
# sleeve lip (its outline belongs to the sleeve): polyline top -> bottom, master px; the sleeve is LEFT of it
LIP = [(650, 40), (638, 100), (619, 126), (615, 200), (607, 350), (602, 510), (604, 700), (608, 850), (613, 905), (625, 990)]
LIP_SHADOW = 16.0      # px right of the lip whose overlay is the sleeve's shadow (stays with the sleeve)
LIP_FADE = 90.0        # ... ramping over to the record's own sheen by this distance
GLINT_AT = (800.0, 290.0)


def left_of(shape, pts):
    """Coverage of the region LEFT of a top-to-bottom polyline."""
    h, w = shape[:2]
    ys = np.array([p[1] for p in pts], float)
    xs = np.array([p[0] for p in pts], float)
    xb = np.interp(np.arange(h) + 0.5, ys, xs)
    X = np.arange(w)[None, :] + 0.5
    return np.clip(xb[:, None] - X + 0.5, 0, 1).astype(np.float32), xb


def radial_profile(M, vis, c, rmax, pct_disc=22, step=0.5):
    """Per-radius colour/alpha over the visible pixels: a low percentile outside the label, the median inside."""
    h, w = M.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w]
    rr = np.hypot(xx + 0.5 - c[0], yy + 0.5 - c[1])
    rs = np.arange(0, rmax + 4, step)
    prof = np.zeros((len(rs), 4), np.float32)
    lum = M[..., :3] @ np.array([0.299, 0.587, 0.114], np.float32)
    for i, r in enumerate(rs):
        m = vis & (np.abs(rr - r) < 0.75)
        if m.sum() < 6:
            m = vis & (np.abs(rr - r) < 2.0)
        if m.sum() == 0:
            prof[i] = np.nan               # no visible pixel at this radius (hidden by the sleeve): backfilled below
            continue
        px = M[m]
        if r > R_LABEL + 2:
            # the unlit vinyl: pixels at or below the chosen luminance percentile, averaged
            L = lum[m]
            k = L <= np.percentile(L, pct_disc)
            prof[i, :3] = px[k, :3].mean(0) if k.any() else px[:, :3].mean(0)
        else:
            prof[i, :3] = np.median(px[:, :3], 0)
        prof[i, 3] = np.median(px[:, 3])
    ok = ~np.isnan(prof[:, 0])
    first = np.argmax(ok)
    prof[:first] = prof[first]            # the label centre (behind the sleeve) takes the innermost visible colour
    for i in range(first + 1, len(rs)):
        if not ok[i]:
            prof[i] = prof[i - 1]
    return rs, prof, rr


def render_disc(shape, rs, prof, rr):
    out = np.zeros(shape[:2] + (4,), np.float32)
    for k in range(4):
        out[..., k] = np.interp(rr, rs, prof[:, k], right=0.0)
    return out


def unblend(master, base, region):
    """Minimal-alpha normal-blend overlay O with `O over base == master` inside `region` (straight RGBA in/out).
    Where the base is opaque, O's alpha is the least that reaches the master colour; where the base is partly
    transparent (the rim's anti-aliasing), the coverage equation fixes O's alpha. The base must not be more opaque
    than the master there (clip it first)."""
    m, b = master[..., :3], np.clip(base[..., :3], 1e-4, 1 - 1e-4)
    ma, ba = master[..., 3:4], base[..., 3:4]
    need_dark = np.where(m < b, 1 - m / b, 0)
    need_light = np.where(m > b, (m - b) / (1 - b), 0)
    a_col = np.clip(np.maximum(need_dark, need_light).max(-1, keepdims=True), 0, 1)
    a_cov = np.clip((ma - ba) / np.maximum(1 - ba, 1e-4), 0, 1)
    a = np.where(ba >= 0.999, a_col, np.maximum(a_cov, np.where(ba > 0.02, a_col * 0, 0)))
    # premultiplied solve: o_p = M_p - B_p (1 - a)
    o_p = m * ma - base[..., :3] * ba * (1 - a)
    o_p = np.clip(o_p, 0, a)
    col = np.where(a > 1e-4, o_p / np.maximum(a, 1e-4), 0)
    a = np.where(region[..., None], a, 0)
    out = np.concatenate([np.clip(col, 0, 1), a], -1).astype(np.float32)
    out[out[..., 3] < 1.5 / 255] = 0
    return out


def label_print(shape, c, r_label):
    """A small printed arc on the label's left (hidden at rest) side, in the sleeve's hot pink."""
    h, w = shape[:2]
    ss = 4
    im = Image.new("L", (w * ss, h * ss), 0)
    d = ImageDraw.Draw(im)
    cx, cy = c[0] * ss, c[1] * ss
    r0, r1 = r_label * 0.60 * ss, r_label * 0.80 * ss
    d.pieslice([cx - r1, cy - r1, cx + r1, cy + r1], 130, 230, fill=255)
    d.pieslice([cx - r0, cy - r0, cx + r0, cy + r0], 120, 240, fill=0)
    return np.asarray(im.resize((w, h), Image.BOX), dtype=np.float32) / 255.0


def crack_lines(shape, c, rmax, seed=3):
    rng = np.random.default_rng(seed)
    h, w = shape[:2]
    im = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(im)
    for k in range(6):
        a = math.radians(k * 60 + rng.uniform(-14, 14))
        x, y = c[0] + math.cos(a) * 30, c[1] + math.sin(a) * 30
        r = 30.0
        while r < rmax:
            a += rng.uniform(-0.18, 0.18)
            step = rng.uniform(45, 80)
            nx, ny = x + math.cos(a) * step, y + math.sin(a) * step
            d.line([(x, y), (nx, ny)], fill=255, width=9)
            x, y, r = nx, ny, r + step
    return cl.feather(np.asarray(im, dtype=np.float32) / 255.0, 1.0), rng


def shards(disc, c, n=6, seed=5, gap=10.0, push=0.07):
    """The record broken into n wedges, each pushed out radially (explode f4)."""
    rng = np.random.default_rng(seed)
    h, w = disc.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w] + 0.5
    ang = (np.degrees(np.arctan2(yy - c[1], xx - c[0])) + 360) % 360
    cuts = np.sort((np.arange(n) * 360 / n + rng.uniform(-12, 12, n)) % 360)
    out = np.zeros_like(disc)
    for i in range(n):
        a0, a1 = cuts[i], cuts[(i + 1) % n] + (360 if i == n - 1 else 0)
        mid = math.radians((a0 + a1) / 2)
        sel = ((ang - a0) % 360) < ((a1 - a0) % 360)
        piece = disc.copy()
        piece[..., 3] *= sel
        # a dark edge where it broke
        edge = cl.stroke(piece[..., 3], 5, colour=(0.02, 0.02, 0.03))
        piece = cl.over(edge, piece)
        dx, dy = math.cos(mid) * R_OUT * push, math.sin(mid) * R_OUT * push
        Mw = np.array([[1, 0, dx], [0, 1, dy]], float)
        out = cl.over(cl.warp_into(piece, Mw, disc.shape), out)
    return out


def main() -> int:
    IMG.mkdir(parents=True, exist_ok=True)
    QA.mkdir(parents=True, exist_ok=True)
    M = cl.load(SRC / "master_rig_1024.png")
    shp = M.shape
    fit = cl.Fit.symbol(M, CONTENT)
    P = fit.pt

    sleeve_cov, xb = left_of(shp, LIP)
    X = np.arange(shp[1])[None, :] + 0.5
    dist_right = X - xb[:, None]                              # px right of the lip
    yy, xx = np.mgrid[0:shp[0], 0:shp[1]]
    rr0 = np.hypot(xx + 0.5 - C[0], yy + 0.5 - C[1])
    vis = (dist_right > LIP_SHADOW + 6) & (rr0 < R_OUT + 3) & (M[..., 3] > 0.02)

    # ---------------------------------------------------------------- the rebuilt record
    rs, prof, rr = radial_profile(M, vis, C, R_OUT)
    # the label body is one flat printed colour: its median over the visible label (the lip's shadow excluded)
    lab_vis = vis & (rr0 > 60) & (rr0 < R_LABEL - 9)
    lab_col = np.median(M[lab_vis][:, :3], 0)
    inner = rs < R_LABEL - 9
    prof[inner, :3] = lab_col
    prof[inner, 3] = 1.0
    base = render_disc(shp, rs, prof, rr)
    hole = cl.ellipse(shp, C[0], C[1], 9, 9)                  # spindle hole (hidden at rest)
    base[..., :3] = base[..., :3] * (1 - hole[..., None]) + np.array([0.04, 0.03, 0.05]) * hole[..., None]
    lab_cov = np.clip(R_LABEL + 0.5 - rr, 0, 1)
    disc_only = base.copy()
    disc_only[..., 3] *= 1 - np.clip(R_LABEL - 3 + 0.5 - rr, 0, 1)   # the label slot covers the inside
    label = base.copy()
    label[..., 3] *= lab_cov
    pink = np.array([0.93, 0.16, 0.47], np.float32)
    pr = label_print(shp, C, R_LABEL)
    label[..., :3] = label[..., :3] * (1 - pr[..., None] * 0.9) + pink * pr[..., None] * 0.9

    # ---------------------------------------------------------------- sheen + the sleeve's lip shadow
    # the rim: where the painted silhouette is inside the rebuilt circle, the record takes the master's coverage
    # (a sub-unit trim of the rim's anti-aliasing; the sheen restores the rest of the edge exactly)
    vis_rim = (dist_right > -1) & (rr0 > R_OUT - 12)
    disc_only[..., 3] = np.where(vis_rim, np.minimum(disc_only[..., 3], M[..., 3]), disc_only[..., 3])
    rec_rest = cl.over(label, disc_only)
    region = (dist_right > -1) & (rr0 < R_OUT + 2) & (M[..., 3] > 0.02)
    total = unblend(M, rec_rest, region)
    # split the overlay exactly between the record (a1) and the sleeve (a2): same colour, (1 - a) = (1 - a1)(1 - a2).
    # The record's share ramps in over LIP_SHADOW..LIP_FADE px right of the lip, so a slid-out record shows no seam;
    # the rest (the lip's shadow and the reflections next to it) stays with the sleeve.
    f = np.clip((dist_right - LIP_SHADOW) / (LIP_FADE - LIP_SHADOW), 0, 1)
    f = f * f * (3 - 2 * f)
    a = total[..., 3]
    a1 = a * f
    a2 = np.where(a1 < 0.999, 1 - (1 - a) / np.maximum(1 - a1, 1e-4), 0)
    # the sleeve keeps only what darkens (its shadow) beyond the first LIP_SHADOW px: a lightening overlay left
    # behind at the lip would ghost over a slid-out record (the record's share of it still fades in smoothly)
    lum = lambda x: x[..., :3] @ np.array([0.299, 0.587, 0.114], np.float32)
    darkens = lum(total) < lum(rec_rest)
    a2 = np.where((dist_right <= LIP_SHADOW) | darkens, a2, 0)
    sheen = total.copy()
    sheen[..., 3] = a1
    shadow = total.copy()
    shadow[..., 3] = np.clip(a2, 0, 1)
    # the sleeve's corner outlines at the lip's top and bottom reach right of the lip, outside the record
    corner = ((rr0 > R_OUT + 4) & (dist_right < 80)).astype(np.float32)
    sleeve = cl.layer(M, np.maximum(sleeve_cov, corner))
    sleeve = cl.over(sleeve, shadow)                          # lip shadow belongs to the sleeve

    parts, canv = [], {}

    def add(name, lay, **kw):
        c = fit.canvas(lay)
        img, bbox = cl.trim(c, 3)
        cl.save(img, IMG / f"{name}.png")
        canv[name] = cl.paste((fit.H, fit.W), img, bbox)
        parts.append(dict({"name": name, "bbox": bbox}, **kw))
        return bbox

    rnd = lambda xy: [round(xy[0], 1), round(xy[1], 1)]
    gc = (180.0, 180.0)
    glow = cl.glow_disc(330, (1.0, 0.35, 0.7), alpha=0.8)
    cl.save(glow, IMG / "glow.png")
    parts.append({"name": "glow", "slot": "fx_glow", "bbox": place(glow, gc), "z": 0, "bone": "fx_glow",
                  "blend": "additive", "color": "ffffff00", "joint": list(gc)})
    add("disc", disc_only, z=1, bone="disc")
    # explode variants of the disc slot: cracked (f2), then the shards (f4); the label rides on top until it fades
    cmask, _ = crack_lines(shp, C, R_OUT - 8)
    cracked = cl.over(label, disc_only)
    cracked[..., :3] = cracked[..., :3] * (1 - cmask[..., None]) + np.array([0.9, 0.9, 1.0]) * cmask[..., None] * 0.55
    add("disc_cracked", cracked, z=1, bone="disc", slot="disc")
    add("disc_shards", shards(cl.over(label, disc_only), C), z=1, bone="disc", slot="disc")
    add("label", label, z=2, bone="label")
    add("fx_groove", sheen, z=3, bone="record")
    add("sleeve", sleeve, z=4, bone="sleeve")
    glint = cl.star_glint(84)
    gp = P(*GLINT_AT)
    cl.save(glint, IMG / "glint.png")
    parts.append({"name": "glint", "slot": "fx_glint", "bbox": place(glint, gp), "z": 5, "bone": "fx_glint",
                  "blend": "additive", "color": "ffffff00", "joint": rnd(gp)})

    comment = ("sym_H2 parts (ANIMATION_SET 2.2): record + label rebuilt from the radial profile of "
               "art/source/symbols/H2/master_rig_1024.png (sym_H2_rig 434527a1), fx_groove = its reflections unblended "
               "(non-rotating), sleeve = master left of the lip + the lip shadow; explode / fx sprites drawn by "
               "tools/spine/examples/bass_drop/cut/cut_H2.py. Canvas 360 @2x, content 288 (cellScale 0.96).")
    pj = cl.write_parts(SRC, "H2", parts, comment=comment, blur=["sleeve", "disc", "label", "fx_groove"])

    ref = fit.canvas(M)
    rest = [canv["disc"], canv["label"], canv["fx_groove"], canv["sleeve"]]
    met, comp = cl.reassembly(rest, ref)
    diff = np.abs(comp[..., 3] - ref[..., 3]) > 0.5
    ys, xs = np.nonzero(diff)
    if len(xs):
        print(f"alpha mismatch: {len(xs)} canvas px, x {xs.min()}..{xs.max()}, y {ys.min()}..{ys.max()}")
    keys = {"centre": C, "label_top": (C[0], C[1] - R_LABEL), "glint": GLINT_AT, "lip_mid": (602, 510), "sleeve_mid": (330, 520)}
    pts = {k: rnd(P(*v)) for k, v in keys.items()}
    json.dump({"reassembly": met, "fit": {"s": fit.s, "ox": fit.ox, "oy": fit.oy}, "keypoints": pts,
               "radius_canvas": round(R_OUT * fit.s, 2), "label_radius_canvas": round(R_LABEL * fit.s, 2)},
              open(QA / "cut.json", "w"), indent=1)
    print("keypoints (canvas):", pts, "R", round(R_OUT * fit.s, 1))
    cl.preview(rest, QA / "rest.png")
    # the record slid out 40 units and spun 90 degrees (win pose) under the sleeve
    s40 = 40 / fit.s
    cx, cy = C
    Mw = cv2.getRotationMatrix2D((cx, cy), -90, 1.0)
    Mw[0, 2] += s40
    rec = cl.warp_into(cl.over(label, disc_only), Mw, shp)
    sh = cl.warp_into(sheen, np.array([[1, 0, s40], [0, 1, 0]], float), shp)
    cl.preview([fit.canvas(rec), fit.canvas(sh), canv["sleeve"]], QA / "win_pose.png")
    cl.preview([canv["disc"], canv["label"]], QA / "record_alone.png")
    cl.preview([canv["disc_shards"]], QA / "shards.png")
    print(f"cut_H2: {len(parts)} parts -> {pj}; reassembly {met}")
    return 0


def place(img: np.ndarray, centre) -> list:
    h, w = img.shape[:2]
    return [int(round(centre[0] - w / 2)), int(round(centre[1] - h / 2)), w, h]


if __name__ == "__main__":
    sys.exit(main())
