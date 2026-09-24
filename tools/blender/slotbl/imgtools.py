"""Frame post-processing and image QA metrics (numpy + Pillow only, no bpy, no scipy).

All metrics work on RGBA uint8 arrays at the FINAL frame size. Alpha-aware maths uses
premultiplied colour so transparent pixels never contribute their (meaningless) RGB.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont


# ----------------------------------------------------------------------------- I/O ---
def load_rgba(path) -> np.ndarray:
    with Image.open(path) as im:
        return np.asarray(im.convert("RGBA")).copy()


def save_png(img, path) -> Path:
    """Deterministic PNG (Pillow writes no timestamps; fixed compression level)."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if isinstance(img, np.ndarray):
        img = Image.fromarray(img)
    img.save(path, format="PNG", compress_level=6)
    return path


def downscale_premult(img: Image.Image, size) -> Image.Image:
    """Lanczos resize in premultiplied space (no dark/colour fringes on the alpha edge)."""
    if isinstance(size, int):
        size = (size, size)
    img = img.convert("RGBA")
    if img.size == tuple(size):
        return img
    return img.convert("RGBa").resize(size, Image.LANCZOS).convert("RGBA")


def fit_into_canvas(img: Image.Image, canvas: int, content_scale: float) -> Image.Image:
    """Scale `img` by content_scale and centre it on a transparent canvas x canvas image."""
    w = max(1, round(img.width * content_scale))
    h = max(1, round(img.height * content_scale))
    small = downscale_premult(img, (w, h))
    out = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    out.alpha_composite(small, ((canvas - w) // 2, (canvas - h) // 2))
    return out


# ------------------------------------------------------------------------- metrics ---
def alpha(a: np.ndarray) -> np.ndarray:
    return a[..., 3].astype(np.float32) / 255.0


def mask(a: np.ndarray, thr: float = 0.5) -> np.ndarray:
    return alpha(a) >= thr


def bbox(m: np.ndarray):
    ys, xs = np.nonzero(m)
    if len(xs) == 0:
        return None
    return [int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1]


def premult(a: np.ndarray) -> np.ndarray:
    f = a.astype(np.float32)
    f[..., :3] *= f[..., 3:4] / 255.0
    return f


def mad(a: np.ndarray, b: np.ndarray) -> float:
    """Mean absolute difference of premultiplied RGBA, in 0..255 units."""
    if a.shape != b.shape:
        raise ValueError(f"shape mismatch {a.shape} vs {b.shape}")
    return float(np.abs(premult(a) - premult(b)).mean())


def max_abs_diff(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.abs(premult(a) - premult(b)).max())


def coverage(a: np.ndarray, thr: float = 0.02) -> float:
    return float((alpha(a) > thr).mean())


def _dilate4(m: np.ndarray) -> np.ndarray:
    d = m.copy()
    d[1:] |= m[:-1]
    d[:-1] |= m[1:]
    d[:, 1:] |= m[:, :-1]
    d[:, :-1] |= m[:, 1:]
    return d


def flood(seed: np.ndarray, allowed: np.ndarray) -> np.ndarray:
    """4-connected flood fill of `seed` within `allowed` (iterative dilation)."""
    cur = seed & allowed
    while True:
        nxt = _dilate4(cur) & allowed
        if np.array_equal(nxt, cur):
            return cur
        cur = nxt


def components(m: np.ndarray, min_area: int = 1) -> list[np.ndarray]:
    """4-connected components of a boolean mask (fine for the handful of counters/holes)."""
    rest = m.copy()
    out = []
    while rest.any():
        ys, xs = np.nonzero(rest)
        seed = np.zeros_like(rest)
        seed[ys[0], xs[0]] = True
        comp = flood(seed, rest)
        rest &= ~comp
        if comp.sum() >= min_area:
            out.append(comp)
    return out


def enclosed_holes(opaque: np.ndarray, min_area: int = 1) -> list[np.ndarray]:
    """Transparent regions not connected to the canvas border (letter counters, handle loops)."""
    clear = ~opaque
    border = np.zeros_like(clear)
    border[0, :] = border[-1, :] = True
    border[:, 0] = border[:, -1] = True
    outside = flood(border & clear, clear)
    return components(clear & ~outside, min_area)


def boundary(m: np.ndarray) -> np.ndarray:
    """Pixels of m with at least one 4-neighbour outside m (or on the canvas edge)."""
    inner = m.copy()
    inner[1:] &= m[:-1]
    inner[:-1] &= m[1:]
    inner[:, 1:] &= m[:, :-1]
    inner[:, :-1] &= m[:, 1:]
    inner[0, :] = inner[-1, :] = False
    inner[:, 0] = inner[:, -1] = False
    return m & ~inner


def _nearest_dist(src: np.ndarray, dst: np.ndarray, chunk: int = 512) -> np.ndarray:
    if len(dst) == 0 or len(src) == 0:
        return np.zeros(0)
    out = np.empty(len(src))
    d = dst.astype(np.float32)
    for i in range(0, len(src), chunk):
        s = src[i:i + chunk].astype(np.float32)
        out[i:i + chunk] = np.sqrt(((s[:, None, :] - d[None]) ** 2).sum(-1).min(1))
    return out


def hull_width(hull_rgba: np.ndarray, nohull_rgba: np.ndarray, thr: float = 0.5) -> dict:
    """Width (px) of the inverted-hull outline: distance from each outer silhouette pixel of the
    hull render to the nearest opaque pixel of the same frame rendered without the hull."""
    hm = mask(hull_rgba, thr)
    nm = mask(nohull_rgba, thr)
    outer = boundary(hm) & ~nm
    src = np.argwhere(outer)
    dst = np.argwhere(boundary(nm))
    d = _nearest_dist(src, dst)
    if len(d) == 0:
        return {"n": 0, "median": 0.0, "p10": 0.0, "p90": 0.0, "min": 0.0}
    return {
        "n": int(len(d)),
        "median": round(float(np.median(d)), 3),
        "p10": round(float(np.percentile(d, 10)), 3),
        "p90": round(float(np.percentile(d, 90)), 3),
        "min": round(float(d.min()), 3),
    }


def hull_bleed(hull_rgba: np.ndarray, nohull_rgba: np.ndarray, min_area: int = 12,
               min_keep: float = 0.30) -> dict:
    """Counters/holes that the outline hull closes up (the 'dark sliver in the A' artefact).

    A hole of the no-hull render bleeds when less than `min_keep` of its area stays
    transparent once the hull is added."""
    nm = mask(nohull_rgba, 0.5)
    hm_clear = alpha(hull_rgba) < 0.5
    holes = enclosed_holes(nm, min_area)
    report = []
    for h in holes:
        area = int(h.sum())
        kept = int((h & hm_clear).sum())
        report.append({"area": area, "kept": kept, "keptRatio": round(kept / area, 3),
                       "bbox": bbox(h)})
    closed = [r for r in report if r["keptRatio"] < min_keep]
    return {"holes": len(report), "closed": len(closed), "detail": report}


def edge_touch(m: np.ndarray, margin: int = 1) -> bool:
    """True when opaque pixels reach within `margin` px of the canvas border (clipping risk)."""
    if margin <= 0:
        return False
    return bool(m[:margin].any() or m[-margin:].any() or m[:, :margin].any() or m[:, -margin:].any())


def dark_fraction(a: np.ndarray, thr: int = 40) -> float:
    """Share of opaque pixels that are ink-dark (max RGB < thr)."""
    m = mask(a)
    if not m.any():
        return 0.0
    dark = (a[..., :3].max(-1) < thr) & m
    return float(dark.sum() / m.sum())


# -------------------------------------------------------------------- contact sheet ---
def _font(px: int):
    try:
        return ImageFont.load_default(size=px)
    except TypeError:  # Pillow < 10.1
        return ImageFont.load_default()


def contact_sheet(images, labels=None, cols: int = 8, cell: int | None = None,
                  bg: str = "#0C3149", max_width: int = 2576, pad: int = 4,
                  title: str | None = None) -> Image.Image:
    """Tile RGBA images over the board panel colour, with optional per-cell labels.
    The sheet is capped at `max_width` px (the vision-model limit used in PIPELINE.md)."""
    ims = [im if isinstance(im, Image.Image) else Image.fromarray(im) for im in images]
    if not ims:
        raise ValueError("contact_sheet: no images")
    cols = max(1, min(cols, len(ims)))
    cell = cell or max(im.width for im in ims)
    cell = min(cell, (max_width - pad * (cols + 1)) // cols)
    rows = (len(ims) + cols - 1) // cols
    head = 22 if title else 0
    W = cols * cell + pad * (cols + 1)
    H = rows * cell + pad * (rows + 1) + head
    sheet = Image.new("RGBA", (W, H), bg)
    draw = ImageDraw.Draw(sheet)
    font = _font(max(10, cell // 16))
    if title:
        draw.text((pad, 4), title, fill=(255, 255, 255, 255), font=_font(14))
    for i, im in enumerate(ims):
        r, c = divmod(i, cols)
        x = pad + c * (cell + pad)
        y = head + pad + r * (cell + pad)
        scale = min(cell / im.width, cell / im.height)
        tile = downscale_premult(im, (max(1, round(im.width * scale)), max(1, round(im.height * scale))))
        sheet.alpha_composite(tile, (x + (cell - tile.width) // 2, y + (cell - tile.height) // 2))
        if labels:
            draw.text((x + 3, y + 2), str(labels[i]), fill=(255, 255, 255, 220), font=font)
    return sheet.convert("RGB")
