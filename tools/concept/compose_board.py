"""Compose a 1920x1080 board mockup from separately generated parts (symbol sheet, empty frame, background plate).

The layout rules come from the measured reference (docs/games/concept-tumble-multipliers/STYLE.md): dark well,
exact 7x5 grid, premiums on tiles at ~92% of a cell, frameless lows at ~72%, oversized scatter, coin-size
multipliers with live numerals, flat matte spot tiles under some cells, soft-focus background, empty HUD band.

usage: tools/.venv/bin/python tools/concept/compose_board.py SYMBOLS.png FRAME.png BG.png OUT_DIR
(SYMBOLS = a 4x3 transparent sprite sheet: P1-P4 framed premiums, L1-L5 frameless lows, S scatter, M1-M2 blank dishes)
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 1920, 1080
HUD = 134
FONT = '/usr/share/fonts/opentype/inter/Inter-ExtraBold.otf'


def alpha_bbox(a, thr=24):
    ys, xs = np.nonzero(a > thr)
    if len(xs) == 0:
        return None
    return xs.min(), ys.min(), xs.max() + 1, ys.max() + 1


def slice_sheet(sheet, cols, rows):
    """Cut the sheet into cols x rows cells and crop each to its own content."""
    arr = np.asarray(sheet)
    a = arr[..., 3]
    ch, cw = sheet.height / rows, sheet.width / cols
    out = []
    for r in range(rows):
        for c in range(cols):
            x0, y0, x1, y1 = int(c * cw), int(r * ch), int((c + 1) * cw), int((r + 1) * ch)
            bb = alpha_bbox(a[y0:y1, x0:x1])
            if bb is None:
                out.append(None)
                continue
            bx0, by0, bx1, by1 = bb
            out.append(sheet.crop((x0 + bx0, y0 + by0, x0 + bx1, y0 + by1)))
    return out


def fit(img, box_w, box_h):
    s = min(box_w / img.width, box_h / img.height)
    return img.resize((max(1, round(img.width * s)), max(1, round(img.height * s))), Image.LANCZOS)


def frame_opening(frame):
    """The transparent opening inside the frame: walk out from a point inside it until alpha turns opaque."""
    a = np.asarray(frame)[..., 3]
    fb = alpha_bbox(a)
    fx0, fy0, fx1, fy1 = fb
    cx = (fx0 + fx1) // 2
    # the frame is top-heavy: probe a little below its vertical centre, at the first transparent row
    best = None
    for frac in (0.55, 0.6, 0.5, 0.65, 0.45):
        cy = int(fy0 + (fy1 - fy0) * frac)
        if a[cy, cx] > 40:
            continue
        l = cx
        while l > fx0 and a[cy, l] <= 40:
            l -= 1
        r = cx
        while r < fx1 - 1 and a[cy, r] <= 40:
            r += 1
        t = cy
        while t > fy0 and a[t, cx] <= 40:
            t -= 1
        b = cy
        while b < fy1 - 1 and a[b, cx] <= 40:
            b += 1
        best = (l + 1, t + 1, r, b)
        break
    return fb, best


def stretch_to_ratio(frame, opening, ratio=7 / 5, keep=0.3):
    """9-slice style: stretch only the middle band of the side posts (between the corner flourishes) so the opening
    reaches width/height = ratio. Crown, corners and sill keep their proportions."""
    ox0, oy0, ox1, oy1 = opening
    ow, oh = ox1 - ox0, oy1 - oy0
    want_h = ow / ratio
    if want_h <= oh:
        return frame, opening
    ya, yb = int(oy0 + keep * oh), int(oy1 - keep * oh)
    band = frame.crop((0, ya, frame.width, yb))
    new_band_h = int(round((yb - ya) + (want_h - oh)))
    band = band.resize((frame.width, new_band_h), Image.LANCZOS)
    out = Image.new('RGBA', (frame.width, frame.height + new_band_h - (yb - ya)), (0, 0, 0, 0))
    out.alpha_composite(frame.crop((0, 0, frame.width, ya)), (0, 0))
    out.alpha_composite(band, (0, ya))
    out.alpha_composite(frame.crop((0, yb, frame.width, frame.height)), (0, ya + new_band_h))
    return out, (ox0, oy0, ox1, oy1 + new_band_h - (yb - ya))


def rounded(draw, box, radius, **kw):
    draw.rounded_rectangle(box, radius=radius, **kw)


def main(argv):
    sym_p, frame_p, bg_p, out_dir = map(Path, argv[1:5])
    cols, rows = 4, 3
    out_dir.mkdir(parents=True, exist_ok=True)

    sheet = Image.open(sym_p).convert('RGBA')
    parts = slice_sheet(sheet, cols, rows)
    names = ['P1', 'P2', 'P3', 'P4', 'L1', 'L2', 'L3', 'L4', 'L5', 'S', 'M1', 'M2']
    syms = dict(zip(names, parts))
    missing = [n for n, p in syms.items() if p is None]
    if missing:
        print('missing symbols:', missing)

    # ---- background: cover-fit, soft focus, a touch lighter (high-key)
    bg = Image.open(bg_p).convert('RGB')
    s = max(W / bg.width, H / bg.height)
    bg = bg.resize((round(bg.width * s), round(bg.height * s)), Image.LANCZOS)
    bg = bg.crop(((bg.width - W) // 2, (bg.height - H) // 2, (bg.width - W) // 2 + W, (bg.height - H) // 2 + H))
    bg = bg.filter(ImageFilter.GaussianBlur(6))
    canvas = bg.convert('RGBA')

    # ---- frame: scale so it fills the height above the HUD band
    frame = Image.open(frame_p).convert('RGBA')
    fb, opening = frame_opening(frame)
    frame = frame.crop(fb)
    if opening:
        opening = (opening[0] - fb[0], opening[1] - fb[1], opening[2] - fb[0], opening[3] - fb[1])
        frame, opening = stretch_to_ratio(frame, opening)
    target_h = H - HUD - 14
    fs = target_h / frame.height
    if frame.width * fs > W * 0.78:
        fs = W * 0.78 / frame.width
    frame = frame.resize((round(frame.width * fs), round(frame.height * fs)), Image.LANCZOS)
    fx = (W - frame.width) // 2
    fy = max(6, (H - HUD - frame.height) // 2)
    if opening:
        ox0, oy0, ox1, oy1 = [round(v * fs) for v in opening]
        ox0, ox1, oy0, oy1 = ox0 + fx, ox1 + fx, oy0 + fy, oy1 + fy
    else:  # fallback: a 7:5 box in the frame centre
        ow = frame.width * 0.72
        oh = ow * 5 / 7
        ox0, oy0 = fx + (frame.width - ow) / 2, fy + frame.height * 0.2
        ox0, oy0, ox1, oy1 = int(ox0), int(oy0), int(ox0 + ow), int(oy0 + oh)

    # ---- frame first; the well is inset OVER it, so the corner flourishes tuck behind the well (standard slot build)
    canvas.alpha_composite(frame, (fx, fy))

    # ---- the well: near-black slate with a thin dark rim and a gold hairline, column lanes with a faint gradient
    well = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    wd = ImageDraw.Draw(well)
    inner_w, inner_h = ox1 - ox0, oy1 - oy0
    cell = min(inner_w / 7, inner_h / 5) * 0.985
    gw, gh = cell * 7, cell * 5
    gx0 = ox0 + (inner_w - gw) / 2
    gy0 = oy0 + (inner_h - gh) / 2
    pad = 8
    wd.rounded_rectangle((gx0 - pad - 4, gy0 - pad - 4, gx0 + gw + pad + 4, gy0 + gh + pad + 4), radius=14,
                         fill=(232, 176, 52, 255))
    wd.rounded_rectangle((gx0 - pad - 1, gy0 - pad - 1, gx0 + gw + pad + 1, gy0 + gh + pad + 1), radius=12,
                         fill=(58, 34, 16, 255))
    wd.rounded_rectangle((gx0 - pad + 2, gy0 - pad + 2, gx0 + gw + pad - 2, gy0 + gh + pad - 2), radius=10,
                         fill=(19, 22, 31, 255))
    for c in range(7):
        x0 = gx0 + c * cell + 2
        lane = Image.new('RGBA', (int(cell - 4), int(gh)), (0, 0, 0, 0))
        la = np.zeros((lane.height, lane.width, 4), dtype=np.uint8)
        t = np.linspace(0, 1, lane.height)[:, None]
        la[..., 0] = (30 + 8 * t).astype(np.uint8)
        la[..., 1] = (35 + 8 * t).astype(np.uint8)
        la[..., 2] = (50 + 6 * t).astype(np.uint8)
        la[..., 3] = 255
        well.alpha_composite(Image.fromarray(la, 'RGBA'), (int(x0), int(gy0)))
    canvas.alpha_composite(well)

    # ---- board layout (row-major, 5 rows x 7 cols) and spot tiles under some frameless cells
    layout = [
        ['P1', 'P1', 'L5', 'L2', 'P3', 'L4', 'L1'],
        ['L3', 'P1', 'P1', 'M1', 'L2', 'L4', 'P2'],
        ['L1', 'L3', 'S', 'P4', 'P4', 'L5', 'P2'],
        ['P3', 'L1', 'L3', 'L2', 'P4', 'M2', 'L4'],
        ['L2', 'P3', 'L5', 'L1', 'L3', 'L3', 'P2'],
    ]
    spots = {(0, 3): ((168, 220, 192), 'x2'), (2, 5): ((156, 128, 214), 'x4'), (3, 1): ((244, 155, 185), 'x8'),
             (4, 4): ((168, 220, 192), 'x2'), (1, 4): ((244, 155, 185), 'x8')}
    mult_vals = {'M1': 'x5', 'M2': 'x25'}

    board = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    bd = ImageDraw.Draw(board)
    for (r, c), (col, label) in spots.items():
        x0, y0 = gx0 + c * cell + 4, gy0 + r * cell + 4
        rounded(bd, (x0, y0, x0 + cell - 8, y0 + cell - 8), int(cell * 0.14), fill=col + (235,),
                outline=tuple(int(v * 0.72) for v in col) + (255,), width=3)
    canvas.alpha_composite(board)
    spot_labels = [((r, c), col, label) for (r, c), (col, label) in spots.items()]

    scale_of = {'P': 0.95, 'L': 0.8, 'S': 1.12, 'M': 0.94}
    font_mult = ImageFont.truetype(FONT, int(cell * 0.3))
    sym_layer = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    for r, row in enumerate(layout):
        for c, sid in enumerate(row):
            img = syms.get(sid)
            if img is None:
                continue
            k = scale_of[sid[0]]
            im = fit(img, cell * k, cell * k)
            cx, cy = gx0 + c * cell + cell / 2, gy0 + r * cell + cell / 2
            sym_layer.alpha_composite(im, (int(cx - im.width / 2), int(cy - im.height / 2)))
            if sid in mult_vals:
                d = ImageDraw.Draw(sym_layer)
                d.text((cx, cy + 2), mult_vals[sid], font=font_mult, anchor='mm', fill=(255, 196, 40, 255),
                       stroke_width=max(4, int(cell * 0.035)), stroke_fill=(70, 34, 10, 255))
    canvas.alpha_composite(sym_layer)

    # spot values sit on top of the symbols, in the lower-right corner of their cell (live text in the engine)
    font_spot = ImageFont.truetype(FONT, int(cell * 0.26))
    sd = ImageDraw.Draw(canvas)
    for (r, c), col, label in spot_labels:
        tx, ty = gx0 + (c + 1) * cell - 8, gy0 + (r + 1) * cell - 6
        sd.text((tx, ty), label, font=font_spot, anchor='rb', fill=tuple(int(v * 0.55) for v in col) + (255,),
                stroke_width=max(4, int(cell * 0.035)), stroke_fill=(255, 255, 255, 255))

    # ---- HUD band (the user's own UI goes there)
    hud = ImageDraw.Draw(canvas)
    hud.rectangle((0, H - HUD, W, H), fill=(76, 70, 52, 255))
    hud.rectangle((0, H - HUD, W, H - HUD + 3), fill=(40, 34, 24, 255))

    canvas.convert('RGB').save(out_dir / 'board.png')
    canvas.convert('RGB').save(out_dir / 'board.jpg', quality=90)

    # ---- symbol review sheet: every symbol at in-game size on the well colour, plus a 64 px greyscale row
    rev = Image.new('RGB', (12 * 170 + 20, 400), (19, 22, 31))
    for i, n in enumerate(names):
        img = syms.get(n)
        if img is None:
            continue
        im = fit(img, 150, 150)
        rev.paste(im, (10 + i * 170 + (150 - im.width) // 2, 10 + (150 - im.height) // 2), im)
        g = fit(img, 64, 64)
        gray = Image.merge('RGBA', (*[g.convert('L')] * 3, g.split()[3]))
        rev.paste(gray, (10 + i * 170 + 43, 200 + (64 - g.height) // 2), gray)
        ImageDraw.Draw(rev).text((10 + i * 170 + 70, 300), n, fill=(230, 230, 230), anchor='mm',
                                 font=ImageFont.truetype(FONT, 28))
    rev.save(out_dir / 'symbols_review.png')
    print('opening', (ox0, oy0, ox1, oy1), 'cell', round(cell, 1), 'frame', frame.size, 'at', (fx, fy))


if __name__ == '__main__':
    main(sys.argv)
