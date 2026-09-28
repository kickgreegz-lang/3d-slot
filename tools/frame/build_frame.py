#!/usr/bin/env python3
"""Bass Drop reel frame pieces in the formula-D finish, 0 credits (the frame rows c12/c13 are unfunded; their plan
fallback 'keep the phase-B code frame' leaves a flat-cel frame around formula-D art, the worst cohesion break in the
in-game contact sheet). Painted procedurally so the runtime's production path can use them as they are:

    tools/.venv/bin/python tools/frame/build_frame.py [--out art/source/ui/bass-drop/frame] [--provenance]

Outputs (@2x of the landscape design size, straight-alpha RGBA PNG), consumed by the existing Frame module
(src/games/swamp-funk/scene/Frame.ts prodPart: env keys frame_beam / frame_post / frame_sill, 3-slice with
20% fixed ends, the middle stretched):
  frame_beam.png  1876 x 132  (938 x 66 design px)   horizontal plank + underside, bolts over the posts
  frame_post.png   100 x 1606 (50 x 803)             vertical plank, brass straps with bolts at both ends
  frame_sill.png  1828 x 130  (914 x 65)             lit ledge + face, bolts under the posts
Finish (STYLE_DECISION formula D + ART_PLAN §1): warm stained cypress (it keeps the Swamp Funk frame's wood identity,
richer and darker so it sits in the painted juke joint), painterly grain, key light upper left with a warm bounce
and a thin cool rim, a clean single-weight near-black outline, thinner dark interior lines (plank seams, the
beam's underside edge), polished gold bolts like the cabinets' screws. Nothing glows (the neon tube is code).
Deterministic (seeded noise).
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

REPO = Path(__file__).resolve().parents[2]
INK = np.array([20, 10, 18], np.float32) / 255
WOOD_DARK = np.array([60, 31, 22], np.float32) / 255
WOOD_MID = np.array([140, 84, 46], np.float32) / 255
WOOD_LIGHT = np.array([214, 152, 92], np.float32) / 255
PLUM_SHADE = np.array([58, 30, 44], np.float32) / 255
COOL_RIM = np.array([150, 205, 255], np.float32) / 255
GOLD_D = np.array([120, 70, 12], np.float32) / 255
GOLD_M = np.array([222, 160, 44], np.float32) / 255
GOLD_L = np.array([255, 232, 150], np.float32) / 255
BRASS_M = np.array([176, 122, 48], np.float32) / 255
L = np.array([-0.55, -0.62, 0.56], np.float32)
L /= np.linalg.norm(L)
HV = L + np.array([0, 0, 1], np.float32)
HV /= np.linalg.norm(HV)


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def noise(shape, sx, sy, seed):
    """Smooth value noise with anisotropic cell size (sx along x, sy along y), zero mean, unit std."""
    rng = np.random.default_rng(seed)
    h, w = shape
    gh, gw = int(h / sy) + 4, int(w / sx) + 4
    g = rng.standard_normal((gh, gw)).astype(np.float32)
    n = cv2.resize(g, (int(gw * sx), int(gh * sy)), interpolation=cv2.INTER_CUBIC)
    n = n[int(sy):int(sy) + h, int(sx):int(sx) + w]
    return (n - n.mean()) / (n.std() + 1e-6)


def rounded_mask(h, w, box, r):
    """Anti-aliased rounded rectangle coverage (4x supersampled) for box=(x0, y0, x1, y1)."""
    ss = 4
    m = np.zeros((h * ss, w * ss), np.uint8)
    x0, y0, x1, y1 = [int(round(v * ss)) for v in box]
    rr = int(r * ss)
    cv2.rectangle(m, (x0 + rr, y0), (x1 - rr, y1), 255, -1)
    cv2.rectangle(m, (x0, y0 + rr), (x1, y1 - rr), 255, -1)
    for cx, cy in ((x0 + rr, y0 + rr), (x1 - rr, y0 + rr), (x0 + rr, y1 - rr), (x1 - rr, y1 - rr)):
        cv2.circle(m, (cx, cy), rr, 255, -1)
    return cv2.resize(m, (w, h), interpolation=cv2.INTER_AREA).astype(np.float32) / 255


def bevel_normals(mask, bevel, blur=1.2):
    inside = (mask > 0.5).astype(np.uint8)
    d = cv2.distanceTransform(inside, cv2.DIST_L2, cv2.DIST_MASK_PRECISE) + (mask - 0.5)
    t = np.clip(d / bevel, 0, 1)
    hgt = cv2.GaussianBlur(np.sqrt(1 - (1 - t) ** 2), (0, 0), blur)
    gy, gx = np.gradient(hgt * bevel * 0.8)
    n = np.dstack([-gx, -gy, np.ones_like(gx)])
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    return n, d


def wood_albedo(h, w, seed, along_x=True, period=15.0):
    """Painterly cypress grain: wavy ring lines + long streaks + a warm/cool value drift."""
    if not along_x:
        return wood_albedo(w, h, seed, True, period).transpose(1, 0, 2)
    v = np.arange(h, dtype=np.float32)[:, None] * np.ones((1, w), np.float32)
    warp = 2.2 * noise((h, w), 520, 70, seed) + 0.55 * noise((h, w), 140, 22, seed + 1)
    f = v / period + warp
    ring = np.exp(-(((f % 1.0) - 0.5) / 0.09) ** 2)  # thin dark growth lines
    streak = noise((h, w), 900, 9, seed + 2) * 0.5 + noise((h, w), 260, 4, seed + 3) * 0.25
    val = 0.55 + 0.16 * streak - 0.22 * ring
    val += 0.06 * noise((h, w), 60, 60, seed + 4)  # painterly blotches
    val = np.clip(val, 0, 1)
    lo = np.clip((0.55 - val) / 0.55, 0, 1)[..., None]
    hi = np.clip((val - 0.55) / 0.45, 0, 1)[..., None]
    col = WOOD_MID * (1 - lo - hi) + WOOD_DARK * lo + WOOD_LIGHT * hi
    return col


def light(col, n, d, bevel, spec_k=0.25, rim_k=0.35, bounce_k=0.12):
    diff = np.clip((n * L).sum(2), 0, 1)
    shade = 0.58 + 0.62 * diff
    out = col * shade[..., None]
    # thin cool rim where the bevel faces lower right, warm bounce low
    rim = np.clip((n * np.array([0.6, 0.75, 0.0], np.float32)).sum(2) * 2.4, 0, 1) * (1 - smoothstep(0, bevel * 0.45, d))
    out = out * (1 - rim_k * rim[..., None]) + COOL_RIM * (rim_k * rim)[..., None]
    nh = np.clip((n * HV).sum(2), 0, 1)
    out = out + (spec_k * nh ** 30)[..., None]
    return np.clip(out, 0, 1)


def outline_alpha(mask, width):
    inside = (mask > 0.5).astype(np.uint8)
    d_out = cv2.distanceTransform(1 - inside, cv2.DIST_L2, cv2.DIST_MASK_PRECISE)
    return np.maximum(np.clip(width + 0.5 - d_out, 0, 1) * (1 - inside), mask)


def bolt(canvas, alpha, cx, cy, r, slot_deg=30, brass=False):
    """Polished gold dome bolt with a slot and a black ring outline, painted into canvas/alpha in place."""
    h, w, _ = canvas.shape
    x0, x1 = int(max(0, cx - r - 4)), int(min(w, cx + r + 5))
    y0, y1 = int(max(0, cy - r - 4)), int(min(h, cy + r + 5))
    yy, xx = np.mgrid[y0:y1, x0:x1].astype(np.float32)
    dx, dy = (xx - cx) / r, (yy - cy) / r
    rr = np.sqrt(dx * dx + dy * dy)
    cov = np.clip((1 - rr) * r + 0.5, 0, 1)
    ring = np.clip((1 + 3.2 / r - rr) * r + 0.5, 0, 1)
    nz = np.sqrt(np.clip(1 - rr * rr, 0, 1))
    n = np.dstack([dx, dy, nz])
    diff = np.clip((n * L).sum(2), 0, 1)
    spec = np.clip((n * HV).sum(2), 0, 1) ** 40
    base = BRASS_M if brass else GOLD_M
    col = GOLD_D * (1 - diff[..., None]) + base * diff[..., None]
    col = col + (GOLD_L - col) * (diff[..., None] ** 3) * 0.6 + spec[..., None] * 0.9
    # slot
    a = np.deg2rad(slot_deg)
    dist = np.abs(-np.sin(a) * dx + np.cos(a) * dy) * r
    slot = np.clip(2.2 - dist, 0, 1) * (rr < 0.78)
    col = col * (1 - 0.8 * slot[..., None]) + INK * (0.8 * slot)[..., None]
    col = np.clip(col, 0, 1)
    reg = canvas[y0:y1, x0:x1]
    reg[:] = reg * (1 - ring[..., None]) + INK * ring[..., None]
    reg[:] = reg * (1 - cov[..., None]) + col * cov[..., None]
    alpha[y0:y1, x0:x1] = np.maximum(alpha[y0:y1, x0:x1], ring)


def seam(canvas, mask, x, y0, y1, width=3.0, wob=0.8, seed=0):
    """A thin dark interior line (plank seam) across a horizontal plank at x, from y0 to y1."""
    h, w, _ = canvas.shape
    rng = np.random.default_rng(seed)
    ys = np.arange(int(y0), int(y1))
    xs = x + wob * np.sin(ys / 7.0 + rng.random() * 6)
    for y, xx in zip(ys, xs):
        xa = np.arange(int(xx - width - 2), int(xx + width + 3))
        xa = xa[(xa >= 0) & (xa < w)]
        cov = np.clip(width / 2 + 0.5 - np.abs(xa - xx), 0, 1) * mask[y, xa]
        canvas[y, xa] = canvas[y, xa] * (1 - cov[:, None]) + INK * cov[:, None]
        # lit lip on the left of the seam, shadow on the right
        for off, k in ((-width, 0.18), (width, -0.18)):
            xb = np.clip((xa + off).astype(int), 0, w - 1)
            canvas[y, xb] = np.clip(canvas[y, xb] * (1 + k * mask[y, xb][:, None]), 0, 1)


def hline(canvas, mask, y, width=3.0):
    h, w, _ = canvas.shape
    yy = np.arange(h, dtype=np.float32)[:, None]
    cov = np.clip(width / 2 + 0.5 - np.abs(yy - y), 0, 1) * mask
    canvas[:] = canvas * (1 - cov[..., None]) + INK * cov[..., None]


def build_beam(W=1876, H=132, seed=51, posts=(104, 1772)):
    ol = 6
    face_h = H * 0.74
    canvas = np.zeros((H, W, 3), np.float32)
    # underside (in shadow, plum-tinted) then the face plank
    under = rounded_mask(H, W, (ol + 4, face_h - 10, W - ol - 5, H - ol - 1), 8)
    face = rounded_mask(H, W, (ol, ol, W - ol - 1, face_h), 12)
    n_u, d_u = bevel_normals(under, 7)
    wa = wood_albedo(H, W, seed + 10, True, 12)
    cu = light(wa * 0.55 + PLUM_SHADE * 0.45, n_u, d_u, 7, spec_k=0.08)
    cu *= (0.55 + 0.25 * smoothstep(H, face_h, np.arange(H, dtype=np.float32))[:, None, None])
    canvas = cu * under[..., None]
    n_f, d_f = bevel_normals(face, 14)
    wf = wood_albedo(H, W, seed, True, 15)
    yy = np.arange(H, dtype=np.float32)[:, None, None]
    wf = wf * (1.08 - 0.22 * smoothstep(ol, face_h, yy))  # key light from above: the face darkens downward
    cf = light(wf, n_f, d_f, 14)
    canvas = canvas * (1 - face[..., None]) + cf * face[..., None]
    shape = np.maximum(under, face)
    for t, s in ((0.3, 1), (0.68, 2)):
        seam(canvas, face, W * t, ol + 2, face_h - 2, width=3.2, seed=seed + s)
    hline(canvas, under * (1 - face) + face * 0, face_h + 1, 2.6)
    alpha = outline_alpha(shape, ol)
    canvas = canvas * shape[..., None] + INK * (1 - shape[..., None])
    for px in posts:
        bolt(canvas, alpha, px, face_h * 0.52, 10.5, slot_deg=25)
    for t in (0.3, 0.68):
        bolt(canvas, alpha, W * t - 20, face_h * 0.3, 8, slot_deg=-35)
        bolt(canvas, alpha, W * t + 22, face_h * 0.72, 8, slot_deg=60)
    return canvas, alpha


def build_post(W=100, H=1606, seed=11):
    ol = 6
    canvas = np.zeros((H, W, 3), np.float32)
    shape = rounded_mask(H, W, (ol, ol, W - ol - 1, H - ol - 1), 10)
    n, d = bevel_normals(shape, 13)
    wa = wood_albedo(H, W, seed, False, 13)
    xx = np.arange(W, dtype=np.float32)[None, :, None]
    wa = wa * (1.1 - 0.25 * smoothstep(ol, W - ol, xx))  # lit from the left
    canvas = light(wa, n, d, 13) * shape[..., None]
    alpha = outline_alpha(shape, ol)
    canvas = canvas * shape[..., None] + INK * (1 - shape[..., None])
    # brass straps under the beam and above the sill (inside the 20% fixed ends), bolted
    for yc in (70, H - 70):
        band = rounded_mask(H, W, (ol - 2, yc - 26, W - ol + 1, yc + 26), 6)
        nb, db = bevel_normals(band, 8)
        bcol = BRASS_M * 0.85 + noise((H, W), 30, 8, seed + yc)[..., None] * 0.03
        cb = light(np.broadcast_to(bcol, (H, W, 3)).copy(), nb, db, 8, spec_k=0.55, rim_k=0.25)
        edge = outline_alpha(band, 3.0) - band
        canvas = canvas * (1 - band[..., None]) + cb * band[..., None]
        canvas = canvas * (1 - edge[..., None]) + INK * edge[..., None]
        alpha = np.maximum(alpha, np.maximum(band, edge))
        bolt(canvas, alpha, W / 2, yc, 9, slot_deg=40, brass=False)
    return canvas, alpha


def build_sill(W=1828, H=130, seed=37, posts=(80, 1748)):
    ol = 6
    ledge_h = H * 0.3
    canvas = np.zeros((H, W, 3), np.float32)
    face = rounded_mask(H, W, (ol + 6, ledge_h - 8, W - ol - 7, H - ol - 1), 10)
    ledge = rounded_mask(H, W, (ol, ol, W - ol - 1, ledge_h + 4), 10)
    n_f, d_f = bevel_normals(face, 13)
    wf = wood_albedo(H, W, seed, True, 16)
    yy = np.arange(H, dtype=np.float32)[:, None, None]
    wf = wf * (0.98 - 0.25 * smoothstep(ledge_h, H, yy))
    canvas = light(wf, n_f, d_f, 13) * face[..., None]
    n_l, d_l = bevel_normals(ledge, 9)
    wl = wood_albedo(H, W, seed + 5, True, 9) * 1.18  # the top of the ledge catches the key light
    cl = light(np.clip(wl, 0, 1), n_l, d_l, 9, spec_k=0.35)
    canvas = canvas * (1 - ledge[..., None]) + cl * ledge[..., None]
    shape = np.maximum(face, ledge)
    hline(canvas, face * (1 - ledge), ledge_h + 5, 2.6)
    for t, s in ((0.34, 3), (0.71, 4)):
        seam(canvas, face * (1 - ledge), W * t, ledge_h + 6, H - ol - 2, width=3.0, seed=seed + s)
    alpha = outline_alpha(shape, ol)
    canvas = canvas * shape[..., None] + INK * (1 - shape[..., None])
    for px in posts:
        bolt(canvas, alpha, px, (ledge_h + H) / 2 + 4, 10.5, slot_deg=-20)
    return canvas, alpha


def save(canvas, alpha, path: Path):
    rgba = np.dstack([np.clip(canvas, 0, 1), np.clip(alpha, 0, 1)])
    Image.fromarray((rgba * 255 + 0.5).astype(np.uint8), "RGBA").save(path, optimize=True)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(REPO / "art/source/ui/bass-drop/frame"))
    ap.add_argument("--provenance", action="store_true")
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    written = []
    for name, fn in (("frame_beam", build_beam), ("frame_post", build_post), ("frame_sill", build_sill)):
        c, al = fn()
        p = out / f"{name}.png"
        save(c, al, p)
        written.append(p)
        print(f"build_frame: {p} {Image.open(p).size} {p.stat().st_size // 1024} KB")
    if a.provenance:
        sys.path.insert(0, str(REPO / "tools/gen"))
        import provenance as P
        rows = []
        for p in written:
            sha = P.sha256_file(p)
            rows.append(P.make_row(
                id=P.safe_id(f"bd_{p.stem}.code.{sha[:8]}"), path=p, stage="vector-ui", sha256=sha, vendor="self",
                model="tools/frame/build_frame.py", version="phase-c", license_id="owned-code", route="code",
                notes=f"{p.stem}: procedural formula-D cypress frame piece (env key {p.stem}, 3-slice with 20% ends); "
                      "0 credits; stand-in for the unfunded c12/c13 frame rows"))
        print(f"build_frame: {P.append_rows(P.MANIFEST, rows, generated_by='tools/frame')} manifest rows appended")
    return 0


if __name__ == "__main__":
    sys.exit(main())
