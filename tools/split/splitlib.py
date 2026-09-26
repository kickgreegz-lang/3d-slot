"""Part-sheet split (PIPELINE 3.1, CPU only): key matte -> connected components -> named pieces ->
registration onto the rig master -> canvas placement, joints / landmarks -> parts.json + reassembly QA.

No SAM or GPU: the Higgsfield part sheets are generated on a flat key with *wide gaps between pieces*
(art/bible/prompts/symbol_parts_sheet.txt#A, mascot_parts_sheet.txt#B-E), so the closed-outline key
matte (tools/matte) plus connected components cut them exactly. The operator (an agent) looks at the
labelled components preview and writes a small mapping file (component id -> slot); everything else
is computed here.

Coordinates: continuous image coordinates, x right, y down, pixel (i, j) covers [j, j+1) x [i, i+1)
(its centre is (j + 0.5, i + 0.5)). Transforms are 3x3 affine matrices on (x, y, 1).
Spaces: sheet px (a crop of it per piece) -> master px (the approved rig master) -> canvas units
(symbols: the 360x360 @2x canvas; characters: 2x the landscape design rect, root = feet point).
Images are float32 in [0, 1], straight alpha unless a name says `prem` (premultiplied).
"""
from __future__ import annotations

import hashlib
import json
import math
import os
import sys
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage as ndi
from scipy.signal import fftconvolve

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
sys.path.insert(0, str(REPO / "tools" / "matte"))
import mattelib as ml  # noqa: E402

if os.environ.get("SPLIT_NO_CV2"):
    cv2 = None
else:
    try:
        import cv2  # opencv-python-headless (tools/requirements.txt); optional
    except ImportError:  # pragma: no cover - exercised with SPLIT_NO_CV2=1
        cv2 = None
HAVE_CV2 = cv2 is not None

# ART_BIBLE section 10 "Spine split" gate
GATE_SSIM = 0.98
GATE_IOU = 0.99
GATE_NCC = 0.5          # registration confidence below this needs a placement hint
JOINT_TEST_DEG = 35.0   # PIPELINE 3.1: no holes when any bone rotates +-35 degrees


class SplitError(ValueError):
    pass


# ----------------------------------------------------------------------------- small helpers


def sha256_file(path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def affine(a: float = 1, b: float = 0, c: float = 0, d: float = 1, tx: float = 0, ty: float = 0) -> np.ndarray:
    """x' = a x + b y + tx ; y' = c x + d y + ty"""
    return np.array([[a, b, tx], [c, d, ty], [0, 0, 1]], np.float64)


def scale_m(s: float, sy: float | None = None) -> np.ndarray:
    return affine(s, 0, 0, s if sy is None else sy)


def trans_m(tx: float, ty: float) -> np.ndarray:
    return affine(tx=tx, ty=ty)


def rot_m(deg: float, cx: float = 0.0, cy: float = 0.0) -> np.ndarray:
    r = math.radians(deg)
    c, s = math.cos(r), math.sin(r)
    return trans_m(cx, cy) @ affine(c, -s, s, c) @ trans_m(-cx, -cy)


def apply(A: np.ndarray, pts) -> np.ndarray:
    p = np.atleast_2d(np.asarray(pts, np.float64))
    return p @ A[:2, :2].T + A[:2, 2]


def decompose(A: np.ndarray) -> dict:
    """Isotropic scale, rotation (deg, image space: + = clockwise on screen), anisotropy, shear."""
    L = A[:2, :2]
    det = float(np.linalg.det(L))
    s = math.sqrt(abs(det)) if det else 0.0
    rot = math.degrees(math.atan2(L[1, 0] - L[0, 1], L[0, 0] + L[1, 1]))
    sv = np.linalg.svd(L, compute_uv=False)
    return {"scale": round(s, 5), "rotation": round(rot, 3), "anisotropy": round(float(sv[0] / max(sv[1], 1e-9)), 4),
            "tx": round(float(A[0, 2]), 3), "ty": round(float(A[1, 2]), 3)}


def premultiply(rgb: np.ndarray, a: np.ndarray) -> np.ndarray:
    return np.dstack([rgb * a[..., None], a]).astype(np.float32)


def unpremultiply(prem: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    a = np.clip(prem[..., 3], 0, 1)
    a[a < 1 / 512] = 0
    rgb = np.where(a[..., None] > 1e-4, np.clip(prem[..., :3] / np.maximum(a[..., None], 1e-4), 0, 1), 0)
    return rgb.astype(np.float32), a.astype(np.float32)


def resize_prem(prem: np.ndarray, size: tuple[int, int]) -> np.ndarray:
    """Lanczos resize of a premultiplied RGBA float image to size=(w, h) (PIL 'F' per channel)."""
    w, h = size
    out = [np.asarray(Image.fromarray(prem[..., c].astype(np.float32), "F").resize((w, h), Image.Resampling.LANCZOS),
                      np.float32) for c in range(prem.shape[2])]
    o = np.clip(np.dstack(out), 0, 1)
    if o.shape[2] == 4:
        o[..., :3] = np.minimum(o[..., :3], o[..., 3:4])
    return o


def resize_gray(img: np.ndarray, f: float) -> np.ndarray:
    h, w = img.shape[:2]
    nw, nh = max(1, int(round(w * f))), max(1, int(round(h * f)))
    if (nw, nh) == (w, h):
        return img.astype(np.float32)
    if img.ndim == 2:
        return np.asarray(Image.fromarray(img.astype(np.float32), "F").resize((nw, nh), Image.Resampling.LANCZOS), np.float32)
    return np.dstack([resize_gray(img[..., c], f) for c in range(img.shape[2])])


def warp_prem(prem: np.ndarray, A: np.ndarray, box: tuple[int, int, int, int]) -> np.ndarray:
    """Render a premultiplied RGBA image through A (src continuous -> dst continuous) into the dst
    pixel window box=(x0, y0, w, h). Downscales are pre-filtered with Lanczos (never plain bilinear
    decimation); the residual near-unit transform is cubic."""
    x0, y0, W, H = box
    h, w = prem.shape[:2]
    s = math.sqrt(abs(np.linalg.det(A[:2, :2])))
    src, Aeff = prem, A
    if s < 0.95:
        nw, nh = max(1, int(round(w * s))), max(1, int(round(h * s)))
        src = resize_prem(prem, (nw, nh))
        Aeff = A @ scale_m(w / nw, h / nh)
    # index-space matrix: dst_idx = Aeff(src_idx + .5) - .5 - (x0, y0)
    Aidx = trans_m(-0.5 - x0, -0.5 - y0) @ Aeff @ trans_m(0.5, 0.5)
    if HAVE_CV2:
        out = cv2.warpAffine(src.astype(np.float32), Aidx[:2].astype(np.float64), (W, H), flags=cv2.INTER_CUBIC,
                             borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0, 0))
        if out.ndim == 2:
            out = out[..., None]
    else:
        Ainv = np.linalg.inv(Aidx)
        # scipy works in (row, col): src_rc = M @ dst_rc + off
        M = np.array([[Ainv[1, 1], Ainv[1, 0]], [Ainv[0, 1], Ainv[0, 0]]])
        off = np.array([Ainv[1, 2], Ainv[0, 2]])
        out = np.dstack([ndi.affine_transform(src[..., c], M, off, output_shape=(H, W), order=3, mode="constant",
                                              cval=0.0, prefilter=True) for c in range(src.shape[2])])
    out = np.clip(out, 0, 1).astype(np.float32)
    if out.shape[2] == 4:
        out[..., :3] = np.minimum(out[..., :3], out[..., 3:4])
    return out


def luminance(rgb: np.ndarray) -> np.ndarray:
    return (rgb[..., 0] * 0.299 + rgb[..., 1] * 0.587 + rgb[..., 2] * 0.114).astype(np.float32)


def disk(r: int) -> np.ndarray:
    y, x = np.ogrid[-r:r + 1, -r:r + 1]
    return x * x + y * y <= r * r


# ----------------------------------------------------------------------------- matte + components


def load_rgba(path) -> tuple[np.ndarray, np.ndarray | None]:
    im = Image.open(path)
    if im.mode in ("RGBA", "LA", "PA") or (im.mode == "P" and "transparency" in im.info):
        arr = np.asarray(im.convert("RGBA"), np.float32) / 255.0
        a = arr[..., 3]
        if a.min() < 0.98:
            return arr[..., :3], a
        return arr[..., :3], None
    return np.asarray(im.convert("RGB"), np.float32) / 255.0, None


def matte_image(path, key: str = "auto", expect_key: str | None = None, cache_dir: Path | None = None) -> dict:
    """RGB-on-key -> straight RGBA with the tools/matte closed-outline key matte and the keyUniform gate
    (measured key). An image that already carries transparency is taken as is (key 'alpha')."""
    path = Path(path)
    rgb, a = load_rgba(path)
    if a is not None and key in ("auto", "alpha"):
        return {"rgb": rgb, "alpha": a, "key": {"mode": "alpha"}, "sha256": sha256_file(path)}
    if key == "alpha":
        raise SplitError(f"{path}: key 'alpha' but the image has no transparency")
    digest = sha256_file(path)
    tag = hashlib.sha256(f"{digest}|{key}|{expect_key}|{ml.KEY_UNIFORM}".encode()).hexdigest()[:16]
    if cache_dir is not None:
        cp = Path(cache_dir) / f"matte_{tag}.png"
        cj = cp.with_suffix(".json")
        if cp.exists() and cj.exists():
            arr = np.asarray(Image.open(cp).convert("RGBA"), np.float32) / 255.0
            return {"rgb": arr[..., :3], "alpha": arr[..., 3], "key": json.loads(cj.read_text()), "sha256": digest}
    req = ml.parse_hex(expect_key) if expect_key else None
    rep = ml.measure_key(rgb, requested=req)
    if key == "auto":
        rep["mode"] = "measured"
        if not rep["passed"]:
            raise ml.KeyNotUniform(rep)
        k = np.asarray(rep["keyRgb"], np.float32)
        hole = ml.adaptive_hole_dist(k, rep)
    else:
        k = ml.parse_hex(key)
        rep.update({"mode": "forced", "forced": ml.to_hex(k), "passed": True, "skipped": True})
        hole = 90 / 255
    res = ml.matte(rgb, ml.MatteParams(key=k, hole_dist=hole))
    rep["matte"] = {kk: res.info[kk] for kk in ("key", "seal", "holeDist", "keyLikeFgFraction")}
    # non-key pixels the background claimed at the chosen seal: an OPEN outline (wider than the seal)
    # lets the fill leak out, and the piece loses its interior. Surface it, never silently.
    leak = int(res.info["leakBySeal"][res.seal])
    rep["matte"]["leakPx"] = leak
    rep["matte"]["leakWarning"] = leak > max(64, int(5e-4 * rgb.shape[0] * rgb.shape[1]))
    rep["halo"] = ml.halo_report(res.rgb, res.alpha, k)
    if cache_dir is not None:
        Path(cache_dir).mkdir(parents=True, exist_ok=True)
        ml.save_rgba(Path(cache_dir) / f"matte_{tag}.png", res.rgb, res.alpha)
        (Path(cache_dir) / f"matte_{tag}.json").write_text(json.dumps(rep, indent=1) + "\n")
    return {"rgb": res.rgb, "alpha": res.alpha, "key": rep, "sha256": digest}


def find_components(alpha: np.ndarray, min_area: int | None = None, thr: float = 0.5) -> tuple[list[dict], np.ndarray]:
    """Connected components of the matte (8-connected, alpha > thr), numbered 1..N in reading order
    (rows top to bottom, left to right). Components smaller than min_area are 'noise' (id n1, n2, ...)."""
    H, W = alpha.shape
    m = alpha > thr
    lab, n = ndi.label(m, structure=np.ones((3, 3), bool))
    if n == 0:
        return [], lab
    idx = np.arange(1, n + 1)
    areas = ndi.sum(m, lab, idx)
    cents = ndi.center_of_mass(m, lab, idx)
    min_area = int(min_area if min_area is not None else max(48, 2e-5 * H * W))
    comps = []
    for i, sl in enumerate(ndi.find_objects(lab)):
        y0, y1, x0, x1 = sl[0].start, sl[0].stop, sl[1].start, sl[1].stop
        comps.append({"label": i + 1, "bbox": [x0, y0, x1 - x0, y1 - y0], "area": int(areas[i]),
                      "centroid": [round(cents[i][1] + 0.5, 1), round(cents[i][0] + 0.5, 1)],
                      "noise": bool(areas[i] < min_area)})
    # rows: a component joins the current row when its vertical span overlaps the row's span by at least
    # half of the smaller height (top-aligned and centre-aligned layouts both read as one row)
    keep = sorted((c for c in comps if not c["noise"]), key=lambda c: (c["bbox"][1], c["bbox"][0]))
    rows: list[list[dict]] = []
    span = None
    for c in keep:
        y0, y1 = c["bbox"][1], c["bbox"][1] + c["bbox"][3]
        if rows:
            ov = min(y1, span[1]) - max(y0, span[0])
            if ov >= 0.5 * min(y1 - y0, span[1] - span[0]):
                rows[-1].append(c)
                span = (min(span[0], y0), max(span[1], y1))
                continue
        rows.append([c])
        span = (y0, y1)
    ordered = [c for r in rows for c in sorted(r, key=lambda q: q["bbox"][0])]
    for i, c in enumerate(ordered):
        c["id"] = str(i + 1)
    for i, c in enumerate(c for c in comps if c["noise"]):
        c["id"] = f"n{i + 1}"
    out = ordered + [c for c in comps if c["noise"]]
    # nearest-neighbour gap (px) between pieces: the prompts ask for wide gaps; < 6 px risks cross-talk
    if len(ordered) > 1:
        for c in ordered:
            x0, y0, w, h = c["bbox"]
            pad = 64
            sl = (slice(max(0, y0 - pad), min(H, y0 + h + pad)), slice(max(0, x0 - pad), min(W, x0 + w + pad)))
            own = lab[sl] == c["label"]
            ring = ndi.binary_dilation(own, iterations=1) & ~own
            others = (lab[sl] > 0) & ~own
            if others.any():
                d_other = ndi.distance_transform_edt(~others)
                c["gapPx"] = round(float(d_other[ring].min()), 1) if ring.any() else None
            else:
                c["gapPx"] = None
    return out, lab


def extract(rgb: np.ndarray, alpha: np.ndarray, lab: np.ndarray, labels: list[int], pad: int = 6) -> tuple[np.ndarray, np.ndarray, tuple[int, int]]:
    """Crop the pieces with these component labels (plus their 2 px soft edge) -> straight rgb, alpha,
    and the crop origin in sheet px."""
    m = np.isin(lab, labels)
    ys, xs = np.nonzero(m)
    H, W = alpha.shape
    x0, x1 = max(0, xs.min() - pad), min(W, xs.max() + 1 + pad)
    y0, y1 = max(0, ys.min() - pad), min(H, ys.max() + 1 + pad)
    mm = ndi.binary_dilation(m[y0:y1, x0:x1], iterations=2) & (alpha[y0:y1, x0:x1] > 0)
    others = (lab[y0:y1, x0:x1] > 0) & ~np.isin(lab[y0:y1, x0:x1], labels)
    mm &= ~others
    return rgb[y0:y1, x0:x1].copy(), (alpha[y0:y1, x0:x1] * mm).astype(np.float32), (int(x0), int(y0))


# ----------------------------------------------------------------------------- masked NCC (FFT)


def _corr(a: np.ndarray, k: np.ndarray) -> np.ndarray:
    return fftconvolve(a, k[::-1, ::-1], mode="valid")


def masked_ncc(I: np.ndarray, V: np.ndarray, T: np.ndarray, M: np.ndarray, min_cover: float = 0.25):
    """Normalised cross-correlation of template T (mask M) over image I, counting only image pixels with
    visibility V (pixels already explained by a piece in front are 0). 'valid' positions: result[y, x]
    = the score with T's top-left at (x, y). Returns (ncc, cover) with cover = visible fraction of M."""
    if I.ndim == 2:
        I, T = I[..., None], T[..., None]
    I = I.astype(np.float64)
    T = T.astype(np.float64)
    V = V.astype(np.float64)
    M = M.astype(np.float64)
    tot = float(M.sum()) or 1.0
    n = _corr(V, M)
    nn = np.maximum(n, 1e-6)
    num = np.zeros_like(n)
    dI = np.zeros_like(n)
    dT = np.zeros_like(n)
    for c in range(I.shape[2]):
        Ic = I[..., c] * V
        Tc = T[..., c] * M
        SI = _corr(Ic, M)
        SII = _corr(Ic * I[..., c], M)
        ST = _corr(V, Tc)
        STT = _corr(V, Tc * T[..., c])
        SIT = _corr(Ic, Tc)
        num += SIT - SI * ST / nn
        dI += SII - SI * SI / nn
        dT += STT - ST * ST / nn
    floor = 1e-4 * nn
    ncc = num / np.sqrt(np.maximum(dI, floor) * np.maximum(dT, floor))
    cover = n / tot
    ncc[cover < min_cover] = -1.0
    return ncc, cover


def _peak(ncc: np.ndarray) -> tuple[float, float, float]:
    """Best score and its sub-pixel (x, y) by a parabola through the neighbours."""
    iy, ix = np.unravel_index(int(np.argmax(ncc)), ncc.shape)
    v = float(ncc[iy, ix])
    dx = dy = 0.0
    if 0 < ix < ncc.shape[1] - 1:
        l, r = ncc[iy, ix - 1], ncc[iy, ix + 1]
        den = l - 2 * v + r
        if den < 0:
            dx = float(np.clip(0.5 * (l - r) / den, -0.5, 0.5))
    if 0 < iy < ncc.shape[0] - 1:
        u, d = ncc[iy - 1, ix], ncc[iy + 1, ix]
        den = u - 2 * v + d
        if den < 0:
            dy = float(np.clip(0.5 * (u - d) / den, -0.5, 0.5))
    return v, ix + dx, iy + dy


# ----------------------------------------------------------------------------- pieces + registration


@dataclass
class Piece:
    pid: str                      # 'slot' or 'slot/attachment' (character), part name (symbol)
    slot: str
    att: str | None
    sheet: str
    comps: list[str]
    spec: dict
    rgb: np.ndarray               # sheet crop, straight
    alpha: np.ndarray
    origin: tuple[int, int]       # crop origin in sheet px
    z: float | None = None
    setup: bool = True
    hidden: bool = False
    A: np.ndarray | None = None   # crop continuous -> master continuous
    reg: dict = field(default_factory=dict)
    # canvas placement
    C: np.ndarray | None = None   # crop continuous -> canvas continuous
    img: np.ndarray | None = None  # premultiplied RGBA in canvas px window `box`
    box: tuple[int, int, int, int] | None = None
    joint: list | None = None
    tip: list | None = None
    info: dict = field(default_factory=dict)

    @property
    def prem(self) -> np.ndarray:
        return premultiply(self.rgb, self.alpha)

    def content_box(self) -> tuple[float, float, float, float]:
        ys, xs = np.nonzero(self.alpha > 0.5)
        return float(xs.min()), float(ys.min()), float(xs.max() + 1), float(ys.max() + 1)


class Master:
    """The approved rig master (matted) with the pyramid levels the registration uses."""

    def __init__(self, rgb: np.ndarray, alpha: np.ndarray, coarse: int = 512, fine: int = 1600):
        self.rgb, self.alpha = rgb, alpha
        self.H, self.W = alpha.shape
        self.prem = premultiply(rgb, alpha)
        self.fc = min(1.0, coarse / max(self.H, self.W))
        self.fr = min(1.0, fine / max(self.H, self.W))
        self.coarse = resize_gray(self.prem, self.fc)
        self.fine = resize_gray(self.prem, self.fr)
        # claims at the fine level: a registered piece claims the master pixels where it is visible AND
        # matches the master's colour (so pieces can register in any order). For a new piece at z:
        #   V = unclaimed pixels (must match it where it covers them);
        #   pixels claimed by a piece IN FRONT: don't care (it may extend under them);
        #   pixels claimed by a piece BEHIND: conflict (it would hide what is visibly there).
        self.claim = np.full((self.fine.shape[0], self.fine.shape[1]), -np.inf, np.float32)
        self.V = np.ones_like(self.claim)
        self.K = np.zeros_like(self.claim)
        self.z = None

    def use_z(self, z: float | None) -> None:
        z = z if z is not None else 0
        self.z = z
        claimed = np.isfinite(self.claim)
        self.V = (~claimed).astype(np.float32)
        self.K = (claimed & (self.claim < z)).astype(np.float32)

    def K_at(self, f: float) -> np.ndarray:
        if abs(f - self.fr) < 1e-9:
            return self.K
        return np.clip(resize_gray(self.K, f / self.fr), 0, 1)

    def V_at(self, f: float) -> np.ndarray:
        if abs(f - self.fr) < 1e-9:
            return self.V
        return np.clip(resize_gray(self.V, f / self.fr), 0, 1)

    def level(self, f: float) -> np.ndarray:
        if abs(f - self.fc) < 1e-9:
            return self.coarse
        if abs(f - self.fr) < 1e-9:
            return self.fine
        return resize_gray(self.prem, f)

    def explain(self, piece: Piece, tol: float = 0.12) -> None:
        """Claim the unclaimed master pixels this piece covers and matches (colour within tol)."""
        A = scale_m(self.fr) @ piece.A
        h, w = self.claim.shape
        wp = warp_prem(piece.prem, A, (0, 0, w, h))
        a = wp[..., 3] > 0.5
        rgb = np.where(a[..., None], wp[..., :3] / np.maximum(wp[..., 3:4], 1e-4), 0)
        mrgb = np.where(self.fine[..., 3:4] > 1e-4, self.fine[..., :3] / np.maximum(self.fine[..., 3:4], 1e-4), 0)
        ok = a & (self.fine[..., 3] > 0.5) & (np.abs(rgb - mrgb).max(-1) < tol)
        ok = ndi.binary_erosion(ok, iterations=1) | (ok & (self.fine[..., 3] > 0.5) & (np.abs(rgb - mrgb).max(-1) < tol / 2))
        free = ~np.isfinite(self.claim)
        self.claim[ok & free] = piece.z if piece.z is not None else 0

    def master_box(self, piece: Piece) -> tuple[float, float, float, float]:
        x0, y0, x1, y1 = piece.content_box()
        q = apply(piece.A, [[x0, y0], [x1, y0], [x0, y1], [x1, y1]])
        return float(q[:, 0].min()), float(q[:, 1].min()), float(q[:, 0].max()), float(q[:, 1].max())


def _template(piece: Piece, s: float, gray: bool = False) -> tuple[np.ndarray, np.ndarray, tuple[float, float]]:
    prem = piece.prem
    h, w = prem.shape[:2]
    nw, nh = max(2, int(round(w * s))), max(2, int(round(h * s)))
    t = resize_prem(prem, (nw, nh))
    M = (t[..., 3] > 0.5)
    if min(nw, nh) > 24:
        M = ndi.binary_erosion(M, iterations=1)
    T = luminance(t[..., :3]) if gray else t[..., :3]
    return T, M.astype(np.float32), (nw / w, nh / h)


def _explained(master_level: np.ndarray, pieces: list[Piece], s: float, f: float, blur: float = 1.0) -> float:
    """Master area (px) the pieces explain at sheet scale s: for each piece, the best blurred colour NCC
    over positions where it lies inside the master silhouette (every piece does, hidden parts included:
    they sit behind something opaque), weighted ncc^2 x its area."""
    img = ndi.gaussian_filter(master_level[..., :3], (blur, blur, 0))
    ma = (master_level[..., 3] > 0.5).astype(np.float64)
    ones = np.ones(img.shape[:2], np.float32)
    tot = 0.0
    for p in pieces:
        T, M, _ = _template(p, s * f)
        if T.shape[0] >= img.shape[0] or T.shape[1] >= img.shape[1] or min(T.shape[:2]) < 4 or M.sum() < 8:
            continue
        T = ndi.gaussian_filter(T, (blur, blur, 0))
        ncc, _ = masked_ncc(img, ones, T, M, min_cover=0.9)
        ncc[_corr(ma, M.astype(np.float64)) / max(1.0, float(M.sum())) < 0.97] = -1
        v = float(ncc.max())
        if v > 0:
            tot += v * v * float(M.sum()) / (f * f)
    return tot


def estimate_sheet_scale(master: Master, pieces: list[Piece], lo: float = 0.2, hi: float = 5.0, steps: int = 24) -> dict:
    """Sheet px -> master px scale shared by every piece of one sheet (the prompts ask for 'the same
    scale'), without features: maximise the explained master area (see _explained) over a log grid at
    <= 256 px, then over +-10% at <= 384 px. Plain best-NCC would favour tiny templates (they correlate
    anywhere) and occluded pieces (torso under the tank top) would pull it off."""
    cands = sorted((p for p in pieces if p.setup and not p.hidden and p.spec.get("place") in (None, "auto")),
                   key=lambda p: -float((p.alpha > 0.5).sum()))[:6]
    if not cands:
        raise SplitError("no visible setup piece to estimate the sheet scale from: give the sheet a 'scale'")
    f1 = min(1.0, 256 / max(master.H, master.W))
    lev1 = resize_gray(master.prem, f1)
    grid = np.exp(np.linspace(math.log(lo), math.log(hi), steps))
    scores = [_explained(lev1, cands, float(g), f1) for g in grid]
    best = float(grid[int(np.argmax(scores))])
    f2 = min(1.0, 384 / max(master.H, master.W))
    lev2 = resize_gray(master.prem, f2)
    fine = best * np.linspace(0.88, 1.12, 13)
    fscores = [_explained(lev2, cands, float(g), f2) for g in fine]
    sc = float(fine[int(np.argmax(fscores))])
    return {"scale": round(sc, 5), "method": "explained-area", "score": round(max(fscores), 1),
            "pieces": [p.pid for p in cands], "grid": [round(float(g), 4) for g in grid],
            "gridScores": [round(v, 1) for v in scores]}


def _ecc(template: np.ndarray, tmask: np.ndarray, inp: np.ndarray, imask: np.ndarray, W0: np.ndarray,
         motion: str, gauss: int = 5) -> tuple[np.ndarray | None, float]:
    """cv2 ECC: find W (template coords -> input coords) with inp(W x) ~ template(x)."""
    if not HAVE_CV2:
        return None, 0.0
    mt = {"affine": cv2.MOTION_AFFINE, "similarity": cv2.MOTION_AFFINE, "euclidean": cv2.MOTION_EUCLIDEAN,
          "translation": cv2.MOTION_TRANSLATION}[motion]
    crit = (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 200, 1e-6)
    W = W0[:2].astype(np.float32).copy()
    try:
        if hasattr(cv2, "findTransformECCWithMask"):
            cc, W = cv2.findTransformECCWithMask(template.astype(np.float32), inp.astype(np.float32),
                                                 (tmask > 0).astype(np.uint8), (imask > 0).astype(np.uint8),
                                                 W, mt, crit, gauss)
        else:
            cc, W = cv2.findTransformECC(template.astype(np.float32), inp.astype(np.float32), W, mt, crit,
                                         (imask > 0).astype(np.uint8), gauss)
    except cv2.error:
        return None, 0.0
    out = np.eye(3)
    out[:2] = W
    return out, float(cc)


def _nearest_similarity(A: np.ndarray) -> np.ndarray:
    L = A[:2, :2]
    U, S, Vt = np.linalg.svd(L)
    R = U @ Vt
    if np.linalg.det(R) < 0:
        return A
    out = A.copy()
    out[:2, :2] = R * float(np.mean(S))
    return out


class Features:
    """SIFT keypoints of the master (fine level) for feature registration (OpenCV). SIFT's patent
    expired in 2020; it is in opencv-python-headless (licence python-geometry: Apache-2.0)."""

    def __init__(self, master: Master):
        self.master = master
        self.sift = cv2.SIFT_create()
        g = to_u8(luminance(master.fine[..., :3]))
        kps, desc = self.sift.detectAndCompute(g, (master.fine[..., 3] > 0.5).astype(np.uint8))
        self.pts = np.array([k.pt for k in kps], np.float32).reshape(-1, 2)
        self.desc = desc
        self.matcher = cv2.BFMatcher(cv2.NORM_L2)

    def piece_features(self, piece: Piece):
        g = to_u8(luminance(piece.prem[..., :3]))
        kps, desc = self.sift.detectAndCompute(g, (piece.alpha > 0.5).astype(np.uint8))
        return np.array([k.pt for k in kps], np.float32).reshape(-1, 2), desc

    def match(self, piece: Piece, use_visibility: bool = True, scale: float | None = None,
              tol: float = 0.15) -> dict | None:
        """Similarity (crop continuous -> master continuous) from ratio-tested SIFT matches + RANSAC.
        Master keypoints already explained by a piece in front are ignored (use_visibility)."""
        if self.desc is None or len(self.pts) < 8:
            return None
        pp, pd = self.piece_features(piece)
        if pd is None or len(pp) < 6:
            return None
        keep = np.ones(len(self.pts), bool)
        if use_visibility:
            ix = np.clip(self.pts[:, 0].astype(int), 0, self.master.V.shape[1] - 1)
            iy = np.clip(self.pts[:, 1].astype(int), 0, self.master.V.shape[0] - 1)
            keep = self.master.V[iy, ix] > 0.5
        if keep.sum() < 8:
            return None
        md, mp = self.desc[keep], self.pts[keep]
        pairs = self.matcher.knnMatch(pd, md, k=2)
        good = [m[0] for m in pairs if len(m) == 2 and m[0].distance < 0.8 * m[1].distance]
        if len(good) < 6:
            return None
        src = np.float32([pp[m.queryIdx] for m in good])
        dst = np.float32([mp[m.trainIdx] for m in good])
        M, inl = cv2.estimateAffinePartial2D(src, dst, method=cv2.RANSAC, ransacReprojThreshold=3.0,
                                             maxIters=4000, confidence=0.999)
        if M is None:
            return None
        n_in = int(inl.sum())
        A = np.eye(3)
        A[:2] = M
        fr = self.master.fr
        # keypoints are pixel-centre (index) coordinates: continuous = index + 0.5 on both sides
        A = scale_m(1 / fr) @ trans_m(0.5, 0.5) @ A @ trans_m(-0.5, -0.5)
        d = decompose(A)
        ok = n_in >= 8 and n_in >= 0.2 * len(good)
        if scale is not None and abs(d["scale"] / scale - 1) > tol:
            ok = False
        return {"A": A, "inliers": n_in, "matches": len(good), "scale": d["scale"], "rotation": d["rotation"], "ok": ok}


def sheet_scale_from_features(feats: "Features", pieces: list[Piece]) -> dict | None:
    """Sheet scale = inlier-weighted median of the per-piece SIFT similarity scales (setup pieces)."""
    rows = []
    for p in pieces:
        if not p.setup or p.hidden or p.spec.get("place") not in (None, "auto"):
            continue
        m = feats.match(p, use_visibility=False)
        if m and m["ok"]:
            rows.append((m["scale"], m["inliers"], p.pid))
    if not rows:
        return None
    rows.sort()
    w = np.array([r[1] for r in rows], float)
    cum = np.cumsum(w) / w.sum()
    med = rows[int(np.searchsorted(cum, 0.5))][0]
    agree = [r for r in rows if abs(r[0] / med - 1) < 0.08]
    return {"scale": round(float(np.average([r[0] for r in agree], weights=[r[1] for r in agree])), 5),
            "method": "sift", "pieces": [r[2] for r in agree], "all": [[r[2], round(r[0], 4), r[1]] for r in rows]}


def _coarse_candidates(master: Master, piece: Piece, s: float, near, min_cover: float, k: int = 3):
    """Masked NCC at a coarse level: up to k distinct peaks within 90% of the best (twins, repeats)."""
    h, w = piece.alpha.shape
    f = max(master.fc, min(1.0, 12.0 / (s * max(1, min(h, w)))))
    img = master.level(f)[..., :3]
    ma = master.level(f)[..., 3]
    V = master.V_at(f)
    K = master.K_at(f)
    T, M, (fx, fy) = _template(piece, s * f)
    oy = ox = 0
    if near is not None:
        cx, cy, r = near[0] * f, near[1] * f, near[2] * f
        th, tw = T.shape[:2]
        x0 = int(max(0, cx - r - tw)); x1 = int(min(img.shape[1], cx + r + tw))
        y0 = int(max(0, cy - r - th)); y1 = int(min(img.shape[0], cy + r + th))
        img, V, K, ma, ox, oy = img[y0:y1, x0:x1], V[y0:y1, x0:x1], K[y0:y1, x0:x1], ma[y0:y1, x0:x1], x0, y0
    if T.shape[0] > img.shape[0] or T.shape[1] > img.shape[1]:
        raise SplitError(f"{piece.pid}: at scale {s:.3f} the piece is larger than the master search area")
    if min(T.shape[:2]) >= 12:
        img = ndi.gaussian_filter(img, (1.0, 1.0, 0))
        T = ndi.gaussian_filter(T, (1.0, 1.0, 0))
    ncc, cover = masked_ncc(img, V, T, M, min_cover=min_cover)
    # the piece lies inside the master silhouette wherever it is (hidden parts sit behind opaque ones)
    ncc[_corr((ma > 0.5).astype(np.float64), M.astype(np.float64)) / max(1.0, float(M.sum())) < 0.9] = -1
    if K.any():
        # covering what a registered piece BEHIND visibly explains is a contradiction
        conflict = _corr(K.astype(np.float64), M.astype(np.float64)) / max(1.0, float(M.sum()))
        ncc = np.where(ncc > -1, ncc - 1.5 * conflict, ncc)
    out, work = [], ncc.copy()
    ry, rx = max(2, T.shape[0] // 2), max(2, T.shape[1] // 2)
    best = None
    for _ in range(k):
        score, px, py = _peak(work)
        if score <= -0.99 or (best is not None and score < 0.9 * best):
            break
        best = score if best is None else best
        out.append((score, trans_m((px + ox) / f, (py + oy) / f) @ scale_m(fx / f, fy / f)))
        iy, ix = int(round(py)), int(round(px))
        work[max(0, iy - ry):iy + ry + 1, max(0, ix - rx):ix + rx + 1] = -1
    second = float(work.max()) if work.size else -1.0
    return out, f, second


def register(master: Master, piece: Piece, s: float, near: tuple[float, float, float] | None = None,
             motion: str = "affine", init: np.ndarray | None = None, min_cover: float = 0.25) -> dict:
    """Place `piece` on the master. Initial pose: `init` (crop -> master, e.g. the SIFT similarity), else
    masked NCC (visible master pixels only, inside the silhouette) at a coarse level at sheet scale s
    (near = (x, y, radius) in master px restricts the search); near-equal peaks (twins) are all refined
    and the best final fit wins. Refinement: ECC (cv2, affine) at the fine level from that pose, or a fine
    NCC translation search. Sets piece.A (crop continuous -> master continuous); returns a report."""
    rep: dict = {}
    if init is None:
        cands, f, second = _coarse_candidates(master, piece, s, near, min_cover)
        if not cands:
            rep.update({"init": "ncc", "ok": False, "ncc": -1.0, "visibleFrac": 0.0,
                        "why": "no position with enough visible master pixels inside the silhouette (hidden piece)"})
            return rep
        rep.update({"init": "ncc", "coarseLevel": round(f, 4), "coarseNcc": round(cands[0][0], 4),
                    "coarsePeaks": len(cands)})
        results = []
        for sc, A0 in cands:
            r = _refine(master, piece, A0, motion)
            # rank by shape (NCC) and colour (a darker far-side twin correlates as well as the near one)
            results.append((r.get("ncc", -1.0) - 2.0 * r.get("mad", 0.0) - 1.5 * r.get("conflict", 0.0), sc, r, piece.A))
        results.sort(key=lambda t: -t[0])
        best = results[0]
        piece.A = best[3]
        rep.update(best[2])
        # ambiguity: the runner-up's final fit (or the best coarse score elsewhere) relative to the winner
        alt = results[1][0] if len(results) > 1 else second
        rep["ambiguity"] = round(max(alt, second * best[0] / max(best[1], 1e-6)) / best[0], 3) if best[0] > 0 else 1.0
        if len(results) > 1:
            rep["alternatives"] = [{"ncc": r[2].get("ncc"), "mad": r[2].get("mad"),
                                    "at": [round(v, 1) for v in apply(r[3], [[0, 0]])[0]]} for r in results[1:]]
        rep["ok"] = rep["ncc"] >= GATE_NCC
        return rep
    rep["init"] = "features"
    rep.update(_refine(master, piece, init, motion))
    rep["ambiguity"] = 0.0
    rep["ok"] = rep["ncc"] >= GATE_NCC
    return rep


def _idx_to_cont(W: np.ndarray) -> np.ndarray:
    return trans_m(0.5, 0.5) @ W @ trans_m(-0.5, -0.5)


def _cont_to_idx(W: np.ndarray) -> np.ndarray:
    return trans_m(-0.5, -0.5) @ W @ trans_m(0.5, 0.5)


def _ecc_pyramid(template, tmask, inp, imask, W0, motion):
    """ECC in two steps: Euclidean on a half-resolution, more blurred level (wide basin), then `motion`
    at full resolution from there. W maps template index coords -> input index coords."""
    h = 0.5
    W1 = None
    if min(inp.shape[:2]) >= 40:
        t2, i2 = resize_gray(template, h), resize_gray(inp, h)
        tm2 = resize_gray(tmask.astype(np.float32), h) > 0.5
        im2 = resize_gray(imask.astype(np.float32), h) > 0.5
        Wh = _cont_to_idx(scale_m(h) @ _idx_to_cont(W0) @ scale_m(1 / h))
        Wr, _ = _ecc(t2, tm2, i2, im2, Wh, "euclidean", gauss=7)
        if Wr is not None:
            W1 = _cont_to_idx(scale_m(1 / h) @ _idx_to_cont(Wr) @ scale_m(h))
    W2, cc = _ecc(template, tmask, inp, imask, W1 if W1 is not None else W0, motion, gauss=5)
    if W2 is None and W1 is not None:
        W2, cc = _ecc(template, tmask, inp, imask, W0, motion, gauss=5)
    return W2, cc


def _render_template(piece: Piece, L: np.ndarray, rot: float = 0.0):
    """Piece rendered through the linear map L (then rotated by rot degrees about its centre) into a
    tight box. Returns (R: crop -> template coords, premultiplied template)."""
    h, w = piece.alpha.shape
    Lr = rot_m(rot) @ L if rot else L
    pts = apply(Lr, [[0, 0], [w, 0], [0, h], [w, h]])
    R = trans_m(2 - pts[:, 0].min(), 2 - pts[:, 1].min()) @ Lr
    tw = int(math.ceil(pts[:, 0].max() - pts[:, 0].min())) + 4
    th = int(math.ceil(pts[:, 1].max() - pts[:, 1].min())) + 4
    return R, warp_prem(piece.prem, R, (0, 0, tw, th))


def _refine(master: Master, piece: Piece, A0: np.ndarray, motion: str, max_rot: float = 6.0) -> dict:
    rep: dict = {}
    fr = master.fr
    L = scale_m(fr) @ A0
    L[:2, 2] = 0
    R, Tp = _render_template(piece, L)
    th, tw = Tp.shape[:2]
    Tf, Mf = Tp[..., :3], (Tp[..., 3] > 0.5)
    posT = apply(scale_m(fr) @ A0 @ np.linalg.inv(R), [[0, 0]])[0]      # template top-left, fine master px
    margin = int(round(0.15 * max(th, tw))) + 8
    X0 = int(max(0, math.floor(posT[0]) - margin)); Y0 = int(max(0, math.floor(posT[1]) - margin))
    X1 = int(min(master.fine.shape[1], math.ceil(posT[0]) + tw + margin))
    Y1 = int(min(master.fine.shape[0], math.ceil(posT[1]) + th + margin))
    if X1 - X0 < max(4, tw // 2) or Y1 - Y0 < max(4, th // 2):
        piece.A = A0
        return {"ncc": -1.0, "visibleFrac": 0.0, "method": "none", "why": "initial pose outside the master"}
    crop = master.fine[Y0:Y1, X0:X1]
    Vc = master.V[Y0:Y1, X0:X1]
    tmask = (Vc > 0.5) & (crop[..., 3] > 0.5)
    Wfine, method = None, "ncc"
    if HAVE_CV2 and min(th, tw) >= 16 and tmask.sum() >= 64:
        W0 = trans_m(-(posT[0] - X0), -(posT[1] - Y0))                  # crop -> template (translation)
        im = ndi.binary_erosion(Mf, iterations=2) if min(th, tw) > 40 else Mf
        mo = "affine" if motion in ("affine", "similarity") else motion
        W, cc = _ecc_pyramid(luminance(crop[..., :3]), tmask, luminance(Tf), im, W0, mo)
        if W is not None:
            Ainv = np.linalg.inv(_idx_to_cont(W))                        # template -> crop
            d, d0 = decompose(Ainv), decompose(np.linalg.inv(W0))
            if (abs(d["scale"] - 1) < 0.15 and abs(d["rotation"]) < 15 and d["anisotropy"] < 1.12 and
                    abs(d["tx"] - d0["tx"]) < 0.25 * tw + 4 and abs(d["ty"] - d0["ty"]) < 0.25 * th + 4):
                Wfine, method = Ainv, f"ecc-{mo}"
                rep["ecc"] = round(cc, 4)
    if Wfine is None:
        # rotation-aware NCC (also the no-OpenCV path): angles on a small level, translation at full res
        g = min(1.0, 160.0 / max(th, tw))
        cs = resize_gray(crop, g)
        Vs = resize_gray(Vc, g)
        best = None
        steps = max(1, int(round(max_rot / 1.5)))
        for k in range(-steps, steps + 1):
            ang = 1.5 * k
            Rk, Tk = _render_template(piece, scale_m(g) @ L, ang)
            if Tk.shape[0] >= cs.shape[0] or Tk.shape[1] >= cs.shape[1]:
                continue
            ncc_k, _ = masked_ncc(cs[..., :3], Vs, Tk[..., :3], (Tk[..., 3] > 0.5).astype(np.float32), min_cover=0.05)
            sc = float(ncc_k.max())
            if best is None or sc > best[0]:
                best = (sc, ang)
        ang = best[1] if best else 0.0
        R, Tp = _render_template(piece, L, ang)
        ncc2, _ = masked_ncc(crop[..., :3], Vc, Tp[..., :3], (Tp[..., 3] > 0.5).astype(np.float32), min_cover=0.05)
        sc2, qx, qy = _peak(ncc2)
        Wfine, method = trans_m(qx, qy), "ncc-fine"
        rep.update({"fineNcc": round(sc2, 4), "fineRotation": ang})
    if motion == "similarity":
        Wfine = _nearest_similarity(Wfine)
    elif motion == "translation":
        Wfine = trans_m(Wfine[0, 2], Wfine[1, 2])
    piece.A = scale_m(1 / fr) @ trans_m(X0, Y0) @ Wfine @ R
    rep.update(confidence(master, piece))
    rep.update({"method": method, "transform": decompose(piece.A)})
    return rep


def confidence(master: Master, piece: Piece) -> dict:
    fr = master.fr
    A = scale_m(fr) @ piece.A
    x0, y0, x1, y1 = piece.content_box()
    box_pts = apply(A, [[0, 0], [piece.alpha.shape[1], 0], [0, piece.alpha.shape[0]],
                        [piece.alpha.shape[1], piece.alpha.shape[0]]])
    X0 = int(max(0, math.floor(box_pts[:, 0].min()))); Y0 = int(max(0, math.floor(box_pts[:, 1].min())))
    X1 = int(min(master.fine.shape[1], math.ceil(box_pts[:, 0].max()))); Y1 = int(min(master.fine.shape[0], math.ceil(box_pts[:, 1].max())))
    if X1 <= X0 or Y1 <= Y0:
        return {"ncc": -1.0, "visibleFrac": 0.0, "insideMaster": 0.0}
    w = warp_prem(piece.prem, A, (X0, Y0, X1 - X0, Y1 - Y0))
    pm = w[..., 3] > 0.5
    vis = pm & (master.V[Y0:Y1, X0:X1] > 0.5)
    conflict = float(np.count_nonzero(pm & (master.K[Y0:Y1, X0:X1] > 0.5)) / max(1, np.count_nonzero(pm)))
    inside = float(np.count_nonzero(pm & (master.fine[Y0:Y1, X0:X1, 3] > 0.5)) / max(1, np.count_nonzero(pm)))
    vf = float(np.count_nonzero(vis) / max(1, np.count_nonzero(pm)))
    if np.count_nonzero(vis) < 16:
        return {"ncc": -1.0, "visibleFrac": round(vf, 3), "insideMaster": round(inside, 3), "conflict": round(conflict, 3)}
    a = w[..., :3][vis].astype(np.float64)
    b = master.fine[Y0:Y1, X0:X1, :3][vis].astype(np.float64)
    mad = float(np.abs(a - b).mean())            # absolute colour difference (NCC ignores brightness)
    a -= a.mean(0)
    b -= b.mean(0)
    den = math.sqrt(float((a * a).sum()) * float((b * b).sum())) or 1.0
    return {"ncc": round(float((a * b).sum()) / den, 4), "mad": round(mad, 4), "visibleFrac": round(vf, 3),
            "insideMaster": round(inside, 3), "conflict": round(conflict, 3)}


# ----------------------------------------------------------------------------- canvas placement


def place_on_canvas(piece: Piece, M2C: np.ndarray, pad: int = 3) -> None:
    """Render the piece through crop -> master -> canvas, trim to its alpha and pad (2-4 px contract)."""
    C = M2C @ piece.A
    h, w = piece.alpha.shape
    pts = apply(C, [[0, 0], [w, 0], [0, h], [w, h]])
    X0, Y0 = int(math.floor(pts[:, 0].min())) - 2, int(math.floor(pts[:, 1].min())) - 2
    X1, Y1 = int(math.ceil(pts[:, 0].max())) + 2, int(math.ceil(pts[:, 1].max())) + 2
    img = warp_prem(piece.prem, C, (X0, Y0, X1 - X0, Y1 - Y0))
    # resampling rings out a faint 1-2/255 alpha fringe: invisible, but it would widen the region
    # (and the runtime fit / land cell gate measure regions), so it is cut before the trim
    faint = img[..., 3] < 3 / 255
    img[faint] = 0
    a = img[..., 3]
    ys, xs = np.nonzero(a > 0)
    if not len(xs):
        raise SplitError(f"{piece.pid}: empty after placement")
    x0, x1 = xs.min() - pad, xs.max() + 1 + pad
    y0, y1 = ys.min() - pad, ys.max() + 1 + pad
    out = np.zeros((y1 - y0, x1 - x0, 4), np.float32)
    sy0, sx0 = max(0, y0), max(0, x0)
    sy1, sx1 = min(img.shape[0], y1), min(img.shape[1], x1)
    out[sy0 - y0:sy1 - y0, sx0 - x0:sx1 - x0] = img[sy0:sy1, sx0:sx1]
    out[..., 3][out[..., 3] < 1 / 512] = 0
    piece.C = C
    piece.img = out
    piece.box = (int(X0 + x0), int(Y0 + y0), int(x1 - x0), int(y1 - y0))
    piece.info["canvasScale"] = round(math.sqrt(abs(np.linalg.det(C[:2, :2]))), 4)


def canvas_layer(piece: Piece, W: int, H: int) -> np.ndarray:
    """The piece's premultiplied RGBA on a full W x H canvas."""
    out = np.zeros((H, W, 4), np.float32)
    x, y, w, h = piece.box
    sx0, sy0 = max(0, x), max(0, y)
    sx1, sy1 = min(W, x + w), min(H, y + h)
    if sx1 > sx0 and sy1 > sy0:
        out[sy0:sy1, sx0:sx1] = piece.img[sy0 - y:sy1 - y, sx0 - x:sx1 - x]
    return out


def composite(pieces: list[Piece], W: int, H: int) -> np.ndarray:
    """Premultiplied 'over' of the pieces in z order (back to front)."""
    acc = np.zeros((H, W, 4), np.float32)
    for p in sorted(pieces, key=lambda q: (q.z if q.z is not None else 0)):
        L = canvas_layer(p, W, H)
        acc = L + acc * (1 - L[..., 3:4])
    return acc


def master_to_canvas_image(master: Master, M2C: np.ndarray, W: int, H: int) -> np.ndarray:
    return warp_prem(master.prem, M2C, (0, 0, W, H))


# ----------------------------------------------------------------------------- joints


def _boundary(mask: np.ndarray) -> np.ndarray:
    return mask & ~ndi.binary_erosion(mask, iterations=1)


def fit_circle(pts: np.ndarray) -> tuple[np.ndarray, float, float, float] | None:
    """Algebraic (Kasa) circle fit + a few Gauss-Newton steps. Returns centre, r, rms, arc span (deg)."""
    if len(pts) < 12:
        return None
    x, y = pts[:, 0], pts[:, 1]
    A = np.column_stack([x, y, np.ones_like(x)])
    b = x * x + y * y
    try:
        sol, *_ = np.linalg.lstsq(A, b, rcond=None)
    except np.linalg.LinAlgError:
        return None
    cx, cy = sol[0] / 2, sol[1] / 2
    r = math.sqrt(max(sol[2] + cx * cx + cy * cy, 1e-9))
    for _ in range(10):
        dx, dy = x - cx, y - cy
        d = np.sqrt(dx * dx + dy * dy) + 1e-9
        J = np.column_stack([-dx / d, -dy / d, -np.ones_like(d)])
        res = d - r
        step, *_ = np.linalg.lstsq(J, -res, rcond=None)
        cx, cy, r = cx + step[0], cy + step[1], r + step[2]
    d = np.sqrt((x - cx) ** 2 + (y - cy) ** 2)
    rms = float(np.sqrt(np.mean((d - r) ** 2)))
    ang = np.sort(np.arctan2(y - cy, x - cx))
    gaps = np.diff(np.concatenate([ang, ang[:1] + 2 * math.pi]))
    span = math.degrees(2 * math.pi - float(gaps.max()))
    return np.array([cx, cy]), float(abs(r)), rms, span


def _ransac_circle(pts: np.ndarray, rmin: float, rmax: float, inside, iters: int = 600, seed: int = 0):
    """Circle with the most boundary points within tolerance (the cap arc), radius in [rmin, rmax] and
    centre on the child. Deterministic (seeded)."""
    n = len(pts)
    if n < 12:
        return None
    rng = np.random.default_rng(seed)
    best, best_in = None, None
    for _ in range(iters):
        i, j, k = rng.choice(n, 3, replace=False)
        (x1, y1), (x2, y2), (x3, y3) = pts[i], pts[j], pts[k]
        d = 2 * (x1 * (y2 - y3) + x2 * (y3 - y1) + x3 * (y1 - y2))
        if abs(d) < 1e-9:
            continue
        ux = ((x1 * x1 + y1 * y1) * (y2 - y3) + (x2 * x2 + y2 * y2) * (y3 - y1) + (x3 * x3 + y3 * y3) * (y1 - y2)) / d
        uy = ((x1 * x1 + y1 * y1) * (x3 - x2) + (x2 * x2 + y2 * y2) * (x1 - x3) + (x3 * x3 + y3 * y3) * (x2 - x1)) / d
        r = math.hypot(x1 - ux, y1 - uy)
        if not (rmin <= r <= rmax) or not inside(ux, uy):
            continue
        dist = np.abs(np.hypot(pts[:, 0] - ux, pts[:, 1] - uy) - r)
        inl = dist < max(1.0, 0.035 * r)
        if best_in is None or inl.sum() > best_in.sum():
            best, best_in = (ux, uy, r), inl
    if best is None or best_in.sum() < 12:
        return None
    return fit_circle(pts[best_in])


def cap_joint(child_a: np.ndarray, parent_a: np.ndarray) -> dict:
    """PIPELINE 3.1 step 5: joint = centroid of dilate(child) & parent, snapped to the round overlap cap.
    Both alphas are full-canvas arrays. The cap is the circle (RANSAC) through the boundary of one piece
    that lies inside the other: the child's own cap when its end lies inside the parent, else the
    parent's cap inside the child; the better arc wins. Radius bounded by the child's half width."""
    C = child_a > 0.5
    P = parent_a > 0.5
    out = {"method": None}
    ov = None
    for r in (2, 4, 8, 12):
        o = ndi.binary_dilation(C, structure=disk(r)) & P
        if o.any():
            ov = o
            break
    if ov is None:
        return {"method": "none", "why": "the pieces do not touch"}
    ys, xs = np.nonzero(ov)
    cen = np.array([xs.mean() + 0.5, ys.mean() + 0.5])
    out.update({"method": "overlap-centroid", "joint": [round(float(cen[0]), 1), round(float(cen[1]), 1)],
                "overlapPx": int(len(xs))})
    dtc = ndi.distance_transform_edt(C)
    near = ndi.binary_dilation(ov, iterations=24)
    r_ref = float(dtc[near & C].max()) if (near & C).any() else float(dtc.max())
    if r_ref < 2:
        out["capFound"] = False
        return out
    H, W = C.shape

    def on_child(x, y):
        ix, iy = int(x), int(y)
        return 0 <= ix < W and 0 <= iy < H and bool(C[iy, ix])

    Pin = ndi.binary_erosion(P, iterations=2)
    Cin = ndi.binary_erosion(C, iterations=2)
    best = None
    for k, (name, a, inside) in enumerate((("child-cap", C, Pin), ("parent-cap", P, Cin))):
        by, bx = np.nonzero(_boundary(a) & inside & near)
        if len(bx) < 12:
            continue
        pts = np.column_stack([bx + 0.5, by + 0.5]).astype(np.float64)
        fit = _ransac_circle(pts, 0.45 * r_ref, 1.9 * r_ref, on_child, seed=k)
        if fit is None:
            continue
        c, r, rms, span = fit
        ok = span >= 100 and rms <= 0.06 * r + 0.75 and on_child(c[0], c[1])
        q = span / 180.0 - rms / max(r, 1e-6) * 10
        cand = {"method": name, "joint": [round(float(c[0]), 1), round(float(c[1]), 1)], "capRadius": round(r, 1),
                "capRms": round(rms, 2), "capArcDeg": round(span, 1), "ok": bool(ok), "q": q}
        if ok and (best is None or q > best["q"]):
            best = cand
    if best is not None:
        best.pop("q")
        best["overlapCentroid"] = out["joint"]
        best["overlapPx"] = out["overlapPx"]
        return best
    out["capFound"] = False
    return out


def joint_hole_test(child_a: np.ndarray, parent_a: np.ndarray, joint, deg: float = JOINT_TEST_DEG) -> dict:
    """Rotate the child +-deg about the joint: pixels near the joint (within 0.9 x the limb's half width)
    that the union covered at rest and leaves open after the rotation are holes (no overlap cap)."""
    jx, jy = float(joint[0]), float(joint[1])
    H, W = child_a.shape
    y0, y1 = int(max(0, jy - 48)), int(min(H, jy + 48))
    x0, x1 = int(max(0, jx - 48)), int(min(W, jx + 48))
    if y1 <= y0 or x1 <= x0:
        return {"radius": 0.0, "holesPx": None, "why": "joint off the canvas"}
    dt = ndi.distance_transform_edt(child_a[max(0, y0 - 2):y1 + 2, max(0, x0 - 2):x1 + 2] > 0.5)
    r = float(dt.max())
    if r < 2:
        return {"radius": r, "holesPx": None, "why": "joint not on the child"}
    R = int(math.ceil(0.9 * r)) + 3
    X0, Y0 = int(math.floor(jx)) - R, int(math.floor(jy)) - R
    size = 2 * R + 1

    def win(a):
        o = np.zeros((size, size), np.float32)
        sx0, sy0, sx1, sy1 = max(0, X0), max(0, Y0), min(W, X0 + size), min(H, Y0 + size)
        if sx1 > sx0 and sy1 > sy0:
            o[sy0 - Y0:sy1 - Y0, sx0 - X0:sx1 - X0] = a[sy0:sy1, sx0:sx1]
        return o

    C = win(child_a)
    P = win(parent_a) > 0.5
    yy, xx = np.mgrid[0:size, 0:size]
    lx, ly = jx - X0, jy - Y0
    region = (xx + 0.5 - lx) ** 2 + (yy + 0.5 - ly) ** 2 <= (0.9 * r) ** 2
    rest = (P | (C > 0.5)) & region
    holes = 0
    for d in (-deg, deg):
        Rm = rot_m(d, lx, ly)
        Rinv = np.linalg.inv(trans_m(-0.5, -0.5) @ Rm @ trans_m(0.5, 0.5))
        M = np.array([[Rinv[1, 1], Rinv[1, 0]], [Rinv[0, 1], Rinv[0, 0]]])
        off = np.array([Rinv[1, 2], Rinv[0, 2]])
        rc = ndi.affine_transform(C, M, off, output_shape=C.shape, order=1, mode="constant", cval=0.0)
        after = (P | (rc > 0.5)) & region
        holes = max(holes, int(np.count_nonzero(rest & ~after)))
    return {"radius": round(r, 1), "holesPx": holes, "deg": deg}


# ----------------------------------------------------------------------------- metrics


def ssim(a: np.ndarray, b: np.ndarray, mask: np.ndarray | None = None, sigma: float = 1.5) -> float:
    """Mean SSIM (Wang et al. 2004, Gaussian window) of two greyscale images in [0, 1] over `mask`."""
    C1, C2 = 0.01 ** 2, 0.03 ** 2
    a = a.astype(np.float64)
    b = b.astype(np.float64)
    g = lambda x: ndi.gaussian_filter(x, sigma, truncate=3.5)  # noqa: E731
    mu_a, mu_b = g(a), g(b)
    saa = g(a * a) - mu_a ** 2
    sbb = g(b * b) - mu_b ** 2
    sab = g(a * b) - mu_a * mu_b
    m = ((2 * mu_a * mu_b + C1) * (2 * sab + C2)) / ((mu_a ** 2 + mu_b ** 2 + C1) * (saa + sbb + C2))
    if mask is not None:
        return float(m[mask].mean()) if mask.any() else 1.0
    return float(m.mean())


def reassembly_metrics(rest_prem: np.ndarray, master_prem: np.ndarray) -> dict:
    """SSIM (luminance composited on mid grey, over the union of both silhouettes + 4 px) and alpha IoU."""
    ar, am = rest_prem[..., 3], master_prem[..., 3]
    union = (ar > 1 / 255) | (am > 1 / 255)
    region = ndi.binary_dilation(union, iterations=4)
    la = luminance(rest_prem[..., :3] + 0.5 * (1 - ar[..., None]))
    lb = luminance(master_prem[..., :3] + 0.5 * (1 - am[..., None]))
    s = ssim(la, lb, region)
    iou = ml.iou(ar, am)
    diff = np.abs(la - lb)
    return {"ssim": round(s, 5), "alphaIoU": round(iou, 5), "meanAbsDiff": round(float(diff[region].mean()), 5),
            "p99AbsDiff": round(float(np.percentile(diff[region], 99)), 4) if region.any() else 0.0,
            "gate": {"ssim": GATE_SSIM, "alphaIoU": GATE_IOU},
            "passed": bool(s > GATE_SSIM and iou > GATE_IOU)}


# ----------------------------------------------------------------------------- previews


def _font(size: int):
    try:
        return ImageFont.load_default(size=size)
    except TypeError:  # Pillow < 10.1
        return ImageFont.load_default()


def checker(h: int, w: int, cell: int = 16) -> np.ndarray:
    yy, xx = np.mgrid[0:h, 0:w]
    c = ((yy // cell + xx // cell) % 2).astype(np.float32)
    g = 0.30 + 0.08 * c
    return np.dstack([g * 0.9, g * 0.85, g * 1.1]).clip(0, 1)


def over_bg(prem: np.ndarray, bg: np.ndarray) -> np.ndarray:
    return prem[..., :3] + bg * (1 - prem[..., 3:4])


def components_preview(rgb: np.ndarray, alpha: np.ndarray, comps: list[dict], out: Path, max_side: int = 2048) -> None:
    """The matted sheet on a checker with every component boxed and numbered (operator overlay only)."""
    H, W = alpha.shape
    f = min(1.0, max_side / max(H, W))
    prem = premultiply(rgb, alpha)
    img = over_bg(prem, checker(H, W, max(8, int(16 / f))))
    im = Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8)).resize((max(1, int(W * f)), max(1, int(H * f))),
                                                                            Image.Resampling.LANCZOS)
    d = ImageDraw.Draw(im)
    font = _font(max(14, int(22 * max(f, 0.6))))
    for c in comps:
        x, y, w, h = [v * f for v in c["bbox"]]
        col = (255, 80, 80) if c["noise"] else (255, 230, 0)
        d.rectangle([x, y, x + w, y + h], outline=col, width=2)
        label = c["id"]
        tb = d.textbbox((0, 0), label, font=font)
        tw, th = tb[2] - tb[0], tb[3] - tb[1]
        d.rectangle([x, y, x + tw + 8, y + th + 8], fill=(0, 0, 0))
        d.text((x + 4, y + 2), label, fill=col, font=font)
    out.parent.mkdir(parents=True, exist_ok=True)
    im.save(out)


def to_u8(img: np.ndarray) -> np.ndarray:
    return (np.clip(img, 0, 1) * 255 + 0.5).astype(np.uint8)
