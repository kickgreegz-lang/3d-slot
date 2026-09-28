#!/usr/bin/env python3
"""Master-cut split for the Bass Drop 2D mascots (chr_gumbo, chr_croak).

Why this exists: the Nano Banana part sheets (plan rows chr_<id>_parts_*) are re-drawn, not cut-outs
of the approved rig master: other views, scales, even shapes (a frontal torso, a curled tail, full-head
mouth variants). Registered onto the master they cannot reassemble it (tools/split reports them
UNVERIFIED, as it did on sym_W_parts). So the SETUP POSE is cut from the master itself, pixel for pixel,
and the sheets only supply what the master cannot: hidden areas under other parts, attachment
variants (hands, eyes, mouths) and props.

  cut spec (YAML, master px)  ->  images/<skeleton>/<slot>[/<att>].png + parts.json (tools/spine
  character parts contract) + qa/{rest.png, report.json, rot_*.png}

Per part (back to front = list order unless `z`):
  region  shapes the part OWNS at rest (front parts win overlaps)      poly|circle|ellipse|rect|capsule
  minus   shapes subtracted from region
  take    master pixels copied into the part even where another part owns them (joint discs shared
          by parent and child: the rest pose stays exact and the joint rotates on real texture)
  extend  hidden area FILLED (inpaint, or a sheet piece warped by point pairs) where the master shows
          another material; an ink stroke is drawn on the new silhouette of the fill
  source  master (default) | {sheet, comp|bbox, from/to point pairs (2 = similarity, 3 = affine), clip}
  ops     [{inpaint: shapes}] paint-outs on the part (e.g. the pupil out of the eye)
Ink grab: outline pixels on a boundary go to the FRONT part, so a moving part keeps its own outline.
Seams: every part is dilated a few px under the parts in front of it (nearest-colour fill), so the
anti-aliased cut edges never show a halo at rest.

  tools/.venv/bin/python art/source/mascots/pipeline/mastercut.py art/source/mascots/gumbo/spine2d/cut.yaml
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from pathlib import Path

import numpy as np
import yaml
from PIL import Image, ImageDraw
from scipy import ndimage as ndi

REPO = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPO / "tools" / "split"))
sys.path.insert(0, str(REPO / "tools" / "matte"))
import splitlib as sl  # noqa: E402
import mattelib as ml  # noqa: E402

try:
    import cv2  # type: ignore
except Exception:  # pragma: no cover
    cv2 = None

TOOL = "art/source/mascots/pipeline/mastercut.py"


def rp(p) -> Path:
    q = Path(p)
    return q if q.is_absolute() else REPO / q


# ----------------------------------------------------------------------------- shapes

def raster(shapes, W: int, H: int) -> np.ndarray:
    """Union of shapes -> bool mask (H, W). Shapes: {poly: [[x,y]..]}, {circle: [cx,cy,r]},
    {ellipse: [cx,cy,rx,ry(,deg)]}, {rect: [x0,y0,x1,y1]}, {capsule: [x0,y0,x1,y1,r]}, or a bare point list."""
    im = Image.new("L", (W, H), 0)
    d = ImageDraw.Draw(im)
    for s in shapes or []:
        if isinstance(s, list):
            s = {"poly": s}
        if "poly" in s:
            pts = [tuple(map(float, p)) for p in s["poly"]]
            d.polygon(pts, fill=255)
        elif "circle" in s:
            cx, cy, r = map(float, s["circle"])
            d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=255)
        elif "ellipse" in s:
            v = list(map(float, s["ellipse"]))
            cx, cy, rx, ry = v[:4]
            deg = v[4] if len(v) > 4 else 0.0
            t = np.linspace(0, 2 * math.pi, 96, endpoint=False)
            c, sn = math.cos(math.radians(deg)), math.sin(math.radians(deg))
            xs, ys = rx * np.cos(t), ry * np.sin(t)
            d.polygon([(cx + x * c - y * sn, cy + x * sn + y * c) for x, y in zip(xs, ys)], fill=255)
        elif "rect" in s:
            x0, y0, x1, y1 = map(float, s["rect"])
            d.rectangle([x0, y0, x1, y1], fill=255)
        elif "wedge" in s:
            d.polygon([tuple(q) for q in wedge_poly(s["wedge"])], fill=255)
        elif "capsule" in s:
            x0, y0, x1, y1, r = map(float, s["capsule"])
            d.line([(x0, y0), (x1, y1)], fill=255, width=int(round(2 * r)))
            for (x, y) in ((x0, y0), (x1, y1)):
                d.ellipse([x - r, y - r, x + r, y + r], fill=255)
        else:
            raise SystemExit(f"unknown shape {s}")
    return np.asarray(im) > 127


def rot_pt(h, deg, p):
    """Rotate p about h by deg, visually clockwise in image space (y down): a jaw opening downward."""
    a = math.radians(deg)
    dx, dy = p[0] - h[0], p[1] - h[1]
    return [h[0] + dx * math.cos(a) - dy * math.sin(a), h[1] + dx * math.sin(a) + dy * math.cos(a)]


def resolve_pt(p):
    if isinstance(p, dict) and "rot" in p:
        h, deg, q = p["rot"]
        return rot_pt(h, float(deg), q)
    return [float(p[0]), float(p[1])]


def wedge_poly(w: dict) -> list:
    """Mouth gap at jaw angle `deg`: the head's lip line (`upper`, hinge first) moved `up` px up, then the jaw's
    lip line (`lower`, default = upper) rotated by deg about `hinge` and moved `down` px down, back to the hinge."""
    h = w["hinge"]
    up = [[x, y - float(w.get("up", 10))] for x, y in w["upper"]]
    low = [rot_pt(h, float(w["deg"]), q) for q in (w.get("lower") or w["upper"])]
    dn = float(w.get("down", 10))
    # push the lower line away from the hinge side (perpendicular to the rotated line, downward)
    a = math.radians(float(w["deg"]))
    low = [[x - dn * math.sin(a), y + dn * math.cos(a)] for x, y in low]
    return [tuple(h)] + [tuple(q) for q in up] + [tuple(q) for q in reversed(low)]


def catmull(pts: np.ndarray, samples: int = 12) -> np.ndarray:
    """Centripetal-free uniform Catmull-Rom through the points (ends duplicated)."""
    P = np.vstack([pts[0], pts, pts[-1]])
    out = []
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        for t in np.linspace(0, 1, samples, endpoint=False):
            t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    out.append(P[-2])
    return np.asarray(out)


def bbox_of(mask: np.ndarray, pad: int = 0):
    ys, xs = np.nonzero(mask)
    if not len(xs):
        return None
    H, W = mask.shape
    return (max(0, xs.min() - pad), max(0, ys.min() - pad), min(W, xs.max() + 1 + pad), min(H, ys.max() + 1 + pad))


def boundary(mask: np.ndarray) -> np.ndarray:
    return mask & ~ndi.binary_erosion(mask, iterations=1, border_value=0)


# ----------------------------------------------------------------------------- image helpers

def inpaint(rgb: np.ndarray, known: np.ndarray, todo: np.ndarray, radius: int = 6, method: str = "telea") -> np.ndarray:
    """Fill `todo` pixels of rgb (float 0-1) from `known` ones (on a crop)."""
    out = rgb.copy()
    if not todo.any():
        return out
    bb = bbox_of(todo | known, pad=radius * 3)
    x0, y0, x1, y1 = bb
    r = rgb[y0:y1, x0:x1]
    t = todo[y0:y1, x0:x1]
    k = known[y0:y1, x0:x1]
    if method == "nearest" or cv2 is None:
        idx = ndi.distance_transform_edt(~k, return_distances=False, return_indices=True)
        filled = r[idx[0], idx[1]]
        rr = r.copy()
        rr[t] = filled[t]
        out[y0:y1, x0:x1] = rr
        return out
    u8 = (np.clip(r, 0, 1) * 255 + 0.5).astype(np.uint8)
    # unknown = everything not known (so nothing outside the piece bleeds in)
    m = (~k).astype(np.uint8) * 255
    flag = cv2.INPAINT_TELEA if method == "telea" else cv2.INPAINT_NS
    res = cv2.inpaint(u8[..., ::-1].copy(), m, radius, flag)[..., ::-1].astype(np.float32) / 255
    rr = r.copy()
    rr[t] = res[t]
    out[y0:y1, x0:x1] = rr
    return out


def similarity_from(src, dst) -> np.ndarray:
    """2 point pairs -> similarity (3x3), 3+ pairs -> least-squares affine."""
    src = np.asarray([resolve_pt(q) for q in src], np.float64)
    dst = np.asarray([resolve_pt(q) for q in dst], np.float64)
    if len(src) == 2:
        (a, b), (c, d) = src
        (e, f), (g, h) = dst
        vs = complex(c - a, d - b)
        vd = complex(g - e, h - f)
        z = vd / vs
        t = complex(e, f) - z * complex(a, b)
        return np.array([[z.real, -z.imag, t.real], [z.imag, z.real, t.imag], [0, 0, 1]])
    A = np.hstack([src, np.ones((len(src), 1))])
    M, *_ = np.linalg.lstsq(A, dst, rcond=None)
    return np.vstack([M.T, [0, 0, 1]])


def color_transfer(rgb: np.ndarray, mask: np.ndarray, ref_rgb: np.ndarray, ref_mask: np.ndarray, strength: float = 1.0):
    if not mask.any() or not ref_mask.any():
        return rgb
    out = rgb.copy()
    for c in range(3):
        s = rgb[..., c][mask]
        r = ref_rgb[..., c][ref_mask]
        ms, ss = s.mean(), s.std() + 1e-4
        mr, sr = r.mean(), r.std() + 1e-4
        v = (rgb[..., c] - ms) * (1 + strength * (sr / ss - 1)) + ms + strength * (mr - ms)
        out[..., c] = np.clip(v, 0, 1)
    return out


# ----------------------------------------------------------------------------- the cut

class Cut:
    def __init__(self, spec_path: Path):
        self.spec_path = spec_path
        self.S = yaml.safe_load(spec_path.read_text())
        S = self.S
        self.skel = S["skeleton"]
        self.CW, self.CH = S["canvas"]
        self.anchor = S.get("anchor", [0.5, 1.0])
        self.work = rp(S.get("work", f"art/_work/mascots_bd/{self.skel}"))
        self.work.mkdir(parents=True, exist_ok=True)
        self.out_parts = rp(S["out"]["parts"])
        self.out_images = rp(S["out"]["images"])
        self.qa = rp(S["out"].get("qa", f"build/qa/{self.skel}/cut"))
        self.qa.mkdir(parents=True, exist_ok=True)
        self.warnings: list[str] = []
        self.sheets: dict[str, dict] = {}

    # --------------------------------------------------------------- master
    def load_master(self):
        m = self.S["master"]
        img = self._matte(m, "master")
        self.rgb, self.alpha = img["rgb"], img["alpha"]
        self.H, self.W = self.alpha.shape
        self.fig = self.alpha > 0.5
        lum = sl.luminance(self.rgb)
        self.ink = self.fig & (lum < float(self.S.get("inkLum", 0.2)))
        if self.S.get("inkChroma"):
            # outline ink is near-neutral black; dark saturated shading (a maroon fold) is paint
            self.ink &= (self.rgb.max(axis=2) - self.rgb.min(axis=2)) < float(self.S["inkChroma"])
        inkc = self.rgb[self.ink & (self.alpha > 0.99)]
        self.ink_rgb = np.median(inkc, axis=0) if len(inkc) else np.array([0.07, 0.06, 0.07], np.float32)
        f = self.S["fit"]
        self.s = float(f["scale"])
        fx, fy = f["feet"]                      # master px of the feet point (sole line, between the feet)
        ax, ay = self.anchor[0] * self.CW, self.anchor[1] * self.CH
        self.M2C = sl.trans_m(ax, ay) @ sl.scale_m(self.s) @ sl.trans_m(-fx, -fy)

    def _matte(self, m: dict, tag: str) -> dict:
        src = rp(m["image"])
        cache = self.work / "cache"
        cache.mkdir(parents=True, exist_ok=True)
        key = m.get("key", "auto")
        exp = m.get("expectKey")
        digest = sl.sha256_file(src)
        ck = hashlib.sha256(f"{digest}|{m.get('mirror')}|{key}|{exp}|v2".encode()).hexdigest()[:16]
        cp = cache / f"{tag}_{ck}.png"
        cj = cp.with_suffix(".json")
        if cp.exists() and cj.exists():
            arr = np.asarray(Image.open(cp).convert("RGBA"), np.float32) / 255
            return {"rgb": arr[..., :3], "alpha": arr[..., 3], "key": json.loads(cj.read_text())}
        path = src
        if m.get("mirror"):
            path = cache / f"{tag}_{ck}_mirror.png"
            Image.open(src).transpose(Image.FLIP_LEFT_RIGHT).save(path)
        mt = sl.matte_image(path, key=key, expect_key=exp)
        rgb, a = mt["rgb"], mt["alpha"]
        k = np.asarray(mt["key"]["keyRgb"], np.float32) if "keyRgb" in mt["key"] else None
        if k is not None:
            # Nano Banana tints the outline toward the key: despill dark pixels near the alpha edge
            vis = a > 0
            near = ndi.distance_transform_edt(vis) <= 6
            zone = vis & ((sl.luminance(rgb) < 0.35) & near | (a < 1 - 1 / 255))
            rgb = ml.despill(rgb, k, mask=zone.astype(np.float32))
            mt["key"]["inkfix"] = ml.halo_report(rgb, a, k)["keyTintedEdgePx"]
        ml.save_rgba(cp, rgb, a)
        cj.write_text(json.dumps(mt["key"], indent=1, default=float) + "\n")
        return {"rgb": rgb, "alpha": a, "key": mt["key"]}

    def sheet(self, name: str) -> dict:
        if name not in self.sheets:
            sd = self.S["sheets"][name]
            img = self._matte(sd, f"sheet_{name}")
            comps, lab = sl.find_components(img["alpha"])
            real = [c for c in comps if not c["noise"]]
            self.sheets[name] = {"rgb": img["rgb"], "alpha": img["alpha"], "comps": {c["id"]: c for c in comps},
                                 "lab": lab, "real": real}
        return self.sheets[name]

    # --------------------------------------------------------------- parts
    def parts_list(self):
        P = []
        for i, p in enumerate(self.S["parts"]):
            p = dict(p)
            p.setdefault("attachment", p["slot"])
            p["pid"] = p["slot"] if p["attachment"] == p["slot"] else f"{p['slot']}/{p['attachment']}"
            p.setdefault("z", i)
            p["order"] = i
            P.append(p)
        # cuts: [{line: [[x0,y0],[x1,y1]], parts: {pidA: [refx,refy], pidB: [..]}, w: 10}] -> a seed strip on each
        # side of the line (the side of each part's reference point): the watershed cannot move a boundary
        # that runs through continuous paint with no outline (elbows, knees, the jaw/throat line)
        byid0 = {}
        for q in P:
            byid0.setdefault(q["slot"], q)
            byid0[q["pid"]] = q
        for c in self.S.get("cuts") or []:
            (ax, ay), (bx, by) = c["line"]
            dx, dy = bx - ax, by - ay
            L = math.hypot(dx, dy) or 1.0
            nx, ny = -dy / L, dx / L
            ext = float(c.get("ext", 0))
            ax2, ay2, bx2, by2 = ax - dx / L * ext, ay - dy / L * ext, bx + dx / L * ext, by + dy / L * ext
            w = float(c.get("w", 10))
            for pid, ref in c["parts"].items():
                sg = 1.0 if (ref[0] - ax) * nx + (ref[1] - ay) * ny > 0 else -1.0
                o = 0.75  # half a pixel either side of the line stays unlabelled (the watershed boundary)
                strip = [[ax2 + sg * nx * o, ay2 + sg * ny * o], [bx2 + sg * nx * o, by2 + sg * ny * o],
                         [bx2 + sg * nx * w, by2 + sg * ny * w], [ax2 + sg * nx * w, ay2 + sg * ny * w]]
                q = byid0[pid]
                q["seed"] = list(q.get("seed") or []) + [strip]
        # joints: {name: {at, r, child, parent, take: true, extend: 1.0}} -> the child (drawn in front) takes a
        # disc of master pixels centred on the joint (its overlap cap; exact at rest), the parent fills a disc
        # under it (so a rotating child never uncovers a hole)
        byid = byid0
        for jn, j in (self.S.get("joints") or {}).items():
            x, y = j["at"]
            r = float(j["r"])
            within = j.get("within") or [k for k in (j.get("parent"), j.get("child")) if k]
            if j.get("child") and j.get("take", True):
                c = byid[j["child"]]
                c.setdefault("_jointTake", []).append(({"circle": [x, y, r]}, within))
            if j.get("parent") and j.get("extend", 1.0):
                q = byid[j["parent"]]
                q.setdefault("_jointExtend", []).append(({"circle": [x, y, r * float(j.get("extend", 1.0))]}, within))
        # setup attachment per slot = first listed unless one says setup: true
        by_slot: dict[str, list] = {}
        for p in P:
            by_slot.setdefault(p["slot"], []).append(p)
        for s, vs in by_slot.items():
            su = [v for v in vs if v.get("setup")]
            first = su[0] if su else vs[0]
            for v in vs:
                v["isSetup"] = v is first and not v.get("hidden")
                v["slotZ"] = first["z"]
        return P

    def mask(self, shapes):
        return raster(shapes, self.W, self.H) if shapes else np.zeros((self.H, self.W), bool)

    def ownership(self, P):
        """Who owns each master pixel at rest. `seed` shapes are watershed markers on the painted image
        (boundaries snap to the outline ink between the markers); `region` shapes are hard claims
        (front part wins). `limit` shapes bound a part. Figure pixels nobody reached go to the nearest part."""
        setups = [p for p in P if p["isSetup"] and p.get("source", "master") == "master" and not p.get("noOwn")]
        setups.sort(key=lambda p: p["z"])  # back to front: front markers overwrite back ones
        W, H = self.W, self.H
        fig = self.fig
        markers = np.zeros((H, W), np.int32)
        ids = [p["pid"] for p in setups]
        for i, p in enumerate(setups, 1):
            shapes = p.get("seed") or p.get("region")
            if not shapes:
                continue
            m = self.mask(shapes) & fig
            if p.get("minus"):
                m &= ~self.mask(p["minus"])
            markers[m] = i
        bgl = len(setups) + 1
        markers[self.alpha < 0.05] = bgl
        # watershed on the painted image composited over black (the outline and the background merge)
        img = np.clip(self.rgb * self.alpha[..., None], 0, 1)
        img = ndi.gaussian_filter(img, (1.2, 1.2, 0))
        u8 = (img * 255 + 0.5).astype(np.uint8)[..., ::-1].copy()
        if cv2 is None:
            raise SystemExit("mastercut: seeds need OpenCV (tools/requirements.txt)")
        lab = cv2.watershed(u8, markers.copy())
        # outline ink is a valley the flood runs along: give every ink pixel to the part whose PAINT is
        # nearest (then the ink grab below hands boundary lines to the front part)
        if self.S.get("inkNearest", True):
            paint = fig & ~self.ink & (lab >= 1) & (lab <= len(setups))
            idx = ndi.distance_transform_edt(~paint, return_distances=False, return_indices=True)
            nl = lab[idx[0], idx[1]]
            inkm = fig & self.ink
            lab = np.where(inkm, nl, lab)
        owned = {}
        claimed = np.zeros((H, W), bool)
        for i, p in enumerate(setups, 1):
            o = (lab == i) & fig
            if p.get("limit"):
                o &= self.mask(p["limit"])
            # drop fragments that do not touch the part's own markers (leaks along shared outlines)
            if o.any() and (markers == i).any():
                cl, n = ndi.label(o, structure=np.ones((3, 3), bool))
                keep = np.unique(cl[(markers == i) & o])
                keep = keep[keep > 0]
                o = np.isin(cl, keep)
            owned[p["pid"]] = o
            claimed |= o
        rest = fig & ~claimed
        if rest.any():
            labm = np.zeros((H, W), np.int32)
            for i, pid in enumerate(ids, 1):
                labm[owned[pid]] = i
            idx = ndi.distance_transform_edt(labm == 0, return_distances=False, return_indices=True)
            near = labm[idx[0], idx[1]]
            cnt = {}
            for i, pid in enumerate(ids, 1):
                m = rest & (near == i)
                if m.any():
                    owned[pid] |= m
                    cnt[pid] = int(m.sum())
            self.unowned = cnt
        else:
            self.unowned = {}
        setups.sort(key=lambda p: -p["z"])  # front first from here on
        # ink grab: outline pixels on a boundary go to the front part
        band = int(self.S.get("inkBand", 14))
        zof = {p["pid"]: p["z"] for p in setups}
        for p in setups:  # front first
            if p.get("inkGrab", True) is False:
                continue
            A = owned[p["pid"]]
            lower = np.zeros_like(A)
            for q in setups:
                if zof[q["pid"]] < p["z"] and q.get("giveInk", True):
                    lower |= owned[q["pid"]]
            cand = self.ink & lower & ndi.binary_dilation(A, iterations=band)
            if not cand.any():
                continue
            seed = ndi.binary_dilation(A, iterations=1) & cand
            for _ in range(band):
                nxt = ndi.binary_dilation(seed, iterations=1) & cand
                if (nxt == seed).all():
                    break
                seed = nxt
            if seed.any():
                owned[p["pid"]] = A | seed
                for q in setups:
                    if zof[q["pid"]] < p["z"]:
                        owned[q["pid"]] &= ~seed
        self.owned = owned
        return owned

    # --------------------------------------------------------------- build one piece (master space)
    def build_master_piece(self, p, owned):
        W, H = self.W, self.H
        own = owned.get(p["pid"])
        if own is None:  # variant from the master: its region, no ownership
            own = self.mask(p.get("region")) & self.fig
            if p.get("minus"):
                own &= ~self.mask(p["minus"])
        take = self.mask(p.get("take")) & self.fig if p.get("take") else np.zeros_like(own)
        # joint discs only cover the two limbs they join (never the torso next to an elbow)
        for sh, within in p.get("_jointTake") or []:
            take |= self.mask([sh]) & self._within(within, owned)
        if p.get("takeMinus"):
            take &= ~self.mask(p["takeMinus"])
        known = own | take
        ext = self.mask(p.get("extend")) if p.get("extend") else np.zeros_like(own)
        for sh, within in p.get("_jointExtend") or []:
            ext |= self.mask([sh]) & self._within(within, owned)
        if p.get("extendMinus"):
            ext &= ~self.mask(p["extendMinus"])
        if p.get("clip", True):
            ext &= self.fig
        ext &= ~known
        seam = np.zeros_like(own)
        sp = int(p.get("seam", self.S.get("seam", 6)))
        if p["isSetup"] and sp > 0:
            front = np.zeros_like(own)
            for q, m in owned.items():
                if q != p["pid"] and self._z(q) > p["z"]:
                    front |= m
            seam = ndi.binary_dilation(known | ext, iterations=sp) & self.fig & front & ~known & ~ext
        fillz = ext | seam
        allm = known | fillz
        bb = bbox_of(allm, pad=12)
        if bb is None:
            raise SystemExit(f"{p['pid']}: empty piece")
        x0, y0, x1, y1 = bb
        rgb = self.rgb[y0:y1, x0:x1].copy()
        k = known[y0:y1, x0:x1]
        e = ext[y0:y1, x0:x1]
        s = seam[y0:y1, x0:x1]
        # ops: paint-outs and paint-overs on the known pixels (face variants)
        rgb = self.apply_ops(p.get("ops"), rgb, k, (x0, y0))
        fill = p.get("fill", "telea")
        if e.any():
            if isinstance(fill, dict) and "sheet" in fill:
                wr, wa = self.sheet_to_master(fill, (x0, y0, x1, y1))
                got = e & (wa > 0.5)
                rgb[got] = wr[got]
                if fill.get("match", True):
                    band = ndi.binary_dilation(got, iterations=24) & k
                    if band.any():
                        rgb2 = color_transfer(rgb, got, rgb, band, strength=float(fill.get("strength", 0.8)))
                        rgb[got] = rgb2[got]
                rest = e & ~got
                if rest.any():
                    rgb = inpaint(rgb, k | got, rest, radius=6)
            else:
                rgb = inpaint(rgb, k, e, radius=int(p.get("fillRadius", 6)), method=fill if isinstance(fill, str) else "telea")
        if s.any():
            rgb = inpaint(rgb, k | e, s, method="nearest")
            # the first px of the seam (the anti-aliasing zone under the front part's edge) keep the master's
            # own pixels, so the rest pose composites without a halo line along cut boundaries
            near = s & (ndi.distance_transform_edt(~(k | e)) <= float(self.S.get("seamExact", 2.5)))
            rgb[near] = self.rgb[y0:y1, x0:x1][near]
        if p.get("post"):
            rgb = self.apply_ops(p["post"], rgb, k | e | s, (x0, y0), fillmask=(e | s))
        a = self.alpha[y0:y1, x0:x1].copy()
        m = k | e | s
        a = np.where(m, a, 0.0).astype(np.float32)
        if p.get("soft"):
            # feathered inner edge (an overlay patch blends into the part under it); the figure's own
            # silhouette keeps its hard anti-aliased edge
            sf = float(p["soft"])
            dist = ndi.distance_transform_edt(m)
            inner = ~ndi.binary_dilation(~self.fig[y0:y1, x0:x1], iterations=3)
            ramp = np.clip(dist / sf, 0, 1)
            a = np.where(inner, a * ramp, a).astype(np.float32)
        if not p.get("clip", True):
            a[e] = 1.0
        # ink stroke on the new silhouette of filled areas (never on pixels visible at rest)
        sw = float(p.get("stroke", self.S.get("stroke", 9)))
        if sw > 0 and (e.any() or s.any()):
            d = ndi.distance_transform_edt(m)
            st = np.clip(sw + 0.5 - d, 0, 1) * (e | s)
            if p.get("strokeZone"):
                st *= raster(p["strokeZone"], W, H)[y0:y1, x0:x1]
            rgb = rgb * (1 - st[..., None]) + self.ink_rgb[None, None, :] * st[..., None]
        return {"rgb": rgb.astype(np.float32), "alpha": a, "origin": (x0, y0), "fillPx": int(e.sum()), "seamPx": int(s.sum()),
                "ownPx": int(k.sum())}

    def apply_ops(self, ops, rgb, k, origin, fillmask=None):
        """Paint operations in master px on a crop (origin = its top-left):
          {inpaint: shapes, radius, method}      fill the shapes from the surrounding known pixels
          {paint: shapes, color: [r,g,b] | ink | sample:[x,y], alpha: 0-1, feather: px}
          {stroke: [[x,y]..], width: px, color: ink|[r,g,b], smooth: true, taper: [a, b]}  anti-aliased line
          {warp: [[x0,y0,x1,y1]..], sigma: px, shapes: limit}   smooth displacement (pixel at x0,y0 moves to x1,y1)
          {gradient: shapes, from: [x,y,r,g,b], to: [x,y,r,g,b], alpha, feather}
        """
        if not ops:
            return rgb
        x0, y0 = origin
        h, w = rgb.shape[:2]
        W, H = self.W, self.H

        cur = {"op": None}

        def crop_mask(shapes, feather=0.0):
            m = raster(shapes, W, H)[y0:y0 + h, x0:x0 + w].astype(np.float32)
            if feather > 0:
                m = ndi.gaussian_filter(m, feather)
            op = cur["op"]
            if op is not None and op.get("only") == "fill" and fillmask is not None:
                m = m * fillmask.astype(np.float32)
            if op is not None and op.get("clipTo"):
                m = m * raster(op["clipTo"], W, H)[y0:y0 + h, x0:x0 + w].astype(np.float32)
            return m

        def colour(c):
            if c is None or c == "ink":
                return self.ink_rgb
            if isinstance(c, dict) and "sample" in c:
                sx, sy = c["sample"]
                r = int(c.get("r", 3))
                patch = self.rgb[int(sy) - r:int(sy) + r + 1, int(sx) - r:int(sx) + r + 1].reshape(-1, 3)
                return np.median(patch, axis=0)
            return np.asarray(c, np.float32) / (255.0 if max(c) > 1 else 1.0)

        for op in ops:
            cur["op"] = op
            if "inpaint" in op:
                t = raster(op["inpaint"], W, H)[y0:y0 + h, x0:x0 + w] & k
                rgb = inpaint(rgb, k & ~t, t, radius=int(op.get("radius", 5)), method=op.get("method", "telea"))
            elif "paint" in op:
                m = crop_mask(op["paint"], float(op.get("feather", 0))) * float(op.get("alpha", 1.0))
                c = colour(op.get("color"))
                rgb = rgb * (1 - m[..., None]) + c[None, None, :] * m[..., None]
            elif "gradient" in op:
                m = crop_mask(op["gradient"], float(op.get("feather", 0))) * float(op.get("alpha", 1.0))
                (ax, ay, *ca), (bx, by, *cb) = op["from"], op["to"]
                ca = np.asarray(ca, np.float32) / 255
                cb = np.asarray(cb, np.float32) / 255
                yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
                xx += x0
                yy += y0
                vx, vy = bx - ax, by - ay
                t = np.clip(((xx - ax) * vx + (yy - ay) * vy) / max(vx * vx + vy * vy, 1e-6), 0, 1)
                c = ca[None, None, :] * (1 - t[..., None]) + cb[None, None, :] * t[..., None]
                rgb = rgb * (1 - m[..., None]) + c * m[..., None]
            elif "stroke" in op:
                pts = np.asarray(op["stroke"], np.float64)
                if op.get("smooth", True) and len(pts) >= 3:
                    pts = catmull(pts, int(op.get("samples", 12)))
                wid = float(op.get("width", 8))
                ss = 4
                im = Image.new("L", (w * ss, h * ss), 0)
                d = ImageDraw.Draw(im)
                tap = op.get("taper")
                n = len(pts)
                for i in range(n - 1):
                    t0 = i / max(n - 1, 1)
                    f = 1.0
                    if tap:
                        a0, a1 = tap  # width factor at the ends (fraction of the line where it tapers)
                        f = min(1.0, (t0 + 1e-6) / a0 if a0 > 0 else 1.0, (1 - t0 + 1e-6) / a1 if a1 > 0 else 1.0)
                        f = max(0.25, f)
                    ww = max(1, int(round(wid * f * ss)))
                    (ax, ay), (bx, by) = pts[i], pts[i + 1]
                    d.line([((ax - x0) * ss, (ay - y0) * ss), ((bx - x0) * ss, (by - y0) * ss)], fill=255, width=ww)
                    r = ww / 2
                    d.ellipse([(bx - x0) * ss - r, (by - y0) * ss - r, (bx - x0) * ss + r, (by - y0) * ss + r], fill=255)
                m = np.asarray(im.resize((w, h), Image.BOX), np.float32) / 255 * float(op.get("alpha", 1.0))
                if op.get("clipTo"):
                    m = m * raster(op["clipTo"], W, H)[y0:y0 + h, x0:x0 + w].astype(np.float32)
                c = colour(op.get("color"))
                rgb = rgb * (1 - m[..., None]) + c[None, None, :] * m[..., None]
            elif "warp" in op:
                pr = np.asarray(op["warp"], np.float64)
                sig = float(op.get("sigma", 20))
                yy, xx = np.mgrid[0:h, 0:w].astype(np.float64)
                xx += x0 + 0.5
                yy += y0 + 0.5
                dx = np.zeros_like(xx)
                dy = np.zeros_like(yy)
                wsum = np.zeros_like(xx)
                # backward map: a pixel near the destination samples from the source
                for (ax, ay, bx, by) in pr:
                    g = np.exp(-((xx - bx) ** 2 + (yy - by) ** 2) / (2 * sig * sig))
                    dx += g * (ax - bx)
                    dy += g * (ay - by)
                    wsum += g
                norm = np.maximum(wsum, 1.0)
                dx /= norm
                dy /= norm
                if op.get("shapes"):
                    lm = crop_mask(op["shapes"], float(op.get("feather", 4)))
                    dx *= lm
                    dy *= lm
                sx = (xx + dx - x0 - 0.5).astype(np.float32)
                sy = (yy + dy - y0 - 0.5).astype(np.float32)
                src = self.rgb[y0:y0 + h, x0:x0 + w] if op.get("fromMaster") else rgb
                rgb = np.dstack([ndi.map_coordinates(src[..., c], [sy, sx], order=1, mode="nearest") for c in range(3)]).astype(np.float32)
            else:
                raise SystemExit(f"unknown op {op}")
        return np.clip(rgb, 0, 1).astype(np.float32)

    def _within(self, within, owned):
        if within == "fig":
            return self.fig
        m = np.zeros((self.H, self.W), bool)
        for q in within:
            for pid, om in owned.items():
                if pid == q or pid.split("/")[0] == q:
                    m |= om
        return m

    def _z(self, pid):
        return self._zmap[pid]

    def sheet_to_master(self, src: dict, box):
        """Warp a sheet component into master px inside box=(x0,y0,x1,y1). Returns straight rgb + alpha crops."""
        sh = self.sheet(src["sheet"])
        rgb, a = sh["rgb"], sh["alpha"]
        if "comp" in src:
            cids = src["comp"] if isinstance(src["comp"], list) else [src["comp"]]
            m = np.zeros(a.shape, bool)
            for cid in cids:
                c = sh["comps"][str(cid)]
                m |= sh["lab"] == c["label"]
            m = ndi.binary_dilation(m, iterations=2)
            a = np.where(m, a, 0)
        elif "bbox" in src:
            bx0, by0, bx1, by1 = src["bbox"]
            mm = np.zeros(a.shape, bool)
            mm[by0:by1, bx0:bx1] = True
            a = np.where(mm, a, 0)
        if src.get("erase"):
            er = raster(src["erase"], a.shape[1], a.shape[0])
            a = np.where(er, 0, a)
        A = similarity_from(src["from"], src["to"])
        x0, y0, x1, y1 = box
        bb = bbox_of(a > 0.01, pad=4)
        sx0, sy0, sx1, sy1 = bb
        prem = sl.premultiply(rgb[sy0:sy1, sx0:sx1], a[sy0:sy1, sx0:sx1])
        C = A @ sl.trans_m(sx0, sy0)
        w = sl.warp_prem(prem, C, (x0, y0, x1 - x0, y1 - y0))
        r, al = sl.unpremultiply(w)
        return r, al

    # --------------------------------------------------------------- canvas
    def place(self, rgb, a, origin, C_extra=None):
        """Master-space crop -> canvas: trimmed premultiplied image + integer box."""
        if C_extra is None:
            x0, y0 = origin
            C = self.M2C @ sl.trans_m(x0, y0)
        else:
            C = self.M2C @ C_extra
        h, w = a.shape
        pts = sl.apply(C, [[0, 0], [w, 0], [0, h], [w, h]])
        X0, Y0 = int(math.floor(pts[:, 0].min())) - 2, int(math.floor(pts[:, 1].min())) - 2
        X1, Y1 = int(math.ceil(pts[:, 0].max())) + 2, int(math.ceil(pts[:, 1].max())) + 2
        img = sl.warp_prem(sl.premultiply(rgb, a), C, (X0, Y0, X1 - X0, Y1 - Y0))
        img[img[..., 3] < 3 / 255] = 0
        ys, xs = np.nonzero(img[..., 3] > 0)
        if not len(xs):
            return None, None
        pad = int(self.S.get("pad", 3))
        bx0, bx1 = xs.min() - pad, xs.max() + 1 + pad
        by0, by1 = ys.min() - pad, ys.max() + 1 + pad
        out = np.zeros((by1 - by0, bx1 - bx0, 4), np.float32)
        sy0, sx0 = max(0, by0), max(0, bx0)
        sy1, sx1 = min(img.shape[0], by1), min(img.shape[1], bx1)
        out[sy0 - by0:sy1 - by0, sx0 - bx0:sx1 - bx0] = img[sy0:sy1, sx0:sx1]
        return out, (int(X0 + bx0), int(Y0 + by0), int(bx1 - bx0), int(by1 - by0))

    def m2c(self, pt):
        q = sl.apply(self.M2C, [pt])[0]
        return [round(float(q[0]), 2), round(float(q[1]), 2)]

    # --------------------------------------------------------------- run
    def run(self):
        self.load_master()
        P = self.parts_list()
        self._zmap = {p["pid"]: p["z"] for p in P}
        owned = self.ownership(P)
        self.owners_preview(P, owned)
        if getattr(self, "owners_only", False):
            return {"owners": str(self.qa / "owners.png")}
        pieces = []
        for p in P:
            src = p.get("source", "master")
            if src == "master":
                mp = self.build_master_piece(p, owned)
                img, box = self.place(mp["rgb"], mp["alpha"], mp["origin"])
                info = {k: mp[k] for k in ("fillPx", "seamPx", "ownPx")}
            else:
                img, box, info = self.sheet_piece(p)
            if img is None:
                raise SystemExit(f"{p['pid']}: empty on the canvas")
            pieces.append({"p": p, "img": img, "box": box, "info": info})
        self.pieces = pieces
        self.write(pieces)
        return self.qa_report(pieces)

    def owners_preview(self, P, owned, scale: float = 0.45):
        """QA: every setup part tinted over the master, seeds outlined, part names at their centroids."""
        rng = np.random.default_rng(7)
        H, W = self.H, self.W
        base = self.rgb * self.alpha[..., None] + 0.55 * (1 - self.alpha[..., None])
        tint = np.zeros((H, W, 3), np.float32)
        tm = np.zeros((H, W), np.float32)
        cols = {}
        import colorsys
        n = max(len(owned), 1)
        order = rng.permutation(n)
        for j, (pid, m) in enumerate(owned.items()):
            c = np.asarray(colorsys.hsv_to_rgb(order[j] / n, 0.85 if j % 2 else 0.6, 1.0 if j % 3 else 0.7), np.float32)
            cols[pid] = c
            tint[m] = c
            tm[m] = 0.55
            e = boundary(m)
            tint[e] = 0
            tm[e] = 1.0
        out = base * (1 - tm[..., None]) + tint * tm[..., None]
        im = Image.fromarray((np.clip(out, 0, 1) * 255 + 0.5).astype(np.uint8))
        im = im.resize((int(W * scale), int(H * scale)), Image.LANCZOS)
        d = ImageDraw.Draw(im)
        for p in P:
            if p["pid"] not in owned:
                continue
            for sh in p.get("seed") or []:
                if isinstance(sh, list):
                    sh = {"poly": sh}
                if "poly" in sh:
                    pts = [(x * scale, y * scale) for x, y in sh["poly"]]
                    d.line(pts + [pts[0]], fill=(255, 255, 255), width=1)
            ys, xs = np.nonzero(owned[p["pid"]])
            if len(xs):
                d.text((xs.mean() * scale - 12, ys.mean() * scale - 6), p["pid"], fill=(255, 255, 255))
        im.save(self.qa / "owners.png")

    def sheet_piece(self, p):
        src = p["source"]
        sh = self.sheet(src["sheet"])
        rgb, a = sh["rgb"], sh["alpha"]
        cids = src["comp"] if isinstance(src.get("comp"), list) else ([src["comp"]] if "comp" in src else [])
        m = np.zeros(a.shape, bool)
        for cid in cids:
            m |= sh["lab"] == sh["comps"][str(cid)]["label"]
        if "bbox" in src:
            bx0, by0, bx1, by1 = src["bbox"]
            mm = np.zeros(a.shape, bool)
            mm[by0:by1, bx0:bx1] = True
            m = mm if not cids else (m & mm)
        m = ndi.binary_dilation(m, iterations=2)
        a = np.where(m, a, 0).astype(np.float32)
        if src.get("erase"):
            a = np.where(raster(src["erase"], a.shape[1], a.shape[0]), 0, a).astype(np.float32)
        A = similarity_from(src["from"], src["to"])  # sheet px -> master px
        bb = bbox_of(a > 0.01, pad=4)
        sx0, sy0, sx1, sy1 = bb
        r = rgb[sy0:sy1, sx0:sx1].copy()
        al = a[sy0:sy1, sx0:sx1].copy()
        if src.get("match"):
            # colour-match the sheet piece to master pixels in a region (master px)
            mr = raster(src["match"]["master"], self.W, self.H) & self.fig
            sm = al > 0.9
            if src["match"].get("sheet"):
                ss = raster(src["match"]["sheet"], a.shape[1], a.shape[0])[sy0:sy1, sx0:sx1]
                sm &= ss
            r2 = color_transfer(r, sm, self.rgb, mr, strength=float(src["match"].get("strength", 1.0)))
            r = np.where((al > 0)[..., None], r2, r)
        if src.get("clip"):
            # clip in master space: warp the clip mask back to the sheet
            Ainv = np.linalg.inv(A @ sl.trans_m(sx0, sy0))
            cm = raster(src["clip"], self.W, self.H).astype(np.float32)
            h, w = al.shape
            Ai = Ainv
            if cv2 is not None:
                back = cv2.warpAffine(cm, np.linalg.inv(Ai)[:2] if False else Ai[:2], (w, h), flags=cv2.INTER_LINEAR)
            else:
                back = np.ones_like(al)
            al = al * back
        img, box = self.place(r, al, None, C_extra=A @ sl.trans_m(sx0, sy0))
        return img, box, {"sheet": src["sheet"], "scale": round(float(math.sqrt(abs(np.linalg.det(A[:2, :2])))) * self.s, 4)}

    # --------------------------------------------------------------- output
    def write(self, pieces):
        root = self.out_images / self.skel
        # clean previous outputs for this skeleton (only files we own)
        if root.exists():
            for f in sorted(root.rglob("*.png")):
                f.unlink()
        root.mkdir(parents=True, exist_ok=True)
        parts = []
        for pc in pieces:
            p = pc["p"]
            rel = f"{p['slot']}.png" if p["attachment"] == p["slot"] else f"{p['slot']}/{p['attachment']}.png"
            f = root / rel
            f.parent.mkdir(parents=True, exist_ok=True)
            rgb, a = sl.unpremultiply(pc["img"])
            # bleed colour under alpha 0 (straight alpha textures never sample black when filtered)
            if (a < 1 / 255).any() and (a > 0).any():
                idx = ndi.distance_transform_edt(a < 1 / 255, return_distances=False, return_indices=True)
                rgb = rgb[idx[0], idx[1]]
            ml.save_rgba(f, rgb, a)
            e = {"slot": p["slot"]}
            if p["attachment"] != p["slot"]:
                e["attachment"] = p["attachment"]
            e["bbox"] = list(pc["box"])
            first_of_slot = not any(q["slot"] == p["slot"] for q in parts)
            if first_of_slot:
                e["z"] = p["slotZ"]
                for k in ("bone", "parent", "blend", "color"):
                    if k in p:
                        e[k] = p[k]
                for k in ("joint", "tip"):
                    if k in p:
                        e[k] = self.m2c(p[k]) if not p.get(f"{k}Canvas") else p[k]
                if p.get("hidden"):
                    e["hidden"] = True
            if p.get("setup"):
                e["setup"] = True
            parts.append(e)
        lm = {k: self.m2c(v) for k, v in (self.S.get("landmarks") or {}).items()}
        pts = {k: self.m2c(resolve_pt(v)) for k, v in (self.S.get("points") or {}).items()}
        if pts:
            (self.out_parts.parent / "points.json").write_text(json.dumps(
                {"$comment": f"Named rig points in canvas image space (written by {TOOL} from the cut spec `points`, "
                             "master px -> canvas): joints/tips for rig.yaml bones and pose targets.",
                 "points": pts}, indent=1) + "\n")
        rel_images = Path(__import__("os").path.relpath(self.out_images, self.out_parts.parent)).as_posix()
        doc = {"$comment": f"Written by {TOOL} from {self.spec_path.relative_to(REPO).as_posix()} (master cut: setup pose = "
                           f"the approved rig master pixel for pixel; hidden areas, variants and props from the part sheets). "
                           f"Canvas {self.CW}x{self.CH} @2x, image space (y down); root = anchor (feet point).",
               "skeleton": self.skel, "kind": "character", "canvas": [self.CW, self.CH], "anchor": self.anchor,
               "images": rel_images, "landmarks": lm, "parts": parts}
        self.out_parts.parent.mkdir(parents=True, exist_ok=True)
        self.out_parts.write_text(json.dumps(doc, indent=1) + "\n")
        self.parts_doc = doc

    def composite(self, pieces, overrides=None, props=True):
        acc = np.zeros((self.CH, self.CW, 4), np.float32)
        items = [pc for pc in pieces if pc["p"]["isSetup"] and (props or pc["p"].get("inRest", True))]
        if overrides:
            items = overrides(items)
        for pc in sorted(items, key=lambda q: q["p"]["slotZ"]):
            img, (x, y, w, h) = pc["img"], pc["box"]
            if "M" in pc:  # rotated preview
                img, (x, y, w, h) = pc["M"]
            sx0, sy0, sx1, sy1 = max(0, x), max(0, y), min(self.CW, x + w), min(self.CH, y + h)
            if sx1 <= sx0 or sy1 <= sy0:
                continue
            L = img[sy0 - y:sy1 - y, sx0 - x:sx1 - x]
            acc[sy0:sy1, sx0:sx1] = L + acc[sy0:sy1, sx0:sx1] * (1 - L[..., 3:4])
        return acc

    def qa_report(self, pieces):
        rest = self.composite(pieces, props=False)
        mc = sl.warp_prem(sl.premultiply(self.rgb, self.alpha), self.M2C, (0, 0, self.CW, self.CH))
        met = sl.reassembly_metrics(rest, mc)
        bg = np.full((self.CH, self.CW, 3), 0.5, np.float32)
        comp = lambda pm: pm[..., :3] + bg * (1 - pm[..., 3:4])  # noqa: E731
        diff = np.clip(np.abs(comp(rest) - comp(mc)) * 4, 0, 1)
        row = np.concatenate([comp(rest), comp(mc), diff], axis=1)
        Image.fromarray((row * 255 + 0.5).astype(np.uint8)).save(self.qa / "rest.png")
        # rotation tests
        tests = []
        for t in self.S.get("tests") or []:
            tiles = []
            for deg in t.get("deg", [-35, 35]):
                jc = self.m2c(t["joint"])
                def ov(items, t=t, deg=deg, jc=jc):
                    out = []
                    for pc in items:
                        if pc["p"]["slot"] in t["pieces"]:
                            pc = dict(pc)
                            R = sl.rot_m(deg, jc[0], jc[1])
                            x, y, w, h = pc["box"]
                            A = R @ sl.trans_m(x, y)
                            pts = sl.apply(A, [[0, 0], [w, 0], [0, h], [w, h]])
                            X0, Y0 = int(math.floor(pts[:, 0].min())) - 1, int(math.floor(pts[:, 1].min())) - 1
                            X1, Y1 = int(math.ceil(pts[:, 0].max())) + 1, int(math.ceil(pts[:, 1].max())) + 1
                            im = sl.warp_prem(pc["img"], A, (X0, Y0, X1 - X0, Y1 - Y0))
                            pc["M"] = (im, (X0, Y0, X1 - X0, Y1 - Y0))
                        out.append(pc)
                    return out
                c = self.composite(pieces, ov)
                tiles.append(comp(c))
            img = np.concatenate(tiles, axis=1)
            fn = self.qa / f"rot_{t['name']}.png"
            Image.fromarray((img * 255 + 0.5).astype(np.uint8)).save(fn)
            tests.append(str(fn))
        rep = {"tool": TOOL, "spec": str(self.spec_path.relative_to(REPO)), "reassembly": met,
               "scale": self.s, "unowned": self.unowned, "warnings": self.warnings,
               "pieces": {pc["p"]["pid"]: {"box": pc["box"], **pc["info"]} for pc in pieces}, "tests": tests,
               "parts": str(self.out_parts.relative_to(REPO)), "preview": str((self.qa / "rest.png").relative_to(REPO))}
        (self.qa / "report.json").write_text(json.dumps(rep, indent=1, default=float) + "\n")
        return rep


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("spec")
    ap.add_argument("--owners", action="store_true", help="only the ownership preview (qa/owners.png)")
    a = ap.parse_args()
    c = Cut(rp(a.spec))
    c.owners_only = a.owners
    rep = c.run()
    if a.owners:
        print(rep)
        return
    print(json.dumps({k: rep[k] for k in ("reassembly", "unowned", "warnings", "tests", "parts", "preview")}, indent=1, default=float))


if __name__ == "__main__":
    main()
