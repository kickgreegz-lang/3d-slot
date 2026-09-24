#!/usr/bin/env python3
"""Simulate `blender -b --factory-startup --python-exit-code 1 -P <script> -- <args>` with the
bpy module: Blender-style sys.argv, __file__/__name__ as Blender sets them, and Pillow hidden
(Blender's bundled Python ships numpy but not Pillow), so the scripts' subprocess fallbacks
(frames_post.py / sheet_post.py via SLOT_PYTHON) are exercised.

    $BPY_PYTHON tools/blender/tests/sim_blender.py tools/blender/render_symbol.py -- --glyph K --clip static
"""
import runpy
import sys

if len(sys.argv) < 2 or sys.argv[1] in ("-h", "--help"):
    print(__doc__)
    sys.exit(0)
script = sys.argv[1]
rest = sys.argv[2:]
sys.argv = ["blender", "-b", "--factory-startup", "--python-exit-code", "1", "-P", script] + rest
sys.modules["PIL"] = None          # `import PIL` now raises ImportError, like Blender's Python
runpy.run_path(script, run_name="__main__")
