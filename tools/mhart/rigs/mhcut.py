"""Master-cut helpers for the Magpie Heist Spine rigs (tools/mhart/rigs/cut_<ID>.py).

Built on the Bass Drop cut library (tools/spine/examples/bass_drop/cut/cutlib.py, imported, not copied): every visible
pixel of a rig comes from the approved matted master art/source/magpie-heist/symbols/<ID>/master_1024.png, cut with
masks drawn in master pixels; hidden areas a motion can reveal are filled UNDER the part that hides them, so the rest
pose reassembles to the master (`Rig.finish` checks alpha IoU and SSIM against the master on the canvas).

Conventions (one per game, so every cut script looks the same):
  * canvas 360 x 360 @2x, content = cellScale x 300 units (cellScale read from src/games/magpie-heist/config.ts), the
    content bbox centred on the canvas (the runtime SymbolRig.fit() scale is then 1.0);
  * parts:   art/source/magpie-heist/spine/images/sym_<ID>/<part>.png   (images root art/source/magpie-heist/spine/images,
             a separate root from Bass Drop's art/source/spine/images, so region names never collide)
  * parts.json: art/source/magpie-heist/symbols/<ID>/parts.json ("images": "../../spine/images")
  * QA:      build/qa/rigs/mh_sym_<ID>/ (cut.json with the reassembly metrics + keypoints, rest / per-part previews)
"""
from __future__ import annotations

import json
import math
import re
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
sys.path.insert(0, str(REPO / "tools/spine/examples/bass_drop/cut"))
import cutlib as cl  # noqa: E402,F401  (re-exported: cut scripts use mhcut.cl.*)

GAME_CONFIG = REPO / "src/games/magpie-heist/config.ts"
IMAGES_ROOT = REPO / "art/source/magpie-heist/spine/images"
SYMBOLS_ROOT = REPO / "art/source/magpie-heist/symbols"
CELL = 300          # cell in skeleton units (@2x)
CANVAS = 360


def cell_scale(sid: str) -> float:
    """SYMBOLS[sid].cellScale from the game config (the runtime fits the rig's content to cellScale x cell)."""
    txt = GAME_CONFIG.read_text(encoding="utf-8")
    m = re.search(rf"\b{re.escape(sid)}:\s*\{{[^}}]*?cellScale:\s*([0-9.]+)", txt, re.S)
    if not m:
        raise SystemExit(f"mhcut: no cellScale for {sid} in {GAME_CONFIG}")
    return float(m.group(1))


# ------------------------------------------------------------------------------------------ colour masks
def hsv(M: np.ndarray):
    """(hue deg 0-360, sat 0-1, val 0-1) of a straight RGBA float layer."""
    rgb = (np.clip(M[..., :3], 0, 1) * 255).astype(np.uint8)
    h = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV_FULL).astype(np.float32)
    return h[..., 0] * (360.0 / 256.0), h[..., 1] / 255.0, h[..., 2] / 255.0


def hue_in(H: np.ndarray, lo: float, hi: float) -> np.ndarray:
    """Hue band [lo, hi] in degrees (wraps through 0 when lo > hi)."""
    return (H >= lo) & (H <= hi) if lo <= hi else (H >= lo) | (H <= hi)


def keep_components(mask: np.ndarray, min_area: int = 200, n: int | None = None) -> np.ndarray:
    """The connected components of a bool mask with at least `min_area` px (the `n` largest if given)."""
    cnt, lab, st, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), 8)
    idx = [i for i in range(1, cnt) if st[i, 4] >= min_area]
    idx.sort(key=lambda i: -st[i, 4])
    if n is not None:
        idx = idx[:n]
    return np.isin(lab, idx)


def components(mask: np.ndarray, min_area: int = 200) -> list[dict]:
    """[{mask, area, cx, cy, bbox}] of the connected components, largest first."""
    cnt, lab, st, cen = cv2.connectedComponentsWithStats(mask.astype(np.uint8), 8)
    out = []
    for i in range(1, cnt):
        if st[i, 4] >= min_area:
            out.append({"mask": lab == i, "area": int(st[i, 4]), "cx": float(cen[i, 0]), "cy": float(cen[i, 1]),
                        "bbox": tuple(int(v) for v in st[i, :4])})
    return sorted(out, key=lambda c: -c["area"])


def close(mask: np.ndarray, r: int) -> np.ndarray:
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))
    return cv2.morphologyEx(mask.astype(np.uint8), cv2.MORPH_CLOSE, k) > 0


def grow(mask: np.ndarray, r: int) -> np.ndarray:
    return cl.dilate(mask.astype(np.float32), r) > 0.5


def shrink(mask: np.ndarray, r: int) -> np.ndarray:
    return cl.erode(mask.astype(np.float32), r) > 0.5


def dist_to(mask: np.ndarray) -> np.ndarray:
    """Euclidean distance (px) of every pixel to the nearest True pixel of `mask`."""
    return cv2.distanceTransform((~mask).astype(np.uint8), cv2.DIST_L2, 5)


def ellipse(shape, cx: float, cy: float, rx: float, ry: float, ss: int = 4) -> np.ndarray:
    """Anti-aliased ellipse coverage (float 0..1), computed on its own window only (cutlib.ellipse rasterises the whole
    master at 4x, which is slow on 2048 px masters)."""
    h, w = shape[:2]
    out = np.zeros((h, w), np.float32)
    x0, x1 = max(0, int(cx - rx) - 2), min(w, int(cx + rx) + 3)
    y0, y1 = max(0, int(cy - ry) - 2), min(h, int(cy + ry) + 3)
    if x1 <= x0 or y1 <= y0:
        return out
    off = (np.arange(ss) + 0.5) / ss
    ys = (np.arange(y0, y1)[:, None] + off[None, :]).reshape(-1)
    xs = (np.arange(x0, x1)[:, None] + off[None, :]).reshape(-1)
    inside = ((xs[None, :] - cx) / rx) ** 2 + ((ys[:, None] - cy) / ry) ** 2 <= 1.0
    out[y0:y1, x0:x1] = inside.reshape(y1 - y0, ss, x1 - x0, ss).mean(axis=(1, 3))
    return out


def fill_from(rgba: np.ndarray, hole: np.ndarray, known: np.ndarray, sigma: float = 6.0) -> np.ndarray:
    """Fill the RGB inside `hole` from the nearest `known` pixels, then smooth inside the hole (sigma px): a fast
    stand-in for cutlib.inpaint_rgb (whose Telea pass treats every unknown pixel of the master as a hole); alpha
    untouched. Works on the hole's window only."""
    hole = hole > 0.5 if hole.dtype != bool else hole
    known = known > 0.5 if known.dtype != bool else known
    ys, xs = np.nonzero(hole)
    if len(xs) == 0:
        return rgba
    m = int(4 * sigma + 8)
    h, w = hole.shape
    y0, y1, x0, x1 = max(0, ys.min() - m), min(h, ys.max() + m + 1), max(0, xs.min() - m), min(w, xs.max() + m + 1)
    kn = known[y0:y1, x0:x1] & ~hole[y0:y1, x0:x1]
    if not kn.any():
        raise ValueError("fill_from: no known pixel near the hole")
    _, lab = cv2.distanceTransformWithLabels((~kn).astype(np.uint8), cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
    ky, kx = np.nonzero(kn)
    # labels index the zero pixels in raster order
    order = np.zeros(lab.max() + 1, np.int64)
    zy, zx = np.nonzero(~(~kn))
    lab_at = lab[zy, zx]
    order[lab_at] = zy * kn.shape[1] + zx
    src = order[lab]
    win = rgba[y0:y1, x0:x1, :3].reshape(-1, 3)
    near = win[src.reshape(-1)].reshape(y1 - y0, x1 - x0, 3)
    sm = np.stack([cv2.GaussianBlur(near[..., c], (0, 0), sigma) for c in range(3)], -1) if sigma > 0 else near
    out = rgba.copy()
    hw = hole[y0:y1, x0:x1]
    out[y0:y1, x0:x1, :3] = np.where(hw[..., None], sm, out[y0:y1, x0:x1, :3])
    return out


def hull_mask(shape, mask: np.ndarray) -> np.ndarray:
    ys, xs = np.nonzero(mask)
    pts = np.stack([xs, ys], 1).astype(np.int32)
    hull = cv2.convexHull(pts)
    out = np.zeros(shape[:2], np.uint8)
    cv2.fillPoly(out, [hull.reshape(-1, 2)], 1)
    return out > 0


# ------------------------------------------------------------------------------------------ procedural fx sprites
def place(img: np.ndarray, centre) -> list:
    h, w = img.shape[:2]
    return [int(round(centre[0] - w / 2)), int(round(centre[1] - h / 2)), w, h]


def radial_glow(d: int, rgb, alpha: float = 0.85, power: float = 2.2) -> np.ndarray:
    return cl.glow_disc(d, rgb, alpha=alpha, power=power)


def ring_glow(d: int, rgb, alpha: float = 0.85, r0: float = 0.62, width: float = 0.26, inner: float = 0.12) -> np.ndarray:
    """A halo ring (peak at r0 of the radius): light AROUND the silhouette, little behind its middle, so a symbol
    with see-through holes (the mask's eyes) does not fill them with glow."""
    y, x = np.mgrid[0:d, 0:d] + 0.5
    r = np.hypot(x - d / 2, y - d / 2) / (d / 2)
    a = np.exp(-((r - r0) / width) ** 2) * np.clip((1 - r) / 0.12, 0, 1)
    a = np.maximum(a, inner * np.clip(1 - r / r0, 0, 1))
    out = np.zeros((d, d, 4), np.float32)
    out[..., :3] = rgb
    out[..., 3] = np.clip(a, 0, 1) * alpha
    return out


def star_glint(d: int, rgb=(1.0, 0.96, 0.8), arms: int = 4, core: float = 0.16) -> np.ndarray:
    return cl.star_glint(d, rgb, arms=arms, core=core)


def twinkle(d: int, rgb=(1.0, 0.95, 0.7), long_arm: float = 1.0, short_arm: float = 0.55) -> np.ndarray:
    """Cartoon 4-point twinkle: a bright diamond-ish core with long vertical / shorter horizontal spikes."""
    y, x = np.mgrid[0:d, 0:d] + 0.5
    u, v = (x - d / 2) / (d / 2), (y - d / 2) / (d / 2)
    # superellipse star (|u|^p + |v|^p <= r) with p < 1: concave 4-point star
    p = 0.42
    su = np.abs(u) / short_arm
    sv = np.abs(v) / long_arm
    f = su ** p + sv ** p
    a = np.clip((1.0 - f) * 6.0, 0, 1)
    core = np.exp(-(np.hypot(u, v) / 0.16) ** 2)
    halo = np.exp(-(np.hypot(u, v) / 0.45) ** 2) * 0.35
    a = np.clip(np.maximum(np.maximum(a, core), halo), 0, 1)
    out = np.zeros((d, d, 4), np.float32)
    w = np.clip(core * 1.4 + a * 0.5, 0, 1)[..., None]
    out[..., :3] = np.array(rgb, np.float32) * (1 - w) + w
    out[..., 3] = a
    return out


def ray_burst(d: int, rays: int, rgb, inner: float = 0.18, width: float = 0.5, alpha: float = 0.9,
              twist: float = 0.0) -> np.ndarray:
    """A sun-burst of `rays` soft wedges (rotationally symmetric by 360/rays: a loop may rotate it by one period)."""
    y, x = np.mgrid[0:d, 0:d] + 0.5
    u, v = (x - d / 2) / (d / 2), (y - d / 2) / (d / 2)
    r = np.hypot(u, v)
    th = np.arctan2(v, u) + twist * r
    wedge = np.clip(np.cos(th * rays), 0, 1) ** (1.0 / max(0.05, width) * 2.0)
    radial = np.clip((r - inner) / 0.12, 0, 1) * np.clip(1 - r, 0, 1) ** 1.3
    core = np.exp(-(r / (inner * 1.3)) ** 2) * 0.8
    a = np.clip(wedge * radial * 1.4 + core, 0, 1) * alpha
    out = np.zeros((d, d, 4), np.float32)
    w = np.clip(core + wedge * radial * 0.5, 0, 1)[..., None]
    out[..., :3] = np.array(rgb, np.float32) * (1 - w * 0.6) + w * 0.6
    out[..., 3] = a
    return out


def rim_glow(alpha: np.ndarray, width: float, rgb, inside: float = 0.25, strength: float = 1.0) -> np.ndarray:
    """Soft outline glow around a silhouette (canvas layer): bright just outside the edge, fading outward."""
    a = (alpha > 0.5).astype(np.uint8)
    d_out = cv2.distanceTransform(1 - a, cv2.DIST_L2, 5)
    d_in = cv2.distanceTransform(a, cv2.DIST_L2, 5)
    g = np.where(a > 0, np.exp(-(d_in / max(1.0, width * inside)) ** 2), np.exp(-(d_out / width) ** 2))
    out = np.zeros(alpha.shape + (4,), np.float32)
    w = np.clip(g * 1.2 - 0.4, 0, 1)[..., None]
    out[..., :3] = np.array(rgb, np.float32) * (1 - w) + w
    out[..., 3] = np.where(g * strength < 0.012, 0, np.clip(g * strength, 0, 1))
    return out


def bolt(size: int, seed: int, rgb=(0.55, 0.95, 1.0), segments: int = 7, width: float = 5.0, spread: float = 0.5,
         angle: float = 0.0, length: float = 0.9) -> np.ndarray:
    """A jagged electric arc (soft glow + white core) on a size x size sprite, centred, along `angle` degrees."""
    rng = np.random.default_rng(seed)
    ss = 3
    S = size * ss
    core = Image.new("L", (S, S), 0)
    glow = Image.new("L", (S, S), 0)
    dc, dg = ImageDraw.Draw(core), ImageDraw.Draw(glow)
    a = math.radians(angle)
    L = size * length * ss
    x0, y0 = S / 2 - math.cos(a) * L / 2, S / 2 - math.sin(a) * L / 2
    pts = [(x0, y0)]
    for i in range(1, segments + 1):
        t = i / segments
        jitter = (rng.uniform(-1, 1) * spread * L / segments) if i < segments else 0.0
        px = x0 + math.cos(a) * L * t - math.sin(a) * jitter
        py = y0 + math.sin(a) * L * t + math.cos(a) * jitter
        pts.append((px, py))
    # a short fork from the middle
    k = segments // 2
    fx, fy = pts[k]
    fa = a + rng.choice([-1, 1]) * rng.uniform(0.5, 0.9)
    fork = [(fx, fy), (fx + math.cos(fa) * L * 0.22, fy + math.sin(fa) * L * 0.22)]
    for line, wmul in ((pts, 1.0), (fork, 0.7)):
        dg.line(line, fill=255, width=int(width * ss * 3.2 * wmul), joint="curve")
        dc.line(line, fill=255, width=max(1, int(width * ss * wmul)), joint="curve")
    core = np.asarray(core.resize((size, size), Image.BOX), np.float32) / 255
    glow = cv2.GaussianBlur(np.asarray(glow.resize((size, size), Image.BOX), np.float32) / 255, (0, 0), width * 0.9)
    a_ = np.clip(core + glow * 0.75, 0, 1)
    out = np.zeros((size, size, 4), np.float32)
    w = np.clip(core * 1.3, 0, 1)[..., None]
    out[..., :3] = np.array(rgb, np.float32) * (1 - w) + w
    out[..., 3] = a_
    return out


def sheen_frames(base: np.ndarray, n: int, angle: float = 62.0, width: float = 16.0, strength: float = 0.75,
                 rgb=(1.0, 0.98, 0.9), inset: int = 2, travel: tuple[float, float] = (-0.15, 1.15),
                 mask: np.ndarray | None = None) -> list[np.ndarray]:
    """A light band sweeping across a part (canvas layers, one per frame): `n` copies of the part's own silhouette
    lit by a soft diagonal stripe (angle in degrees from +x, image space), from travel[0] to travel[1] of the part's
    extent along the sweep direction. Played as an attachment sweep (no sequence attachments, no clipping), normal
    blend, on the part's own bone so it rides every squash and scatter."""
    a = base[..., 3] if mask is None else mask
    sil = cl.erode((a > 0.5).astype(np.float32), inset) if inset else (a > 0.5).astype(np.float32)
    sil = cl.feather(sil, 0.8) * (a > 0.02)
    ys, xs = np.nonzero(sil > 0.02)
    th = math.radians(angle)
    dx, dy = math.cos(th), math.sin(th)          # stripe runs along (dx, dy); it travels across it
    nx, ny = -dy, dx
    if nx < 0 or (nx == 0 and ny < 0):        # sweep left -> right (top -> bottom for a horizontal stripe)
        nx, ny = -nx, -ny
    Y, X = np.mgrid[0:a.shape[0], 0:a.shape[1]] + 0.5
    proj = X * nx + Y * ny
    lo, hi = float((xs * nx + ys * ny).min()), float((xs * nx + ys * ny).max())
    out = []
    for i in range(n):
        t = travel[0] + (travel[1] - travel[0]) * (i / max(1, n - 1))
        c = lo + (hi - lo) * t
        stripe = np.exp(-((proj - c) / width) ** 2) + 0.45 * np.exp(-((proj - c - width * 2.2) / (width * 0.45)) ** 2)
        lay = np.zeros(a.shape + (4,), np.float32)
        lay[..., :3] = rgb
        lay[..., 3] = np.clip(stripe * strength, 0, 1) * sil
        out.append(lay)
    return out


def lighten(layer: np.ndarray, amount: float = 0.6, white_core: float = 0.0) -> np.ndarray:
    """A brighter copy of a layer (towards white), same alpha: a normal-blend flash overlay."""
    out = layer.copy()
    out[..., :3] = np.clip(layer[..., :3] + (1 - layer[..., :3]) * amount, 0, 1)
    if white_core:
        out[..., :3] = np.clip(out[..., :3] * (1 - white_core) + white_core, 0, 1)
    return out


# ------------------------------------------------------------------------------------------ the rig being cut
class Rig:
    """One symbol's cut: the master, its canvas fit, the parts written so far, and the QA outputs."""

    def __init__(self, sid: str, content: float | None = None, clean: bool = True):
        self.sid = sid
        self.src = SYMBOLS_ROOT / sid
        self.img = IMAGES_ROOT / f"sym_{sid}"
        self.qa = REPO / f"build/qa/rigs/mh_sym_{sid}"
        self.img.mkdir(parents=True, exist_ok=True)
        self.qa.mkdir(parents=True, exist_ok=True)
        if clean:   # a re-cut never leaves a retired part behind (make_blur re-adds the _blur variants)
            for f in self.img.glob("*.png"):
                f.unlink()
        self.master_path = self.src / "master_1024.png"
        self.M = cl.load(self.master_path)
        self.shape = self.M.shape
        self.cell_scale = cell_scale(sid)
        self.content = float(content if content is not None else round(self.cell_scale * CELL))
        self.fit = cl.Fit.symbol(self.M, self.content, canvas=(CANVAS, CANVAS))
        self.parts: list[dict] = []
        self.canv: dict[str, np.ndarray] = {}
        self.H, self.S, self.V = hsv(self.M)
        self.alpha = self.M[..., 3]

    # master px -> canvas units (image space)
    def pt(self, x: float, y: float) -> tuple[float, float]:
        return self.fit.pt(x, y)

    def ptr(self, x: float, y: float) -> list[float]:
        p = self.fit.pt(x, y)
        return [round(p[0], 1), round(p[1], 1)]

    def px(self, units: float) -> float:
        """canvas units -> master px"""
        return units / self.fit.s

    def to_canvas(self, layer: np.ndarray) -> np.ndarray:
        return self.fit.canvas(layer)

    def add(self, name: str, layer: np.ndarray, despeckle: int = 30, pad: int = 3, **kw) -> list:
        """A master-sized layer -> canvas, trimmed, saved; `kw` go to parts.json (z, bone, slot, joint, ...)."""
        c = self.fit.canvas(layer)
        if despeckle:
            c = cl.despeckle(c, despeckle)
        return self.add_canvas(name, c, pad=pad, **kw)

    def add_canvas(self, name: str, c: np.ndarray, pad: int = 3, **kw) -> list:
        """A canvas-sized layer (derived from the master unless `$src` says "code": provenance, ship_rig.py)."""
        kw.setdefault("$src", "master")
        img, bbox = cl.trim(c, pad)
        cl.save(img, self.img / f"{name}.png")
        self.canv[name] = cl.paste((CANVAS, CANVAS), img, bbox)
        self.parts.append(dict({"name": name, "bbox": bbox}, **kw))
        return bbox

    def add_sprite(self, name: str, img: np.ndarray, centre, scale: int = 1, **kw) -> list:
        """A procedural fx sprite placed by its centre (canvas units). `scale` 2 stores a soft sprite (glow, rays) at
        half resolution: declare it under heist.yaml `region_scale` so the region draws it 2x around the same centre."""
        full = img
        if scale > 1:
            h, w = img.shape[:2]
            prem = img.copy()
            prem[..., :3] *= prem[..., 3:4]
            ch = [np.asarray(Image.fromarray(prem[..., c], "F").resize((w // scale, h // scale), Image.LANCZOS)) for c in range(4)]
            img = np.clip(np.stack(ch, -1), 0, 1)
            a = img[..., 3:4]
            img[..., :3] = np.where(a > 1e-5, img[..., :3] / np.maximum(a, 1e-5), 0)
        bbox = place(img, centre)
        cl.save(img, self.img / f"{name}.png")
        self.canv[name] = cl.paste((CANVAS, CANVAS), full, place(full, centre))
        kw.setdefault("joint", [round(centre[0], 1), round(centre[1], 1)])
        kw.setdefault("$src", "code")          # drawn in code: owned-code provenance (ship_rig.py)
        self.parts.append(dict({"name": name, "bbox": bbox}, **kw))
        return bbox

    def reference(self) -> np.ndarray:
        return self.fit.canvas(self.M)

    def finish(self, comment: str, rest: list[str], blur: list[str], keypoints: dict | None = None,
               previews: dict[str, list[str]] | None = None, extra: dict | None = None,
               gate: tuple[float, float] = (0.995, 0.99)) -> dict:
        """parts.json + the reassembly check (rest = back-to-front part names visible at setup) + QA previews."""
        pj = cl.write_parts(self.src, self.sid, self.parts, comment=comment, blur=blur)
        ref = self.reference()
        met, comp = cl.reassembly([self.canv[n] for n in rest], ref)
        kp = {k: self.ptr(*v) for k, v in (keypoints or {}).items()}
        doc = {"reassembly": met, "gate": {"iou": gate[0], "ssim": gate[1]},
               "fit": {"s": self.fit.s, "ox": self.fit.ox, "oy": self.fit.oy, "content": self.content,
                       "cellScale": self.cell_scale},
               "keypoints": kp, **(extra or {})}
        (self.qa / "cut.json").write_text(json.dumps(doc, indent=1) + "\n")
        cl.preview([self.canv[n] for n in rest], self.qa / "rest.png")
        cl.preview([ref], self.qa / "master_on_canvas.png")
        diff = np.abs(comp - ref)
        dimg = (np.clip(diff[..., :3].max(-1) * 4 + diff[..., 3] * 4, 0, 1) * 255).astype(np.uint8)
        Image.fromarray(dimg).resize((720, 720), Image.NEAREST).save(self.qa / "rest_diff.png")
        for name, layers in (previews or {}).items():
            cl.preview([self.canv[n] for n in layers], self.qa / f"{name}.png")
        ok = met["iou"] >= gate[0] and met["ssim"] >= gate[1]
        print(f"cut_{self.sid}: {len(self.parts)} parts -> {pj.relative_to(REPO)}; reassembly {met} "
              f"({'ok' if ok else 'BELOW GATE'} iou>={gate[0]} ssim>={gate[1]})")
        if kp:
            print(f"cut_{self.sid}: keypoints (canvas): {json.dumps(kp)}")
        if not ok:
            raise SystemExit(f"cut_{self.sid}: the rest pose does not reassemble the master")
        return doc
