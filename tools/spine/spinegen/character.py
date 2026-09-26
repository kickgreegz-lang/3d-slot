"""rig.yaml (kind: character) + parts.json -> Spine 4.3 2D character skeleton (ANIMATION_SET section 5).

Coordinates in parts.json / rig.yaml are IMAGE space of the character canvas (x right, y DOWN,
origin top-left, @2x units = 2x the landscape design rect, e.g. Gumbo 868x992, Croak 720x1260).
`root` sits at `anchor` (default [0.5, 1.0] = the feet point of layout.json mascots.*.feet), so
(x, y)_image -> (x - ax*W, ay*H - y)_skeleton (Y up).

What it writes (deterministic):
  * the biped hierarchy from named landmarks (template: biped): root > hips > spine > chest >
    neck > head > jaw, arm chains off the chest, leg chains off the hips, ik_foot_* targets under
    root (feet planted: each foot rides its target), optional ik_hand_* targets, ctrl_look;
  * part bones from parts.json (face_*, phys_*, props), physics springs, weighted meshes;
  * slots in draw order with attachment variants (eye states, mouth shapes, hand poses);
  * ONE root constraints[] (IK -> transform -> physics): foot/hand IK with bendPositive taken from
    the setup pose, the `look` / `look_eyes` transform constraints driven by ctrl_look;
  * the clip set of tools/spine/contract.json characters.rigs.<skeleton> (ANIMATION_SET 5.1/5.2),
    authored by spinegen/acting.py from rig.yaml `poses` + `clips`.
"""
from __future__ import annotations

import json
import math
import os
import re
from pathlib import Path

import yaml

from . import acting
from . import mesh as meshlib
from .easing import rnd
from .physics import constraint as physics_constraint
from .rig import (Bone, RigError, Report, _hash, _opaque_bbox, _png_size, check_keys, check_list, load_contract)

CHAR_GEN_VERSION = "1.0.0"
CHAR_RIG_KEYS = {"kind", "skeleton", "parts", "spine_version", "anchor", "facing", "near", "tempo", "template",
                 "landmarks", "bones", "inherit", "meshes", "physics", "constraints", "ik", "look", "groups", "face",
                 "poses", "stance", "clips", "draw_order", "slots", "proportions", "drag", "match_ik"}
BONE_KEYS = {"name", "parent", "joint", "tip", "rotation", "length", "inherit", "color"}
MESH_KEYS = {"type", "cols", "rows", "spacing", "pad", "simplify", "interior", "weights"}
WEIGHT_KEYS = {"mode", "stops", "bones", "power", "max"}
PHYSICS_KEYS = {"bone", "name", "preset", "f", "zeta", "mass", "inertia", "fps", "limit", "strength", "damping",
                "x", "y", "rotate", "scaleX", "scaleY", "shearX", "wind", "gravity", "mix"}
IK_KEYS = {"feet", "hands", "hand_parent", "hand_mix", "softness"}
LOOK_KEYS = {"at", "head", "pupils"}
LOOK_HEAD_KEYS = {"bone", "mix", "deg_per_100", "max"}
LOOK_PUPIL_KEYS = {"bones", "per_100", "max", "mix"}
SLOT_KEYS = {"bone", "blend", "color", "setup", "z"}
PART_KEYS = {"name", "slot", "attachment", "image", "bbox", "z", "bone", "parent", "joint", "tip", "blend", "color",
             "hidden", "setup", "$comment"}
SIDES = ("L", "R")
BIPED_REQUIRED = ["hips", "chest", "neck", "head", "head_top"] + [
    f"{n}_{s}" for s in SIDES for n in ("shoulder", "elbow", "wrist", "hand", "hip", "knee", "ankle", "toe")]
DEFAULT_INHERIT = {"neck": "noScale"}  # never on IK chains: spine-core 2-bone IK assumes normal inheritance


def _biped_specs(lm: dict, ik_feet: bool, ik_hands: list[str], hand_parent: str) -> list[dict]:
    specs = [
        {"name": "hips", "parent": "root", "joint": lm["hips"], "tip": lm["spine"]},
        {"name": "spine", "parent": "hips", "joint": lm["spine"], "tip": lm["chest"]},
        {"name": "chest", "parent": "spine", "joint": lm["chest"], "tip": lm["neck"]},
        {"name": "neck", "parent": "chest", "joint": lm["neck"], "tip": lm["head"]},
        {"name": "head", "parent": "neck", "joint": lm["head"], "tip": lm["head_top"]},
    ]
    if "jaw" in lm and "chin" in lm:
        specs.append({"name": "jaw", "parent": "head", "joint": lm["jaw"], "tip": lm["chin"]})
    for s in SIDES:
        specs += [
            {"name": f"upper_arm_{s}", "parent": "chest", "joint": lm[f"shoulder_{s}"], "tip": lm[f"elbow_{s}"]},
            {"name": f"forearm_{s}", "parent": f"upper_arm_{s}", "joint": lm[f"elbow_{s}"], "tip": lm[f"wrist_{s}"]},
            {"name": f"hand_{s}", "parent": f"forearm_{s}", "joint": lm[f"wrist_{s}"], "tip": lm[f"hand_{s}"]},
            {"name": f"thigh_{s}", "parent": "hips", "joint": lm[f"hip_{s}"], "tip": lm[f"knee_{s}"]},
            {"name": f"shin_{s}", "parent": f"thigh_{s}", "joint": lm[f"knee_{s}"], "tip": lm[f"ankle_{s}"]},
        ]
        if ik_feet:
            specs.append({"name": f"ik_foot_{s}", "parent": "root", "joint": lm[f"ankle_{s}"]})
        specs.append({"name": f"foot_{s}", "parent": f"ik_foot_{s}" if ik_feet else f"shin_{s}",
                      "joint": lm[f"ankle_{s}"], "tip": lm[f"toe_{s}"]})
        if s in ik_hands:
            specs.append({"name": f"ik_hand_{s}", "parent": hand_parent, "joint": lm[f"wrist_{s}"]})
    specs.append({"name": "ctrl_look", "parent": "root", "joint": lm["look"]})
    return specs


class CharacterBuilder:
    kind = "character"

    def __init__(self, rig_path: str | os.PathLike, out_path: str | os.PathLike | None = None,
                 images_path: str | None = None, spine_version: str | None = None):
        self.contract = load_contract()
        self.CC = self.contract["characters"]
        self.rig_path = Path(rig_path).resolve()
        self.rig_dir = self.rig_path.parent
        try:
            self.rig = yaml.safe_load(self.rig_path.read_text(encoding="utf-8")) or {}
        except yaml.YAMLError as e:
            raise RigError(f"{rig_path}: invalid YAML: {e}") from None
        if not isinstance(self.rig, dict):
            raise RigError(f"{rig_path}: expected a YAML mapping at the top level")
        self._check_schema()
        self.report = Report(inputs=[self.rig_path])
        self.out_path = Path(out_path).resolve() if out_path else None
        self.images_override = images_path
        self.spine_version = spine_version or str(self.rig.get("spine_version") or self.contract["spineVersion"])
        self.fps = int(self.contract["fps"])
        name = self.rig.get("skeleton")
        if not name or not re.match(r"^chr_[a-z0-9_]+$", str(name)):
            raise RigError("rig.yaml: `skeleton` (chr_<id>, e.g. chr_gumbo) is required for kind: character")
        self.skel_name = str(name)
        self.prefix = self.skel_name
        facing = str(self.rig.get("facing", "right"))
        if facing not in ("right", "left"):
            raise RigError("rig.yaml facing: right | left (the screen direction the character faces)")
        self.facing = 1 if facing == "right" else -1
        self.tempo = float(self.rig.get("tempo", 1.0))
        if not 0.5 <= self.tempo <= 2.0:
            raise RigError("rig.yaml tempo: 0.5-2.0 (ANIMATION_SET: Gumbo 0.92, Croak 1.06)")
        self.spec = self.CC.get("rigs", {}).get(self.skel_name, {})

    # ---------------------------------------------------------------- schema
    def _check_schema(self) -> None:
        r = self.rig
        check_keys(r, CHAR_RIG_KEYS, "rig.yaml (kind: character)")
        for i, b in enumerate(check_list(r.get("bones"), "bones")):
            check_keys(b, BONE_KEYS, f"bones[{i}]")
            if "name" not in b:
                raise RigError(f"bones[{i}]: `name` is required")
        meshes = r.get("meshes") or {}
        check_keys(meshes, set(meshes), "meshes")
        for m, spec in meshes.items():
            check_keys(spec, MESH_KEYS, f"meshes.{m}")
            check_keys((spec or {}).get("weights"), WEIGHT_KEYS, f"meshes.{m}.weights")
        for i, ps in enumerate(check_list(r.get("physics"), "physics")):
            check_keys(ps, PHYSICS_KEYS, f"physics[{i}]")
        check_keys(r.get("ik"), IK_KEYS, "ik")
        look = r.get("look") or {}
        check_keys(look, LOOK_KEYS, "look")
        check_keys(look.get("head"), LOOK_HEAD_KEYS, "look.head")
        check_keys(look.get("pupils"), LOOK_PUPIL_KEYS, "look.pupils")
        for s, spec in (r.get("slots") or {}).items():
            check_keys(spec, SLOT_KEYS, f"slots.{s}")
        check_keys(r.get("face"), {"hide_pupils"}, "face")
        check_keys(r.get("proportions"), {"exclude", "head_max"}, "proportions")
        check_keys(r.get("drag"), {"chains", "lag", "gain", "body"}, "drag")
        for c in check_list(r.get("constraints"), "constraints"):
            if not isinstance(c, dict):
                raise RigError("constraints: expected mappings")
        clips = r.get("clips") or {}
        if not isinstance(clips, dict):
            raise RigError("clips: expected a mapping {clip: spec}")
        poses = r.get("poses") or {}
        if not isinstance(poses, dict):
            raise RigError("poses: expected a mapping {pose: spec}")

    # ---------------------------------------------------------------- coordinates
    def img2sk(self, x: float, y: float) -> tuple[float, float]:
        return x - self.ax * self.W, self.ay * self.H - y

    def sk2img(self, x: float, y: float) -> tuple[float, float]:
        return x + self.ax * self.W, self.ay * self.H - y

    # ---------------------------------------------------------------- parts
    def load_parts(self) -> None:
        pj = self.rig_dir / str(self.rig.get("parts", "parts.json"))
        if not pj.exists():
            raise RigError(f"parts file not found: {pj}")
        self.report.inputs.append(pj)
        doc = json.loads(pj.read_text(encoding="utf-8"))
        canvas = doc.get("canvas")
        if not canvas or len(canvas) != 2:
            raise RigError("parts.json: `canvas: [W, H]` (character canvas @2x) is required")
        self.W, self.H = float(canvas[0]), float(canvas[1])
        anchor = self.rig.get("anchor", doc.get("anchor", self.CC["anchor"]))
        self.ax, self.ay = float(anchor[0]), float(anchor[1])
        if doc.get("skeleton") and doc["skeleton"] != self.skel_name:
            raise RigError(f"parts.json skeleton '{doc['skeleton']}' != rig.yaml skeleton '{self.skel_name}'")
        root = (pj.parent / str(doc.get("images", "images"))).resolve()
        self.images_root = root
        self.landmarks = {k: [float(v[0]), float(v[1])] for k, v in (doc.get("landmarks") or {}).items()}
        for k, v in (self.rig.get("landmarks") or {}).items():
            self.landmarks[str(k)] = [float(v[0]), float(v[1])]
        parts = []
        seen = set()
        slot_meta: dict[str, dict] = {}
        for i, pm in enumerate(doc.get("parts", [])):
            check_keys(pm, PART_KEYS, f"parts.json parts[{i}]")
            slot = str(pm.get("slot") or pm.get("name") or "")
            if not re.match(r"^[a-z][a-z0-9_]*(_[LR])?$", slot):
                raise RigError(f"parts.json parts[{i}]: slot '{slot}' must be snake_case (L/R suffix allowed)")
            att = str(pm.get("attachment") or slot)
            if not re.match(r"^[A-Za-z0-9_]+$", att):
                raise RigError(f"parts.json parts[{i}]: attachment '{att}' must be [A-Za-z0-9_]")
            pid = slot if att == slot else f"{slot}/{att}"
            if pid in seen:
                raise RigError(f"parts.json: duplicate part '{pid}'")
            seen.add(pid)
            rel = pm.get("image") or (f"{self.prefix}/{slot}.png" if att == slot else f"{self.prefix}/{slot}/{att}.png")
            img = root / rel
            if not img.exists():
                raise RigError(f"part '{pid}': image not found: {img}")
            w, h = _png_size(img)
            bb = pm.get("bbox")
            if bb is None:
                raise RigError(f"part '{pid}': bbox [x, y, w, h] (canvas image space) is required")
            if int(round(bb[2])) != w or int(round(bb[3])) != h:
                raise RigError(f"part '{pid}': bbox size {bb[2]}x{bb[3]} != image {w}x{h}")
            content = _opaque_bbox(img)
            if content is not None:
                content = (content[0] + bb[0], content[1] + bb[1], content[2] + bb[0], content[3] + bb[1])
            meta = slot_meta.setdefault(slot, {"order": i})
            for k in ("z", "bone", "parent", "joint", "tip", "blend", "color", "hidden"):
                if k in pm:
                    if k in meta and meta[k] != pm[k]:
                        raise RigError(f"part '{pid}': {k} {pm[k]} conflicts with {meta[k]} of another '{slot}' variant")
                    meta[k] = pm[k]
            if pm.get("setup"):
                if meta.get("setup") not in (None, att):
                    raise RigError(f"slot '{slot}': two setup attachments")
                meta["setup"] = att
            path = rel[:-4] if rel.endswith(".png") else rel
            parts.append({"id": pid, "slot": slot, "attachment": att, "image": img, "bbox": tuple(float(v) for v in bb),
                          "content": content, "path": path, "order": i})
            self.report.inputs.append(img)
        if not parts:
            raise RigError("parts.json has no parts")
        self.parts = parts
        self.part_by_id = {p["id"]: p for p in parts}
        self.slot_meta = slot_meta

    # ---------------------------------------------------------------- bones
    def _landmarks_full(self) -> dict:
        lm = dict(self.landmarks)
        missing = [k for k in BIPED_REQUIRED if k not in lm]
        if missing:
            raise RigError(f"biped template: missing landmark(s) {', '.join(missing)} (parts.json `landmarks` or rig.yaml `landmarks`)")
        if "spine" not in lm:
            h, c = lm["hips"], lm["chest"]
            lm["spine"] = [round((h[0] + c[0]) / 2, 2), round((h[1] + c[1]) / 2, 2)]
        look = (self.rig.get("look") or {}).get("at")
        if look is not None:
            lm["look"] = [float(look[0]), float(look[1])]
        elif "look" not in lm:
            hd, top = lm["head"], lm["head_top"]
            hh = abs(hd[1] - top[1])
            lm["look"] = [round(hd[0] + self.facing * 2.2 * hh, 2), round((hd[1] + top[1]) / 2, 2)]
        return lm

    def build_bones(self) -> None:
        template = self.rig.get("template", "biped")
        if template not in ("biped", None, "none"):
            raise RigError("template: biped | none")
        ikc = self.rig.get("ik") or {}
        self.ik_feet = bool(ikc.get("feet", True))
        self.ik_hands = [str(s) for s in (ikc.get("hands") or [])]
        for s in self.ik_hands:
            if s not in SIDES:
                raise RigError("ik.hands: list of L / R")
        hand_parent = str(ikc.get("hand_parent", "root"))
        specs = [{"name": "root", "parent": None, "world": (0.0, 0.0)}]
        if template == "biped":
            self.lm = self._landmarks_full()
            specs += _biped_specs(self.lm, self.ik_feet, self.ik_hands, hand_parent)
        else:
            self.lm = dict(self.landmarks)
        declared = {s["name"] for s in specs}
        for bs in self.rig.get("bones") or []:
            if bs["name"] in declared:
                raise RigError(f"bone '{bs['name']}' declared twice (the biped template makes root, core, limbs, ik_*, ctrl_look)")
            declared.add(bs["name"])
            specs.append(dict(bs))
        for slot, meta in sorted(self.slot_meta.items(), key=lambda kv: kv[1]["order"]):
            b = meta.get("bone") or slot
            meta["bone"] = b
            if b not in declared:
                j = meta.get("joint")
                if j is None:
                    ps = [p for p in self.parts if p["slot"] == slot]
                    bb = ps[0]["bbox"]
                    j = [bb[0] + bb[2] / 2, bb[1] + bb[3] / 2]
                specs.append({"name": b, "parent": meta.get("parent", "root" if b.startswith("fx_") else "head"),
                              "joint": j, "tip": meta.get("tip")})
                declared.add(b)
        for s, sc in (self.rig.get("slots") or {}).items():
            b = (sc or {}).get("bone")
            if b and b not in declared:
                raise RigError(f"slots.{s}: bone '{b}' is not declared")
        by_name = {s["name"]: s for s in specs}
        ordered: list[dict] = []
        placed: set[str] = set()

        def place(s: dict, stack=()):
            if s["name"] in placed:
                return
            if s["name"] in stack:
                raise RigError(f"bone parent cycle at '{s['name']}'")
            par = s.get("parent", "root") if s["name"] != "root" else None
            if par is not None:
                if par not in by_name:
                    raise RigError(f"bone '{s['name']}': parent '{par}' not declared")
                place(by_name[par], stack + (s["name"],))
            ordered.append(s)
            placed.add(s["name"])

        for s in specs:
            place(s)
        inherit = dict(DEFAULT_INHERIT)
        inherit.update({str(k): str(v) for k, v in (self.rig.get("inherit") or {}).items()})
        names_ok = re.compile(self.contract["boneNames"]["pattern"])
        words = set(self.CC["boneNames"]["words"]) | set(self.CC["boneNames"]["core"])
        limbs = self.CC["boneNames"]["limbs"]
        prefixes = self.CC["boneNames"]["prefixes"]
        bones: dict[str, Bone] = {}
        for s in ordered:
            name = s["name"]
            if not names_ok.match(name):
                raise RigError(f"bone '{name}': snake_case names only")
            stem = re.sub(r"_[LR]$", "", name)
            if name != "root" and not (stem in words or stem in limbs or any(name.startswith(p) for p in prefixes)):
                self.report.warnings.append(f"bone '{name}' is not a contract word ({', '.join(sorted(words))}) and has no prefix ({', '.join(prefixes)})")
            if name.startswith("fx_") and s.get("parent", "root") != "root":
                raise RigError(f"bone '{name}': fx_* bones are children of root")
            par = s.get("parent", "root") if name != "root" else None
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
                b.wrot = float(s.get("rotation", 0.0))
                b.length = float(s.get("length", 0.0))
            b.inherit = s.get("inherit") or inherit.get(name)
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
        for s, meta in self.slot_meta.items():
            if meta["bone"] not in bones:
                raise RigError(f"slot '{s}': bone '{meta['bone']}' missing")

    def bone_index(self, name: str) -> int:
        return self.bone_order.index(name)

    # ---------------------------------------------------------------- attachments
    def region(self, part: dict, bone: str) -> dict:
        bb = part["bbox"]
        b = self.bones[bone]
        cx, cy = self.img2sk(bb[0] + bb[2] / 2, bb[1] + bb[3] / 2)
        lx, ly = b.to_local(cx, cy)
        m = {"path": part["path"]}
        if rnd(lx, 2):
            m["x"] = rnd(lx, 2)
        if rnd(ly, 2):
            m["y"] = rnd(ly, 2)
        if rnd(-b.wrot, 3):
            m["rotation"] = rnd(-b.wrot, 3)
        m["width"] = int(round(bb[2]))
        m["height"] = int(round(bb[3]))
        return m

    def mesh(self, part: dict, bone: str, spec: dict) -> dict:
        kind = spec.get("type", "grid")
        if kind == "grid":
            pts, hull, tris = meshlib.grid(part["bbox"], spec.get("cols", 3), spec.get("rows", 3))
        elif kind == "trace":
            pts, hull, tris = meshlib.trace(str(part["image"]), part["bbox"], spacing=float(spec.get("spacing", 48)),
                                            pad=float(spec.get("pad", 4)), simplify=float(spec.get("simplify", 2)),
                                            interior=bool(spec.get("interior", True)))
        else:
            raise RigError(f"mesh '{part['id']}': type must be grid or trace")
        x0, y0, w, h = part["bbox"]
        uvs: list[float] = []
        for px, py in pts:
            uvs += [rnd((px - x0) / w, 5), rnd((py - y0) / h, 5)]
        wspec = spec.get("weights")
        verts: list[float] = []
        if not wspec:
            b = self.bones[bone]
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
                        raise RigError(f"mesh '{part['id']}': weight bone '{bn}' missing")
                    b = self.bones[bn]
                    ax, ay = self.sk2img(b.wx, b.wy)
                    r = math.radians(b.wrot)
                    L = max(b.length, 0.0)
                    bx, by = self.sk2img(b.wx + L * math.cos(r), b.wy + L * math.sin(r))
                    segs[bn] = ((ax, ay), (bx, by))
                ws = meshlib.weights_idw(pts, segs, power=float(wspec.get("power", 2)), max_bones=int(wspec.get("max", 4)))
            else:
                raise RigError(f"mesh '{part['id']}': weights.mode must be vertical or idw")
            for (px, py), vw in zip(pts, ws):
                vw = meshlib.round_weights(vw)
                verts.append(len(vw))
                sx, sy = self.img2sk(px, py)
                for bn, wt in vw:
                    if bn not in self.bones:
                        raise RigError(f"mesh '{part['id']}': weight bone '{bn}' missing")
                    lx, ly = self.bones[bn].to_local(sx, sy)
                    verts += [self.bone_index(bn), rnd(lx, 2), rnd(ly, 2), wt]
            weighted = True
        self.mesh_vertex_total += len(pts)
        self.report.stats.setdefault("meshes", {})[part["id"]] = {"vertices": len(pts), "triangles": len(tris) // 3,
                                                                   "hull": hull, "weighted": weighted}
        return {"type": "mesh", "path": part["path"], "uvs": uvs, "triangles": list(map(int, tris)),
                "vertices": verts, "hull": int(hull), "width": int(round(w)), "height": int(round(h))}

    def build_slots(self) -> None:
        extra = self.rig.get("slots") or {}
        metas = dict(self.slot_meta)
        for s, sc in extra.items():
            sc = sc or {}
            if s in metas:
                for k in ("blend", "color", "z"):
                    if k in sc:
                        metas[s][k] = sc[k]
                if "setup" in sc:
                    metas[s]["setup"] = sc["setup"]
                if "bone" in sc and sc["bone"] != metas[s]["bone"]:
                    raise RigError(f"slots.{s}.bone: the parts put '{s}' on '{metas[s]['bone']}'")
                continue
            if "bone" not in sc:
                raise RigError(f"slots.{s}: an empty slot needs `bone`")
            metas[s] = {"bone": sc["bone"], "blend": sc.get("blend", "normal"), "color": sc.get("color"),
                        "z": sc.get("z", 1e6), "order": 10 ** 6 + len(metas), "empty": True}
        order = self.rig.get("draw_order")
        if order:
            order = [str(s) for s in order]
            missing = sorted(set(metas) - set(order))
            unknown = sorted(set(order) - set(metas))
            if missing or unknown or len(order) != len(set(order)):
                raise RigError(f"draw_order must list every slot once (missing: {', '.join(missing) or '-'}; "
                               f"unknown: {', '.join(unknown) or '-'})")
        else:
            order = sorted(metas, key=lambda s: (float(metas[s].get("z", 0)), metas[s]["order"]))
        self.slot_order = order
        meshes = self.rig.get("meshes") or {}
        for m in meshes:
            if m not in self.part_by_id:
                raise RigError(f"meshes.{m}: no such part (part ids: <slot> or <slot>/<attachment>)")
        self.mesh_vertex_total = 0
        slots, atts = [], {}
        self.slot_atts: dict[str, list[str]] = {}
        self.slot_setup: dict[str, str | None] = {}
        for s in order:
            meta = metas[s]
            bone = meta["bone"]
            blend = str(meta.get("blend", "normal"))
            if blend != "normal" and not bone.startswith("fx_"):
                raise RigError(f"slot '{s}': non-normal blend only on fx_* slots (one draw call per character)")
            variants = [p for p in self.parts if p["slot"] == s]
            names = [p["attachment"] for p in variants]
            setup = None if meta.get("hidden") or meta.get("empty") else (meta.get("setup") or (names[0] if names else None))
            if setup is not None and setup not in names:
                raise RigError(f"slot '{s}': setup attachment '{setup}' has no part")
            e = {"name": s, "bone": bone}
            if meta.get("color"):
                e["color"] = meta["color"]
            if setup is not None:
                e["attachment"] = setup
            if blend != "normal":
                e["blend"] = blend
            slots.append(e)
            self.slot_atts[s] = names
            self.slot_setup[s] = setup
            if variants:
                a = {}
                for p in variants:
                    a[p["attachment"]] = self.mesh(p, bone, meshes[p["id"]]) if p["id"] in meshes else self.region(p, bone)
                atts[s] = a
        self.slots = slots
        self.skins = [{"name": "default", "attachments": {k: atts[k] for k in order if k in atts}}]
        self.slot_bone = {s["name"]: s["bone"] for s in slots}

    # ---------------------------------------------------------------- constraints
    def build_constraints(self) -> None:
        cons: list[dict] = []
        self.ik_infos: dict[str, acting.IkInfo] = {}
        ikc = self.rig.get("ik") or {}
        soft = float(ikc.get("softness", 0))

        def add_ik(name: str, chain: list[str], target: str, mix: float):
            p, c = (self.bones[b] for b in chain)
            # bend from the setup pose: cross(knee - hip, ankle - knee) > 0 (y up) -> bendPositive
            r = math.radians(c.wrot)
            ex, ey = c.wx + c.length * math.cos(r), c.wy + c.length * math.sin(r)
            cross = (c.wx - p.wx) * (ey - c.wy) - (c.wy - p.wy) * (ex - c.wx)
            if abs(cross) < 1e-6:
                raise RigError(f"IK '{name}': {chain[0]}/{chain[1]} are straight in the setup pose; bend the joint a little")
            bend = cross > 0
            t = self.bones[target]
            miss = math.hypot(t.wx - ex, t.wy - ey)
            if miss > 1.0:
                self.report.warnings.append(f"IK '{name}': target is {miss:.1f} units from the chain end at setup (the setup pose will move)")
            m = {"type": "ik", "name": name, "bones": chain, "target": target}
            if mix != 1:
                m["mix"] = rnd(mix, 4)
            if soft:
                m["softness"] = rnd(soft, 2)
            if not bend:
                m["bendPositive"] = False
            cons.append(m)
            self.ik_infos[name] = acting.IkInfo(name=name, bones=chain, target=target, bend=1 if bend else -1, mix=mix)

        if self.ik_feet:
            for s in SIDES:
                add_ik(f"ik_foot_{s}", [f"thigh_{s}", f"shin_{s}"], f"ik_foot_{s}", 1.0)
        for s in self.ik_hands:
            add_ik(f"ik_hand_{s}", [f"upper_arm_{s}", f"forearm_{s}"], f"ik_hand_{s}", float(ikc.get("hand_mix", 0)))
        for c in self.rig.get("constraints") or []:
            t = c.get("type")
            if t not in ("ik", "transform", "slider"):
                raise RigError(f"constraints: type must be ik, transform or slider (physics goes under `physics:`), got {t}")
            cons.append(dict(c))
            if t == "ik":
                self.ik_infos[c["name"]] = acting.IkInfo(name=c["name"], bones=list(c["bones"]), target=c["target"],
                                                         bend=1 if c.get("bendPositive", True) else -1,
                                                         mix=float(c.get("mix", 1)))
        # look-at: ctrl_look (runtime aim target, track 3) -> head rotation (mix 0.6) + pupil shift (mix 1)
        look = self.rig.get("look") or {}
        cl = self.bones.get("ctrl_look")
        if cl is not None:
            lh = dict({"bone": "head", "mix": 0.6, "deg_per_100": 6.0, "max": 14.0}, **(look.get("head") or {}))
            k = self.facing * float(lh["deg_per_100"]) / 100.0
            R = float(lh["max"])
            if lh["bone"] not in self.bones:
                raise RigError(f"look.head.bone '{lh['bone']}' missing")
            cons.append({"type": "transform", "name": "look", "bones": [lh["bone"]], "source": "ctrl_look",
                         "localSource": True, "localTarget": True, "additive": True, "clamp": True,
                         "properties": {"y": {"offset": rnd(cl.y - R / k, 3), "to": {"rotate": {"offset": -R, "max": R, "scale": rnd(k, 5)}}}},
                         "mixRotate": rnd(float(lh["mix"]), 3)})
            lp = look.get("pupils")
            pupils = [b for b in self.bone_order if re.match(r"^face_pupil_[LR]$", b)]
            if lp is None:
                lp = {"bones": pupils} if pupils else None
            elif "bones" not in lp:
                lp = dict(lp, bones=pupils)
            if lp and lp["bones"]:
                lp = dict({"per_100": 4.0, "max": [7.0, 5.0], "mix": 1.0}, **lp)
                for b in lp["bones"]:
                    if b not in self.bones:
                        raise RigError(f"look.pupils: bone '{b}' missing")
                    if abs(self.bones[b].wrot) > 0.5:
                        self.report.warnings.append(f"look: pupil bone '{b}' is rotated {self.bones[b].wrot:.1f} deg at setup; its x/y will not be screen x/y")
                s = float(lp["per_100"]) / 100.0
                mx, my = (float(v) for v in lp["max"])
                cons.append({"type": "transform", "name": "look_eyes", "bones": list(lp["bones"]), "source": "ctrl_look",
                             "localSource": True, "localTarget": True, "additive": True, "clamp": True,
                             "properties": {"x": {"offset": rnd(cl.x - mx / s, 3), "to": {"x": {"offset": -mx, "max": mx, "scale": rnd(s, 5)}}},
                                            "y": {"offset": rnd(cl.y - my / s, 3), "to": {"y": {"offset": -my, "max": my, "scale": rnd(s, 5)}}}},
                             "mixX": rnd(float(lp["mix"]), 3), "mixY": rnd(float(lp["mix"]), 3)})
        pdef = dict(self.contract["physics"]["defaults"])
        pdef.update(self.CC["physics"]["defaults"])
        for ps in self.rig.get("physics") or []:
            if ps.get("bone") not in self.bones:
                raise RigError(f"physics: bone '{ps.get('bone')}' not declared")
            try:
                cons.append(physics_constraint(ps, pdef, self.contract["physics"]["presets"]))
            except ValueError as e:
                raise RigError(str(e)) from None
        for c in cons:
            if c["type"] == "physics" and c.get("rotate") and self.bones[c["bone"]].length <= 0:
                raise RigError(f"physics '{c['bone']}': rotate physics needs a bone length (give `tip` or `length`)")
        order = self.contract["constraintOrder"]
        cons.sort(key=lambda c: (order.index(c["type"]), self.bone_index(c["bone"]) if c["type"] == "physics" else 0))
        phys_bones = {b for b in self.bone_order if b.startswith("phys_")}
        phys_cons = {c["bone"] for c in cons if c["type"] == "physics"}
        missing = sorted(phys_bones - phys_cons)
        if missing:
            raise RigError(f"phys_* bones without a physics constraint: {', '.join(missing)}")
        self.constraints = cons

    # ---------------------------------------------------------------- clips
    def _acting_rig(self) -> acting.ActingRig:
        bones = {}
        for n in self.bone_order:
            b = self.bones[n]
            bones[n] = acting.BoneInfo(name=n, parent=b.parent, x=b.x, y=b.y, rotation=b.rotation, length=b.length,
                                       wrot=b.wrot, wx=b.wx, wy=b.wy, inherit=b.inherit)
        slots = {s: acting.SlotInfo(name=s, bone=self.slot_bone[s], attachments=list(self.slot_atts[s]),
                                    setup=self.slot_setup[s]) for s in self.slot_order}
        groups: dict[str, list[str]] = {}
        for g, pat in (("eyes", r"^eye_[LR]$"), ("pupils", r"^pupil_[LR]$"), ("brows", r"^brow_[LR]$"),
                       ("lids", r"^lid_[LR]$"), ("hands", r"^hand_[LR]$")):
            m = [s for s in self.slot_order if re.match(pat, s)]
            if m:
                groups[g] = m
        for g, members in (self.rig.get("groups") or {}).items():
            for s in members:
                if s not in slots:
                    raise RigError(f"groups.{g}: no slot '{s}'")
            groups[str(g)] = [str(s) for s in members]
        chains = []
        for s in SIDES:
            if f"hand_{s}" in bones:
                chains.append(["chest", f"upper_arm_{s}", f"forearm_{s}", f"hand_{s}"])
        if "head" in bones:
            chains.append(["chest", "neck", "head"])
        dr = self.rig.get("drag") or {}
        if dr.get("chains"):
            chains = [[str(b) for b in c] for c in dr["chains"]]
        rig = acting.ActingRig(fps=self.fps, img2sk=self.img2sk, facing=self.facing, tempo=self.tempo, bones=bones, order=list(self.bone_order),
                               slots=slots, groups=groups, ik=dict(self.ik_infos),
                               phys={b for b in self.bone_order if b.startswith("phys_")},
                               face=dict(self.rig.get("face") or {}), poses_raw=dict(self.rig.get("poses") or {}),
                               stance=self.rig.get("stance"), drag_chains=chains)
        if rig.stance and rig.stance not in rig.poses_raw:
            raise RigError(f"stance '{rig.stance}' is not a pose")
        return rig

    def build_clips(self) -> dict:
        rig = self._acting_rig()
        clips = self.rig.get("clips") or {}
        spec_clips = self.spec.get("clips", {})
        try:
            notes = acting.prepare(rig, match_ik=bool(self.rig.get("match_ik", True)))
        except acting.ActingError as e:
            raise RigError(str(e)) from None
        self.report.stats["acting"] = notes
        required = list(self.CC["requiredClips"]) + [c for c in spec_clips if c not in self.CC["requiredClips"]]
        missing = [c for c in required if c not in clips]
        if missing:
            raise RigError(f"clips missing for {self.skel_name}: {', '.join(missing)} (tools/spine/contract.json characters)")
        drag_default = self.rig.get("drag")
        anims, reports = {}, {}
        order = [c for c in spec_clips if c in clips] + sorted(c for c in clips if c not in spec_clips)
        if "idle" in order:           # idle first: one-shots start and end on its first frame
            order.remove("idle")
            order.insert(0, "idle")
        for name in order:
            spec = dict(clips[name] or {})
            exp = spec_clips.get(name) or {}
            for k in ("frames", "loop", "track"):
                if k in spec and k in exp and spec[k] != exp[k]:
                    raise RigError(f"clips.{name}.{k} = {spec[k]}, but ANIMATION_SET / contract.json says {exp[k]}")
            if not exp and name not in self.CC["clips"]:
                self.report.warnings.append(f"clip '{name}' is not in the contract clip table")
            win = self.CC["clips"].get(name, {}).get("frames")
            F = int(spec.get("frames", exp.get("frames", 0)))
            if win and F and not (win[0] <= F <= win[1]):
                raise RigError(f"clips.{name}: {F} frames outside the contract window {win[0]}-{win[1]}")
            track = int(spec.get("track", exp.get("track", 0)))
            if "drag" not in spec and drag_default is not None and track == 0:
                spec["drag"] = {k: v for k, v in drag_default.items() if k != "chains"} or None
            events = list(spec.get("events") or [])
            have = {(int(e.get("at", 0)), str(e.get("name")), e.get("string")) for e in events}
            for ev in exp.get("events", []):
                key = (int(ev["frame"]), ev["name"], ev.get("string"))
                if key not in have:
                    same = [e for e in events if e.get("name") == ev["name"] and e.get("string") == ev.get("string")]
                    if same:
                        raise RigError(f"clips.{name}: event {ev['name']} {ev.get('string') or ''} at {same[0].get('at')}, "
                                       f"ANIMATION_SET says frame {ev['frame']}")
                    e = {"name": ev["name"], "at": int(ev["frame"])}
                    if ev.get("string"):
                        e["string"] = ev["string"]
                    events.append(e)
            spec["events"] = events
            try:
                a, rep = acting.build_clip(name, spec, rig, expect=exp)
            except (acting.ActingError, ValueError) as e:
                raise RigError(str(e)) from None
            if name == "idle":
                rig.rest_extra = dict(rep["frame0"])
            anims[name] = a.to_json()
            rep.pop("frame0", None)
            reports[name] = rep
        self.report.stats["clips"] = {n: reports[n] for n in [c for c in spec_clips if c in reports] + sorted(c for c in reports if c not in spec_clips)}
        anims = {n: anims[n] for n in self.report.stats["clips"]}
        return anims

    # ---------------------------------------------------------------- proportions (from part bboxes)
    def proportions(self) -> dict:
        excl = set(self.CC["proportions"]["excludeSlots"]) | set((self.rig.get("proportions") or {}).get("exclude") or [])
        head_bones = {"head"} | {b for b in self.bone_order if "head" in self._ancestors(b)}
        boxes, head_boxes = [], []
        for s in self.slot_order:
            setup = self.slot_setup.get(s)
            if setup is None or self.slot_bone[s].startswith("fx_"):
                continue
            p = self.part_by_id.get(s if setup == s else f"{s}/{setup}")
            if not p or not p["content"]:
                continue
            boxes.append(p["content"])
            if self.slot_bone[s] in head_bones and s not in excl:
                head_boxes.append(p["content"])
        if not boxes or not head_boxes:
            return {}
        y0, y1 = min(b[1] for b in boxes), max(b[3] for b in boxes)
        hy0, hy1 = min(b[1] for b in head_boxes), max(b[3] for b in head_boxes)
        return {"height": round(y1 - y0, 1), "head": round(hy1 - hy0, 1), "headFraction": round((hy1 - hy0) / (y1 - y0), 4)}

    def _ancestors(self, b: str) -> list[str]:
        out = []
        p = self.bones[b].parent
        while p:
            out.append(p)
            p = self.bones[p].parent
        return out

    # ---------------------------------------------------------------- build
    def build(self) -> dict:
        self.load_parts()
        self.build_bones()
        self.build_slots()
        self.build_constraints()
        anims = self.build_clips()
        used = set()
        for a in anims.values():
            for e in a.get("events", []):
                used.add(e["name"])
        events = {}
        for name, ed in self.contract["events"].items():
            if name in used or name in ("sfx", "vfx"):
                events[name] = dict(ed)
        for name in sorted(used - set(events)):
            events[name] = {}
        boxes = []
        for s in self.slot_order:
            setup = self.slot_setup.get(s)
            if setup is None or self.slot_bone[s].startswith("fx_"):
                continue
            p = self.part_by_id.get(s if setup == s else f"{s}/{setup}")
            if p and p["content"]:
                boxes.append(p["content"])
        cx0, cy0 = min(b[0] for b in boxes), min(b[1] for b in boxes)
        cx1, cy1 = max(b[2] for b in boxes), max(b[3] for b in boxes)
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
                "referenceScale": self.contract["referenceScale"],
                "images": images,
            },
            "bones": bones_json,
            "slots": self.slots,
            "constraints": self.constraints,
            "skins": self.skins,
            "events": events,
            "animations": anims,
        }
        doc["skeleton"]["hash"] = _hash(doc)
        B = self.CC["budgets"]
        st = self.report.stats
        nphys = sum(1 for c in self.constraints if c["type"] == "physics")
        st.update({"bones": len(bones_json), "slots": len(self.slots), "meshVertices": self.mesh_vertex_total,
                   "physics": nphys, "constraints": [f"{c['type']}:{c['name']}" for c in self.constraints],
                   "animations": list(anims), "proportions": self.proportions()})
        for k, lim in (("bones", B["bones"]), ("slots", B["slots"]), ("meshVertices", B["meshVertices"]), ("physics", B["physics"])):
            if st[k] > lim:
                raise RigError(f"budget: {k} {st[k]} > {lim} (ANIMATION_SET section 10, kind character)")
        pr = st["proportions"]
        hm = float((self.rig.get("proportions") or {}).get("head_max", self.CC["proportions"]["headMax"]))
        if pr and pr["headFraction"] > hm:
            self.report.warnings.append(f"proportions: head {pr['head']} / height {pr['height']} = {pr['headFraction']:.3f} > {hm} (adult gate, ART_BIBLE section 7)")
        for s, want in (self.spec.get("attachments") or {}).items():
            have = self.slot_atts.get(s)
            if have is None:
                raise RigError(f"slot '{s}' missing (ANIMATION_SET: attachments {', '.join(want)})")
            miss = [w for w in want if w not in have]
            if miss:
                raise RigError(f"slot '{s}': attachment(s) {', '.join(miss)} missing (ANIMATION_SET)")
        return doc


def is_character_rig(rig_path: str | os.PathLike) -> bool:
    try:
        doc = yaml.safe_load(Path(rig_path).read_text(encoding="utf-8")) or {}
    except (OSError, yaml.YAMLError):
        return False
    return isinstance(doc, dict) and doc.get("kind") == "character"
