"""Shared helpers for the headless Blender pipeline in tools/blender/.

Modules that never import bpy (safe for plain Python / CI):
    cli         argv handling for `blender -b -P x.py -- args` and `python x.py args`, exit codes
    provenance  sha256, manifest rows (art/manifest.schema.json), sidecar writing
    palette     sRGB/linear, art-bible lookups, toon band colours, deterministic k-means
    easing      named easing presets -> Blender keyframe interpolation/easing
    imgtools    PIL/numpy frame post-processing and QA metrics (outline, seam, bounds, holes)
    animspec    Claude-written animation JSON: validation and normalisation (no bpy)

Module that needs bpy:
    scene       scene reset, render settings, toon + outline materials, camera/key light,
                mesh cleanup, glTF import/export with the settings from docs/PIPELINE.md
"""
