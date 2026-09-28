#!/usr/bin/env python3
"""ui_groove_meter parts (ANIMATION_SET 3, DESIGN 6.1, layout.json meterGeometry) from the approved Groove Meter
master (bd_meter_master 80be379d; full-resolution matte art/_work/c0107/bd_meter_master/matte_full.png) and the
approved notch icons (bd_notch_icons c11954bf: art/source/ui/bass-drop/emblems/notch/).

The meter parts sheet was rejected (a perspective exploded view), so the plan's fallback applies: the orthographic
master is split radially and redrawn as true circles. Canvas: 2x landscape design units, root = ring centre at
(380, 440) of a 760 x 880 canvas; R = 320 units (ring Ø 640).
  - woofer: the art's rings are mapped radially onto DESIGN's bands (fractions of R): dust cap 0-0.525 (the art's cap
    up to its outline), cone 0.525-0.70 (the art's ribbed cone), LED zone 0.70-0.85 (the art's surround, under the
    code-drawn LED arc), 0.85-0.875 (the art's inner black ring), rim 0.875-1.0 (trim band + bolted metal ring +
    outer outline). Each band is resampled around the measured ellipse centre with its measured x/y ratio, so the
    rings come out round (the LED arc is code-drawn on true circles);
  - rim_trim: the art's light trim band recoloured per mode (teal base, gold Juke Jam, pink Mega Mix);
  - cabinet: the art outside the woofer, mapped affinely onto 704 x 840 units (bottom edge 428 below the ring
    centre); cabinet_back = the panel (grill strips and screws filled), grill = both strips, cabinet_front = the
    four gold screws;
  - notch badges: 5 icons (W gem with 1 / 2 / 3 pips, jukebox, crowned speaker) x 4 states (off, next, lit, spent),
    drawn as bolted plates around the approved icons (no text);
  - fx: glow_ring (fx_glow), swirl (fx_swirl), burst_star (fx_burst), cap_flash (fx_cap): drawn here.
Writes art/source/spine/images/ui_groove_meter/*.png, art/source/ui/meter/parts.json and QA to
build/qa/rigs/ui_groove_meter/.

    tools/.venv/bin/python tools/spine/examples/bass_drop/cut/cut_meter.py
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

R_ = cl.REPO
ART = R_ / "art/_work/c0107/bd_meter_master/matte_full.png"
ICONS = R_ / "art/source/ui/bass-drop/emblems/notch"
OUT = R_ / "art/source/ui/meter"
IMG = R_ / "art/source/spine/images/ui_groove_meter"
QA = R_ / "build/qa/rigs/ui_groove_meter"

W, H = 760, 880
CX, CY = 380.0, 440.0                 # root = ring centre
R = 320.0
GEO = {"counterR": 0.525, "ledInner": 0.70, "ledOuter": 0.85, "rimInner": 0.875, "notchRadius": 0.94, "notchR": 0.15}
NOTCH_DEG = [-100, -50, 0, 50, 100, 150]          # clockwise from 12 o'clock (layout.json meterGeometry)
NOTCH_ICON = ["w1", "w1", "w2", "jj", "w3", "mm"]  # 10 / 20: one pip, 30: two, 40: jukebox, 50: three, 60: crown
# the art's rings (full-res px, y radius, measured by ellipse fits of the dark outlines) and their x/y ratios
ART_C = (928.2, 1150.8)
ART_R = [0.0, 298.3, 505.8, 576.4, 588.1, 697.0, 712.0]
DES_R = [0.0, GEO["counterR"] * R, GEO["ledInner"] * R, GEO["ledOuter"] * R, GEO["rimInner"] * R, R, R + 10]
ART_E = ([298.0, 506.0, 588.0], [0.9945, 0.9847, 0.9800])
TRIM_ART = (592.0, 614.0)           # the light trim band (art y radius)
CAB_ART = (80, 86, 1775, 2218)      # the cabinet's art bbox (x0, y0, x1, y1)
CAB = (704.0, 840.0, 428.0)         # width, height, bottom edge below the ring centre (units)
GRILLS = [(398, 196, 1462, 334), (398, 1966, 1466, 2102)]       # art px (x0, y0, x1, y1)
SCREWS = [(280, 250), (1574, 250), (274, 2024), (1580, 2024)]    # art px centres
SCREW_R = 66.0
TRIMS = {"base": (0.21, 0.95, 0.88), "jukejam": (1.0, 0.78, 0.16), "megamix": (1.0, 0.25, 0.66)}
SS = 3


def woofer_canvas(A):
    """The woofer (0..R+10) remapped onto DESIGN's bands, at canvas resolution (straight RGBA)."""
    blur = cl.blur_rgb(A, 1.0)
    blur[..., 3] = cv2.GaussianBlur(A[..., 3], (0, 0), 1.0)
    prem = blur.copy()
    prem[..., :3] *= prem[..., 3:4]
    h, w = H * SS, W * SS
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    dx = (xx + 0.5) / SS - CX
    dy = (yy + 0.5) / SS - CY
    rho = np.hypot(dx, dy)
    ry = np.interp(rho, DES_R, ART_R).astype(np.float32)
    e = np.interp(ry, *ART_E).astype(np.float32)
    n = np.maximum(rho, 1e-4)
    mx = (ART_C[0] + dx / n * ry * e).astype(np.float32)
    my = (ART_C[1] + dy / n * ry).astype(np.float32)
    big = cv2.remap(prem, mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
    small = cv2.resize(big, (W, H), interpolation=cv2.INTER_AREA)
    a = small[..., 3:4]
    small[..., :3] = np.where(a > 1e-5, small[..., :3] / np.maximum(a, 1e-5), 0)
    rr = np.hypot(np.arange(W)[None, :] + 0.5 - CX, np.arange(H)[:, None] + 0.5 - CY)
    small[..., 3] *= np.clip(R + 1.0 - rr, 0, 1)            # nothing of the cabinet: the woofer ends at R
    ry_small = np.interp(rr, DES_R, ART_R)
    return small.astype(np.float32), rr, ry_small


def cabinet_canvas(A):
    x0, y0, x1, y1 = CAB_ART
    sx = CAB[0] / (x1 - x0 + 1)
    sy = CAB[1] / (y1 - y0 + 1)
    ox = CX - CAB[0] / 2 - x0 * sx
    oy = CY + CAB[2] - CAB[1] - y0 * sy
    Mx = np.array([[sx, 0, ox], [0, sy, oy]], np.float64)
    prem = A.copy()
    prem[..., :3] *= prem[..., 3:4]
    # pre-filter the ~0.4x downscale, then the affine warp
    pre = cv2.resize(prem, (round(A.shape[1] * sx * 2), round(A.shape[0] * sy * 2)), interpolation=cv2.INTER_AREA)
    M2 = Mx.copy()
    M2[0, 0] = 0.5
    M2[1, 1] = 0.5
    out = cv2.warpAffine(pre, M2, (W, H), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
    out = np.clip(out, 0, 1)
    a = out[..., 3:4]
    out[..., :3] = np.where(a > 1e-5, out[..., :3] / np.maximum(a, 1e-5), 0)
    return out.astype(np.float32), (lambda x, y: (x * sx + ox, y * sy + oy)), (sx, sy)


def ring_cover(rr, r0, r1):
    return (np.clip(rr - r0 + 0.5, 0, 1) * np.clip(r1 - rr + 0.5, 0, 1)).astype(np.float32)


def tint_band(lay, rgb):
    """Recolour a light band keeping its shading: luminance x target colour (a touch of white in the highlights)."""
    out = lay.copy()
    lum = lay[..., :3] @ np.array([0.299, 0.587, 0.114], np.float32)
    L = np.clip(lum / max(1e-3, np.percentile(lum[lay[..., 3] > 0.5], 90)), 0, 1.25)[..., None]
    col = np.array(rgb, np.float32)
    out[..., :3] = np.clip(col * L * 0.95 + np.clip(L - 1.0, 0, 1) * 0.6, 0, 1)
    return out


# ------------------------------------------------------------------------------------------ notch badges
def load_icon(name):
    im = np.asarray(Image.open(ICONS / f"notch_{name}.png").convert("RGBA")).astype(np.float32) / 255
    return im


def fit_icon(icon, box):
    h, w = icon.shape[:2]
    s = min(box / w, box / h)
    prem = icon.copy()
    prem[..., :3] *= prem[..., 3:4]
    nw, nh = max(1, round(w * s)), max(1, round(h * s))
    ch = [np.asarray(Image.fromarray(prem[..., k], "F").resize((nw, nh), Image.LANCZOS)) for k in range(4)]
    out = np.clip(np.stack(ch, -1), 0, 1)
    a = out[..., 3:4]
    out[..., :3] = np.where(a > 1e-5, out[..., :3] / np.maximum(a, 1e-5), 0)
    return out.astype(np.float32)


def disc(n, cx, cy, r, ss=4):
    im = Image.new("L", (n * ss, n * ss), 0)
    ImageDraw.Draw(im).ellipse([(cx - r) * ss, (cy - r) * ss, (cx + r) * ss, (cy + r) * ss], fill=255)
    return np.asarray(im.resize((n, n), Image.BOX), dtype=np.float32) / 255.0


def badge(icon_rgba, pips, state, n=112):
    """A bolted round plate (formula D: black outline, painterly gradient) with the icon; pips = W wilds per drop."""
    c = n / 2
    rb = GEO["notchR"] * R                     # 48 units: the badge radius incl. its outline
    out = np.zeros((n, n, 4), np.float32)
    yy, xx = np.mgrid[0:n, 0:n] + 0.5
    rr = np.hypot(xx - c, yy - c)
    # outline, metal rim, plate
    rim_col = {"off": (0.33, 0.31, 0.38), "next": (0.21, 0.95, 0.88), "lit": (1.0, 0.8, 0.2), "spent": (0.55, 0.43, 0.16)}[state]
    plate_top = {"off": (0.14, 0.09, 0.17), "next": (0.20, 0.13, 0.26), "lit": (0.36, 0.20, 0.30), "spent": (0.16, 0.11, 0.16)}[state]
    plate_bot = {"off": (0.06, 0.04, 0.08), "next": (0.09, 0.06, 0.13), "lit": (0.20, 0.09, 0.16), "spent": (0.07, 0.05, 0.08)}[state]
    outline = disc(n, c, c, rb)
    rim = disc(n, c, c, rb - 4.0)
    plate = disc(n, c, c, rb - 10.0)
    t = np.clip((yy - (c - rb)) / (2 * rb), 0, 1)[..., None]
    plate_rgb = np.array(plate_top) * (1 - t) + np.array(plate_bot) * t
    # the rim: lit from the upper left (lighter top-left, darker bottom-right) + a white specular tick
    ang = np.arctan2(yy - c, xx - c)
    shade = (0.75 + 0.35 * np.cos(ang + 2.35))[..., None]
    rim_rgb = np.clip(np.array(rim_col) * shade, 0, 1)
    out[..., :3] = 0.02
    out[..., 3] = outline
    out[..., :3] = np.where(rim[..., None] > 0, rim_rgb, out[..., :3])
    out[..., :3] = out[..., :3] * (1 - plate[..., None]) + plate_rgb * plate[..., None]
    inner_line = np.clip(1 - np.abs(rr - (rb - 10.0)) / 1.2, 0, 1)[..., None]
    out[..., :3] = out[..., :3] * (1 - inner_line * 0.9)
    spec = (np.clip(1 - np.abs(rr - (rb - 7.0)) / 1.5, 0, 1) * np.clip(np.cos(ang + 2.35) - 0.8, 0, 1) * 4)[..., None]
    out[..., :3] = np.clip(out[..., :3] + spec * 0.8, 0, 1)
    if state == "lit":                          # the plate glows from inside
        g = np.clip(1 - rr / (rb - 10), 0, 1)[..., None] ** 1.5 * plate[..., None]
        out[..., :3] = np.clip(out[..., :3] + g * np.array([0.5, 0.35, 0.1]), 0, 1)
    # icon
    box = 60.0 if pips else 66.0
    ic = fit_icon(icon_rgba, box)
    lum = ic[..., :3] @ np.array([0.299, 0.587, 0.114], np.float32)
    grey = np.repeat(lum[..., None], 3, -1)
    if state == "off":
        ic[..., :3] = grey * 0.42
    elif state == "spent":
        ic[..., :3] = (ic[..., :3] * 0.3 + grey * 0.7) * 0.62
    elif state == "next":
        ic[..., :3] = ic[..., :3] * 0.88
    else:
        ic[..., :3] = np.clip(ic[..., :3] * 1.12, 0, 1)
    ih, iw = ic.shape[:2]
    oy = c - ih / 2 - (6.0 if pips else 0.0)
    ox = c - iw / 2
    layer = np.zeros_like(out)
    layer[int(round(oy)):int(round(oy)) + ih, int(round(ox)):int(round(ox)) + iw] = ic
    layer[..., 3] *= plate                   # the icon stays inside the plate
    out = cl.over(layer, out)
    # pips: gold dots (lit / next) or dark sockets (off / spent)
    for k in range(pips):
        px = c + (k - (pips - 1) / 2) * 11.0
        py = c + rb - 21.0
        d_o = disc(n, px, py, 5.2)
        d_i = disc(n, px, py, 3.6)
        on = state in ("lit", "next")
        col = np.array((1.0, 0.82, 0.25) if on else (0.35, 0.3, 0.32), np.float32)
        pip = np.zeros_like(out)
        pip[..., :3] = 0.02
        pip[..., 3] = d_o
        pip[..., :3] = np.where(d_i[..., None] > 0, col, pip[..., :3])
        out = cl.over(pip, out)
    return out


# ------------------------------------------------------------------------------------------ fx sprites
def glow_ring(d, r0, r1, rgb=(1.0, 1.0, 1.0)):
    yy, xx = np.mgrid[0:d, 0:d] + 0.5
    rr = np.hypot(xx - d / 2, yy - d / 2)
    mid, half = (r0 + r1) / 2, (r1 - r0) / 2
    a = np.exp(-((rr - mid) / half) ** 2)
    ang = np.arctan2(yy - d / 2, xx - d / 2)
    a *= 0.55 + 0.45 * np.cos(ang) ** 2 * (np.cos(ang) > 0)       # a brighter arc: rotation reads as a sweep
    out = np.zeros((d, d, 4), np.float32)
    out[..., :3] = rgb
    out[..., 3] = np.clip(a, 0, 1)
    return out


def swirl(d, arms=6, rgb=(0.6, 1.0, 0.95)):
    yy, xx = np.mgrid[0:d, 0:d] + 0.5
    u, v = (xx - d / 2) / (d / 2), (yy - d / 2) / (d / 2)
    r = np.hypot(u, v)
    th = np.arctan2(v, u)
    phase = arms * (th - 3.2 * r)
    a = (0.5 + 0.5 * np.cos(phase)) ** 3 * np.clip(1 - r, 0, 1) ** 0.8 * np.clip(r / 0.35, 0, 1)
    out = np.zeros((d, d, 4), np.float32)
    out[..., :3] = rgb
    out[..., 3] = np.clip(a * 0.9, 0, 1)
    return out


def burst_star(d, points=8):
    yy, xx = np.mgrid[0:d, 0:d] + 0.5
    u, v = (xx - d / 2) / (d / 2), (yy - d / 2) / (d / 2)
    r = np.hypot(u, v)
    th = np.arctan2(v, u)
    ray = np.clip(np.cos(points / 2 * th), 0, 1) ** 12
    a = np.clip(ray * np.clip(1 - r, 0, 1) ** 1.2 + np.exp(-(r / 0.22) ** 2), 0, 1)
    out = np.zeros((d, d, 4), np.float32)
    w = np.clip(np.exp(-(r / 0.3) ** 2) * 1.2, 0, 1)[..., None]
    out[..., :3] = np.array([1.0, 0.85, 0.35]) * (1 - w) + w
    out[..., 3] = a
    return out


def main() -> int:
    IMG.mkdir(parents=True, exist_ok=True)
    QA.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    A = cl.load(ART)
    woof, rr, ry = woofer_canvas(A)
    cab, cab_pt, cab_s = cabinet_canvas(A)

    parts, canv = [], {}

    def add(name, lay, pad=3, **kw):
        c = cl.despeckle(lay)
        img, bbox = cl.trim(c, pad)
        cl.save(img, IMG / f"{name}.png")
        canv[name] = cl.paste((H, W), img, bbox)
        parts.append(dict({"name": name, "bbox": bbox}, **kw))
        return bbox

    def add_half(name, lay, **kw):
        """A soft / thin layer stored at half resolution (bassdrop.yaml region_scale 2), same centre."""
        c = cl.despeckle(lay)
        img, bbox = cl.trim(c, 4)
        h, w = img.shape[:2]
        w2, h2 = (w + 1) // 2, (h + 1) // 2
        pad = np.zeros((h2 * 2, w2 * 2, 4), np.float32)
        pad[:h, :w] = img
        prem = pad.copy()
        prem[..., :3] *= prem[..., 3:4]
        small = cv2.resize(prem, (w2, h2), interpolation=cv2.INTER_AREA)
        a = small[..., 3:4]
        small[..., :3] = np.where(a > 1e-5, small[..., :3] / np.maximum(a, 1e-5), 0)
        cxy = (bbox[0] + w2, bbox[1] + h2)
        cl.save(small, IMG / f"{name}.png")
        canv[name] = cl.paste((H, W), pad, [bbox[0], bbox[1], w2 * 2, h2 * 2])
        bb = [int(round(cxy[0] - w2 / 2)), int(round(cxy[1] - h2 / 2)), w2, h2]
        parts.append(dict({"name": name, "bbox": bb}, **kw))
        return bb

    def add_img(name, img, centre, **kw):
        h, w = img.shape[:2]
        bb = [int(round(centre[0] - w / 2)), int(round(centre[1] - h / 2)), w, h]
        cl.save(img, IMG / f"{name}.png")
        canv[name] = cl.paste((H, W), img, bb)
        parts.append(dict({"name": name, "bbox": bb}, **kw))
        return bb

    rc = GEO["counterR"] * R
    rli, rlo, rri = GEO["ledInner"] * R, GEO["ledOuter"] * R, GEO["rimInner"] * R
    trim_d = (np.interp(TRIM_ART[0], ART_R, DES_R), np.interp(TRIM_ART[1], ART_R, DES_R))
    # ---------------------------------------------------------------- cabinet (skins base / jukejam / megamix)
    screws = np.zeros((H, W), np.float32)
    for sx_, sy_ in SCREWS:
        u, v = cab_pt(sx_, sy_)
        screws = np.maximum(screws, cl.ellipse((H, W), u, v, SCREW_R * cab_s[0], SCREW_R * cab_s[1]))
    grills = np.zeros((H, W), np.float32)
    for gx0, gy0, gx1, gy1 in GRILLS:
        u0, v0 = cab_pt(gx0, gy0)
        u1, v1 = cab_pt(gx1, gy1)
        grills = np.maximum(grills, cl.poly((H, W), [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]))
    under = np.maximum(screws, grills) > 0.02
    back = cab.copy()
    back = cl.inpaint_rgb(back, under.astype(np.float32), radius=6, known=(cab[..., 3] > 0.9) & ~cv2.dilate(under.astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool))
    add("cabinet_back", back, z=0.1, bone="cabinet")
    add("grill_cloth", cl.layer(cab, grills), z=0.2, bone="cabinet", slot="grill")
    add("cabinet_front", cl.layer(cab, screws), z=0.3, bone="cabinet")
    # ---------------------------------------------------------------- the ring
    trim_cov = ring_cover(rr, trim_d[0], trim_d[1])
    rim_cov = ring_cover(rr, rli - 1.0, R + 2.0) * (1 - trim_cov)
    add("rim", cl.layer(woof, rim_cov), z=1.0, bone="ring")
    trim = cl.layer(woof, trim_cov)
    for mode, rgb in TRIMS.items():
        add_half(f"trim_{mode}", tint_band(trim, rgb), z=1.1, bone="ring", slot="rim_trim")
    # the cone's outer outline ring stays put above the bulging cone mesh (cone_surround)
    sur_c = np.interp(ART_R[2], ART_R, DES_R)
    add("surround", cl.layer(woof, ring_cover(rr, sur_c - 7.0, rli + 1.5)), z=1.3, bone="ring", slot="cone_surround")
    # cone: the band + its inner edge continued under the dust cap (hidden; the cap rides the same bone)
    cone = cl.layer(woof, ring_cover(rr, rc - 20.0, rli + 1.0))
    add("cone", cone, z=1.2, bone="cone")
    add("dust_cap", cl.layer(woof, np.clip(rc + 0.5 - rr, 0, 1).astype(np.float32)), z=1.4, bone="dust_cap")
    # ---------------------------------------------------------------- notch badges (notch_1; bdgen clones them to 2..6)
    icons = {"w": load_icon("w"), "jj": load_icon("jj"), "mm": load_icon("mm")}
    nr = GEO["notchRadius"] * R
    th0 = math.radians(NOTCH_DEG[0])
    n1 = (CX + math.sin(th0) * nr, CY - math.cos(th0) * nr)
    for key, (ic, pips) in {"w1": ("w", 1), "w2": ("w", 2), "w3": ("w", 3), "jj": ("jj", 0), "mm": ("mm", 0)}.items():
        for state in ("off", "next", "lit", "spent"):
            add_img(f"notch_{key}_{state}", badge(icons[ic].copy(), pips, state), n1, z=2.0, bone="notch_1", slot="notch_1")
    # ---------------------------------------------------------------- fx
    # soft fx at half resolution (region_scale 2)
    add_img("glow_ring", glow_ring(370, (rri - 10) / 2, (R + 34) / 2), (CX, CY), z=1.9, bone="fx_glow", slot="fx_glow", blend="additive", color="ffffff00")
    add_img("swirl", swirl(int(rli) + 10), (CX, CY), z=1.35, bone="fx_swirl", slot="fx_swirl", blend="additive", color="ffffff00")
    add_img("cap_flash", cl.glow_disc(int(rc) + 20, (0.75, 1.0, 0.98), alpha=0.9, power=1.6), (CX, CY), z=1.45, bone="fx_cap", slot="fx_cap", blend="additive", color="ffffff00")
    top = (CX, CY - nr)
    add_img("burst_star", burst_star(170), top, z=3.1, bone="fx_notch", slot="fx_burst", blend="additive", color="ffffff00")

    comment = ("ui_groove_meter parts (ANIMATION_SET 3): the woofer of bd_meter_master (80be379d) remapped radially onto "
               "DESIGN 6.1's bands, its cabinet mapped onto 704 x 840 units, notch badges around the approved bd_notch_icons "
               "(c11954bf); tools/spine/examples/bass_drop/cut/cut_meter.py. Canvas 760 x 880 (2x landscape), root = ring "
               "centre (380, 440), R = 320.")
    pj = cl.write_parts(OUT, "meter", parts, canvas=(W, H), comment=comment)

    notch = {}
    for k, deg in enumerate(NOTCH_DEG):
        th = math.radians(deg)
        notch[f"notch_{k + 1}"] = [round(CX + math.sin(th) * nr, 2), round(CY - math.cos(th) * nr, 2)]
    geo = {"canvas": [W, H], "root": [CX, CY], "R": R, "bands": {"counter": rc, "ledInner": rli, "ledOuter": rlo,
           "rimInner": rri, "trim": [round(trim_d[0], 2), round(trim_d[1], 2)], "surround": [round(sur_c - 7.0, 2), rli + 1.5]},
           "notches": notch, "cabinet": {"x": [CX - CAB[0] / 2, CX + CAB[0] / 2], "y": [CY + CAB[2] - CAB[1], CY + CAB[2]],
           "scale": [round(cab_s[0], 5), round(cab_s[1], 5)]}}
    json.dump(geo, open(QA / "cut.json", "w"), indent=1)
    print("geometry:", json.dumps(geo))
    rest = [canv["cabinet_back"], canv["grill_cloth"], canv["cabinet_front"], canv["rim"], canv["trim_base"],
            canv["cone"], canv["surround"], canv["dust_cap"]] + [canv[f"notch_{NOTCH_ICON[0]}_off"]]
    cl.preview(rest, QA / "rest_base.png", bg=(0.106, 0.051, 0.18), scale=1, grid=False)
    cl.preview([canv["rim"], canv["trim_jukejam"], canv["cone"], canv["surround"], canv["dust_cap"]], QA / "ring_jukejam.png",
               bg=(0.106, 0.051, 0.18), scale=1, grid=False)
    # the source art vs the remap (reference for the art director)
    sheet = np.zeros((140 * 4, 140 * 5, 4), np.float32)
    for i, key in enumerate(("w1", "w2", "w3", "jj", "mm")):
        for j, st in enumerate(("off", "next", "lit", "spent")):
            im = cl.load(IMG / f"notch_{key}_{st}.png")
            sheet[j * 140 + 14:j * 140 + 14 + im.shape[0], i * 140 + 14:i * 140 + 14 + im.shape[1]] = im
    bg = np.ones(sheet.shape[:2] + (3,), np.float32) * np.array([0.106, 0.051, 0.18])
    Image.fromarray((np.clip(sheet[..., :3] * sheet[..., 3:] + bg * (1 - sheet[..., 3:]), 0, 1) * 255).astype(np.uint8)).save(QA / "notches.png")
    print(f"cut_meter: {len(parts)} parts -> {pj}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
