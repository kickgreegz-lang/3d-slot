#!/usr/bin/env python3
"""In-game art-direction contact sheets for Swamp Funk: Bass Drop (phase C review).

    tools/.venv/bin/python tools/artqa/contact_sheet.py [--out build/qa/artqa] [--rest build/qa/artqa/rest]

Composes every approved asset at its in-game size on the real painted background, in the layout rects of
src/games/bass-drop/layout.ts (LANDSCAPE / PORTRAIT + BASS_DROP_LAYOUT; numbers copied below, read-only):
  background plate (cover fit) [+ neon layer] -> meter cabinet + woofer (ui_groove_meter setup pose) ->
  lower speaker cabinet (env_speaker_stack) -> panel + tier-0 tiles -> 6x6 board -> frame (art/source/ui/bass-drop/
  frame through Frame.ts's 3-slice geometry + the code neon tube; the phase-B code frame only as a review
  comparison when its screenshot cut exists) -> mascots (Spine setup
  poses, canvas contain-fitted into their rects, feet at the rect bottom) -> logo emblem -> HUD footprints.
Symbols are fitted like src/symbols/SymbolRig.ts fit(): content max side = cellScale x cell, rotated by
restAngle, content centre on the cell centre. H1-H4 / W use the rigs' setup-pose renders (tools/artqa/
render_rest.mjs: the board sprite recommended by ART_PLAN open decision 1), royals the formula-D royals.

Outputs (<out>/): landscape_<skin>.png (base / jukejam / megamix), landscape_base_hud.png, landscape_base_neon.png,
landscape_base_phaseBframe.png (comparison), portrait_<skin>.png (+ _hud, _neon),
landscape_base_grey.png (value check), symbols_124.png (every symbol at 124 px and 64 px, colour + greyscale +
silhouette, with the pairwise silhouette IoU table), vs_reference.png (landscape next to the Dragonspire
reference, when the reference capture exists; it is never committed), metrics.json.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageOps

REPO = Path(__file__).resolve().parents[2]
SRC = REPO / "art/source"
SCRATCH_REF = Path("/tmp/claude-0/-home-user-3d-slot/b3001b79-228e-55c9-bd94-1b6f9ef3975d/scratchpad")

# src/games/bass-drop/config.ts SYMBOLS (cellScale, restAngle)
SYM = {"H1": (0.97, -6), "H2": (0.96, 0), "H3": (0.96, -14), "H4": (0.95, -12), "W": (1.02, 0),
       "L1": (0.86, 0), "L2": (0.86, 0), "L3": (0.86, 0), "L4": (0.86, 0), "L5": (0.86, 0)}
BOARD = [  # the phase-B review board (rows top to bottom)
    ["H3", "H4", "H3", "H2", "L3", "H3"],
    ["L4", "W", "L1", "L2", "H1", "H4"],
    ["H4", "L3", "H2", "L5", "L1", "H3"],
    ["H1", "L2", "H1", "H2", "H3", "L4"],
    ["H3", "L4", "H2", "L4", "W", "L3"],
    ["L1", "H2", "L1", "H4", "H3", "L2"],
]
# src/games/bass-drop/layout.ts (copied; DESIGN.md section 15 is authoritative)
LAYOUT = {
    "landscape": dict(W=1920, H=1080, cell=124, gap=4, grid=(578, 149), panel=(566, 137, 788, 788),
                      frame=(491, 72, 938, 922), logo=(1472, 40, 428, 236),
                      left=(0, 557, 434, 496), right=(1560, 430, 360, 630),
                      meter=(248, 318, 320), lower=(96, 532, 304, 320), booth=(1436, 640, 230, 300),
                      horns=[(452, 30, 116, 100), (1352, 30, 116, 100)],
                      hud=dict(spin=(1747, 800, 250), autoplay=(1770, 636, 72), turbo=(1841, 662, 72),
                               menu=(166, 712, 72), bonusBuy=(150, 846, 72), betMinus=(1529, 1009, 72),
                               betPlus=(1854, 1009, 72)),
                      text=dict(balance=(46, 1000), betValue=(1692, 1000), win=(960, 1030))),
    "portrait": dict(W=1080, H=1920, cell=132, gap=4, grid=(134, 584), panel=(122, 572, 836, 836),
                     frame=(88, 520, 904, 940), logo=(240, 40, 600, 110),
                     left=(0, 150, 400, 430), right=(680, 150, 400, 430),
                     meter=(540, 340, 300), lower=None, booth=(730, 380, 210, 140),
                     horns=[(58, 486, 92, 80), (930, 486, 92, 80)],
                     hud=dict(spin=(540, 1665, 250), autoplay=(330, 1690, 150), turbo=(750, 1690, 150),
                              menu=(950, 1650, 150), bonusBuy=(130, 1650, 150), betMinus=(715, 1856, 72),
                              betPlus=(980, 1856, 72)),
                     text=dict(balance=(40, 1834), betValue=(848, 1834), win=(540, 1500))),
}
# rig canvases @2x (ANIMATION_SET 0 / the rig.yaml files): canvas size and root (feet) inside it
CHAR = {"gumbo": dict(canvas=(868, 992), root=(434, 992)), "croak": dict(canvas=(720, 1260), root=(360, 1260))}


def load_rgba(p: Path) -> Image.Image:
    return Image.open(p).convert("RGBA")


def cover(im: Image.Image, W: int, H: int) -> Image.Image:
    k = max(W / im.width, H / im.height)
    r = im.resize((round(im.width * k), round(im.height * k)), Image.LANCZOS)
    x, y = (r.width - W) // 2, (r.height - H) // 2
    return r.crop((x, y, x + W, y + H))


def paste_scaled(dst: Image.Image, im: Image.Image, scale: float, anchor_src, anchor_dst):
    """Scale im by `scale` and paste so the source point anchor_src lands on anchor_dst."""
    r = im.resize((max(1, round(im.width * scale)), max(1, round(im.height * scale))), Image.LANCZOS)
    x = round(anchor_dst[0] - anchor_src[0] * scale)
    y = round(anchor_dst[1] - anchor_src[1] * scale)
    dst.alpha_composite(r, (x, y)) if x >= 0 and y >= 0 else _paste_any(dst, r, x, y)


def _paste_any(dst, im, x, y):
    layer = Image.new("RGBA", dst.size, (0, 0, 0, 0))
    layer.paste(im, (x, y), im)
    dst.alpha_composite(layer)


def content_bbox(im: Image.Image):
    a = np.array(im)[..., 3]
    ys, xs = np.nonzero(a > 8)
    return xs.min(), ys.min(), xs.max() + 1, ys.max() + 1


def symbol_sprite(sid: str, rest: Path) -> Image.Image:
    if sid.startswith("L"):
        return load_rgba(SRC / f"symbols/{sid}/master_1024.png")
    return load_rgba(rest / f"sym_{sid}.png")


def fit_symbol(im: Image.Image, sid: str, cell: int) -> Image.Image:
    """SymbolRig.fit(): content max side -> cellScale * cell, then restAngle (pixi: + = clockwise)."""
    cs, ang = SYM[sid]
    x0, y0, x1, y1 = content_bbox(im)
    c = im.crop((x0, y0, x1, y1))
    k = cs * cell / max(c.width, c.height)
    c = c.resize((max(1, round(c.width * k)), max(1, round(c.height * k))), Image.LANCZOS)
    if ang:
        c = c.rotate(-ang, resample=Image.BICUBIC, expand=True)
    return c


FRAME_PARTS = {"landscape": dict(post=50, beam=66, sill=65), "portrait": dict(post=34, beam=52, sill=52)}


def frame_geometry(kind: str, L: dict) -> dict:
    """src/games/swamp-funk/scene/Frame.ts geometry() + frameTube() (read-only copy)."""
    fp = FRAME_PARTS[kind]
    px, py, pw, ph = L["panel"]
    fx, fy, fw, fh = L["frame"]
    u = fp["post"] / 50
    lx = max(fx, px - fp["post"] + 2)
    rx = min(fx + fw - fp["post"], px + pw - 2)
    sill_y = fy + fh - fp["sill"]
    over = fp["post"] * 0.3
    post_top = fy + fp["beam"] - 6 * u
    post_bottom = sill_y + 6 * u
    return dict(u=u, beam=(fx, fy, fw, fp["beam"]), sill=(lx - over, sill_y, rx + fp["post"] - lx + over * 2, fp["sill"]),
                left=(lx, post_top, fp["post"], post_bottom - post_top), right=(rx, post_top, fp["post"], post_bottom - post_top),
                tube=(lx + fp["post"] + 14 * u, rx - 14 * u, fy + fp["beam"] + 5 * u, max(2, 4 * u)))


def three_slice(tex: Image.Image, r, vertical: bool) -> tuple[Image.Image, tuple[int, int]]:
    """Frame.ts prodPart: NineSliceSprite with 20% fixed ends; the texture is @2x (resolution 2)."""
    x, y, w, h = r
    if vertical:
        b = round(tex.height * 0.2)
        ends = b / 2
        W_, H_ = max(1, round(w)), max(1, round(h))
        top = tex.crop((0, 0, tex.width, b)).resize((W_, max(1, round(ends))), Image.LANCZOS)
        bot = tex.crop((0, tex.height - b, tex.width, tex.height)).resize((W_, max(1, round(ends))), Image.LANCZOS)
        mid = tex.crop((0, b, tex.width, tex.height - b)).resize((W_, max(1, H_ - 2 * round(ends))), Image.LANCZOS)
        out = Image.new("RGBA", (W_, H_), (0, 0, 0, 0))
        out.alpha_composite(top, (0, 0))
        out.alpha_composite(mid, (0, round(ends)))
        out.alpha_composite(bot, (0, H_ - round(ends)))
    else:
        b = round(tex.width * 0.2)
        ends = b / 2
        W_, H_ = max(1, round(w)), max(1, round(h))
        lft = tex.crop((0, 0, b, tex.height)).resize((max(1, round(ends)), H_), Image.LANCZOS)
        rgt = tex.crop((tex.width - b, 0, tex.width, tex.height)).resize((max(1, round(ends)), H_), Image.LANCZOS)
        mid = tex.crop((b, 0, tex.width - b, tex.height)).resize((max(1, W_ - 2 * round(ends)), H_), Image.LANCZOS)
        out = Image.new("RGBA", (W_, H_), (0, 0, 0, 0))
        out.alpha_composite(lft, (0, 0))
        out.alpha_composite(mid, (round(ends), 0))
        out.alpha_composite(rgt, (W_ - round(ends), 0))
    return out, (round(x), round(y))


def painted_frame(img: Image.Image, kind: str, L: dict, frame_dir: Path):
    g = frame_geometry(kind, L)
    post = load_rgba(frame_dir / "frame_post.png")
    for side in ("left", "right"):
        im, at = three_slice(post, g[side], True)
        _paste_any(img, im, *at)
    im, at = three_slice(load_rgba(frame_dir / "frame_sill.png"), g["sill"], False)
    _paste_any(img, im, *at)
    # the code neon tube under the beam (teal body + white core + soft halo)
    x0, x1, ty, tw = g["tube"]
    halo = Image.new("RGBA", img.size, (0, 0, 0, 0))
    hd = ImageDraw.Draw(halo)
    hd.rounded_rectangle((x0 - 20, ty - 12, x1 + 20, ty + 12), radius=12, fill=(53, 242, 224, 90))
    halo = halo.filter(__import__("PIL.ImageFilter", fromlist=["GaussianBlur"]).GaussianBlur(8))
    img.alpha_composite(halo)
    d = ImageDraw.Draw(img, "RGBA")
    d.rounded_rectangle((x0, ty - tw / 2, x1, ty + tw / 2), radius=tw / 2, fill=(53, 242, 224, 255))
    d.rounded_rectangle((x0 + 2, ty - tw * 0.2, x1 - 2, ty + tw * 0.2), radius=tw * 0.2, fill=(255, 255, 255, 215))
    im, at = three_slice(load_rgba(frame_dir / "frame_beam.png"), g["beam"], False)
    _paste_any(img, im, *at)


def draw_tiles(img: Image.Image, L: dict):
    d = ImageDraw.Draw(img, "RGBA")
    px, py, pw, ph = L["panel"]
    d.rounded_rectangle((px, py, px + pw, py + ph), radius=18, fill=(9, 39, 53, 235))
    gx, gy = L["grid"]
    c, g = L["cell"], L["gap"]
    for r in range(6):
        for q in range(6):
            x, y = gx + q * (c + g), gy + r * (c + g)
            d.rounded_rectangle((x, y, x + c, y + c), radius=14, fill=(19, 49, 73, 255), outline=(52, 56, 62, 255), width=3)


def dashed_rect(d: ImageDraw.ImageDraw, r, label, color=(255, 214, 74, 230)):
    x, y, w, h = r
    for i in range(x, x + w, 12):
        d.line((i, y, min(i + 6, x + w), y), fill=color, width=2)
        d.line((i, y + h, min(i + 6, x + w), y + h), fill=color, width=2)
    for j in range(y, y + h, 12):
        d.line((x, j, x, min(j + 6, y + h)), fill=color, width=2)
        d.line((x + w, j, x + w, min(j + 6, y + h)), fill=color, width=2)
    d.text((x + 6, y + 6), label, fill=color, font=FONT_S)


def font(size):
    for p in ["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf"]:
        if Path(p).exists():
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


FONT_S = font(15)
FONT_M = font(22)


def compose(kind: str, skin: str, rest: Path, hud: bool = False, neon: float = 0.0, stage_labels: bool = True,
            frame: str = "painted", frame_dir: Path = SRC / "ui/bass-drop/frame") -> Image.Image:
    L = LAYOUT[kind]
    W, H = L["W"], L["H"]
    orient = "landscape" if kind == "landscape" else "portrait"
    bg = load_rgba(SRC / f"backgrounds/bass-drop/{skin}_{orient}.webp")
    img = cover(bg, W, H)
    if neon > 0:
        ne = cover(load_rgba(SRC / f"backgrounds/bass-drop/{skin}_{orient}_neon.webp"), W, H)
        a = np.array(img).astype(np.float32)
        n = np.array(ne).astype(np.float32)
        a[..., :3] = np.clip(a[..., :3] + n[..., :3] * (n[..., 3:4] / 255.0) * neon, 0, 255)
        img = Image.fromarray(a.astype(np.uint8), "RGBA")
    # stage: meter (ring centre, ring outer diameter; the rig's ring is 640 units) and the lower cabinet
    mcx, mcy, mD = L["meter"]
    meter_skin = {"base": "base", "jukejam": "jukejam", "megamix": "megamix"}[skin]
    meter = load_rgba(rest / f"ui_groove_meter_{meter_skin}.png")
    paste_scaled(img, meter, mD / 640, (360, 425), (mcx, mcy))
    if L["lower"]:
        lx, ly, lw, lh = L["lower"]
        stack = load_rgba(rest / "env_speaker_stack.png")
        paste_scaled(img, stack, 0.5, (330, 672), (lx + lw / 2, ly + lh))
    draw_tiles(img, L)
    gx, gy = L["grid"]
    c, g = L["cell"], L["gap"]
    cache = {}
    for r in range(6):
        for q in range(6):
            sid = BOARD[r][q]
            if sid not in cache:
                cache[sid] = fit_symbol(symbol_sprite(sid, rest), sid, c)
            s = cache[sid]
            cx, cy = gx + q * (c + g) + c / 2, gy + r * (c + g) + c / 2
            _paste_any(img, s, round(cx - s.width / 2), round(cy - s.height / 2))
    if frame == "phaseB":
        img.alpha_composite(load_rgba(REPO / f"build/qa/artqa/phaseB_frame_{kind}.png"))
    else:
        painted_frame(img, kind, L, frame_dir)
    d = ImageDraw.Draw(img, "RGBA")
    if stage_labels:
        if L["booth"]:
            dashed_rect(d, L["booth"], "env_dj_booth\n(unmade: c12/c13)")
        for hr in L["horns"]:
            dashed_rect(d, hr, "env_horn\n(unmade)")
    # mascots: canvas contain-fitted into the rect, feet (root) on the rect bottom centre
    for side, mid in (("left", "gumbo"), ("right", "croak")):
        rx, ry, rw, rh = L[side]
        cw, ch = CHAR[mid]["canvas"]
        k = min(rw / cw, rh / ch)
        im = load_rgba(rest / f"chr_{mid}.png")
        root_in_render = (440, 905) if mid == "gumbo" else (350, 1110)
        paste_scaled(img, im, k, root_in_render, (rx + rw / 2, ry + rh))
    # logo emblem (no letters: the typeset word-mark goes on its blank banner)
    lx, ly, lw, lh = L["logo"]
    logo = load_rgba(SRC / "ui/bass-drop/logo/logo_emblem.png")
    x0, y0, x1, y1 = content_bbox(logo)
    logo = logo.crop((x0, y0, x1, y1))
    k = min(lw / logo.width, lh / logo.height)
    logo = logo.resize((round(logo.width * k), round(logo.height * k)), Image.LANCZOS)
    img.alpha_composite(logo, (round(lx + (lw - logo.width) / 2), round(ly + (lh - logo.height) / 2)))
    if hud:
        d = ImageDraw.Draw(img, "RGBA")
        for name, (x, y, s) in L["hud"].items():
            d.ellipse((x - s / 2, y - s / 2, x + s / 2, y + s / 2), fill=(20, 10, 40, 110), outline=(255, 255, 255, 200), width=3)
            d.text((x - s / 2 + 4, y - 8), name, fill=(255, 255, 255, 230), font=FONT_S)
        for name, (x, y) in L["text"].items():
            d.rectangle((x - (0 if name == "balance" else 90), y - 26, x + (230 if name == "balance" else 90), y + 26), outline=(255, 255, 255, 170), width=2)
            d.text((x - (0 if name == "balance" else 86), y - 8), name, fill=(255, 255, 255, 220), font=FONT_S)
    return img


def symbols_strip(rest: Path, out: Path) -> dict:
    ids = ["H1", "H2", "H3", "H4", "W", "L1", "L2", "L3", "L4", "L5"]
    cell = 124
    fitted = {s: fit_symbol(symbol_sprite(s, rest), s, cell) for s in ids}
    pad = 12
    Wd = len(ids) * (cell + pad) + pad
    rows = 5
    sheet = Image.new("RGBA", (Wd, rows * (cell + pad) + pad + 30), (25, 18, 40, 255))
    d = ImageDraw.Draw(sheet)
    bg = cover(load_rgba(SRC / "backgrounds/bass-drop/base_landscape.webp"), 1920, 1080).crop((800, 400, 800 + Wd, 400 + cell + 2 * pad))
    sheet.alpha_composite(bg, (0, 0))
    sil = {}
    for i, s in enumerate(ids):
        f = fitted[s]
        x = pad + i * (cell + pad)
        cx, cy = x + cell / 2, pad + cell / 2
        tile = Image.new("RGBA", (cell, cell), (19, 49, 73, 255))
        _paste_any(sheet, tile, x, pad)
        _paste_any(sheet, f, round(cx - f.width / 2), round(cy - f.height / 2))
        # greyscale on tile
        y2 = pad + (cell + pad)
        g = Image.new("RGBA", (cell, cell), (19, 49, 73, 255))
        g.alpha_composite(f, ((cell - f.width) // 2, (cell - f.height) // 2)) if f.width <= cell and f.height <= cell else _paste_any(g, f, (cell - f.width) // 2, (cell - f.height) // 2)
        g = ImageOps.grayscale(g.convert("RGB")).convert("RGBA")
        sheet.alpha_composite(g, (x, y2))
        # silhouette
        y3 = pad + 2 * (cell + pad)
        a = np.zeros((cell, cell), np.uint8)
        fa = np.array(f)[..., 3]
        ox, oy = (cell - f.width) // 2, (cell - f.height) // 2
        xs0, ys0 = max(0, -ox), max(0, -oy)
        xs1, ys1 = min(f.width, cell - ox), min(f.height, cell - oy)
        a[oy + ys0:oy + ys1, ox + xs0:ox + xs1] = fa[ys0:ys1, xs0:xs1]
        sil[s] = a > 128
        sheet.alpha_composite(Image.fromarray(np.dstack([np.full_like(a, 235)] * 3 + [np.full_like(a, 255)]), "RGBA"), (x, y3))
        sheet.alpha_composite(Image.fromarray(np.dstack([np.zeros_like(a)] * 3 + [a]), "RGBA"), (x, y3))
        # 64 px
        y4 = pad + 3 * (cell + pad)
        k = 64 / cell
        f64 = f.resize((max(1, round(f.width * k)), max(1, round(f.height * k))), Image.LANCZOS)
        t64 = Image.new("RGBA", (64, 64), (19, 49, 73, 255))
        _paste_any(t64, f64, (64 - f64.width) // 2, (64 - f64.height) // 2)
        sheet.alpha_composite(t64, (x + 30, y4 + 30))
        d.text((x + 4, rows * (cell + pad) + pad + 4), s, fill=(255, 255, 255), font=FONT_M)
    # pairwise silhouette IoU (best over +-8 px shifts, as ART_BIBLE's silhouette-confusion gate < 0.85)
    iou = {}
    for i, a in enumerate(ids):
        for b in ids[i + 1:]:
            best = 0.0
            for dx in range(-8, 9, 4):
                for dy in range(-8, 9, 4):
                    B = np.roll(np.roll(sil[b], dy, 0), dx, 1)
                    inter = (sil[a] & B).sum()
                    uni = (sil[a] | B).sum()
                    best = max(best, inter / max(1, uni))
            iou[f"{a}-{b}"] = round(float(best), 3)
    # value contrast of each symbol against the tier-0 tile (mean luminance of its opaque pixels vs the tile)
    lum = {}
    for s in ids:
        f = np.array(fitted[s]).astype(np.float32)
        m = f[..., 3] > 200
        Y = (0.2126 * f[..., 0] + 0.7152 * f[..., 1] + 0.0722 * f[..., 2])[m]
        lum[s] = {"mean": round(float(Y.mean()), 1), "p10": round(float(np.percentile(Y, 10)), 1), "p90": round(float(np.percentile(Y, 90)), 1)}
    sheet.convert("RGB").save(out)
    return {"silhouetteIoU": iou, "maxIoU": max(iou.items(), key=lambda kv: kv[1]), "luminance": lum, "tileLuminance": round(0.2126 * 19 + 0.7152 * 49 + 0.0722 * 73, 1)}


def reel_band_stats(img: Image.Image, L: dict) -> dict:
    """Background calm behind the reels: mean L*, detail (Laplacian energy) in the panel vs the side columns."""
    a = cv2.cvtColor(np.array(img.convert("RGB")), cv2.COLOR_RGB2LAB).astype(np.float32)
    Lc = a[..., 0] / 255.0
    lap = np.abs(cv2.Laplacian(cv2.GaussianBlur(Lc, (0, 0), 1.0), cv2.CV_32F))
    px, py, pw, ph = L["panel"]
    inside = (slice(py, py + ph), slice(px, px + pw))
    left = (slice(py, py + ph), slice(0, px))
    right = (slice(py, py + ph), slice(px + pw, L["W"]))
    f = lambda s: (round(float(Lc[s].mean()), 3), round(float(lap[s].mean() * 1000), 2))
    return {"panel": f(inside), "left": f(left), "right": f(right)}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(REPO / "build/qa/artqa"))
    ap.add_argument("--rest", default=str(REPO / "build/qa/artqa/rest"))
    ap.add_argument("--frame-dir", default=str(SRC / "ui/bass-drop/frame"))
    a = ap.parse_args()
    out, rest = Path(a.out), Path(a.rest)
    out.mkdir(parents=True, exist_ok=True)
    metrics = {}
    for kind in ("landscape", "portrait"):
        for skin in ("base", "jukejam", "megamix"):
            im = compose(kind, skin, rest, frame_dir=Path(a.frame_dir))
            im.convert("RGB").save(out / f"{kind}_{skin}.png")
            if skin == "base":
                metrics[f"{kind}_bg_only"] = reel_band_stats(cover(load_rgba(SRC / f"backgrounds/bass-drop/base_{kind}.webp"), LAYOUT[kind]["W"], LAYOUT[kind]["H"]), LAYOUT[kind])
                compose(kind, skin, rest, hud=True, frame_dir=Path(a.frame_dir)).convert("RGB").save(out / f"{kind}_base_hud.png")
                compose(kind, skin, rest, neon=0.8, frame_dir=Path(a.frame_dir)).convert("RGB").save(out / f"{kind}_base_neon.png")
                if kind == "landscape" and (REPO / "build/qa/artqa/phaseB_frame_landscape.png").exists():  # review-only cut of a phase-B screenshot
                    compose(kind, skin, rest, frame="phaseB").convert("RGB").save(out / f"{kind}_base_phaseBframe.png")
                ImageOps.grayscale(im.convert("RGB")).save(out / f"{kind}_base_grey.png")
    metrics["symbols"] = symbols_strip(rest, out / "symbols_124.png")
    ref = SCRATCH_REF / "ref_dragon_2.png"
    if ref.exists():
        lnd = Image.open(out / "landscape_base.png").convert("RGB")
        r = Image.open(ref).convert("RGB")
        r = r.resize((round(r.width * 1080 / r.height), 1080), Image.LANCZOS)
        both = Image.new("RGB", (lnd.width + r.width + 20, 1080), (0, 0, 0))
        both.paste(lnd, (0, 0))
        both.paste(r, (lnd.width + 20, 0))
        both.resize((both.width // 2, 540), Image.LANCZOS).save(out / "vs_reference.png")
    (out / "metrics.json").write_text(json.dumps(metrics, indent=1) + "\n")
    print(json.dumps(metrics, indent=1)[:3000])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
