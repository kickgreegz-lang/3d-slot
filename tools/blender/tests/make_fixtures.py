#!/usr/bin/env python3
"""Deterministic stand-ins for vendor outputs, used by tools/blender/tests/run_tests.sh.

    python tools/blender/tests/make_fixtures.py --out art/_work/fixtures

fixture_mascot.glb  "image-to-3D mascot": dense voxel-fused blob (~40k tris), vertices split along
                    sharp edges (like GLB seams), front-projected texture with BAKED lighting,
                    noise and 4 painted regions (skin, belly, eyes, gold tooth).
fixture_prop.glb    "image-to-3D prop": textured jar (UV sphere + lid), the prototype's stand-in.
Nothing here ships; these only exercise cleanup_mascot.py / turntable.py / render_symbol.py --mesh.
"""
from __future__ import annotations

import argparse
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from slotbl import cli  # noqa: E402


def paint_texture(size=256, seed=3):
    import numpy as np
    rng = np.random.RandomState(seed)
    u = (np.arange(size) + 0.5) / size
    U, V = np.meshgrid(u, u)          # V: 0 = bottom
    skin = np.array([0.25, 0.62, 0.23])
    belly = np.array([0.93, 0.88, 0.67])
    white = np.array([0.97, 0.97, 0.95])
    black = np.array([0.05, 0.04, 0.06])
    gold = np.array([0.95, 0.76, 0.19])
    img = np.ones((size, size, 3)) * skin
    m_belly = ((U - 0.5) / 0.18) ** 2 + ((V - 0.36) / 0.2) ** 2 < 1
    img[m_belly] = belly
    for ex in (0.42, 0.58):
        m_eye = ((U - ex) / 0.045) ** 2 + ((V - 0.80) / 0.05) ** 2 < 1
        img[m_eye] = white
        m_pup = ((U - ex) / 0.018) ** 2 + ((V - 0.79) / 0.022) ** 2 < 1
        img[m_pup] = black
    m_tooth = ((U - 0.53) / 0.02) ** 2 + ((V - 0.705) / 0.015) ** 2 < 1
    img[m_tooth] = gold
    light = 0.75 + 0.45 * (V - 0.3) - 0.25 * (U - 0.5)          # baked top-left light
    img = img * light[..., None] + rng.normal(0, 0.035, img.shape)  # + texture noise
    img = np.clip(img, 0, 1)
    rgba = np.concatenate([img, np.ones((size, size, 1))], axis=-1)
    return rgba.astype("float32")  # row 0 = V 0 = bottom, which is Blender's pixel order


def make_mascot(out: Path):
    import bpy
    import bmesh
    from slotbl import scene as S
    S.reset_scene()
    parts = [((0, 0, 1.0), 0.75, (1.0, 0.9, 1.25)), ((0, -0.05, 1.95), 0.55, (1, 1, 0.9)),
             ((0, -0.5, 1.9), 0.32, (0.8, 1.6, 0.6)), ((0.78, 0, 1.25), 0.28, (0.8, 0.8, 1.6)),
             ((-0.78, 0, 1.25), 0.28, (0.8, 0.8, 1.6)), ((0.32, 0, 0.3), 0.32, (1, 1, 1.3)),
             ((-0.32, 0, 0.3), 0.32, (1, 1, 1.3)), ((0, 0.7, 0.55), 0.3, (0.8, 1.8, 0.7))]
    bm = bmesh.new()
    for co, r, sc in parts:        # overlapping ellipsoids, fused by a voxel remesh below
        geom = bmesh.ops.create_uvsphere(bm, u_segments=24, v_segments=12, radius=r)
        vs = geom["verts"]
        for v in vs:
            v.co = (v.co.x * sc[0] + co[0], v.co.y * sc[1] + co[1], v.co.z * sc[2] + co[2])
    me = bpy.data.meshes.new("blob")
    bm.to_mesh(me)
    bm.free()
    mesh_ob = S.link_new_object("cand_mascot", me)
    rem = mesh_ob.modifiers.new("fuse", "REMESH")
    rem.mode = "VOXEL"
    rem.voxel_size = 0.028
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(mesh_ob.evaluated_get(dg))
    mesh_ob.modifiers.clear()
    mesh_ob.data = me
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    bm.to_mesh(me)
    bm.free()
    import numpy as np
    co = np.empty(len(me.vertices) * 3, dtype=np.float32)
    me.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    vi = np.empty(len(me.loops), dtype=np.int32)
    me.loops.foreach_get("vertex_index", vi)
    x, z = co[vi, 0], co[vi, 2]
    uv = np.stack([(x - co[:, 0].min()) / np.ptp(co[:, 0]), (z - co[:, 2].min()) / np.ptp(co[:, 2])], -1)
    uvl = me.uv_layers.new(name="UVMap")
    uvl.data.foreach_set("uv", uv.astype(np.float32).reshape(-1))
    img = bpy.data.images.new("baked_albedo", 256, 256)
    img.pixels.foreach_set(paint_texture().reshape(-1))
    img.pack()
    m, N, L = S.new_node_material("vendor_pbr")
    bsdf = N.new("ShaderNodeBsdfPrincipled")
    tex = N.new("ShaderNodeTexImage")
    tex.image = img
    outn = N.new("ShaderNodeOutputMaterial")
    L.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    L.new(bsdf.outputs[0], outn.inputs["Surface"])
    me.materials.append(m)
    mod = mesh_ob.modifiers.new("split", "EDGE_SPLIT")   # vendor-style split vertices
    mod.split_angle = math.radians(25)
    S.export_glb(out, export_apply=True, export_animations=False, export_skins=False, export_morph=False)
    return len(me.polygons)


def make_prop(out: Path):
    import bpy
    import numpy as np
    from slotbl import scene as S
    S.reset_scene()
    bpy.ops.mesh.primitive_uv_sphere_add(segments=48, ring_count=24, radius=1.0)
    body = bpy.context.active_object
    body.scale = (1, 1, 1.15)
    bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=0.75, depth=0.35, location=(0, 0, 1.2))
    lid = bpy.context.active_object
    img = bpy.data.images.new("albedo", 64, 64)
    y = np.arange(64)[:, None].repeat(64, 1)
    stripe = ((y // 8) % 2).astype(bool)
    px = np.where(stripe[..., None], [0.95, 0.75, 0.35, 1.0], [0.55, 0.85, 0.95, 1.0]).astype("float32")
    img.pixels.foreach_set(px.reshape(-1))
    img.pack()
    m, N, L = S.new_node_material("jar")
    bsdf = N.new("ShaderNodeBsdfPrincipled")
    tex = N.new("ShaderNodeTexImage")
    tex.image = img
    outn = N.new("ShaderNodeOutputMaterial")
    L.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    L.new(bsdf.outputs[0], outn.inputs["Surface"])
    for o in (body, lid):
        o.data.materials.append(m)
    S.export_glb(out, export_apply=True, export_animations=False)


def main(argv):
    ap = argparse.ArgumentParser(prog="make_fixtures.py", description=__doc__.split("\n\n")[0])
    ap.add_argument("--out", default="art/_work/fixtures")
    args = ap.parse_args(argv)
    out = cli.out_path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    n = make_mascot(out / "fixture_mascot.glb")
    make_prop(out / "fixture_prop.glb")
    print(f"[make_fixtures] fixture_mascot.glb ({n} tris) + fixture_prop.glb -> {cli.rel(out)}")
    return 0


if __name__ == "__main__":
    cli.run(main)
