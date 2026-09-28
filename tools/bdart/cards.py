#!/usr/bin/env python3
"""Intro card illustrations for ui_intro_cards (ANIMATION_SET 6.1, DESIGN 12), 0 credits.

Plan rows bd_card_meter / bd_card_jukejam / bd_card_megamix (c14) could not run (balance below the 8-credit floor);
this is their plan fallback: "composite the approved W, badges, emblem and meter over a background crop". Every object
is approved art at its own resolution (never upscaled): the meter master, the jukebox and crowned-speaker emblems, the
W rig master + its ribbon, badge tiers and clamps (placed exactly as the sym_W rig places them), over a darkened,
softened crop of the matching background plate (base / Juke Jam / Mega Mix, tools/bdart/backgrounds.py). The only drawn
elements are the meter card's sound-wave arcs (formula D: black outline, cyan enamel) and soft contact shadows.

Square 1024 masters with the subject inside the central two-thirds, so both skins crop from one image: landscape
(tall card art) and portrait (wide art, art left / text right). No text anywhere (titles and bodies are live text).

  tools/.venv/bin/python tools/bdart/cards.py [--provenance]
"""
from __future__ import annotations

import argparse
import json
import math

import cv2
import numpy as np
from PIL import Image

from bglib import REPO, blur, lightness, smoothstep, write_json

OUT = REPO / "art/source/ui/bass-drop/cards"
QA = REPO / "build/qa/bdart/cards"
W_SRC = REPO / "art/source/symbols/W"
W_IMG = REPO / "art/source/spine/images/sym_W"
BG = REPO / "art/source/backgrounds/bass-drop"
S = 1024


def load(p) -> np.ndarray:
    return np.asarray(Image.open(p).convert("RGBA"), np.float32) / 255.0


def content_bbox(a: np.ndarray, thr: float = 0.02):
    ys, xs = np.nonzero(a[..., 3] > thr)
    return xs.min(), ys.min(), xs.max() + 1, ys.max() + 1


def premul_resize(rgba: np.ndarray, size) -> np.ndarray:
    size = (max(1, int(round(size[0]))), max(1, int(round(size[1]))))
    a = rgba[..., 3:4]
    pm = np.concatenate([rgba[..., :3] * a, a], -1)
    r = cv2.resize(pm, size, interpolation=cv2.INTER_AREA if size[0] < rgba.shape[1] else cv2.INTER_CUBIC)
    r = np.clip(r, 0, 1)
    al = r[..., 3:4]
    return np.concatenate([np.where(al > 1e-4, r[..., :3] / np.maximum(al, 1e-4), 0), al], -1)


def over(dst: np.ndarray, src: np.ndarray, x: float, y: float) -> None:
    """Straight-alpha src over dst (in place) with src's top-left at (x, y); clipped to dst."""
    x, y = int(round(x)), int(round(y))
    h, w = src.shape[:2]
    X0, Y0, X1, Y1 = max(0, x), max(0, y), min(dst.shape[1], x + w), min(dst.shape[0], y + h)
    if X0 >= X1 or Y0 >= Y1:
        return
    s = src[Y0 - y:Y1 - y, X0 - x:X1 - x]
    d = dst[Y0:Y1, X0:X1]
    a = s[..., 3:4]
    oa = a + d[..., 3:4] * (1 - a)
    rgb = (s[..., :3] * a + d[..., :3] * d[..., 3:4] * (1 - a)) / np.maximum(oa, 1e-6)
    dst[Y0:Y1, X0:X1] = np.concatenate([rgb, oa], -1)


def rotate(rgba: np.ndarray, deg: float) -> np.ndarray:
    if abs(deg) < 1e-3:
        return rgba
    h, w = rgba.shape[:2]
    d = int(math.ceil(math.hypot(w, h)))
    pad = np.zeros((d, d, 4), np.float32)
    pad[(d - h) // 2:(d - h) // 2 + h, (d - w) // 2:(d - w) // 2 + w] = rgba
    M = cv2.getRotationMatrix2D((d / 2, d / 2), -deg, 1.0)
    a = pad[..., 3:4]
    pm = np.concatenate([pad[..., :3] * a, a], -1)
    r = cv2.warpAffine(pm, M, (d, d), flags=cv2.INTER_CUBIC, borderValue=(0, 0, 0, 0))
    r = np.clip(r, 0, 1)
    al = r[..., 3:4]
    out = np.concatenate([np.where(al > 1e-4, r[..., :3] / np.maximum(al, 1e-4), 0), al], -1)
    x0, y0, x1, y1 = content_bbox(out, 0.004)
    return out[y0:y1, x0:x1]


# ------------------------------------------------------------------ the W, composed like the sym_W rig
def compose_w(skin: str = "default", tier: int = 1, K: float = 3.0) -> np.ndarray:
    """The W's setup pose on the 360 canvas at K x, from the high-resolution sources: the rig master for fang + cap +
    chain, the pieces for ribbon / badge / clamps, each at the scale the rig used (matched on content width)."""
    parts = {p["name"]: p for p in json.loads((W_SRC / "parts.json").read_text())["parts"]}
    C = int(360 * K)
    can = np.zeros((C, C, 4), np.float32)

    def rig_content(name):
        im = load(W_IMG / f"{name}.png")
        x0, y0, x1, y1 = content_bbox(im)
        bx, by = parts[name]["bbox"][:2]
        return (bx + x0, by + y0, bx + x1, by + y1)

    def place(src, name, flip=False, rot=0):
        if rot:
            src = np.rot90(src, k=rot).copy()
        if flip:
            src = src[:, ::-1].copy()
        sx0, sy0, sx1, sy1 = content_bbox(src)
        src = src[sy0:sy1, sx0:sx1]
        cx0, cy0, cx1, cy1 = rig_content(name)
        tw, th = (cx1 - cx0) * K, (cy1 - cy0) * K
        img = premul_resize(src, (tw, th))
        over(can, img, cx0 * K, cy0 * K)

    # fang + cap + chain: the rig master mapped onto the union of the three rig parts' visible content
    m = load(W_SRC / "master_rig_1024.png")
    mx0, my0, mx1, my1 = content_bbox(m)
    boxes = [rig_content(n) for n in ("tooth", "cap", "chain")]
    ux0, uy0 = min(b[0] for b in boxes), min(b[1] for b in boxes)
    ux1, uy1 = max(b[2] for b in boxes), max(b[3] for b in boxes)
    base = premul_resize(m[my0:my1, mx0:mx1], ((ux1 - ux0) * K, (uy1 - uy0) * K))
    over(can, base, ux0 * K, uy0 * K)
    place(load(W_SRC / "pieces/ribbon.png"), "ribbon")
    # the cap's lower rim sits over the ribbon: redraw the master pixels under the rig cap's alpha
    cap = load(W_IMG / "cap.png")
    cb = parts["cap"]["bbox"]
    cap_a = premul_resize(cap, (cb[2] * K, cb[3] * K))[..., 3]
    layer = np.zeros_like(can)
    over(layer, base, ux0 * K, uy0 * K)
    x, y = int(round(cb[0] * K)), int(round(cb[1] * K))
    mask = np.zeros(can.shape[:2], np.float32)
    h, w = cap_a.shape
    mask[y:y + h, x:x + w] = cap_a[:mask.shape[0] - y, :mask.shape[1] - x]
    capl = layer.copy()
    capl[..., 3] *= mask
    over(can, capl, 0, 0)
    if skin == "sticky":
        cl = load(W_SRC / "pieces/clamp.png")
        place(cl, "clamp_shut_L", rot=-1)
        place(cl, "clamp_shut_R", rot=-1, flip=True)
    if skin in ("mult", "sticky"):
        place(load(W_SRC / f"pieces/badge_t{tier}.png"), f"badge_t{tier}")
    x0, y0, x1, y1 = content_bbox(can, 0.004)
    return can[y0:y1, x0:x1]


# ------------------------------------------------------------------ helpers for the scenes
def backdrop(name: str, box: tuple[float, float, float], dark: float = 0.55) -> np.ndarray:
    """A square crop (cx, cy, size as fractions of the plate height) of a background plate, softened, darkened and
    lower in contrast than the subject, with a vignette."""
    im = np.asarray(Image.open(BG / f"{name}.webp").convert("RGB"), np.float32) / 255.0
    H, W = im.shape[:2]
    cx, cy, sz = box
    s = int(sz * H)
    x0 = int(np.clip(cx * W - s / 2, 0, W - s))
    y0 = int(np.clip(cy * H - s / 2, 0, H - s))
    crop = im[y0:y0 + s, x0:x0 + s]
    crop = cv2.resize(crop, (S, S), interpolation=cv2.INTER_AREA if s > S else cv2.INTER_CUBIC)
    crop = blur(crop, 3.0)
    mean = crop.mean((0, 1), keepdims=True)
    crop = mean + (crop - mean) * 0.75
    yy, xx = np.mgrid[0:S, 0:S].astype(np.float32) / S
    vig = 1 - 0.45 * smoothstep(np.sqrt((xx - 0.5) ** 2 + (yy - 0.5) ** 2), 0.25, 0.75)
    return np.clip(crop * dark * vig[..., None], 0, 1)


def fit_h(img: np.ndarray, h: float) -> np.ndarray:
    return premul_resize(img, (img.shape[1] * h / img.shape[0], h))


def contact_shadow(can: np.ndarray, cx: float, cy: float, rx: float, ry: float, a: float = 0.55) -> None:
    yy, xx = np.mgrid[0:S, 0:S].astype(np.float32)
    d = ((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2
    sh = np.exp(-d * 2.2) * a
    can[..., :3] *= (1 - sh[..., None])


def backlight(can: np.ndarray, cx: float, cy: float, r: float, col, a: float) -> None:
    """A soft painted halo behind the subject (part of the backdrop, drawn before the subject)."""
    yy, xx = np.mgrid[0:S, 0:S].astype(np.float32)
    d = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2) / r
    h = np.exp(-d ** 2 * 1.4) * a
    col = np.asarray(col, np.float32)
    can[..., :3] = 1 - (1 - can[..., :3]) * (1 - col * h[..., None])


def wave_arcs(cx: float, cy: float, radii, span: float, width: float = 20.0) -> np.ndarray:
    """')))' sound-wave arcs on both sides, formula D: a single-weight black outline round cyan enamel with a soft
    gradient and a crisp highlight line (key light upper left)."""
    ss = 3
    ink = np.zeros((S * ss, S * ss), np.uint8)
    fill = np.zeros_like(ink)
    hi = np.zeros_like(ink)
    for i, r in enumerate(radii):
        w = width * (1 - 0.12 * i)
        for base in (0, 180):
            a0, a1 = base - span, base + span
            c = (int(cx * ss), int(cy * ss))
            ax = (int(r * ss), int(r * ss))
            cv2.ellipse(ink, c, ax, 0, a0, a1, 255, int((w + 10) * ss), lineType=cv2.LINE_AA)
            cv2.ellipse(fill, c, ax, 0, a0 + 1.2, a1 - 1.2, 255, int(w * ss), lineType=cv2.LINE_AA)
            axh = (int((r - w * 0.22) * ss), int((r - w * 0.22) * ss))
            cv2.ellipse(hi, c, axh, 0, a0 + 4, a1 - 4, 255, int(max(2, w * 0.18) * ss), lineType=cv2.LINE_AA)
    d = lambda m: cv2.resize(m, (S, S), interpolation=cv2.INTER_AREA).astype(np.float32) / 255.0
    ink, fill, hi = d(ink), d(fill), d(hi)
    # round the arc ends: soften the ink and fill caps with a tiny blur
    yy, xx = np.mgrid[0:S, 0:S].astype(np.float32)
    shade = np.clip(0.55 + 0.45 * (-(yy - cy) / (max(radii) + 40)), 0.2, 1.0)      # lighter toward the top
    cyan = np.array([0.21, 0.95, 0.88])
    deep = np.array([0.05, 0.45, 0.52])
    col = deep + (cyan - deep) * shade[..., None]
    col = col * (1 - hi[..., None] * 0.8) + np.array([0.9, 1.0, 1.0]) * hi[..., None] * 0.8
    rgb = np.zeros((S, S, 3), np.float32) * (1 - fill[..., None]) + col * fill[..., None]
    rgb = rgb * fill[..., None]
    a = np.maximum(ink, fill)
    return np.dstack([np.where(a[..., None] > 1e-4, rgb / np.maximum(a[..., None], 1e-4), 0), a]).astype(np.float32)


# ------------------------------------------------------------------ the three cards
def card_meter() -> np.ndarray:
    can = np.dstack([backdrop("base_landscape", (0.17, 0.42, 0.62), 0.5), np.ones((S, S), np.float32)])
    backlight(can, 512, 470, 430, (0.21, 0.95, 0.88), 0.22)
    cab = load(REPO / "art/source/ui/bass-drop/groove_meter/master.png")
    x0, y0, x1, y1 = content_bbox(cab)
    cab = fit_h(cab[y0:y1, x0:x1], 640)
    cx, top = 512, 250
    contact_shadow(can, cx, top + 640, 300, 40, 0.6)
    over(can, cab, cx - cab.shape[1] / 2, top)
    # woofer centre in the master: (412, 510) of 825 x 1024 -> card space
    sc = 640 / (y1 - y0)
    wcx, wcy = cx + (412 - (x0 + x1) / 2) * sc, top + (510 - y0) * sc
    rim_r = 300 * sc
    over(can, wave_arcs(wcx, wcy, [rim_r + 70, rim_r + 125, rim_r + 180], 34, 20), 0, 0)
    # the fang bursts out of the cone toward the viewer: a burst star on the cone, the fang lifted up and out of it,
    # bigger than the cone, the dust cap still showing under it (the arcs carry the boom)
    w = compose_w("default", K=3.0)
    w = rotate(fit_h(w, 470), -18)
    over(can, w, wcx - w.shape[1] / 2 + 58, wcy - w.shape[0] / 2 - 130)
    return can


def w_row(can, skin: str, tiers, ys, xs, heights, rots):
    for t, x, y, h, r in zip(tiers, xs, ys, heights, rots):
        w = rotate(fit_h(compose_w(skin, t, K=3.0), h), r)
        contact_shadow(can, x, y + h * 0.48, h * 0.42, h * 0.07, 0.5)
        over(can, w, x - w.shape[1] / 2, y - w.shape[0] / 2)


def card_jukejam() -> np.ndarray:
    can = np.dstack([backdrop("jukejam_landscape", (0.32, 0.36, 0.66), 0.62), np.ones((S, S), np.float32)])
    backlight(can, 512, 400, 460, (1.0, 0.78, 0.16), 0.2)
    jb = load(REPO / "art/source/ui/bass-drop/emblems/jukebox.png")
    x0, y0, x1, y1 = content_bbox(jb)
    jb = fit_h(jb[y0:y1, x0:x1], 600)
    contact_shadow(can, 512, 170 + 600, 280, 36, 0.55)
    over(can, jb, 512 - jb.shape[1] / 2, 170)
    # three multiplier wilds in front: teal, lime, teal (blank plates; the x-values are never painted)
    w_row(can, "mult", [1, 2, 1], [766, 792, 766], [276, 512, 748], [268, 322, 268], [-14, 0, 14])
    return can


def card_megamix() -> np.ndarray:
    can = np.dstack([backdrop("megamix_landscape", (0.80, 0.62, 0.66), 0.6), np.ones((S, S), np.float32)])
    backlight(can, 512, 400, 460, (1.0, 0.25, 0.66), 0.22)
    mm = load(REPO / "art/source/ui/bass-drop/emblems/mega_speaker.png")
    x0, y0, x1, y1 = content_bbox(mm)
    mm = fit_h(mm[y0:y1, x0:x1], 590)
    contact_shadow(can, 512, 160 + 590, 300, 36, 0.55)
    over(can, mm, 512 - mm.shape[1] / 2, 160)
    # three sticky wilds held by the gold clamp brackets: gold, pink (with the flame crown), gold
    w_row(can, "sticky", [3, 5, 3], [772, 792, 772], [272, 512, 752], [262, 322, 262], [-12, 0, 12])
    return can


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--provenance", action="store_true")
    args = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    QA.mkdir(parents=True, exist_ok=True)
    rep = {}
    tiles = []
    for name, fn in (("art_meter", card_meter), ("art_jukejam", card_jukejam), ("art_megamix", card_megamix)):
        img = fn()
        rgb = np.clip(img[..., :3], 0, 1)
        p = OUT / f"{name}.png"
        Image.fromarray(np.round(rgb * 255).astype(np.uint8)).save(p, optimize=True)
        if p.stat().st_size > 1_450_000:
            p.unlink()
            p = OUT / f"{name}.webp"
            Image.fromarray(np.round(rgb * 255).astype(np.uint8)).save(p, "WEBP", lossless=True, quality=100, method=6)
        L = lightness(rgb)
        c = L[S // 6:S * 5 // 6, S // 6:S * 5 // 6].mean()
        edge = np.concatenate([L[:S // 8].ravel(), L[-S // 8:].ravel(), L[:, :S // 8].ravel(), L[:, -S // 8:].ravel()]).mean()
        rep[name] = {"path": str(p.relative_to(REPO)), "bytes": p.stat().st_size, "size": [S, S],
                     "centreL": round(float(c), 4), "edgeL": round(float(edge), 4)}
        tiles.append((name, rgb))
    # QA: full sheet + the two skin crops (landscape tall 0.75, portrait wide 1.33) at in-game size
    sheet = Image.new("RGB", (3 * 512 + 40, 512 + 20 + 300 + 20), (18, 18, 22))
    for i, (name, rgb) in enumerate(tiles):
        im = Image.fromarray(np.round(rgb * 255).astype(np.uint8))
        sheet.paste(im.resize((512, 512), Image.LANCZOS), (i * 532, 0))
        tall = im.crop((S // 2 - 330, 60, S // 2 + 330, 60 + 880)).resize((170, 227), Image.LANCZOS)      # ~ 0.75
        wide = im.crop((40, 170, S - 40, 170 + 710)).resize((250, 188), Image.LANCZOS)                   # ~ 1.33
        sheet.paste(tall, (i * 532, 532))
        sheet.paste(wide, (i * 532 + 190, 532))
    sheet.save(QA / "cards.png")
    write_json(QA / "report.json", rep)
    print(json.dumps(rep, indent=1))
    if args.provenance:
        from prov import add_rows
        par = {"art_meter": ["bd_meter_master.source.0be9b5f3", "sym_w_rig.source.b411179c", "sym_w_ribbon.cut.96c81577"],
               "art_jukejam": ["bd_emblem_jukebox.source.ac851568", "sym_w_rig.source.b411179c", "sym_w_ribbon.cut.96c81577",
                               "sym_w_badge_t1.tier.30c5d27e", "sym_w_badge_t2.tier.6f60f7e0"],
               "art_megamix": ["bd_emblem_mega_speaker.source.34607c30", "sym_w_rig.source.b411179c", "sym_w_ribbon.cut.96c81577",
                               "sym_w_badge_t3.cut.9383b485", "sym_w_badge_t5.tier.2b6ddc5e", "sym_w_clamp.cut.8ef8ed1c"]}
        bgrow = {"art_meter": "bg_base_landscape", "art_jukejam": "bd_bg_jukejam_landscape", "art_megamix": "bd_bg_megamix_landscape"}
        doc = json.loads((REPO / "art/manifest.json").read_text())
        rows = []
        for name, ent in rep.items():
            bgp = {"art_meter": "base_landscape", "art_jukejam": "jukejam_landscape", "art_megamix": "megamix_landscape"}[name]
            bg_id = [r["id"] for r in doc["rows"] if r["path"] == f"art/source/backgrounds/bass-drop/{bgp}.webp"][-1]
            rows.append({"id_prefix": f"bd_card_{name[4:]}.source", "path": ent["path"], "stage": "layer-split",
                         "parents": par[name] + [bg_id], "script": "tools/bdart/cards.py",
                         "notes": f"0-credit plan fallback for row bd_card_{name[4:]}: composite of approved art over a "
                                  f"softened {bgrow[name]} crop; no text; 1024 square master for both skin crops"})
        print("provenance rows added:", add_rows(rows))


if __name__ == "__main__":
    main()
