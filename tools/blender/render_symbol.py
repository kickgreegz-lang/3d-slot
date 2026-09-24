#!/usr/bin/env python3
"""Baked 3D symbol inserts: toon-shaded, outlined, alpha PNG frame sequences.

Runs both ways (identical arguments after `--`):
    blender -b --factory-startup --python-exit-code 1 -P tools/blender/render_symbol.py -- --glyph K --clip turn
    python tools/blender/render_symbol.py --glyph K --clip turn          # bpy 5.2.2 as a module

Outputs (docs/ANIMATION_CONTRACT.md §8.1, docs/PIPELINE.md §5.1):
    build/frames/<SYM>_<clip>/<SYM>_<clip>_0001.png ...   frames only (one AssetPack {tps} folder)
    build/qa/blender/<SYM>_<clip>/{sheet.png,qa.json,anim.json,manifest.json,qa_*.png}
    art/_work/blender/raw/<SYM>_<clip>/                   supersampled raw renders (scratch)

Clips: turn (360 deg yaw loop), spin (N turns per loop + optional bob), shatter (procedural
Voronoi chunks, no Cell Fracture add-on), land (volume-preserving squash spring, optional),
static (1 frame: the rest pose, i.e. the frame-1 reference).
Loops are exact by construction: angle = 2*pi*revs*(f-1)/F, so frame F+1 == frame 1.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import random
import shutil
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from slotbl import cli  # noqa: E402
from slotbl import palette as pal  # noqa: E402

CLIPS = ("turn", "spin", "shatter", "land", "static")
DEFAULT_FRAMES = {"turn": 24, "spin": 24, "shatter": 14, "land": 12, "static": 1}
LOOPING = {"turn", "spin"}
EXAMPLES = """
examples:
  # 'K' royal (L2) 3D turn, CI-deterministic Cycles CPU, 256 px, 24 frames
  python tools/blender/render_symbol.py --glyph K --clip turn --size 256 --frames 24 --samples 16
  # procedural gold coin spin, EEVEE on the GPU workstation
  python tools/blender/render_symbol.py --sym coin --proc coin --clip spin --engine BLENDER_EEVEE
  # image-to-3D prop (Wild charm) shatter
  python tools/blender/render_symbol.py --sym W --mesh art/source/3d/props/W.glb --clip shatter
  # inside the Blender binary
  blender -b --factory-startup --python-exit-code 1 -P tools/blender/render_symbol.py -- --glyph A --clip static
"""


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(prog="render_symbol.py", description=__doc__.split("\n\n")[0],
                                 formatter_class=argparse.RawDescriptionHelpFormatter, epilog=EXAMPLES)
    ap.add_argument("--clip", required=True, choices=CLIPS)
    g = ap.add_argument_group("subject (one of --glyph / --proc / --mesh; --sym names the output)")
    g.add_argument("--sym", help="game id (L1..L5, H1..H4, W, S) or a prop id (coin, gem); "
                                 "default: resolved from --glyph via art/bible/artbible.json")
    g.add_argument("--glyph", help="royal glyph text, e.g. K or 10 (3D Text object)")
    g.add_argument("--proc", choices=("coin", "gem"), help="procedural prop geometry")
    g.add_argument("--mesh", help="GLB/GLTF/OBJ/FBX prop (e.g. an image-to-3D result)")
    g.add_argument("--yaw", type=float, default=0.0, help="extra yaw (deg) applied to --mesh")
    g.add_argument("--font", default="public/assets/fonts/LilitaOne-Regular.woff2",
                   help="font for --glyph (woff2 is converted via fontTools if Blender cannot read it)")
    g.add_argument("--color", help="base/face colour #RRGGBB (default: art bible)")
    g.add_argument("--shade", help="explicit deep-shadow colour #RRGGBB")
    g.add_argument("--depth", type=float, default=0.24, help="royal extrusion depth / glyph height")
    g.add_argument("--bevel", type=float, default=0.025, help="royal bevel / glyph height (inked)")
    f = ap.add_argument_group("framing and look")
    f.add_argument("--size", type=int, default=256, help="final frame size in px (square canvas)")
    f.add_argument("--ss", type=int, default=2, help="supersampling factor (render size*ss, Lanczos down)")
    f.add_argument("--fill", type=float, help="rest content height / canvas (default cellScale*150/180)")
    f.add_argument("--azim", type=float, help="camera azimuth deg (+ = from the right). default royal 12, props 22")
    f.add_argument("--elev", type=float, help="camera elevation deg (- = slight low angle). default -9 / -8")
    f.add_argument("--outline-px", type=float, help="outline width at final size (default 2.56%% of size "
                                                    "= 4.6 design px on the 180 px symbol canvas)")
    f.add_argument("--counter-outline", type=float, default=0.4,
                   help="glyphs: outline width inside counters (A, Q, 0) as a fraction of --outline-px")
    f.add_argument("--bands", default="0.02,0.35", help="N.L thresholds where the mid and lit bands start")
    f.add_argument("--spec", type=float, help="threshold on N.(key bent toward viewer) for the white specular "
                                              "streak (default 0.94 for coin/gem/mesh, off for royals; 0 = off)")
    r = ap.add_argument_group("render")
    r.add_argument("--engine", default="CYCLES", choices=("CYCLES", "BLENDER_EEVEE", "EEVEE"),
                   help="CYCLES = CPU emission-toon (deterministic CI reference); BLENDER_EEVEE = workstation")
    r.add_argument("--shading", default="auto", choices=("auto", "lit", "emission"),
                   help="auto: EEVEE -> lit (Shader to RGB), Cycles -> emission")
    r.add_argument("--samples", type=int, default=16)
    r.add_argument("--threads", type=int, default=0, help="render threads (0 = all)")
    r.add_argument("--frames", type=int, help="clip length F (default turn/spin 24, shatter 14, land 12)")
    r.add_argument("--fps", type=int, default=24)
    c = ap.add_argument_group("clip parameters")
    c.add_argument("--revs", type=int, help="full turns per loop (turn 1, spin 2)")
    c.add_argument("--bob", type=float, default=0.0, help="spin/turn vertical bob (fraction of height)")
    c.add_argument("--chunks", type=int, default=10, help="shatter: number of Voronoi chunks")
    c.add_argument("--seed", type=int, default=7, help="shatter: chunk/velocity seed")
    c.add_argument("--canvas-scale", type=float, default=1.6, help="shatter: canvas size vs the static canvas")
    c.add_argument("--spread", type=float, default=1.0, help="shatter: chunk velocity multiplier")
    c.add_argument("--spring-hz", type=float, default=3.2, help="land: squash spring frequency")
    c.add_argument("--zeta", type=float, default=0.33, help="land: damping ratio")
    c.add_argument("--squash", type=float, default=0.85, help="land: peak sy (sx = 1/sqrt(sy))")
    o = ap.add_argument_group("outputs")
    o.add_argument("--out", help="frame folder (default build/frames/<SYM>_<clip>)")
    o.add_argument("--qa-dir", help="QA folder (default build/qa/blender/<SYM>_<clip>)")
    o.add_argument("--work", help="raw render folder (default art/_work/blender/raw/<SYM>_<clip>)")
    o.add_argument("--static", help="static sprite PNG to compare frame 1 against (gate)")
    o.add_argument("--manifest", help="also append the row to this manifest file (append-only)")
    o.add_argument("--parent", action="append", default=[], help="parent manifest row id (repeatable)")
    o.add_argument("--outline-min-px", type=float, default=3.0, help="gate: minimum outline width")
    o.add_argument("--no-gates", action="store_true", help="report gate failures but exit 0")
    o.add_argument("--keep-raw", action="store_true", help="keep supersampled raw renders")
    o.add_argument("--dry-run", action="store_true", help="resolve inputs, print the plan, render nothing")
    return ap


# ------------------------------------------------------------------------ resolving ---
def resolve(args, log) -> dict:
    bible = pal.load_artbible()
    info = None
    if args.glyph:
        info = pal.symbol_info(bible, args.glyph)
    if args.sym:
        info = pal.symbol_info(bible, args.sym) or info
    sym = args.sym or (info["id"] if info else None) or args.glyph
    if not sym:
        raise cli.ToolError("name the subject with --sym, --glyph, --proc or --mesh")
    subject = "mesh" if args.mesh else "proc" if args.proc else "glyph"
    glyph = args.glyph
    if subject == "glyph" and not glyph:
        if info and info.get("glyph"):
            glyph = info["glyph"]
        elif info:
            glyph = sym
            log.warn(f"{sym} is a {info.get('kind')} symbol with no mesh: rendering the letter "
                     f"'{glyph}' as a placeholder (pass --mesh for the real prop)")
        else:
            raise cli.ToolError(f"--sym {sym} is not in the art bible; add --glyph, --proc or --mesh")
    kind = (info or {}).get("kind") or ("royal" if subject == "glyph" else "prop")
    colors = pal.symbol_colors(info, bible)
    if subject == "proc" and args.proc == "coin" and not args.color:
        colors = {"face": pal.GOLD["lit"]}
    face = args.color or colors.get("face") or ("#35F2E0" if args.proc == "gem" else "#FFC629")
    shade = args.shade or colors.get("shade")
    royal_like = subject == "glyph"
    cs = pal.cell_scale(sym, kind)
    fill = args.fill or min(0.95, cs * 150 / 180)
    frames = args.frames or DEFAULT_FRAMES[args.clip]
    if args.clip == "static":
        frames = 1
    if frames < 1:
        raise cli.ToolError("--frames must be >= 1")
    size = args.size
    outline_px = args.outline_px if args.outline_px is not None else round(size * 4.6 / 180, 2)
    spec = args.spec if args.spec is not None else (0.0 if royal_like else 0.94)
    prefix = f"{sym}_{args.clip}"
    canvas_scale = args.canvas_scale if args.clip == "shatter" else 1.0
    return {
        "sym": sym, "kind": kind, "subject": subject, "glyph": glyph, "face": face.upper(),
        "shade": shade.upper() if shade else None, "fill": round(fill, 4), "cellScale": cs,
        "frames": frames, "loop": args.clip in LOOPING, "size": size, "ss": args.ss,
        "size_final": int(round(size * canvas_scale)), "canvas_scale": canvas_scale,
        "outline_px": outline_px, "spec": spec, "prefix": prefix,
        "azim": args.azim if args.azim is not None else (12.0 if royal_like else 22.0),
        "elev": args.elev if args.elev is not None else (-9.0 if royal_like else -8.0),
        "bands": tuple(float(x) for x in args.bands.split(",")),
        "revs": args.revs or (2 if args.clip == "spin" else 1),
        "out": cli.out_path(args.out or f"build/frames/{prefix}"),
        "qa": cli.out_path(args.qa_dir or f"build/qa/blender/{prefix}"),
        "work": cli.out_path(args.work or f"art/_work/blender/raw/{prefix}"),
    }


# ------------------------------------------------------------------------- subjects ---
def build_glyph(args, plan, log):
    import bmesh  # noqa: F401
    from slotbl import scene as S
    font_path = cli.repo_path(args.font)
    if not font_path.exists():
        raise cli.ToolError(f"font not found: {font_path}")
    font, ttf = S.load_font(font_path)
    if ttf:
        log(f"font converted to TTF via fontTools: {ttf}")
    probe = S.text_mesh(plan["glyph"], font, 0.0, 0.0, 0)
    zs = [v.co.z for v in probe.vertices]
    h0 = (max(zs) - min(zs)) if zs else 1.0
    import bpy
    bpy.data.meshes.remove(probe)
    me = S.text_mesh(plan["glyph"], font, extrude=args.depth * h0 / 2, bevel=args.bevel * h0)
    obj = S.link_new_object(f"sym_{plan['sym']}", me)
    holes = S.glyph_holes(plan["glyph"], font)
    if holes and args.counter_outline < 1.0:
        n = S.weight_counter_vertices(obj, holes, margin=args.bevel * h0 * 1.5)
        obj["counter_outline"] = args.counter_outline
        log(f"{len(holes)} counter(s): hull thinned to {args.counter_outline:.0%} on {n} vertices")
    S.normalize_mesh(obj, 1.0)
    S.weld_and_clean(obj, 1e-5, sharp_angle_deg=30.0)
    # material zones by object-space normal: 0 enamel face (front and back caps, so the turn
    # shows enamel on both sides), 1 ink (bevel = interior line between face and extrusion),
    # 2 extrusion (plum side walls, ART_BIBLE §3 "Extrusion")
    placeholder_slots(obj, 4)
    for p in me.polygons:
        ay = abs(p.normal.y)
        p.material_index = 0 if ay > 0.93 else (1 if ay > 0.30 else 2)
    ext = {"deep": "#2E1426", "mid": pal.EXTRUSION, "lit": pal.EXTRUSION_LIT}
    roles = [
        {"name": "face", "bands": pal.derive_bands(plan["face"], plan["shade"]), "spec": False},
        {"name": "ink", "flat": pal.INK},
        {"name": "extrusion", "bands": ext, "spec": False},
        {"name": "inner", "bands": ext, "spec": False},
    ]
    return obj, roles, [pal_ref(font_path)]


def placeholder_slots(obj, n: int) -> None:
    """Material slots must exist before polygon material_index is set (clearing slots resets
    the indices to 0); main() later swaps the real toon materials into these slots."""
    import bpy
    while len(obj.data.materials) < n:
        obj.data.materials.append(bpy.data.materials.new(f"slot{len(obj.data.materials)}"))


def assign_slots(obj, mats) -> None:
    for i, m in enumerate(mats):
        if i < len(obj.data.materials):
            obj.data.materials[i] = m
        else:
            obj.data.materials.append(m)
    while len(obj.data.materials) > len(mats):
        obj.data.materials.pop()


def pal_ref(path):
    from slotbl.provenance import file_ref
    return file_ref(path)


def build_coin(args, plan, log):
    import bmesh
    import bpy
    from mathutils import Matrix, Vector
    from slotbl import scene as S
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=64, radius1=0.5, radius2=0.5, depth=0.12)
    caps = [f for f in bm.faces if abs(f.normal.z) > 0.99]
    for cap in caps:
        bmesh.ops.inset_region(bm, faces=[cap], thickness=0.055, depth=-0.014, use_even_offset=True)
    rim = [e for e in bm.edges if all(abs(v.co.xy.length - 0.5) < 1e-4 for v in e.verts)
           and all(abs(abs(v.co.z) - 0.06) < 1e-4 for v in e.verts)]
    bmesh.ops.bevel(bm, geom=rim, offset=0.018, segments=2, profile=0.5, affect="EDGES")
    # five-point star emblem on both faces (no text on symbols); material 1 = emblem
    for sgn in (1, -1):
        z = sgn * (0.06 - 0.014)
        pts = []
        for i in range(10):
            a = math.pi / 2 + i * math.pi / 5
            rr = 0.25 if i % 2 == 0 else 0.105
            pts.append(bm.verts.new((rr * math.cos(a), rr * math.sin(a), z)))
        face = bm.faces.new(pts if sgn > 0 else list(reversed(pts)))
        face.material_index = 1              # extruded walls/top inherit it
        ext = bmesh.ops.extrude_face_region(bm, geom=[face])
        moved = [v for v in ext["geom"] if isinstance(v, bmesh.types.BMVert)]
        bmesh.ops.translate(bm, verts=moved, vec=Vector((0, 0, sgn * 0.022)))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new("coin")
    bm.to_mesh(me)
    bm.free()
    me.transform(Matrix.Rotation(math.radians(90), 4, "X"))
    obj = S.link_new_object(f"sym_{plan['sym']}", me)
    placeholder_slots(obj, 3)
    S.normalize_mesh(obj, 1.0)
    S.weld_and_clean(obj, 1e-6, sharp_angle_deg=40.0)
    gold = {"deep": pal.GOLD["deep"], "mid": pal.GOLD["mid"], "lit": plan["face"]}
    emblem = {"deep": pal.GOLD["mid"], "mid": plan["face"], "lit": pal.GOLD["light"]}
    roles = [{"name": "gold", "bands": gold, "spec": True},
             {"name": "emblem", "bands": emblem, "spec": True},
             {"name": "inner", "bands": {"deep": pal.GOLD["deep"], "mid": pal.GOLD["deep"], "lit": pal.GOLD["mid"]}}]
    return obj, roles, []


def build_gem(args, plan, log):
    import bmesh
    import bpy
    from slotbl import scene as S
    n = 8
    bm = bmesh.new()
    culet = bm.verts.new((0, 0, 0))
    gird = [bm.verts.new((0.55 * math.cos(2 * math.pi * i / n), 0.55 * math.sin(2 * math.pi * i / n), 0.6)) for i in range(n)]
    table = [bm.verts.new((0.33 * math.cos(2 * math.pi * (i + 0.5) / n), 0.33 * math.sin(2 * math.pi * (i + 0.5) / n), 0.86))
             for i in range(n)]
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((gird[j], gird[i], culet))
        bm.faces.new((gird[i], gird[j], table[i]))
        bm.faces.new((table[i], gird[j], table[j]))
    bm.faces.new(table)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new("gem")
    bm.to_mesh(me)
    bm.free()
    obj = S.link_new_object(f"sym_{plan['sym']}", me)
    placeholder_slots(obj, 2)
    S.normalize_mesh(obj, 1.0)
    S.weld_and_clean(obj, 1e-6, sharp_angle_deg=5.0)   # faceted
    bands = pal.derive_bands(plan["face"], plan["shade"])
    obj["convex"] = True
    roles = [{"name": "gem", "bands": bands, "spec": True},
             {"name": "inner", "bands": {"deep": bands["deep"], "mid": bands["deep"], "lit": bands["mid"]}}]
    return obj, roles, []


def build_mesh(args, plan, log):
    import bpy
    from mathutils import Matrix
    from slotbl import scene as S
    path = cli.repo_path(args.mesh)
    if not path.exists():
        raise cli.ToolError(f"mesh not found: {path}")
    new = S.import_model(path)
    meshes = [o for o in new if o.type == "MESH"]
    if not meshes:
        raise cli.ToolError(f"{path} contains no mesh")
    for o in new:
        if o.type == "ARMATURE":
            log.warn("armature ignored: props are rendered in their rest/import pose")
    obj = S.join_meshes(meshes)
    for o in new:
        if o != obj and o.name in bpy.data.objects and o.type != "MESH":
            bpy.data.objects.remove(o)
    for m in list(obj.modifiers):
        obj.modifiers.remove(m)
    S.bake_transform(obj)
    if args.yaw:
        obj.data.transform(Matrix.Rotation(math.radians(args.yaw), 4, "Z"))
    S.normalize_mesh(obj, 1.0)
    before, after = S.weld_and_clean(obj, 1e-4, sharp_angle_deg=35.0)
    log(f"mesh {path.name}: welded {before}->{after} verts, {S.triangle_count(obj, False)} tris")
    roles = []
    for i, m in enumerate(obj.data.materials):
        base, image = "#BBBBBB", None
        if m and m.node_tree:
            bsdf = next((n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
            if bsdf:
                inp = bsdf.inputs["Base Color"]
                if inp.is_linked and inp.links[0].from_node.type == "TEX_IMAGE":
                    image = inp.links[0].from_node.image
                else:
                    base = pal.rgb_to_hex([pal.linear_to_srgb(c) for c in inp.default_value[:3]])
        if image is not None:
            roles.append({"name": f"mat{i}", "albedo": image, "spec": plan["spec"] > 0})
        else:
            roles.append({"name": f"mat{i}", "bands": pal.derive_bands(args.color or base), "spec": plan["spec"] > 0})
    if not roles:
        roles.append({"name": "base", "bands": pal.derive_bands(plan["face"], plan["shade"]), "spec": True})
    roles.append({"name": "inner", "bands": pal.derive_bands(pal.EXTRUSION)})
    placeholder_slots(obj, len(roles))
    return obj, roles, [pal_ref(path)]


# ------------------------------------------------------------------------- fracture ---
def fracture(obj, n: int, seed: int, inner_index: int, log):
    """Solid Voronoi chunks without the Cell Fracture add-on: for every seed, bisect a copy of
    the mesh by the perpendicular-bisector plane to every other seed (clear the far side)
    and cap each cut with triangle_fill."""
    import bmesh
    import bpy
    from mathutils import Vector
    from slotbl import scene as S
    rng = random.Random(seed)
    me = obj.data
    polys = list(me.polygons)
    areas = [p.area for p in polys]
    tot = sum(areas)
    seeds = []
    ys = [v.co.y for v in me.vertices]
    ymid = (min(ys) + max(ys)) / 2
    while len(seeds) < n:
        r = rng.random() * tot
        acc = 0.0
        for p, a in zip(polys, areas):
            acc += a
            if acc >= r:
                break
        vs = [me.vertices[i].co for i in p.vertices]
        w = [rng.random() for _ in vs]
        s = sum(w) or 1.0
        pt = sum((v * (wi / s) for v, wi in zip(vs, w)), Vector())
        pt.y = ymid + (pt.y - ymid) * 0.3
        if all((pt - q).length > 0.08 for q in seeds):
            seeds.append(pt)
    chunks = []
    for i, s in enumerate(seeds):
        bm = bmesh.new()
        bm.from_mesh(me)
        for j, s2 in enumerate(seeds):
            if i == j or not bm.faces:
                continue
            no = (s2 - s).normalized()
            co = (s + s2) / 2
            res = bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], dist=1e-6,
                                         plane_co=co, plane_no=no, clear_outer=True, clear_inner=False)
            cut = [e for e in res["geom_cut"] if isinstance(e, bmesh.types.BMEdge)]
            if cut:
                try:
                    filled = bmesh.ops.triangle_fill(bm, use_beauty=True, use_dissolve=False, edges=cut, normal=no)
                    for f in filled["geom"]:
                        if isinstance(f, bmesh.types.BMFace):
                            f.material_index = inner_index
                except Exception as e:  # noqa: BLE001 - an open cap is still renderable
                    log.warn(f"chunk {i}: cap fill failed ({e}); chunk left open")
        if len(bm.faces) < 4:
            bm.free()
            continue
        cmesh = bpy.data.meshes.new(f"chunk_{i:02d}")
        bm.to_mesh(cmesh)
        bm.free()
        for m in me.materials:
            cmesh.materials.append(m)
        cen = sum((v.co for v in cmesh.vertices), Vector()) / max(1, len(cmesh.vertices))
        from mathutils import Matrix
        cmesh.transform(Matrix.Translation(-cen))
        cmesh.shade_smooth()
        cmesh.set_sharp_from_angle(angle=math.radians(30))
        ch = S.link_new_object(f"chunk_{i:02d}", cmesh)
        ch.parent = obj.parent
        ch.location = cen
        chunks.append({"obj": ch, "c0": cen.copy()})
    log(f"shatter: {len(chunks)} chunks from {n} seeds (seed {seed})")
    return chunks


# --------------------------------------------------------------------------- motion ---
def smoothstep(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def make_motion(args, plan, root, chunks, intact=None):
    from mathutils import Matrix, Vector
    F, fps, clip = plan["frames"], args.fps, args.clip
    if clip in ("turn", "spin"):
        def state(f):
            ang = 2 * math.pi * plan["revs"] * (f - 1) / F
            root.rotation_euler = (0, 0, ang)
            root.location = (0, 0, args.bob * math.sin(2 * math.pi * (f - 1) / F))
        return state
    if clip == "land":
        w = 2 * math.pi * args.spring_hz
        z = args.zeta
        wd = w * math.sqrt(max(1e-6, 1 - z * z))
        xs = [-math.exp(-z * w * t) * math.sin(wd * t) for t in (i / 1000 for i in range(1000))]
        amp = (1 - args.squash) / max(1e-6, -min(xs))

        def state(f):
            t = (f - 1) / fps
            sz = 1 - amp * math.exp(-z * w * t) * math.sin(wd * t)
            sxy = 1 / math.sqrt(sz)
            root.scale = (sxy, sxy, sz)
        return state
    if clip == "shatter":
        rng = random.Random(args.seed + 1)
        fb = 3 if F >= 6 else 2          # explode_burst lands on frame 2-3 (ANIMATION_CONTRACT §3)
        centre = sum((c["c0"] for c in chunks), Vector()) / max(1, len(chunks))
        for c in chunks:
            d = c["c0"] - centre
            d.y *= 0.3
            d = d.normalized() if d.length > 1e-6 else Vector((0, 0, 1))
            c["v"] = (d * rng.uniform(1.1, 1.9) + Vector((0, -0.4, 0.9))) * args.spread
            ax = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1)))
            c["axis"] = ax.normalized() if ax.length > 1e-6 else Vector((0, 0, 1))
            c["w"] = rng.uniform(5.0, 11.0) * rng.choice((-1, 1))
        g = Vector((0, 0, -5.0))

        def state(f):
            swell = 1.04 if (fb == 3 and f == 2) else 1.0
            root.scale = (swell, swell, swell)
            # before the burst the INTACT mesh is shown, so frame 1 == the static render exactly
            # (per-chunk hulls would draw crack lines); the cracks appear on the burst frame.
            if intact is not None:
                intact.hide_render = f >= fb
            for c in chunks:
                c["obj"].hide_render = f < fb
            t = max(0.0, (f - fb) / fps)
            u = 0.0 if f <= fb else (f - fb) / max(1, F - fb)
            s = 1 - smoothstep(0.35, 1.0, u)
            for c in chunks:
                if f <= fb:
                    c["obj"].matrix_basis = Matrix.Translation(c["c0"])
                    continue
                pos = c["c0"] + c["v"] * t + g * (0.5 * t * t)
                m = Matrix.Translation(pos) @ Matrix.Rotation(c["w"] * t, 4, c["axis"]) @ Matrix.Scale(max(s, 1e-4), 4)
                c["obj"].matrix_basis = m
                c["obj"].hide_render = s < 1e-3 or f < fb
        return state

    def state(f):  # static
        root.rotation_euler = (0, 0, 0)
    return state


# ----------------------------------------------------------------------------- main ---
def main(argv):
    args = build_parser().parse_args(argv)
    log = cli.Log("render_symbol")
    if args.proc and args.mesh:
        raise cli.ToolError("use only one of --proc / --mesh")
    plan = resolve(args, log)
    log(f"{plan['prefix']}: subject={plan['subject']}{'/' + plan['glyph'] if plan['subject'] == 'glyph' else ''} "
        f"kind={plan['kind']} face={plan['face']} fill={plan['fill']} frames={plan['frames']} "
        f"size={plan['size_final']}x{plan['ss']} outline={plan['outline_px']}px engine={args.engine}")
    if args.dry_run:
        print(json.dumps({k: (str(v) if isinstance(v, Path) else v) for k, v in plan.items()}, indent=2))
        return 0

    import bpy
    from mathutils import Vector
    from slotbl import scene as S
    from slotbl.provenance import toolkit_version

    scene = S.reset_scene()
    scene.render.fps = args.fps
    engine = S.ENGINE_ALIASES[args.engine]
    shading = args.shading if args.shading != "auto" else ("lit" if engine == "BLENDER_EEVEE" else "emission")
    if engine == "CYCLES" and shading == "lit":
        raise cli.ToolError("Shader to RGB is EEVEE-only: use --shading emission with Cycles")
    S.black_world(scene)

    if plan["subject"] == "mesh":
        obj, roles, refs = build_mesh(args, plan, log)
    elif args.proc == "coin":
        obj, roles, refs = build_coin(args, plan, log)
    elif args.proc == "gem":
        obj, roles, refs = build_gem(args, plan, log)
    else:
        obj, roles, refs = build_glyph(args, plan, log)
    root = bpy.data.objects.new("root", None)
    scene.collection.objects.link(root)
    obj.parent = root

    # ---- framing: rest content (without hull) fills `fill` of the canvas height
    S0, cs = plan["size"], plan["canvas_scale"]
    cam = S.ortho_camera(scene, plan["azim"], plan["elev"], Vector((0, 0, 0.5)), 1.0)
    pts = S.camera_space_points(cam, S.world_points([obj]))
    xs, ys = [p.x for p in pts], [p.y for p in pts]
    w, h = max(xs) - min(xs), max(ys) - min(ys)
    frac_ol = 2 * plan["outline_px"] / S0
    ortho = h / max(0.05, plan["fill"] - frac_ol)
    if w / ortho + frac_ol > 0.94:
        ortho = w / (0.94 - frac_ol)
        log.warn(f"content is wide: fill reduced to {h / ortho + frac_ol:.3f} of the canvas height")
    right, up, _ = S.camera_axes(cam)
    cam.location += right * ((max(xs) + min(xs)) / 2) + up * ((max(ys) + min(ys)) / 2)
    cam.data.ortho_scale = ortho * cs
    bpy.context.view_layer.update()
    thickness = plan["outline_px"] * ortho / S0
    key_w, view_w = S.key_vectors(cam)
    if shading == "lit":
        S.add_key_sun(scene, key_w)

    # ---- materials
    mats = []
    for role in roles:
        if "flat" in role:
            mats.append(S.flat_material(role["name"], role["flat"]))
            continue
        spec = plan["spec"] if role.get("spec") else 0
        if "albedo" in role:
            mats.append(S.toon_material(role["name"], bands_lin=S.multiplier_bands(), thresholds=plan["bands"],
                                        key_world=key_w, view_world=view_w, mode=shading,
                                        albedo=role["albedo"], spec=spec))
        else:
            b = role["bands"]
            lin = tuple(pal.hex_to_linear(b[k]) for k in ("deep", "mid", "lit"))
            mats.append(S.toon_material(role["name"], bands_lin=lin, thresholds=plan["bands"],
                                        key_world=key_w, view_world=view_w, mode=shading, spec=spec))
    assign_slots(obj, mats)
    inner_index = len(mats) - 1
    ink = S.outline_material()

    res = plan["size_final"] * plan["ss"]
    S.configure_render(scene, engine, res, args.samples, threads=args.threads, seed=0)

    work = plan["work"]
    if work.exists():
        shutil.rmtree(work)
    work.mkdir(parents=True)
    rest_path = None
    chunks = []
    convex = bool(obj.get("convex", False))
    S.add_hull(obj, thickness, ink, even=convex)
    targets = [obj]
    if args.clip == "shatter":
        rest_path = S.render_still(scene, work / "qa_rest.png")     # intact subject = static ref
        obj.modifiers.remove(obj.modifiers["outline_hull"])
        for _ in range(len(mats)):
            obj.data.materials.pop()
        chunks = fracture(obj, args.chunks, args.seed, inner_index, log)
        for c in chunks:
            S.add_hull(c["obj"], thickness, ink)
        S.add_hull(obj, thickness, ink, even=convex)
        targets = [obj] + [c["obj"] for c in chunks]
    state = make_motion(args, plan, root, chunks, intact=obj if chunks else None)

    F = plan["frames"]
    for f in range(1, F + 1):
        state(f)
        bpy.context.view_layer.update()
        S.render_still(scene, work / f"raw_{f:04d}.png")
    extras = {}
    if plan["loop"]:
        state(F + 1)
        bpy.context.view_layer.update()
        extras["next"] = str(S.render_still(scene, work / "qa_next.png"))
    state(1)
    S.set_hull_visible(targets, False)
    bpy.context.view_layer.update()
    extras["nohull"] = str(S.render_still(scene, work / "qa_nohull.png"))
    S.set_hull_visible(targets, True)
    if rest_path:
        extras["rest"] = str(rest_path)

    pivot = S.project_px(scene, cam, root.matrix_world.translation)
    meta = {
        "tool": "tools/blender/render_symbol.py",
        "sym": plan["sym"], "clip": args.clip, "prefix": plan["prefix"], "kind": plan["kind"],
        "subject": plan["subject"], "glyph": plan["glyph"], "proc": args.proc,
        "frames": F, "fps": args.fps, "loop": plan["loop"],
        "size": S0, "size_final": plan["size_final"], "ss": plan["ss"], "canvas_scale": cs,
        "raw_dir": str(work), "raw_pattern": "raw_{:04d}.png", "extras": extras,
        "out_dir": str(plan["out"]), "qa_dir": str(plan["qa"]),
        "pivot_px": [pivot[0] / plan["ss"], pivot[1] / plan["ss"]],
        "outline_px": plan["outline_px"], "fill": plan["fill"], "azim": plan["azim"], "elev": plan["elev"],
        "engine": engine, "shading": shading, "samples": args.samples, "seed": args.seed if args.clip == "shatter" else None,
        "face": plan["face"], "revs": plan["revs"] if plan["loop"] else None,
        "blender": S.blender_version(), "toolkit": toolkit_version(),
        "inputs": refs, "static_ref": str(cli.repo_path(args.static)) if args.static else None,
        "manifest": str(cli.repo_path(args.manifest)) if args.manifest else None,
        "parents": args.parent, "gates": {"outline_min_px": args.outline_min_px}, "no_gates": args.no_gates,
        "keep_raw": args.keep_raw, "render_seconds": round(log.elapsed(), 1),
    }
    meta_path = work / "meta.json"
    meta_path.write_text(json.dumps(meta, indent=2))
    log(f"rendered {F} frames (+{len(extras)} QA) at {res}px in {log.elapsed():.1f}s -> post-processing")
    return run_post(meta_path, log)


def run_post(meta_path: Path, log) -> int:
    try:
        import numpy  # noqa: F401
        import PIL  # noqa: F401
        have = True
    except ImportError:
        have = False
    if have:
        import frames_post
        return frames_post.process(json.loads(meta_path.read_text()))
    py = os.environ.get("SLOT_PYTHON") or "python3"
    log(f"Pillow/numpy not importable here; post-processing with {py}")
    return subprocess.call([py, str(Path(__file__).with_name("frames_post.py")), "--meta", str(meta_path)])


if __name__ == "__main__":
    cli.run(main)
