#!/usr/bin/env python3
"""Claude-written animation JSON -> Blender Actions on an armature (+ shape keys) -> GLB.

    blender -b art/source/3d/mascot_gumbo/mascot_gumbo.blend --python-exit-code 1 \\
        -P tools/blender/build_actions.py -- art/source/3d/mascot_gumbo/anim/*.json --save
    python tools/blender/build_actions.py --glb public/assets/characters/placeholder/RobotExpressive.glb \\
        tools/blender/examples/celebrate_test.json --export-glb art/_work/anim/robot_celebrate_test.glb

JSON format: tools/blender/anim.schema.json and README.md#animation-json. Each clip becomes one
slotted Action (armature slot + one slot per touched shape-key datablock), stashed on a muted NLA
track like the glTF importer does, with frame range 0..length. Loops end on their first pose.
Export uses the settings from docs/PIPELINE.md §4.4 (slotbl.scene.GLTF_EXPORT_SETTINGS).

--describe writes the rig (bones with world axes at the base pose, morph targets, existing actions)
as JSON for the author, before any clip is built.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from slotbl import animspec, cli  # noqa: E402

EXAMPLES = """
examples:
  # validate the JSON only (no Blender needed)
  python tools/blender/build_actions.py --check tools/blender/examples/celebrate_test.json
  # describe a rig for the author
  python tools/blender/build_actions.py --glb rig.glb --describe art/_work/anim/rig.json
  # build + save the .blend + export the GLB with only the new clip
  python tools/blender/build_actions.py --glb rig.glb clip.json --out-blend art/_work/anim/rig.blend \\
      --export-glb art/_work/anim/rig.glb --export-actions celebrate_test
"""


def build_parser():
    ap = argparse.ArgumentParser(prog="build_actions.py", description=__doc__.split("\n\n")[0],
                                 formatter_class=argparse.RawDescriptionHelpFormatter, epilog=EXAMPLES)
    ap.add_argument("anim", nargs="*", help="animation JSON file(s)")
    src = ap.add_mutually_exclusive_group()
    src.add_argument("--blend", help="rig .blend to open (default: the file Blender was started with)")
    src.add_argument("--glb", help="rig GLB/GLTF to import into an empty scene")
    ap.add_argument("--armature", help="armature object name (default: the only armature)")
    ap.add_argument("--keep-rigid", action="store_true", help="--glb: skip the round-trip prep (default-pose "
                                                              "keys for unkeyed bones, skinning rigid bone children)")
    ap.add_argument("--check", action="store_true", help="validate the JSON only; do not load Blender data")
    ap.add_argument("--strict", action="store_true", help="contract warnings (clip names/windows) are errors")
    ap.add_argument("--keep-existing", action="store_true", help="error instead of replacing same-name actions")
    ap.add_argument("--describe", help="write a rig description JSON here")
    ap.add_argument("--out-blend", help="save the .blend here")
    ap.add_argument("--save", action="store_true", help="save back over --blend / the opened file")
    ap.add_argument("--export-glb", help="export a GLB (docs/PIPELINE.md §4.4 settings)")
    ap.add_argument("--export-actions", help="comma list: export only these actions (default: all)")
    ap.add_argument("--rename-map", help="JSON file or inline JSON {old: new} bone renames applied on export")
    ap.add_argument("--rigify-names", action="store_true", help="rename Rigify DEF-* bones to runtime names on export")
    ap.add_argument("--report", help="write a build report JSON (default: next to --export-glb / --out-blend)")
    ap.add_argument("--manifest", help="also append the export row to this manifest")
    return ap


# --------------------------------------------------------------------------- helpers ---
def find_armature(name):
    import bpy
    if name:
        ob = bpy.data.objects.get(name)
        if not ob or ob.type != "ARMATURE":
            raise cli.ToolError(f"armature '{name}' not found")
        return ob
    arms = [o for o in bpy.data.objects if o.type == "ARMATURE"]
    if len(arms) != 1:
        raise cli.ToolError(f"expected exactly one armature, found {[a.name for a in arms]}; pass --armature")
    return arms[0]


def shape_key_meshes(arm):
    """Meshes with morph targets (any mesh in the file: rigid parts parented to bones count)."""
    import bpy
    return [o for o in bpy.data.objects
            if o.type == "MESH" and o.data.shape_keys and len(o.data.shape_keys.key_blocks) > 1]


def ensure_slot(action, id_type, name):
    for s in action.slots:
        if s.target_id_type == id_type and s.name_display == name:
            return s
    return action.slots.new(id_type=id_type, name=name)


def assign(idblock, action, slot):
    ad = idblock.animation_data or idblock.animation_data_create()
    ad.action = action
    ad.action_slot = slot


def channelbag(action, slot):
    from bpy_extras import anim_utils
    return anim_utils.action_ensure_channelbag_for_slot(action, slot)


def world_rot_frame(arm, pb):
    """Rotation (quaternion) of the frame in which pb.matrix_basis acts, in world space."""
    m = (arm.matrix_world @ pb.matrix @ pb.matrix_basis.inverted()).to_3x3()
    return m.normalized().to_quaternion().normalized(), m


def sample_pose(arm, key_meshes, action_name, frame):
    """Base pose: per-bone (loc, quat, scale) and per-shape-key value from an action at a frame."""
    import bpy
    scene = bpy.context.scene
    base = {}
    morph = {}
    ad = arm.animation_data or arm.animation_data_create()
    prev = (ad.action, ad.action_slot)
    if action_name:
        act = bpy.data.actions.get(action_name)
        if act is None:
            raise cli.ToolError(f"base action '{action_name}' not found (have {[a.name for a in bpy.data.actions]})")
        slot = next((s for s in act.slots if s.target_id_type == "OBJECT"), None)
        ad.action = act
        if slot:
            ad.action_slot = slot
        for mo in key_meshes:
            k = mo.data.shape_keys
            ks = next((s for s in act.slots if s.target_id_type == "KEY" and s.name_display == k.name), None)
            if ks:
                assign(k, act, ks)
    else:
        ad.action = None
        for pb in arm.pose.bones:
            pb.location = (0, 0, 0)
            pb.rotation_quaternion = (1, 0, 0, 0)
            pb.rotation_euler = (0, 0, 0)
            pb.scale = (1, 1, 1)
        for mo in key_meshes:
            if mo.data.shape_keys.animation_data:
                mo.data.shape_keys.animation_data.action = None
            for kb in mo.data.shape_keys.key_blocks[1:]:
                kb.value = 0.0
    scene.frame_set(int(math.floor(frame)), subframe=frame - math.floor(frame))
    bpy.context.view_layer.update()
    for pb in arm.pose.bones:
        loc, rot, sca = pb.matrix_basis.decompose()
        base[pb.name] = {"loc": loc.copy(), "quat": rot.copy(), "scale": sca.copy(),
                         "frame": world_rot_frame(arm, pb)}
    for mo in key_meshes:
        for kb in mo.data.shape_keys.key_blocks[1:]:
            morph[(mo.name, kb.name)] = kb.value
    ad.action = prev[0]
    if prev[0] is not None and prev[1] is not None:
        ad.action_slot = prev[1]
    return base, morph


def value_for(track, key, bone_base, arm):
    """Authored delta -> absolute pose-bone channel value(s) at this key."""
    from mathutils import Euler, Vector
    ch, v = track["channel"], key["v"]
    b = bone_base
    if ch == "rot":
        e = Euler([math.radians(x) for x in v], "XYZ").to_quaternion()
        if track["space"] == "local":
            return ("rotation_quaternion", tuple(b["quat"] @ e))
        cq, _ = b["frame"]
        qd = cq.inverted() @ e @ cq
        return ("rotation_quaternion", tuple(qd @ b["quat"]))
    if ch == "loc":
        d = Vector(v)
        if track["space"] == "world":
            _, m3 = b["frame"]
            d = m3.inverted() @ d
        return ("location", tuple(b["loc"] + d))
    if ch == "scale":
        return ("scale", tuple(bs * s for bs, s in zip(b["scale"], v)))
    if ch == "squash":
        s = float(v)
        side = 1 / math.sqrt(s)
        return ("scale", (b["scale"][0] * side, b["scale"][1] * s, b["scale"][2] * side))
    raise ValueError(ch)


def rot_path(pb):
    if pb.rotation_mode == "QUATERNION":
        return "rotation_quaternion"
    if pb.rotation_mode == "AXIS_ANGLE":
        return None
    return "rotation_euler"


def rot_value(pb, quat):
    return tuple(quat) if pb.rotation_mode == "QUATERNION" else tuple(quat.to_euler(pb.rotation_mode))


def apply_ease(fcurves, frames, keys):
    """Blender stores interpolation on the segment START; our `ease` is on the arriving key.

    ELASTIC: Blender's keyframe `amplitude` is in absolute curve units (0.8 by default), which
    explodes on quaternion/scale channels. JSON `amplitude` is a FRACTION of the segment's
    change (default 1.0 = classic elastic) and is converted per F-curve; `period` is in frames
    (default 0 = 30% of the segment, Blender's own fallback)."""
    for fc in fcurves:
        kps = sorted(fc.keyframe_points, key=lambda k: k.co.x)
        pts = {round(kp.co.x, 4): j for j, kp in enumerate(kps)}
        for i in range(len(keys) - 1):
            j = pts.get(round(frames[i], 4))
            if j is None:
                continue
            kp = kps[j]
            e = keys[i + 1]["ease"]
            kp.interpolation = e["interpolation"]
            kp.easing = e["easing"]
            if "back" in e:
                kp.back = e["back"]
            if e["interpolation"] == "ELASTIC":
                change = abs(kps[j + 1].co.y - kp.co.y) if j + 1 < len(kps) else 0.0
                kp.amplitude = e.get("amplitude", 1.0) * change
                kp.period = e.get("period", 0.0)
        fc.update()


def resample_offset(fcurves, offset, length):
    """Loop tracks with an offset: evaluate the cyclic curve shifted in time, per frame."""
    for fc in fcurves:
        mod = fc.modifiers.new("CYCLES")
        vals = [fc.evaluate(f - offset) for f in range(0, int(length) + 1)]
        fc.modifiers.remove(mod)
        for kp in list(fc.keyframe_points)[::-1]:
            fc.keyframe_points.remove(kp, fast=True)
        fc.keyframe_points.add(len(vals))
        for f, (kp, val) in enumerate(zip(fc.keyframe_points, vals)):
            kp.co = (f, val)
            kp.interpolation = "LINEAR"
        fc.update()


def build_clip(clip, arm, key_meshes, log, keep_existing=False):
    import bpy
    name = clip["name"]
    old = bpy.data.actions.get(name)
    if old is not None:
        if keep_existing:
            raise cli.ToolError(f"action '{name}' exists (drop --keep-existing to replace it)")
        for idb in [arm] + [m.data.shape_keys for m in key_meshes]:
            ad = idb.animation_data
            if ad:
                for t in list(ad.nla_tracks):
                    if any(s.action == old for s in t.strips):
                        ad.nla_tracks.remove(t)
        bpy.data.actions.remove(old)
        log(f"replacing existing action '{name}'")
    base_action = (clip["base"] or {}).get("action")
    base_frame = float((clip["base"] or {}).get("frame", 0))
    base, morph_base = sample_pose(arm, key_meshes, base_action, base_frame)

    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    arm_slot = ensure_slot(act, "OBJECT", arm.name)
    assign(arm, act, arm_slot)

    bone_tracks = [t for t in clip["tracks"] if t["kind"] == "bone"]
    morph_tracks = [t for t in clip["tracks"] if t["kind"] == "morph"]
    for t in bone_tracks:
        if t["bone"] not in arm.pose.bones:
            raise cli.ToolError(f"{name}: bone '{t['bone']}' not in {arm.name} "
                                f"(have e.g. {', '.join(b.name for b in arm.pose.bones[:12])} ...)")
    touched = {t["bone"] for t in bone_tracks}
    length = clip["length"]
    stats = {"bones": sorted(touched), "morphs": [], "keys": 0}

    # 1) every bone holds the base pose (only needed when the base is not the rest pose)
    hold_bones = [pb for pb in arm.pose.bones if base_action or pb.name in touched]
    for pb in hold_bones:
        b = base[pb.name]
        for path, val in (("location", b["loc"]), (rot_path(pb), rot_value(pb, b["quat"])), ("scale", b["scale"])):
            if path is None:
                continue
            setattr(pb, path, val)
            for f in (0, length):
                pb.keyframe_insert(path, frame=f, group=pb.name)
    cb = channelbag(act, arm_slot)

    # 2) authored bone tracks (override the hold keys of their channel)
    for t in bone_tracks:
        pb = arm.pose.bones[t["bone"]]
        if t["channel"] == "rot" and rot_path(pb) is None:
            raise cli.ToolError(f"{name}: bone {pb.name} uses AXIS_ANGLE rotation; use QUATERNION or an Euler mode")
        path = {"rot": rot_path(pb), "loc": "location", "scale": "scale", "squash": "scale"}[t["channel"]]
        dp = f'pose.bones["{pb.name}"].{path}'
        for fc in [fc for fc in cb.fcurves if fc.data_path == dp]:
            cb.fcurves.remove(fc)
        prev_q = prev_e = None
        frames = []
        for k in t["keys"]:
            path_, val = value_for(t, k, base[pb.name], arm)
            if path_ == "rotation_quaternion":
                from mathutils import Quaternion
                q = Quaternion(val)
                if prev_q is not None and prev_q.dot(q) < 0:
                    q.negate()      # shortest arc between keys
                prev_q = q
                val = tuple(q)
                if path != "rotation_quaternion":
                    e = q.to_euler(pb.rotation_mode, prev_e) if prev_e else q.to_euler(pb.rotation_mode)
                    prev_e = e
                    path_, val = path, tuple(e)
            setattr(pb, path_, val)
            pb.keyframe_insert(path_, frame=k["f"], group=pb.name)
            frames.append(k["f"])
            stats["keys"] += 1
        fcs = [fc for fc in cb.fcurves if fc.data_path == dp]
        apply_ease(fcs, frames, t["keys"])
        if t["offset"]:
            resample_offset(fcs, t["offset"], length)

    # 3) morph tracks on each shape-key datablock (own slot in the same action)
    key_slots = {}
    for t in morph_tracks:
        targets = []
        for mo in key_meshes:
            if t["mesh"] and mo.name != t["mesh"]:
                continue
            kbs = mo.data.shape_keys.key_blocks
            kb = kbs.get(t["morph"]) or next((k for k in kbs if k.name.lower() == t["morph"].lower()), None)
            if kb is not None:
                targets.append((mo, kb))
        if not targets:
            have = sorted({k.name for mo in key_meshes for k in mo.data.shape_keys.key_blocks[1:]})
            raise cli.ToolError(f"{name}: morph '{t['morph']}' not found (have {have})")
        for mo, kb in targets:
            key = mo.data.shape_keys
            if key.name not in key_slots:
                slot = ensure_slot(act, "KEY", key.name)
                assign(key, act, slot)
                key_slots[key.name] = slot
                for other in key.key_blocks[1:]:      # hold every other morph at its base value
                    other.value = morph_base.get((mo.name, other.name), 0.0)
                    for f in (0, length):
                        other.keyframe_insert("value", frame=f)
            kcb = channelbag(act, key_slots[key.name])
            dp = f'key_blocks["{kb.name}"].value'
            for fc in [fc for fc in kcb.fcurves if fc.data_path == dp]:
                kcb.fcurves.remove(fc)
            frames = []
            for k in t["keys"]:
                kb.value = float(k["v"])
                kb.keyframe_insert("value", frame=k["f"])
                frames.append(k["f"])
                stats["keys"] += 1
            fcs = [fc for fc in kcb.fcurves if fc.data_path == dp]
            apply_ease(fcs, frames, t["keys"])
            if t["offset"]:
                resample_offset(fcs, t["offset"], length)
            stats["morphs"].append(f"{mo.name}:{kb.name}")

    act.use_frame_range = True
    act.frame_start = 0
    act.frame_end = length
    act.use_cyclic = clip["loop"]
    act["loop"] = clip["loop"]

    # 4) stash on muted NLA tracks (what the glTF importer does; the exporter finds them)
    for idb, slot in [(arm, arm_slot)] + [(bpy.data.shape_keys[k], s) for k, s in key_slots.items()]:
        ad = idb.animation_data
        tr = ad.nla_tracks.new()
        tr.name = name
        st = tr.strips.new(name, 0, act)
        try:
            st.action_slot = slot
        except (AttributeError, TypeError):
            pass
        tr.mute = True
        ad.action = None
    return act, stats


def check_loop(act, arm, key_meshes, length, touched):
    """Max abs difference between frame 0 and frame `length` over every animated channel."""
    from bpy_extras import anim_utils
    worst = 0.0
    for slot in act.slots:
        cb = anim_utils.action_get_channelbag_for_slot(act, slot)
        if cb is None:
            continue
        for fc in cb.fcurves:
            worst = max(worst, abs(fc.evaluate(0) - fc.evaluate(length)))
    return worst


def overshoot_report(act, clip):
    """For BACK/ELASTIC arrivals: how far the curve travels past the target (proves the ease)."""
    from bpy_extras import anim_utils
    out = []
    for t in clip["tracks"]:
        for i in range(1, len(t["keys"])):
            e = t["keys"][i]["ease"]
            if e["interpolation"] not in ("BACK", "ELASTIC") or t["offset"]:
                continue
            f0, f1 = t["keys"][i - 1]["f"], t["keys"][i]["f"]
            for slot in act.slots:
                cb = anim_utils.action_get_channelbag_for_slot(act, slot)
                for fc in (cb.fcurves if cb else []):
                    tgt = t["bone"] if t["kind"] == "bone" else t["morph"]
                    if f'"{tgt}"' not in fc.data_path and f'"{tgt.lower()}"' not in fc.data_path.lower():
                        continue
                    a, b = fc.evaluate(f0), fc.evaluate(f1)
                    if abs(b - a) < 1e-4:
                        continue
                    samples = [fc.evaluate(f0 + (f1 - f0) * j / 20) for j in range(21)]
                    past = max((s - b) * (1 if b > a else -1) for s in samples)
                    if past > 1e-4:
                        out.append({"track": tgt, "channel": t["channel"], "segment": [f0, f1],
                                    "fcurve": f"{fc.data_path}[{fc.array_index}]",
                                    "overshoot": round(past / abs(b - a), 3)})
                        break
            break
    return out


def describe_rig(arm, key_meshes, path, base_action=None):
    import bpy
    from mathutils import Vector
    base, _ = sample_pose(arm, key_meshes, base_action, 0)
    bones = []
    for pb in arm.pose.bones:
        b = pb.bone
        mw = arm.matrix_world
        cq, m3 = base[pb.name]["frame"]
        axes = {ax: [round(c, 3) for c in (mw.to_3x3() @ b.matrix_local.to_3x3() @ Vector(v)).normalized()]
                for ax, v in (("x", (1, 0, 0)), ("y", (0, 1, 0)), ("z", (0, 0, 1)))}
        bones.append({
            "name": pb.name, "parent": b.parent.name if b.parent else None, "deform": b.use_deform,
            "head": [round(c, 4) for c in (mw @ b.head_local)], "tail": [round(c, 4) for c in (mw @ b.tail_local)],
            "restAxesWorld": axes, "rotationMode": pb.rotation_mode,
        })
    mw_scale = arm.matrix_world.to_scale()
    doc = {
        "armature": arm.name, "worldScale": [round(c, 4) for c in mw_scale],
        "conventions": "world axes: +Z up; characters face -Y (glTF +Z forward). rot deltas in 'world' space "
                       "rotate about these axes at the base pose: +X nods forward/down, +Z turns toward the "
                       "character's left (screen right), +Y rolls toward the character's right.",
        "bones": bones,
        "morphs": {mo.name: [k.name for k in mo.data.shape_keys.key_blocks[1:]] for mo in key_meshes},
        "actions": [{"name": a.name, "frameRange": [round(x, 3) for x in a.frame_range],
                     "slots": [s.identifier for s in a.slots]} for a in bpy.data.actions],
        "fps": bpy.context.scene.render.fps,
    }
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(doc, indent=2) + "\n")
    return doc


# ------------------------------------------------------------------------------ main ---
def main(argv):
    args = build_parser().parse_args(argv)
    log = cli.Log("build_actions")
    anim_paths = [cli.repo_path(p) for p in args.anim]
    missing = [str(p) for p in anim_paths if not p.exists()]
    if missing:
        raise cli.ToolError(f"animation JSON not found: {', '.join(missing)}")
    spec = None
    if anim_paths:
        spec, warnings = animspec.load(anim_paths, strict=args.strict)
        for w in warnings:
            log.warn(w)
        log(f"{len(spec['clips'])} clip(s) valid: " + ", ".join(
            f"{c['name']} ({c['length']}f{' loop' if c['loop'] else ''}, {len(c['tracks'])} tracks)" for c in spec["clips"]))
    if args.check:
        if not spec:
            raise cli.ToolError("--check needs animation JSON files")
        return 0
    if not spec and not args.describe:
        raise cli.ToolError("nothing to do: give animation JSON files and/or --describe")
    if args.manifest and not args.export_glb:
        raise cli.ToolError("--manifest records the exported GLB: add --export-glb")

    import bpy
    from slotbl import scene as S
    from slotbl import provenance as prov

    for opt in ("glb", "blend"):
        val = getattr(args, opt)
        if val and not cli.repo_path(val).exists():
            raise cli.ToolError(f"--{opt} not found: {val}")
    refs = []
    if args.glb:
        S.reset_scene()
        rig = cli.repo_path(args.glb)
        S.import_model(rig)
        refs.append(prov.file_ref(rig))
    elif args.blend:
        rig = cli.repo_path(args.blend)
        S.open_blend(rig)
        refs.append(prov.file_ref(rig))
    elif bpy.data.filepath:
        rig = Path(bpy.data.filepath)
        refs.append(prov.file_ref(rig))
    else:
        raise cli.ToolError("no rig: pass --glb or --blend (or start Blender with the .blend)")
    arm = find_armature(args.armature)
    rig_prep = None
    if args.glb and not args.keep_rigid:
        # glTF clips may rely on node default poses and rigid bone-parented parts; make the
        # rig round-trip safe before anything is built or exported (slotbl.scene docstrings)
        rig_prep = S.prepare_rig_for_export(arm, rig, log)
    key_meshes = shape_key_meshes(arm)
    scene = bpy.context.scene

    if args.describe:
        base_action = None
        if spec and spec["clips"][0]["base"]:
            base_action = spec["clips"][0]["base"].get("action")
        describe_rig(arm, key_meshes, cli.out_path(args.describe), base_action)
        log(f"rig description -> {cli.rel(cli.out_path(args.describe))}")
        if not spec:
            return 0

    scene.render.fps = spec["fps"]
    scene.render.fps_base = 1.0
    report = {"rig": cli.rel(rig), "armature": arm.name, "fps": spec["fps"], "clips": [], "sources":
              [cli.rel(s) for s in spec["sources"]], "rigPrep": rig_prep}
    for clip in spec["clips"]:
        act, stats = build_clip(clip, arm, key_meshes, log, keep_existing=args.keep_existing)
        seam = check_loop(act, arm, key_meshes, clip["length"], stats["bones"]) if clip["loop"] else None
        over = overshoot_report(act, clip)
        if clip["loop"] and seam > 1e-4:
            raise cli.ToolError(f"{clip['name']}: loop seam mismatch {seam:.5f} between frame 0 and {clip['length']}")
        report["clips"].append({"name": clip["name"], "loop": clip["loop"], "length": clip["length"],
                                "seconds": round(clip["length"] / spec["fps"], 3), "loopSeamMaxDiff": seam,
                                "overshoot": over, **stats})
        log(f"action '{clip['name']}': {len(stats['bones'])} bones, morphs {stats['morphs']}, {stats['keys']} keys, "
            f"seam {seam if seam is not None else '-'}, overshoot checks {len(over)}")
    for p in anim_paths:
        refs.append(prov.file_ref(p))

    out_blend = cli.out_path(args.out_blend) if args.out_blend else (Path(bpy.data.filepath) if args.save else None)
    if args.save and not bpy.data.filepath:
        raise cli.ToolError("--save needs --blend (or use --out-blend)")
    if out_blend:
        out_blend.parent.mkdir(parents=True, exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=str(out_blend), compress=False)
        log(f"saved {cli.rel(out_blend)}")
        report["blend"] = cli.rel(out_blend)

    if not out_blend and not args.export_glb:
        log.warn("actions were built in memory only: pass --save, --out-blend or --export-glb to keep them")
    rows = []
    if args.export_glb:
        import export_glb
        out = cli.out_path(args.export_glb)
        keep = [a.strip() for a in args.export_actions.split(",")] if args.export_actions else None
        info = export_glb.export(out, arm=arm, keep_actions=keep, rename_map=export_glb.load_rename_map(args.rename_map),
                                 rigify=args.rigify_names, log=log)
        report["glb"] = info
        digest = prov.sha256_file(out)
        rows.append(prov.make_row(
            id=prov.row_id("anim", out.stem, digest), path=out, stage="3d-anim", sha256=digest,
            model=f"blender-{S.blender_version().split()[0]}",
            version=f"bpy {S.blender_version()}; tools/blender@{prov.toolkit_version()}",
            ref_hashes=[r["sha256"] for r in refs],
            notes=f"clips {[c['name'] for c in spec['clips']]} from {', '.join(r['path'] for r in refs)}",
            qa={"passed": True, "report": None}))
    report_path = cli.out_path(args.report) if args.report else (
        cli.out_path(args.export_glb).with_suffix(".report.json") if args.export_glb else
        (out_blend.with_suffix(".report.json") if out_blend else None))
    if report_path:
        if rows:
            rows[0]["qa"]["report"] = cli.rel(report_path)
            prov.write_sidecar(report_path.with_suffix("").with_suffix(".manifest.json"), rows,
                               "tools/blender/build_actions.py")
            report["manifest"] = cli.rel(report_path.with_suffix("").with_suffix(".manifest.json"))
            if args.manifest:
                prov.append_to_manifest(cli.repo_path(args.manifest), rows, "tools/blender/build_actions.py")
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(json.dumps(report, indent=2) + "\n")
        log(f"report -> {cli.rel(report_path)}")
    return 0


if __name__ == "__main__":
    cli.run(main)
