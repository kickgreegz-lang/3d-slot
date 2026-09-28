#!/usr/bin/env python3
"""Render a crop of an RGBA/RGB image over grey with a labelled coordinate grid (for authoring cut polygons).
  gridview.py IMG OUT --box x0 y0 x1 y1 [--step 50] [--scale 1.0] [--poly file.json]"""
import argparse, json
from PIL import Image, ImageDraw, ImageFont

ap = argparse.ArgumentParser()
ap.add_argument("img"); ap.add_argument("out")
ap.add_argument("--box", nargs=4, type=int)
ap.add_argument("--step", type=int, default=50)
ap.add_argument("--scale", type=float, default=1.0)
ap.add_argument("--bg", default="190,190,190")
a = ap.parse_args()
im = Image.open(a.img).convert("RGBA")
bg = Image.new("RGBA", im.size, tuple(int(v) for v in a.bg.split(",")) + (255,))
bg.alpha_composite(im)
x0, y0, x1, y1 = a.box or (0, 0, im.size[0], im.size[1])
c = bg.crop((x0, y0, x1, y1))
if a.scale != 1.0:
    c = c.resize((int(c.size[0] * a.scale), int(c.size[1] * a.scale)), Image.LANCZOS)
d = ImageDraw.Draw(c)
try:
    f = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 14)
except OSError:
    f = ImageFont.load_default()
s = a.scale
for x in range((x0 // a.step + 1) * a.step, x1, a.step):
    X = (x - x0) * s
    major = x % (a.step * 2) == 0
    d.line([(X, 0), (X, c.size[1])], fill=(255, 0, 0, 200) if major else (0, 90, 255, 130), width=1)
    if major:
        d.text((X + 2, 2), str(x), fill=(255, 0, 0, 255), font=f)
for y in range((y0 // a.step + 1) * a.step, y1, a.step):
    Y = (y - y0) * s
    major = y % (a.step * 2) == 0
    d.line([(0, Y), (c.size[0], Y)], fill=(255, 0, 0, 200) if major else (0, 90, 255, 130), width=1)
    if major:
        d.text((2, Y + 2), str(y), fill=(255, 0, 0, 255), font=f)
c.convert("RGB").save(a.out)
