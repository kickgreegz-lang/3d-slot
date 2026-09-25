"""Key-colour + closed-black-outline matting, despill, canvas fit and halo metrics (numpy/scipy/PIL).

The art bible guarantees a closed pure-black outline around every foreground shape on a flat
key colour. That makes matting well-posed:
  * background = every region the outline separates from the image border (kills AI-added
    shadows, glows and gradients outside the outline) + enclosed regions that are key-coloured
    (handle openings, letter counters);
  * the anti-aliased edge is a blend of exactly two colours, ink and key, so alpha is the
    projection onto the ink->key line and the unmixed colour is the ink: zero key spill;
  * gaps in the outline are sealed by a morphological close whose radius is chosen
    automatically (smallest radius that stops the background leaking into the fill).
All arrays are float32 in [0, 1] unless noted; images are straight (un-premultiplied) alpha.
"""
from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

REPO = Path(__file__).resolve().parents[2]
CANVAS = 360           # symbol canvas @2x (art bible: 180 design px = 1.2x the 150 px cell)
CELL_2X = 300          # 150 px design cell @2x


# ----------------------------------------------------------------------------- io / colour


def parse_hex(h: str) -> np.ndarray:
    h = h.strip().lstrip("#").lower().removeprefix("0x")
    if not re.fullmatch(r"[0-9a-f]{6}", h):
        raise ValueError(f"bad colour {h!r} (expected RRGGBB)")
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], np.float32) / 255.0


def to_hex(c) -> str:
    c = np.clip(np.round(np.asarray(c) * 255), 0, 255).astype(int)
    return "#%02X%02X%02X" % tuple(c)


def load_rgb(path) -> np.ndarray:
    """RGB float32 in [0, 1]; any alpha channel in the file is ignored (see --alpha-from)."""
    return np.asarray(Image.open(path).convert("RGB"), np.float32) / 255.0


def load_alpha(path) -> np.ndarray:
    im = Image.open(path)
    if im.mode in ("RGBA", "LA"):
        return np.asarray(im, np.float32)[..., -1] / 255.0
    return np.asarray(im.convert("L"), np.float32) / 255.0


def save_rgba(path, rgb: np.ndarray, alpha: np.ndarray) -> None:
    rgba = np.dstack([rgb, alpha])
    arr = np.clip(np.round(rgba * 255.0), 0, 255).astype(np.uint8)
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(arr, "RGBA").save(path, format="PNG", optimize=False, compress_level=9)


def auto_key(rgb: np.ndarray, border: int = 4) -> np.ndarray:
    """Median colour of the image border (the flat key background)."""
    b = np.concatenate([rgb[:border].reshape(-1, 3), rgb[-border:].reshape(-1, 3),
                        rgb[:, :border].reshape(-1, 3), rgb[:, -border:].reshape(-1, 3)])
    return np.median(b, axis=0).astype(np.float32)


def key_channels(key: np.ndarray) -> tuple[list[int], list[int]]:
    hi = [i for i in range(3) if key[i] >= 0.5]
    lo = [i for i in range(3) if key[i] < 0.5]
    if not hi or not lo:
        raise ValueError(f"key {to_hex(key)} is not a chroma key (needs saturated and empty channels)")
    return hi, lo


def spill(rgb: np.ndarray, key: np.ndarray) -> np.ndarray:
    """How much a colour leans toward the key hue: min(key channels) - max(other channels)."""
    hi, lo = key_channels(key)
    return rgb[..., hi].min(-1) - rgb[..., lo].max(-1)


def despill(rgb: np.ndarray, key: np.ndarray, mask: np.ndarray | None = None, mix: float = 1.0) -> np.ndarray:
    """Classic spill suppression: pull the key channels down to the strongest other channel."""
    hi, _ = key_channels(key)
    s = np.clip(spill(rgb, key), 0, None) * mix
    if mask is not None:
        s = s * mask
    out = rgb.copy()
    for c in hi:
        out[..., c] = out[..., c] - s
    return np.clip(out, 0, 1)


# ----------------------------------------------------------------------------- matte


@dataclass
class MatteParams:
    key: np.ndarray | None = None       # None -> auto (border median)
    dark: float = 70 / 255              # max(RGB) below this = ink (outline / interior lines)
    hole_dist: float = 90 / 255         # enclosed region this close to the key = hole
    key_spill: float = 0.40             # ...or this strongly key-hued (min key ch - max other ch)
    seal: int | None = None             # outline gap closing radius (None = auto 0..max_seal)
    max_seal: int = 4
    band: int = 2                       # px on each side of the edge that get soft (unmixed) alpha
    line_tol: float = 0.16              # distance from the ink->key line that still counts as a blend
    erode: int = 1                      # alpha erosion (px, at input resolution) after matting
    min_hole_frac: float = 2e-5         # enclosed key specks smaller than this (x area) are filled
    despill_radius: int = 4             # px from the edge where fg colours are despilled


@dataclass
class MatteResult:
    alpha: np.ndarray
    rgb: np.ndarray
    key: np.ndarray
    ink: np.ndarray
    seal: int
    info: dict = field(default_factory=dict)


def _disk(r: int) -> np.ndarray:
    y, x = np.ogrid[-r:r + 1, -r:r + 1]
    return x * x + y * y <= r * r


def _classify(dark: np.ndarray, keylike: np.ndarray, s: int, min_hole: int, near_ink: np.ndarray):
    """Background mask for seal radius s. Returns (bg, leak) where leak counts non-key pixels
    the background claimed away from the outline (a leak into the fill makes this large)."""
    sealed = ndi.binary_dilation(dark, structure=_disk(s)) if s else dark
    lab, n = ndi.label(~sealed)
    border = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
    border = border[border > 0]
    bg = np.isin(lab, border)
    if s:
        # give back the ring the dilation took from the background (never ink)
        bg = ndi.binary_dilation(bg, structure=_disk(s)) & ~dark
    # enclosed regions: mostly key-coloured -> holes; tiny specks -> sealed (kept as fg)
    if n:
        idx = np.arange(1, n + 1)
        frac = ndi.mean(keylike, lab, idx)
        size = ndi.sum(np.ones_like(keylike, np.float32), lab, idx)
        holes = idx[(frac > 0.6) & (size >= min_hole) & ~np.isin(idx, border)]
        if holes.size:
            bg |= np.isin(lab, holes)
    # key flood: key-coloured pixels connected to the background are background, even inside a
    # sealed gap (the close only blocks the flood through the fill, never through the key)
    lab2, _ = ndi.label(bg | keylike)
    reach = np.unique(lab2[bg])
    bg = np.isin(lab2, reach[reach > 0])
    leak = int(np.count_nonzero(bg & ~keylike & ~near_ink))
    return bg, leak


def matte(rgb: np.ndarray, p: MatteParams) -> MatteResult:
    H, W = rgb.shape[:2]
    key = p.key if p.key is not None else auto_key(rgb)
    key_channels(key)
    dark = rgb.max(-1) < p.dark
    if not dark.any():
        raise ValueError("no ink pixels found: the art needs a closed dark outline (or pass --alpha-from)")
    dist = np.linalg.norm(rgb - key, axis=-1)
    # key-like = near the key OR strongly key-hued (a hole or margin tinted toward white/black by
    # an AI glow or shadow keeps the key's hue even when its RGB distance grows)
    keylike = (dist < p.hole_dist) | (spill(rgb, key) > p.key_spill)
    min_hole = max(16, int(p.min_hole_frac * H * W))
    # leak is measured outside a FIXED ring around the ink so the radii are comparable
    near_ink = ndi.binary_dilation(dark, structure=_disk(p.max_seal + 3))
    # --- seal radius: smallest s whose leak is within tolerance of the best
    if p.seal is not None:
        seal = p.seal
        bg, leak = _classify(dark, keylike, seal, min_hole, near_ink)
        leaks = {seal: leak}
    else:
        leaks, masks = {}, {}
        for s in range(0, p.max_seal + 1):
            masks[s], leaks[s] = _classify(dark, keylike, s, min_hole, near_ink)
        best = min(leaks.values())
        tol = max(64, int(5e-4 * H * W))
        seal = min(s for s, v in leaks.items() if v <= best + tol)
        bg = masks[seal]
    fg = ~bg
    # --- ink colour: median of ink pixels on the silhouette edge
    edge_fg = fg & ndi.binary_dilation(bg, iterations=1)
    ink_px = rgb[edge_fg & dark]
    ink = np.median(ink_px, axis=0).astype(np.float32) if len(ink_px) else np.zeros(3, np.float32)
    # --- soft alpha in the edge band: unmix along the ink -> key line
    d_out = ndi.distance_transform_edt(bg)       # distance of bg pixels to fg
    d_in = ndi.distance_transform_edt(fg)        # distance of fg pixels to bg
    band = ((bg & (d_out <= p.band)) | (fg & (d_in <= p.band)))
    v = ink - key
    vv = float(np.dot(v, v)) or 1.0
    a_line = np.clip(((rgb - key) @ v) / vv, 0, 1)
    proj = key + a_line[..., None] * v
    on_line = np.linalg.norm(rgb - proj, axis=-1) < p.line_tol
    alpha = fg.astype(np.float32)
    soft = band & on_line
    alpha[soft] = a_line[soft]
    # --- colour: unmixed ink on blended edge pixels, despill near the edge, bleed into bg
    out = rgb.copy()
    blended = soft & (alpha > 0) & (alpha < 1)
    out[blended] = ink
    near_edge = (d_in <= p.despill_radius) & fg
    out = despill(out, key, mask=near_edge.astype(np.float32))
    # --- erode (pushes any residual fringe into the outline)
    for _ in range(max(0, p.erode)):
        alpha = ndi.grey_erosion(alpha, footprint=_disk(1))
    alpha[alpha < 1 / 512] = 0
    out = bleed(out, alpha > 0)
    info = {"key": to_hex(key), "ink": to_hex(ink), "seal": seal, "leakBySeal": leaks, "band": p.band,
            "erode": p.erode, "softEdgePx": int(np.count_nonzero(blended)),
            "fgFraction": round(float(alpha.mean()), 5)}
    return MatteResult(alpha=alpha, rgb=out, key=key, ink=ink, seal=seal, info=info)


def matte_from_alpha(rgb: np.ndarray, alpha: np.ndarray, key: np.ndarray, erode: int = 1,
                     despill_radius: int = 4) -> MatteResult:
    """External alpha (ToonOut / BiRefNet / rembg -m birefnet-general): despill + erode + bleed."""
    if alpha.shape != rgb.shape[:2]:
        raise ValueError(f"alpha {alpha.shape} does not match image {rgb.shape[:2]}")
    fg = alpha > 0.5
    d_in = ndi.distance_transform_edt(fg)
    out = despill(rgb, key, mask=((d_in <= despill_radius) | (alpha < 1)).astype(np.float32))
    a = alpha.astype(np.float32).copy()
    for _ in range(max(0, erode)):
        a = ndi.grey_erosion(a, footprint=_disk(1))
    a[a < 1 / 512] = 0
    out = bleed(out, a > 0)
    return MatteResult(alpha=a, rgb=out, key=key, ink=np.zeros(3, np.float32), seal=0,
                       info={"key": to_hex(key), "alphaFrom": True, "erode": erode})


def bleed(rgb: np.ndarray, keep: np.ndarray) -> np.ndarray:
    """Copy the nearest kept colour into every other pixel, so filtering a straight-alpha
    texture never samples the key colour (or black) from transparent texels."""
    if keep.all() or not keep.any():
        return rgb
    idx = ndi.distance_transform_edt(~keep, return_distances=False, return_indices=True)
    return rgb[idx[0], idx[1]]


# ----------------------------------------------------------------------------- canvas fit


def game_config_path() -> Path:
    """The active game's symbol registry: src/games/<GAME>/config.ts (GAME env var, default swamp-funk)."""
    return REPO / "src" / "games" / (os.environ.get("GAME") or "swamp-funk") / "config.ts"


def symbol_targets() -> dict:
    """{id: {cellScale, restAngle, kind}} parsed from src/games/<GAME>/config.ts (the runtime truth)."""
    src = game_config_path().read_text(encoding="utf-8")
    out = {}
    royal_scale = re.search(r"kind:\s*'royal'[\s\S]*?cellScale:\s*([\d.]+)", src)
    for m in re.finditer(r"(\w+):\s*royal\('(\w+)'", src):
        out[m.group(2)] = {"cellScale": float(royal_scale.group(1)), "restAngle": 0.0, "kind": "royal"}
    for m in re.finditer(r"\bid:\s*'(\w+)',\s*kind:\s*'(\w+)'([^}]*?)cellScale:\s*([\d.]+),\s*restAngle:\s*(-?[\d.]+)",
                         src):
        out[m.group(1)] = {"cellScale": float(m.group(4)), "restAngle": float(m.group(5)), "kind": m.group(2)}
    return out


def content_px_for(symbol: str | None = None, kind: str | None = None) -> int:
    """Target content size on the 360 @2x canvas: cellScale * 300 (== bible cellFill ranges)."""
    if symbol:
        t = symbol_targets().get(symbol)
        if not t:
            raise ValueError(f"unknown symbol {symbol} ({game_config_path().relative_to(REPO)} SYMBOLS)")
        return int(round(t["cellScale"] * CELL_2X))
    mid = {"royal": 0.86, "high": 0.96, "special": 1.07, "wild": 1.02, "scatter": 1.12}
    if kind not in mid:
        raise ValueError(f"--kind must be one of {sorted(mid)}")
    return int(round(mid[kind] * CELL_2X))


def bbox(alpha: np.ndarray, thr: float = 1 / 255):
    ys, xs = np.nonzero(alpha > thr)
    if not len(xs):
        raise ValueError("empty matte (no foreground pixels)")
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def _resize_f(ch: np.ndarray, size: int, box) -> np.ndarray:
    im = Image.fromarray(ch.astype(np.float32), "F")
    return np.asarray(im.resize((size, size), Image.Resampling.LANCZOS, box=box), np.float32)


def fit_canvas(rgb: np.ndarray, alpha: np.ndarray, content_px: int, canvas: int = CANVAS, fit: str = "max",
               allow_upscale: bool = False, margin: int = 4, key: np.ndarray | None = None):
    """Scale the matte so its content (max side, or height) is `content_px`, centre it on a
    `canvas`^2 transparent canvas; premultiplied Lanczos, then un-premultiply (straight alpha).
    Returns (rgb, alpha, transform) where transform maps master px -> canvas px:
    canvas = (master - src_origin) * scale."""
    x0, y0, x1, y1 = bbox(alpha)
    w, h = x1 - x0, y1 - y0
    dim = max(w, h) if fit == "max" else h
    scale = content_px / dim
    limited = None
    if max(w, h) * scale > canvas - 2 * margin:
        scale = (canvas - 2 * margin) / max(w, h)
        limited = "canvas"
    if scale > 1 and not allow_upscale:
        raise ValueError(f"master content is {dim} px but the canvas needs {content_px}: never upscale "
                         f"(regenerate larger or pass --allow-upscale for drafts)")
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    half = canvas / scale / 2
    sx0, sy0 = cx - half, cy - half
    # pad so the source box lies inside the image (PIL requirement)
    H, W = alpha.shape
    pad = int(np.ceil(max(0, -sx0, -sy0, sx0 + 2 * half - W, sy0 + 2 * half - H))) + 4
    pm = np.dstack([rgb * alpha[..., None], alpha])
    if pad:
        pm = np.pad(pm, ((pad, pad), (pad, pad), (0, 0)))
    box = (sx0 + pad, sy0 + pad, sx0 + pad + 2 * half, sy0 + pad + 2 * half)
    chans = [np.clip(_resize_f(pm[..., c], canvas, box), 0, 1) for c in range(4)]
    a = chans[3]
    a[a < 1 / 512] = 0
    rgb_pm = np.dstack(chans[:3])
    rgb_pm = np.minimum(rgb_pm, a[..., None])          # a premultiplied colour never exceeds its alpha
    rgb_out = np.where(a[..., None] > 1e-4, np.clip(rgb_pm / np.maximum(a[..., None], 1e-4), 0, 1), 0)
    if key is not None:
        # Lanczos ringing can leave a faint key-hued texel where the other channels clipped at 0
        rgb_out = despill(rgb_out, key, mask=edge_mask(a).astype(np.float32))
    rgb_out = bleed(rgb_out, a > 0)
    tf = {"scale": scale, "srcOrigin": [sx0, sy0], "canvas": canvas, "contentBBoxMaster": [x0, y0, x1, y1],
          "fit": fit, "limitedBy": limited}
    return rgb_out.astype(np.float32), a.astype(np.float32), tf


def transform_alpha(alpha: np.ndarray, tf: dict) -> np.ndarray:
    """Apply a fit_canvas transform to another master-resolution alpha (e.g. ground truth)."""
    s, (sx0, sy0), canvas = tf["scale"], tf["srcOrigin"], tf["canvas"]
    half = canvas / s / 2
    H, W = alpha.shape
    pad = int(np.ceil(max(0, -sx0, -sy0, sx0 + 2 * half - W, sy0 + 2 * half - H))) + 4
    a = np.pad(alpha, pad) if pad else alpha
    return np.clip(_resize_f(a, canvas, (sx0 + pad, sy0 + pad, sx0 + pad + 2 * half, sy0 + pad + 2 * half)), 0, 1)


# ----------------------------------------------------------------------------- QA metrics


def iou(a: np.ndarray, b: np.ndarray, thr: float = 0.5) -> float:
    A, B = a > thr, b > thr
    u = np.count_nonzero(A | B)
    return float(np.count_nonzero(A & B) / u) if u else 1.0


def edge_mask(alpha: np.ndarray) -> np.ndarray:
    """Semi-transparent pixels plus opaque pixels touching a fully transparent one."""
    vis = alpha > 0
    return (vis & (alpha < 1 - 1 / 255)) | (vis & ndi.binary_dilation(~vis, iterations=1))


def halo_report(rgb: np.ndarray, alpha: np.ndarray, key: np.ndarray, thr: float = 24 / 255) -> dict:
    """Art-bible halo gate: composite on pure black and pure white and count key-tinted edge
    pixels (spill toward the key hue above `thr`). Also counts tinted straight-alpha edge texels."""
    e = edge_mask(alpha)
    out = {"edgePx": int(np.count_nonzero(e)), "thr": round(thr * 255)}
    out["tintedTexels"] = int(np.count_nonzero(e & (spill(rgb, key) > thr)))
    for name, bgc in (("onBlack", 0.0), ("onWhite", 1.0)):
        comp = rgb * alpha[..., None] + bgc * (1 - alpha[..., None])
        # on white, compare against the key-free composite of the same edge (ink over white)
        out[name] = int(np.count_nonzero(e & (spill(comp, key) > thr)))
    out["keyTintedEdgePx"] = out["tintedTexels"] + out["onBlack"] + out["onWhite"]
    return out


def canvas_report(alpha: np.ndarray, content_px: int, canvas: int, fit: str) -> dict:
    x0, y0, x1, y1 = bbox(alpha, 0.5)
    w, h = x1 - x0, y1 - y0
    dim = max(w, h) if fit == "max" else h
    return {"size": list(alpha.shape[::-1]), "contentBBox": [x0, y0, x1, y1], "contentPx": dim,
            "targetPx": content_px, "centreOffset": [round((x0 + x1) / 2 - canvas / 2, 2), round((y0 + y1) / 2 - canvas / 2, 2)],
            "canvasOk": alpha.shape == (canvas, canvas) and abs(dim - content_px) <= 2}
