"""rig.yaml + parts.json -> Spine 4.3 skeleton JSON (ANIMATION_CONTRACT sections 2-4).

Coordinates in parts.json / rig.yaml are IMAGE space of the @2x symbol canvas (360x360 by
default): x right, y DOWN, origin top-left. The skeleton is Y-UP with `root` at the canvas
centre, so (x, y)_image -> (x - W/2, H/2 - y)_skeleton.
"""
from __future__ import annotations

import base64
import hashlib
import json
import math
import os
import re
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import yaml
from PIL import Image

from . import mesh as meshlib
from . import motion as motionlib
from .easing import rnd
from .physics import constraint as physics_constraint

HERE = Path(__file__).resolve().parent
CONTRACT_PATH = HERE.parent / "contract.json"
GEN_VERSION = "1.0.0"


class RigError(ValueError):
    pass


def load_contract() -> dict:
    return json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))


# Every key rig.yaml may use. A typo (`accent:`, `ammount:`) must fail loudly instead of
# silently generating the contract defaults. Keys starting with `$` or `x_` are comments.
RIG_KEYS = {"symbol", "skeleton", "parts", "kind", "spine_version", "canvas", "attachment_prefix", "feet_y", "body_y",
            "body_length", "bones", "meshes", "physics", "constraints", "motion", "accents", "events", "skins",
            "compat", "roles"}
BONE_KEYS = {"name", "parent", "joint", "tip", "rotation", "length", "inherit", "color"}
MESH_KEYS = {"type", "cols", "rows", "spacing", "pad", "simplify", "interior", "weights"}
WEIGHT_KEYS = {"mode", "stops", "bones", "power", "max"}
PHYSICS_KEYS = {"bone", "name", "preset", "f", "zeta", "mass", "inertia", "fps", "limit", "strength", "damping",
                "x", "y", "rotate", "scaleX", "scaleY", "shearX", "wind", "gravity", "mix"}
ACCENT_KEYS = {"bone", "type", "amount", "at", "frames", "count", "beats", "offset", "cycles"}
EVENT_KEYS = {"name", "at", "int", "float", "string"}
COMPAT_KEYS = {"runtime_aliases"}
ROLE_KEYS = {"eyes"}


def check_keys(obj, allowed: set[str], where: str) -> None:
    if obj is None:
        return
    if not isinstance(obj, dict):
        raise RigError(f"{where}: expected a mapping, got {type(obj).__name__}")
    bad = sorted(k for k in obj if not (str(k) in allowed or str(k).startswith(("$", "x_"))))
    if bad:
        raise RigError(f"{where}: unknown key(s) {', '.join(map(str, bad))} (known: {', '.join(sorted(allowed))})")


def check_list(obj, where: str) -> list:
    if obj is None:
        return []
    if not isinstance(obj, list):
        raise RigError(f"{where}: expected a list, got {type(obj).__name__}")
    return obj


# ------------------------------------------------------------------------------------------
# 2D setup-pose transforms (rotation + translation; setup scale is always 1 in generated rigs)
# ------------------------------------------------------------------------------------------

@dataclass
class Bone:
    name: str
    parent: str | None
    wx: float = 0.0          # world (skeleton) position
    wy: float = 0.0
    wrot: float = 0.0        # world rotation (deg)
    length: float = 0.0
    inherit: str | None = None
    color: str | None = None
    # computed local
    x: float = 0.0
    y: float = 0.0
    rotation: float = 0.0

    def to_local(self, px: float, py: float) -> tuple[float, float]:
        r = math.radians(self.wrot)
        dx, dy = px - self.wx, py - self.wy
        c, s = math.cos(r), math.sin(r)
        return dx * c + dy * s, -dx * s + dy * c

    def dir_to_local(self, dx: float, dy: float) -> tuple[float, float]:
        r = math.radians(self.wrot)
        c, s = math.cos(r), math.sin(r)
        return dx * c + dy * s, -dx * s + dy * c


@dataclass
class Part:
    name: str
    bbox: tuple[float, float, float, float]     # image space x, y, w, h
    image: Path
    z: float
    bone: str
    slot: str
    blend: str = "normal"
    color: str | None = None
    hidden: bool = False
    blur_image: Path | None = None
    blur_bbox: tuple[float, float, float, float] | None = None
    content: tuple[float, float, float, float] | None = None  # opaque bbox, image space (x0,y0,x1,y1)
    order: int = 0


@dataclass
class Report:
    warnings: list[str] = field(default_factory=list)
    stats: dict = field(default_factory=dict)
    inputs: list[Path] = field(default_factory=list)


def _png_size(p: Path) -> tuple[int, int]:
    with Image.open(p) as im:
        return im.size


def _opaque_bbox(p: Path, threshold: int = 8):
    with Image.open(p) as im:
        a = np.asarray(im.convert("RGBA"))[:, :, 3] > threshold
    ys, xs = np.nonzero(a)
    if len(xs) == 0:
        return None
    return float(xs.min()), float(ys.min()), float(xs.max() + 1), float(ys.max() + 1)


def _hash(doc: dict) -> str:
    raw = json.dumps(doc, sort_keys=True, separators=(",", ":")).encode()
    return base64.b64encode(hashlib.sha1(raw).digest()).decode()[:11]


class RigBuilder:
    def __init__(self, rig_path: str | os.PathLike, out_path: str | os.PathLike | None = None,
                 images_path: str | None = None, spine_version: str | None = None):
        self.contract = load_contract()
        self.rig_path = Path(rig_path).resolve()
        self.rig_dir = self.rig_path.parent
        self.rig = yaml.safe_load(self.rig_path.read_text(encoding="utf-8")) or {}
        self._check_schema()
        self.report = Report(inputs=[self.rig_path])
        self.out_path = Path(out_path).resolve() if out_path else None
        self.images_override = images_path
        self.spine_version = spine_version or str(self.rig.get("spine_version") or self.contract["spineVersion"])
        self.fps = int(self.contract["fps"])
        sym = self.rig.get("symbol")
        if not sym or not re.match(r"^[A-Za-z0-9_]+$", str(sym)):
            raise RigError("rig.yaml: `symbol` (e.g. H1, W, demo) is required")
        self.symbol = str(sym)
        self.skel_name = str(self.rig.get("skeleton") or f"sym_{self.symbol}")
        self.kind = str(self.rig.get("kind") or self.contract["symbolKinds"].get(self.symbol, "special"))
        if self.kind not in ("high", "special", "royal", "any"):
            raise RigError(f"rig.yaml kind '{self.kind}': use high | special | royal | any")
        self.prefix = str(self.rig.get("attachment_prefix") or self.skel_name)

    def _check_schema(self) -> None:
        r = self.rig
        check_keys(r, RIG_KEYS, "rig.yaml")
        for i, b in enumerate(check_list(r.get("bones"), "bones")):
            check_keys(b, BONE_KEYS, f"bones[{i}]")
            if "name" not in b:
                raise RigError(f"bones[{i}]: `name` is required")
        meshes = r.get("meshes") or {}
        check_keys(meshes, set(meshes), "meshes")  # mapping check only; part names checked in build()
        for m, spec in meshes.items():
            check_keys(spec, MESH_KEYS, f"meshes.{m}")
            check_keys((spec or {}).get("weights"), WEIGHT_KEYS, f"meshes.{m}.weights")
        for i, ps in enumerate(check_list(r.get("physics"), "physics")):
            check_keys(ps, PHYSICS_KEYS, f"physics[{i}]")
        for i, c in enumerate(check_list(r.get("constraints"), "constraints")):
            if not isinstance(c, dict):
                raise RigError(f"constraints[{i}]: expected a mapping")
        for section, keys in (("accents", ACCENT_KEYS), ("events", EVENT_KEYS)):
            block = r.get(section) or {}
            check_keys(block, set(block), section)
            for anim, specs in block.items():
                for i, spec in enumerate(check_list(specs, f"{section}.{anim}")):
                    check_keys(spec, keys, f"{section}.{anim}[{i}]")
                    if section == "events" and "name" not in spec:
                        raise RigError(f"events.{anim}[{i}]: `name` is required (sfx, vfx, shake or a custom event)")
                    if section == "accents" and "bone" not in spec:
                        raise RigError(f"accents.{anim}[{i}]: `bone` is required")
        check_keys(r.get("compat"), COMPAT_KEYS, "compat")
        check_keys(r.get("roles"), ROLE_KEYS, "roles")

    # ---------------------------------------------------------------- parts
    def load_parts(self) -> None:
        pj = self.rig_dir / str(self.rig.get("parts", "parts.json"))
        if not pj.exists():
            raise RigError(f"parts file not found: {pj}")
        self.report.inputs.append(pj)
        doc = json.loads(pj.read_text(encoding="utf-8"))
        canvas = doc.get("canvas") or self.rig.get("canvas") or [self.contract["canvasPx"]] * 2
        if isinstance(canvas, (int, float)):
            canvas = [canvas, canvas]
        self.W, self.H = float(canvas[0]), float(canvas[1])
        root = (pj.parent / str(doc.get("images", "images"))).resolve()
        self.images_root = root
        parts: list[Part] = []
        seen = set()
        for i, pm in enumerate(doc.get("parts", [])):
            name = pm["name"]
            if name in seen:
                raise RigError(f"parts.json: duplicate part '{name}'")
            seen.add(name)
            if not re.match(r"^[a-z][a-z0-9_]*(_[LR])?$", name):
                raise RigError(f"part '{name}': names are snake_case, L/R suffix allowed")
            img = root / str(pm.get("image", f"{self.prefix}/{name}.png"))
            if not img.exists():
                raise RigError(f"part '{name}': image not found: {img}")
            if img.suffix.lower() != ".png":
                raise RigError(f"part '{name}': parts must be PNG")
            w, h = _png_size(img)
            bb = pm.get("bbox")
            if bb is None:
                raise RigError(f"part '{name}': bbox [x, y, w, h] (image space) is required")
            if int(round(bb[2])) != w or int(round(bb[3])) != h:
                raise RigError(f"part '{name}': bbox size {bb[2]}x{bb[3]} != image {w}x{h}")
            blur_img = None
            blur_bb = None
            if pm.get("blur"):
                blur_img = root / str(pm["blur"] if isinstance(pm["blur"], str) else f"{self.prefix}/{name}_blur.png")
                if not blur_img.exists():
                    raise RigError(f"part '{name}': blur image not found: {blur_img}")
                bw, bh = _png_size(blur_img)
                if pm.get("blurBbox"):
                    blur_bb = tuple(float(v) for v in pm["blurBbox"])
                else:  # same centre as the part
                    cx, cy = bb[0] + bb[2] / 2, bb[1] + bb[3] / 2
                    blur_bb = (cx - bw / 2, cy - bh / 2, float(bw), float(bh))
                self.report.inputs.append(blur_img)
            bone = str(pm.get("bone", "body"))
            slot = str(pm.get("slot", name))
            blend = str(pm.get("blend", "normal"))
            content = _opaque_bbox(img)
            if content is not None:
                content = (content[0] + bb[0], content[1] + bb[1], content[2] + bb[0], content[3] + bb[1])
            parts.append(Part(name=name, bbox=tuple(float(v) for v in bb), image=img, z=float(pm.get("z", i)),
                              bone=bone, slot=slot, blend=blend, color=pm.get("color"), hidden=bool(pm.get("hidden", False)),
                              blur_image=blur_img, blur_bbox=blur_bb, content=content, order=i))
            self.report.inputs.append(img)
        if not parts:
            raise RigError("parts.json has no parts")
        self.parts = parts
        self.part_by_name = {p.name: p for p in parts}
        self.part_decls = {pm["name"]: pm for pm in doc.get("parts", [])}

    def img2sk(self, x: float, y: float) -> tuple[float, float]:
        return x - self.W / 2, self.H / 2 - y

    # ---------------------------------------------------------------- bones
    def build_bones(self) -> None:
        names_ok = re.compile(self.contract["boneNames"]["pattern"])
        fixed = self.contract["boneNames"]["fixed"]
        prefixes = self.contract["boneNames"]["prefixes"]
        content_parts = [p for p in self.parts if not p.bone.startswith("fx_") and p.content]
        if not content_parts:
            raise RigError("no opaque non-fx part to measure the content bounds from")
        x0 = min(p.content[0] for p in content_parts)
        y0 = min(p.content[1] for p in content_parts)
        x1 = max(p.content[2] for p in content_parts)
        y1 = max(p.content[3] for p in content_parts)
        self.content_img = (x0, y0, x1, y1)
        feet = self.rig.get("feet_y", "auto")
        feet_sk = self.img2sk(0, y1)[1] if feet in (None, "auto") else float(feet)
        body_y = self.rig.get("body_y", "auto")
        centre_sk = self.img2sk(0, (y0 + y1) / 2)[1]
        body_sk = centre_sk if body_y in (None, "auto") else float(body_y)

        specs: list[dict] = []
        specs.append({"name": "root", "parent": None, "world": (0.0, 0.0)})
        specs.append({"name": "squash", "parent": "root", "world": (0.0, feet_sk)})
        specs.append({"name": "body", "parent": "squash", "world": (0.0, body_sk)})
        declared = {s["name"] for s in specs}
        for bs in self.rig.get("bones", []) or []:
            if bs["name"] in declared:
                raise RigError(f"bone '{bs['name']}' declared twice (root/squash/body are automatic)")
            declared.add(bs["name"])
            specs.append(dict(bs))
        # bones referenced by parts but not declared -> joint/parent from the part
        for p in self.parts:
            if p.bone not in declared:
                pm = self.part_decls[p.name]
                j = pm.get("joint")
                if j is None:
                    j = [p.bbox[0] + p.bbox[2] / 2, p.bbox[1] + p.bbox[3] / 2]
                specs.append({"name": p.bone, "parent": pm.get("parent", "root" if p.bone.startswith("fx_") else "body"),
                              "joint": j, "tip": pm.get("tip")})
                declared.add(p.bone)

        by_name = {s["name"]: s for s in specs}
        ordered: list[dict] = []
        placed: set[str] = set()

        def place(s: dict, stack=()):
            if s["name"] in placed:
                return
            if s["name"] in stack:
                raise RigError(f"bone parent cycle at '{s['name']}'")
            par = s.get("parent", "body")
            if par is not None:
                if par not in by_name:
                    raise RigError(f"bone '{s['name']}': parent '{par}' not declared")
                place(by_name[par], stack + (s["name"],))
            ordered.append(s)
            placed.add(s["name"])

        for s in specs:
            place(s)

        bones: dict[str, Bone] = {}
        for s in ordered:
            name = s["name"]
            if name not in fixed:
                if not names_ok.match(name):
                    raise RigError(f"bone '{name}': snake_case names only")
                if not any(name.startswith(pf) for pf in prefixes):
                    self.report.warnings.append(f"bone '{name}' has no contract prefix ({', '.join(prefixes)})")
                if name.startswith("fx_") and s.get("parent", "body") != "root":
                    raise RigError(f"bone '{name}': fx_* bones are children of root (ANIMATION_CONTRACT 2.3)")
            par = s.get("parent", "body") if name != "root" else None
            b = Bone(name=name, parent=par)
            if "world" in s:
                b.wx, b.wy = s["world"]
            else:
                j = s.get("joint")
                if j is None:
                    pb = bones[par]
                    b.wx, b.wy = pb.wx, pb.wy
                else:
                    b.wx, b.wy = self.img2sk(float(j[0]), float(j[1]))
            tip = s.get("tip")
            if tip is not None:
                tx, ty = self.img2sk(float(tip[0]), float(tip[1]))
                b.wrot = math.degrees(math.atan2(ty - b.wy, tx - b.wx))
                b.length = math.hypot(tx - b.wx, ty - b.wy)
            else:
                b.wrot = float(s.get("rotation", 0.0))  # world rotation (deg, CCW, skeleton space)
                b.length = float(s.get("length", 0.0))
            if name == "body" and not b.length:
                b.length = float(self.rig.get("body_length", 60))
            b.inherit = s.get("inherit")
            b.color = s.get("color")
            if par is not None:
                pb = bones[par]
                b.x, b.y = pb.to_local(b.wx, b.wy)
                b.rotation = b.wrot - pb.wrot
            else:
                b.x, b.y, b.rotation = b.wx, b.wy, b.wrot
            bones[name] = b
        self.bones = bones
        self.bone_order = [s["name"] for s in ordered]
        for p in self.parts:
            if p.bone not in bones:
                raise RigError(f"part '{p.name}': bone '{p.bone}' missing")
        self.report.stats["feet_y"] = rnd(feet_sk, 2)
        self.report.stats["body_y"] = rnd(body_sk, 2)

    def bone_index(self, name: str) -> int:
        return self.bone_order.index(name)

    # ---------------------------------------------------------------- attachments
    def region(self, part: Part, bbox=None, path_suffix: str = "") -> dict:
        bb = bbox or part.bbox
        b = self.bones[part.bone]
        cx, cy = self.img2sk(bb[0] + bb[2] / 2, bb[1] + bb[3] / 2)
        lx, ly = b.to_local(cx, cy)
        m = {"path": f"{self.prefix}/{part.name}{path_suffix}"}
        if rnd(lx, 2):
            m["x"] = rnd(lx, 2)
        if rnd(ly, 2):
            m["y"] = rnd(ly, 2)
        if rnd(-b.wrot, 3):
            m["rotation"] = rnd(-b.wrot, 3)
        m["width"] = int(round(bb[2]))
        m["height"] = int(round(bb[3]))
        return m

    def mesh(self, part: Part, spec: dict) -> dict:
        kind = spec.get("type", "grid")
        if kind == "grid":
            pts, hull, tris = meshlib.grid(part.bbox, spec.get("cols", 3), spec.get("rows", 3))
        elif kind == "trace":
            pts, hull, tris = meshlib.trace(str(part.image), part.bbox, spacing=float(spec.get("spacing", 36)),
                                            pad=float(spec.get("pad", 4)), simplify=float(spec.get("simplify", 2)),
                                            interior=bool(spec.get("interior", True)))
        else:
            raise RigError(f"mesh '{part.name}': type must be grid or trace")
        x0, y0, w, h = part.bbox
        uvs: list[float] = []
        for px, py in pts:
            uvs += [rnd((px - x0) / w, 5), rnd((py - y0) / h, 5)]
        wspec = spec.get("weights")
        verts: list[float] = []
        if not wspec:
            b = self.bones[part.bone]
            for px, py in pts:
                lx, ly = b.to_local(*self.img2sk(px, py))
                verts += [rnd(lx, 2), rnd(ly, 2)]
            weighted = False
        else:
            mode = wspec.get("mode", "idw")
            if mode == "vertical":
                stops = [(str(bn), float(y)) for bn, y in wspec["stops"]]
                ws = meshlib.weights_vertical(pts, stops)
            elif mode == "idw":
                segs = {}
                for bn in wspec["bones"]:
                    if bn not in self.bones:
                        raise RigError(f"mesh '{part.name}': weight bone '{bn}' missing")
                    b = self.bones[bn]
                    ax, ay = b.wx + self.W / 2, self.H / 2 - b.wy
                    r = math.radians(b.wrot)
                    L = max(b.length, 0.0)
                    bx, by = ax + L * math.cos(r), ay - L * math.sin(r)
                    segs[bn] = ((ax, ay), (bx, by))
                ws = meshlib.weights_idw(pts, segs, power=float(wspec.get("power", 2)), max_bones=int(wspec.get("max", 4)))
            else:
                raise RigError(f"mesh '{part.name}': weights.mode must be vertical or idw")
            for (px, py), vw in zip(pts, ws):
                vw = meshlib.round_weights(vw)
                verts.append(len(vw))
                sx, sy = self.img2sk(px, py)
                for bn, wt in vw:
                    if bn not in self.bones:
                        raise RigError(f"mesh '{part.name}': weight bone '{bn}' missing")
                    lx, ly = self.bones[bn].to_local(sx, sy)
                    verts += [self.bone_index(bn), rnd(lx, 2), rnd(ly, 2), wt]
            weighted = True
        self.mesh_vertex_total += len(pts)
        self.report.stats.setdefault("meshes", {})[part.name] = {"vertices": len(pts), "triangles": len(tris) // 3,
                                                                  "hull": hull, "weighted": weighted}
        return {"type": "mesh", "path": f"{self.prefix}/{part.name}", "uvs": uvs, "triangles": list(map(int, tris)),
                "vertices": verts, "hull": int(hull), "width": int(round(w)), "height": int(round(h))}

    # ---------------------------------------------------------------- build
    def build(self) -> dict:
        self.load_parts()
        self.build_bones()
        self.mesh_vertex_total = 0
        C = self.contract
        meshes = self.rig.get("meshes", {}) or {}
        for mname in meshes:
            if mname not in self.part_by_name:
                raise RigError(f"meshes.{mname}: no such part")

        # slots in draw order (z, then declaration)
        parts_sorted = sorted(self.parts, key=lambda p: (p.z, p.order))
        slots, slot_seen = [], set()
        for p in parts_sorted:
            if p.slot in slot_seen:
                continue
            slot_seen.add(p.slot)
            is_fx = p.bone.startswith("fx_")
            if p.blend != "normal" and not is_fx:
                raise RigError(f"slot '{p.slot}': non-normal blend only on fx_* slots (ANIMATION_CONTRACT 2.4)")
            s = {"name": p.slot, "bone": p.bone}
            if p.color:
                s["color"] = p.color
            if not p.hidden:
                s["attachment"] = p.name
            if p.blend != "normal":
                s["blend"] = p.blend
            slots.append(s)

        # default skin
        atts: dict[str, dict] = {}
        blur_map: dict[str, str] = {}
        for p in parts_sorted:
            a = atts.setdefault(p.slot, {})
            a[p.name] = self.mesh(p, meshes[p.name]) if p.name in meshes else self.region(p)
            if p.blur_image is not None:
                a[f"{p.name}_blur"] = self.region(p, bbox=p.blur_bbox, path_suffix="_blur")
                blur_map[p.slot] = f"{p.name}_blur"
        skins = [{"name": "default", "attachments": {k: atts[k] for k in [s["name"] for s in slots] if k in atts}}]
        for skin_name, mapping in (self.rig.get("skins") or {}).items():
            if skin_name == "default":
                raise RigError("skins: 'default' is generated from parts.json")
            sk_atts: dict[str, dict] = {}
            for part_name, variant in (mapping or {}).items():
                if part_name not in self.part_by_name:
                    raise RigError(f"skins.{skin_name}.{part_name}: no such part")
                p = self.part_by_name[part_name]
                vimg = self.images_root / f"{self.prefix}/{variant}.png"
                if not vimg.exists():
                    raise RigError(f"skins.{skin_name}.{part_name}: {vimg} not found")
                if _png_size(vimg) != (int(p.bbox[2]), int(p.bbox[3])):
                    raise RigError(f"skins.{skin_name}.{part_name}: variant must match the part size")
                self.report.inputs.append(vimg)
                if part_name in meshes:  # 4.3: linked meshes name their `source` (was `parent` in 4.2)
                    m = {"type": "linkedmesh", "path": f"{self.prefix}/{variant}", "skin": "default",
                         "source": part_name, "width": int(p.bbox[2]), "height": int(p.bbox[3])}
                else:
                    m = self.region(p)
                    m["path"] = f"{self.prefix}/{variant}"
                sk_atts.setdefault(p.slot, {})[part_name] = m
            # skin placeholders must exist in the default skin; linkedmesh uses the default skin source
            skins.append({"name": skin_name, "attachments": sk_atts})

        # constraints: IK -> transform -> physics -> slider
        order = C["constraintOrder"]
        cons: list[dict] = []
        for c in self.rig.get("constraints", []) or []:
            t = c.get("type")
            if t not in ("ik", "transform", "slider"):
                raise RigError(f"constraints: type must be ik, transform or slider (physics goes under `physics:`), got {t}")
            cons.append(dict(c))
        pdef = dict(C["physics"]["defaults"])
        for ps in self.rig.get("physics", []) or []:
            if ps.get("bone") not in self.bones:
                raise RigError(f"physics: bone '{ps.get('bone')}' not declared")
            cons.append(physics_constraint(ps, pdef, C["physics"]["presets"]))
        for c in cons:
            if c["type"] == "physics":
                bl = self.bones[c["bone"]].length
                if c.get("rotate") and bl <= 0:
                    raise RigError(f"physics '{c['bone']}': rotate physics needs a bone length (give `tip` or `length`)")
        cons.sort(key=lambda c: (order.index(c["type"]), self.bone_index(c["bone"]) if c["type"] == "physics" else 0))
        phys_bones = {b for b in self.bone_order if b.startswith("phys_")}
        phys_cons = {c["bone"] for c in cons if c["type"] == "physics"}
        missing = sorted(phys_bones - phys_cons)
        if missing:
            raise RigError(f"phys_* bones without a physics constraint: {', '.join(missing)}")

        # events
        used_events = set()
        # motion
        params = motionlib.merge_params(self.rig.get("motion"))
        fx_slots = [s["name"] for s in slots if s["bone"].startswith("fx_")]
        part_slots = [s["name"] for s in slots if not s["bone"].startswith("fx_")]
        slot_alpha = {}
        for s in slots:
            col = s.get("color", "ffffffff")
            slot_alpha[s["name"]] = int(col[6:8], 16) / 255 if len(col) == 8 else 1.0
        eyes_cfg = (self.rig.get("roles") or {}).get("eyes")
        eyes = eyes_cfg if eyes_cfg is not None else [b for b in self.bone_order if re.match(r"^face_eye", b)]
        scatter = self._scatter_list()
        glow_bones = sorted({s["bone"] for s in slots if s["bone"].startswith("fx_")}, key=self.bone_index)
        body_slots = [s["name"] for s in slots if s["bone"] in ("body", "squash")]
        ctx = motionlib.MotionCtx(fps=self.fps, glow_slots=fx_slots, glow_bones=glow_bones, body_slots=body_slots,
                                  part_slots=part_slots, slot_alpha=slot_alpha,
                                  eyes=eyes, scatter=scatter, blur=blur_map,
                                  main_attachment={s["name"]: s.get("attachment") for s in slots}, params=params)
        anims: dict[str, dict] = {}
        accents = self.rig.get("accents") or {}
        loops = {k for k, v in C["animations"].items() if v["loop"]}
        built = {}
        for name in motionlib.ORDER:
            if not params[name]["enabled"]:
                continue
            a = motionlib.BUILDERS[name](ctx)
            if a is None:
                continue
            for spec in accents.get(name, []) or []:
                if spec.get("bone") not in self.bones:
                    raise RigError(f"accents.{name}: bone '{spec.get('bone')}' not declared")
                motionlib.apply_accent(a, spec, loop=name in loops)
            for ev in (self.rig.get("events") or {}).get(name, []) or []:
                payload = {k: ev[k] for k in ("int", "float", "string") if k in ev}
                a.event(motionlib._resolve_at(ev.get("at", 0), a.markers), ev["name"], **payload)
            built[name] = a
        for section in ("accents", "events"):
            for name in (self.rig.get(section) or {}):
                if name not in built:
                    raise RigError(f"{section}.{name}: animation not generated (known: {', '.join(built)})")
        for name, a in built.items():
            anims[name] = a.to_json()
            for e in a.events:
                used_events.add(e["name"])

        compat = (self.rig.get("compat") or {})
        if compat.get("runtime_aliases"):
            ra = C["runtimeAliases"]
            for alias, src in ra["animations"].items():
                if src in anims:
                    anims[alias] = json.loads(json.dumps(anims[src]))
            for alias, src in ra["events"].items():
                for an in anims.values():
                    evs = an.get("events", [])
                    extra = [dict(e, name=alias) for e in evs if e["name"] == src]
                    if extra:
                        an["events"] = sorted(evs + extra, key=lambda e: (e.get("time", 0), e["name"]))
                        used_events.add(alias)
            self.report.warnings.append("compat.runtime_aliases: emitted runtime alias names (remove once ANIMATION_CONTRACT §10 lands)")

        events = {}
        for name, ed in C["events"].items():
            if name in used_events or name in ("sfx", "vfx", "shake"):
                events[name] = dict(ed)
        for name in sorted(used_events - set(events)):
            events[name] = {}

        # bounds of the setup pose (nonessential header data)
        cx0, cy0, cx1, cy1 = self.content_img
        sx0, sy1 = self.img2sk(cx0, cy0)
        sx1, sy0 = self.img2sk(cx1, cy1)

        images = self.images_override
        if images is None:
            base = self.out_path.parent if self.out_path else Path.cwd()
            images = os.path.relpath(self.images_root, base).replace(os.sep, "/") + "/"

        bones_json = []
        for name in self.bone_order:
            b = self.bones[name]
            m: dict = {"name": name}
            if b.parent:
                m["parent"] = b.parent
            if b.length:
                m["length"] = rnd(b.length, 2)
            if rnd(b.rotation, 3):
                m["rotation"] = rnd(b.rotation, 3)
            if rnd(b.x, 2):
                m["x"] = rnd(b.x, 2)
            if rnd(b.y, 2):
                m["y"] = rnd(b.y, 2)
            if b.inherit:
                m["inherit"] = b.inherit
            if b.color:
                m["color"] = b.color
            bones_json.append(m)

        doc = {
            "skeleton": {
                "hash": "",
                "spine": self.spine_version,
                "x": rnd(sx0, 2), "y": rnd(sy0, 2), "width": rnd(sx1 - sx0, 2), "height": rnd(sy1 - sy0, 2),
                "fps": self.fps,
                "referenceScale": C["referenceScale"],
                "images": images,
            },
            "bones": bones_json,
            "slots": slots,
            "constraints": cons,
            "skins": skins,
            "events": events,
            "animations": anims,
        }
        if not cons:
            doc.pop("constraints")
        doc["skeleton"]["hash"] = _hash(doc)

        B = C["budgets"]
        st = self.report.stats
        st.update({"bones": len(bones_json), "slots": len(slots), "meshVertices": self.mesh_vertex_total,
                   "constraints": [f"{c['type']}:{c['name']}" for c in cons], "animations": list(anims)})
        for k, lim in (("bones", B["bones"]), ("slots", B["slots"]), ("meshVertices", B["meshVertices"])):
            if st[k] > lim:
                raise RigError(f"budget: {k} {st[k]} > {lim} (ANIMATION_CONTRACT 2.6)")
        return doc

    def _scatter_list(self) -> list[tuple[str, float, float, float]]:
        carriers = []
        for p in self.parts:
            b = p.bone
            if b in ("root", "squash", "body") or b.startswith("fx_"):
                continue
            if b not in carriers:
                carriers.append(b)
        cs = set(carriers)

        def has_ancestor(b: str) -> bool:
            par = self.bones[b].parent
            while par:
                if par in cs:
                    return True
                par = self.bones[par].parent
            return False

        body = self.bones["body"]
        out = []
        for b in carriers:
            if has_ancestor(b):
                continue
            ps = [p for p in self.parts if p.bone == b]
            cx = sum(p.bbox[0] + p.bbox[2] / 2 for p in ps) / len(ps)
            cy = sum(p.bbox[1] + p.bbox[3] / 2 for p in ps) / len(ps)
            wx, wy = self.img2sk(cx, cy)
            dx, dy = wx - body.wx, wy - body.wy
            n = math.hypot(dx, dy)
            dx, dy = (0.0, 1.0) if n < 1e-6 else (dx / n, dy / n)
            par = self.bones[self.bones[b].parent]
            lx, ly = par.dir_to_local(dx, dy)
            out.append((b, round(lx, 4), round(ly, 4), -1.0 if dx > 0 else 1.0))
        return out


def dump(doc: dict) -> str:
    """Deterministic, diff-friendly JSON (key order as built; 1 space indent like Spine exports)."""
    return json.dumps(doc, indent=1, ensure_ascii=False) + "\n"
