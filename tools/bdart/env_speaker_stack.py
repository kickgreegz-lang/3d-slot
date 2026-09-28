#!/usr/bin/env python3
"""env_speaker_stack parts (ANIMATION_SET 4.1: the lower cabinet behind Gumbo), 0 credits.

Plan rows bd_speaker_stack_master / bd_speaker_stack_parts (c12 / c13) could not run (balance below the 8-credit
floor); this is the plan's own fallback, "reuse the meter cabinet art scaled and cropped", extended so the brief still
holds (artbible.bassDrop.props.lower_cabinet: one woofer in the upper two-thirds, two round bass ports, two thick black
cables hanging from the top edge):

- cabinet  : the approved meter cabinet (bd_meter_master 80be379d, full-resolution matte), 9-sliced to 608 x 640
             units: corners + bolts + bevel kept, the face re-laid as a clean lacquered plum panel (smooth fit of
             the painted face + its own brush grain), grill strips and woofer removed (they are separate parts)
- woofer   : the meter rig's own woofer parts (rim, trim band in neutral grey, cone, surround, dust cap) at 0.62x
- port_L/R : the rim ring at 0.19x with a shaded dark port hole (key light upper left) + a matching outline
- cable_1/2: procedurally shaded tubes in formula D terms (single-weight black outline, soft diffuse gradient from
             the upper-left key, crisp white specular, thin cool rim light) with gold jack plugs
- fx       : floor_light (additive cone + pool), glow_ring (additive, half size)

Canvas 720 x 1440 (2x the 304 x 320 landscape design size); root = canvas centre = the cabinet's bottom centre (360,
720), the rig's anchor. Writes art/source/env/spine/images/env_speaker_stack/*.png, art/source/env/speaker_stack/
parts.json and QA previews in build/qa/bdart/env_speaker_stack/.
"""
from __future__ import annotations

import argparse
import json
import math

import cv2
import numpy as np
from PIL import Image
from scipy.spatial import cKDTree

from bglib import REPO, blur, fbm, smoothstep, write_json

MASTER = REPO / "art/_work/c0107/bd_meter_master/matte_full.png"      # the approved master's full-res matte
METER_IMG = REPO / "art/source/spine/images/ui_groove_meter"
METER_PARTS = REPO / "art/source/ui/meter/parts.json"
IMG = REPO / "art/source/env/spine/images/env_speaker_stack"
SRC = REPO / "art/source/env/speaker_stack"
QA = REPO / "build/qa/bdart/env_speaker_stack"
CANVAS = (720, 1440)
CAB = (56, 80, 608, 640)          # x, y, w, h (image space); bottom centre (360, 720)
WOOFER_C = (360.0, 322.0)
WOOFER_D = 404.0
PORT_D = 126.0
PORTS = {"port_L": (246.0, 606.0), "port_R": (474.0, 606.0)}
OUTLINE = 6.5                     # outline weight in units (measured: the cabinet's 18 px at 0.3585)


def premul_resize(rgba: np.ndarray, size: tuple[int, int]) -> np.ndarray:
    a = rgba[..., 3:4]
    pm = np.concatenate([rgba[..., :3] * a, a], -1)
    interp = cv2.INTER_AREA if size[0] < rgba.shape[1] else cv2.INTER_LANCZOS4
    r = cv2.resize(pm, size, interpolation=interp)
    r = np.clip(r, 0, 1)
    al = r[..., 3:4]
    rgb = np.where(al > 1e-4, r[..., :3] / np.maximum(al, 1e-4), 0)
    return np.concatenate([np.clip(rgb, 0, 1), al], -1)


def load(p) -> np.ndarray:
    return np.asarray(Image.open(p).convert("RGBA"), np.float32) / 255.0


def save(a: np.ndarray, name: str, pad: int = 0) -> list[int]:
    """Crop to content (+ pad transparent px), save, return the bbox [x, y, w, h] relative to the array's origin."""
    ys, xs = np.nonzero(a[..., 3] > 1 / 255)
    x0, y0, x1, y1 = xs.min() - pad, ys.min() - pad, xs.max() + 1 + pad, ys.max() + 1 + pad
    IMG.mkdir(parents=True, exist_ok=True)
    Image.fromarray(np.round(a[y0:y1, x0:x1] * 255).astype(np.uint8)).save(IMG / f"{name}.png", optimize=True)
    return [int(x0), int(y0), int(x1 - x0), int(y1 - y0)]


# ------------------------------------------------------------------ cabinet shell
def cabinet() -> np.ndarray:
    m = load(MASTER)
    al = m[..., 3]
    ys, xs = np.nonzero(al > 0.5)
    x0, y0, x1, y1 = xs.min(), ys.min(), xs.max() + 1, ys.max() + 1
    m = m[y0:y1, x0:x1].copy()
    al = m[..., 3]
    H, W = al.shape
    # measured on the master (full res, cabinet-local): bolts, grill strips, woofer
    bolts = [(201, 168), (1495, 168), (201, 1934), (1495, 1934)]
    # erode with a zero border (cv2's default border counts as foreground and the cabinet touches the crop)
    face = cv2.erode((al > 0.5).astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (181, 181)),
                     borderType=cv2.BORDER_CONSTANT, borderValue=0) > 0
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    keep = np.zeros((H, W), bool)
    for bx, by in bolts:
        keep |= (xx - bx) ** 2 + (yy - by) ** 2 < 74 ** 2
    woofer = (xx - 847) ** 2 + (yy - 1079) ** 2 < 720 ** 2
    grills = ((yy > 100) & (yy < 270) | (yy > 1860) & (yy < 2030)) & (xx > 290) & (xx < 1410)
    clean = face & ~keep & ~woofer & ~grills
    # smooth fit of the painted face (cubic in x, y) on the clean wood; keeps its upper-left key-light gradient
    xs_, ys_ = xx[clean] / W, yy[clean] / H
    A = np.stack([np.ones_like(xs_), xs_, ys_, xs_ * ys_, xs_ ** 2, ys_ ** 2, xs_ ** 3, ys_ ** 3, xs_ ** 2 * ys_, xs_ * ys_ ** 2], 1)
    fit = []
    for c in range(3):
        coef, *_ = np.linalg.lstsq(A, m[..., c][clean], rcond=None)
        fit.append(coef)
    X, Y = xx / W, yy / H
    Af = np.stack([np.ones_like(X), X, Y, X * Y, X ** 2, Y ** 2, X ** 3, Y ** 3, X ** 2 * Y, X * Y ** 2], -1)
    panel = np.stack([Af @ f for f in fit], -1)
    resid = (m[..., :3] - panel)[clean]
    grain_amp = float(np.clip(resid.std(), 0.005, 0.03))
    grain = fbm((H, W), seed=7301, octaves=5, base=40.0 / W, stretch=(1.0, 6.0)) - 0.5
    grain = cv2.GaussianBlur(grain, (0, 0), 1.5)
    panel = panel + grain[..., None] * grain_amp * 2.2
    # blend the new panel into the face (soft edge just inside the bevel line), bolts untouched
    repl = (face & ~keep).astype(np.float32)
    repl = cv2.GaussianBlur(repl, (0, 0), 6) * face
    for bx, by in bolts:   # soft ring round each bolt so the new panel meets its painted socket shadow
        d = np.sqrt((xx - bx) ** 2 + (yy - by) ** 2)
        repl *= smoothstep(d, 70, 86)
    rgb = m[..., :3] * (1 - repl[..., None]) + np.clip(panel, 0, 1) * repl[..., None]
    m = np.dstack([rgb, al])
    # 9-slice: keep the top and bottom 520 px (bolts and rounded corners), compress the uniform middle
    s = CAB[2] / W
    target_h = int(round(CAB[3] / s))
    top, bot = m[:520], m[H - 520:]
    mid = m[520:H - 520]
    mid = premul_resize(mid, (W, target_h - 1040))
    shell = np.concatenate([top, mid, bot], 0)
    shell = premul_resize(shell, (CAB[2], CAB[3]))
    return shell


# ------------------------------------------------------------------ woofer and ports
def meter_woofer(names=("rim", "trim_base", "cone", "surround", "dust_cap")) -> np.ndarray:
    """The meter rig's woofer parts composited on its 760 x 880 canvas, cropped to the rim (648 px square)."""
    parts = {p["name"]: p for p in json.loads(METER_PARTS.read_text())["parts"]}
    can = np.zeros((880, 760, 4), np.float32)

    def over(img, x, y):
        h, w = img.shape[:2]
        a = img[..., 3:4]
        dst = can[y:y + h, x:x + w]
        out_a = a + dst[..., 3:4] * (1 - a)
        out_rgb = (img[..., :3] * a + dst[..., :3] * dst[..., 3:4] * (1 - a)) / np.maximum(out_a, 1e-6)
        can[y:y + h, x:x + w] = np.concatenate([out_rgb, out_a], -1)

    for name in names:
        p = parts[name]
        img = load(METER_IMG / f"{name}.png")
        x, y, w, h = p["bbox"]
        if name == "trim_base":      # stored at half size (region_scale 2), recoloured teal per mode: use it grey
            img = premul_resize(img, (w * 2, h * 2))
            g = img[..., :3].mean(-1, keepdims=True)
            img = np.concatenate([np.clip(g * 0.35 + 0.62, 0, 1).repeat(3, -1) * np.array([0.93, 0.93, 0.96]), img[..., 3:4]], -1)
            x, y = x + w // 2 - w, y + h // 2 - h
        over(img, x, y)
    rim = parts["rim"]["bbox"]
    return can[rim[1]:rim[1] + rim[3], rim[0]:rim[0] + rim[2]]


def ring_stroke(size: int, r: float, width: float) -> np.ndarray:
    ss = 4
    im = np.zeros((size * ss, size * ss), np.uint8)
    c = size * ss // 2
    cv2.circle(im, (c, c), int(round(r * ss)), 255, int(round(width * ss)), lineType=cv2.LINE_AA)
    return cv2.resize(im, (size, size), interpolation=cv2.INTER_AREA).astype(np.float32) / 255.0


def port(woof648: np.ndarray) -> np.ndarray:
    """A bass port: the rim ring (0.19x) with the woofer's interior replaced by a shaded dark tube."""
    rimonly = load(METER_IMG / "rim.png")
    n = int(PORT_D) + 8
    img = np.zeros((n, n, 4), np.float32)
    r = premul_resize(rimonly, (int(PORT_D), int(PORT_D)))
    img[4:4 + r.shape[0], 4:4 + r.shape[1]] = r
    yy, xx = np.mgrid[0:n, 0:n].astype(np.float32)
    c = n / 2
    d = np.sqrt((xx - c) ** 2 + (yy - c) ** 2)
    R = PORT_D / 2
    hole_r = R * 0.70
    # tube interior: near black at the back, dark plum wall; the lower-right inner wall catches the key light,
    # the upper-left wall is in shadow
    nx, ny = (xx - c) / hole_r, (yy - c) / hole_r
    wall = smoothstep(np.sqrt(nx ** 2 + ny ** 2), 0.35, 1.0)
    lit = np.clip(0.5 + 0.7 * (nx * 0.6 + ny * 0.8), 0, 1)
    base = np.array([0.035, 0.02, 0.04])
    plum = np.array([0.26, 0.14, 0.22])
    col = base + (plum - base) * (wall * lit)[..., None]
    inside = smoothstep(hole_r + 0.8 - d, 0, 1.6)
    img[..., :3] = img[..., :3] * (1 - inside[..., None]) + col * inside[..., None]
    img[..., 3] = np.maximum(img[..., 3], inside)
    # inner lip outline + an outer outline at the cabinet's weight
    lip = ring_stroke(n, hole_r, 2.4)
    outer = ring_stroke(n, R - 0.5, OUTLINE * 0.7)
    for ln in (lip, outer):
        img[..., :3] = img[..., :3] * (1 - ln[..., None])
        img[..., 3] = np.maximum(img[..., 3], ln)
    return img


# ------------------------------------------------------------------ cables
def catmull(pts: list[tuple[float, float]], n: int = 400) -> np.ndarray:
    P = np.array(pts, np.float64)
    P = np.vstack([P[0] * 2 - P[1], P, P[-1] * 2 - P[-2]])
    out = []
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        for t in np.linspace(0, 1, n // (len(P) - 3), endpoint=False):
            t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    out.append(P[-2])
    return np.array(out)


def resample(curve: np.ndarray, step: float = 0.5) -> np.ndarray:
    seg = np.linalg.norm(np.diff(curve, axis=0), axis=1)
    s = np.concatenate([[0], np.cumsum(seg)])
    u = np.arange(0, s[-1], step)
    return np.stack([np.interp(u, s, curve[:, 0]), np.interp(u, s, curve[:, 1])], 1)


def tube(canvas_hw, curve: np.ndarray, radius: float, base, spec=0.9, ss: int = 3, taper_end: float | None = None) -> np.ndarray:
    """Shade a tube along the curve (image space): diffuse from an upper-left key, a crisp white Blinn specular, a
    thin cool rim light on the shadow side and a single-weight black outline."""
    H, W = canvas_hw
    c = resample(curve, 0.5 / ss) * ss
    tang = np.gradient(c, axis=0)
    tang /= np.linalg.norm(tang, axis=1, keepdims=True) + 1e-9
    nrm = np.stack([-tang[:, 1], tang[:, 0]], 1)
    R = radius * ss
    x0, y0 = np.floor(c.min(0) - R - 4).astype(int)
    x1, y1 = np.ceil(c.max(0) + R + 4).astype(int)
    x0, y0 = max(0, x0), max(0, y0)
    x1, y1 = min(W * ss, x1), min(H * ss, y1)
    gy, gx = np.mgrid[y0:y1, x0:x1].astype(np.float64)
    pts = np.stack([gx.ravel(), gy.ravel()], 1)
    d, idx = cKDTree(c).query(pts)
    d = d.reshape(gx.shape)
    idx = idx.reshape(gx.shape)
    off = np.stack([gx - c[idx, 0], gy - c[idx, 1]], -1)
    u = (off * nrm[idx]).sum(-1) / R          # signed across coordinate, -1..1
    endcap = (idx == 0) | (idx == len(c) - 1)
    inside = (d <= R) & ~(endcap & (np.abs((off * tang[idx]).sum(-1)) > 0.5))
    u = np.clip(u, -1, 1)
    z = np.sqrt(np.clip(1 - u ** 2, 0, 1))
    N = np.concatenate([(u[..., None] * nrm[idx]), z[..., None]], -1)
    L = np.array([-0.55, -0.62, 0.56])
    L /= np.linalg.norm(L)
    V = np.array([0, 0, 1.0])
    Hh = (L + V) / np.linalg.norm(L + V)
    diff = np.clip(N @ L, 0, 1)
    sp = np.clip(N @ Hh, 0, 1) ** 48
    rim = smoothstep(np.abs(u), 0.62, 0.9) * np.clip(-(N[..., :2] @ L[:2]) * 3, 0, 1)
    base = np.asarray(base, np.float64)
    col = base * (0.28 + 0.95 * diff[..., None]) + np.array([1, 1, 1]) * spec * sp[..., None] + np.array([0.45, 0.62, 0.8]) * 0.35 * rim[..., None]
    ow = min(OUTLINE * 0.8, radius * 0.38) * ss / R
    ink = smoothstep(np.abs(u), 1 - ow - 0.04, 1 - ow + 0.02)
    col = col * (1 - ink[..., None])
    a = np.clip((R - d + 0.5 * ss) / ss, 0, 1) * inside
    out = np.zeros((H * ss, W * ss, 4))
    out[y0:y1, x0:x1, :3] = np.clip(col, 0, 1)
    out[y0:y1, x0:x1, 3] = a
    return premul_resize(out.astype(np.float32), (W, H))


def over_rgba(dst: np.ndarray, src: np.ndarray) -> np.ndarray:
    a = src[..., 3:4]
    oa = a + dst[..., 3:4] * (1 - a)
    rgb = (src[..., :3] * a + dst[..., :3] * dst[..., 3:4] * (1 - a)) / np.maximum(oa, 1e-6)
    return np.concatenate([rgb, oa], -1)


def cable(points, plug_len=34.0, radius=12.0) -> np.ndarray:
    H, W = CANVAS[1], CANVAS[0]
    curve = catmull(points)
    body = tube((H, W), curve, radius, (0.13, 0.11, 0.15), spec=0.75)
    # gold jack plug continuing the last tangent: a collar, the sleeve and a short silver tip
    t = curve[-1] - curve[-6]
    t /= np.linalg.norm(t)
    p0 = curve[-1] - t * 4
    collar = tube((H, W), np.array([p0, p0 + t * 22]), radius + 4.0, (0.95, 0.68, 0.12), spec=1.0)
    sleeve = tube((H, W), np.array([p0 + t * 20, p0 + t * (20 + plug_len)]), radius * 0.78, (1.0, 0.78, 0.22), spec=1.0)
    tip = tube((H, W), np.array([p0 + t * (18 + plug_len), p0 + t * (30 + plug_len)]), radius * 0.6, (0.8, 0.82, 0.86), spec=1.0)
    out = over_rgba(body, sleeve)
    out = over_rgba(out, tip)
    out = over_rgba(out, collar)
    return out


# ------------------------------------------------------------------ fx
def floor_light() -> np.ndarray:
    H, W = CANVAS[1], CANVAS[0]
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    # a pool on the floor in front of the cabinet base + a faint cone spilling down from under it
    pool = np.exp(-(((xx - 360) / 300) ** 2 + ((yy - 736) / 46) ** 2) * 1.6)
    cone_w = 250 + (yy - 700) * 1.1
    cone = np.exp(-((xx - 360) / np.maximum(cone_w, 1)) ** 2 * 2.5) * smoothstep(yy, 690, 720) * (1 - smoothstep(yy, 720, 860))
    a = np.clip(0.85 * pool + 0.35 * cone, 0, 1)
    rgb = np.ones((H, W, 3), np.float32)
    return np.dstack([rgb, a * (yy > 640)])


def glow_ring() -> np.ndarray:
    n = int(WOOFER_D * 0.5 + 60)             # stored at half size (region_scale 2)
    yy, xx = np.mgrid[0:n, 0:n].astype(np.float32)
    d = np.sqrt((xx - n / 2) ** 2 + (yy - n / 2) ** 2)
    r = WOOFER_D * 0.25
    a = np.exp(-((d - r) / 7.0) ** 2) * 0.6 + np.exp(-((d - r) / 18.0) ** 2) * 0.25
    return np.dstack([np.ones((n, n, 3), np.float32), np.clip(a, 0, 1)])


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--provenance", action="store_true")
    args = ap.parse_args()
    QA.mkdir(parents=True, exist_ok=True)
    SRC.mkdir(parents=True, exist_ok=True)
    W, H = CANVAS
    parts = []

    def place(img, x, y):
        can = np.zeros((H, W, 4), np.float32)
        h, w = img.shape[:2]
        can[y:y + h, x:x + w] = img
        return can

    cab = cabinet()
    cab_c = place(cab, CAB[0], CAB[1])
    parts.append({"name": "cabinet", "bbox": save(cab_c, "cabinet"), "z": 0.1, "bone": "cabinet"})

    # the woofer in two layers, as on the meter: the rim ring (+ trim) stays on the cabinet, the cone (+ its surround
    # outline and the dust cap) is the pumping mesh drawn over the rim's inner rubber edge
    wf = meter_woofer()
    wx, wy = int(WOOFER_C[0] - WOOFER_D / 2), int(WOOFER_C[1] - WOOFER_D / 2)
    rim_c = place(premul_resize(meter_woofer(("rim", "trim_base")), (int(WOOFER_D), int(WOOFER_D))), wx, wy)
    parts.append({"name": "woofer_rim", "bbox": save(rim_c, "woofer_rim"), "z": 0.3, "bone": "cabinet"})
    cone_c = place(premul_resize(meter_woofer(("cone", "surround", "dust_cap")), (int(WOOFER_D), int(WOOFER_D))), wx, wy)
    parts.append({"name": "woofer", "bbox": save(cone_c, "woofer", pad=8), "z": 0.35, "bone": "woofer"})   # room for the polar hull

    pimg = port(wf)
    for name, (px, py) in PORTS.items():
        n = pimg.shape[0]
        pc = place(pimg, int(px - n / 2), int(py - n / 2))
        parts.append({"name": name, "bbox": save(pc, name), "z": 0.2, "bone": name})

    # cables: over the top edge from behind, draped over the corner, hanging down the sides in front
    c1 = cable([(176, 90), (150, 70), (104, 66), (70, 86), (52, 130), (46, 210), (52, 300), (66, 372)], radius=12.0)
    c2 = cable([(560, 90), (590, 72), (630, 76), (656, 104), (668, 160), (668, 232), (660, 292)], radius=11.0)
    parts.append({"name": "cable_1", "bbox": save(c1, "cable_1"), "z": 0.5, "bone": "cable_1"})
    parts.append({"name": "cable_2", "bbox": save(c2, "cable_2"), "z": 0.5, "bone": "cable_2"})

    fl = floor_light()
    parts.append({"name": "floor_light", "bbox": save(fl, "floor_light"), "z": 0.05, "bone": "fx_floor", "slot": "floor_light",
                  "blend": "additive", "color": "ffffff00"})
    gr = glow_ring()
    n = gr.shape[0]
    gb = save(np.pad(gr, ((0, 0), (0, 0), (0, 0))), "glow_ring")
    parts.append({"name": "glow_ring", "bbox": [int(WOOFER_C[0] - n / 2), int(WOOFER_C[1] - n / 2), gb[2], gb[3]], "z": 0.9,
                  "bone": "fx_glow", "slot": "fx_glow", "blend": "additive", "color": "ffffff00"})
    doc = {"$comment": "env_speaker_stack parts (ANIMATION_SET 4.1), tools/bdart/env_speaker_stack.py: cabinet 9-sliced from the "
                       "approved bd_meter_master (80be379d), woofer = the ui_groove_meter woofer parts, ports from its rim, "
                       "procedural cables + fx. Canvas 720 x 1440 at 2x landscape; root = canvas centre = the cabinet's "
                       "bottom centre (360, 720).",
           "symbol": "env_speaker_stack", "canvas": [W, H], "images": "../spine/images", "parts": parts}
    write_json(SRC / "parts.json", doc)

    # rest-pose preview (normal parts only, z order) on the in-game backdrop colour, full size and at 1x landscape
    rest = np.zeros((H, W, 4), np.float32)
    for p in sorted(parts, key=lambda p: p["z"]):
        if p.get("blend") == "additive":
            continue
        img = load(IMG / f"{p['name']}.png")
        x, y, w, h = p["bbox"]
        can = np.zeros((H, W, 4), np.float32)
        can[y:y + h, x:x + w] = img
        rest = over_rgba(rest, can)
    crop = rest[0:800, :]
    bg = np.ones_like(crop[..., :3]) * np.array([0.12, 0.06, 0.2])
    comp = bg * (1 - crop[..., 3:4]) + crop[..., :3] * crop[..., 3:4]
    Image.fromarray(np.round(comp * 255).astype(np.uint8)).save(QA / "rest_full.png")
    small = Image.fromarray(np.round(comp * 255).astype(np.uint8)).resize((W // 2, 400), Image.LANCZOS)
    small.save(QA / "rest_1x.png")
    print(json.dumps({p["name"]: p["bbox"] for p in parts}))
    if args.provenance:
        from prov import add_rows
        meter = "ui_groove_meter_{}.cut.{}"
        src = {
            "cabinet": (["bd_meter_master_full.matte.3e443493"], "higgsfield",
                        "9-sliced from the approved bd_meter_master matte: corners, bolts and bevel kept, face re-laid as a smooth fit of the painted panel + its grain, grill strips and woofer removed, 608 x 640 units"),
            "woofer_rim": ([meter.format("rim", "f5920888"), meter.format("trim_base", "33dd1905")], "higgsfield",
                           "the meter rig's rim + trim band (trim neutral grey) at 0.62x"),
            "woofer": ([meter.format("cone", "cb90c288"), meter.format("surround", "e158a435"), meter.format("dust_cap", "cdb5a59d")], "higgsfield",
                       "the meter rig's cone + surround + dust cap at 0.62x (polar mesh in the rig)"),
            "port_L": ([meter.format("rim", "f5920888")], "higgsfield", "the meter rim at 0.19x + a shaded port hole"),
            "port_R": ([meter.format("rim", "f5920888")], "higgsfield", "the meter rim at 0.19x + a shaded port hole"),
            "cable_1": ([], "owned-code", "procedural tube (formula D shading: black outline, upper-left key, white specular, cool rim) + gold jack"),
            "cable_2": ([], "owned-code", "procedural tube (formula D shading: black outline, upper-left key, white specular, cool rim) + gold jack"),
            "floor_light": ([], "owned-code", "procedural additive floor pool + cone"),
            "glow_ring": ([], "owned-code", "procedural additive ring, half size (region_scale 2)"),
        }
        rows = [{"id_prefix": f"env_speaker_stack_{n}.cut", "path": f"art/source/env/spine/images/env_speaker_stack/{n}.png",
                 "stage": "layer-split", "parents": par, "license": lic, "script": "tools/bdart/env_speaker_stack.py",
                 "notes": f"env_speaker_stack part '{n}' (plan rows bd_speaker_stack_master/_parts, 0-credit fallback): {what}"}
                for n, (par, lic, what) in src.items()]
        print("provenance rows added:", add_rows(rows))


if __name__ == "__main__":
    main()
