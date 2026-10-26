#!/usr/bin/env python3
"""Monty's master cut: the Bass Drop mastercut (art/source/mascots/pipeline/mastercut.py, imported, not
edited) with two Magpie Heist additions:

  * the painted glove poses come first (tools/mhart/mascot/hands.py -> art/_work/.../hands/*.png, read by
    cut.yaml as pre-matted sheets);
  * SMOOTH SEAMS: every piece's hidden seam (the band dilated under the parts in front of it) gets a
    smoothed outer edge before it is filled and inked. The watershed boundary along a shared outline is
    stair-stepped; a far limb that swings away from the body (Monty's wings) would otherwise show that
    comb as its inner edge. Only pixels hidden at rest change (seam pixels stay under front parts), so
    the reassembly is unaffected.

    tools/.venv/bin/python tools/mhart/mascot/cut.py [art/source/magpie-heist/mascot/spine2d/cut.yaml] [--owners]
Writes parts.json, points.json and images/chr_monty/** (cut.yaml `out`), QA in build/qa/chr_monty/cut/
(rest.png = rest | master | diff x4, rot_*.png rotation tests, report.json, pieces.png contact sheet).
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / "art/source/mascots/pipeline"))
import mastercut as mc  # noqa: E402

SPEC = REPO / "art/source/magpie-heist/mascot/spine2d/cut.yaml"
HERE = Path(__file__).resolve().parent


class MontyCut(mc.Cut):
    """mastercut.Cut with a copy of build_master_piece carrying three changes (marked MH):
    smooth seam rims (`seamSmooth` px), per-part `seamExact`, and the ink stroke's keep-off band measured
    from a smoothed known mask (a stair-stepped ownership edge otherwise inks it as a dotted comb)."""

    def build_master_piece(self, p, owned):
        W, H = self.W, self.H
        own = owned.get(p["pid"])
        if own is None:  # variant from the master: its region, no ownership
            own = self.mask(p.get("region")) & self.fig
            if p.get("minus"):
                own &= ~self.mask(p["minus"])
        take = self.mask(p.get("take")) & self.fig if p.get("take") else np.zeros_like(own)
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
            grown = ndi.binary_dilation(known | ext, iterations=sp)
            sm = float(p.get("seamSmooth", self.S.get("seamSmooth", 0)))  # MH: smooth rim
            if sm > 0:
                grown = (ndi.gaussian_filter(grown.astype(np.float32), sm) > 0.5) | known | ext
            seam = grown & self.fig & front & ~known & ~ext
        fillz = ext | seam
        allm = known | fillz
        bb = mc.bbox_of(allm, pad=12)
        if bb is None:
            raise SystemExit(f"{p['pid']}: empty piece")
        x0, y0, x1, y1 = bb
        rgb = self.rgb[y0:y1, x0:x1].copy()
        k = known[y0:y1, x0:x1]
        e = ext[y0:y1, x0:x1]
        s = seam[y0:y1, x0:x1]
        rgb = self.apply_ops(p.get("ops"), rgb, k, (x0, y0))
        fill = p.get("fill", "telea")
        if e.any():
            if isinstance(fill, dict) and "sheet" in fill:
                raise SystemExit(f"{p['pid']}: sheet fills are not used by chr_monty")
            rgb = mc.inpaint(rgb, k, e, radius=int(p.get("fillRadius", 6)), method=fill if isinstance(fill, str) else "telea")
        if s.any():
            rgb = mc.inpaint(rgb, k | e, s, method="nearest")
            exact = float(p.get("seamExact", self.S.get("seamExact", 2.5)))  # MH: per part
            if exact > 0:
                near = s & (ndi.distance_transform_edt(~(k | e)) <= exact)
                rgb[near] = self.rgb[y0:y1, x0:x1][near]
        if p.get("post"):
            rgb = self.apply_ops(p["post"], rgb, k | e | s, (x0, y0), fillmask=(e | s))
        a = self.alpha[y0:y1, x0:x1].copy()
        m = k | e | s
        a = np.where(m, a, 0.0).astype(np.float32)
        if p.get("soft"):
            sf = float(p["soft"])
            dist = ndi.distance_transform_edt(m)
            inner = ~ndi.binary_dilation(~self.fig[y0:y1, x0:x1], iterations=3)
            ramp = np.clip(dist / sf, 0, 1)
            a = np.where(inner, a * ramp, a).astype(np.float32)
        if not p.get("clip", True):
            a[e] = 1.0
        sw = float(p.get("stroke", self.S.get("stroke", 9)))
        if sw > 0 and (e.any() or s.any()):
            d = ndi.distance_transform_edt(m)
            st = np.clip(sw + 0.5 - d, 0, 1) * (e | s)
            # MH: the keep-off band next to the pixels visible at rest, measured from a smoothed known mask
            ks = ndi.gaussian_filter(k.astype(np.float32), 1.5) > 0.5
            dk = ndi.distance_transform_edt(~(ks | k))
            keep = float(p.get("strokeKeep", self.S.get("strokeKeep", 3.0)))  # MH: per part
            st = st * np.clip((dk - keep) / 1.5, 0, 1)
            st = ndi.gaussian_filter(st, 0.6) * (e | s)
            if p.get("strokeZone"):
                st *= mc.raster(p["strokeZone"], W, H)[y0:y1, x0:x1]
            rgb = rgb * (1 - st[..., None]) + self.ink_rgb[None, None, :] * st[..., None]
        return {"rgb": rgb.astype(np.float32), "alpha": a, "origin": (x0, y0), "fillPx": int(e.sum()), "seamPx": int(s.sum()),
                "ownPx": int(k.sum())}


def pieces_sheet(c: MontyCut, out: Path, scale: float = 0.5):
    """every written piece (setup + variants) on a checker of mid grey, labelled"""
    tiles = []
    for pc in c.pieces:
        img = pc["img"]
        rgb, a = img[..., :3], img[..., 3:4]
        bg = np.full(rgb.shape, 0.45, np.float32)
        yy, xx = np.mgrid[0:rgb.shape[0], 0:rgb.shape[1]]
        bg[((yy // 12 + xx // 12) % 2) == 1] = 0.6
        comp = rgb + bg * (1 - a)
        im = Image.fromarray((np.clip(comp, 0, 1) * 255 + 0.5).astype(np.uint8))
        im = im.resize((max(1, int(im.size[0] * scale)), max(1, int(im.size[1] * scale))), Image.LANCZOS)
        tiles.append((pc["p"]["pid"], im))
    W = 1600
    x = y = rowh = 0
    pos = []
    for name, im in tiles:
        if x + im.size[0] > W:
            x, y, rowh = 0, y + rowh + 18, 0
        pos.append((name, im, x, y))
        x += im.size[0] + 8
        rowh = max(rowh, im.size[1])
    sheet = Image.new("RGB", (W, y + rowh + 18), (30, 30, 30))
    d = ImageDraw.Draw(sheet)
    for name, im, px, py in pos:
        sheet.paste(im, (px, py + 14))
        d.text((px + 2, py), name, fill=(255, 255, 255))
    sheet.save(out)


def variants_sheet(c: MontyCut, out: Path):
    """eye states (head crop, 4x) and hand poses (both hands, 1.5x) composited in the rest pose"""
    def comp(choose, crop, sc):
        items = []
        for pc in c.pieces:
            q = pc["p"]
            want = choose.get(q["slot"])
            if want is None:
                if not q["isSetup"]:
                    continue
            elif want == "none" or q["attachment"] != want:
                continue
            items.append(pc)
        acc = c.composite(items, overrides=lambda it: it) if False else None
        acc = np.zeros((c.CH, c.CW, 4), np.float32)
        for pc in sorted(items, key=lambda q: q["p"]["slotZ"]):
            img, (x, y, w, h) = pc["img"], pc["box"]
            sx0, sy0, sx1, sy1 = max(0, x), max(0, y), min(c.CW, x + w), min(c.CH, y + h)
            L = img[sy0 - y:sy1 - y, sx0 - x:sx1 - x]
            acc[sy0:sy1, sx0:sx1] = L + acc[sy0:sy1, sx0:sx1] * (1 - L[..., 3:4])
        x0, y0, x1, y1 = crop
        a = acc[y0:y1, x0:x1]
        rgb = a[..., :3] + 0.5 * (1 - a[..., 3:4])
        im = Image.fromarray((np.clip(rgb, 0, 1) * 255 + 0.5).astype(np.uint8))
        return im.resize((int(im.size[0] * sc), int(im.size[1] * sc)), Image.LANCZOS)
    head = (395, 140, 565, 205)
    tiles = []
    for st in ("open", "half", "closed", "wide"):
        ch = {"eye_R": st, "eye_L": st}
        if st != "open":
            ch.update({"pupil_R": "none", "pupil_L": "none"})
        tiles.append((f"eyes {st}", comp(ch, head, 4)))
    for h in ("open", "fist", "point"):
        tiles.append((f"hands {h} R", comp({"hand_R": h}, (0, 720, 240, 1040), 1.2)))
        tiles.append((f"hands {h} L", comp({"hand_L": h}, (650, 700, 880, 1040), 1.2)))
    rows, cur, wsum = [], [], 0
    for t in tiles:
        if wsum + t[1].size[0] > 2100 and cur:
            rows.append(cur)
            cur, wsum = [], 0
        cur.append(t)
        wsum += t[1].size[0] + 6
    rows.append(cur)
    Wd = max(sum(t[1].size[0] + 6 for t in r) for r in rows)
    Hd = sum(max(t[1].size[1] for t in r) + 16 for r in rows)
    sheet = Image.new("RGB", (Wd, Hd), (25, 25, 25))
    d = ImageDraw.Draw(sheet)
    y = 0
    for r in rows:
        x = 0
        for lab, im in r:
            sheet.paste(im, (x, y + 14))
            d.text((x + 3, y + 1), lab, fill=(255, 255, 255))
            x += im.size[0] + 6
        y += max(t[1].size[1] for t in r) + 16
    sheet.save(out)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("spec", nargs="?", default=str(SPEC))
    ap.add_argument("--owners", action="store_true")
    ap.add_argument("--no-hands", action="store_true", help="reuse the painted hands in art/_work")
    a = ap.parse_args()
    if not a.no_hands and not a.owners:
        subprocess.run([sys.executable, str(HERE / "hands.py")], check=True, stdout=subprocess.DEVNULL)
    c = MontyCut(mc.rp(a.spec))
    c.owners_only = a.owners
    rep = c.run()
    if a.owners:
        print(rep)
        return 0
    pieces_sheet(c, c.qa / "pieces.png")
    variants_sheet(c, c.qa / "variants.png")
    print(json.dumps({k: rep[k] for k in ("reassembly", "warnings", "parts", "preview")}, indent=1, default=float))
    return 0 if rep["reassembly"]["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
