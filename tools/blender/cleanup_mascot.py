#!/usr/bin/env python3
"""Clean a vendor (Tripo / Meshy / Rodin) mascot GLB for the toon runtime (docs/PIPELINE.md §4.2).

    python tools/blender/cleanup_mascot.py art/_work/mascots/gumbo/cand_tripo.glb \\
        --out art/_work/mascots/gumbo/clean_tripo.glb --height 1.8 --target-tris 14000 --colors 6
    blender -b --factory-startup --python-exit-code 1 -P tools/blender/cleanup_mascot.py -- cand.glb --out clean.glb

Steps (each reported in <out>.report.json):
  1. import; drop lights/cameras/empties without children;
  2. orientation / scale / origin: faces -Y (glTF +Z forward; --yaw fixes vendors that differ),
     feet on z=0, centred on x/y, optional --height. Unrigged meshes are baked (identity
     transforms); rigged input only gets a root transform (bone data and actions untouched);
  3. weld split vertices (GLB seams), clear custom normals, smooth by angle;
  4. palette: weighted k-means (CIELAB, lightness down-weighted so baked lighting does not split a
     hue) of the vendor texture / material colours -> N flat toon colours (AI lighting discarded);
  5. optional decimate (or QuadriFlow) to --target-tris; meshes with shape keys are left intact;
  6. every face gets the palette colour sampled from the ORIGINAL surface (BVH nearest), majority-
     smoothed over neighbours, written as ONE material with a tiny palette texture (Closest
     filtering, UVs at cell centres) or as vertex colours (--palette-mode vertex);
  7. budgets: < 15k tris, 30-60 bones (<= 65), 1 material, texture <= 1024 px -> report (+exit 3
     with --strict).
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from slotbl import cli  # noqa: E402

BUDGET = {"tris": 15000, "bones_min": 30, "bones_max": 60, "bones_hard": 65, "texture": 1024, "materials": 2}


def build_parser():
    ap = argparse.ArgumentParser(prog="cleanup_mascot.py", description=__doc__.split("\n\n")[0],
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("input", help="vendor .glb/.gltf/.fbx/.obj")
    ap.add_argument("--out", required=True, help="cleaned .glb")
    ap.add_argument("--out-blend", help="also save a .blend (input for rig_mascot / build_actions)")
    ap.add_argument("--height", type=float, help="target height in metres (default: keep)")
    ap.add_argument("--yaw", type=float, default=0.0, help="extra yaw (deg) so the character faces -Y")
    ap.add_argument("--weld", type=float, default=1e-4, help="weld distance as a fraction of the height")
    ap.add_argument("--sharp-angle", type=float, default=40.0, help="smooth-by-angle threshold (deg)")
    ap.add_argument("--target-tris", type=int, default=14000, help="decimate above this (0 = never)")
    ap.add_argument("--remesh", choices=("decimate", "quadriflow"), default="decimate")
    ap.add_argument("--relax", type=int, default=2, help="Laplacian relax passes after reduction (toon ramps "
                                                        "turn normal noise into band speckles; 0 = off)")
    ap.add_argument("--colors", type=int, default=6, help="palette size (4-8 per ART_BIBLE; 0 = keep materials)")
    ap.add_argument("--palette-mode", choices=("texture", "vertex"), default="texture")
    ap.add_argument("--lightness-weight", type=float, default=0.35,
                    help="L* weight when merging colour clusters (<1 merges baked lit/shadow variants)")
    ap.add_argument("--smooth", type=int, default=2, help="majority-filter passes over face labels")
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--strict", action="store_true", help="exit 3 when a budget is breached")
    ap.add_argument("--manifest", help="also append the row to this manifest")
    ap.add_argument("--parent", action="append", default=[], help="parent manifest row id")
    return ap


# --------------------------------------------------------------------------- colour ---
def image_array(img):
    import numpy as np
    w, h = img.size
    if w == 0 or h == 0:
        return None
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    return px.reshape(h, w, 4)


def material_source(m):
    """-> ('image', ndarray) | ('color', srgb tuple)"""
    from slotbl import palette as pal
    if m is None or m.node_tree is None:
        return ("color", (0.8, 0.8, 0.8))
    bsdf = next((n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if bsdf is None:
        return ("color", (0.8, 0.8, 0.8))
    inp = bsdf.inputs["Base Color"]

    def find_image(sock, depth=0):
        if not sock.is_linked or depth > 4:
            return None
        n = sock.links[0].from_node
        if n.type == "TEX_IMAGE" and n.image:
            return n.image
        for s in n.inputs:
            r = find_image(s, depth + 1)
            if r:
                return r
        return None
    img = find_image(inp)
    if img is not None:
        arr = image_array(img)
        if arr is not None:
            return ("image", (arr, not img.is_float))   # byte images hold sRGB-coded values
    lin = inp.default_value[:3]
    return ("color", tuple(pal.linear_to_srgb(c) for c in lin))


def face_colors(obj):
    """Per-face sRGB colour sampled at the face centre (texture via UV, else material colour)."""
    import numpy as np
    from slotbl import palette as pal
    me = obj.data
    srcs = [material_source(m) for m in me.materials] or [("color", (0.8, 0.8, 0.8))]
    uvl = me.uv_layers.active
    cols = np.zeros((len(me.polygons), 3), dtype=np.float32)
    areas = np.zeros(len(me.polygons), dtype=np.float32)
    for p in me.polygons:
        kind, data = srcs[min(p.material_index, len(srcs) - 1)]
        areas[p.index] = p.area
        if kind == "image" and uvl is not None:
            arr, is_srgb = data
            h, w = arr.shape[:2]
            us = [uvl.data[li].uv for li in p.loop_indices]
            u = sum(v.x for v in us) / len(us)
            v_ = sum(v.y for v in us) / len(us)
            x = int(min(w - 1, max(0, (u % 1.0) * w)))
            y = int(min(h - 1, max(0, (v_ % 1.0) * h)))
            c = arr[y, x, :3]
            cols[p.index] = c if is_srgb else [pal.linear_to_srgb(v) for v in c]
        else:
            cols[p.index] = data if kind == "color" else (0.8, 0.8, 0.8)
    return cols, areas


def build_palette(samples, weights, k, lw, seed, over=16):
    """Over-cluster (k-means, `over` clusters in CIELAB), then merge the closest pair until k are
    left. The merge distance down-weights L* by `lw`, so baked-light variants of one hue merge
    first while small but distinct colours (eye white, pupils, gold tooth) survive, which a
    plain area-weighted k-means would spend on the dominant hue."""
    import numpy as np
    from slotbl import palette as pal
    lab = pal.srgb_to_lab(np.clip(samples, 0, 1))
    uniq = len(np.unique(np.round(samples * 255).astype(int), axis=0))
    C, labels = pal.kmeans(lab, min(max(over, k), uniq), weights=weights, seed=seed)
    groups = [[j] for j in range(len(C)) if (labels == j).any()]
    wsum = {j: float(weights[labels == j].sum()) for j in range(len(C))}

    def centre(g):
        w = np.array([wsum[j] for j in g])
        return (C[g] * w[:, None]).sum(0) / max(1e-9, w.sum())
    scale = np.array([lw, 1.0, 1.0])
    while len(groups) > max(1, k):
        cs = [centre(g) * scale for g in groups]
        best, pair = None, None
        for i in range(len(groups)):
            for j in range(i + 1, len(groups)):
                d = float(((cs[i] - cs[j]) ** 2).sum())
                if best is None or d < best:
                    best, pair = d, (i, j)
        i, j = pair
        groups[i] = groups[i] + groups[j]
        del groups[j]
    out = []
    for g in groups:
        m = np.isin(labels, g)
        L = lab[m, 0]
        lit = m.copy()
        lit[m] = L >= np.median(L)          # flat colour = the LIT half of the group
        rgb = (samples[lit] * weights[lit, None]).sum(0) / max(1e-9, weights[lit].sum())
        out.append({"rgb": [float(x) for x in rgb], "hex": pal.rgb_to_hex(rgb), "weight": float(weights[m].sum())})
    tot = sum(p["weight"] for p in out) or 1.0
    for p in out:
        p["share"] = round(p["weight"] / tot, 4)
    out.sort(key=lambda p: (-p["weight"], p["hex"]))
    return out


def nearest_palette(rgb, palette, lw):
    import numpy as np
    from slotbl import palette as pal
    P = pal.srgb_to_lab(np.array([p["rgb"] for p in palette])) * np.array([lw, 1, 1])
    Q = pal.srgb_to_lab(np.clip(rgb, 0, 1)) * np.array([lw, 1, 1])
    return ((Q[:, None, :] - P[None]) ** 2).sum(-1).argmin(1)


# ------------------------------------------------------------------------- geometry ---
def stats(meshes, arm):
    from slotbl import scene as S
    return {
        "meshes": len(meshes),
        "tris": sum(S.triangle_count(o) for o in meshes),
        "verts": sum(len(o.data.vertices) for o in meshes),
        "materials": len({m.name for o in meshes for m in o.data.materials if m}),
        "bones": len(arm.data.bones) if arm else 0,
        "deformBones": sum(1 for b in arm.data.bones if b.use_deform) if arm else 0,
        "shapeKeys": {o.name: [k.name for k in o.data.shape_keys.key_blocks[1:]] for o in meshes if o.data.shape_keys},
    }


def world_bbox(meshes):
    from slotbl import scene as S
    pts = S.world_points(meshes, evaluated=True)
    mn = [min(p[i] for p in pts) for i in range(3)]
    mx = [max(p[i] for p in pts) for i in range(3)]
    return mn, mx


def apply_modifier(obj, mod):
    import bpy
    with bpy.context.temp_override(object=obj, active_object=obj, selected_objects=[obj],
                                   selected_editable_objects=[obj]):
        bpy.ops.object.modifier_apply(modifier=mod.name)


def reduce(meshes, target, method, seed, log):
    import bpy
    from slotbl import scene as S
    tot = sum(S.triangle_count(o, False) for o in meshes)
    if not target or tot <= target:
        return {"method": None, "before": tot, "after": tot}
    free = [o for o in meshes if not o.data.shape_keys]
    locked = sum(S.triangle_count(o, False) for o in meshes if o.data.shape_keys)
    if locked:
        log.warn(f"{locked} tris on meshes with shape keys are not reduced (Blender cannot apply "
                 "Decimate to them); reduce those in the rig step")
    free_tris = tot - locked
    ratio = max(0.02, min(1.0, (target - locked) / max(1, free_tris)))
    for o in free:
        if method == "quadriflow" and not o.find_armature():
            try:
                faces = max(500, int(S.triangle_count(o, False) * ratio / 2))
                with bpy.context.temp_override(object=o, active_object=o, selected_objects=[o],
                                               selected_editable_objects=[o]):
                    bpy.ops.object.quadriflow_remesh(target_faces=faces, seed=seed, use_preserve_sharp=False,
                                                     use_preserve_boundary=False, use_mesh_symmetry=False)
                continue
            except RuntimeError as e:
                log.warn(f"{o.name}: QuadriFlow failed ({e}); falling back to decimate")
        mod = o.modifiers.new("decimate", "DECIMATE")
        mod.decimate_type = "COLLAPSE"
        mod.ratio = ratio
        mod.use_collapse_triangulate = True
        # keep it ahead of an Armature modifier so the rest shape is decimated
        while o.modifiers.find(mod.name) > 0:
            with bpy.context.temp_override(object=o, active_object=o):
                bpy.ops.object.modifier_move_up(modifier=mod.name)
        apply_modifier(o, mod)
    after = sum(S.triangle_count(o, False) for o in meshes)
    log(f"{method}: {tot} -> {after} tris (ratio {ratio:.3f})")
    return {"method": method, "before": tot, "after": after, "ratio": round(ratio, 4)}


def adjacency_smooth(me, labels, passes):
    import bmesh
    import numpy as np
    if passes <= 0:
        return labels
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.faces.ensure_lookup_table()
    nbrs = [[f2.index for e in f.edges for f2 in e.link_faces if f2.index != f.index] for f in bm.faces]
    bm.free()
    k = int(labels.max()) + 1 if len(labels) else 1
    for _ in range(passes):
        new = labels.copy()
        for i, nb in enumerate(nbrs):
            if not nb:
                continue
            votes = np.bincount(labels[nb], minlength=k)
            votes[labels[i]] += 2
            new[i] = votes.argmax()
        labels = new
    return labels


def palette_material(palette, mode):
    import bpy
    import numpy as np
    from slotbl import scene as S
    m, N, L = S.new_node_material("toon_palette")
    out = N.new("ShaderNodeOutputMaterial")
    bsdf = N.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Roughness"].default_value = 1.0
    bsdf.inputs["Metallic"].default_value = 0.0
    L.new(bsdf.outputs[0], out.inputs["Surface"])
    img = None
    if mode == "texture":
        cell = 8
        n = len(palette)
        w = 1
        while w < n * cell:
            w *= 2
        h = cell
        arr = np.ones((h, w, 4), dtype=np.float32)
        for i, p in enumerate(palette):
            arr[:, i * cell:(i + 1) * cell, :3] = p["rgb"]
        if n * cell < w:
            arr[:, n * cell:, :3] = palette[-1]["rgb"]
        img = bpy.data.images.new("toon_palette", w, h, alpha=False)
        img.colorspace_settings.name = "sRGB"
        img.pixels.foreach_set(arr.reshape(-1))
        img.pack()
        tex = N.new("ShaderNodeTexImage")
        tex.image = img
        tex.interpolation = "Closest"          # glTF sampler NEAREST: no bleeding between cells
        uvn = N.new("ShaderNodeUVMap")
        uvn.uv_map = "palette"
        L.new(uvn.outputs[0], tex.inputs["Vector"])
        L.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    else:
        ca = N.new("ShaderNodeVertexColor")
        ca.layer_name = "Color"
        L.new(ca.outputs["Color"], bsdf.inputs["Base Color"])
    return m, img


def assign_palette(obj, labels, palette, mode, mat, img):
    me = obj.data
    me.materials.clear()
    me.materials.append(mat)
    for p in me.polygons:
        p.material_index = 0
    if mode == "texture":
        cell = 8
        w = img.size[0]
        for uv in list(me.uv_layers):
            me.uv_layers.remove(uv)
        uvl = me.uv_layers.new(name="palette")
        for p in me.polygons:
            u = ((labels[p.index] + 0.5) * cell) / w
            for li in p.loop_indices:
                uvl.data[li].uv = (u, 0.5)
    else:
        attr = me.color_attributes.get("Color") or me.color_attributes.new("Color", "BYTE_COLOR", "CORNER")
        from slotbl import palette as pal
        for p in me.polygons:
            rgb = palette[labels[p.index]]["rgb"]
            lin = [pal.srgb_to_linear(c) for c in rgb]
            for li in p.loop_indices:
                attr.data[li].color = (*lin, 1.0)


# ----------------------------------------------------------------------------- main ---
def main(argv):
    args = build_parser().parse_args(argv)
    log = cli.Log("cleanup_mascot")
    src = cli.repo_path(args.input)
    if not src.exists():
        raise cli.ToolError(f"input not found: {src}")
    import bpy
    import numpy as np
    from mathutils import Matrix, Vector
    from mathutils.bvhtree import BVHTree
    from slotbl import provenance as prov
    from slotbl import scene as S

    S.reset_scene()
    new = S.import_model(src)
    for o in [o for o in new if o.type in ("LIGHT", "CAMERA")]:
        bpy.data.objects.remove(o)
    skip = {o for c in bpy.data.collections if c.name.startswith("glTF_not_exported") for o in c.objects}
    for o in skip:
        bpy.data.objects.remove(o)
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    arms = [o for o in bpy.data.objects if o.type == "ARMATURE"]
    if not meshes:
        raise cli.ToolError("no meshes in input")
    if len(arms) > 1:
        raise cli.ToolError(f"more than one armature: {[a.name for a in arms]}")
    arm = arms[0] if arms else None
    report = {"input": cli.rel(src), "inputSha256": prov.sha256_file(src), "before": stats(meshes, arm)}
    if arm is not None:
        report["rigPrep"] = S.prepare_rig_for_export(arm, src, log)
        for o in [o for o in bpy.data.objects if o.type == "EMPTY" and not o.children and o.parent == arm]:
            bpy.data.objects.remove(o)
    log(f"input: {report['before']['tris']} tris, {len(meshes)} meshes, {report['before']['bones']} bones")

    # ---- 2) orientation / scale / origin at the feet
    if arm is not None:
        arm.data.pose_position = "REST"
    bpy.context.view_layer.update()
    mn, mx = world_bbox(meshes)
    height = mx[2] - mn[2]
    s = (args.height / height) if args.height else 1.0
    M = (Matrix.Scale(s, 4) @ Matrix.Rotation(math.radians(args.yaw), 4, "Z")
         @ Matrix.Translation(Vector((-(mn[0] + mx[0]) / 2, -(mn[1] + mx[1]) / 2, -mn[2]))))
    if arm is None:
        for o in meshes:
            mw = o.matrix_world.copy()
            o.parent = None
            o.data.transform(M @ mw)
            o.matrix_world = Matrix.Identity(4)
        for o in [o for o in bpy.data.objects if o.type == "EMPTY" and not o.children]:
            bpy.data.objects.remove(o)
        transform_note = "baked into mesh data"
    else:
        roots = {o for o in bpy.data.objects if o.parent is None}
        for r in roots:
            r.matrix_world = M @ r.matrix_world
        transform_note = f"root transform on {sorted(r.name for r in roots)} (rig data untouched)"
    bpy.context.view_layer.update()
    mn2, mx2 = world_bbox(meshes)
    report["transform"] = {"scale": s, "yaw": args.yaw, "note": transform_note,
                           "bboxMin": [round(v, 4) for v in mn2], "bboxMax": [round(v, 4) for v in mx2]}
    H = mx2[2] - mn2[2]

    # ---- 3) weld + normals
    weld = {}
    for o in meshes:
        sc = o.matrix_world.to_scale()
        dist = args.weld * H / (((abs(sc.x) + abs(sc.y) + abs(sc.z)) / 3) or 1)
        b, a = S.weld_and_clean(o, dist, args.sharp_angle)
        weld[o.name] = [b, a]
    report["weld"] = weld
    log(f"welded: {sum(v[0] - v[1] for v in weld.values())} duplicate vertices removed")

    # ---- 4) palette from the original surface (before decimation)
    palette = None
    if args.colors > 0:
        cols, areas, originals = [], [], []
        for o in meshes:
            c, a = face_colors(o)
            wsc = o.matrix_world.to_scale()
            cols.append(c)
            areas.append(a * abs(wsc.x * wsc.y))
            dg = bpy.context.evaluated_depsgraph_get()
            originals.append((BVHTree.FromObject(o, dg, deform=False), c))
        samples = np.concatenate(cols)
        weights = np.concatenate(areas)
        palette = build_palette(samples, weights, args.colors, args.lightness_weight, args.seed)
        report["palette"] = [{"hex": p["hex"], "share": p["share"]} for p in palette]
        log("palette: " + " ".join(f"{p['hex']}({p['share']:.0%})" for p in palette))

    # ---- 5) reduce
    report["reduce"] = reduce(meshes, args.target_tris, args.remesh, args.seed, log)

    # ---- 5b) relax + re-shade (meshes with shape keys are skipped: bmesh would desync them)
    relaxed = []
    for o in meshes:
        if args.relax <= 0 or o.data.shape_keys:
            continue
        import bmesh
        bm = bmesh.new()
        bm.from_mesh(o.data)
        inner = [v for v in bm.verts if not v.is_boundary]
        for _ in range(args.relax):
            bmesh.ops.smooth_vert(bm, verts=inner, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
        bm.to_mesh(o.data)
        bm.free()
        relaxed.append(o.name)
    for o in meshes:
        S.weld_and_clean(o, 0.0, args.sharp_angle)
    report["relax"] = {"passes": args.relax, "meshes": relaxed}

    # ---- 6) assign palette per face from the original surface
    if palette:
        mat, img = palette_material(palette, args.palette_mode)
        for o, (tree, ocols) in zip(meshes, originals):
            me = o.data
            # 4 samples per face (centre + corners pulled 35% inward), majority vote
            pts, owner = [], []
            for p in me.polygons:
                c = p.center
                pts.append(c)
                for vi in list(p.vertices)[:3]:
                    pts.append(c.lerp(me.vertices[vi].co, 0.65))
                owner += [p.index] * 4
            rgb = np.empty((len(pts), 3), dtype=np.float32)
            for i, c in enumerate(pts):
                hit = tree.find_nearest(c)
                idx = hit[2] if hit and hit[2] is not None and hit[2] < len(ocols) else None
                rgb[i] = ocols[idx] if idx is not None else ocols[0]
            votes = nearest_palette(rgb, palette, args.lightness_weight).reshape(-1, 4)
            labels = np.array([np.bincount(v, minlength=len(palette)).argmax() if len(set(v)) > 1 else v[0]
                               for v in votes])
            labels = adjacency_smooth(me, labels, args.smooth)
            assign_palette(o, labels, palette, args.palette_mode, mat, img)
        for m in list(bpy.data.materials):
            if m.users == 0:
                bpy.data.materials.remove(m)
        for im in list(bpy.data.images):
            if im.users == 0:
                bpy.data.images.remove(im)
    if arm is not None:
        arm.data.pose_position = "POSE"

    # ---- 7) budgets + outputs
    after = stats(meshes, arm)
    report["after"] = after
    tex_sizes = [list(i.size) for i in bpy.data.images if i.users]
    budgets = {
        "tris": {"value": after["tris"], "limit": f"< {BUDGET['tris']}", "pass": after["tris"] < BUDGET["tris"]},
        "materials": {"value": after["materials"], "limit": f"<= {BUDGET['materials']}",
                      "pass": after["materials"] <= BUDGET["materials"]},
        "textures": {"value": tex_sizes, "limit": f"<= {BUDGET['texture']} px",
                     "pass": all(max(s) <= BUDGET["texture"] for s in tex_sizes)},
    }
    if arm is not None:
        b = after["deformBones"]
        budgets["bones"] = {"value": b, "limit": f"{BUDGET['bones_min']}-{BUDGET['bones_max']} (<= {BUDGET['bones_hard']})",
                            "pass": b <= BUDGET["bones_hard"], "inTarget": BUDGET["bones_min"] <= b <= BUDGET["bones_max"]}
    else:
        budgets["bones"] = {"value": 0, "limit": "n/a before rig_mascot.py", "pass": True}
    report["budgets"] = budgets
    failed = [k for k, v in budgets.items() if not v["pass"]]
    report["passed"] = not failed

    out = cli.out_path(args.out)
    if args.out_blend:
        ob = cli.out_path(args.out_blend)
        ob.parent.mkdir(parents=True, exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=str(ob), compress=False)
        report["blend"] = cli.rel(ob)
    S.export_glb(out, export_def_bones=bool(arm), export_image_format="AUTO")
    digest = prov.sha256_file(out)
    report["output"] = {"path": cli.rel(out), "bytes": out.stat().st_size, "sha256": digest}
    rep_path = out.with_suffix(".report.json")
    row = prov.make_row(id=prov.row_id("mesh", out.stem, digest), path=out, stage="3d-cleanup", sha256=digest,
                        model=f"blender-{S.blender_version().split()[0]}",
                        version=f"bpy {S.blender_version()}; tools/blender@{prov.toolkit_version()}",
                        ref_hashes=[report["inputSha256"]], parents=args.parent,
                        notes=f"cleanup of {cli.rel(src)}: {report['before']['tris']}->{after['tris']} tris, "
                              f"{len(palette or [])} toon colours ({args.palette_mode})",
                        qa={"passed": not failed, "report": cli.rel(rep_path), "budgets": {k: v['pass'] for k, v in budgets.items()}})
    prov.write_sidecar(out.with_suffix(".manifest.json"), [row], "tools/blender/cleanup_mascot.py")
    if args.manifest:
        prov.append_to_manifest(cli.repo_path(args.manifest), [row], "tools/blender/cleanup_mascot.py")
    rep_path.write_text(json.dumps(report, indent=2) + "\n")
    for k, v in budgets.items():
        log(f"  {'PASS' if v['pass'] else 'FAIL'} {k}: {v['value']} ({v['limit']})")
    log(f"-> {cli.rel(out)} ({out.stat().st_size} bytes); report {cli.rel(rep_path)}")
    if failed and args.strict:
        log.error(f"budget breach: {', '.join(failed)}")
        return 3
    return 0


if __name__ == "__main__":
    cli.run(main)
