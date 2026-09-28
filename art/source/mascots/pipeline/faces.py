#!/usr/bin/env python3
"""Face-variant contact sheet for a master-cut character (parts.json + images): the rest pose with each eye
state, each mouth shape at its jaw angle, and each hand pose, cropped to the head / hands at 2x.

  faces.py <parts.json> <out.png> --head x0 y0 x1 y1 [--jaw deg,deg,...] [--hands x0 y0 x1 y1] [--scale 2]
"""
import argparse, json, math
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw


def load(parts_path):
    d = json.loads(Path(parts_path).read_text())
    root = (Path(parts_path).parent / d["images"] / d["skeleton"]).resolve()
    items = []
    zof = {}
    for p in d["parts"]:
        att = p.get("attachment", p["slot"])
        f = root / (f"{p['slot']}.png" if att == p["slot"] else f"{p['slot']}/{att}.png")
        if "z" in p:
            zof[p["slot"]] = p["z"]
        items.append({**p, "att": att, "img": Image.open(f).convert("RGBA")})
    return d, items, zof


def render(d, items, zof, choose, rot=None):
    W, H = d["canvas"]
    c = Image.new("RGBA", (W, H), (128, 128, 128, 255))
    slots = {}
    for it in items:
        slots.setdefault(it["slot"], []).append(it)
    for s in sorted(slots, key=lambda k: zof.get(k, 0)):
        vs = slots[s]
        want = choose.get(s)
        if want == "none":
            continue
        pick = None
        for v in vs:
            if want and v["att"] == want:
                pick = v
        if pick is None:
            if want:
                pick = next((v for v in vs if v["att"] == want), None)
            if pick is None:
                pick = next((v for v in vs if v.get("setup")), vs[0])
            if pick.get("hidden") and not want:
                continue
        x, y, w, h = pick["bbox"]
        im = pick["img"]
        if rot and s in rot["slots"]:
            cx, cy = rot["at"]
            layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
            layer.alpha_composite(im, (x, y))
            layer = layer.rotate(-rot["deg"], resample=Image.BICUBIC, center=(cx, cy))
            c.alpha_composite(layer)
        else:
            c.alpha_composite(im, (x, y))
    return c


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("parts"); ap.add_argument("out")
    ap.add_argument("--head", nargs=4, type=int, required=True)
    ap.add_argument("--jawslots", default="jaw,teeth_lower")
    ap.add_argument("--mouths", default="closed_pick:0,grin:9,open:18,roar:28")
    ap.add_argument("--hands", nargs=4, type=int)
    ap.add_argument("--scale", type=float, default=2.0)
    a = ap.parse_args()
    d, items, zof = load(a.parts)
    lm = d["landmarks"]
    tiles = []
    x0, y0, x1, y1 = a.head
    for st in ("open", "half", "closed", "wide"):
        tiles.append((f"eyes {st}", render(d, items, zof, {"eye_L": st, "eye_R": st}).crop((x0, y0, x1, y1))))
    for m in a.mouths.split(","):
        name, deg = m.split(":")
        rot = {"slots": a.jawslots.split(","), "at": lm["jaw"], "deg": float(deg)} if float(deg) else None
        tiles.append((f"mouth {name} {deg}", render(d, items, zof, {"mouth": name}, rot).crop((x0, y0, x1, y1))))
    if a.hands:
        hx0, hy0, hx1, hy1 = a.hands
        hs = sorted({it["att"] for it in items if it["slot"].startswith("hand_")})
        for h in hs:
            ch = {f"hand_{s}": h for s in "LR"}
            tiles.append((f"hand {h}", render(d, items, zof, ch).crop((hx0, hy0, hx1, hy1))))
    sc = a.scale
    # one row per group (eyes / mouths / hands), each row as wide as its own tiles
    groups = {}
    for lab, im in tiles:
        groups.setdefault(lab.split()[0], []).append((lab, im))
    rows = []
    for g, ts in groups.items():
        ims = [(lab, im.resize((int(im.size[0] * sc), int(im.size[1] * sc)), Image.LANCZOS)) for lab, im in ts]
        W = sum(im.size[0] for _, im in ims) + 6 * (len(ims) - 1)
        Hh = max(im.size[1] for _, im in ims) + 16
        row = Image.new("RGB", (W, Hh), (30, 30, 30))
        dr = ImageDraw.Draw(row)
        x = 0
        for lab, im in ims:
            row.paste(im.convert("RGB"), (x, 16))
            dr.text((x + 4, 2), lab, fill=(255, 255, 255))
            x += im.size[0] + 6
        rows.append(row)
    out = Path(a.out)
    for g, row in zip(groups, rows):
        f = out.with_name(f"{out.stem}_{g}{out.suffix}")
        row.save(f)
        print(f, row.size)


if __name__ == "__main__":
    main()
