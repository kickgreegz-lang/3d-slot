#!/usr/bin/env python3
"""Deterministic Spine atlas packer (4.x text .atlas + PNG pages) for AI rigs WITHOUT the editor.

    python tools/spine/pack.py --images tools/spine/examples/demo_symbol/images \
        --skeleton build/spine/sym_demo.json --out public/assets/spine/demo --name sym_demo
    python tools/spine/pack.py --images art/source/spine/images --prefix sym_H1 --out build/spine --name symbols \
        [--scale 1 --scale 0.5] [--max 2048] [--padding 2] [--no-strip] [--no-pma] [--pot] [--check]

Production packs with the Spine CLI (`tools/spine/export.sh pack`, config/spine/pack-symbols.json);
this packer exists so a generated rig can be loaded by spine-pixi-v8 / spine-core in CI and
previews. It mirrors the contract pack settings: premultiplied alpha (`pma: true` and the page
pixels premultiplied), padding 2 px incl. page edges, whitespace stripped (with `offsets`;
never for mesh regions, whose UVs span the whole image),
region names = image path relative to --images without extension, linear filtering, page
sizes multiples of 4 (or powers of two with --pot), no rotation. MaxRects (best short side
fit) with a fixed input order and tie-breaks => byte-identical output for identical inputs.
Regions: every attachment path of --skeleton (missing image = error), else every PNG under
--images (optionally only below --prefix). Exit 1 on missing images / overflow of --max.
"""
from __future__ import annotations

import argparse
import json
import sys

sys.dont_write_bytecode = True  # never leave __pycache__ in tools/
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from spinegen import provenance as prov  # noqa: E402

PACK_VERSION = "1.0.0"


@dataclass
class Item:
    name: str
    img: Image.Image         # cropped (stripped) RGBA
    ox: int                  # offsets (Spine: x from left, y from BOTTOM, of the original image)
    oy: int
    ow: int
    oh: int
    x: int = 0
    y: int = 0
    page: int = 0


def load_items(images: Path, names: list[str], strip: bool, scale: float, keep: set[str] = frozenset()) -> list[Item]:
    """`keep`: regions never stripped (mesh attachments: their UVs span the whole image, so a
    stripped region would sample neighbouring atlas pixels at the mesh edge)."""
    items = []
    for n in names:
        p = images / f"{n}.png"
        if not p.exists():
            raise FileNotFoundError(f"region '{n}': {p} not found")
        im = Image.open(p).convert("RGBA")
        if scale != 1:
            w = max(1, round(im.width * scale))
            h = max(1, round(im.height * scale))
            im = im.resize((w, h), Image.LANCZOS)
        ow, oh = im.size
        x0, y0, x1, y1 = 0, 0, ow, oh
        if strip and n not in keep:
            a = np.asarray(im)[:, :, 3]
            ys, xs = np.nonzero(a)
            if len(xs):
                x0, y0, x1, y1 = int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1
            else:
                x0, y0, x1, y1 = 0, 0, 1, 1
            im = im.crop((x0, y0, x1, y1))
        items.append(Item(name=n, img=im, ox=x0, oy=oh - y1, ow=ow, oh=oh))
    return items


def maxrects(items: list[Item], W: int, H: int, pad: int) -> bool:
    """Pack in place (sets x, y). Page-edge padding = pad; between regions = pad."""
    free = [(pad, pad, W - pad, H - pad)]  # x0, y0, x1, y1 (exclusive), usable area
    order = sorted(items, key=lambda it: (-max(it.img.width, it.img.height), -it.img.width * it.img.height, it.name))
    for it in order:
        w, h = it.img.width + pad, it.img.height + pad  # each rect carries its right/bottom gap
        best = None
        for fx0, fy0, fx1, fy1 in free:
            fw, fh = fx1 - fx0, fy1 - fy0
            if w - pad <= fw and h - pad <= fh:
                short = min(fw - w, fh - h)
                long_ = max(fw - w, fh - h)
                key = (short, long_, fy0, fx0)
                if best is None or key < best[0]:
                    best = (key, fx0, fy0)
        if best is None:
            return False
        _, x, y = best
        it.x, it.y = x, y
        used = (x, y, x + w, y + h)
        nf = []
        for f in free:
            if used[0] >= f[2] or used[2] <= f[0] or used[1] >= f[3] or used[3] <= f[1]:
                nf.append(f)
                continue
            if used[0] > f[0]:
                nf.append((f[0], f[1], used[0], f[3]))
            if used[2] < f[2]:
                nf.append((used[2], f[1], f[2], f[3]))
            if used[1] > f[1]:
                nf.append((f[0], f[1], f[2], used[1]))
            if used[3] < f[3]:
                nf.append((f[0], used[3], f[2], f[3]))
        # prune contained rects (deterministic order)
        nf = sorted(set(nf))
        pruned = []
        for i, a in enumerate(nf):
            if a[2] - a[0] <= 0 or a[3] - a[1] <= 0:
                continue
            if any(j != i and b[0] <= a[0] and b[1] <= a[1] and b[2] >= a[2] and b[3] >= a[3] and (b != a or j < i)
                   for j, b in enumerate(nf)):
                continue
            pruned.append(a)
        free = pruned
    return True


def pack_pages(items: list[Item], max_size: int, pad: int, pot: bool) -> list[tuple[int, int, list[Item]]]:
    sizes = [s for s in (64, 128, 256, 512, 1024, 2048, 4096, 8192) if s <= max_size]
    if not sizes or sizes[-1] != max_size:
        sizes.append(max_size)
    cands = sorted({(w, h) for w in sizes for h in sizes}, key=lambda s: (s[0] * s[1], max(s), -s[0]))
    pages = []
    todo = list(items)
    while todo:
        placed = None
        for W, H in cands:
            trial = [Item(**{**it.__dict__}) for it in todo]
            if maxrects(trial, W, H, pad):
                placed = (W, H, trial)
                break
        if placed is None:
            # fill one max page greedily, spill the rest to the next page
            W = H = max_size
            fit: list[Item] = []
            rest: list[Item] = []
            for it in sorted(todo, key=lambda i: (-i.img.width * i.img.height, i.name)):
                trial = [Item(**{**x.__dict__}) for x in fit + [it]]
                if maxrects(trial, W, H, pad):
                    fit.append(it)
                else:
                    rest.append(it)
            if not fit:
                big = max(todo, key=lambda i: i.img.width * i.img.height)
                raise ValueError(f"region '{big.name}' ({big.img.width}x{big.img.height}) does not fit a {max_size} page")
            trial = [Item(**{**x.__dict__}) for x in fit]
            maxrects(trial, W, H, pad)
            placed = (W, H, trial)
            todo = rest
        else:
            todo = []
        W, H, trial = placed
        if not pot:  # shrink to the used area (+ edge padding), multiple of 4
            uw = max(it.x + it.img.width for it in trial) + pad
            uh = max(it.y + it.img.height for it in trial) + pad
            W = min(W, (uw + 3) // 4 * 4)
            H = min(H, (uh + 3) // 4 * 4)
        pages.append((W, H, sorted(trial, key=lambda i: i.name)))
    return pages


def premultiply(im: Image.Image) -> Image.Image:
    a = np.asarray(im).astype(np.uint32)
    out = a.copy()
    out[:, :, :3] = (a[:, :, :3] * a[:, :, 3:4] + 127) // 255
    return Image.fromarray(out.astype(np.uint8))


def write(out_dir: Path, name: str, pages, pma: bool, check: bool) -> tuple[list[Path], bool]:
    lines: list[str] = []
    files: list[Path] = []
    changed = False
    for pi, (W, H, items) in enumerate(pages):
        page_name = f"{name}.png" if len(pages) == 1 else f"{name}_{pi + 1}.png"
        canvas = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        for it in items:
            canvas.paste(it.img, (it.x, it.y))
        if pma:
            canvas = premultiply(canvas)
        if pi:
            lines.append("")
        lines += [page_name, f"size: {W},{H}", "filter: Linear,Linear"]
        if pma:
            lines.append("pma: true")
        for it in items:
            lines.append(it.name)
            lines.append(f"bounds: {it.x},{it.y},{it.img.width},{it.img.height}")
            if (it.ox, it.oy, it.ow, it.oh) != (0, 0, it.img.width, it.img.height):
                lines.append(f"offsets: {it.ox},{it.oy},{it.ow},{it.oh}")
        p = out_dir / page_name
        tmp = out_dir / f".{page_name}.tmp"
        canvas.save(tmp, format="PNG", compress_level=9)
        new = tmp.read_bytes()
        tmp.unlink()
        if not p.exists() or p.read_bytes() != new:
            changed = True
            if not check:
                p.write_bytes(new)
        files.append(p)
    atlas = out_dir / f"{name}.atlas"
    text = "\n".join(lines) + "\n"
    if not atlas.exists() or atlas.read_text(encoding="utf-8") != text:
        changed = True
        if not check:
            atlas.write_text(text, encoding="utf-8")
    return [atlas] + files, changed


def skeleton_regions(path: Path) -> tuple[list[str], set[str]]:
    """(all region paths, paths used by mesh / linkedmesh attachments)."""
    doc = json.loads(path.read_text(encoding="utf-8"))
    names, meshes = set(), set()
    for skin in doc.get("skins", []):
        for entries in skin.get("attachments", {}).values():
            for key, a in entries.items():
                t = a.get("type", "region")
                if t in ("region", "mesh", "linkedmesh"):
                    p = a.get("path", a.get("name", key))
                    names.add(p)
                    if t != "region":
                        meshes.add(p)
    return sorted(names), meshes


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="pack.py", description=__doc__.split("\n\n")[0],
                                 formatter_class=argparse.RawDescriptionHelpFormatter, epilog=__doc__.split("\n", 2)[2])
    ap.add_argument("--images", required=True, help="images root (region name = path below it, no extension)")
    ap.add_argument("--skeleton", action="append", default=[], help="pack the regions this skeleton JSON references (repeatable)")
    ap.add_argument("--prefix", default="", help="without --skeleton: only PNGs below this sub-folder")
    ap.add_argument("--out", required=True, help="output directory")
    ap.add_argument("--name", required=True, help="atlas base name (<name>.atlas, <name>.png)")
    ap.add_argument("--scale", type=float, action="append", default=None, help="scale(s), e.g. --scale 1 --scale 0.5")
    ap.add_argument("--max", type=int, default=2048, help="max page side (px)")
    ap.add_argument("--padding", type=int, default=2)
    ap.add_argument("--no-strip", action="store_true", help="keep transparent borders")
    ap.add_argument("--no-pma", action="store_true", help="straight alpha (contract: PMA)")
    ap.add_argument("--pot", action="store_true", help="power-of-two pages")
    ap.add_argument("--check", action="store_true", help="write nothing; exit 1 if outputs would change")
    ap.add_argument("--provenance", default=None, help="append provenance rows to this rows file")
    ap.add_argument("--manifest", default=None, help="also append rows to this manifest (e.g. art/manifest.json)")
    ap.add_argument("--license-id", default="owned-code")
    ap.add_argument("--shipped", action="store_true")
    ap.add_argument("--quiet", action="store_true")
    a = ap.parse_args(argv)

    images = Path(a.images)
    mesh_regions: set[str] = set()
    if a.skeleton:
        names_set: set[str] = set()
        for s in a.skeleton:
            ns, ms = skeleton_regions(Path(s))
            names_set |= set(ns)
            mesh_regions |= ms
        names = sorted(names_set)
    else:
        base = images / a.prefix if a.prefix else images
        names = sorted(p.relative_to(images).with_suffix("").as_posix() for p in base.rglob("*.png"))
    if not names:
        print("pack.py: ERROR: no regions to pack", file=sys.stderr)
        return 1
    out = Path(a.out)
    if not a.check:
        out.mkdir(parents=True, exist_ok=True)
    scales = a.scale or [1.0]
    any_change = False
    all_files: list[Path] = []
    for sc in scales:
        suffix = "" if sc == 1 else f"@{sc:g}x"
        try:
            items = load_items(images, names, strip=not a.no_strip, scale=sc, keep=mesh_regions)
            pages = pack_pages(items, a.max, a.padding, a.pot)
        except (FileNotFoundError, ValueError) as e:
            print(f"pack.py: ERROR: {e}", file=sys.stderr)
            return 1
        files, changed = write(out, a.name + suffix, pages, pma=not a.no_pma, check=a.check)
        any_change |= changed
        all_files += files
        if not a.quiet:
            dims = ", ".join(f"{W}x{H}" for W, H, _ in pages)
            fill = sum(it.img.width * it.img.height for _, _, its in pages for it in its) / sum(W * H for W, H, _ in pages)
            print(f"pack.py: {a.name + suffix}.atlas  {len(names)} regions  {len(pages)} page(s) {dims}  fill {fill:.0%}"
                  f"{'  (changed)' if changed else '  (unchanged)'}")
    if a.check:
        if any_change:
            print("pack.py: DRIFT: packed outputs differ", file=sys.stderr)
            return 1
        return 0
    if a.provenance or a.manifest:
        inputs = [images / f"{n}.png" for n in names] + [Path(s) for s in a.skeleton]
        rows = [prov.make_row(asset_id=f"{a.name}.{f.suffix.lstrip('.')}{'' if '@' not in f.name else '.' + f.stem.split('@')[1]}",
                              path=f, stage="packaging", model="tools/spine/pack.py", version=PACK_VERSION,
                              inputs=inputs, license_id=a.license_id, shipped=a.shipped,
                              notes="AI-rig atlas (no Spine editor); production atlases come from the Spine CLI")
                for f in all_files]
        for f in (a.provenance, a.manifest):
            if f:
                n = prov.append_rows(f, rows, "tools/spine/pack.py")
                if not a.quiet:
                    print(f"  provenance: {n} row(s) added -> {f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
