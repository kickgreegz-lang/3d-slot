"""Procedural Spine mesh attachments: grid or alpha-traced (shapely), plus bone weights.

All geometry is computed in IMAGE space of the symbol canvas (x right, y down, px @2x) and
converted to skeleton space by the caller. Spine mesh rules honoured here:
  * the first `hull` vertices form the outline, in order;
  * `uvs` are 0..1 over the part image with v = 0 at the top row;
  * weighted vertices carry >= 1 bone and weights summing to 1;
  * every opaque pixel must be inside a triangle (a mesh draws nothing outside itself),
    which the tracer verifies by rasterising the triangles and retries with more padding.
Triangulation uses shapely (GEOS) Delaunay; PyPI 'triangle' is licence-denylisted.
"""
from __future__ import annotations

import math

import numpy as np
from PIL import Image, ImageDraw


class MeshError(ValueError):
    pass


def grid(bbox: tuple[float, float, float, float], cols: int, rows: int):
    """Regular grid over the part rect. Returns (points[N,2] image-space, hull_count, triangles)."""
    x0, y0, w, h = bbox
    cols, rows = max(1, int(cols)), max(1, int(rows))
    idx = {}
    pts: list[tuple[float, float]] = []

    # perimeter first (clockwise from top-left), then interior
    perim = []
    for c in range(cols + 1):
        perim.append((c, 0))
    for r in range(1, rows + 1):
        perim.append((cols, r))
    for c in range(cols - 1, -1, -1):
        perim.append((c, rows))
    for r in range(rows - 1, 0, -1):
        perim.append((0, r))
    interior = [(c, r) for r in range(1, rows) for c in range(1, cols)]
    for cr in perim + interior:
        idx[cr] = len(pts)
        pts.append((x0 + w * cr[0] / cols, y0 + h * cr[1] / rows))
    tris: list[int] = []
    for r in range(rows):
        for c in range(cols):
            a, b, cc, d = idx[(c, r)], idx[(c + 1, r)], idx[(c + 1, r + 1)], idx[(c, r + 1)]
            tris += [a, b, cc, a, cc, d]
    return np.array(pts, dtype=float), len(perim), tris


def _alpha_mask(png_path: str, threshold: int = 8) -> np.ndarray:
    im = Image.open(png_path).convert("RGBA")
    return np.asarray(im)[:, :, 3] > threshold


def _mask_polygon(mask: np.ndarray, step: int):
    """Union of per-row runs of a max-pooled mask -> largest shapely polygon (pixel units)."""
    import shapely
    from shapely.geometry import box

    h, w = mask.shape
    hs, ws = math.ceil(h / step), math.ceil(w / step)
    pad = np.zeros((hs * step, ws * step), dtype=bool)
    pad[:h, :w] = mask
    pooled = pad.reshape(hs, step, ws, step).any(axis=(1, 3))
    boxes = []
    for r in range(hs):
        row = pooled[r]
        c = 0
        while c < ws:
            if row[c]:
                s = c
                while c < ws and row[c]:
                    c += 1
                boxes.append(box(s * step, r * step, c * step, (r + 1) * step))
            else:
                c += 1
    if not boxes:
        raise MeshError("part image is fully transparent")
    u = shapely.unary_union(boxes)
    if u.geom_type == "MultiPolygon":
        u = max(u.geoms, key=lambda g: g.area)
    return u


def _resample_ring(coords: list[tuple[float, float]], spacing: float) -> list[tuple[float, float]]:
    """Evenly spaced points along a closed ring (keeps corners sharper than `spacing`)."""
    from shapely.geometry import LineString

    ring = LineString(list(coords) + [coords[0]])
    n = max(8, int(round(ring.length / spacing)))
    out = []
    for i in range(n):
        p = ring.interpolate(ring.length * i / n)
        out.append((p.x, p.y))
    return out


def _raster_cover(size: tuple[int, int], pts: np.ndarray, tris: list[int], origin: tuple[float, float]) -> np.ndarray:
    w, h = size
    im = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(im)
    ox, oy = origin
    for i in range(0, len(tris), 3):
        poly = [(pts[j][0] - ox, pts[j][1] - oy) for j in tris[i:i + 3]]
        d.polygon(poly, fill=255, outline=255)
    return np.asarray(im) > 0


def trace(png_path: str, bbox: tuple[float, float, float, float], spacing: float = 36, pad: float = 4,
          simplify: float = 2.0, step: int = 2, interior: bool = True, max_uncovered: int = 12):
    """Alpha-traced mesh: outline from the part's alpha, interior points on a grid, Delaunay,
    triangles outside the outline dropped. Returns (points image-space, hull_count, triangles)."""
    import shapely
    from shapely.geometry import MultiPoint, Point, box

    mask = _alpha_mask(png_path)
    h, w = mask.shape
    if (w, h) != (int(round(bbox[2])), int(round(bbox[3]))):
        raise MeshError(f"{png_path}: image is {w}x{h} but bbox says {bbox[2]}x{bbox[3]}")
    base = _mask_polygon(mask, step)
    frame = box(0, 0, w, h)
    last_err = None
    for attempt in range(4):
        p = pad + 3 * attempt
        poly = base.buffer(p, join_style="round").intersection(frame).simplify(simplify, preserve_topology=True)
        if poly.geom_type == "MultiPolygon":
            poly = max(poly.geoms, key=lambda g: g.area)
        ext = list(poly.exterior.coords)[:-1]
        # orient clockwise in image space (y down) for a stable hull order, start at top-most point
        if shapely.is_ccw(poly.exterior):
            ext = ext[::-1]
        hull = _resample_ring(ext, spacing)
        k = min(range(len(hull)), key=lambda i: (round(hull[i][1], 3), round(hull[i][0], 3)))
        hull = hull[k:] + hull[:k]
        inner: list[tuple[float, float]] = []
        if interior:
            shrink = poly.buffer(-spacing * 0.45)
            if not shrink.is_empty:
                ys = np.arange(spacing / 2, h, spacing)
                xs = np.arange(spacing / 2, w, spacing)
                for yy in ys:
                    for xx in xs:
                        if shrink.contains(Point(xx, yy)):
                            inner.append((float(xx), float(yy)))
        allp = hull + inner
        tri_geo = shapely.delaunay_triangles(MultiPoint(allp), tolerance=0.0)
        keyed = {(round(x, 6), round(y, 6)): i for i, (x, y) in enumerate(allp)}
        inside = poly.buffer(0.75)
        tris: list[int] = []
        for t in tri_geo.geoms:
            if not inside.contains(t.centroid):
                continue
            cs = list(t.exterior.coords)[:3]
            try:
                ids = [keyed[(round(x, 6), round(y, 6))] for x, y in cs]
            except KeyError:
                continue
            # consistent winding (clockwise in image space)
            (ax, ay), (bx, by), (cx, cy) = (allp[i] for i in ids)
            if (bx - ax) * (cy - ay) - (by - ay) * (cx - ax) < 0:
                ids = [ids[0], ids[2], ids[1]]
            tris += ids
        used = set(tris)
        if len(used) != len(allp):
            # drop unused interior points (keep hull intact)
            missing_hull = [i for i in range(len(hull)) if i not in used]
            if missing_hull:
                last_err = f"hull vertices {missing_hull[:5]} not triangulated"
                continue
            remap, pts2 = {}, []
            for i, pnt in enumerate(allp):
                if i in used:
                    remap[i] = len(pts2)
                    pts2.append(pnt)
            tris = [remap[i] for i in tris]
            allp = pts2
        pts = np.array(allp, dtype=float)
        cover = _raster_cover((w, h), pts, tris, (0, 0))
        uncovered = int((mask & ~cover).sum())
        if uncovered <= max_uncovered:
            pts[:, 0] += bbox[0]
            pts[:, 1] += bbox[1]
            return pts, len(hull), tris
        last_err = f"{uncovered} opaque px outside the mesh"
    raise MeshError(f"{png_path}: trace failed ({last_err}); use type: grid")


# ------------------------------------------------------------------------------------------
# weights
# ------------------------------------------------------------------------------------------

def _seg_dist(p, a, b) -> float:
    ax, ay = a
    bx, by = b
    px, py = p
    dx, dy = bx - ax, by - ay
    L2 = dx * dx + dy * dy
    if L2 < 1e-9:
        return math.hypot(px - ax, py - ay)
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / L2))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def smoothstep(e0: float, e1: float, x: float) -> float:
    if e1 == e0:
        return 1.0 if x >= e1 else 0.0
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def weights_vertical(pts_img: np.ndarray, stops: list[tuple[str, float]]) -> list[list[tuple[str, float]]]:
    """stops = [(bone, y_image)], blended with smoothstep between consecutive stops by y."""
    st = sorted(stops, key=lambda s: s[1])
    out = []
    for _, y in pts_img:
        if y <= st[0][1]:
            out.append([(st[0][0], 1.0)])
            continue
        if y >= st[-1][1]:
            out.append([(st[-1][0], 1.0)])
            continue
        for (b0, y0), (b1, y1) in zip(st, st[1:]):
            if y0 <= y <= y1:
                t = smoothstep(y0, y1, y)
                out.append([(b0, 1 - t), (b1, t)])
                break
    return out


def weights_idw(pts_img: np.ndarray, segs: dict[str, tuple[tuple[float, float], tuple[float, float]]],
                power: float = 2.0, max_bones: int = 4, min_weight: float = 0.02):
    """Inverse-distance weights to bone segments (origin -> tip, image space)."""
    out = []
    for p in pts_img:
        ws = []
        for name, (a, b) in segs.items():
            d = _seg_dist((float(p[0]), float(p[1])), a, b)
            ws.append((name, 1.0 / (d + 1.0) ** power))
        ws.sort(key=lambda t: (-t[1], t[0]))
        ws = ws[:max_bones]
        s = sum(w for _, w in ws)
        ws = [(n, w / s) for n, w in ws]
        ws = [(n, w) for n, w in ws if w >= min_weight] or ws[:1]
        s = sum(w for _, w in ws)
        out.append([(n, w / s) for n, w in ws])
    return out


def round_weights(ws: list[tuple[str, float]], nd: int = 4) -> list[tuple[str, float]]:
    r = [(n, round(w, nd)) for n, w in ws if round(w, nd) > 0]
    if not r:
        r = [(ws[0][0], 1.0)]
    diff = round(1.0 - sum(w for _, w in r), nd)
    if diff:
        i = max(range(len(r)), key=lambda k: r[k][1])
        r[i] = (r[i][0], round(r[i][1] + diff, nd))
    return r
