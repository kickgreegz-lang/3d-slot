#!/usr/bin/env python3
"""Bass Drop royals L1-L5 (A K Q J 10) in the formula-D finish, 0 credits (ART_PLAN §2 'Royals', open decision 2:
'gradient shading built into the vector').

    tools/.venv/bin/python tools/royals/build_royals.py [--out art/source/symbols] [--size 1024] [--provenance]

Each glyph is set in Lilita One (the game's royal face, public/assets/fonts, OFL) and painted procedurally:
  * a single-weight near-black outline (formula D: ~3% of the cell once fitted at cellScale 0.86);
  * a rounded bevel from the inside distance field (height = smoothstep over the bevel width) lit by the bible's
    key light from the upper left (Lambert + a tight white specular), a warm bounce along the bottom and a thin
    cool rim on the lower-right edge (formula D);
  * a jewel-tone body from SYMBOLS[id].color (src/games/bass-drop/config.ts): lighter at the top, into the
    shade at the bottom, plus low-frequency painterly value noise on the face;
  * a slight forward lean (skew), as the phase-B royals.
Output: straight-alpha RGBA PNG, 1024 square, content centred, max side 0.86 x canvas (the runtime re-fits the
measured content to cellScale of the cell anyway). No text beyond the glyph itself; deterministic (seeded noise).
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

REPO = Path(__file__).resolve().parents[2]

# id, glyph, base colour, shade (config.ts: royal(id, glyph, label, color, shade)); shade is the game's plum 0x4b283d,
# the painted shadow side mixes toward a darker version of the hue instead (formula D: no plum extrusion)
ROYALS = [("L1", "A", 0xD13242), ("L2", "K", 0xF1C81C), ("L3", "Q", 0x75D92A), ("L4", "J", 0xE6A37F), ("L5", "10", 0xAA621B)]
OUTLINE = np.array([22, 12, 26], np.float32) / 255.0  # near-black plum, as the formula-D symbols' ink
COOL_RIM = np.array([150, 215, 255], np.float32) / 255.0
WARM_BOUNCE = np.array([255, 150, 70], np.float32) / 255.0


def rgb(c: int) -> np.ndarray:
    return np.array([(c >> 16) & 255, (c >> 8) & 255, c & 255], np.float32) / 255.0


MASKS = REPO / "build/royals/masks"


def ensure_masks(glyphs) -> None:
    """Glyph masks come from Chromium (tools/royals/glyph_masks.mjs): PIL cannot read WOFF2."""
    if all((MASKS / f"{g}.png").exists() for g in glyphs):
        return
    import subprocess
    subprocess.run(["node", str(REPO / "tools/royals/glyph_masks.mjs"), "--out", str(MASKS), "--px", "2048",
                    "--glyphs", ",".join(glyphs)], check=True, cwd=REPO)


def glyph_mask(text: str, size: int, fill: float, skew: float) -> np.ndarray:
    """Anti-aliased glyph coverage (float 0..1) with a forward lean, content fitted to `fill` of the canvas."""
    a = np.array(Image.open(MASKS / f"{text}.png").convert("L"), np.float32) / 255.0
    h, w = a.shape
    M = np.float32([[1, -skew, skew * h / 2], [0, 1, 0]])  # x' = x + skew * (h/2 - y): tops lean right
    a = cv2.warpAffine(a, M, (w, h), flags=cv2.INTER_LINEAR)
    ys, xs = np.nonzero(a > 0.02)
    a = a[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    k = (size * fill) / max(a.shape)
    a = cv2.resize(a, (max(1, round(a.shape[1] * k)), max(1, round(a.shape[0] * k))), interpolation=cv2.INTER_AREA)
    out = np.zeros((size, size), np.float32)
    oy, ox = (size - a.shape[0]) // 2, (size - a.shape[1]) // 2
    out[oy:oy + a.shape[0], ox:ox + a.shape[1]] = a
    return out


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def value_noise(shape, scale, seed):
    rng = np.random.default_rng(seed)
    h, w = shape
    g = rng.random((h // scale + 3, w // scale + 3)).astype(np.float32)
    n = cv2.resize(g, (w + 2 * scale, h + 2 * scale), interpolation=cv2.INTER_CUBIC)[scale:scale + h, scale:scale + w]
    return (n - n.mean()) / (n.std() + 1e-6)


def paint(glyph: str, color: int, size: int, seed: int) -> Image.Image:
    fill_frac = 0.80
    outline_px = 0.030 * size / 0.86 * fill_frac  # ~3% of the fitted cell
    m = glyph_mask(glyph, size, fill_frac - 2 * outline_px / size, skew=0.08)
    inside = (m > 0.5).astype(np.uint8)
    d_in = cv2.distanceTransform(inside, cv2.DIST_L2, cv2.DIST_MASK_PRECISE) + (m - 0.5)  # sub-pixel edge
    d_in = np.where(inside > 0, cv2.GaussianBlur(d_in, (0, 0), 1.5), d_in)  # no contour steps on the bevel
    d_out = cv2.distanceTransform(1 - inside, cv2.DIST_L2, cv2.DIST_MASK_PRECISE)
    body_a = np.clip(m, 0, 1)
    outer_a = np.clip(outline_px + 0.5 - d_out, 0, 1) * (1 - inside) + inside
    outer_a = np.maximum(outer_a, body_a)

    ys, xs = np.nonzero(inside)
    y0, y1 = ys.min(), ys.max()
    Y = np.clip((np.arange(size, dtype=np.float32)[:, None] - y0) / max(1, y1 - y0), 0, 1) * np.ones((1, size), np.float32)

    bevel = 0.07 * size
    t = np.clip(d_in / bevel, 0, 1)
    height = np.sqrt(1 - (1 - t) ** 2)  # rounded (pillow) profile, flat face beyond the bevel
    hb = cv2.GaussianBlur(height, (0, 0), size * 0.005)
    gy, gx = np.gradient(hb * bevel * 0.9)
    n = np.dstack([-gx, -gy, np.ones_like(gx)])
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    L = np.array([-0.55, -0.62, 0.56], np.float32)
    L /= np.linalg.norm(L)
    diff = np.clip((n * L).sum(2), 0, 1)
    H = L + np.array([0, 0, 1], np.float32)
    H /= np.linalg.norm(H)
    nh = np.clip((n * H).sum(2), 0, 1)
    spec = 0.45 * nh ** 22 + 0.75 * nh ** 180

    base = rgb(color)
    hsv = cv2.cvtColor(base[None, None].astype(np.float32), cv2.COLOR_RGB2HSV)[0, 0]
    if hsv[1] < 0.8:  # jewel tone: lift dull hues (J peach, 10 bronze) toward saturation, keep the hue
        hsv[1] = min(1.0, hsv[1] * 1.22)
        base = cv2.cvtColor(hsv[None, None], cv2.COLOR_HSV2RGB)[0, 0]
    lum = float(base @ np.array([0.2126, 0.7152, 0.0722], np.float32))
    # value floor for the darkest hue (A red, luminance 0.33): on the navy tile it must still read in greyscale
    light = base + (1 - base) * (0.46 if lum < 0.4 else 0.38)
    dark = base * (0.6 if lum < 0.4 else 0.42)
    grad = (light[None, None] * (1 - Y[..., None]) ** 1.4 + base[None, None] * 0.0)
    body = light[None, None] * (1 - smoothstep(0.0, 0.55, Y))[..., None] \
        + base[None, None] * (smoothstep(0.0, 0.55, Y) * (1 - smoothstep(0.55, 1.0, Y)))[..., None] \
        + dark[None, None] * smoothstep(0.55, 1.0, Y)[..., None]
    del grad
    # painterly value noise on the face only
    face = smoothstep(bevel * 0.9, bevel * 1.6, d_in)
    nz = value_noise((size, size), max(8, size // 24), seed) * 0.02 + value_noise((size, size), max(4, size // 90), seed + 1) * 0.006
    body = body * (1 + nz[..., None] * face[..., None])
    # lighting: Lambert on the bevel, soft on the face
    shade = 0.62 + 0.55 * diff
    col = body * shade[..., None]
    # warm bounce along the bottom of the glyph, cool thin rim on the lower-right edge
    bounce = smoothstep(0.72, 1.0, Y) * (1 - face) * 0.35
    col = col * (1 - bounce[..., None]) + (col * 0.5 + WARM_BOUNCE * 0.5) * bounce[..., None]
    rim_dir = np.clip((n * np.array([0.6, 0.75, 0.0], np.float32)).sum(2) * 2.2, 0, 1)
    rim = rim_dir * (1 - smoothstep(0, bevel * 0.25, d_in)) * 0.38
    col = col * (1 - rim[..., None]) + COOL_RIM * rim[..., None]
    # glossy lacquer: specular hotspots + a soft upper-left sheen on the face
    sheen = face * (1 - smoothstep(0.05, 0.45, Y)) * 0.10
    col = col + spec[..., None] * 0.95 + sheen[..., None]
    col = np.clip(col, 0, 1)

    rgbf = OUTLINE[None, None] * (1 - body_a[..., None]) + col * body_a[..., None]
    a = outer_a
    out = np.dstack([rgbf, a])
    return Image.fromarray((np.clip(out, 0, 1) * 255 + 0.5).astype(np.uint8), "RGBA")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(REPO / "art/source/symbols"))
    ap.add_argument("--size", type=int, default=1024)
    ap.add_argument("--only")
    ap.add_argument("--provenance", action="store_true", help="append art/manifest.json rows (tools/gen/provenance.py)")
    a = ap.parse_args()
    ensure_masks([g for _, g, _ in ROYALS])
    written = []
    for i, (sid, glyph, color) in enumerate(ROYALS):
        if a.only and sid not in a.only.split(","):
            continue
        im = paint(glyph, color, a.size, seed=1000 + i)
        p = Path(a.out) / sid / "master_1024.png"
        p.parent.mkdir(parents=True, exist_ok=True)
        im.save(p, optimize=True)
        written.append((sid, glyph, p))
        print(f"build_royals: {sid} '{glyph}' -> {p.relative_to(REPO) if p.is_relative_to(REPO) else p} ({p.stat().st_size // 1024} KB)")
    if a.provenance:
        sys.path.insert(0, str(REPO / "tools/gen"))
        import provenance as P
        rows = []
        for sid, glyph, p in written:
            sha = P.sha256_file(p)
            rows.append(P.make_row(
                id=P.safe_id(f"sym_{sid.lower()}.royal.{sha[:8]}"), path=p, stage="vector-ui", sha256=sha, vendor="self",
                model="tools/royals/build_royals.py", version="phase-c", license_id="fonts-bundled", route="code",
                notes=f"Royal {glyph} ({sid}): Lilita One glyph (OFL, public/assets/fonts) painted procedurally in the "
                      "formula-D finish (outline, bevel light upper left, bounce, cool rim, face noise); 0 credits"))
        print(f"build_royals: {P.append_rows(P.MANIFEST, rows, generated_by='tools/royals')} manifest rows appended")
    return 0


if __name__ == "__main__":
    sys.exit(main())
