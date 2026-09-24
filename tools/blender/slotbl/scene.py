"""bpy helpers shared by render_symbol / turntable / cleanup_mascot / build_actions / export_glb.

Look (docs/ART_BIBLE.md §3, src/mascots/toon.ts):
  * key light fixed in CAMERA space, top-left and slightly in front: the runtime's
    TOON.keyDir (-0.62, 0.72, 0.52) -> identical light direction for 2D, 3D and baked frames;
  * 3 hard bands from a CONSTANT ColorRamp driven by N.L:
      - EEVEE 'lit'   : Diffuse -> Shader to RGB -> ramp (reacts to real lights; EEVEE only)
      - 'emission'    : dot(Normal, key) -> ramp -> Emission (Cycles CPU and EEVEE; deterministic)
    Both map fac = 0.5 * N.L + 0.5, so the same thresholds give the same bands. EEVEE 'lit'
    clamps N.L at 0, so keep the mid threshold > 0 for engine parity;
  * inverted-hull outline: Solidify (offset +1, flipped normals, material offset) with a
    black material whose back faces are transparent (Cycles has no per-material culling);
  * view_transform 'Standard', film_transparent, dither 0, no metadata stamps.
"""
from __future__ import annotations

import math
import os
import subprocess
import sys
import tempfile
from pathlib import Path

import bpy
import bmesh
from mathutils import Matrix, Vector

from . import palette as pal

RUNTIME_KEY_CAM = Vector((-0.62, 0.72, 0.52)).normalized()   # src/mascots/toon.ts TOON.keyDir
ENGINE_ALIASES = {"CYCLES": "CYCLES", "BLENDER_EEVEE": "BLENDER_EEVEE", "EEVEE": "BLENDER_EEVEE",
                  "BLENDER_EEVEE_NEXT": "BLENDER_EEVEE"}

# docs/PIPELINE.md §4.4 + ANIMATION_CONTRACT §7: the one place the export settings live.
GLTF_EXPORT_SETTINGS = dict(
    export_format="GLB",
    export_animations=True,
    export_animation_mode="ACTIONS",
    export_force_sampling=True,
    export_morph=True,
    export_morph_normal=True,
    export_def_bones=True,
    export_apply=False,
    export_skins=True,
    export_influence_nb=4,
    export_yup=True,
    export_extras=False,
    export_reset_pose_bones=True,
    export_rest_position_armature=True,
    export_optimize_animation_size=True,
    export_image_format="AUTO",
    use_selection=False,
)


def blender_version() -> str:
    return bpy.app.version_string


# ------------------------------------------------------------------------ scene/render --
def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    return bpy.context.scene


def open_blend(path: str | os.PathLike):
    bpy.ops.wm.open_mainfile(filepath=str(path))
    return bpy.context.scene


def _disable_stamps(r) -> None:
    for attr in dir(r):
        if attr.startswith("use_stamp"):
            try:
                setattr(r, attr, False)
            except (AttributeError, TypeError):
                pass


def configure_render(scene, engine: str, res: int | tuple, samples: int, threads: int = 0,
                     transparent: bool = True, seed: int = 0, shadows: bool = False) -> str:
    engine = ENGINE_ALIASES.get(engine.upper(), engine)
    r = scene.render
    r.engine = engine
    w, h = (res, res) if isinstance(res, int) else res
    r.resolution_x, r.resolution_y = int(w), int(h)
    r.resolution_percentage = 100
    r.pixel_aspect_x = r.pixel_aspect_y = 1
    r.film_transparent = transparent
    r.dither_intensity = 0.0               # flat toon colours stay exact
    r.use_compositing = False
    r.use_sequencer = False
    im = r.image_settings
    im.file_format = "PNG"
    im.color_mode = "RGBA"
    im.color_depth = "8"
    im.compression = 15
    _disable_stamps(r)
    vs = scene.view_settings
    vs.view_transform = "Standard"         # AgX/Filmic desaturate flat toon colours
    vs.look = "None"
    vs.exposure = 0.0
    vs.gamma = 1.0
    if threads:
        r.threads_mode = "FIXED"
        r.threads = threads
    if engine == "CYCLES":
        c = scene.cycles
        c.device = "CPU"
        c.samples = samples
        c.use_adaptive_sampling = False
        c.use_denoising = False
        c.seed = seed
        c.use_animated_seed = False
        c.max_bounces = 2
        c.diffuse_bounces = c.glossy_bounces = c.transmission_bounces = c.volume_bounces = 0
        c.transparent_max_bounces = 16
        c.pixel_filter_type = "BLACKMAN_HARRIS"
        c.filter_width = 1.5
        r.use_persistent_data = True
    else:
        e = scene.eevee
        e.taa_render_samples = samples
        for attr, val in (("use_shadows", shadows), ("use_gtao", False), ("use_bloom", False),
                          ("use_ssr", False), ("use_raytracing", False), ("use_volumetric_shadows", False)):
            if hasattr(e, attr):
                try:
                    setattr(e, attr, val)
                except (AttributeError, TypeError):
                    pass
    return engine


def black_world(scene) -> None:
    w = bpy.data.worlds.new("toon_world")
    scene.world = w
    if w.node_tree is None:
        w.use_nodes = True
    bg = next((n for n in w.node_tree.nodes if n.type == "BACKGROUND"), None)
    if bg is None:
        bg = w.node_tree.nodes.new("ShaderNodeBackground")
        out = next((n for n in w.node_tree.nodes if n.type == "OUTPUT_WORLD"), None) \
            or w.node_tree.nodes.new("ShaderNodeOutputWorld")
        w.node_tree.links.new(bg.outputs[0], out.inputs[0])
    bg.inputs["Strength"].default_value = 0.0
    bg.inputs["Color"].default_value = (0, 0, 0, 1)


def render_still(scene, path: str | os.PathLike) -> Path:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
    if not path.exists():
        raise RuntimeError(f"render produced no file: {path}")
    return path


# ------------------------------------------------------------------------ materials ---
def new_node_material(name: str):
    m = bpy.data.materials.new(name)
    if m.node_tree is None:
        m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    return m, nt.nodes, nt.links


def _mix_rgb(N, L, blend: str, a, b, fac=1.0):
    mx = N.new("ShaderNodeMix")
    mx.data_type = "RGBA"
    mx.blend_type = blend
    if isinstance(fac, float):
        mx.inputs[0].default_value = fac
    else:
        L.new(fac, mx.inputs[0])
    for idx, v in ((6, a), (7, b)):
        if isinstance(v, (tuple, list)):
            mx.inputs[idx].default_value = (*v[:3], 1.0)
        else:
            L.new(v, mx.inputs[idx])
    return mx.outputs[2]


def toon_material(name: str, *, bands_lin, thresholds=(0.02, 0.35), key_world: Vector,
                  view_world: Vector | None = None, mode: str = "emission", albedo=None,
                  spec: float | None = None, uv_map: str | None = None):
    """Hard-banded toon material.

    bands_lin: (deep, mid, lit) linear RGB. With `albedo` (an image or linear RGB) the bands
    are grey multipliers applied to it (textured props / mascots).
    thresholds: N.L values where the mid and lit bands start.
    spec: threshold on N.S for the white specular streak (None/0 = off), where S is the key
          direction bent 25% toward the viewer: the streak sits on the parts that face the
          top-left key (rim bevels, facets), like the painted streak of the 2D art.
    """
    m, N, L = new_node_material(name)
    out = N.new("ShaderNodeOutputMaterial")
    if mode == "lit":
        dif = N.new("ShaderNodeBsdfDiffuse")
        dif.inputs["Color"].default_value = (1, 1, 1, 1)
        s2r = N.new("ShaderNodeShaderToRGB")
        L.new(dif.outputs[0], s2r.inputs[0])
        bw = N.new("ShaderNodeRGBToBW")
        L.new(s2r.outputs["Color"], bw.inputs[0])
        ndl = bw.outputs[0]
    else:
        geo = N.new("ShaderNodeNewGeometry")
        dot = N.new("ShaderNodeVectorMath")
        dot.operation = "DOT_PRODUCT"
        dot.inputs[1].default_value = tuple(key_world.normalized())
        L.new(geo.outputs["Normal"], dot.inputs[0])
        ndl = dot.outputs["Value"]
    fac = N.new("ShaderNodeMath")
    fac.operation = "MULTIPLY_ADD"
    fac.inputs[1].default_value = 0.5
    fac.inputs[2].default_value = 0.5
    L.new(ndl, fac.inputs[0])
    ramp = N.new("ShaderNodeValToRGB")
    ramp.color_ramp.interpolation = "CONSTANT"
    el = ramp.color_ramp.elements
    deep, mid, lit = bands_lin
    el[0].position, el[0].color = 0.0, (*deep, 1)
    el[1].position, el[1].color = (thresholds[0] + 1) / 2, (*mid, 1)
    e2 = el.new((thresholds[1] + 1) / 2)
    e2.color = (*lit, 1)
    L.new(fac.outputs[0], ramp.inputs["Fac"])
    col = ramp.outputs["Color"]
    if albedo is not None:
        if isinstance(albedo, bpy.types.Image):
            tex = N.new("ShaderNodeTexImage")
            tex.image = albedo
            tex.interpolation = "Linear"
            if uv_map:
                uvn = N.new("ShaderNodeUVMap")
                uvn.uv_map = uv_map
                L.new(uvn.outputs[0], tex.inputs["Vector"])
            alb = tex.outputs["Color"]
        else:
            alb = tuple(albedo)
        col = _mix_rgb(N, L, "MULTIPLY", alb, col)
    if spec:
        geo2 = N.new("ShaderNodeNewGeometry")
        h = (key_world.normalized() + 0.25 * (view_world or Vector((0, -1, 0))).normalized()).normalized()
        dh = N.new("ShaderNodeVectorMath")
        dh.operation = "DOT_PRODUCT"
        dh.inputs[1].default_value = tuple(h)
        L.new(geo2.outputs["Normal"], dh.inputs[0])
        gt = N.new("ShaderNodeMath")
        gt.operation = "GREATER_THAN"
        gt.inputs[1].default_value = spec
        L.new(dh.outputs["Value"], gt.inputs[0])
        col = _mix_rgb(N, L, "MIX", col, (1.0, 1.0, 1.0), gt.outputs[0])
    em = N.new("ShaderNodeEmission")
    em.inputs["Strength"].default_value = 1.0
    L.new(col, em.inputs["Color"])
    L.new(em.outputs[0], out.inputs["Surface"])
    return m


def bands_from_hex(base: str, shade: str | None = None) -> tuple:
    b = pal.derive_bands(base, shade)
    return tuple(pal.hex_to_linear(b[k]) for k in ("deep", "mid", "lit"))


def multiplier_bands(mults=pal.RUNTIME_MULTIPLIERS) -> tuple:
    # runtime multiplies sRGB values; in linear space that is ~k^2.2
    return tuple((pal.srgb_to_linear(k),) * 3 for k in mults)


def flat_material(name: str, hex_color: str):
    m, N, L = new_node_material(name)
    out = N.new("ShaderNodeOutputMaterial")
    em = N.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = (*pal.hex_to_linear(hex_color), 1)
    L.new(em.outputs[0], out.inputs["Surface"])
    return m


def outline_material(name: str = "ink_outline"):
    m, N, L = new_node_material(name)
    em = N.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = (0, 0, 0, 1)
    tr = N.new("ShaderNodeBsdfTransparent")
    geo = N.new("ShaderNodeNewGeometry")
    mx = N.new("ShaderNodeMixShader")
    L.new(geo.outputs["Backfacing"], mx.inputs["Fac"])
    L.new(em.outputs[0], mx.inputs[1])
    L.new(tr.outputs[0], mx.inputs[2])
    out = N.new("ShaderNodeOutputMaterial")
    L.new(mx.outputs[0], out.inputs["Surface"])
    m.use_backface_culling = True     # EEVEE; Cycles uses the Backfacing -> Transparent branch
    return m


def add_hull(obj, thickness_world: float, outline_mat, name: str = "outline_hull", even: bool = False):
    """Inverted-hull outline. Appends the outline material once per existing slot so the
    shell of every source material maps to it (material_offset = slot count)."""
    n = max(1, len(obj.data.materials))
    if len(obj.data.materials) == 0:
        obj.data.materials.append(outline_mat)
    for _ in range(n):
        obj.data.materials.append(outline_mat)
    s = obj.matrix_world.to_scale()
    scale = (abs(s.x) + abs(s.y) + abs(s.z)) / 3 or 1.0
    mod = obj.modifiers.new(name, "SOLIDIFY")
    mod.thickness = thickness_world / scale
    mod.offset = 1.0
    mod.use_flip_normals = True
    mod.use_rim = False
    # even offset keeps the width at sharp convex corners (gem facets) but spikes at concave
    # ones (letters, star emblems): only enable it for convex subjects.
    mod.use_even_offset = even
    mod.use_quality_normals = True
    mod.material_offset = n
    if obj.vertex_groups.get("hull_weight") is not None:
        mod.vertex_group = "hull_weight"
        mod.thickness_vertex_group = obj.get("counter_outline", 0.4)
    return mod


def set_hull_visible(objs, visible: bool, name: str = "outline_hull") -> None:
    for o in objs:
        mod = o.modifiers.get(name)
        if mod:
            mod.show_render = visible
            mod.show_viewport = visible


# -------------------------------------------------------------------- camera / light ---
def ortho_camera(scene, azim_deg: float, elev_deg: float, target: Vector, ortho_scale: float,
                 distance: float = 20.0):
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    scene.collection.objects.link(cam)
    scene.camera = cam
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = ortho_scale
    cam.data.clip_start = 0.01
    cam.data.clip_end = distance * 4
    a, e = math.radians(azim_deg), math.radians(elev_deg)
    d = Vector((math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e)))
    cam.location = target + d * distance
    cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
    bpy.context.view_layer.update()
    return cam


def camera_axes(cam):
    r = cam.matrix_world.to_3x3().normalized()
    return r @ Vector((1, 0, 0)), r @ Vector((0, 1, 0)), r @ Vector((0, 0, 1))  # right, up, toward viewer


def key_vectors(cam):
    r = cam.matrix_world.to_3x3().normalized()
    return (r @ RUNTIME_KEY_CAM).normalized(), (r @ Vector((0, 0, 1))).normalized()


def add_key_sun(scene, key_world: Vector, strength: float = math.pi, shadows: bool = False):
    """Sun whose light travels along -key_world; strength pi makes Diffuse+ShaderToRGB = N.L."""
    lamp = bpy.data.lights.new("key", "SUN")
    lamp.energy = strength
    lamp.angle = 0.0
    lamp.use_shadow = shadows
    ob = bpy.data.objects.new("key", lamp)
    scene.collection.objects.link(ob)
    ob.rotation_euler = key_world.to_track_quat("Z", "Y").to_euler()
    return ob


def camera_space_points(cam, points):
    inv = cam.matrix_world.inverted()
    return [inv @ p for p in points]


def world_points(objs, evaluated: bool = False):
    pts = []
    dg = bpy.context.evaluated_depsgraph_get() if evaluated else None
    for o in objs:
        if o.type != "MESH":
            continue
        if evaluated:
            eo = o.evaluated_get(dg)
            me = eo.to_mesh()
            pts += [eo.matrix_world @ v.co for v in me.vertices]
            eo.to_mesh_clear()
        else:
            pts += [o.matrix_world @ v.co for v in o.data.vertices]
    return pts


def project_px(scene, cam, co: Vector):
    from bpy_extras.object_utils import world_to_camera_view
    v = world_to_camera_view(scene, cam, co)
    return v.x * scene.render.resolution_x, (1 - v.y) * scene.render.resolution_y


# ------------------------------------------------------------------------ mesh ops ---
def weld_and_clean(obj, weld_dist: float, sharp_angle_deg: float | None = 35.0) -> tuple[int, int]:
    """Merge split vertices (GLBs are split at UV seams), clear custom normals, smooth by angle."""
    me = obj.data
    bm = bmesh.new()
    bm.from_mesh(me)
    before = len(bm.verts)
    if weld_dist > 0:
        bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=weld_dist)
    after = len(bm.verts)
    bm.to_mesh(me)
    bm.free()
    if getattr(me, "has_custom_normals", False):
        try:
            with bpy.context.temp_override(object=obj, active_object=obj, selected_objects=[obj],
                                           selected_editable_objects=[obj]):
                bpy.ops.mesh.customdata_custom_splitnormals_clear()
        except Exception:  # noqa: BLE001
            pass
    for nm in ("custom_normal",):
        if nm in me.attributes:
            me.attributes.remove(me.attributes[nm])
    if sharp_angle_deg is not None:
        me.shade_smooth()
        me.set_sharp_from_angle(angle=math.radians(sharp_angle_deg))
    me.update()
    return before, after


def bake_transform(obj) -> None:
    """Apply the object's world matrix to its mesh data and clear parent/transform."""
    mw = obj.matrix_world.copy()
    obj.parent = None
    obj.data.transform(mw)
    obj.matrix_world = Matrix.Identity(4)


def normalize_mesh(obj, height: float = 1.0) -> dict:
    """Mesh-level: origin at bottom-centre (x/y centre of bbox, min z), scaled to `height`."""
    bake_transform(obj)
    vs = [v.co for v in obj.data.vertices]
    mn = Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs)))
    mx = Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))
    size = mx - mn
    s = height / size.z if size.z > 1e-9 else 1.0
    obj.data.transform(Matrix.Translation(-Vector(((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, mn.z))))
    obj.data.transform(Matrix.Scale(s, 4))
    obj.data.update()
    return {"scale": s, "size": tuple(size * s)}


def triangle_count(obj, evaluated: bool = True) -> int:
    if evaluated:
        dg = bpy.context.evaluated_depsgraph_get()
        eo = obj.evaluated_get(dg)
        me = eo.to_mesh()
        n = sum(len(p.vertices) - 2 for p in me.polygons)
        eo.to_mesh_clear()
        return n
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


# ------------------------------------------------------------------------ import/export -
def import_model(path: str | os.PathLike) -> list:
    path = Path(path)
    before = set(bpy.data.objects)
    ext = path.suffix.lower()
    if ext in (".glb", ".gltf"):
        bpy.ops.import_scene.gltf(filepath=str(path))
    elif ext == ".obj":
        bpy.ops.wm.obj_import(filepath=str(path))
    elif ext == ".fbx":
        bpy.ops.import_scene.fbx(filepath=str(path))
    else:
        raise ValueError(f"unsupported model format: {path}")
    return [o for o in bpy.data.objects if o not in before]


def join_meshes(meshes):
    meshes = [m for m in meshes if m.type == "MESH"]
    if not meshes:
        raise ValueError("no mesh objects to join")
    active = meshes[0]
    if len(meshes) > 1:
        with bpy.context.temp_override(active_object=active, object=active, selected_objects=meshes,
                                       selected_editable_objects=meshes):
            bpy.ops.object.join()
    return active


def export_glb(path: str | os.PathLike, **overrides) -> Path:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    settings = dict(GLTF_EXPORT_SETTINGS)
    settings.update(overrides)
    bpy.ops.export_scene.gltf(filepath=str(path), **settings)
    if not path.exists():
        raise RuntimeError(f"glTF export wrote nothing: {path}")
    return path


# ------------------------------------------------------------------------------ fonts --
def _font_makes_geometry(font) -> bool:
    cu = bpy.data.curves.new("_fontprobe", "FONT")
    cu.body = "A"
    cu.font = font
    ob = bpy.data.objects.new("_fontprobe", cu)
    bpy.context.scene.collection.objects.link(ob)
    try:
        dg = bpy.context.evaluated_depsgraph_get()
        me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
        ok = len(me.vertices) > 0
        bpy.data.meshes.remove(me)
    finally:
        bpy.data.objects.remove(ob)
        bpy.data.curves.remove(cu)
    return ok


def convert_font_to_ttf(src: Path) -> Path:
    """woff/woff2 -> TTF in a temp dir via fontTools (in-process, or a helper python)."""
    dst = Path(tempfile.mkdtemp(prefix="slotfont_")) / (src.stem + ".ttf")
    code = ("import sys;from fontTools.ttLib import TTFont;"
            "f=TTFont(sys.argv[1]);f.flavor=None;f.save(sys.argv[2])")
    try:
        from fontTools.ttLib import TTFont  # type: ignore
        f = TTFont(str(src))
        f.flavor = None
        f.save(str(dst))
        return dst
    except ImportError:
        pass
    for py in filter(None, (os.environ.get("SLOT_PYTHON"), "python3")):
        try:
            subprocess.run([py, "-c", code, str(src), str(dst)], check=True, capture_output=True)
            return dst
        except (OSError, subprocess.CalledProcessError):
            continue
    raise RuntimeError(f"cannot read {src.name}: Blender rejected it and fontTools is unavailable "
                       "(pip install fonttools brotli)")


def load_font(path: str | os.PathLike):
    """Load a font into Blender; falls back to a fontTools TTF conversion. -> (font, ttf|None)"""
    path = Path(path)
    try:
        f = bpy.data.fonts.load(str(path), check_existing=True)
        if _font_makes_geometry(f):
            return f, None
    except RuntimeError:
        pass
    ttf = convert_font_to_ttf(path)
    return bpy.data.fonts.load(str(ttf), check_existing=True), ttf


def text_mesh(text: str, font, extrude: float, bevel: float, bevel_res: int = 2, resolution_u: int = 12):
    """Text -> mesh (standing up, face toward -Y, glyph-height ~1 before normalisation)."""
    cu = bpy.data.curves.new("glyph", "FONT")
    cu.body = text
    cu.font = font
    cu.size = 1.0
    cu.align_x = "CENTER"
    cu.align_y = "BOTTOM_BASELINE"
    cu.extrude = extrude
    cu.bevel_depth = bevel
    cu.bevel_resolution = bevel_res
    cu.resolution_u = resolution_u
    tmp = bpy.data.objects.new("glyph_tmp", cu)
    bpy.context.scene.collection.objects.link(tmp)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(tmp.evaluated_get(dg))
    bpy.data.objects.remove(tmp)
    bpy.data.curves.remove(cu)
    me.transform(Matrix.Rotation(math.radians(90), 4, "X"))   # +Z face -> -Y (toward camera)
    me.update()
    return me


def glyph_holes(text: str, font, resolution: int = 12):
    """Inner contours (counters) of a text string as 2D polygons in text-plane units, found from
    the font's bezier splines by nesting depth (odd = hole). Text plane (x, y) == mesh (X, Z)
    after text_mesh()'s stand-up rotation."""
    from mathutils.geometry import interpolate_bezier
    cu = bpy.data.curves.new("_holes", "FONT")
    cu.body = text
    cu.font = font
    cu.size = 1.0
    cu.align_x = "CENTER"
    cu.align_y = "BOTTOM_BASELINE"
    ob = bpy.data.objects.new("_holes", cu)
    bpy.context.scene.collection.objects.link(ob)
    polys = []
    try:
        dg = bpy.context.evaluated_depsgraph_get()
        c = ob.evaluated_get(dg).to_curve(dg, apply_modifiers=False)
        for sp in c.splines:
            bps = sp.bezier_points
            pts = []
            for i in range(len(bps)):
                a, b = bps[i], bps[(i + 1) % len(bps)]
                seg = interpolate_bezier(a.co, a.handle_right, b.handle_left, b.co, resolution + 1)
                pts += [(p.x, p.y) for p in seg[:-1]]
            if len(pts) >= 3:
                polys.append(pts)
    finally:
        bpy.data.objects.remove(ob)
        bpy.data.curves.remove(cu)
    return [p for i, p in enumerate(polys)
            if sum(point_in_poly(p[0], q) for j, q in enumerate(polys) if j != i) % 2 == 1]


def point_in_poly(pt, poly) -> bool:
    x, y = pt
    inside = False
    j = len(poly) - 1
    for i in range(len(poly)):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / ((yj - yi) or 1e-12) + xi:
            inside = not inside
        j = i
    return inside


def dist_to_poly(pt, poly) -> float:
    px, py = pt
    best = float("inf")
    for i in range(len(poly)):
        ax, ay = poly[i]
        bx, by = poly[(i + 1) % len(poly)]
        dx, dy = bx - ax, by - ay
        L2 = dx * dx + dy * dy or 1e-12
        t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / L2))
        cx, cy = ax + t * dx, ay + t * dy
        best = min(best, math.hypot(px - cx, py - cy))
    return best


def weight_counter_vertices(obj, holes, margin: float, group: str = "hull_weight") -> int:
    """Vertex group for the outline hull: 1 everywhere, 0 on counter walls/rims, so Solidify's
    thickness_vertex_group can thin the hull inside counters (no 'dark sliver' in A/Q/0)."""
    vg = obj.vertex_groups.get(group) or obj.vertex_groups.new(name=group)
    ones, zeros = [], []
    for v in obj.data.vertices:
        p = (v.co.x, v.co.z)
        inner = any(point_in_poly(p, h) or dist_to_poly(p, h) <= margin for h in holes)
        (zeros if inner else ones).append(v.index)
    if ones:
        vg.add(ones, 1.0, "REPLACE")
    if zeros:
        vg.add(zeros, 0.0, "REPLACE")
    return len(zeros)


def link_new_object(name: str, data, scene=None):
    ob = bpy.data.objects.new(name, data)
    (scene or bpy.context.scene).collection.objects.link(ob)
    return ob


def python_for_post() -> str:
    """Interpreter for pure-Python post steps when running inside the Blender binary."""
    return os.environ.get("SLOT_PYTHON") or ("python3" if "blender" in Path(sys.executable).name.lower()
                                               or not _has_pil() else sys.executable)


def _has_pil() -> bool:
    try:
        import PIL  # noqa: F401
        import numpy  # noqa: F401
        return True
    except ImportError:
        return False
