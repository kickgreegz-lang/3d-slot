#!/usr/bin/env python3
"""sym_H3 Crawfish parts (ANIMATION_SET 2.3) from the approved rig master (sym_H3_rig 0d5d1a66) and the c11 eye
variants (sym_H3_eyes_half / _closed / _wide):
  - claw_R (the raised claw, screen left; the crawfish faces its right = screen left), claw_L (the lower claw),
    tail_fan: outline-bounded regions (the colour components between the black outlines, picked by rough polygons),
    so every cut runs along a painted outline;
  - antenna_R (roots left, passes BEHIND) / antenna_L (roots between the eyes, in front where they cross): path masks
    along their centre lines; their roots continue into the head, hidden behind the body;
  - eyes: one patch region over both eyes, attachments open (master) / half / closed / wide (the c11 variants,
    registered to the master raw by ECC on the head around the eyes, keyed on their measured olive key);
  - body: the rest, with the hidden areas filled (inpainted belly / tail base under claw_L, the claw_R arm and the tail
    fan continued under the vest / claw, the antenna roots inside the head);
  - fx_glow: drawn here.
Writes art/source/spine/images/sym_H3/*.png, art/source/symbols/H3/parts.json and QA to build/qa/rigs/sym_H3/.

    tools/.venv/bin/python tools/spine/examples/bass_drop/cut/cut_H3.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
import cutlib as cl  # noqa: E402

R = cl.REPO
SRC = R / "art/source/symbols/H3"
IMG = R / "art/source/spine/images/sym_H3"
QA = R / "build/qa/rigs/sym_H3"
RAW = R / "art/_raw"
CONTENT = 288          # cellScale 0.96 x 300 (src/games/bass-drop/config.ts H3)

# ------------------------------------------------------------------ geometry (1024 master px)
# antenna centre lines, root (in the head) -> tip
ANT_R = [(392, 330), (386, 312), (378, 290), (368, 255), (362, 215), (362, 180), (368, 150), (380, 125), (400, 108),
         (430, 100), (462, 106), (490, 122), (510, 140), (525, 162), (545, 192), (568, 222), (595, 248), (625, 266),
         (652, 268), (668, 258), (677, 246)]
ANT_L = [(446, 352), (444, 330), (443, 310), (443, 270), (448, 230), (460, 190), (478, 160), (500, 138), (530, 124),
         (565, 118), (605, 122), (645, 145), (675, 175), (705, 210), (735, 245), (765, 268), (795, 280), (825, 276),
         (848, 258), (860, 235), (862, 218)]
ANT_HALF = 13.0        # half width of the stroke incl. its outline (inside the head)
ANT_REACH = 21.0       # outside the head: every opaque pixel this close to a centre line is antenna (+ sticker outline)
HEAD = [(350, 352), (370, 314), (398, 290), (440, 276), (500, 270), (562, 276), (606, 306), (626, 360), (628, 470),
        (350, 470)]
# rough regions: a colour component belongs to the part when >= 60 % of it lies inside
ROUGH_CLAW_R = [(140, 110), (350, 110), (352, 470), (362, 480), (362, 600), (150, 600)]
ROUGH_CLAW_L = [(596, 470), (700, 468), (770, 505), (822, 560), (818, 820), (620, 830), (626, 640), (596, 580)]
ROUGH_FAN = [(790, 580), (900, 580), (900, 760), (790, 760)]
# the vest's left edge (the claw_R arm passes BEHIND it): body keeps everything right of this line
VEST_L = [(372, 460), (360, 490), (354, 520), (352, 560), (350, 600)]
ARM_R_UNDER = [(350, 506), (394, 510), (394, 556), (350, 562)]         # the arm continued under the vest (hidden)
BODY_UNDER_CLAW_L = [(596, 560), (690, 575), (780, 610), (812, 650), (806, 720), (760, 770), (700, 805), (610, 805), (598, 700)]
MIRROR_X = 604.0       # the belly / thigh texture is mirrored across this line into the hidden area under claw_L
FAN_UNDER = [(760, 600), (812, 600), (812, 745), (760, 745)]              # the fan continued under the claw (hidden)
# eye patch: both eyes, big enough for the `wide` eyes, above the mouth
EYE_L = (411.0, 317.0, 31.0, 47.0)
EYE_R = (519.0, 330.0, 53.0, 50.0)
EYE_BOTTOM = 376.0
# bones (master px)
SHOULDER_R, CLAW_R_TIP = (366.0, 532.0), (214.0, 190.0)
PINCER_R, PINCER_R_TIP = (307.0, 408.0), (322.0, 216.0)
SHOULDER_L, CLAW_L_TIP = (628.0, 522.0), (742.0, 700.0)
PINCER_L, PINCER_L_TIP = (669.0, 648.0), (672.0, 805.0)
FAN_ROOT, FAN_TIP = (792.0, 668.0), (880.0, 660.0)
EYES_AT = (468.0, 330.0)


def path_mask(shape, pts, half):
    h, w = shape[:2]
    ss = 4
    im = Image.new("L", (w * ss, h * ss), 0)
    from PIL import ImageDraw
    d = ImageDraw.Draw(im)
    P = [(x * ss, y * ss) for x, y in pts]
    d.line(P, fill=255, width=int(2 * half * ss), joint="curve")
    for x, y in P:
        d.ellipse([x - half * ss, y - half * ss, x + half * ss, y + half * ss], fill=255)
    return np.asarray(im.resize((w, h), Image.BOX), dtype=np.float32) / 255.0


def region_parts(M, rough_polys, lum_thr=0.2, frac=0.6, outline=9):
    """Outline-bounded regions: interiors = connected components of the non-outline pixels; a component goes to
    the first rough polygon holding >= `frac` of it. Each part = its interiors dilated by the outline width, minus
    every other part's and every unassigned interior (so the outline between two parts is shared, never a hole)."""
    a = M[..., 3] > 0.5
    lum = M[..., :3] @ np.array([0.299, 0.587, 0.114], np.float32)
    interior = a & (lum > lum_thr)
    n, lab, st, _ = cv2.connectedComponentsWithStats(interior.astype(np.uint8), 4)
    polys = [cl.poly(M.shape, p) > 0.5 for p in rough_polys]
    owner = np.full(n, -1)
    for i in range(1, n):
        comp = lab == i
        area = st[i, 4]
        for k, pm in enumerate(polys):
            if (comp & pm).sum() >= frac * area:
                owner[i] = k
                break
    parts = []
    for k in range(len(rough_polys)):
        mine = np.isin(lab, np.nonzero(owner == k)[0])
        others = interior & ~mine
        grown = cv2.dilate(mine.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * outline + 1,) * 2)) > 0
        m = grown & a & ~others & polys[k]
        parts.append(m.astype(np.float32))
    return parts


def interior_of(M, lum_thr=0.2):
    """Non-outline pixels (colour sources for fills: an outline must never be smeared into a hidden area)."""
    lum = M[..., :3] @ np.array([0.299, 0.587, 0.114], np.float32)
    inner = (M[..., 3] > 0.5) & (lum > lum_thr)
    return cv2.erode(inner.astype(np.uint8), np.ones((5, 5), np.uint8)) > 0


def key_matte(rgb, key, lo=38.0, hi=70.0):
    d = np.sqrt(((rgb * 255 - np.array(key, np.float32)) ** 2).sum(-1))
    return np.clip((d - lo) / (hi - lo), 0, 1)


def downsample(rgba, f=0.5):
    h, w = rgba.shape[:2]
    prem = rgba.copy()
    prem[..., :3] *= prem[..., 3:4]
    ch = [np.asarray(Image.fromarray(prem[..., k], "F").resize((round(w * f), round(h * f)), Image.LANCZOS)) for k in range(4)]
    out = np.clip(np.stack(ch, -1), 0, 1)
    al = out[..., 3:4]
    out[..., :3] = np.where(al > 1e-5, out[..., :3] / np.maximum(al, 1e-5), 0)
    return out.astype(np.float32)


def eye_variants(M):
    """{state: 1024 RGBA} registered to the master raw (ECC affine on the head around the eyes)."""
    ref = np.asarray(Image.open(RAW / "sym_H3_rig/v01/raw.png").convert("RGB")).astype(np.float32) / 255
    g0 = cv2.cvtColor(ref, cv2.COLOR_RGB2GRAY)
    x0, y0, x1, y1 = 2 * 370, 2 * 270, 2 * 600, 2 * 420
    out = {}
    for n in ("half", "closed", "wide"):
        im = np.asarray(Image.open(RAW / f"sym_H3_eyes_{n}/v01/raw.png").convert("RGB")).astype(np.float32) / 255
        g1 = cv2.cvtColor(im, cv2.COLOR_RGB2GRAY)
        mask = np.zeros_like(g0, np.uint8)
        mask[y0 - 60:y1 + 60, x0 - 60:x1 + 60] = 1
        mask[2 * 298:2 * 372, 2 * 385:2 * 565] = 0
        warp = np.eye(2, 3, dtype=np.float32)
        cc, warp = cv2.findTransformECC(g0, g1, warp, cv2.MOTION_AFFINE,
                                        (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 200, 1e-6), mask, 5)
        al = cv2.warpAffine(im, warp, (ref.shape[1], ref.shape[0]), flags=cv2.INTER_CUBIC + cv2.WARP_INVERSE_MAP)
        border = np.concatenate([al[:8].reshape(-1, 3), al[-8:].reshape(-1, 3), al[:, :8].reshape(-1, 3)], 0)
        key = np.median(border, 0) * 255
        rgba = np.concatenate([al, key_matte(al, key)[..., None]], -1).astype(np.float32)
        out[n] = downsample(rgba)
        print(f"eyes {n}: ECC {cc:.4f}, shift {np.round(warp[:, 2], 2).tolist()}, key #{''.join(f'{int(v):02X}' for v in key)}")
    return out


def main() -> int:
    IMG.mkdir(parents=True, exist_ok=True)
    QA.mkdir(parents=True, exist_ok=True)
    M = cl.load(SRC / "master_rig_1024.png")
    shp = M.shape
    fit = cl.Fit.symbol(M, CONTENT)
    P = fit.pt
    A = M[..., 3]

    head = cl.poly(shp, HEAD)
    clawR_m, clawL_m, fan_m = region_parts(M, [ROUGH_CLAW_R, ROUGH_CLAW_L, ROUGH_FAN])
    # antennae: every opaque pixel above the head that is not the raised claw belongs to the nearest centre line
    # (both near the crossing); inside the head only the strokes' own paths (hidden roots)
    dR = cv2.distanceTransform((path_mask(shp, ANT_R, 1.0) < 0.5).astype(np.uint8), cv2.DIST_L2, 5)
    dL = cv2.distanceTransform((path_mask(shp, ANT_L, 1.0) < 0.5).astype(np.uint8), cv2.DIST_L2, 5)
    upper = (A > 0.02) & (head < 0.5) & (clawR_m < 0.5) & ((dR < ANT_REACH) | (dL < ANT_REACH))
    both = (dR < 18) & (dL < 18)
    antR = ((upper & ((dR <= dL) | both)) | ((head > 0.5) & (path_mask(shp, ANT_R, ANT_HALF) > 0.5))).astype(np.float32) * (A > 0.02)
    antL = ((upper & ((dL < dR) | both)) | ((head > 0.5) & (path_mask(shp, ANT_L, ANT_HALF) > 0.5))).astype(np.float32) * (A > 0.02)
    ant_out = upper.astype(np.float32)
    # the vest (body, in front of the claw_R arm): everything right of the vest's left edge stays on the body
    ys = np.array([p[1] for p in VEST_L], float)
    xs = np.array([p[0] for p in VEST_L], float)
    xb = np.interp(np.arange(shp[0]) + 0.5, ys, xs)
    right_of_vest = (np.arange(shp[1])[None, :] + 0.5 > xb[:, None]) & (np.arange(shp[0])[:, None] > 455)
    clawR_vis = clawR_m * ~right_of_vest

    # ------------------------------------------------------------------ layers
    # claw_R: visible pixels + its arm continued under the vest (inpainted, hidden at rest)
    clawR = cl.layer(M, clawR_vis)
    under = cl.poly(shp, ARM_R_UNDER) * right_of_vest
    clawR[..., 3] = np.maximum(clawR[..., 3], under)
    clawR = cl.inpaint_rgb(clawR, under, radius=12, known=(clawR_vis > 0.5) & interior_of(M) & (cl.poly(shp, [(300, 480), (360, 480), (360, 600), (300, 600)]) > 0.5))
    clawL = cl.layer(M, clawL_m)
    fan = cl.layer(M, fan_m)
    fan_under = cl.poly(shp, FAN_UNDER) * (1 - fan_m)
    fan[..., 3] = np.maximum(fan[..., 3], fan_under * (A > 0.5))
    fan = cl.inpaint_rgb(fan, fan_under, radius=10, known=(fan_m > 0.5) & interior_of(M))

    body_cov = 1 - np.maximum.reduce([clawR_vis, clawL_m, fan_m, ant_out])
    body = cl.layer(M, body_cov)
    # under claw_L: the belly / tail base, opaque and inpainted from the visible body around it
    hid = cl.poly(shp, BODY_UNDER_CLAW_L) * clawL_m
    body[..., 3] = np.maximum(body[..., 3], hid)
    orange = interior_of(M) & (M[..., 0] > M[..., 2] + 0.25) & (M[..., 0] > 0.45)          # the shell, not the vest
    near = cv2.dilate((hid > 0.5).astype(np.uint8), np.ones((61, 61), np.uint8)) > 0
    body = cl.inpaint_rgb(body, hid, radius=20, known=(body_cov > 0.5) & orange & near)
    # texture it: the belly and thigh mirrored across x = MIRROR_X (their segment lines continue under the claw),
    # darkened a little (it is the far side, in the claw's shadow), faded into the inpaint toward the region's edge
    xs_src = np.clip(2 * MIRROR_X - np.arange(shp[1]), 0, shp[1] - 1).astype(int)
    mir = M[:, xs_src]
    shell = (mir[..., 0] > mir[..., 2] + 0.2) | ((mir[..., :3] @ np.array([0.299, 0.587, 0.114], np.float32)) < 0.2)
    ok = (mir[..., 3] > 0.9) & (hid > 0.5) & cv2.erode(shell.astype(np.uint8), np.ones((9, 9), np.uint8)).astype(bool)
    edge = np.clip(cv2.distanceTransform((hid > 0.5).astype(np.uint8), cv2.DIST_L2, 5) / 18.0, 0, 1)
    w = (ok * edge * 0.85)[..., None]
    body[..., :3] = body[..., :3] * (1 - w) + mir[..., :3] * 0.82 * w

    # antennae: stroke pixels (the one behind also keeps the crossing, where the front one hides it)
    antennaR = cl.layer(M, antR)
    antennaL = cl.layer(M, antL)

    # eyes: one feathered patch region; open = the master
    eye_region = np.maximum(cl.rot_ellipse(shp, *EYE_L, 0), cl.rot_ellipse(shp, *EYE_R, 0))
    eye_region *= np.clip(EYE_BOTTOM - (np.arange(shp[0])[:, None] + 0.5), 0, 1)
    eye_region = cl.feather(eye_region, 2.5) * np.clip(cl.feather(eye_region, 0) * 1.0, 0, 1)
    variants = eye_variants(M)

    parts, canv = [], {}

    def add(name, lay, **kw):
        c = cl.despeckle(fit.canvas(lay))
        img, bbox = cl.trim(c, 3)
        cl.save(img, IMG / f"{name}.png")
        canv[name] = cl.paste((fit.H, fit.W), img, bbox)
        parts.append(dict({"name": name, "bbox": bbox}, **kw))
        return bbox

    rnd = lambda xy: [round(xy[0], 1), round(xy[1], 1)]
    gc = (180.0, 185.0)
    glow = cl.glow_disc(330, (1.0, 0.45, 0.2), alpha=0.8)
    cl.save(glow, IMG / "glow.png")
    parts.append({"name": "glow", "slot": "fx_glow", "bbox": place(glow, gc), "z": 0, "bone": "fx_glow",
                  "blend": "additive", "color": "ffffff00", "joint": list(gc)})
    add("antenna_R", antennaR, z=0.4, bone="phys_antenna_1_R")   # weighted meshes: phys_antenna_1_R..2 / _L_1..2
    add("antenna_L", antennaL, z=0.5, bone="phys_antenna_1_L")
    add("tail_fan", fan, z=0.6, bone="tail_fan")
    add("claw_R", clawR, z=0.8, bone="claw_R")              # weighted meshes: claw_R + pincer_R
    add("body", body, z=1, bone="body")
    # eyes slot: open / half / closed / wide (same region, same bbox)
    eye_open = cl.layer(M, eye_region)
    ebb = add("eyes_open", eye_open, z=2, bone="face_eyes", slot="eyes")
    for n in ("half", "closed", "wide"):
        lay = variants[n].copy()
        lay[..., 3] *= eye_region
        c = fit.canvas(lay)
        img = cl.crop(c, ebb)
        cl.save(img, IMG / f"eyes_{n}.png")
        parts.append({"name": f"eyes_{n}", "slot": "eyes", "bbox": ebb, "z": 2, "bone": "face_eyes"})
    add("claw_L", clawL, z=3, bone="claw_L")

    comment = ("sym_H3 parts (ANIMATION_SET 2.3): outline-bounded cuts of art/source/symbols/H3/master_rig_1024.png "
               "(sym_H3_rig 0d5d1a66) with hidden-area fills; eye states from the c11 variants sym_H3_eyes_half / "
               "_closed / _wide registered to the master raw; tools/spine/examples/bass_drop/cut/cut_H3.py. Canvas 360 @2x, "
               "content 288 (cellScale 0.96).")
    pj = cl.write_parts(SRC, "H3", parts, comment=comment,
                        blur=["body", "claw_L", "claw_R", "tail_fan", "antenna_L", "antenna_R", "eyes_open"])

    ref = fit.canvas(M)
    rest = [canv["antenna_R"], canv["antenna_L"], canv["tail_fan"], canv["claw_R"], canv["body"], canv["eyes_open"], canv["claw_L"]]
    met, comp = cl.reassembly(rest, ref)
    diff = np.abs(comp[..., 3] - ref[..., 3]) > 0.5
    yy, xx = np.nonzero(diff)
    if len(xx):
        print(f"alpha mismatch: {len(xx)} canvas px, x {xx.min()}..{xx.max()}, y {yy.min()}..{yy.max()}")
    def chain(pts, n):
        L = np.r_[0, np.cumsum(np.hypot(*np.diff(np.array(pts, float), axis=0).T))]
        t = np.linspace(0, L[-1], n + 1)
        return [rnd(P(np.interp(v, L, [p[0] for p in pts]), np.interp(v, L, [p[1] for p in pts]))) for v in t]
    root_R = next(i for i, p in enumerate(ANT_R) if head[int(p[1]), int(p[0])] < 0.5)
    root_L = next(i for i, p in enumerate(ANT_L) if head[int(p[1]), int(p[0])] < 0.5)
    keys = {"shoulder_R": SHOULDER_R, "claw_R_tip": CLAW_R_TIP, "pincer_R": PINCER_R, "pincer_R_tip": PINCER_R_TIP,
            "shoulder_L": SHOULDER_L, "claw_L_tip": CLAW_L_TIP, "pincer_L": PINCER_L, "pincer_L_tip": PINCER_L_TIP,
            "fan_root": FAN_ROOT, "fan_tip": FAN_TIP, "eyes": EYES_AT}
    pts = {k: rnd(P(*v)) for k, v in keys.items()}
    pts["antenna_R_chain"] = chain(ANT_R[max(0, root_R - 1):], 2)
    pts["antenna_L_chain"] = chain(ANT_L[max(0, root_L - 1):], 2)
    json.dump({"reassembly": met, "fit": {"s": fit.s, "ox": fit.ox, "oy": fit.oy}, "keypoints": pts}, open(QA / "cut.json", "w"), indent=1)
    print("keypoints (canvas):", json.dumps(pts))
    cl.preview(rest, QA / "rest.png")
    cl.preview([canv["body"]], QA / "body_alone.png")
    cl.preview([canv["claw_L"], canv["claw_R"], canv["tail_fan"]], QA / "claws_fan.png")
    cl.preview([canv["antenna_R"]], QA / "antenna_R.png")
    cl.preview([canv["antenna_L"]], QA / "antenna_L.png")
    for n in ("half", "closed", "wide"):
        cl.preview(rest[:-2] + [cl.paste((360, 360), cl.load(IMG / f"eyes_{n}.png"), ebb), canv["claw_L"]], QA / f"eyes_{n}.png")
    print(f"cut_H3: {len(parts)} parts -> {pj}; reassembly {met}")
    return 0


def place(img: np.ndarray, centre) -> list:
    h, w = img.shape[:2]
    return [int(round(centre[0] - w / 2)), int(round(centre[1] - h / 2)), w, h]


if __name__ == "__main__":
    sys.exit(main())
