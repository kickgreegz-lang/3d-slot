"""Shared helpers for the Bass Drop 0-credit background builds (tools/bdart/backgrounds.py).

Plates are float32 sRGB arrays in [0, 1], shape (H, W, 3). Everything is deterministic (seeded noise), so a rebuild
reproduces the same bytes for the same inputs.
"""
from __future__ import annotations

import hashlib
import io
import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

REPO = Path(__file__).resolve().parents[2]

# approved raws (art/plan/approvals.json): bg_base_landscape = ab1 ab_bg_painted (924d3637),
# bd_bg_base_portrait = bd_c07 (01d29fe8)
RAW_LANDSCAPE = REPO / "art/_raw/ab_bg_painted/v01/raw.png"
RAW_PORTRAIT = REPO / "art/_raw/bd_bg_base_portrait/v01/raw.png"
OUT_LANDSCAPE = (2560, 1280)   # 2:1, size policy <= 2560 px wide
OUT_PORTRAIT = (1536, 3072)    # 1:2, same as base_portrait.webp (c0107)


def sha256_file(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def load_rgb(p: Path) -> np.ndarray:
    return np.asarray(Image.open(p).convert("RGB"), dtype=np.float32) / 255.0


def centre_crop(img: Image.Image, aspect: float) -> tuple[Image.Image, tuple[int, int, int, int]]:
    """Crop the centre of img to width/height == aspect (only one dimension shrinks)."""
    w, h = img.size
    if w / h > aspect:
        nw = int(round(h * aspect))
        x0 = (w - nw) // 2
        box = (x0, 0, x0 + nw, h)
    else:
        nh = int(round(w / aspect))
        y0 = (h - nh) // 2
        box = (0, y0, w, y0 + nh)
    return img.crop(box), box


def base_plate(orient: str) -> tuple[np.ndarray, dict]:
    """The approved base plate at the output size: landscape = 21:9 raw centre-cropped to 2:1, portrait = 9:16 raw
    centre-cropped to 1:2 (the same crop as base_portrait.webp), both Lanczos-downsampled (never upscaled)."""
    raw = RAW_LANDSCAPE if orient == "landscape" else RAW_PORTRAIT
    size = OUT_LANDSCAPE if orient == "landscape" else OUT_PORTRAIT
    img = Image.open(raw).convert("RGB")
    crop, box = centre_crop(img, size[0] / size[1])
    assert crop.size[0] >= size[0] and crop.size[1] >= size[1], "would upscale"
    out = crop.resize(size, Image.LANCZOS)
    info = {"raw": str(raw.relative_to(REPO)), "rawSize": list(img.size), "crop": list(box), "size": list(size)}
    return np.asarray(out, dtype=np.float32) / 255.0, info


def to_u8(a: np.ndarray) -> np.ndarray:
    return np.clip(np.round(a * 255.0), 0, 255).astype(np.uint8)


def save_webp(a: np.ndarray, p: Path, quality: int = 92) -> int:
    p.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(to_u8(a)).save(p, "WEBP", quality=quality, method=6)
    return p.stat().st_size


def save_png(a: np.ndarray, p: Path) -> int:
    p.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(to_u8(a)).save(p, optimize=True)
    return p.stat().st_size


# ---------------------------------------------------------------- colour helpers
def srgb_to_linear(a: np.ndarray) -> np.ndarray:
    return np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(a: np.ndarray) -> np.ndarray:
    a = np.clip(a, 0, None)
    return np.where(a <= 0.0031308, a * 12.92, 1.055 * np.power(a, 1 / 2.4) - 0.055)


def luma(a: np.ndarray) -> np.ndarray:
    """Rec. 709 relative luminance of an sRGB plate (computed in linear light, returned in [0, 1] linear)."""
    lin = srgb_to_linear(a)
    return lin[..., 0] * 0.2126 + lin[..., 1] * 0.7152 + lin[..., 2] * 0.0722


def lightness(a: np.ndarray) -> np.ndarray:
    """CIE L* / 100 (perceptual lightness), the unit the darker-centre gate reports."""
    y = luma(a)
    return np.where(y > 216 / 24389, 116 * np.cbrt(y) - 16, y * 24389 / 27) / 100.0


def hsv(a: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    hsv_ = cv2.cvtColor(a.astype(np.float32), cv2.COLOR_RGB2HSV)  # H in degrees 0..360, S, V in 0..1
    return hsv_[..., 0], hsv_[..., 1], hsv_[..., 2]


def blur(a: np.ndarray, sigma: float) -> np.ndarray:
    if sigma <= 0:
        return a
    return cv2.GaussianBlur(a, (0, 0), sigmaX=sigma, sigmaY=sigma, borderType=cv2.BORDER_REFLECT)


def smoothstep(x: np.ndarray, e0: float, e1: float) -> np.ndarray:
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def hue_gate(h: np.ndarray, centre: float, half: float, soft: float = 12.0) -> np.ndarray:
    d = np.abs((h - centre + 180.0) % 360.0 - 180.0)
    return 1.0 - smoothstep(d, half, half + soft)


def fbm(shape: tuple[int, int], seed: int, octaves: int = 5, base: float = 0.004, stretch: tuple[float, float] = (1, 1)) -> np.ndarray:
    """Seeded fractal value noise in [0, 1] (bilinear-upsampled random grids), stretch = (sx, sy) feature scale."""
    h, w = shape
    rng = np.random.default_rng(seed)
    acc = np.zeros(shape, np.float32)
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        f = base * (2 ** o)
        gw = max(2, int(w * f / stretch[0]) + 2)
        gh = max(2, int(h * f / stretch[1]) + 2)
        grid = rng.random((gh, gw)).astype(np.float32)
        layer = cv2.resize(grid, (w, h), interpolation=cv2.INTER_CUBIC)
        acc += amp * layer
        tot += amp
        amp *= 0.5
    acc /= tot
    lo, hi = np.percentile(acc, 1), np.percentile(acc, 99)
    return np.clip((acc - lo) / (hi - lo), 0, 1)


def screen(base: np.ndarray, layer: np.ndarray) -> np.ndarray:
    return 1.0 - (1.0 - base) * (1.0 - np.clip(layer, 0, 1))


# ---------------------------------------------------------------- gates
def darker_centre(a: np.ndarray, band: tuple[float, float] | None = None) -> dict:
    """ART_BIBLE 8 / PIPELINE 2.3: mean lightness (L*) of the central 60 % of the width below the mean of the outer
    20 % bands. band = optional (y0, y1) fractions to restrict the rows (e.g. the reel band)."""
    L = lightness(a)
    h, w = L.shape
    if band:
        L = L[int(band[0] * h):int(band[1] * h)]
    x0, x1 = int(0.2 * w), int(0.8 * w)
    c = float(L[:, x0:x1].mean())
    le = float(L[:, :x0].mean())
    ri = float(L[:, x1:].mean())
    return {"centre": round(c, 4), "left": round(le, 4), "right": round(ri, 4), "edges": round((le + ri) / 2, 4),
            "darkerCentre": bool(c < (le + ri) / 2), "band": list(band) if band else None}


def edge_iou(a: np.ndarray, b: np.ndarray) -> float:
    """layoutMatch (ART_PLAN 6): IoU of the Canny edge maps (dilated 2 px) at 1/4 size, so a variant keeps every shape
    where the base has it."""
    def edges(x):
        g = cv2.cvtColor(to_u8(x), cv2.COLOR_RGB2GRAY)
        g = cv2.resize(g, (g.shape[1] // 4, g.shape[0] // 4), interpolation=cv2.INTER_AREA)
        e = cv2.Canny(g, 40, 100) > 0
        return cv2.dilate(e.astype(np.uint8), np.ones((5, 5), np.uint8)) > 0
    ea, eb = edges(a), edges(b)
    return float((ea & eb).sum() / max(1, (ea | eb).sum()))


def write_json(p: Path, obj) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(obj, indent=1) + "\n")
