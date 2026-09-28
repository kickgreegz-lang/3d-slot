#!/usr/bin/env python3
"""Bass Drop background set without generation credits (ART_PLAN 4 cut order: every row below is the plan's own
0-credit `fallback`). Inputs are the two approved plates only (bg_base_landscape = ab1 924d3637, bd_bg_base_portrait =
bd_c07 01d29fe8); every output keeps every shape where the base has it, so base <-> variant crossfades never swim.

  base_landscape.webp          2:1 centre crop of the 21:9 anchor + a calm-centre grade (the crop fails the
                               darker-centre gate by itself: the violet haze and the lit floor sit in the middle)
  base_{landscape,portrait}_neon.webp       row bd_bg_base_*_neon     fallback: procedural extraction
  jukejam_{landscape,portrait}.webp         row bd_bg_jukejam_*       fallback: colour grade + fog in code
  megamix_{landscape,portrait}.webp         row bd_bg_megamix_*       fallback: colour grade + lights in code
  {jukejam,megamix}_{landscape,portrait}_neon.webp   rows c22 (P2)     fallback: procedural extraction
  tile_landscape.webp                       row bd_bg_tile (P2)       fallback: brighten the base plate in code

Neon layers are additive (black = no change): the runtime adds them at alpha 0..1 on the beat.

  tools/.venv/bin/python tools/bdart/backgrounds.py [--qa build/qa/bdart/backgrounds]
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw

from bglib import (REPO, base_plate, blur, darker_centre, edge_iou, fbm, hsv, hue_gate, lightness, linear_to_srgb,
                   save_webp, screen, smoothstep, srgb_to_linear, to_u8, write_json)

OUT = REPO / "art/source/backgrounds/bass-drop"


# ------------------------------------------------------------------ masks
def neon_masks(a: np.ndarray) -> dict[str, np.ndarray]:
    """Emissive masks of a plate: thin bright neon tubes (teal / magenta), warm bulbs and firefly jars, white-hot
    cores. Local contrast at two scales keeps lit walls, the lit booth edges and the moonlit window out."""
    H, S, V = hsv(a)
    L = lightness(a)
    contrast = np.maximum(smoothstep(L - blur(L, 10), 0.04, 0.16), smoothstep(L - blur(L, 36), 0.08, 0.24))
    teal = hue_gate(H, 172, 22) * smoothstep(S, 0.30, 0.55) * smoothstep(V, 0.72, 0.92)
    mag = hue_gate(H, 312, 28) * smoothstep(S, 0.25, 0.45) * smoothstep(V, 0.86, 0.95)   # the booth edges stop at V 0.85
    warm = hue_gate(H, 48, 30) * smoothstep(V, 0.62, 0.90) * smoothstep(S, 0.10, 0.35)
    hot = smoothstep(V, 0.90, 1.0) * (1.0 - hue_gate(H, 215, 35))                           # not the cool moon
    out = {k: v * contrast for k, v in dict(teal=teal, mag=mag, warm=warm, hot=hot).items()}
    core = np.maximum.reduce(list(out.values()))
    out["core"] = core
    out["layer"] = np.clip(np.maximum(core, 1.6 * blur(core, 6)), 0, 1)   # + the painted halo around each light
    return out


def region_masks(a: np.ndarray, nm: dict[str, np.ndarray], orient: str) -> dict[str, np.ndarray]:
    h, w = a.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    xf, yf = xx / w, yy / h
    warm_lights = np.maximum(nm["warm"], nm["hot"] * (1 - nm["teal"]) * (1 - nm["mag"]))
    if orient == "landscape":
        jar_zone = (1 - smoothstep(xf, 0.17, 0.22)) * smoothstep(yf, 0.36, 0.42)
    else:
        jar_zone = (1 - smoothstep(xf, 0.27, 0.32)) * smoothstep(yf, 0.10, 0.13) * (1 - smoothstep(yf, 0.34, 0.38))
    jars = np.clip(blur(warm_lights * jar_zone, 3) * 1.4, 0, 1)
    bulbs = np.clip(blur(warm_lights * (1 - jar_zone), 3) * 1.4, 0, 1)
    H, S, V = hsv(a)
    L = lightness(a)
    # moonlit windows: cool blue-cyan panes brighter than their surroundings
    win = hue_gate(H, 212, 26) * smoothstep(S, 0.18, 0.35) * smoothstep(L - blur(L, 60), 0.0, 0.10) * smoothstep(V, 0.35, 0.6)
    if orient == "landscape":
        win *= smoothstep(xf, 0.12, 0.16) * (1 - smoothstep(xf, 0.52, 0.56)) * (1 - smoothstep(yf, 0.62, 0.7))
    else:
        win *= (1 - smoothstep(xf, 0.62, 0.68)) * (1 - smoothstep(yf, 0.33, 0.37))
    win = np.clip(blur(win, 4) * 1.3, 0, 1)
    return {"jars": jars, "bulbs": bulbs, "windows": win, "xf": xf, "yf": yf}


def calm_centre(a: np.ndarray, strength: float, xr: tuple[float, float], yr: tuple[float, float]) -> np.ndarray:
    """Darken the reel area (linear light), full effect inside the inner fraction, zero past the outer one."""
    h, w = a.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    gx = 1 - smoothstep(np.abs(xx / w - 0.5), xr[0], xr[1])
    gy = 1 - smoothstep(np.abs(yy / h - 0.5), yr[0], yr[1])
    f = 1 - strength * gx * gy
    return linear_to_srgb(srgb_to_linear(a) * f[..., None])


def mix3(a: np.ndarray, m: np.ndarray) -> np.ndarray:
    return np.clip(np.einsum("hwc,dc->hwd", a, np.asarray(m, np.float32)), 0, 1)


def split_tone(a: np.ndarray, shadow: tuple, high: tuple, s_amt: float, h_amt: float) -> np.ndarray:
    L = lightness(a)[..., None]
    sh = np.asarray(shadow, np.float32) / 255.0
    hi = np.asarray(high, np.float32) / 255.0
    ws = (1 - smoothstep(L, 0.05, 0.45)) * s_amt
    wh = smoothstep(L, 0.45, 0.95) * h_amt
    out = a * (1 - ws) + (a * 0.35 + sh * 0.65) * ws          # pull shadows toward the shadow hue, keep some detail
    return screen(out, hi * wh)


def brush(noise: np.ndarray, length: int, angle: float = 0.0) -> np.ndarray:
    """Directional smear so procedural fog / haze reads as brushwork, not clouds."""
    k = np.zeros((length, length), np.float32)
    c = length // 2
    dx, dy = np.cos(np.radians(angle)), np.sin(np.radians(angle))
    for t in np.linspace(-c, c, length * 2):
        x, y = int(round(c + t * dx)), int(round(c + t * dy))
        if 0 <= x < length and 0 <= y < length:
            k[y, x] = 1
    k /= k.sum()
    return cv2.filter2D(noise, -1, k, borderType=cv2.BORDER_REFLECT)


# ------------------------------------------------------------------ variants
def fog_banks(g: np.ndarray, orient: str) -> tuple[np.ndarray, np.ndarray]:
    """Clumped ground fog: 2D fbm (4:1 stretched, finer toward the back for perspective) under a floor ramp; the top of
    every clump catches the moonlight (density rising downward = a top edge)."""
    h, w = g.shape[:2]
    yy = np.mgrid[0:h, 0:w][0].astype(np.float32) / h
    y0, y1 = (0.52, 0.86) if orient == "landscape" else (0.60, 0.93)
    sc = w / 2560 if orient == "landscape" else w / 1536 * 0.8
    n_fine = fbm((h, w), seed=4111, octaves=4, base=48.0 / w, stretch=(4.0, 1.0))
    n_coarse = fbm((h, w), seed=4112, octaves=4, base=22.0 / w, stretch=(4.0, 1.0))
    t = smoothstep(yy, y0, 1.0)
    n = 0.30 * n_fine * (1 - t) + n_coarse * (1 - 0.30 * (1 - t))
    ramp = smoothstep(yy, y0, y1)
    clump = smoothstep(blur(brush(n, int(41 * sc) | 1, 0.0), 3.0 * sc), 0.28, 0.72)
    dens = ramp * (0.25 + 0.75 * clump)
    alpha = blur(dens, 4 * sc) * 0.70
    k = max(3, int(18 * sc))
    sd = blur(dens, 6 * sc)
    up = np.vstack([np.repeat(sd[:1], k, 0), sd[:-k]])            # density k px above
    hl = blur(np.clip((sd - up) * 3.0, 0, 1), 9 * sc)
    body_c = np.asarray((58, 104, 120), np.float32) / 255.0
    top_c = np.asarray((156, 214, 222), np.float32) / 255.0
    col = body_c * (1 - hl[..., None] * 0.55) + top_c * hl[..., None] * 0.55
    g = g * (1 - alpha[..., None]) + col * alpha[..., None]
    return alpha, np.clip(g, 0, 1)


def jukejam(a: np.ndarray, nm: dict, rg: dict, orient: str) -> tuple[np.ndarray, dict]:
    """After hours: cyan/teal palette, dimmed string lights, pale-cyan moonlit windows, dense low swamp fog; the
    firefly jars on the far-left shelf stay warm gold."""
    h, w = a.shape[:2]
    xf, yf = rg["xf"], rg["yf"]
    # palette toward cyan / teal, a touch darker (after hours)
    g = mix3(a, [[0.74, 0.08, 0.03], [0.05, 0.93, 0.10], [0.02, 0.10, 0.96]])
    g = linear_to_srgb(srgb_to_linear(g) * 0.86)
    g = split_tone(g, (8, 40, 58), (150, 236, 240), 0.30, 0.10)
    # dim the string lights and the stage spots toward their local surroundings
    bulbs = rg["bulbs"][..., None]
    surround = blur(g, 14)
    g = g * (1 - 0.62 * bulbs) + surround * 0.62 * bulbs
    # the jars keep their warm gold (take the original pixels back, slightly boosted)
    jars = rg["jars"][..., None]
    g = g * (1 - jars) + np.clip(a * 1.08, 0, 1) * jars
    # neon tubes of the gator sign keep their own colour (they are the pulsing layer)
    tubes = np.clip(np.maximum(nm["teal"], nm["mag"]) * 1.2, 0, 1)[..., None]
    g = g * (1 - tubes) + a * tubes
    # moonlit windows: pale cyan light in the panes + a soft bloom around them
    win = rg["windows"]
    moon = np.asarray((168, 238, 246), np.float32) / 255.0
    g = screen(g, moon * (0.42 * win + 0.20 * blur(win, 30))[..., None])
    # low swamp fog rolling across the floor: stacked banks (perspective: small and thin at the back, big at the
    # front), each with a billowing lit top edge and a denser body; brush-smeared so it reads painted
    fog_a, g = fog_banks(g, orient)
    notes = {"fogMaxAlpha": round(float(fog_a.max()), 3), "bulbDim": 0.62}
    return np.clip(g, 0, 1), notes


def megamix(a: np.ndarray, nm: dict, rg: dict, orient: str) -> tuple[np.ndarray, dict, np.ndarray]:
    """Party lights: magenta / gold palette, string lights at full brightness, hot-pink and gold spotlight beams
    sweeping down from the top corners, scattered light specks on the walls. Returns (plate, notes, lights layer)."""
    h, w = a.shape[:2]
    xf, yf = rg["xf"], rg["yf"]
    g = mix3(a, [[1.07, 0.04, 0.02], [0.02, 0.88, 0.02], [0.07, 0.00, 0.90]])
    g = split_tone(g, (46, 8, 44), (255, 206, 120), 0.28, 0.10)
    # string lights at full brightness: stronger cores + a two-radius bloom in their own warm colour
    bulbs = rg["bulbs"][..., None]
    bl = np.clip(a * bulbs * 1.25, 0, 1)
    g = screen(g, bl + 1.6 * blur(bl, 10) + 1.2 * blur(bl, 34))
    # beams: origin, direction (deg, 0 = right, 90 = down), half-angle, colour, strength
    haze = fbm((h, w), seed=5201, octaves=5, base=4.0 / w, stretch=(1.0, 2.5))
    beams = np.zeros((h, w, 3), np.float32)
    diag = float(np.hypot(w, h))
    # origins inside the 16:9 cover crop (x 5.6-94.4 % of the 2:1 plate) so the lamps and beams show in game
    specs_l = [((0.075, -0.015), 66, 5.5, (255, 63, 168), 1.0), ((0.105, -0.015), 84, 4.5, (255, 198, 41), 0.9),
               ((0.135, -0.015), 104, 5.0, (255, 63, 168), 0.7)]
    if orient == "portrait":
        specs_l = [((0.04, 0.005), 62, 6.0, (255, 63, 168), 1.0), ((0.10, 0.005), 80, 5.0, (255, 198, 41), 0.9),
                   ((0.16, 0.005), 100, 5.0, (255, 63, 168), 0.6)]
    specs = specs_l + [((1 - ox, oy), 180 - ang, ha, col, s) for (ox, oy), ang, ha, col, s in specs_l]
    X, Y = rg["xf"] * w, rg["yf"] * h
    for (ox, oy), ang, half, col, s in specs:
        dx, dy = np.cos(np.radians(ang)), np.sin(np.radians(ang))
        px, py = X - ox * w, Y - oy * h
        along = px * dx + py * dy
        across = np.abs(-px * dy + py * dx)
        width = np.maximum(along, 1) * np.tan(np.radians(half))
        prof = np.exp(-0.5 * (across / (0.55 * width)) ** 2)
        fall = np.clip(1 - along / (0.95 * diag), 0, 1) ** 1.6 * smoothstep(along, 0, 0.06 * diag)
        beams += (prof * fall * s)[..., None] * (np.asarray(col, np.float32) / 255.0)
    beams *= (0.55 + 0.45 * haze)[..., None]
    # the lamp heads at the beam origins (small hot spots with a soft glow)
    heads = np.zeros((h, w, 3), np.float32)
    for (ox, oy), ang, half, col, s in specs:
        c = np.asarray(col, np.float32) / 255.0
        cv2.circle(heads, (int(ox * w), int(max(oy, 0.004) * h)), max(3, int(0.006 * w)), (c * 0.5 + 0.5).tolist(), -1, lineType=cv2.LINE_AA)
    heads = blur(heads, 1.5) + 1.2 * blur(heads, 10) * np.asarray((1.0, 0.8, 0.9), np.float32)
    # keep the reel area calm: the beams fade out over the centre (they read above and beside the frame)
    if orient == "landscape":
        centre = (1 - smoothstep(np.abs(xf - 0.5), 0.16, 0.30)) * smoothstep(yf, 0.10, 0.22)
    else:
        centre = (1 - smoothstep(np.abs(xf - 0.5), 0.30, 0.46)) * smoothstep(yf, 0.26, 0.34) * (1 - smoothstep(yf, 0.80, 0.9))
    beams *= (1 - 0.85 * centre)[..., None]
    # light specks (mirror-ball reflections) on the walls, never in the reel area
    rng = np.random.default_rng(5202)
    specks = np.zeros((h, w, 3), np.float32)
    cols = [(255, 92, 186), (255, 214, 96), (255, 236, 250), (255, 63, 168)]
    n = 150 if orient == "landscape" else 130
    placed = 0
    img = np.zeros((h, w, 3), np.float32)
    while placed < n:
        x, y = rng.random() * w, (0.10 + 0.62 * rng.random()) * h
        if centre[int(y), int(x)] > 0.10 or (orient == "landscape" and 0.26 < x / w < 0.74):
            continue
        r = rng.uniform(3.0, 7.0) * (w / 2560 if orient == "landscape" else w / 1536 * 0.9)
        col = np.asarray(cols[rng.integers(len(cols))], np.float32) / 255.0 * rng.uniform(0.35, 0.75)
        cv2.ellipse(img, (int(x), int(y)), (max(1, int(r * 1.35)), max(1, int(r))), float(rng.uniform(0, 180)), 0, 360,
                    col.tolist(), -1, lineType=cv2.LINE_AA)
        placed += 1
    specks = blur(img, 1.6) + 0.8 * blur(img, 6)
    lights = np.clip(beams * 0.62 + specks * 0.6 + heads, 0, 1)
    g = screen(g, lights)
    notes = {"beams": len(specs), "specks": n}
    return np.clip(g, 0, 1), notes, lights


def tile(a: np.ndarray, rg: dict) -> np.ndarray:
    """Bright game-tile plate: lifted exposure, warm daylight balance, pastel neon, light edges (no dark vignette)."""
    xf, yf = rg["xf"], rg["yf"]
    lin = srgb_to_linear(mix3(a, [[1.02, 0.06, 0.00], [0.03, 0.98, 0.02], [0.00, 0.06, 0.86]]))
    lin = lin * 3.4
    g = linear_to_srgb(lin / (1 + lin * 0.35))                              # soft shoulder instead of clipping
    g = g ** 0.85
    edge = np.maximum(np.abs(xf - 0.5) * 2, np.abs(yf - 0.5) * 2)
    lift = smoothstep(edge, 0.55, 1.0)[..., None]
    pastel = np.asarray((250, 240, 255), np.float32) / 255.0
    g = g * (1 - 0.22) + pastel * 0.22
    g = g * (1 - 0.30 * lift) + pastel * 0.30 * lift
    return np.clip(g, 0, 1)


# ------------------------------------------------------------------ QA
def ingame(a: np.ndarray, orient: str, overlay: bool = True) -> Image.Image:
    """The plate as the runtime shows it (cover-fit onto the design space) with the frame / grid rects outlined."""
    img = Image.fromarray(to_u8(a))
    W, H = (1920, 1080) if orient == "landscape" else (1080, 1920)
    s = max(W / img.width, H / img.height)
    sz = (int(round(img.width * s)), int(round(img.height * s)))
    im = img.resize(sz, Image.LANCZOS)
    x0, y0 = (sz[0] - W) // 2, (sz[1] - H) // 2
    im = im.crop((x0, y0, x0 + W, y0 + H))
    if overlay:
        d = ImageDraw.Draw(im)
        rects = [(491, 72, 938, 922), (578, 149, 764, 764)] if orient == "landscape" else [(88, 520, 904, 940), (134, 584, 812, 812)]
        for (x, y, w, h), c in zip(rects, [(255, 255, 255), (255, 200, 60)]):
            d.rectangle((x, y, x + w, y + h), outline=c, width=3)
    return im


def sheet(tiles: list[tuple[str, Image.Image]], cols: int, tile_w: int) -> Image.Image:
    rows = (len(tiles) + cols - 1) // cols
    th = int(tiles[0][1].height * tile_w / tiles[0][1].width)
    out = Image.new("RGB", (cols * tile_w, rows * (th + 28)), (20, 20, 24))
    d = ImageDraw.Draw(out)
    for i, (label, im) in enumerate(tiles):
        r, c = divmod(i, cols)
        out.paste(im.resize((tile_w, th), Image.LANCZOS), (c * tile_w, r * (th + 28) + 28))
        d.text((c * tile_w + 8, r * (th + 28) + 8), label, fill=(240, 240, 240))
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--qa", default="build/qa/bdart/backgrounds")
    ap.add_argument("--provenance", action="store_true", help="append art/manifest.json rows for the outputs")
    args = ap.parse_args()
    qa = REPO / args.qa
    qa.mkdir(parents=True, exist_ok=True)
    report: dict = {"$comment": "tools/bdart/backgrounds.py: Bass Drop background set from the two approved plates (0 credits).",
                    "outputs": {}}
    for orient in ("landscape", "portrait"):
        a, info = base_plate(orient)
        raw_gate = darker_centre(a)
        if orient == "landscape":
            # the 2:1 crop of the anchor fails the gate (centre L* above the edges): calm the reel area. Full effect
            # behind the frame (inner 32 %), none past 82 %; the frame covers x 26-74 % of the 1920 screen anyway.
            base = calm_centre(a, 0.42, (0.16, 0.33), (0.36, 0.56))
        else:
            base = a
        base_gate = darker_centre(base)
        nm = neon_masks(base)
        rg = region_masks(base, nm, orient)
        outputs: dict[str, tuple[np.ndarray, dict]] = {}
        if orient == "landscape":
            outputs["base_landscape"] = (base, {"row": "bg_base_landscape", "rawGate": raw_gate,
                                                "grade": "calm centre: linear x(1 - 0.42 gx gy), gx full inside |x-0.5|<0.16, 0 past 0.33"})
        neon_base = base * nm["layer"][..., None]
        outputs[f"base_{orient}_neon"] = (neon_base, {"row": f"bd_bg_base_{orient}_neon"})
        jj, jj_notes = jukejam(base, nm, rg, orient)
        jj = calm_centre(jj, 0.18, (0.16, 0.33), (0.36, 0.56)) if orient == "landscape" else jj
        outputs[f"jukejam_{orient}"] = (jj, {"row": f"bd_bg_jukejam_{orient}", **jj_notes})
        mm, mm_notes, mm_lights = megamix(base, nm, rg, orient)
        outputs[f"megamix_{orient}"] = (mm, {"row": f"bd_bg_megamix_{orient}", **mm_notes})
        # variant neon: the base's emissive mask on the variant's own colours (aligned by construction); the Juke Jam
        # string lights are dimmed in the plate, so they pulse less; the Mega Mix beams + specks pulse with the neon
        jj_mask = np.clip(nm["layer"] - 0.55 * rg["bulbs"], 0, 1)
        outputs[f"jukejam_{orient}_neon"] = (jj * jj_mask[..., None], {"row": f"bd_bg_jukejam_{orient}_neon"})
        outputs[f"megamix_{orient}_neon"] = (np.clip(mm * nm["layer"][..., None] + 0.5 * mm_lights, 0, 1),
                                             {"row": f"bd_bg_megamix_{orient}_neon"})
        if orient == "landscape":
            outputs["tile_landscape"] = (tile(a, rg), {"row": "bd_bg_tile"})
        for name, (img, meta) in outputs.items():
            p = OUT / f"{name}.webp"
            if name.endswith("_neon"):
                Image.fromarray(to_u8(img)).save(p, "WEBP", lossless=True, quality=100, method=6)
                size = p.stat().st_size
            else:
                size = save_webp(img, p, 92)
            ent = {"path": str(p.relative_to(REPO)), "size": list(img.shape[1::-1]), "bytes": size, "source": info, **meta}
            if not name.endswith("_neon"):
                ent["darkerCentre"] = darker_centre(img)
                band = (0.14, 0.85) if orient == "landscape" else (0.30, 0.73)
                ent["darkerCentreReelBand"] = darker_centre(img, band)
                ent["meanL"] = round(float(lightness(img).mean()), 4)
                if not name.startswith("base"):
                    ent["layoutMatch"] = round(edge_iou(base, img), 4)
            else:
                ent["litFraction"] = round(float((img.max(-1) > 0.08).mean()), 4)
            report["outputs"][name] = ent
            print(f"{name:28s} {img.shape[1]}x{img.shape[0]} {size/1e6:.2f} MB",
                  {k: v for k, v in ent.items() if k in ("darkerCentre", "layoutMatch", "meanL", "litFraction")})
        # QA sheets: in-game framing with frame + grid rects, the neon pulse (plate + neon), masks
        names = [n for n in outputs if not n.endswith("_neon")]
        base_img = outputs.get(f"base_{orient}", (base, None))[0]
        tiles = [("base" if orient == "portrait" else "base (calm centre)", ingame(base_img, orient))]
        tiles += [(n, ingame(outputs[n][0], orient)) for n in names if not n.startswith("base")]
        tw = 960 if orient == "landscape" else 540
        sheet(tiles, 2 if orient == "landscape" else 4, tw).save(qa / f"{orient}_ingame.png")
        pulse = []
        for n in ("base", "jukejam", "megamix"):
            plate = base if n == "base" else outputs[f"{n}_{orient}"][0]
            neon = outputs[f"{n}_{orient}_neon"][0]
            pulse += [(f"{n} rest", ingame(plate, orient, False)), (f"{n} + neon x1 (beat)", ingame(np.clip(plate + neon, 0, 1), orient, False)),
                      (f"{n} neon layer", ingame(neon, orient, False))]
        sheet(pulse, 3, 900 if orient == "landscape" else 420).save(qa / f"{orient}_neon_pulse.png")
        Image.fromarray(to_u8(np.stack([nm["layer"], rg["bulbs"], rg["windows"]], -1))).save(qa / f"{orient}_masks.png")
        if orient == "landscape":
            sheet([("raw 2:1 crop", ingame(a, orient)), ("base (calm centre)", ingame(base, orient))], 2, 960).save(qa / "landscape_calm_centre.png")
    write_json(OUT / "backgrounds.json", report)
    write_json(qa / "report.json", report)
    if args.provenance:
        from prov import add_rows
        rows = []
        for name, ent in report["outputs"].items():
            parent = "ab_bg_painted.raw.v01" if "landscape" in name else "bd_bg_base_portrait.raw.v01"
            gate = {k: ent[k] for k in ("darkerCentre", "darkerCentreReelBand", "layoutMatch", "litFraction") if k in ent}
            rows.append({"id_prefix": f"{ent['row']}.source", "path": ent["path"], "stage": "backgrounds",
                         "parents": [parent], "script": "tools/bdart/backgrounds.py",
                         "notes": f"0-credit plan fallback for row {ent['row']} (tools/bdart/backgrounds.py '{name}'): "
                                  f"{ent['size'][0]}x{ent['size'][1]} from crop {ent['source']['crop']} of {ent['source']['raw']}; "
                                  f"gates {json.dumps(gate)}",
                         "qa": {"passed": bool(ent.get("darkerCentre", {}).get("darkerCentre", True)),
                                "report": f"{args.qa}/report.json"}})
        print("provenance rows added:", add_rows(rows))


if __name__ == "__main__":
    main()
