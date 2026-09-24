#!/usr/bin/env python3
"""Export a mascot rig to GLB with the pipeline's fixed glTF settings (docs/PIPELINE.md §4.4):

    export_animation_mode='ACTIONS', export_morph=True, export_def_bones=True (deform bones only),
    export_apply=False, export_skins=True, export_influence_nb=4, force sampling (30 fps scene).

    blender -b art/source/3d/mascot_gumbo/mascot_gumbo.blend --python-exit-code 1 \\
        -P tools/blender/export_glb.py -- --out art/_work/mascots/gumbo/raw.glb --rigify-names
    python tools/blender/export_glb.py --blend rig.blend --out raw.glb --actions idle,celebrate

Rigify DEF-* bones are renamed on export (--rigify-names) so the runtime's procedural layer finds
hips/spine/chest/neck/head (ANIMATION_CONTRACT §7.5); the .blend is never modified.
Then run tools/gltf/optimize.sh on the result (meshopt + WebP + budget gates).
"""
from __future__ import annotations

import argparse
import json
import re
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from slotbl import cli  # noqa: E402

# Rigify basic spine chain -> runtime names (src/mascots/procedural.ts regexes)
RIGIFY_SPINE = {
    "DEF-spine": "hips", "DEF-spine.001": "spine", "DEF-spine.002": "chest", "DEF-spine.003": "upper_chest",
    "DEF-spine.004": "neck", "DEF-spine.005": "neck_01", "DEF-spine.006": "head",
}


def build_parser():
    ap = argparse.ArgumentParser(prog="export_glb.py", description=__doc__.split("\n\n")[0],
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    src = ap.add_mutually_exclusive_group()
    src.add_argument("--blend", help=".blend to open (default: the file Blender was started with)")
    src.add_argument("--glb", help="GLB/GLTF to import and re-export (normalises settings)")
    ap.add_argument("--out", required=True, help="output .glb")
    ap.add_argument("--armature", help="armature to rename bones on (default: the only one)")
    ap.add_argument("--actions", help="comma list of actions to keep (default: all)")
    ap.add_argument("--rename-map", help="JSON file or inline JSON {old_bone: new_bone}")
    ap.add_argument("--rigify-names", action="store_true", help="DEF-spine.* -> hips/spine/chest/neck/head, "
                                                                "DEF-x.L -> x_L")
    ap.add_argument("--all-bones", action="store_true", help="export non-deform bones too (export_def_bones=False)")
    ap.add_argument("--image-format", default="AUTO", choices=("AUTO", "WEBP", "JPEG", "NONE"),
                    help="texture format in the GLB (optimize.sh re-encodes to WebP anyway)")
    ap.add_argument("--fps", type=int, default=30, help="scene fps used to sample actions (contract: 30)")
    ap.add_argument("--manifest", help="also append the row to this manifest")
    return ap


def load_rename_map(arg):
    if not arg:
        return None
    p = Path(arg)
    text = p.read_text() if p.exists() else arg
    m = json.loads(text)
    if not isinstance(m, dict):
        raise cli.ToolError("--rename-map must be a JSON object {old: new}")
    return m


def rigify_map(arm) -> dict:
    out = {}
    for b in arm.data.bones:
        n = b.name
        if n in RIGIFY_SPINE:
            out[n] = RIGIFY_SPINE[n]
        elif n.startswith("DEF-"):
            core = n[4:]
            core = re.sub(r"\.(L|R)(\.|$)", r"_\1\2", core)
            core = re.sub(r"\.(\d+)$", r"_\1", core).replace(".", "_")
            out[n] = core
    return out


def glb_json(path) -> dict:
    data = Path(path).read_bytes()
    if data[:4] != b"glTF":
        raise cli.ToolError(f"{path} is not a GLB")
    n = struct.unpack_from("<I", data, 12)[0]
    return json.loads(data[20:20 + n])


def glb_summary(path) -> dict:
    j = glb_json(path)
    nodes = j.get("nodes", [])
    morphs = {}
    for m in j.get("meshes", []):
        names = (m.get("extras") or {}).get("targetNames")
        if names:
            morphs[m.get("name", "?")] = names
    return {
        "path": cli.rel(path), "bytes": Path(path).stat().st_size,
        "animations": [a.get("name") for a in j.get("animations", [])],
        "joints": [len(s.get("joints", [])) for s in j.get("skins", [])],
        "jointNames": [nodes[i].get("name") for s in j.get("skins", [])[:1] for i in s.get("joints", [])],
        "morphs": morphs, "meshes": len(j.get("meshes", [])), "materials": len(j.get("materials", [])),
        "images": len(j.get("images", [])),
    }


def export(out: Path, arm=None, keep_actions=None, rename_map=None, rigify=False, log=None,
           def_bones=True, image_format="AUTO") -> dict:
    """Export the current scene. Mutates the in-memory scene (drops actions, renames bones):
    save the .blend BEFORE calling this."""
    import bpy
    from slotbl import scene as S
    log = log or cli.Log("export_glb")
    if keep_actions:
        missing = [a for a in keep_actions if a not in bpy.data.actions]
        if missing:
            raise cli.ToolError(f"--actions: not found {missing} (have {[a.name for a in bpy.data.actions]})")
        idbs = [o for o in bpy.data.objects] + [k for k in bpy.data.shape_keys]
        for a in list(bpy.data.actions):
            if a.name in keep_actions:
                continue
            for idb in idbs:
                ad = getattr(idb, "animation_data", None)
                if not ad:
                    continue
                for t in list(ad.nla_tracks):
                    if any(s.action == a for s in t.strips):
                        ad.nla_tracks.remove(t)
                if ad.action == a:
                    ad.action = None
            bpy.data.actions.remove(a)
    renames = {}
    if arm is not None and rigify:
        renames.update(rigify_map(arm))
    if rename_map:
        renames.update(rename_map)
    if renames:
        if arm is None:
            raise cli.ToolError("bone renames need an armature")
        missing = [k for k in renames if k not in arm.data.bones]
        if missing and rename_map and any(k in rename_map for k in missing):
            log.warn(f"rename map: bones not found {missing}")
        for old, new in renames.items():
            b = arm.data.bones.get(old)
            if b is not None:
                b.name = new
        log(f"renamed {sum(1 for k in renames if k not in missing)} bone(s) for export")
    S.export_glb(out, export_def_bones=def_bones, export_image_format=image_format)
    info = glb_summary(out)
    log(f"GLB {info['path']}: {info['bytes']} bytes, animations {info['animations']}, joints {info['joints']}, "
        f"morphs {info['morphs']}")
    return info


def main(argv):
    args = build_parser().parse_args(argv)
    log = cli.Log("export_glb")
    import bpy
    from slotbl import provenance as prov
    from slotbl import scene as S
    if args.glb:
        S.reset_scene()
        src = cli.repo_path(args.glb)
        S.import_model(src)
    elif args.blend:
        src = cli.repo_path(args.blend)
        S.open_blend(src)
    elif bpy.data.filepath:
        src = Path(bpy.data.filepath)
    else:
        raise cli.ToolError("pass --blend or --glb (or start Blender with a .blend)")
    bpy.context.scene.render.fps = args.fps
    bpy.context.scene.render.fps_base = 1.0
    arms = [o for o in bpy.data.objects if o.type == "ARMATURE"]
    arm = bpy.data.objects.get(args.armature) if args.armature else (arms[0] if len(arms) == 1 else None)
    keep = [a.strip() for a in args.actions.split(",")] if args.actions else None
    out = cli.out_path(args.out)
    info = export(out, arm=arm, keep_actions=keep, rename_map=load_rename_map(args.rename_map),
                  rigify=args.rigify_names, log=log, def_bones=not args.all_bones, image_format=args.image_format)
    digest = prov.sha256_file(out)
    row = prov.make_row(id=prov.row_id("glb", out.stem, digest), path=out, stage="3d-export", sha256=digest,
                        model=f"blender-{S.blender_version().split()[0]}",
                        version=f"bpy {S.blender_version()}; tools/blender@{prov.toolkit_version()}",
                        ref_hashes=[prov.sha256_file(src)], notes=f"export of {cli.rel(src)}; {info['animations']}")
    side = out.with_suffix(".manifest.json")
    prov.write_sidecar(side, [row], "tools/blender/export_glb.py")
    if args.manifest:
        prov.append_to_manifest(cli.repo_path(args.manifest), [row], "tools/blender/export_glb.py")
    out.with_suffix(".export.json").write_text(json.dumps(info, indent=2) + "\n")
    log(f"row {row['id']} -> {cli.rel(side)}")
    return 0


if __name__ == "__main__":
    cli.run(main)
