#!/usr/bin/env python3
"""Toon turntables and clip contact sheets for mesh bake-offs and animation review.

    blender -b --factory-startup --python-exit-code 1 -P tools/blender/turntable.py -- cand.glb --out art/_work/mascots/gumbo/tt
    python tools/blender/turntable.py cand.glb --out art/_work/mascots/gumbo/tt                     # 8 angles
    python tools/blender/turntable.py rig.glb --action celebrate --frames 8 --out qa/mascots/celebrate

The look previews the RUNTIME mascot shader (src/mascots/toon.ts): key light fixed in camera
space (top-left, in front), three hard bands at N.L = -1/3 / +1/3 with 0.42 / 0.70 / 1.00 x albedo,
black inverted-hull outline ~3 px at the output size, flat unlit background (film transparent).
Outputs PNG per angle/frame, a labelled contact sheet and a metrics JSON (tris, bones, bbox).
"""
from __future__ import annotations

import argparse
import json
import math
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from slotbl import cli  # noqa: E402


def build_parser():
    ap = argparse.ArgumentParser(prog="turntable.py", description=__doc__.split("\n\n")[0],
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("model", help=".glb/.gltf/.obj/.fbx/.blend")
    ap.add_argument("out_dir", nargs="?", help="output folder (same as --out; PIPELINE §4.1 form)")
    ap.add_argument("--out", help="output folder")
    ap.add_argument("--name", help="file prefix (default: model file stem)")
    ap.add_argument("--angles", type=int, default=8, help="turntable angles (0 = none)")
    ap.add_argument("--action", help="render this action instead of a turntable (contact sheet of the clip)")
    ap.add_argument("--frames", type=int, default=8, help="action: evenly sampled frames")
    ap.add_argument("--frame", type=float, help="turntable: pose frame of the active/--pose action")
    ap.add_argument("--pose", help="turntable: action to pose from (with --frame)")
    ap.add_argument("--yaw", type=float, default=0.0, help="action sheet: model yaw in degrees")
    ap.add_argument("--elev", type=float, default=5.0, help="camera elevation (deg)")
    ap.add_argument("--size", type=int, default=384)
    ap.add_argument("--ss", type=int, default=2)
    ap.add_argument("--engine", default="CYCLES", choices=("CYCLES", "BLENDER_EEVEE", "EEVEE"))
    ap.add_argument("--samples", type=int, default=8)
    ap.add_argument("--threads", type=int, default=0)
    ap.add_argument("--outline-px", type=float, default=3.0, help="outline at output size (runtime: ~3 px)")
    ap.add_argument("--recolor", help="material-name regex = hex, comma separated, e.g. 'Main=#3F9D3A,Grey=#2B6B2A'")
    ap.add_argument("--flat", action="store_true", help="ignore textures, use material base colours")
    ap.add_argument("--bg", default="#0C3149", help="contact sheet background")
    return ap


def parse_recolor(s):
    rules = []
    for part in filter(None, (s or "").split(",")):
        k, _, v = part.partition("=")
        rules.append((re.compile(k.strip()), v.strip()))
    return rules


def toonify_scene(meshes, key_w, view_w, args, log):
    import bpy
    from slotbl import palette as pal
    from slotbl import scene as S
    rules = parse_recolor(args.recolor)
    cache = {}
    bands = S.multiplier_bands()
    th = (-1 / 3, 1 / 3)       # three.js MeshToonMaterial gradient lookup at 0.5*N.L+0.5 on 3 texels
    for o in meshes:
        me = o.data
        if me.get("_toonified"):
            continue
        for i, m in enumerate(me.materials):
            key = m.name if m else "_none"
            if key not in cache:
                albedo = None
                hexc = next((v for rx, v in rules if m and rx.search(m.name)), None)
                if hexc:
                    albedo = pal.hex_to_linear(hexc)
                elif m and m.node_tree:
                    bsdf = next((n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
                    if bsdf:
                        inp = bsdf.inputs["Base Color"]
                        if inp.is_linked and inp.links[0].from_node.type == "TEX_IMAGE" and not args.flat:
                            albedo = inp.links[0].from_node.image
                        else:
                            albedo = tuple(inp.default_value[:3])
                if albedo is None:
                    albedo = (0.8, 0.8, 0.8)
                cache[key] = S.toon_material(f"toon:{key}", bands_lin=bands, thresholds=th, key_world=key_w,
                                             view_world=view_w, mode="emission", albedo=albedo)
            me.materials[i] = cache[key]
        if len(me.materials) == 0:
            if "_none" not in cache:
                cache["_none"] = S.toon_material("toon:none", bands_lin=bands, thresholds=th, key_world=key_w,
                                                 view_world=view_w, mode="emission", albedo=(0.8, 0.8, 0.8))
            me.materials.append(cache["_none"])
        me["_toonified"] = True
    log(f"toon materials: {len(cache)}")


def load_model(path):
    import bpy
    from slotbl import scene as S
    if path.suffix.lower() == ".blend":
        S.open_blend(path)
        return list(bpy.data.objects)
    S.reset_scene()
    return S.import_model(path)


def main(argv):
    ap = build_parser()
    args = ap.parse_args(argv)
    args.out = args.out or args.out_dir
    if not args.out:
        ap.error("give an output folder (positional or --out)")
    log = cli.Log("turntable")
    model = cli.repo_path(args.model)
    if not model.exists():
        raise cli.ToolError(f"model not found: {model}")
    import bpy
    from mathutils import Vector
    from slotbl import scene as S

    load_model(model)
    scene = bpy.context.scene
    scene.render.fps = 30
    S.black_world(scene)
    name = args.name or model.stem
    out = cli.out_path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    for ob in [o for o in bpy.data.objects if o.type in ("LIGHT", "CAMERA")]:
        bpy.data.objects.remove(ob)
    hidden_cols = [c for c in bpy.data.collections if c.name.startswith("glTF_not_exported")]
    for c in hidden_cols:
        for o in c.objects:
            o.hide_render = True
    meshes = [o for o in bpy.data.objects if o.type == "MESH" and not o.hide_render]
    arm = next((o for o in bpy.data.objects if o.type == "ARMATURE"), None)
    if not meshes:
        raise cli.ToolError("no renderable meshes")

    # pose / action selection (glTF import stashes clips on muted NLA tracks)
    act = None
    want = args.action or args.pose
    if want:
        act = bpy.data.actions.get(want) or next((a for a in bpy.data.actions if a.name.lower() == want.lower()), None)
        if act is None:
            raise cli.ToolError(f"action '{want}' not found (have {[a.name for a in bpy.data.actions]})")
        targets = [arm] if arm else []
        targets += [o.data.shape_keys for o in meshes if o.data.shape_keys]
        for idb in targets:
            ad = idb.animation_data or idb.animation_data_create()
            for t in ad.nla_tracks:
                t.mute = True
            slot = next((s for s in act.slots if s.target_id_type == ("OBJECT" if idb == arm else "KEY")
                         and (idb == arm or s.name_display == idb.name)), None)
            if slot is None and idb != arm:
                continue
            ad.action = act
            if slot is not None:
                ad.action_slot = slot

    # pivot: every top-level object hangs under one empty we rotate
    pivot = bpy.data.objects.new("tt_pivot", None)
    scene.collection.objects.link(pivot)
    for o in [o for o in bpy.data.objects if o.parent is None and o != pivot]:
        mw = o.matrix_world.copy()
        o.parent = pivot
        o.matrix_world = mw

    if args.action:
        f0, f1 = act.frame_range
        n = max(1, args.frames)
        loop = bool(act.get("loop", act.use_cyclic))
        frames = [float(round(f0 + (f1 - f0) * i / (n if loop or n == 1 else n - 1))) for i in range(n)]
        shots = [(args.yaw, f) for f in frames]
    else:
        fr = args.frame if args.frame is not None else scene.frame_current
        shots = [(360.0 * i / max(1, args.angles), fr) for i in range(max(1, args.angles))]

    def pose(yaw, frame):
        scene.frame_set(int(math.floor(frame)), subframe=frame - math.floor(frame))
        pivot.rotation_euler = (0, 0, math.radians(yaw))
        bpy.context.view_layer.update()

    # framing over every shot (evaluated = skinned/morphed)
    pts = []
    for yaw, fr in shots:
        pose(yaw, fr)
        pts += S.world_points(meshes, evaluated=True)
    xs, ys, zs = [p.x for p in pts], [p.y for p in pts], [p.z for p in pts]
    tris = sum(S.triangle_count(o) for o in meshes)
    pose(*shots[0])
    centre = Vector(((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, (min(zs) + max(zs)) / 2))
    cam = S.ortho_camera(scene, 0.0, args.elev, centre, 1.0, distance=max(10.0, (max(zs) - min(zs)) * 5))
    cpts = S.camera_space_points(cam, pts)
    w = max(p.x for p in cpts) - min(p.x for p in cpts)
    h = max(p.y for p in cpts) - min(p.y for p in cpts)
    margin = 1.0 + 4 * args.outline_px / args.size + 0.06
    ortho = max(w, h) * margin
    right, up, _ = S.camera_axes(cam)
    cam.location += right * ((max(p.x for p in cpts) + min(p.x for p in cpts)) / 2) + \
        up * ((max(p.y for p in cpts) + min(p.y for p in cpts)) / 2)
    cam.data.ortho_scale = ortho
    bpy.context.view_layer.update()
    key_w, view_w = S.key_vectors(cam)
    toonify_scene(meshes, key_w, view_w, args, log)
    ink = S.outline_material()
    thickness = args.outline_px * ortho / args.size
    for o in meshes:
        if not any(m and m.name == ink.name for m in o.data.materials):
            S.add_hull(o, thickness, ink)
        else:
            mod = o.modifiers.new("outline_hull", "SOLIDIFY")
            s = o.matrix_world.to_scale()
            mod.thickness = thickness / ((abs(s.x) + abs(s.y) + abs(s.z)) / 3 or 1)
            mod.offset, mod.use_flip_normals, mod.use_rim = 1.0, True, False
            mod.material_offset = sum(1 for m in o.data.materials if m and m.name != ink.name)
    S.configure_render(scene, args.engine, args.size * args.ss, args.samples, threads=args.threads)

    tag = f"{name}_{act.name}" if args.action else f"{name}_turntable"
    raws, labels, files = [], [], []
    for i, (yaw, fr) in enumerate(shots):
        pose(yaw, fr)
        raw = out / f".raw_{tag}_{i:03d}.png"
        S.render_still(scene, raw)
        raws.append(str(raw))
        files.append(out / (f"{tag}_f{int(round(fr)):04d}.png" if args.action else f"{tag}_a{int(round(yaw)):03d}.png"))
        labels.append(f"f{fr:g}" if args.action else f"{yaw:g} deg")
    title = (f"{name} - {'clip ' + act.name if args.action else 'turntable'} - {tris} tris"
             + (f", {len(arm.data.bones)} bones" if arm else ""))
    sheet_path = out / f"{tag}.png"
    metrics = {
        "model": cli.rel(model), "tris": tris, "bones": len(arm.data.bones) if arm else 0,
        "deformBones": sum(1 for b in arm.data.bones if b.use_deform) if arm else 0,
        "meshes": len(meshes), "bbox": {"x": [min(xs), max(xs)], "y": [min(ys), max(ys)], "z": [min(zs), max(zs)]},
        "height": max(zs) - min(zs), "action": act.name if act else None,
        "shots": [{"yaw": y, "frame": f, "file": cli.rel(p)} for (y, f), p in zip(shots, files)],
        "sheet": cli.rel(sheet_path), "outlinePx": args.outline_px, "engine": args.engine,
    }
    job = {"raw": raws, "files": [str(f) for f in files], "labels": labels, "size": args.size, "bg": args.bg,
           "title": title, "sheet": str(sheet_path), "metrics": metrics, "metrics_path": str(out / f"{tag}.json")}
    try:
        import numpy  # noqa: F401
        import PIL  # noqa: F401
        import sheet_post
        rc = sheet_post.process(job)
    except ImportError:
        import os
        import subprocess
        job_path = out / f".{tag}.job.json"
        job_path.write_text(json.dumps(job))
        py = os.environ.get("SLOT_PYTHON") or "python3"
        log(f"Pillow not importable here; post-processing with {py}")
        rc = subprocess.call([py, str(Path(__file__).with_name("sheet_post.py")), "--job", str(job_path)])
    if rc:
        return rc
    log(f"{len(files)} images + sheet {cli.rel(sheet_path)} ({tris} tris) in {log.elapsed():.1f}s")
    return 0


if __name__ == "__main__":
    cli.run(main)
