"""Master-cut helpers for the Bass Drop Spine rigs (the split stage for symbol masters whose part sheets
were re-drawn by the model and do not register: tools/split README "Known limits").

Every visible pixel of a rig comes from the APPROVED matted master (art/source/symbols/<ID>/master_rig_1024.png,
art/source/ui/...), cut with masks drawn in master pixels. Hidden areas that a motion can reveal are filled
from a registered part-sheet piece or by inpainting, and are always UNDER the part that hides them at rest,
so the rest pose reassembles to the master exactly (checked by `reassembly`).

All parts go to the rig canvas through ONE transform (`Fit`): premultiplied Lanczos resample of the whole
master-sized layer, pasted at the same integer offset, then trimmed + padded. Straight-alpha PNGs out.
"""
from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

REPO = Path(__file__).resolve().parents[5]


def load(path) -> np.ndarray:
    """Straight RGBA float32 [0, 1]."""
    return np.asarray(Image.open(path).convert("RGBA"), dtype=np.float32) / 255.0


def save(arr: np.ndarray, path) -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    a = np.clip(arr, 0, 1)
    out = (a * 255 + 0.5).astype(np.uint8)
    out[..., :3][out[..., 3] == 0] = 0
    Image.fromarray(out, "RGBA").save(path, optimize=True)


def poly(shape, pts, ss: int = 4) -> np.ndarray:
    """Anti-aliased polygon coverage (float 0..1) at master resolution."""
    h, w = shape[:2]
    im = Image.new("L", (w * ss, h * ss), 0)
    ImageDraw.Draw(im).polygon([(x * ss, y * ss) for x, y in pts], fill=255)
    return np.asarray(im.resize((w, h), Image.BOX), dtype=np.float32) / 255.0


def ellipse(shape, cx, cy, rx, ry, ss: int = 4) -> np.ndarray:
    h, w = shape[:2]
    im = Image.new("L", (w * ss, h * ss), 0)
    ImageDraw.Draw(im).ellipse([(cx - rx) * ss, (cy - ry) * ss, (cx + rx) * ss, (cy + ry) * ss], fill=255)
    return np.asarray(im.resize((w, h), Image.BOX), dtype=np.float32) / 255.0


def curve_below(shape, pts) -> np.ndarray:
    """Coverage of the region BELOW a left-to-right polyline (y down), x outside the polyline span clamps."""
    h, w = shape[:2]
    xs = np.array([p[0] for p in pts], float)
    ys = np.array([p[1] for p in pts], float)
    yb = np.interp(np.arange(w) + 0.5, xs, ys)
    Y = np.arange(h)[:, None] + 0.5
    return np.clip(Y - yb[None, :] + 0.5, 0, 1).astype(np.float32)


def feather(m: np.ndarray, r: float) -> np.ndarray:
    if r <= 0:
        return m
    im = Image.fromarray((np.clip(m, 0, 1) * 255).astype(np.uint8), "L").filter(ImageFilter.GaussianBlur(r))
    return np.asarray(im, dtype=np.float32) / 255.0


def dilate(m: np.ndarray, r: int) -> np.ndarray:
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))
    return cv2.dilate((m > 0.5).astype(np.uint8), k).astype(np.float32)


def erode(m: np.ndarray, r: int) -> np.ndarray:
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))
    return cv2.erode((m > 0.5).astype(np.uint8), k).astype(np.float32)


def layer(master: np.ndarray, cover: np.ndarray) -> np.ndarray:
    """Part layer = master pixels with alpha x coverage."""
    out = master.copy()
    out[..., 3] = master[..., 3] * np.clip(cover, 0, 1)
    return out


def over(top: np.ndarray, bottom: np.ndarray) -> np.ndarray:
    """Straight-alpha 'over'."""
    ta, ba = top[..., 3:4], bottom[..., 3:4]
    oa = ta + ba * (1 - ta)
    rgb = np.where(oa > 1e-6, (top[..., :3] * ta + bottom[..., :3] * ba * (1 - ta)) / np.maximum(oa, 1e-6), 0)
    return np.concatenate([rgb, oa], -1).astype(np.float32)


def inpaint_rgb(rgba: np.ndarray, hole: np.ndarray, radius: int = 9, known: np.ndarray | None = None) -> np.ndarray:
    """Fill RGB inside `hole` from the surrounding opaque colour (OpenCV Telea); alpha untouched.
    `known` limits the colour sources (default: opaque pixels outside the hole)."""
    rgb = (np.clip(rgba[..., :3], 0, 1) * 255).astype(np.uint8)
    src = (rgba[..., 3] > 0.9) if known is None else (known > 0.5)
    mask = ((hole > 0.5) | ~src).astype(np.uint8) * 255
    filled = cv2.inpaint(cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR), mask, radius, cv2.INPAINT_TELEA)
    filled = cv2.cvtColor(filled, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
    out = rgba.copy()
    h = hole > 0.5
    out[..., :3][h] = filled[h]
    return out


def stroke(cover: np.ndarray, width: float, where: np.ndarray | None = None, colour=(0.02, 0.015, 0.02)) -> np.ndarray:
    """An outline layer along the inside boundary of `cover` (width in master px), optionally only where `where`."""
    m = (cover > 0.5).astype(np.uint8)
    dist = cv2.distanceTransform(m, cv2.DIST_L2, 5)
    a = np.clip(width - dist + 0.5, 0, 1) * (m > 0)
    if where is not None:
        a = a * where
    out = np.zeros(cover.shape + (4,), np.float32)
    out[..., 0], out[..., 1], out[..., 2] = colour
    out[..., 3] = a
    return out


@dataclass
class Fit:
    """Master px -> canvas units: canvas = master * s + (ox, oy) (integer offset, s with an integer size)."""
    s: float
    ox: int
    oy: int
    W: int
    H: int
    src: tuple[int, int]

    @classmethod
    def symbol(cls, master: np.ndarray, content: float, canvas=(360, 360), centre=None) -> "Fit":
        a = master[..., 3] > 0.02
        ys, xs = np.nonzero(a)
        x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
        h, w = a.shape
        s = content / max(x1 - x0, y1 - y0)
        size = round(w * s)
        s = size / w
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        tx, ty = centre if centre else (canvas[0] / 2, canvas[1] / 2)
        return cls(s, round(tx - cx * s), round(ty - cy * s), canvas[0], canvas[1], (w, h))

    @classmethod
    def explicit(cls, master_size, s: float, anchor_master, anchor_canvas, canvas) -> "Fit":
        w, h = master_size
        size = round(w * s)
        s = size / w
        return cls(s, round(anchor_canvas[0] - anchor_master[0] * s), round(anchor_canvas[1] - anchor_master[1] * s),
                   canvas[0], canvas[1], (w, h))

    def pt(self, x, y):
        return (x * self.s + self.ox, y * self.s + self.oy)

    def canvas(self, lay: np.ndarray) -> np.ndarray:
        h, w = lay.shape[:2]
        sw, sh = round(w * self.s), round(h * self.s)
        prem = lay.copy()
        prem[..., :3] *= prem[..., 3:4]
        # premultiplied Lanczos (PIL float per channel)
        chans = [np.asarray(Image.fromarray(prem[..., c], "F").resize((sw, sh), Image.LANCZOS)) for c in range(4)]
        small = np.clip(np.stack(chans, -1), 0, 1)
        out = np.zeros((self.H, self.W, 4), np.float32)
        x0, y0 = self.ox, self.oy
        sx0, sy0 = max(0, -x0), max(0, -y0)
        dx0, dy0 = max(0, x0), max(0, y0)
        cw = min(sw - sx0, self.W - dx0)
        ch = min(sh - sy0, self.H - dy0)
        if cw > 0 and ch > 0:
            out[dy0:dy0 + ch, dx0:dx0 + cw] = small[sy0:sy0 + ch, sx0:sx0 + cw]
        a = out[..., 3:4]
        out[..., :3] = np.where(a > 1e-5, out[..., :3] / np.maximum(a, 1e-5), 0)
        out[..., 3] = np.where(out[..., 3] < 3 / 255, 0, out[..., 3])
        return out


def trim(canvas_rgba: np.ndarray, pad: int = 3):
    """-> (image, bbox [x, y, w, h] on the canvas). The image may extend outside the canvas (negative x)."""
    a = canvas_rgba[..., 3] > 0
    ys, xs = np.nonzero(a)
    if len(xs) == 0:
        raise ValueError("empty part")
    x0, x1, y0, y1 = xs.min() - pad, xs.max() + 1 + pad, ys.min() - pad, ys.max() + 1 + pad
    H, W = a.shape
    img = np.zeros((y1 - y0, x1 - x0, 4), np.float32)
    sx0, sy0 = max(0, x0), max(0, y0)
    sx1, sy1 = min(W, x1), min(H, y1)
    img[sy0 - y0:sy1 - y0, sx0 - x0:sx1 - x0] = canvas_rgba[sy0:sy1, sx0:sx1]
    return img, [int(x0), int(y0), int(x1 - x0), int(y1 - y0)]


def paste(canvas_shape, img, bbox) -> np.ndarray:
    H, W = canvas_shape[:2]
    out = np.zeros((H, W, 4), np.float32)
    x, y, w, h = bbox
    sx0, sy0 = max(0, -x), max(0, -y)
    dx0, dy0 = max(0, x), max(0, y)
    cw, ch = min(w - sx0, W - dx0), min(h - sy0, H - dy0)
    out[dy0:dy0 + ch, dx0:dx0 + cw] = img[sy0:sy0 + ch, sx0:sx0 + cw]
    return out


def ssim(a: np.ndarray, b: np.ndarray, sigma: float = 1.5) -> float:
    a = a.astype(np.float64)
    b = b.astype(np.float64)
    C1, C2 = (0.01) ** 2, (0.03) ** 2
    g = lambda x: cv2.GaussianBlur(x, (0, 0), sigma)
    ma, mb = g(a), g(b)
    va, vb, cov = g(a * a) - ma * ma, g(b * b) - mb * mb, g(a * b) - ma * mb
    s = ((2 * ma * mb + C1) * (2 * cov + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2))
    return float(s.mean())


def reassembly(parts_on_canvas: list[np.ndarray], reference: np.ndarray) -> dict:
    """Rest-pose composite (back to front) vs the master on the same canvas: alpha IoU and display-scale SSIM
    of the luminance over mid grey (tools/split's gate definition)."""
    comp = np.zeros_like(reference)
    for p in parts_on_canvas:
        comp = over(p, comp)
    A, B = comp[..., 3] > 0.5, reference[..., 3] > 0.5
    iou = float((A & B).sum() / max(1, (A | B).sum()))

    def lum_on_grey(x):
        rgb = x[..., :3] * x[..., 3:4] + 0.5 * (1 - x[..., 3:4])
        return cv2.GaussianBlur((rgb @ np.array([0.2126, 0.7152, 0.0722])).astype(np.float64), (0, 0), 1.0)
    return {"iou": round(iou, 4), "ssim": round(ssim(lum_on_grey(comp), lum_on_grey(reference)), 4),
            "maxAbs": round(float(np.abs(comp[..., 3] - reference[..., 3]).max()), 3)}, comp


def sheet_piece(path, key_rgb, bbox, thr: float = 60.0, soft: float = 30.0) -> np.ndarray:
    """A crude key-distance matte of one region of a part sheet (used only as a hidden-area FILL source:
    its edges never show, so no despill). Returns straight RGBA of the crop."""
    im = np.asarray(Image.open(path).convert("RGB"), dtype=np.float32)
    x, y, w, h = bbox
    crop = im[y:y + h, x:x + w]
    d = np.sqrt(((crop - np.array(key_rgb, np.float32)) ** 2).sum(-1))
    a = np.clip((d - thr) / soft, 0, 1)
    return np.concatenate([crop / 255.0, a[..., None]], -1).astype(np.float32)


def warp_into(piece: np.ndarray, M: np.ndarray, shape) -> np.ndarray:
    """Affine-warp a straight RGBA piece (2x3 matrix piece px -> master px) onto a master-sized layer."""
    h, w = shape[:2]
    prem = piece.copy()
    prem[..., :3] *= prem[..., 3:4]
    out = cv2.warpAffine(prem, M.astype(np.float64), (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
    out = np.clip(out, 0, 1)
    a = out[..., 3:4]
    out[..., :3] = np.where(a > 1e-5, out[..., :3] / np.maximum(a, 1e-5), 0)
    return out.astype(np.float32)


def register_sift(piece: np.ndarray, master: np.ndarray, region=None, full_affine: bool = False, ratio: float = 0.75):
    """SIFT + RANSAC similarity (or affine) piece -> master. `region` = master mask to search in.
    Returns (2x3 matrix, inliers, matches) or (None, 0, n)."""
    def gray(x):
        g = (x[..., :3] * x[..., 3:4] + 0.5 * (1 - x[..., 3:4])) @ np.array([0.299, 0.587, 0.114])
        return (np.clip(g, 0, 1) * 255).astype(np.uint8)
    sift = cv2.SIFT_create(nfeatures=6000)
    m1 = (piece[..., 3] > 0.5).astype(np.uint8) * 255
    m2 = ((master[..., 3] > 0.5) if region is None else (region > 0.5)).astype(np.uint8) * 255
    k1, d1 = sift.detectAndCompute(gray(piece), m1)
    k2, d2 = sift.detectAndCompute(gray(master), m2)
    if d1 is None or d2 is None or len(k1) < 4 or len(k2) < 4:
        return None, 0, 0
    bf = cv2.BFMatcher()
    good = []
    for pair in bf.knnMatch(d1, d2, k=2):
        if len(pair) == 2 and pair[0].distance < ratio * pair[1].distance:
            good.append(pair[0])
    if len(good) < 4:
        return None, 0, len(good)
    p1 = np.float32([k1[m.queryIdx].pt for m in good])
    p2 = np.float32([k2[m.trainIdx].pt for m in good])
    fn = cv2.estimateAffine2D if full_affine else cv2.estimateAffinePartial2D
    M, inl = fn(p1, p2, method=cv2.RANSAC, ransacReprojThreshold=4.0, maxIters=5000, confidence=0.999)
    if M is None:
        return None, 0, len(good)
    return M, int(inl.sum()), len(good)


def write_parts(out_dir: Path, symbol: str, parts: list[dict], canvas=(360, 360), images_rel="../../spine/images",
                comment: str = "", blur: list[str] | None = None) -> Path:
    """parts.json for tools/spine/gen.py; `blur` = the parts build.sh --cut gives _blur variants (make_blur.py)."""
    doc = {"$comment": comment, "symbol": symbol, "canvas": list(canvas), "images": images_rel}
    if blur:
        doc["$blur"] = list(blur)
    doc["parts"] = parts
    p = Path(out_dir) / "parts.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(doc, indent=1) + "\n", encoding="utf-8")
    return p


def preview(canvas_layers: list[np.ndarray], out, bg=(0.16, 0.06, 0.37), scale: int = 2, grid: bool = True) -> None:
    H, W = canvas_layers[0].shape[:2]
    comp = np.zeros((H, W, 4), np.float32)
    for p in canvas_layers:
        comp = over(p, comp)
    base = np.ones((H, W, 3), np.float32) * np.array(bg, np.float32)
    rgb = comp[..., :3] * comp[..., 3:4] + base * (1 - comp[..., 3:4])
    im = Image.fromarray((np.clip(rgb, 0, 1) * 255).astype(np.uint8)).resize((W * scale, H * scale), Image.NEAREST)
    if grid and W == 360 and H == 360:
        d = ImageDraw.Draw(im)
        d.rectangle([30 * scale, 30 * scale, 330 * scale, 330 * scale], outline=(154, 123, 255))
    im.save(out)


def crop(canvas_rgba: np.ndarray, bbox) -> np.ndarray:
    """Inverse of `paste`: the bbox window of a canvas layer (zeros outside the canvas)."""
    x, y, w, h = bbox
    H, W = canvas_rgba.shape[:2]
    out = np.zeros((h, w, 4), np.float32)
    sx0, sy0 = max(0, x), max(0, y)
    sx1, sy1 = min(W, x + w), min(H, y + h)
    if sx1 > sx0 and sy1 > sy0:
        out[sy0 - y:sy1 - y, sx0 - x:sx1 - x] = canvas_rgba[sy0:sy1, sx0:sx1]
    return out


# ------------------------------------------------------------------------------------------ shared helpers (H1-H4, meter)
def rot_ellipse(shape, cx, cy, ax, ay, ang_deg=0.0, grow: float = 0.0, n: int = 360) -> np.ndarray:
    """Anti-aliased coverage of a rotated ellipse (cv2.fitEllipse convention: `ax` along the x axis rotated by
    `ang_deg`), grown by `grow` px."""
    t = np.linspace(0, 2 * np.pi, n, endpoint=False)
    a = math.radians(ang_deg)
    rx, ry = ax + grow, ay + grow
    xs = cx + rx * np.cos(t) * math.cos(a) - ry * np.sin(t) * math.sin(a)
    ys = cy + rx * np.cos(t) * math.sin(a) + ry * np.sin(t) * math.cos(a)
    return poly(shape, list(zip(xs, ys)))


def grow_poly(pts, d: float):
    """Offset a convex polygon outward by d px (vertices pushed along the bisector)."""
    P = np.array(pts, float)
    c = P.mean(0)
    out = []
    for p in P:
        v = p - c
        out.append(tuple(p + v / max(1e-6, np.linalg.norm(v)) * d))
    return out


def glow_disc(d: int, rgb, alpha: float = 0.85, power: float = 2.2) -> np.ndarray:
    y, x = np.mgrid[0:d, 0:d] + 0.5
    r = np.hypot(x - d / 2, y - d / 2) / (d / 2)
    out = np.zeros((d, d, 4), np.float32)
    out[..., :3] = rgb
    out[..., 3] = np.clip(1 - r, 0, 1) ** power * alpha
    return out


def star_glint(d: int, rgb=(1.0, 0.95, 0.75), arms: int = 4, core: float = 0.16) -> np.ndarray:
    """A formula-D specular glint: soft white core + thin tapered arms (additive fx sprite)."""
    y, x = np.mgrid[0:d, 0:d] + 0.5
    u, v = (x - d / 2) / (d / 2), (y - d / 2) / (d / 2)
    r = np.hypot(u, v)
    th = np.arctan2(v, u)
    a = np.exp(-(r / core) ** 2)
    for k in range(arms):
        across = np.abs(np.sin(th - k * (2 * np.pi / arms))) * r
        along = np.cos(th - k * (2 * np.pi / arms))
        arm = np.exp(-(across / (0.03 + 0.05 * (1 - r))) ** 2) * np.clip(1 - r, 0, 1) ** 1.5 * (along > 0)
        a = np.maximum(a, arm)
    out = np.zeros((d, d, 4), np.float32)
    w = np.clip(a * 1.6, 0, 1)[..., None]
    out[..., :3] = np.array(rgb, np.float32) * (1 - w * 0.6) + w * 0.6
    out[..., 3] = np.clip(a, 0, 1)
    return out


def piece_to_master(piece: np.ndarray, base_xy, tip_xy, target_base, target_tip, shape) -> np.ndarray:
    """Similarity-warp a straight RGBA sheet piece so its base->tip axis lands on target_base->target_tip
    (a master-sized layer)."""
    bx, by = base_xy
    tx, ty = tip_xy
    Bx, By = target_base
    Tx, Ty = target_tip
    s = math.hypot(Tx - Bx, Ty - By) / math.hypot(tx - bx, ty - by)
    a = math.atan2(Ty - By, Tx - Bx) - math.atan2(ty - by, tx - bx)
    c, sn = math.cos(a) * s, math.sin(a) * s
    M = np.array([[c, -sn, 0.0], [sn, c, 0.0]])
    M[:, 2] = np.array([Bx, By]) - M[:, :2] @ np.array([bx, by])
    if s < 1:   # pre-filter the downscale (Lanczos on premultiplied) before the cubic warp
        h, w = piece.shape[:2]
        prem = piece.copy()
        prem[..., :3] *= prem[..., 3:4]
        nw, nh = max(1, round(w * s * 1.5)), max(1, round(h * s * 1.5))
        ch = [np.asarray(Image.fromarray(prem[..., k], "F").resize((nw, nh), Image.LANCZOS)) for k in range(4)]
        small = np.clip(np.stack(ch, -1), 0, 1)
        al = small[..., 3:4]
        small[..., :3] = np.where(al > 1e-5, small[..., :3] / np.maximum(al, 1e-5), 0)
        f = nw / w
        M2 = M.copy()
        M2[:, :2] = M[:, :2] / f
        return warp_into(small.astype(np.float32), M2, shape)
    return warp_into(piece, M, shape)


def principal_axis(piece: np.ndarray):
    """(centre, unit axis, half-length) of a piece's alpha (PCA)."""
    ys, xs = np.nonzero(piece[..., 3] > 0.5)
    P = np.stack([xs, ys], 1).astype(float)
    c = P.mean(0)
    u, s, vt = np.linalg.svd(P - c, full_matrices=False)
    ax = vt[0]
    proj = (P - c) @ ax
    return c, ax, proj.min(), proj.max()


def blur_rgb(layer_rgba: np.ndarray, sigma: float) -> np.ndarray:
    out = layer_rgba.copy()
    for k in range(3):
        out[..., k] = cv2.GaussianBlur(layer_rgba[..., k], (0, 0), sigma)
    return out


def despeckle(rgba: np.ndarray, min_area: int = 30) -> np.ndarray:
    """Drop isolated specks (connected alpha islands smaller than min_area px): anti-aliasing crumbs a cut left."""
    a = rgba[..., 3] > 0.02
    n, lab, st, _ = cv2.connectedComponentsWithStats(a.astype(np.uint8), 8)
    out = rgba.copy()
    for i in range(1, n):
        if st[i, 4] < min_area:
            out[lab == i] = 0
    return out
