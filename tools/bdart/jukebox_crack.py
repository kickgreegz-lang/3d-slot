#!/usr/bin/env python3
"""Juke Jam emblem crack state + shards for ui_feature_upgrade (ANIMATION_SET 6.4: crack f12, shatter f18).

Plan row bd_emblem_jukebox_cracked (c14) is replaced by its 0-credit fallback ("Procedural crack lines drawn over the
emblem"); the shards are the plan's notGenerated 'shards' item (seeded cut of the approved art). One geometry serves
both: six jagged radial cracks from an impact point on the glass window split the emblem into six wedges, so the crack
lines shown at f12 are exactly where the shards separate at f18.

Formula D finish: black crack lines (tapered, jagged, with short branches and a ring fracture round the impact) with
a thin cream chipped edge on their upper-left side (key light upper left); every shard gets a black outline along its
cut edge, so a flying shard reads as a closed outlined piece. Nothing else on the emblem changes (the crack layer is
composited over the approved art/source/ui/bass-drop/emblems/jukebox.png, same 1024 canvas).

  tools/.venv/bin/python tools/bdart/jukebox_crack.py [--provenance]
"""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw

from bglib import REPO, write_json

SRC = REPO / "art/source/ui/bass-drop/emblems/jukebox.png"
OUT = REPO / "art/source/ui/bass-drop/emblems"
QA = REPO / "build/qa/bdart/jukebox_crack"
SS = 2                      # supersampling of the crack drawing
IMPACT = (556.0, 318.0)     # on the glass dome, upper right of the record label (1024 canvas)
N = 6
SEED = 6406


def jagged_ray(rng, origin, base_deg, length, step=16.0, max_dev=16.0):
    pts = [origin]
    dev = 0.0
    x, y = origin
    r = 0.0
    while r < length:
        dev = float(np.clip(0.55 * dev + rng.normal(0, 11.0), -max_dev, max_dev))
        ang = math.radians(base_deg + dev)
        s = step * rng.uniform(0.7, 1.3)
        x, y = x + s * math.cos(ang), y + s * math.sin(ang)
        r = math.hypot(x - origin[0], y - origin[1])
        pts.append((x, y))
    return pts


def branch(rng, start, base_deg, length):
    pts = [start]
    x, y = start
    d = 0.0
    while d < length:
        ang = math.radians(base_deg + rng.normal(0, 22))
        s = rng.uniform(8, 16)
        x, y = x + s * math.cos(ang), y + s * math.sin(ang)
        d += s
        pts.append((x, y))
    return pts


def stroke(draw_img: np.ndarray, pts, w0, w1, colour, offset=(0.0, 0.0)):
    """Tapered polyline (width w0 -> w1) on a supersampled float canvas (alpha-premultiplied single colour)."""
    n = len(pts)
    for i in range(n - 1):
        t = i / max(1, n - 2)
        w = (w0 + (w1 - w0) * t) * SS
        p0 = (int(round((pts[i][0] + offset[0]) * SS)), int(round((pts[i][1] + offset[1]) * SS)))
        p1 = (int(round((pts[i + 1][0] + offset[0]) * SS)), int(round((pts[i + 1][1] + offset[1]) * SS)))
        cv2.line(draw_img, p0, p1, colour, max(1, int(round(w))), lineType=cv2.LINE_AA)
        cv2.circle(draw_img, p1, max(1, int(round(w / 2))), colour, -1, lineType=cv2.LINE_AA)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--provenance", action="store_true")
    args = ap.parse_args()
    QA.mkdir(parents=True, exist_ok=True)
    src = np.asarray(Image.open(SRC).convert("RGBA")).astype(np.float32) / 255.0
    H, W = src.shape[:2]
    alpha = src[..., 3]
    rng = np.random.default_rng(SEED)

    # six main cracks, evenly spread with jitter; the first points down-left through the lamp bands
    base = [rng.uniform(-8, 8) + a for a in (100, 160, 215, 270, 330, 30)]
    rays = [jagged_ray(rng, IMPACT, b, 900) for b in base]

    # shards = wedges between consecutive rays (angle-sorted), clipped to the emblem alpha
    order = sorted(range(N), key=lambda i: base[i] % 360)
    labels = np.zeros((H, W), np.int32)
    for k in range(N):
        a, b = rays[order[k]], rays[order[(k + 1) % N]]
        poly = np.array(a + b[::-1], np.float32)
        m = np.zeros((H, W), np.uint8)
        cv2.fillPoly(m, [np.round(poly).astype(np.int32)], 1)
        labels[(m > 0) & (labels == 0)] = k + 1
    labels[alpha < 0.02] = 0

    # crack layer (supersampled): chipped highlight first, then the black line on top
    hi = np.zeros((H * SS, W * SS), np.float32)
    ink = np.zeros((H * SS, W * SS), np.float32)
    for r in rays:
        stroke(hi, r, 3.2, 1.4, 1.0, offset=(-3.6, -3.6))
        stroke(ink, r, 11.0, 4.0, 1.0)
    branches = []
    for r in rays:
        for _ in range(5):
            j = int(rng.integers(2, max(3, len(r) - 4)))
            ang = math.degrees(math.atan2(r[j][1] - r[j - 1][1], r[j][0] - r[j - 1][0])) + rng.choice([-1, 1]) * rng.uniform(28, 55)
            br = branch(rng, r[j], ang, rng.uniform(30, 95))
            branches.append(br)
            stroke(hi, br, 2.2, 1.0, 1.0, offset=(-2.8, -2.8))
            stroke(ink, br, 6.0, 2.0, 1.0)
    # ring fracture round the impact: short jagged arcs between neighbouring rays
    for rad in (30.0, 58.0):
        for k in range(N):
            if rng.random() < 0.3 and rad > 40:
                continue
            ra, rb = rays[order[k]], rays[order[(k + 1) % N]]
            def at(r):   # the point of ray r nearest to radius rad (the chord starts on the crack itself)
                d = [abs(math.hypot(px - IMPACT[0], py - IMPACT[1]) - rad) for px, py in r]
                return r[int(np.argmin(d))]
            pa, pb = at(ra), at(rb)
            mid = ((pa[0] + pb[0]) / 2 + rng.normal(0, 2), (pa[1] + pb[1]) / 2 + rng.normal(0, 2))
            chord = [pa, mid, pb]
            stroke(hi, chord, 2.2, 2.0, 1.0, offset=(-2.6, -2.6))
            stroke(ink, chord, 5.0, 4.0, 1.0)
    # the impact point: a small dark pit with a white-hot star of glass chips
    star = np.zeros((H * SS, W * SS), np.float32)
    for k in range(14):
        ang = rng.uniform(0, 2 * math.pi)
        ln = rng.uniform(18, 40)
        p0 = (int(IMPACT[0] * SS), int(IMPACT[1] * SS))
        tip = (IMPACT[0] + ln * math.cos(ang), IMPACT[1] + ln * math.sin(ang))
        side = (IMPACT[0] + 7 * math.cos(ang + 0.5), IMPACT[1] + 7 * math.sin(ang + 0.5))
        tri = np.array([[IMPACT[0], IMPACT[1]], side, tip], np.float32) * SS
        cv2.fillPoly(star, [np.round(tri).astype(np.int32)], 1.0, lineType=cv2.LINE_AA)
    cv2.circle(ink, (int(IMPACT[0] * SS), int(IMPACT[1] * SS)), int(9 * SS), 1.0, -1, lineType=cv2.LINE_AA)

    def down(a):
        return cv2.resize(a, (W, H), interpolation=cv2.INTER_AREA)
    hi, ink, star = down(hi), down(ink), down(star)
    inside = cv2.erode((alpha > 0.5).astype(np.uint8), np.ones((5, 5), np.uint8)).astype(np.float32)
    inside = cv2.GaussianBlur(inside, (0, 0), 1.0)
    hi, ink, star = hi * inside, ink * inside, star * inside

    rgb = src[..., :3].copy()
    chip = np.array([1.0, 0.96, 0.84], np.float32)          # cream chipped edge (the emblem's lit cream)
    glass = np.array([0.92, 1.0, 1.0], np.float32)
    ink_c = np.array([0.02, 0.02, 0.03], np.float32)
    rgb = rgb * (1 - 0.85 * hi[..., None]) + chip * 0.85 * hi[..., None]
    rgb = rgb * (1 - 0.9 * star[..., None]) + glass * 0.9 * star[..., None]
    rgb = rgb * (1 - ink[..., None]) + ink_c * ink[..., None]
    cracked = np.dstack([rgb, alpha])
    Image.fromarray(np.round(cracked * 255).astype(np.uint8)).save(OUT / "jukebox_cracked.png", optimize=True)

    # shards: each wedge of the cracked emblem + a black outline along its cut edges (half the crack width each side)
    sh_dir = OUT / "jukebox_shards"
    sh_dir.mkdir(parents=True, exist_ok=True)
    meta = {"$comment": "Juke Jam emblem shards for ui_feature_upgrade shard_1..6 (ANIMATION_SET 6.4), cut along the "
                        "crack lines of jukebox_cracked.png (same 1024 canvas as jukebox.png). bbox = [x, y, w, h] on "
                        "that canvas; centroid; burst = unit vector from the impact point through the centroid.",
            "canvas": [W, H], "impact": list(IMPACT), "shards": []}
    cut_all = np.zeros((H, W), np.float32)
    for k in range(1, N + 1):
        m = (labels == k).astype(np.uint8)
        if m.sum() < 500:
            continue
        # cut edge = boundary of the wedge that is not the emblem's own silhouette boundary
        dist = cv2.distanceTransform(m, cv2.DIST_L2, 5)
        other = cv2.dilate(((labels != k) & (labels > 0)).astype(np.uint8), np.ones((3, 3), np.uint8))
        near_cut = cv2.distanceTransform(1 - other, cv2.DIST_L2, 5)
        edge = np.clip(1.0 - (near_cut - 4.0) / 1.5, 0, 1) * (m > 0)
        cut_all = np.maximum(cut_all, edge)
        a = np.clip(cv2.GaussianBlur(m.astype(np.float32), (0, 0), 0.6), 0, 1) * alpha * (m > 0).astype(np.float32)
        # soft edge along the cut only (the outer silhouette keeps its own anti-aliasing)
        a = np.where(near_cut < 2.0, np.clip(dist / 1.2, 0, 1) * alpha, alpha) * (m > 0)
        col = rgb * (1 - edge[..., None]) + ink_c * edge[..., None]
        ys, xs = np.nonzero(a > 0.004)
        x0, y0, x1, y1 = xs.min(), ys.min(), xs.max() + 1, ys.max() + 1
        piece = np.dstack([col, a])[y0:y1, x0:x1]
        name = f"shard_{k}"
        Image.fromarray(np.round(piece * 255).astype(np.uint8)).save(sh_dir / f"{name}.png", optimize=True)
        cy, cx = float(ys.mean()), float(xs.mean())
        v = np.array([cx - IMPACT[0], cy - IMPACT[1]])
        v = v / (np.linalg.norm(v) + 1e-6)
        meta["shards"].append({"name": name, "bbox": [int(x0), int(y0), int(x1 - x0), int(y1 - y0)],
                               "centroid": [round(cx, 1), round(cy, 1)], "burst": [round(float(v[0]), 3), round(float(v[1]), 3)],
                               "area": int(m.sum())})
    write_json(sh_dir / "shards.json", meta)

    # QA: original | cracked | exploded shards, on dark and at the 120 / 60 px emblem sizes
    def over(img, bgc=(40, 30, 60)):
        bg = Image.new("RGBA", img.size, bgc + (255,))
        bg.alpha_composite(img)
        return bg.convert("RGB")
    orig_i = Image.open(SRC).convert("RGBA")
    crk_i = Image.open(OUT / "jukebox_cracked.png")
    boom = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    for s in meta["shards"]:
        p = Image.open(sh_dir / f"{s['name']}.png")
        dx, dy = s["burst"]
        boom.alpha_composite(p, (int(s["bbox"][0] + dx * 70), int(s["bbox"][1] + dy * 70)))
    sheet = Image.new("RGB", (3 * 512, 512 + 140), (20, 20, 24))
    for i, im in enumerate([orig_i, crk_i, boom]):
        sheet.paste(over(im).resize((512, 512), Image.LANCZOS), (i * 512, 0))
        sheet.paste(over(im).resize((120, 120), Image.LANCZOS), (i * 512 + 10, 512 + 10))
        sheet.paste(over(im).resize((60, 60), Image.LANCZOS), (i * 512 + 150, 512 + 10))
    sheet.save(QA / "sheet.png")
    over(crk_i).save(QA / "cracked_full.png")
    # nothing else changes: pixels farther than 12 px from any crack are identical to the source
    far = cv2.dilate((np.maximum(np.maximum(ink, hi), star) > 0.01).astype(np.uint8), np.ones((25, 25), np.uint8)) == 0
    diff = np.abs(np.asarray(crk_i, np.float32) - np.asarray(orig_i, np.float32)).max(-1)
    rep = {"unchangedAwayFromCracks": bool(diff[far].max() < 1), "maxDiffAway": float(diff[far].max()),
           "crackCoverage": round(float((ink > 0.5).sum() / (alpha > 0.5).sum()), 4),
           "shards": len(meta["shards"]),
           "shardAreaCoverage": round(sum(s["area"] for s in meta["shards"]) / float((alpha > 0.02).sum()), 4)}
    write_json(QA / "report.json", rep)
    print(json.dumps(rep))
    if args.provenance:
        from prov import add_rows
        rows = [{"id_prefix": "bd_emblem_jukebox_cracked.source", "path": "art/source/ui/bass-drop/emblems/jukebox_cracked.png",
                 "stage": "layer-split", "parents": ["bd_emblem_jukebox.source.ac851568"], "script": "tools/bdart/jukebox_crack.py",
                 "notes": "0-credit plan fallback for row bd_emblem_jukebox_cracked: procedural jagged crack lines (6 radial + "
                          "branches + ring fracture, cream chipped edge) over the approved jukebox emblem; pixels away from the "
                          f"cracks unchanged ({rep['unchangedAwayFromCracks']})", "qa": {"passed": rep["unchangedAwayFromCracks"], "report": "build/qa/bdart/jukebox_crack/report.json"}}]
        for s in meta["shards"]:
            rows.append({"id_prefix": f"bd_emblem_jukebox_{s['name']}.cut", "path": f"art/source/ui/bass-drop/emblems/jukebox_shards/{s['name']}.png",
                         "stage": "layer-split", "parents": ["bd_emblem_jukebox.source.ac851568"], "script": "tools/bdart/jukebox_crack.py",
                         "notes": f"jukebox shard {s['name']} for ui_feature_upgrade: wedge of the cracked emblem cut along its crack lines, "
                                  f"black outline on the cut edge; bbox {s['bbox']} on the 1024 canvas"})
        print("provenance rows added:", add_rows(rows))


if __name__ == "__main__":
    main()
