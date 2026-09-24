#!/usr/bin/env python3
"""Generate a real Rigify rig (basic human metarig -> rigify_generate) with a skinned block, as a
.blend for export_glb.py --rigify-names tests. Needs bpy with the bundled Rigify add-on.

    python tools/blender/tests/make_rigify_fixture.py --out art/_work/fixtures/rigify_rig.blend

A generated Rigify rig has CONTROL bones named hips/chest/neck/head/torso next to DEF-spine.*,
so a naive DEF-* -> runtime-name rename collides and Blender appends '.001'. Nothing here ships.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from slotbl import cli  # noqa: E402


def main(argv):
    ap = argparse.ArgumentParser(prog="make_rigify_fixture.py", description=__doc__.split("\n\n")[0])
    ap.add_argument("--out", required=True, help="output .blend")
    args = ap.parse_args(argv)
    import bpy                      # first: it puts Blender's scripts (addon_utils) on sys.path
    import addon_utils
    from slotbl import scene as S
    S.reset_scene()
    addon_utils.enable("rigify", default_set=True)
    if not hasattr(bpy.ops.pose, "rigify_generate"):
        raise cli.ToolError("the Rigify add-on is not available in this Blender/bpy")
    bpy.ops.object.armature_human_metarig_add()
    meta = bpy.context.active_object
    bpy.ops.pose.rigify_generate()
    rig = next(o for o in bpy.data.objects if o.type == "ARMATURE" and o != meta)
    bpy.data.objects.remove(meta)
    bpy.ops.mesh.primitive_cube_add(size=0.3, location=(0, 0, 1.0))
    block = bpy.context.active_object
    block.name = "body"
    for b in rig.data.bones:
        if b.use_deform:
            block.vertex_groups.new(name=b.name)
    block.vertex_groups["DEF-spine"].add(list(range(len(block.data.vertices))), 1.0, "REPLACE")
    mod = block.modifiers.new("Armature", "ARMATURE")
    mod.object = rig
    block.parent = rig
    names = {b.name for b in rig.data.bones}
    clash = sorted(names & {"hips", "chest", "neck", "head", "torso"})
    out = cli.out_path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(out), compress=False)
    print(f"[make_rigify_fixture] {rig.name}: {len(names)} bones, "
          f"{sum(b.use_deform for b in rig.data.bones)} deform, control-bone name clashes {clash} -> {cli.rel(out)}")
    return 0


if __name__ == "__main__":
    cli.run(main)
