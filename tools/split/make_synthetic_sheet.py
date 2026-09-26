#!/usr/bin/env python3
"""Synthetic part sheets + rig master with exact ground truth, from an existing parts.json (the demo
placeholder rigs in tools/spine/examples: outlined cel parts with round overlap caps on the joints).

  python tools/split/make_synthetic_sheet.py --parts tools/spine/examples/character_demo/gumbo/parts.json \\
      --out build/split-test/gumbo --key FF00FF --master-scale 1.6 --rotate 2.5 --seed 3

Writes OUT/master.png (the setup pose composited over a flat key, scaled by --master-scale, noisy key),
OUT/sheet_<group>.png (every piece incl. variants, scaled by the group's sheet scale, rotated by up to
+-rotate degrees, laid out in rows with wide gaps on the key, like the mascot_parts_sheet.txt /
symbol_parts_sheet.txt layouts) and OUT/truth.json (per piece: group, sheet box, canvas content box,
angle, scale; the master -> canvas transform; the source landmarks). fx_* parts are code-drawn and
never on a sheet.
"""
from __future__ import annotations

import argparse
import json
import math
import re
import sys
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import splitlib as sl  # noqa: E402

GROUPS = [  # character sheets (mascot_parts_sheet.txt B-E)
    ("face", re.compile(r"^(head|jaw|teeth_.*|gold_tooth|nostrils|eye_.*|pupil_.*|brow_.*|lid_.*|mouth|jowl|eye_bulge_.*)$")),
    ("hands", re.compile(r"^hand_[LR]$")),
    ("props", re.compile(r"^(cooler_.*|toothpick|mic|band|cup_[LR]|cable|chain|cap)$")),
    ("body", re.compile(r".*")),
]
DEFAULT_SCALES = {"body": 1.15, "face": 1.45, "hands": 1.3, "props": 1.2, "parts": 3.0}


def hexrgb(h: str) -> np.ndarray:
    h = h.lstrip("#")
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], np.float32) / 255.0


def close_outline(img: np.ndarray, px: int = 2) -> np.ndarray:
    """Art-bible fix for the placeholder art: a closed pure-black ring of `px` around the silhouette
    (the demo feet have claws painted over their outline, which a key matte rightly reads as open)."""
    from scipy import ndimage as ndi
    a = img[..., 3]
    solid = a > 0.5
    ring = ndi.binary_dilation(solid, iterations=px) & ~solid
    out = img.copy()
    out[..., :3][ring] = 0.0
    out[..., 3][ring] = 1.0
    # soft outer edge: one AA pixel
    outer = ndi.binary_dilation(solid | ring, iterations=1) & ~(solid | ring)
    out[..., :3][outer] = 0.0
    out[..., 3][outer] = np.maximum(out[..., 3][outer], 0.5)
    return out


def load_parts(pj: Path, close: bool = True):
    doc = json.loads(pj.read_text())
    kind = doc.get("kind", "symbol")
    root = pj.parent / doc.get("images", "images")
    prefix = doc.get("skeleton") or f"sym_{doc.get('symbol')}"
    zs, setup_seen, out = {}, set(), []
    for pm in doc["parts"]:
        slot = pm.get("slot") or pm.get("name")
        att = pm.get("attachment")
        if "z" in pm:
            zs[slot] = pm["z"]
        if slot.startswith("fx_") or pm.get("blend") == "additive" or re.search(r"_blur$", slot):
            continue
        rel = pm.get("image") or (f"{prefix}/{slot}.png" if not att else f"{prefix}/{slot}/{att}.png")
        arr = np.asarray(Image.open(root / rel).convert("RGBA"), np.float32) / 255.0
        if close:
            arr = close_outline(arr)
        pid = slot if not att else f"{slot}/{att}"
        setup = slot not in setup_seen and not pm.get("hidden")
        setup_seen.add(slot)
        out.append({"pid": pid, "slot": slot, "att": att, "bbox": pm["bbox"], "img": arr, "setup": setup,
                    "hidden": bool(pm.get("hidden"))})
    for p in out:
        p["z"] = zs.get(p["slot"], 0)
    return doc, kind, out


def content_box(bbox, a) -> list[float]:
    ys, xs = np.nonzero(a > 0.5)
    return [bbox[0] + float(xs.min()), bbox[1] + float(ys.min()), bbox[0] + float(xs.max() + 1), bbox[1] + float(ys.max() + 1)]


def _box_iou(a, b) -> float:
    x0, y0 = max(a[0], b[0]), max(a[1], b[1])
    x1, y1 = min(a[2], b[2]), min(a[3], b[3])
    i = max(0.0, x1 - x0) * max(0.0, y1 - y0)
    u = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - i
    return i / u if u else 0.0


def truth_mapping(out: Path, cuts: dict, name: str, kind: str, defaults_from: str, facing: str = "right",
                  fit: str = "matrix", hints: dict | None = None, out_dir: str | None = None) -> dict:
    """Stand-in for the operator: a tools/split mapping whose component -> slot names come from the ground
    truth (component box vs the placed piece box). cuts = {group: path of that sheet's cut components.json}.
    fit 'matrix' uses the true master -> canvas transform (so boxes compare 1:1 with truth.json), else the
    kind's own fit. hints = {pid: place dict} are added as the operator would after reading the preview."""
    t = json.loads((out / "truth.json").read_text())
    sheets = []
    for g, sh in t["sheets"].items():
        comps = json.loads(Path(cuts[g]).read_text())["components"]
        pieces = {}
        for c in comps:
            if c["noise"]:
                continue
            x, y, w, h = c["bbox"]
            pid = max((_box_iou([x, y, x + w, y + h], tp["sheetBox"]), pid) for pid, tp in t["pieces"].items()
                      if tp["group"] == g)[1]
            e: dict = {"slot": pid} if kind == "character" else {"name": pid}
            if hints and pid in hints:
                e["place"] = hints[pid]
            pieces[c["id"]] = e
        sheets.append({"id": g, "image": sh["image"], "expectKey": t["key"], "pieces": pieces})
    M2C = np.linalg.inv(np.array(t["canvasToMaster"]))
    m: dict = {"kind": kind, "master": {"image": str(out / "master.png"), "expectKey": t["key"]},
               "canvas": t["canvas"], "defaultsFrom": defaults_from,
               "out": {"dir": out_dir or str(out / "out")}, "sheets": sheets}
    if fit == "matrix":
        m["fit"] = {"mode": "matrix", "scale": float(M2C[0, 0]), "offset": [float(M2C[0, 2]), float(M2C[1, 2])]}
    if kind == "character":
        m.update({"skeleton": name, "facing": facing, "anchor": [0.5, 1.0]})
        if fit != "matrix":
            m["fit"] = {"mode": "feet"}
    else:
        m["symbol"] = name
    return m


def true_centre(out: Path, pid: str) -> list[float]:
    tc = json.loads((out / "truth.json").read_text())["pieces"][pid]["canvasContent"]
    return [(tc[0] + tc[2]) / 2, (tc[1] + tc[3]) / 2]


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--parts", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--key", default="FF00FF")
    ap.add_argument("--master-scale", type=float, default=1.6)
    ap.add_argument("--margin", type=float, default=0.08, help="master margin (fraction of the figure size)")
    ap.add_argument("--scales", help="group=scale,... sheet px per canvas unit (default body 1.15, face 1.45, "
                                     "hands 1.3, props 1.2; symbols: parts 3.0)")
    ap.add_argument("--rotate", type=float, default=2.0, help="max per-piece rotation on the sheets (deg)")
    ap.add_argument("--gap", type=int, default=48, help="gap between pieces on a sheet (px)")
    ap.add_argument("--row-width", type=int, default=2600)
    ap.add_argument("--noise", type=float, default=2.0, help="key noise amplitude (0-255)")
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--no-close", action="store_true", help="keep the source outlines as they are")
    a = ap.parse_args(argv)
    rng = np.random.default_rng(a.seed)
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    doc, kind, parts = load_parts(Path(a.parts), close=not a.no_close)
    W, H = [int(v) for v in doc["canvas"]]
    key = hexrgb(a.key)
    scales = dict(DEFAULT_SCALES)
    for kv in (a.scales.split(",") if a.scales else []):
        k, v = kv.split("=")
        scales[k.strip()] = float(v)

    # ---- master: setup pose composite at canvas res (padded), scaled, on the key
    pad = 24
    acc = np.zeros((H + 2 * pad, W + 2 * pad, 4), np.float32)
    for p in sorted((p for p in parts if p.get("setup")), key=lambda p: p["z"]):
        x, y, w, h = [int(round(v)) for v in p["bbox"]]
        L = np.zeros_like(acc)
        L[y + pad:y + pad + h, x + pad:x + pad + w] = sl.premultiply(p["img"][..., :3], p["img"][..., 3])
        acc = L + acc * (1 - L[..., 3:4])
    ys, xs = np.nonzero(acc[..., 3] > 1 / 255)
    fx0, fy0, fx1, fy1 = xs.min(), ys.min(), xs.max() + 1, ys.max() + 1
    ms = a.master_scale
    m = int(a.margin * max(fx1 - fx0, fy1 - fy0) * ms)
    crop = acc[fy0:fy1, fx0:fx1]
    big = sl.resize_prem(crop, (int(round((fx1 - fx0) * ms)), int(round((fy1 - fy0) * ms))))
    MH, MW = big.shape[0] + 2 * m, big.shape[1] + 2 * m
    master = np.zeros((MH, MW, 4), np.float32)
    master[m:m + big.shape[0], m:m + big.shape[1]] = big
    kx = big.shape[1] / (fx1 - fx0)
    ky = big.shape[0] / (fy1 - fy0)
    # canvas point c -> master point: (c + pad - f0) * k + m
    C2M = sl.trans_m(m, m) @ sl.scale_m(kx, ky) @ sl.trans_m(pad - fx0, pad - fy0)

    def flatten(prem, shape_rng):
        rgb = prem[..., :3] + key * (1 - prem[..., 3:4])
        noise = shape_rng.uniform(-a.noise, a.noise, rgb.shape[:2] + (1,)).astype(np.float32) / 255.0
        rgb = rgb + noise * (1 - prem[..., 3:4])
        return np.clip(rgb, 0, 1)

    Image.fromarray(sl.to_u8(flatten(master, rng))).save(out / "master.png")

    # ---- sheets
    groups: dict[str, list[dict]] = {}
    for p in parts:
        g = "parts" if kind != "character" else next(n for n, rx in GROUPS if rx.match(p["slot"]))
        groups.setdefault(g, []).append(p)
    truth = {"kind": kind, "canvas": [W, H], "key": "#" + a.key.upper(), "masterScale": ms,
             "canvasToMaster": C2M.tolist(), "landmarks": doc.get("landmarks", {}), "pieces": {}, "sheets": {}}
    for g, ps in groups.items():
        s = scales[g]
        placed, x, y, rowh = [], a.gap, a.gap, 0
        for p in ps:
            ang = float(rng.uniform(-a.rotate, a.rotate))
            img = sl.premultiply(p["img"][..., :3], p["img"][..., 3])
            h, w = img.shape[:2]
            A = sl.rot_m(ang, w * s / 2, h * s / 2) @ sl.scale_m(s)        # piece px -> local sheet px
            pts = sl.apply(A, [[0, 0], [w, 0], [0, h], [w, h]])
            bw = int(math.ceil(pts[:, 0].max() - pts[:, 0].min())) + 4
            bh = int(math.ceil(pts[:, 1].max() - pts[:, 1].min())) + 4
            A = sl.trans_m(2 - pts[:, 0].min(), 2 - pts[:, 1].min()) @ A
            if x + bw > a.row_width and placed:
                x, y, rowh = a.gap, y + rowh + a.gap, 0
            placed.append((p, A, x, y, bw, bh, ang))
            x += bw + a.gap
            rowh = max(rowh, bh)
        SW = max(x0 + bw for _, _, x0, _, bw, _, _ in placed) + a.gap
        SH = y + rowh + a.gap
        sheet = np.zeros((SH, SW, 4), np.float32)
        for p, A, x0, y0, bw, bh, ang in placed:
            img = sl.premultiply(p["img"][..., :3], p["img"][..., 3])
            L = sl.warp_prem(img, sl.trans_m(x0, y0) @ A, (0, 0, SW, SH))
            sheet = L + sheet * (1 - L[..., 3:4])
            box = sl.apply(sl.trans_m(x0, y0) @ A, [[0, 0], [img.shape[1], 0], [0, img.shape[0]], [img.shape[1], img.shape[0]]])
            truth["pieces"][p["pid"]] = {
                "group": g, "slot": p["slot"], "att": p["att"], "setup": p["setup"], "hidden": p["hidden"], "z": p["z"],
                "sheetBox": [float(box[:, 0].min()), float(box[:, 1].min()), float(box[:, 0].max()), float(box[:, 1].max())],
                "canvasContent": content_box(p["bbox"], p["img"][..., 3]), "bbox": p["bbox"],
                "angle": round(ang, 4), "scale": s,
                # piece image px -> sheet px (exact), for registration error checks
                "sheetFromPiece": (sl.trans_m(x0, y0) @ A).tolist()}
        Image.fromarray(sl.to_u8(flatten(sheet, rng))).save(out / f"sheet_{g}.png")
        truth["sheets"][g] = {"image": str(out / f"sheet_{g}.png"), "scale": s, "size": [SW, SH],
                              "sheetToMasterScale": round(ms / s, 5)}
    (out / "truth.json").write_text(json.dumps(truth, indent=1) + "\n")
    print(json.dumps({"master": str(out / "master.png"), "sheets": {g: v["image"] for g, v in truth["sheets"].items()},
                      "pieces": len(truth["pieces"])}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
