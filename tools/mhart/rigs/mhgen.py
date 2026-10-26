#!/usr/bin/env python3
"""Magpie Heist rig generator: the stock generator (tools/spine/spinegen, unmodified) + the Bass Drop clip layer
(tools/spine/examples/bass_drop/bdgen.py BassDropBuilder, imported) + the few things the Magpie Heist rigs need on top.

    tools/.venv/bin/python tools/mhart/rigs/mhgen.py art/source/magpie-heist/symbols/H1/rig.yaml -o build/spine/mh/sym_H1.json
    tools/.venv/bin/python tools/mhart/rigs/mhgen.py <rig.yaml> --config      # prints "<validate kind> <cell>" for build.sh

rig.yaml is the stock generator's (tools/spine/README.md "rig.yaml reference"). `heist.yaml` next to it (optional)
takes every bassdrop.yaml key (tools/spine/examples/bass_drop/bdgen.py: slots, skins, setup, rename, untouched, clone,
region_scale, radial_weights, clips with merge / override / retime ...) plus:

  kind: high | special          generator budgets: high / special = ANIMATION_CONTRACT 2.6 (30 bones, 8 slots,
                                250 mesh vertices) + 4 physics constraints (ANIMATION_SET 10 practice)
  budgets: {physics: 5}         per-rig override of one budget (say why in a comment)
  validate_kind: special        the validator kind build.sh passes (default = kind; the W is a `wild` in
                                config.ts, but the CR-8 wild kind requires Bass Drop's drop / sticky clips, skins
                                and txt_mult: Magpie Heist validates its wild as `special`)
  cell: 368                     build.sh's validator --cell (default 360: the @2x authoring canvas; specials whose
                                content exceeds the 300 cell take a larger gate, tools/spine/README "Headroom")
  island_meshes:                a part whose image holds several separate islands (pearls, studs, coins) becomes ONE
    pearls:                     mesh with a quad per island, every quad 100 % weighted to the nearest listed bone
      bones: [pearl_1_L, ...]   (by bone origin), so each island rides / flies off with its own bone while the
      pad: 2                    whole set costs one slot and one draw
      min_area: 40

The output is deterministic and carries a recomputed skeleton.hash. Exit 0 ok, 1 rig error, 2 usage.
"""
from __future__ import annotations

import argparse
import copy
import sys
from pathlib import Path

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
sys.path.insert(0, str(REPO / "tools/spine/examples/bass_drop"))
sys.path.insert(0, str(REPO / "tools/spine"))

import numpy as np  # noqa: E402
import yaml  # noqa: E402
from PIL import Image  # noqa: E402

import bdgen  # noqa: E402
from spinegen import provenance as prov  # noqa: E402
from spinegen.easing import rnd  # noqa: E402
from spinegen.rig import GEN_VERSION, RigError, _hash, dump  # noqa: E402

MH_VERSION = "1.0.0"
BUDGETS = {
    "high": {"bones": 30, "slots": 8, "meshVertices": 250, "physics": 4},
    "special": {"bones": 30, "slots": 8, "meshVertices": 250, "physics": 4},
}
MH_KEYS = {"budgets", "validate_kind", "cell", "island_meshes"}
ISLAND_KEYS = {"bones", "pad", "min_area"}


def load_heist(rig_path: Path, explicit: str | None = None) -> tuple[dict, Path]:
    p = Path(explicit) if explicit else rig_path.resolve().parent / "heist.yaml"
    doc = (yaml.safe_load(p.read_text(encoding="utf-8")) or {}) if p.exists() else {}
    bdgen._chk(doc, bdgen.BD_KEYS | MH_KEYS, str(p))
    return doc, p


def config_line(rig_path: Path, hy: dict) -> str:
    rig = yaml.safe_load(rig_path.read_text(encoding="utf-8")) or {}
    kind = str(hy.get("kind") or rig.get("kind") or "high")
    return f"{hy.get('validate_kind', kind)} {int(hy.get('cell', 360))}"


class HeistBuilder(bdgen.BassDropBuilder):
    def __init__(self, rig_path, hy: dict, **kw):
        kind = str(hy.get("kind", "high"))
        if kind not in BUDGETS:
            raise RigError(f"heist.yaml kind '{kind}': use {' | '.join(BUDGETS)}")
        budgets = dict(BUDGETS[kind], **(hy.get("budgets") or {}))
        bad = sorted(set(budgets) - set(BUDGETS[kind]))
        if bad:
            raise RigError(f"heist.yaml budgets: unknown key(s) {', '.join(bad)}")
        key = f"mh_{kind}"
        bdgen.KIND_BUDGETS[key] = budgets          # bdgen reads its budgets by kind name
        bd = {k: v for k, v in hy.items() if k in bdgen.BD_KEYS}
        bd["kind"] = key
        super().__init__(rig_path, bd, **kw)
        self.hy = hy
        self.mh_budgets = budgets

    @staticmethod
    def _anim_len(a: dict) -> float:
        # bdgen compares the merged keys' end (frames / fps) with the rounded key times: allow the 5-decimal rounding
        # (13 / 30 = 0.433333.. vs 0.43333)
        return bdgen.BassDropBuilder._anim_len(a) + 1e-4

    def build(self) -> dict:
        doc = super().build()
        for part, spec in (self.hy.get("island_meshes") or {}).items():
            self._island_mesh(doc, part, spec or {})
        verts = 0
        for skin in doc["skins"]:
            for ent in skin["attachments"].values():
                for a in ent.values():
                    if a.get("type") == "mesh":
                        verts += len(a["uvs"]) // 2
        self.report.stats["meshVertices"] = verts
        if verts > self.mh_budgets["meshVertices"]:
            raise RigError(f"budget: mesh vertices {verts} > {self.mh_budgets['meshVertices']}")
        doc["skeleton"]["hash"] = ""
        doc["skeleton"]["hash"] = _hash(doc)
        return doc

    def _island_mesh(self, doc: dict, part_name: str, spec: dict) -> None:
        bdgen._chk(spec, ISLAND_KEYS, f"island_meshes.{part_name}")
        part = self.part_by_name.get(part_name)
        if part is None:
            raise RigError(f"island_meshes.{part_name}: no such part")
        bones = list(spec.get("bones") or [])
        if not bones:
            raise RigError(f"island_meshes.{part_name}: `bones` is required")
        for b in bones:
            if b not in self.bones:
                raise RigError(f"island_meshes.{part_name}: bone '{b}' not declared")
        from scipy import ndimage  # noqa: PLC0415

        a = np.asarray(Image.open(part.image).convert("RGBA"))[..., 3] > 8
        lab, n = ndimage.label(a, structure=np.ones((3, 3)))
        min_area = int(spec.get("min_area", 40))
        pad = float(spec.get("pad", 2))
        x0, y0, w, h = part.bbox
        islands = []
        for i in range(1, n + 1):
            ys, xs = np.nonzero(lab == i)
            if len(xs) < min_area:
                continue
            islands.append((xs.min() - pad, ys.min() - pad, xs.max() + 1 + pad, ys.max() + 1 + pad,
                            xs.mean(), ys.mean()))
        if not islands:
            raise RigError(f"island_meshes.{part_name}: no island of >= {min_area} px")
        islands.sort(key=lambda t: (t[4], t[5]))
        uvs, verts, tris = [], [], []
        used = set()
        for ix0, iy0, ix1, iy1, cx, cy in islands:
            gx, gy = x0 + cx, y0 + cy   # image space (canvas)
            best = min(bones, key=lambda b: (self.bones[b].wx - self.img2sk(gx, gy)[0]) ** 2
                       + (self.bones[b].wy - self.img2sk(gx, gy)[1]) ** 2)
            if best in used:
                raise RigError(f"island_meshes.{part_name}: two islands are nearest to bone '{best}'")
            used.add(best)
            base = len(uvs) // 2
            corners = [(max(0, ix0), max(0, iy0)), (min(w, ix1), max(0, iy0)), (min(w, ix1), min(h, iy1)),
                       (max(0, ix0), min(h, iy1))]
            for px, py in corners:
                uvs += [rnd(px / w, 5), rnd(py / h, 5)]
                sx, sy = self.img2sk(x0 + px, y0 + py)
                lx, ly = self.bones[best].to_local(sx, sy)
                verts += [1, self.bone_index(best), rnd(lx, 2), rnd(ly, 2), 1]
            tris += [base, base + 1, base + 2, base, base + 2, base + 3]
        mesh = {"type": "mesh", "path": f"{self.prefix}/{part_name}", "uvs": uvs, "triangles": tris,
                "vertices": verts, "hull": len(uvs) // 2, "width": int(round(w)), "height": int(round(h))}
        hit = False
        for skin in doc["skins"]:
            ent = skin["attachments"].get(part.slot, {})
            if part_name in ent:
                if ent[part_name].get("type", "region") != "region":
                    raise RigError(f"island_meshes.{part_name}: declare it as a plain part (not under rig.yaml meshes)")
                ent[part_name] = copy.deepcopy(mesh)
                hit = True
        if not hit:
            raise RigError(f"island_meshes.{part_name}: attachment not found in any skin")
        self.report.stats.setdefault("meshes", {})[part_name] = {"vertices": len(uvs) // 2,
                                                                 "triangles": len(tris) // 3, "islands": len(islands)}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="mhgen.py", description=__doc__.split("\n\n")[0],
                                 formatter_class=argparse.RawDescriptionHelpFormatter, epilog=__doc__.split("\n", 2)[2])
    ap.add_argument("rig")
    ap.add_argument("-o", "--out")
    ap.add_argument("--heist", default=None, help="heist.yaml (default: next to rig.yaml)")
    ap.add_argument("--config", action="store_true", help="print '<validate kind> <cell>' and exit")
    ap.add_argument("--images-path", default=None)
    ap.add_argument("--provenance", default=None)
    ap.add_argument("--manifest", default=None)
    ap.add_argument("--license-id", default="owned-code")
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--quiet", action="store_true")
    a = ap.parse_args(argv)
    rig_path = Path(a.rig)
    try:
        hy, hy_path = load_heist(rig_path, a.heist)
        if a.config:
            print(config_line(rig_path, hy))
            return 0
        if not a.out:
            ap.error("-o/--out is required")
        rb = HeistBuilder(a.rig, hy, out_path=a.out, images_path=a.images_path)
        doc = rb.build()
    except (RigError, ValueError, FileNotFoundError, KeyError) as e:
        print(f"mhgen.py: ERROR: {e}", file=sys.stderr)
        return 1
    text = dump(doc)
    out = Path(a.out)
    if a.check:
        ok = out.exists() and out.read_text(encoding="utf-8") == text
        print(f"mhgen.py: {'up to date' if ok else 'DRIFT'}: {out}", file=sys.stdout if ok else sys.stderr)
        return 0 if ok else 1
    out.parent.mkdir(parents=True, exist_ok=True)
    if not out.exists() or out.read_text(encoding="utf-8") != text:
        out.write_text(text, encoding="utf-8")
    st = rb.report.stats
    if not a.quiet:
        print(f"mhgen.py: wrote {out}  ({rb.skel_name}, kind {hy.get('kind', 'high')})")
        print(f"  bones {st['bones']}  slots {st['slots']}  mesh vertices {st['meshVertices']}  physics {st['physics']}")
        print(f"  animations: {', '.join(st['animations'])}")
        for m, info in (st.get("meshes") or {}).items():
            print(f"  mesh {m}: {info['vertices']} verts, {info['triangles']} tris")
        for w in rb.report.warnings:
            print(f"  warning: {w}")
    if a.provenance or a.manifest:
        inputs = list(dict.fromkeys(rb.report.inputs + ([hy_path] if hy_path.exists() else [])))
        row = prov.make_row(asset_id=f"mh.{rb.skel_name}.skeleton-json", path=out, stage="spine-authoring",
                            model="tools/mhart/rigs/mhgen.py", version=f"{GEN_VERSION}+bd{bdgen.BD_VERSION}+mh{MH_VERSION}",
                            inputs=inputs, license_id=a.license_id, shipped=False,
                            notes=f"spine {doc['skeleton']['spine']}; inputs: " + ", ".join(prov.rel(p) for p in inputs[:3])
                            + f" (+{max(0, len(inputs) - 3)} images)")
        for f in (a.provenance, a.manifest):
            if f:
                n = prov.append_rows(f, [row], "tools/mhart/rigs/mhgen.py")
                if not a.quiet:
                    print(f"  provenance: {'added' if n else 'unchanged'} {row['id']} -> {f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
