"""Colour helpers: sRGB <-> linear, art-bible lookups, toon band colours, k-means. No bpy.

Band model (matches the 2D art bible and src/mascots/toon.ts):
  * three hard bands per material: deep / mid / lit (+ optional white specular streak);
  * explicit bands for symbols: deep and mid shift toward the warm plum shadow hue
    (#6A1030, ART_BIBLE §4 "shadows shift toward warm plum, never grey"), or use the
    bible's explicit shade (highs/specials) and the gold ramp for gold;
  * multiplier bands for textured/mascot materials: 1.00 / 0.70 / 0.42 x albedo, the
    values the runtime MeshToonMaterial ramp resolves to (TOON in src/mascots/toon.ts).
"""
from __future__ import annotations

import json
import os
import re
from pathlib import Path

from .cli import REPO

PLUM_SHADOW = "#6A1030"
INK = "#000000"
EXTRUSION = "#4B283D"
EXTRUSION_LIT = "#6B3A57"
SPECULAR = "#FFFFFF"
GOLD = {"lit": "#FFC629", "mid": "#E2861A", "deep": "#9A4A0C", "light": "#FFF0A0"}
RUNTIME_MULTIPLIERS = (0.42, 0.70, 1.00)  # deep, mid, lit (src/mascots/toon.ts header)

# Default kind -> cellScale when src/games/<GAME>/config.ts cannot be parsed.
KIND_CELL_SCALE = {"royal": 0.86, "high": 0.96, "wild": 1.02, "scatter": 1.12, "special": 1.06, "prop": 0.90}


def hex_to_rgb(h: str) -> tuple[float, float, float]:
    h = h.strip().lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    if not re.fullmatch(r"[0-9a-fA-F]{6}", h):
        raise ValueError(f"bad hex colour {h!r}")
    return tuple(int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4))  # type: ignore[return-value]


def rgb_to_hex(rgb) -> str:
    return "#" + "".join(f"{max(0, min(255, round(c * 255))):02X}" for c in rgb[:3])


def srgb_to_linear(c: float) -> float:
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def linear_to_srgb(c: float) -> float:
    c = max(0.0, c)
    return c * 12.92 if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055


def hex_to_linear(h: str) -> tuple[float, float, float]:
    return tuple(srgb_to_linear(c) for c in hex_to_rgb(h))  # type: ignore[return-value]


def mix(a, b, t: float):
    return tuple(x + (y - x) * t for x, y in zip(a, b))


def mul(a, k: float):
    return tuple(x * k for x in a)


def derive_bands(base: str, shade: str | None = None, shadow_hue: str = PLUM_SHADOW) -> dict:
    """Explicit deep/mid/lit hex colours for one flat base colour."""
    b = hex_to_rgb(base)
    if base.upper() == GOLD["lit"]:
        return {"deep": GOLD["deep"], "mid": GOLD["mid"], "lit": GOLD["lit"]}
    hue = hex_to_rgb(shadow_hue)
    if shade:
        s = hex_to_rgb(shade)
        mid = mix(b, s, 0.42)
        deep = s
    else:
        mid = mix(mul(b, 0.74), hue, 0.14)
        deep = mix(mul(b, 0.46), hue, 0.30)
    return {"deep": rgb_to_hex(deep), "mid": rgb_to_hex(mid), "lit": base.upper()}


def load_artbible(repo: Path = REPO) -> dict:
    return json.loads((repo / "art" / "bible" / "artbible.json").read_text())


def symbol_info(bible: dict, key: str) -> dict | None:
    """Resolve a game id (L2, H1, W) or a royal glyph (K, 10) to the bible entry."""
    syms = bible.get("symbols", {})
    if key in syms and isinstance(syms[key], dict) and "kind" in syms[key]:
        d = dict(syms[key])
        d["id"] = key
        return d
    for sid, d in syms.items():
        if isinstance(d, dict) and d.get("glyph") == key:
            d = dict(d)
            d["id"] = sid
            return d
    return None


def symbol_colors(info: dict | None, bible: dict) -> dict:
    """face/shade hex for a symbol id from the bible (royal face, high/special hex+shade)."""
    if not info:
        return {}
    sid = info["id"]
    if info.get("kind") == "royal":
        return {"face": info.get("face")}
    pal = {p["id"]: p for p in bible.get("palette", [])}
    key = {"W": "wild", "S": "scatter"}.get(sid, sid.lower())
    p = pal.get(key)
    if p:
        return {"face": p.get("hex"), "shade": p.get("shade")}
    return {}


def cell_scale(sym: str, kind: str | None, repo: Path = REPO) -> float:
    """cellScale for a symbol id from src/games/<GAME>/config.ts (GAME env, default swamp-funk; regex parse)."""
    src = repo / "src" / "games" / (os.environ.get("GAME") or "swamp-funk") / "config.ts"
    try:
        text = src.read_text()
        m = re.search(rf"\b{re.escape(sym)}:\s*\{{[^}}]*?cellScale:\s*([0-9.]+)", text, re.S)
        if m:
            return float(m.group(1))
        m = re.search(rf"\b{re.escape(sym)}:\s*royal\(", text)
        if m:
            m2 = re.search(r"kind:\s*'royal'[\s\S]*?cellScale:\s*([0-9.]+)", text)
            if m2:
                return float(m2.group(1))
    except OSError:
        pass
    return KIND_CELL_SCALE.get(kind or "prop", 0.9)


# ------------------------------- CIE Lab + k-means -----------------------------------
def srgb_to_lab(rgb):
    """rgb: numpy (...,3) sRGB 0..1 -> Lab (D65)."""
    import numpy as np
    c = np.asarray(rgb, dtype=np.float64)
    lin = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    m = np.array([[0.4124564, 0.3575761, 0.1804375],
                  [0.2126729, 0.7151522, 0.0721750],
                  [0.0193339, 0.1191920, 0.9503041]])
    xyz = lin @ m.T / np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > (6 / 29) ** 3, np.cbrt(xyz), xyz / (3 * (6 / 29) ** 2) + 4 / 29)
    L = 116 * f[..., 1] - 16
    a = 500 * (f[..., 0] - f[..., 1])
    b = 200 * (f[..., 1] - f[..., 2])
    return np.stack([L, a, b], axis=-1)


def kmeans(X, k: int, weights=None, seed: int = 0, iters: int = 40):
    """Deterministic weighted k-means++ (numpy). Returns (centers, labels)."""
    import numpy as np
    X = np.asarray(X, dtype=np.float64)
    n = len(X)
    if n == 0:
        raise ValueError("kmeans on empty data")
    w = np.ones(n) if weights is None else np.asarray(weights, dtype=np.float64)
    k = max(1, min(k, n))
    rng = np.random.RandomState(seed)
    centers = [X[int(np.argmax(w))]]
    for _ in range(1, k):
        d2 = np.min(((X[:, None, :] - np.array(centers)[None]) ** 2).sum(-1), axis=1) * w
        if d2.sum() <= 0:
            break
        centers.append(X[rng.choice(n, p=d2 / d2.sum())])
    C = np.array(centers)
    labels = np.zeros(n, dtype=int)
    for _ in range(iters):
        d = ((X[:, None, :] - C[None]) ** 2).sum(-1)
        new = d.argmin(1)
        if _ > 0 and np.array_equal(new, labels):
            break
        labels = new
        for j in range(len(C)):
            m = labels == j
            if m.any():
                C[j] = (X[m] * w[m, None]).sum(0) / w[m].sum()
    return C, labels
