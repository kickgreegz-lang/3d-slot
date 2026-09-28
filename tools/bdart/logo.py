#!/usr/bin/env python3
"""Logo emblem (logo_bd, ANIMATION_SET 1 / 6.1 `logo` region), 0 credits, NO LETTERS.

Plan row bd_logo_emblem (c14) could not run (balance below the 8-credit floor). Its plan fallback is "typeset
word-mark alone on a vector plate"; this builds the emblem the word-mark sits on from approved art instead, to the
artbible.bassDrop.emblems.logo brief ("a chunky stacked badge built around a big speaker cone, flanked by two
gold-capped teal alligator fangs, with a polished gold rim and a pair of bold sound-wave arcs"), with the banner LEFT
BLANK: a typographer sets SWAMP FUNK / BASS DROP as vector on it (ART_BIBLE 8; trademark search before release).

- medallion: the ui_groove_meter woofer parts (cone, surround, dust cap, rim, trim) with the rim hue-mapped from
  silver to polished gold (#FFC629 family) and the trim band to hot pink (#FF3FA8)
- fangs: the W rig master (fang + gold cap + chain), left as is, right mirrored, tilted outward
- arcs: two bold teal sound-wave arcs each side (formula D: black outline, enamel gradient, crisp highlight)
- banner: the approved blank plum ribbon with its gold edge (sym_W_pieces), across the front
Output: art/source/ui/bass-drop/logo/logo_emblem.png (1024 wide, straight alpha) + logo_emblem.json (the banner's
text box for the word-mark, in image px).

  tools/.venv/bin/python tools/bdart/logo.py [--provenance]
"""
from __future__ import annotations

import argparse
import json
import math

import cv2
import numpy as np
from PIL import Image

from bglib import REPO, smoothstep, write_json
from cards import content_bbox, fit_h, load, over, premul_resize, rotate
from env_speaker_stack import meter_woofer

OUT = REPO / "art/source/ui/bass-drop/logo"
QA = REPO / "build/qa/bdart/logo"
CW, CH = 1024, 900


def gold_map(img: np.ndarray, pink_trim: bool = False) -> np.ndarray:
    """Silver -> polished gold by luminance (only low-saturation light pixels: the ring metal, not the black ink,
    rubber or the gold bolts)."""
    rgb = img[..., :3]
    mx, mn = rgb.max(-1), rgb.min(-1)
    sat = (mx - mn) / np.maximum(mx, 1e-4)
    L = rgb @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    metal = smoothstep(L, 0.22, 0.34) * (1 - smoothstep(sat, 0.18, 0.32))
    stops = np.array([0.0, 0.35, 0.7, 1.0], np.float32)
    cols = np.array([[0.30, 0.16, 0.02], [0.78, 0.48, 0.06], [1.0, 0.78, 0.16], [1.0, 0.97, 0.78]], np.float32)
    g = np.stack([np.interp(L, stops, cols[:, c]) for c in range(3)], -1)
    out = rgb * (1 - metal[..., None]) + g * metal[..., None]
    return np.concatenate([out, img[..., 3:4]], -1)


def arcs(cx, cy, radii, spans, width=26.0) -> np.ndarray:
    ss = 3
    ink = np.zeros((CH * ss, CW * ss), np.uint8)
    fill = np.zeros_like(ink)
    hi = np.zeros_like(ink)
    for r in radii:
        for a0, a1 in spans:
            c, ax = (int(cx * ss), int(cy * ss)), (int(r * ss), int(r * ss))
            cv2.ellipse(ink, c, ax, 0, a0, a1, 255, int((width + 12) * ss), lineType=cv2.LINE_AA)
            cv2.ellipse(fill, c, ax, 0, a0 + 1.5, a1 - 1.5, 255, int(width * ss), lineType=cv2.LINE_AA)
            cv2.ellipse(hi, c, (int((r - width * 0.2) * ss),) * 2, 0, a0 + 5, a1 - 5, 255, int(width * 0.2 * ss), lineType=cv2.LINE_AA)
    d = lambda m: cv2.resize(m, (CW, CH), interpolation=cv2.INTER_AREA).astype(np.float32) / 255.0
    ink, fill, hi = d(ink), d(fill), d(hi)
    yy = np.mgrid[0:CH, 0:CW][0].astype(np.float32)
    shade = np.clip(0.55 + 0.45 * (-(yy - cy) / 300.0), 0.2, 1.0)
    col = np.array([0.05, 0.45, 0.52]) + (np.array([0.21, 0.95, 0.88]) - np.array([0.05, 0.45, 0.52])) * shade[..., None]
    col = col * (1 - hi[..., None] * 0.8) + np.array([0.9, 1.0, 1.0]) * hi[..., None] * 0.8
    a = np.maximum(ink, fill)
    rgb = col * (fill / np.maximum(a, 1e-4))[..., None]
    return np.dstack([rgb, a]).astype(np.float32)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--provenance", action="store_true")
    args = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    QA.mkdir(parents=True, exist_ok=True)
    can = np.zeros((CH, CW, 4), np.float32)
    mcx, mcy, md = 512.0, 300.0, 430.0
    # sound-wave arcs behind everything, on the upper diagonals (the fangs take the sides)
    over(can, arcs(mcx, mcy, [md / 2 + 52, md / 2 + 100], [(-62, -28), (208, 242)]), 0, 0)
    # fangs: the W rig master, tilted outward, behind the medallion's edge
    w = load(REPO / "art/source/symbols/W/master_rig_1024.png")
    x0, y0, x1, y1 = content_bbox(w)
    w = w[y0:y1, x0:x1]
    wl = rotate(fit_h(w, 380), -24)
    wr = rotate(fit_h(w[:, ::-1].copy(), 380), 24)
    over(can, wl, 262 - wl.shape[1] / 2, 330 - wl.shape[0] / 2)
    over(can, wr, 762 - wr.shape[1] / 2, 330 - wr.shape[0] / 2)
    # medallion: gold-rimmed woofer with a hot-pink trim band
    rim = gold_map(meter_woofer(("rim",)))
    trim = meter_woofer(("trim_base",))
    t = trim[..., :3].mean(-1, keepdims=True)
    trim = np.concatenate([np.clip(np.array([1.0, 0.25, 0.66]) * (0.55 + 0.6 * t), 0, 1), trim[..., 3:4]], -1)
    cone = meter_woofer(("cone", "surround", "dust_cap"))
    med = np.zeros_like(rim)
    for layer in (rim, trim, cone):
        over(med, layer, 0, 0)
    med = premul_resize(med, (md, md))
    over(can, med, mcx - md / 2, mcy - md / 2)
    # banner: the approved blank ribbon across the front (the word-mark goes on its face)
    rib = load(REPO / "art/source/symbols/W/pieces/ribbon.png")
    x0, y0, x1, y1 = content_bbox(rib)
    rib = rib[y0:y1, x0:x1]
    bw = 960.0
    rib = premul_resize(rib, (bw, rib.shape[0] * bw / rib.shape[1]))
    bx, by = (CW - rib.shape[1]) / 2, 452.0
    over(can, rib, bx, by)
    x0, y0, x1, y1 = content_bbox(can, 0.004)
    can = can[y0:y1, x0:x1]
    # the banner's blank face (text box for the typographer): the ribbon's plum band, measured on the ribbon piece
    plum = (np.abs(can[..., 0] - 0.3) < 0.15) & (can[..., 2] > can[..., 1]) & (can[..., 3] > 0.9)
    band = plum[int(by - y0 + 20):int(by - y0 + rib.shape[0] - 20)]
    ys, xs = np.nonzero(band)
    tb = [int(np.percentile(xs, 3)), int(np.percentile(ys, 3) + by - y0 + 20), int(np.percentile(xs, 97) - np.percentile(xs, 3)),
          int(np.percentile(ys, 97) - np.percentile(ys, 3))]
    Image.fromarray(np.round(np.clip(can, 0, 1) * 255).astype(np.uint8)).save(OUT / "logo_emblem.png", optimize=True)
    meta = {"$comment": "logo_bd emblem, no letters (tools/bdart/logo.py). textBox = the blank banner face [x, y, w, h] in "
                        "image px, where the typeset SWAMP FUNK / BASS DROP word-mark goes (typographer, vector; trademark "
                        "search before release). Region sizes: landscape logo 428 x 236 design px, intro 400 x 270.",
            "size": [int(can.shape[1]), int(can.shape[0])], "textBox": tb}
    write_json(OUT / "logo_emblem.json", meta)
    # QA: on the dark plate at full size and at the landscape logo size (428 wide), with the text box outlined
    bg = np.ones((can.shape[0], can.shape[1], 3), np.float32) * np.array([0.12, 0.07, 0.2])
    comp = bg * (1 - can[..., 3:4]) + can[..., :3] * can[..., 3:4]
    im = Image.fromarray(np.round(comp * 255).astype(np.uint8))
    from PIL import ImageDraw
    im2 = im.copy()
    ImageDraw.Draw(im2).rectangle((tb[0], tb[1], tb[0] + tb[2], tb[1] + tb[3]), outline=(255, 220, 60), width=3)
    im2.save(QA / "logo_full.png")
    im.resize((428, int(428 * im.height / im.width)), Image.LANCZOS).save(QA / "logo_428.png")
    print(json.dumps(meta))
    if args.provenance:
        from prov import add_rows
        rows = [{"id_prefix": "bd_logo_emblem.source", "path": "art/source/ui/bass-drop/logo/logo_emblem.png", "stage": "layer-split",
                 "parents": ["ui_groove_meter_rim.cut.f5920888", "ui_groove_meter_trim_base.cut.33dd1905", "ui_groove_meter_cone.cut.cb90c288",
                             "ui_groove_meter_surround.cut.e158a435", "ui_groove_meter_dust_cap.cut.cdb5a59d", "sym_w_rig.source.b411179c",
                             "sym_w_ribbon.cut.96c81577"],
                 "script": "tools/bdart/logo.py",
                 "notes": "0-credit stand-in for row bd_logo_emblem: composite crest of approved art (gold-mapped woofer medallion, "
                          "two W fangs, teal arcs, the blank ribbon as banner); no letters; the word-mark stays typeset vector"}]
        print("provenance rows added:", add_rows(rows))


if __name__ == "__main__":
    main()
