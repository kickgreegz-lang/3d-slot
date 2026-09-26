#!/usr/bin/env python3
"""Bass Drop production visual set (Phase C): the machine-readable generation plan.

Builds art/plan/bass-drop.json from the rows below plus art/bible/artbible.json -> bassDrop. Every row names a
template (art/bible/prompts), its values, the Higgsfield MCP request (model, resolution, aspect, candidates,
references), credits, outputs, the downstream steps and the review gates. Prompts are rendered by
tools/gen/genlib.py, the same renderer every generation tool uses, so a row's promptHash is the hash a real
generation records. The finish follows docs/games/bass-drop/STYLE_DECISION.md: formula D for the foreground and
the painted-environment formula for backgrounds, passed as --var STYLE_FORMULA=... from artbible.bassDrop.
The human plan is docs/games/bass-drop/ART_PLAN.md.

  python3 art/plan/build_plan.py                  # rewrite art/plan/bass-drop.json
  python3 art/plan/build_plan.py --check          # exit 1 when bass-drop.json or the ART_PLAN.md table is stale
  python3 art/plan/build_plan.py summary          # budget per priority and per batch
  python3 art/plan/build_plan.py table --doc      # refresh the asset table inside ART_PLAN.md (--check verifies it)
  python3 art/plan/build_plan.py spec --batch c01 # 'pnpm gen:hf-ingest plan --spec' input for one batch;
                                                  # every reference must be approved in art/plan/approvals.json

Script-free route: each planned row's 'render' field is the exact tools/gen/genlib.py command that prints its
prompt. Nothing here calls a vendor or spends credits. Stdlib only.
"""
from __future__ import annotations

import argparse
import json
import shlex
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
sys.path.insert(0, str(REPO / "tools" / "gen"))
import genlib  # noqa: E402

PLAN_PATH = HERE / "bass-drop.json"
APPROVALS_PATH = HERE / "approvals.json"
LEDGER_PATH = REPO / "art" / "ledger" / "higgsfield-jobs.json"
LEDGER_PROMPTS = REPO / "art" / "ledger" / "prompts"
DOC_PATH = REPO / "docs" / "games" / "bass-drop" / "ART_PLAN.md"

UPDATED = "2026-09-26"
BALANCE = 249.75          # Higgsfield balance() on 2026-09-26 after probe1, ab1 and ab2 (Plus plan)
RETRY = 1.5               # P0/P1 retry allowance on top of the planned candidates
P0_CAP = 150              # P0 incl. retries and reserves must fit here
ROUTE = "higgsfield-mcp"
# MCP ids -> credits per image (measured 2026-09-26) and the id the finished job reports (manifest 'model').
MODELS = {
    "nano_banana_pro": {"credits": {"2k": 2, "4k": 4}, "reports": "nano_banana_2",
                        "upstream": "Google Nano Banana Pro (gemini-3-pro-image)"},
    "nano_banana_2": {"credits": {"1k": 1.5, "2k": 2}, "reports": None,
                      "upstream": "Google Nano Banana 2 (gemini-3.1-flash-image)"},
}
PRIORITIES = ("P0", "P1", "P2")
PHASES = ["anchors", "symbols", "wild", "stage", "emblems", "backgrounds", "mascots"]

BIBLE = genlib.bible()
BD = BIBLE["bassDrop"]
FORMULA_D = BD["styleFormula"]
FORMULA_ENV = BD["environmentFormula"]
BANNED = tuple(w.lower() for w in BD["bannedPromptWords"]["words"])

GATES = {
    "symbol": ["keyUniform", "readability64", "silhouetteConfusion", "paletteDeltaE", "outlineHistogram", "styleSimilarity",
               "halo", "noText", "canvasAndPivot", "lightDirection"],
    "parts": ["keyUniform", "spineSplit", "paletteDeltaE", "halo", "noText"],
    "prop": ["keyUniform", "paletteDeltaE", "outlineHistogram", "styleSimilarity", "halo", "noText", "lightDirection"],
    "emblem": ["keyUniform", "readability64", "paletteDeltaE", "outlineHistogram", "styleSimilarity", "halo", "noText",
               "lightDirection"],
    "card": ["noText", "paletteDeltaE", "styleSimilarity", "lightDirection"],
    "background": ["noText", "paletteDeltaE", "styleSimilarity", "darkerCentre"],
    "variant": ["noText", "paletteDeltaE", "darkerCentre", "layoutMatch"],
    "neon": ["noText", "layoutMatch"],
    "mascot": ["keyUniform", "adultProportions", "styleSimilarity", "paletteDeltaE", "outlineHistogram", "halo", "noText",
               "lightDirection"],
    "mascotParts": ["keyUniform", "spineSplit", "adultProportions", "styleSimilarity", "paletteDeltaE", "halo", "noText"],
}

M = "GAME=bass-drop python3 tools/matte/outline_matte.py"
KEY_NOTE = "--key auto measures the real background (border median): check it is uniform and near {HEX}, else regenerate (STYLE_DECISION.md)"


def bd(path: str):
    """Value at artbible.bassDrop.<path> and its bible path (for 'varsFrom')."""
    cur = BD
    for k in path.split("."):
        cur = cur[k]
    return cur, "bassDrop." + path


def ledger_jobs() -> dict:
    """Ledger jobs by 'batch/name' (+ 'batch' key on each job)."""
    doc = json.loads(LEDGER_PATH.read_text(encoding="utf-8"))
    return {f"{b['id']}/{j['name']}": {**j, "batch": b["id"]} for b in doc["batches"] for j in b["jobs"]}


# --------------------------------------------------------------------------- rows

ROWS: list[dict] = []


def row(rid, *, phase, priority, batch, kind, template, what, rig=None, atlas=None, symbol=None, mascot=None,
        rig_ready=False, vars=None, model="nano_banana_pro", resolution="2k", aspect="1:1", candidates=1, refs=(),
        source=(), downstream=(), gates=None, fallback=None, notes=None, stage="2d-image", anchor=None):
    ROWS.append(dict(id=rid, phase=phase, priority=priority, batch=batch, kind=kind, template=template, what=what,
                     rig=rig, atlas=atlas, symbol=symbol, mascot=mascot, rig_ready=rig_ready, vars=dict(vars or {}),
                     model=model, resolution=resolution, aspect=aspect, candidates=candidates, refs=list(refs),
                     source=list(source), downstream=list(downstream), gates=gates or GATES[kind], fallback=fallback,
                     notes=notes, stage=stage, anchor=anchor))


def v(**pairs):
    """--var values: NAME=(value, bible path) or NAME=value (literal)."""
    return {k: (x if isinstance(x, tuple) else (x, None)) for k, x in pairs.items()}


def join(path, sep, key=None):
    val, src = bd(path)
    return (sep.join(p[key] if key else p for p in val), src)


FD = (FORMULA_D, "bassDrop.styleFormula")
FENV = (FORMULA_ENV, "bassDrop.environmentFormula")


def label(sid):
    return BIBLE["symbols"][sid]["label"]


def key_of(sid):
    return BIBLE["symbols"][sid]["keyHex"]


# ---- phase 0: style anchors = the images adopted in STYLE_DECISION.md (ab1, ab2), 0 new credits
BEAUTY_DOWN = [
    f'{M} <raw> "build/pack/symbols{{tps}}/sym_{{ID}}.png" --symbol {{ID}} --key auto '
    "--emit-master art/source/symbols/{ID}/master_2048.png --parent-id <raw row id> --manifest art/manifest.json",
    'GAME=bass-drop python3 tools/matte/variants.py "build/pack/symbols{tps}/sym_{ID}.png" --symbol {ID} --manifest art/manifest.json',
    KEY_NOTE,
]
for sid, job in (("H1", "ab2/D_H1"), ("H3", "ab2/D_H3"), ("W", "ab2/D_W")):
    row(f"sym_{sid}", phase="anchors", priority="P0", batch="anchors", kind="symbol", template="symbol.txt",
        what=f"{label(sid)} beauty master, formula D (adopted {job}); style anchor", rig=f"sym_{sid}", atlas="symbols",
        symbol=sid, vars=v(SUBJECT=bd(f"symbols.{sid}.subject"), STYLE_FORMULA=FD, LIGHT_NOTE=""), anchor=job,
        source=[f"art/source/symbols/{sid}/master_2048.png", f"build/pack/symbols{{tps}}/sym_{sid}{{,_blur,_glow}}.png"],
        downstream=[s.replace("{ID}", sid).replace("{HEX}", key_of(sid)) for s in BEAUTY_DOWN],
        fallback="Regenerate once from this row (anchor redo reserve).",
        notes="Rendered without the restAngle light note, exactly as the adopted job was; new rows keep the bible note.")
row("mascot_gumbo_sheet", phase="anchors", priority="P0", batch="anchors", kind="mascot", template=None,
    what="Gumbo design model sheet, formula D (adopted ab2/D_gumbo); identity reference", rig="chr_gumbo", atlas="bd_chr_gumbo",
    resolution="4k", aspect="21:9", anchor="ab2/D_gumbo", stage="mascot-sheets",
    source=["art/source/mascots/gumbo/sheets/design_sheet.png"],
    downstream=[f"{M} <raw> art/source/mascots/gumbo/sheets/design_sheet.png --key auto --no-fit",
                "Human approval of identity and adult proportions (ART_BIBLE §7)"],
    fallback="Regenerate once (anchor redo reserve); the mascots phase waits for this approval.")
row("mascot_croak_sheet_v2", phase="anchors", priority="P0", batch="anchors", kind="mascot", template=None,
    what="Baron Croak design sheet v2 (adopted brief, ab1/ab_croak_v2, formula B finish); identity reference for the D sheet",
    rig="chr_croak", atlas="bd_chr_croak", resolution="4k", aspect="21:9", anchor="ab1/ab_croak_v2", stage="mascot-sheets",
    source=["art/_raw only (superseded by mascot_croak_sheet once approved)"],
    downstream=["Reference only: its design (not its formula-B finish) feeds mascot_croak_sheet"],
    fallback="Re-run the v2 brief directly in formula D (mascot_croak_sheet without this reference).")
row("bg_base_landscape", phase="anchors", priority="P0", batch="anchors", kind="background", template=None,
    what="Base background plate, landscape, painted environment (adopted ab1/ab_bg_painted)", rig="bg_landscape",
    resolution="4k", aspect="21:9", anchor="ab1/ab_bg_painted", stage="backgrounds",
    source=["art/source/backgrounds/bass-drop/base_landscape.png (3072x1536)"],
    downstream=["Centre-crop 21:9 -> 2:1, Lanczos to 3072x1536 (planned background step, PIPELINE 2.2)",
                "Gates: OCR no text, darker central 60% (mean luminance below the edges)"])

ANCHORS = [("sym_H1", "style"), ("sym_W", "style"), ("sym_H3", "style")]

# ---- phase 1: symbols
RIG_DOWN = [
    f"{M} <raw> art/source/symbols/{{ID}}/master_rig_2048.png --key auto --no-fit --parent-id <raw row id> --manifest art/manifest.json",
    "Split into parts: SAM masks + fills (PIPELINE 3.1; tools/split planned) -> art/source/spine/images/sym_{ID}/<part>.png + art/source/symbols/{ID}/parts.json",
    "python3 tools/spine/gen.py art/source/symbols/{ID}/rig.yaml -o build/spine/sym_{ID}.json",
    "GAME=bass-drop node tools/spine/validate.mjs build/spine/sym_{ID}.json --kind auto",
    KEY_NOTE,
]
for sid in ("H2", "H4"):
    row(f"sym_{sid}", phase="symbols", priority="P0", batch="c01", kind="symbol", template="symbol.txt",
        what=f"{label(sid)} beauty master, formula D (no adopted D image yet)", rig=f"sym_{sid}", atlas="symbols",
        symbol=sid, vars=v(SUBJECT=bd(f"symbols.{sid}.subject"), STYLE_FORMULA=FD), candidates=2, refs=ANCHORS,
        source=[f"art/source/symbols/{sid}/master_2048.png", f"build/pack/symbols{{tps}}/sym_{sid}{{,_blur,_glow}}.png"],
        downstream=[s.replace("{ID}", sid).replace("{HEX}", key_of(sid)) for s in BEAUTY_DOWN],
        fallback="Paintover of the probe1 formula-A image to the D finish.")
for sid, batch in (("H1", "c01"), ("H3", "c01"), ("H2", "c02"), ("H4", "c02")):
    others = [a for a in ANCHORS if a[0] != f"sym_{sid}"][:2]
    row(f"sym_{sid}_rig", phase="symbols", priority="P0", batch=batch, kind="symbol", template="symbol.txt",
        what=f"{label(sid)} rig-ready master (parts clear of each other)", rig=f"sym_{sid}", atlas="symbols", symbol=sid,
        rig_ready=True, vars=v(SUBJECT=bd(f"symbols.{sid}.subject"), STYLE_FORMULA=FD),
        refs=[(f"sym_{sid}", "identity"), *others], source=[f"art/source/symbols/{sid}/master_rig_2048.png"],
        downstream=[s.replace("{ID}", sid).replace("{HEX}", key_of(sid)) for s in RIG_DOWN],
        fallback="Split the beauty master instead (SAM + fills); the rig loses clean part gaps.")
for sid in ("H1", "H2", "H3", "H4"):
    row(f"sym_{sid}_parts", phase="symbols", priority="P1", batch="c11", kind="parts", template="symbol_parts_sheet.txt#A",
        what=f"{label(sid)} exploded parts sheet (hidden areas painted in)", rig=f"sym_{sid}", atlas="symbols", symbol=sid,
        vars=v(STYLE_FORMULA=FD), aspect="16:9", refs=[(f"sym_{sid}_rig", "edit-source")],
        source=[f"art/source/spine/images/sym_{sid}/<part>.png", f"art/source/symbols/{sid}/parts.json"],
        downstream=[f"{M} <raw> art/_work/sym_{sid}_parts/sheet.png --key auto --no-fit",
                    "Cut the sheet into pieces and register each to master_rig_2048.png (ECC/SIFT; tools/split planned); the pieces fill the hidden areas of the SAM split",
                    f"python3 tools/spine/gen.py art/source/symbols/{sid}/rig.yaml -o build/spine/sym_{sid}.json (bass_react, P1)"],
        fallback="Hidden areas from NB2 masked fills (symbol_parts_sheet.txt#C, fill reserve).")
for state in ("half", "closed", "wide"):
    row(f"sym_H3_eyes_{state}", phase="symbols", priority="P1", batch="c11", kind="parts", template="symbol_parts_sheet.txt#D",
        what=f"Crawfish eye state '{state}' (slot eyes)", rig="sym_H3", atlas="symbols", symbol="H3",
        vars=v(STATE_CHANGE=bd(f"symbols.H3.eyeStates.{state}")), model="nano_banana_2", resolution="1k",
        refs=[("sym_H3_rig", "edit-source (head crop)")], source=[f"art/source/spine/images/sym_H3/eyes_{state}.png"],
        downstream=[f"{M} <raw> art/_work/sym_H3_eyes_{state}/crop.png --key auto --no-fit",
                    "Register to the head crop of master_rig_2048.png (ECC), cut the eye region, attachment eyes/" + state],
        fallback="Procedural lids (a dark arc over the open eye) drawn in the rig.",
        notes="Nano Banana 2 at 1k: an edit of a head crop whose eyes are < 80 px on the 360 canvas; 1.5 instead of 2 credits.")

# ---- phase 2: wild
row("sym_W_rig", phase="wild", priority="P0", batch="c03", kind="symbol", template="symbol.txt",
    what="Wild rig-ready master (fang, cap and chain clear of each other)", rig="sym_W", atlas="symbols", symbol="W",
    rig_ready=True, vars=v(SUBJECT=bd("symbols.W.subject"), STYLE_FORMULA=FD), refs=[("sym_W", "identity"), ("sym_H1", "style")],
    source=["art/source/symbols/W/master_rig_2048.png"],
    downstream=[s.replace("{ID}", "W").replace("{HEX}", key_of("W")) for s in RIG_DOWN],
    fallback="Split the beauty master instead.")
row("sym_W_pieces", phase="wild", priority="P0", batch="c03", kind="prop", template="prop.txt#B",
    what="Wild pieces: blank ribbon, blank gold badge plate (t3), t5 flame crown, clamp closed + open", rig="sym_W",
    atlas="symbols", vars=v(PIECES=join("props.w_pieces.pieces", "; "), STYLE_FORMULA=FD, KEY_HEX=bd("props.w_pieces.keyHex")),
    aspect="16:9", candidates=2, refs=[("sym_W", "match"), ("sym_H1", "style")],
    source=["art/source/spine/images/sym_W/{ribbon,badge_t3,badge_flame,clamp,clamp_open}.png"],
    downstream=[f"{M} <raw> art/_work/sym_W_pieces/sheet.png --key auto --no-fit",
                "Cut into pieces; badge_t1/t2/t4/t5 = hue-mapped copies of badge_t3 (DESIGN §9 tier colours), t5 adds the flame crown; clamp_R = mirrored clamp_L",
                "Fit the badge to 192x120 units, centred 129 units below root (ANIMATION_SET §2.6)"],
    gates=["keyUniform", "paletteDeltaE", "outlineHistogram", "styleSimilarity", "halo", "noText", "lightDirection"],
    fallback="Vector badge plates (hand SVG + resvg) and a code-drawn clamp; the ribbon as a vector plate.")
row("sym_W_parts", phase="wild", priority="P0", batch="c04", kind="parts", template="symbol_parts_sheet.txt#A",
    what="Wild exploded parts sheet (fang, cap, chain)", rig="sym_W", atlas="symbols", symbol="W",
    vars=v(PART_LIST=bd("symbols.W.partList"), STYLE_FORMULA=FD), aspect="16:9", refs=[("sym_W_rig", "edit-source")],
    source=["art/source/spine/images/sym_W/{tooth,cap,chain}.png", "art/source/symbols/W/parts.json"],
    downstream=[f"{M} <raw> art/_work/sym_W_parts/sheet.png --key auto --no-fit",
                "Cut + register to master_rig_2048.png; tooth mesh 5x5, chain mesh on phys_chain_1..4 (ANIMATION_SET §2.6)",
                "sym_W rig (Spine; wild kind, CR-8) -> GAME=bass-drop node tools/spine/validate.mjs build/spine/sym_W.json --kind auto"],
    fallback="SAM split of the rig master + NB2 masked fills.")


# ---- phase 3: stage props
def prop_row(rid, pid, *, priority, batch, aspect, refs, what, direc, candidates=1, notes=None, fallback=None):
    p = BD["props"][pid]
    row(rid, phase="stage", priority=priority, batch=batch, kind="prop", template="prop.txt#A", what=what,
        rig=p["rig"], atlas=p["atlas"], aspect=aspect, candidates=candidates, refs=refs,
        vars=v(PROP=bd(f"props.{pid}.prop"), VIEW=bd(f"props.{pid}.view"), DETAIL=bd(f"props.{pid}.detail"),
               STYLE_FORMULA=FD, KEY_HEX=bd(f"props.{pid}.keyHex")),
        source=[f"art/source/bass-drop/{direc}/master.png"],
        downstream=[f"{M} <raw> art/source/bass-drop/{direc}/master.png --key auto --no-fit --parent-id <raw row id> --manifest art/manifest.json",
                    f"Authoring size {p.get('authoringUnits')} units at 2x (ANIMATION_SET §0); never upscale",
                    KEY_NOTE.replace("{HEX}", p["keyHex"])],
        notes=notes, fallback=fallback)


def prop_parts_row(rid, pid, *, priority, batch, master, direc):
    p = BD["props"][pid]
    row(rid, phase="stage", priority=priority, batch=batch, kind="parts", template="symbol_parts_sheet.txt#A",
        what=f"{p['rig']} exploded parts sheet", rig=p["rig"], atlas=p["atlas"], aspect="16:9",
        vars=v(SYMBOL_NAME=bd(f"props.{pid}.prop"), PART_LIST=join(f"props.{pid}.parts", ", "), STYLE_FORMULA=FD,
               KEY_HEX=bd(f"props.{pid}.keyHex")),
        refs=[(master, "edit-source")],
        source=[f"art/source/bass-drop/spine/images/{p['rig']}/<slot>.png", f"art/source/bass-drop/{direc}/parts.json"],
        downstream=[f"{M} <raw> art/_work/{rid}/sheet.png --key auto --no-fit",
                    f"Cut into pieces, register to the master, name them by bassDrop.props.{pid}.slots",
                    f"{p['rig']} rig in the Spine Editor (env/ui kinds are CR-8) -> GAME=bass-drop node tools/spine/validate.mjs build/spine/{p['rig']}.json --kind any"],
        fallback="SAM split of the master + NB2 masked fills; circular meter parts can be redrawn as vector rings.")


prop_row("bd_meter_master", "meter_cabinet", priority="P0", batch="c04", aspect="4:5", candidates=2,
         refs=[("sym_H1", "style: speaker cones, gold"), ("sym_H2", "style: black gloss"), ("sym_W", "style")],
         what="Groove Meter: upper speaker cabinet with the woofer (housing, rim, cone, dust cap)", direc="ui/groove_meter",
         notes="The dust cap is left blank: the counter is live text in slot txt_count. The trim band is light grey so the runtime recolours it per mode.",
         fallback="Code-drawn meter (the phase B placeholder) keeps the game playable.")
prop_parts_row("bd_meter_parts", "meter_cabinet", priority="P0", batch="c05", master="bd_meter_master", direc="ui/groove_meter")
prop_row("bd_speaker_stack_master", "lower_cabinet", priority="P1", batch="c12", aspect="1:1",
         refs=[("bd_meter_master", "match: same cabinet design"), ("sym_H1", "style")],
         what="Lower speaker cabinet (behind Gumbo)", direc="env/speaker_stack",
         fallback="Reuse the meter cabinet art scaled and cropped (no ports).")
prop_parts_row("bd_speaker_stack_parts", "lower_cabinet", priority="P1", batch="c13", master="bd_speaker_stack_master",
               direc="env/speaker_stack")
prop_row("bd_horn_master", "horn", priority="P1", batch="c12", aspect="1:1",
         refs=[("sym_H1", "style: gold"), ("bd_meter_master", "match: bolts, plum")],
         what="Frame corner horn speaker (left; the right one is mirrored)", direc="env/horn")
prop_parts_row("bd_horn_parts", "horn", priority="P1", batch="c13", master="bd_horn_master", direc="env/horn")
prop_row("bd_booth_master", "dj_booth", priority="P1", batch="c12", aspect="4:5",
         refs=[("sym_H2", "style: record"), ("sym_H1", "style: gold"), ("bd_meter_master", "match")],
         what="Croak's DJ booth: crate, deck, turntable, fader, drop button, lamps", direc="env/dj_booth",
         notes="Camera exception: slightly from above so the platter top reads. button_down and led_on are made in code.",
         fallback="Booth drawn from the frame planks + a vector deck.")
prop_parts_row("bd_booth_parts", "dj_booth", priority="P1", batch="c13", master="bd_booth_master", direc="env/dj_booth")
for piece, aspect, batch, refs in (("beam", "21:9", "c12", [("sym_H1", "style"), ("sym_W", "style")]),
                                   ("post", "9:16", "c13", [("frame_beam", "match")]),
                                   ("sill", "21:9", "c13", [("frame_beam", "match")]),
                                   ("corner cap", "1:1", "c13", [("frame_beam", "match")])):
    fid = "frame_" + ("cap" if piece == "corner cap" else piece)
    row(fid, phase="stage", priority="P1", batch=batch, kind="prop", template="frame_piece.txt",
        what=f"Cypress frame {piece} (3-slice; Swamp Funk design, formula D finish)", rig="frame (code 3-slice)", atlas="bd_env",
        vars=v(PIECE=piece, STYLE_FORMULA=FD), aspect=aspect, refs=refs, source=[f"art/source/ui/{fid}.png"],
        downstream=[f"{M} <raw> art/source/ui/{fid}.png --key auto --no-fit",
                    "3-slice: posts tile vertically, the beam stretches only in its centre segment"],
        fallback="Keep the code-drawn frame from phase B.")


# ---- phase 4: emblems, icons, logo, cards
def emblem_row(rid, eid, section, *, priority, batch, aspect, refs, what, candidates=2, fallback=None, notes=None):
    e = BD["emblems"][eid]
    if section in ("A", "B"):
        vars_ = v(EMBLEM=bd(f"emblems.{eid}.subject"), PALETTE=bd(f"emblems.{eid}.palette"), STYLE_FORMULA=FD,
                  KEY_HEX=bd(f"emblems.{eid}.keyHex"))
    else:
        vars_ = v(ICONS=join(f"emblems.{eid}.icons", "; "), STYLE_FORMULA=FD, KEY_HEX=bd(f"emblems.{eid}.keyHex"))
    row(rid, phase="emblems", priority=priority, batch=batch, kind="emblem", template=f"emblem.txt#{section}", what=what,
        rig=", ".join(e["rigs"]), atlas=e["atlas"], vars=vars_, aspect=aspect, candidates=candidates, refs=refs,
        source=[f"art/source/bass-drop/ui/emblems/{eid}.png"],
        downstream=[f"{M} <raw> art/source/bass-drop/ui/emblems/{eid}.png --key auto --no-fit --parent-id <raw row id> --manifest art/manifest.json",
                    "Region in the bd_ui atlas; attachment in the listed rigs (ANIMATION_SET §6)",
                    KEY_NOTE.replace("{HEX}", e["keyHex"])],
        fallback=fallback, notes=notes)


emblem_row("bd_emblem_jukebox", "jukebox", "A", priority="P0", batch="c05", aspect="1:1",
           refs=[("sym_H1", "style: gold"), ("sym_W", "style: teal enamel"), ("sym_H2", "style: record")],
           what="Juke Jam emblem: glowing jukebox (intro, outro, upgrade old emblem)",
           fallback="Card art composited from the W and the meter; emblem as a flat vector.")
emblem_row("bd_emblem_mega_speaker", "mega_speaker", "A", priority="P0", batch="c06", aspect="1:1",
           refs=[("bd_meter_master", "match: cabinet design"), ("sym_H1", "style: gold"), ("bd_emblem_jukebox", "match: emblem scale and finish")],
           what="Mega Mix emblem: crowned speaker stack (intro, outro, upgrade new emblem)",
           fallback="Three scaled copies of the meter cabinet + a vector crown.")
emblem_row("bd_notch_icons", "notch_icons", "C", priority="P0", batch="c07", aspect="16:9", candidates=1,
           refs=[("sym_W", "simplify"), ("bd_emblem_jukebox", "simplify"), ("bd_emblem_mega_speaker", "simplify")],
           what="Groove Meter notch icons: W fang, jukebox glyph, crowned speaker glyph (states in code)",
           fallback="Downscaled emblems with a thicker outline pass.")
row("bd_emblem_jukebox_cracked", phase="emblems", priority="P1", batch="c14", kind="emblem", template="symbol_parts_sheet.txt#D",
    what="Juke Jam emblem crack state for the upgrade (crack f12, shatter f18)", rig="ui_feature_upgrade", atlas="bd_ui",
    vars=v(SYMBOL_NAME=bd("emblems.jukebox_cracked.symbolName"), STATE_CHANGE=bd("emblems.jukebox_cracked.stateChange"),
           KEY_HEX=bd("emblems.jukebox_cracked.keyHex")),
    refs=[("bd_emblem_jukebox", "edit-source")], source=["art/source/bass-drop/ui/emblems/jukebox_cracked.png"],
    downstream=[f"{M} <raw> art/source/bass-drop/ui/emblems/jukebox_cracked.png --key auto --no-fit",
                "Register to jukebox.png (ECC); shard_1..6 = a seeded Voronoi cut of the cracked emblem (code)"],
    fallback="Procedural crack lines drawn over the emblem.")
emblem_row("bd_logo_emblem", "logo", "B", priority="P1", batch="c14", aspect="16:9",
           refs=[("bd_emblem_jukebox", "style"), ("bd_emblem_mega_speaker", "style"), ("sym_W", "match: fang charm"), ("bd_meter_master", "match: cone")],
           what="Logo emblem, no letters (the word-mark is typeset vector on its blank banner)",
           notes="A typographer sets the word-mark; trademark search before release (ART_BIBLE §8).",
           fallback="Typeset word-mark alone on a vector plate.")


def card_row(cid, refs, priority, batch):
    c = BD["cards"][cid]
    row(f"bd_card_{cid.removeprefix('art_')}", phase="emblems", priority=priority, batch=batch, kind="card",
        template="card_art.txt", what=f"{'Buy' if cid.endswith('_buy') else 'Intro'} card illustration {cid}", rig=c["rig"],
        atlas=c["atlas"], vars=v(SCENE=bd(f"cards.{cid}.scene"), BACKDROP=bd(f"cards.{cid}.backdrop"), STYLE_FORMULA=FD),
        refs=refs, source=[f"art/source/bass-drop/ui/cards/{cid}.png"],
        downstream=["No matte (full-bleed). Crops: landscape skin ~3:2 (tall card art slot), portrait skin 1:1",
                    "Region card_N_art in bd_ui (ANIMATION_SET §6.1 / §6.2)"],
        fallback=("Crop the matching intro card art." if cid.endswith("_buy")
                  else "Composite the approved W, badges, emblem and meter over a background crop (0 credits)."))


card_row("art_meter", [("bd_meter_master", "match"), ("sym_W", "match"), ("bg_base_landscape", "backdrop")], "P1", "c14")
card_row("art_jukejam", [("bd_emblem_jukebox", "match"), ("sym_W", "match"), ("sym_W_pieces", "match: badges"),
                         ("bg_base_landscape", "backdrop")], "P1", "c14")
card_row("art_megamix", [("bd_emblem_mega_speaker", "match"), ("sym_W", "match"), ("sym_W_pieces", "match: badges, clamps"),
                         ("bg_base_landscape", "backdrop")], "P1", "c14")

# ---- phase 5: backgrounds
BG_DOWN = {"landscape": "Centre-crop 21:9 -> 2:1, Lanczos to 3072x1536 -> art/source/backgrounds/bass-drop/{NAME}.png",
           "portrait": "Centre-crop the width 9:16 -> 1:2, Lanczos to 1536x3072 -> art/source/backgrounds/bass-drop/{NAME}.png"}
row("bd_bg_base_portrait", phase="backgrounds", priority="P0", batch="c07", kind="background", template="background.txt#F",
    what="Base background plate, portrait (reframe of the painted landscape plate)", rig="bg_portrait", resolution="4k",
    aspect="9:16", stage="backgrounds",
    vars=v(LEFT_MASS=bd("backgrounds.base.leftMass"), RIGHT_MASS=bd("backgrounds.base.rightMass"),
           TOP_DETAIL=bd("backgrounds.base.topDetail"), STYLE_FORMULA=FENV),
    refs=[("bg_base_landscape", "layout + palette")],
    source=["art/source/backgrounds/bass-drop/base_portrait.png (1536x3072)"],
    downstream=[BG_DOWN["portrait"].replace("{NAME}", "base_portrait"),
                "Gates: OCR, darker central column behind the grid (portrait grid 584-1396 of 1920)"],
    fallback="Crop the landscape plate's centre (loses the side neon masses).")
for mode in ("base", "jukejam", "megamix"):
    for orient, aspect in (("landscape", "21:9"), ("portrait", "9:16")):
        base_ref = "bg_base_landscape" if orient == "landscape" else "bd_bg_base_portrait"
        name = f"{mode}_{orient}"
        if mode != "base":
            row(f"bd_bg_{name}", phase="backgrounds", priority="P1", batch="c15", kind="variant", template="background.txt#E",
                what=f"{'Juke Jam (after hours)' if mode == 'jukejam' else 'Mega Mix (party lights)'} variant, {orient}",
                rig=f"bg_fs_{orient}", resolution="4k", aspect=aspect, stage="backgrounds",
                vars=v(VARIANT_NOTE=bd(f"backgrounds.{mode}.variantNote")), refs=[(base_ref, "edit-source")],
                source=[f"art/source/backgrounds/bass-drop/{name}.png"],
                downstream=[BG_DOWN[orient].replace("{NAME}", name),
                            "layoutMatch: edge-map IoU against the base plate of the same orientation (the crossfade must not swim)"],
                fallback="Colour-grade the base plate in code (tint + fog overlay).")
        prio, batch = ("P1", "c15") if mode == "base" else ("P2", "c22")
        row(f"bd_bg_{name}_neon", phase="backgrounds", priority=prio, batch=batch, kind="neon", template="background.txt#C",
            what=f"Neon-only additive layer, {mode} {orient}", rig=f"bg neon layer ({mode})", resolution="4k", aspect=aspect,
            refs=[(base_ref if mode == "base" else f"bd_bg_{name}", "edit-source")], stage="backgrounds",
            source=[f"art/source/backgrounds/bass-drop/{name}_neon.png"],
            downstream=["Same crop/resize as its plate; black = transparent under additive blend", "layoutMatch against its plate"],
            fallback="Procedural extraction: mask the bright saturated neon hues of the plate (0 credits).")

# ---- phase 6: mascots
row("mascot_croak_sheet", phase="mascots", priority="P0", batch="c08", kind="mascot", template="mascot_turnaround.txt#A",
    what="Baron Croak design model sheet, formula D (v2 design); identity reference for the rig", rig="chr_croak",
    atlas="bd_chr_croak", mascot="croak", vars=v(CHARACTER=bd("mascots.croak.character"), STYLE_FORMULA=FD),
    resolution="4k", aspect="21:9", stage="mascot-sheets",
    refs=[("mascot_croak_sheet_v2", "identity: design"), ("mascot_gumbo_sheet", "style: formula D finish")],
    source=["art/source/mascots/croak/sheets/design_sheet.png"],
    downstream=[f"{M} <raw> art/source/mascots/croak/sheets/design_sheet.png --key auto --no-fit",
                "Human approval of identity, adult proportions and the meme-frog check (bassDrop.mascots.croak.avoid)"],
    fallback="Paintover of the v2 sheet to the D finish.")
for mid, aspect, batch in (("gumbo", "4:5", "c08"), ("croak", "2:3", "c09")):
    mb = BD["mascots"][mid]
    key = BIBLE["mascots"][mid]["keyHex"]
    ident = "mascot_gumbo_sheet" if mid == "gumbo" else "mascot_croak_sheet"
    rig = mb["rig"]
    name = BIBLE["mascots"][mid]["name"]
    row(f"chr_{mid}_rig_master", phase="mascots", priority="P0", batch=batch, kind="mascot", template="mascot_parts_sheet.txt#A",
        what=f"{name} rig master (Spine setup pose, three-quarter view)", rig=rig, atlas=mb["atlas"], mascot=mid,
        vars=v(CHARACTER=bd(f"mascots.{mid}.character"), FACING=bd(f"mascots.{mid}.facing"),
               POSE_NOTE=bd(f"mascots.{mid}.poseNote"), STYLE_FORMULA=FD),
        aspect=aspect, candidates=2, refs=[(ident, "identity")], stage="mascot-sheets",
        source=[f"art/source/mascots/{mid}/spine2d/rig_master.png"],
        downstream=[f"{M} <raw> art/source/mascots/{mid}/spine2d/rig_master.png --key auto --no-fit",
                    f"Adult-proportions gate: head bbox <= 0.27 of height; authoring height {mb['authoringHeightUnits']} units at 2x",
                    KEY_NOTE.replace("{HEX}", key)],
        fallback="Use the design sheet's three-quarter view as the setup pose.")
for mid in ("gumbo", "croak"):
    mb = BD["mascots"][mid]
    key = BIBLE["mascots"][mid]["keyHex"]
    ident = "mascot_gumbo_sheet" if mid == "gumbo" else "mascot_croak_sheet"
    for sec, sheet, res, asp, cands in (("B", "body", "4k", "16:9", 2), ("C", "face", "4k", "16:9", 1),
                                        ("D", "hands", "2k", "3:2", 1), ("E", "props", "2k", "3:2", 1)):
        row(f"chr_{mid}_parts_{sheet}", phase="mascots", priority="P0", batch="c10", kind="mascotParts",
            template=f"mascot_parts_sheet.txt#{sec}", what=f"{BIBLE['mascots'][mid]['name']} {sheet} parts sheet",
            rig=mb["rig"], atlas=mb["atlas"], mascot=mid,
            vars=v(PART_LIST=join(f"mascots.{mid}.sheets.{sheet}", ", ", "piece"), STYLE_FORMULA=FD),
            resolution=res, aspect=asp, candidates=cands, stage="mascot-sheets",
            refs=[(f"chr_{mid}_rig_master", "view + scale"), (ident, "identity")],
            source=[f"art/source/bass-drop/spine/images/{mb['rig']}/<slot>[_<attachment>].png", f"art/source/mascots/{mid}/spine2d/parts.json"],
            downstream=[f"{M} <raw> art/_work/chr_{mid}_parts_{sheet}/sheet.png --key auto --no-fit",
                        f"Cut into pieces; name them by bassDrop.mascots.{mid}.sheets.{sheet}[].slot; register each to rig_master.png (ECC/SIFT)",
                        "Hidden overlaps: symbol_parts_sheet.txt#C with Nano Banana 2 masked inpaint (fill reserve)",
                        f"{mb['rig']}: Spine Editor, human animator (ANIMATION_SET §11) -> GAME=bass-drop node tools/spine/validate.mjs build/spine/{mb['rig']}.json --kind any"],
            fallback="SAM split of the rig master + masked fills for every hidden overlap.")

# ---- P2 extras (funded from unused retries or a top-up; see budget.perPriority.P2)
row("bd_bg_tile", phase="backgrounds", priority="P2", batch="c21", kind="background", template="background.txt#D",
    what="Bright game-tile plate (ACP Tile Editor)", rig="game tile", resolution="4k", aspect="21:9",
    refs=[("bg_base_landscape", "edit-source")], stage="backgrounds", source=["art/source/tile/bg_tile.png"],
    downstream=["Tile foreground = the finished Spine mascots rendered in celebrate (no generation)"],
    gates=["noText", "paletteDeltaE"], fallback="Brighten the base plate in code.")
prop_row("bd_horn_R_master", "horn_R", priority="P2", batch="c21", aspect="1:1",
         refs=[("bd_horn_master", "match")], what="Right horn, light-correct (instead of the mirrored left horn)", direc="env/horn_R",
         fallback="Mirror the left horn (its key light then reads upper right).")
card_row("art_jukejam_buy", [("bd_emblem_jukebox", "match"), ("sym_W", "match"), ("bg_base_landscape", "backdrop")], "P2", "c21")
card_row("art_megamix_buy", [("bd_emblem_mega_speaker", "match"), ("sym_W_pieces", "match: clamp"), ("bg_base_landscape", "backdrop")],
         "P2", "c21")

RESERVES = [
    {"id": "anchor_redo", "priority": "P0", "credits": 4,
     "what": "Redo one rejected anchor (a symbol costs 2, a sheet or plate 4) once the adopted images are downloaded and checked at full size."},
    {"id": "fills_p0", "priority": "P0", "credits": 6, "model": "nano_banana_2", "resolution": "1k", "count": 4,
     "template": "symbol_parts_sheet.txt#C",
     "what": "Hidden-area fills for P0 splits (mascot overlaps the part sheets missed): Nano Banana 2 masked inpaint "
             "(is_inpaint true, medias image_references + mask); each fill is recorded as its own ledger job when it runs."},
    {"id": "fills_p1", "priority": "P1", "credits": 4.5, "model": "nano_banana_2", "resolution": "1k", "count": 3,
     "template": "symbol_parts_sheet.txt#C", "what": "Hidden-area fills for P1 splits (symbols, props)."},
]

NOT_GENERATED = [
    {"id": "sym_L1..L5", "what": "Royals A K Q J 10", "how": "Vector glyphs (Lilita One / Titan One) + resvg with painterly gradient shading built into the vector so they sit next to formula-D symbols; light Spine rig (P1). An AI material pass needs a formula-D version of royal_material_pass.txt first (open decision).", "priority": "P1"},
    {"id": "ui_hud", "what": "Hex HUD buttons, spin button", "how": "Existing Swamp Funk vector (Recraft or hand SVG) + resvg.", "priority": "P0"},
    {"id": "ui_plates", "what": "Banner plates, feature plate, next-drop chip, buy/confirm/cancel plates and button states, card backs", "how": "Vector / code Plate; card frames = 9-slice of the frame beam texture + a code neon edge.", "priority": "P0"},
    {"id": "bd_ui_code_regions", "what": "LED ticks + glow arc, orbs, link wave, target reticle, landing shadow, home rim + clamps, lap pips, count pops", "how": "Code-drawn regions in bd_ui (ANIMATION_SET §8).", "priority": "P0"},
    {"id": "recolours", "what": "Meter rim trims (base/jukejam/megamix), notch states, badge tiers t1/t2/t4/t5, drop button down, LEDs on", "how": "Code recolour / transform of the generated art.", "priority": "P0"},
    {"id": "fx_slots", "what": "fx_glow, fx_ring, fx_trail, fx_swirl, fx_burst, fx_rays, fx_shine, fx_puff, button_glow, floor_light, fx_sweat, fx_note", "how": "Code-drawn additive regions (glow is never baked into art).", "priority": "P0"},
    {"id": "flipbooks", "what": "fx_speaker_blast, fx_wild_impact, fx_feature_blast, fx_title_shine", "how": "Blender renders (PIPELINE phase 5); live-particle fallbacks at P0. No AI look-dev planned: vfx_keyframe.txt still describes the flat-cel finish.", "priority": "P1"},
    {"id": "shards", "what": "H2 disc shards, W explode pieces, royal splinters, jukebox shards", "how": "Seeded Voronoi cut of the approved art (code).", "priority": "P1"},
    {"id": "ui_bigwin_bassdrop", "what": "Big-win skin: vinyl sunburst, flanking speaker cones", "how": "Sunburst from the H2 disc (code); cones reuse bd_meter_parts.", "priority": "P1"},
    {"id": "logo_wordmark", "what": "SWAMP FUNK / BASS DROP word-mark", "how": "Typographer, vector, on the blank banner of bd_logo_emblem; trademark search.", "priority": "P1"},
    {"id": "tile_foreground", "what": "Game-tile mascots", "how": "Render the finished Spine rigs in celebrate at 2048 px.", "priority": "P2"},
    {"id": "bg_parallax", "what": "Back / mid / front layers", "how": "Cut: the runtime pulses only the neon layer.", "priority": "cut"},
]

SUPERSEDED_WHY = {
    "probe1": "Formula A (flat cel): rejected in STYLE_DECISION.md (clip-art level; 'plum extrusion' drew sticks; Croak read as a meme frog).",
    "ab1": "Formula B / C A-B round: superseded by formula D (ab2); only ab_bg_painted and ab_croak_v2 (its design) are kept.",
}

# --------------------------------------------------------------------------- build


def check_banned(rid: str, text: str) -> None:
    low = text.lower()
    for w in BANNED:
        if w in low:
            raise SystemExit(f"{rid}: prompt contains the banned word '{w}' (artbible.bassDrop.bannedPromptWords)")


def render_row(r: dict):
    name, section = genlib.split_template_ref(r["template"])
    ph = set(genlib.placeholders(name, section))
    overrides = {k: val for k, (val, _) in r["vars"].items()}
    unused = sorted(set(overrides) - ph)
    if unused:
        raise SystemExit(f"{r['id']}: vars {unused} are not placeholders of {r['template']} ({sorted(ph)})")
    vals = genlib.build_values(r["template"], symbol=r["symbol"], mascot=r["mascot"], rig_ready=r["rig_ready"],
                               overrides=overrides)
    text, h = genlib.render(r["template"], vals)
    return text, h, overrides, {k: s for k, (_, s) in r["vars"].items() if s}, {k: vals[k] for k in sorted(ph)}


def render_cmd(r: dict) -> str:
    args = ["python3", "tools/gen/genlib.py", "render", "--template", r["template"]]
    if r["symbol"]:
        args += ["--symbol", r["symbol"]]
    if r["mascot"]:
        args += ["--mascot", r["mascot"]]
    if r["rig_ready"]:
        args.append("--rig-ready")
    for k, (val, _) in r["vars"].items():
        args += ["--var", f"{k}={val}"]
    args.append("--json")
    return " ".join(shlex.quote(a) for a in args)


def ledger_vars(r: dict) -> dict:
    out = {}
    if r["symbol"]:
        out["symbol"] = r["symbol"]
    if r["mascot"]:
        out["mascot"] = r["mascot"]
    if r["rig_ready"]:
        out["rigReady"] = True
    out.update({k: val for k, (val, _) in r["vars"].items()})
    return out


def batch_order() -> list[str]:
    order = []  # anchors first, then each priority's batches by id (c01 < c02 ...)
    for p in PRIORITIES:
        mine = {r["batch"] for r in ROWS if r["priority"] == p} - set(order)
        order += sorted(mine, key=lambda b: (b != "anchors", b))
    for b in order:
        if len({r["priority"] for r in ROWS if r["batch"] == b}) != 1:
            raise SystemExit(f"batch {b} mixes priorities")
    return order


def build() -> dict:
    jobs = ledger_jobs()
    ids = [r["id"] for r in ROWS]
    dup = {i for i in ids if ids.count(i) > 1}
    if dup:
        raise SystemExit(f"duplicate row ids {sorted(dup)}")
    order = batch_order()
    ordered = sorted(ROWS, key=lambda r: (order.index(r["batch"]), ROWS.index(r)))
    assets = []
    for n, r in enumerate(ordered, 1):
        job = jobs.get(r["anchor"]) if r["anchor"] else None
        if r["anchor"] and job is None:
            raise SystemExit(f"{r['id']}: anchor job {r['anchor']} is not in {LEDGER_PATH.relative_to(REPO)}")
        if r["template"]:
            text, h, overrides, vars_from, used = render_row(r)
            if not r["anchor"]:
                check_banned(r["id"], text)
            cmd, prompt_path = render_cmd(r), None
        else:  # an adopted job whose prompt was typed before this plan: the ledger's stored copy is the record
            text, h, overrides, vars_from, used = None, job["promptHash"], {}, {}, {}
            cmd, prompt_path = None, f"art/ledger/prompts/{job['promptHash']}.txt"
        if job and job["promptHash"] != h:
            raise SystemExit(f"{r['id']}: ledger promptHash {job['promptHash']} != rendered {h} (template or bible drifted)")
        per = MODELS[r["model"]]["credits"].get(r["resolution"])
        if per is None:
            raise SystemExit(f"{r['id']}: no price for {r['model']} at {r['resolution']}")
        refs = []
        for ref, role in r["refs"]:
            if ref not in ids:
                raise SystemExit(f"{r['id']}: reference {ref} is not a plan row")
            anc = next(x for x in ROWS if x["id"] == ref)["anchor"]
            refs.append({"ref": ref, "role": role, "jobId": jobs[anc]["job_id"] if anc else None})
        base = 0 if job else per * r["candidates"]
        factor = RETRY if r["priority"] in ("P0", "P1") else 1.0
        if job:
            asset = job.get("asset") or (genlib.default_asset(job["template"], (job.get("vars") or {}).get("symbol"),
                                                               (job.get("vars") or {}).get("mascot"), False)
                                         if job.get("template") else job["name"])
        else:
            asset = r["id"]
        assets.append({
            "order": n, "id": r["id"], "priority": r["priority"], "phase": r["phase"], "batch": r["batch"],
            "what": r["what"], "kind": r["kind"], "rig": r["rig"], "atlas": r["atlas"],
            "template": r["template"], "context": {k: x for k, x in (("symbol", r["symbol"]), ("mascot", r["mascot"]),
                                                                   ("rigReady", r["rig_ready"] or None)) if x},
            "vars": overrides, "varsFrom": vars_from, "keyHex": used.get("KEY_HEX"),
            "promptHash": h, "render": cmd, "promptPath": prompt_path, "prompt": text,
            "model": r["model"], "manifestModel": MODELS[r["model"]]["reports"], "resolution": r["resolution"],
            "aspectRatio": r["aspect"], "candidates": 0 if job else r["candidates"],
            "credits": {"perImage": per, "base": base, "withRetries": round(base * factor, 2),
                        "spent": (job.get("credits") or 0) if job else 0},
            "refs": refs, "status": f"adopted ({r['anchor']}); download and full-size review pending" if job else "planned",
            "jobIds": [job["job_id"]] if job else [], "stage": r["stage"],
            "ledgerVars": ledger_vars(r) if r["template"] and not job else None,
            "outputs": {"raw": f"art/_raw/{asset}/vNN/", "source": r["source"]},
            "downstream": r["downstream"], "gates": r["gates"], "fallback": r["fallback"], "notes": r["notes"],
        })
    by_id = {a["id"]: a for a in assets}
    for a in assets:
        for ref in a["refs"]:
            if by_id[ref["ref"]]["order"] >= a["order"]:
                raise SystemExit(f"{a['id']}: reference {ref['ref']} runs later (order)")
    used_jobs = {r["anchor"] for r in ROWS if r["anchor"]}
    superseded = [{"job": k, "jobId": j["job_id"], "why": SUPERSEDED_WHY.get(j["batch"], "not adopted")}
                  for k, j in jobs.items() if k not in used_jobs and j["batch"] in SUPERSEDED_WHY]
    return {"assets": assets, "budget": budget(assets, order), "batches": batches(assets, order), "superseded": superseded}


def budget(assets: list[dict], order: list[str]) -> dict:
    out = {"balance": BALANCE, "balanceDate": UPDATED, "retryFactor": RETRY, "p0Cap": P0_CAP, "perPriority": {}}
    left = BALANCE
    for p in ("P0", "P1"):
        base = sum(a["credits"]["base"] for a in assets if a["priority"] == p)
        wr = sum(a["credits"]["withRetries"] for a in assets if a["priority"] == p)
        res = sum(x["credits"] for x in RESERVES if x["priority"] == p)
        total = round(wr + res, 2)
        left = round(left - total, 2)
        out["perPriority"][p] = {"base": round(base, 2), "withRetries": round(wr, 2), "reserves": res, "total": total}
    out["perPriority"]["P0"]["fitsCap"] = out["perPriority"]["P0"]["total"] <= P0_CAP
    out["afterP0P1"] = left
    p2, funded, unfunded = [], [], []
    for b in [b for b in order if any(a["batch"] == b and a["priority"] == "P2" for a in assets)]:
        cost = round(sum(a["credits"]["base"] for a in assets if a["batch"] == b), 2)
        p2.append({"batch": b, "credits": cost})
        if cost <= left:
            left = round(left - cost, 2)
            funded.append(b)
        else:
            unfunded.append(b)
    out["perPriority"]["P2"] = {"batches": p2, "funded": funded, "unfunded": unfunded,
                                "total": round(sum(x["credits"] for x in p2), 2)}
    out["unallocated"] = left
    out["retryAllowance"] = round(sum(a["credits"]["withRetries"] - a["credits"]["base"] for a in assets), 2)
    out["reserves"] = RESERVES
    return out


def batches(assets: list[dict], order: list[str]) -> list[dict]:
    out = []
    by_id = {a["id"]: a for a in assets}
    for b in order:
        rows = [a for a in assets if a["batch"] == b]
        deps = sorted({by_id[r["ref"]]["batch"] for a in rows for r in a["refs"]} - {b}, key=order.index)
        out.append({"id": b, "priority": rows[0]["priority"], "phases": sorted({a["phase"] for a in rows}, key=PHASES.index),
                    "rows": [a["id"] for a in rows], "jobs": sum(a["candidates"] for a in rows),
                    "credits": round(sum(a["credits"]["base"] for a in rows), 2), "needsApproved": deps})
    return out


HEADER = {
    "$comment": "GENERATED by art/plan/build_plan.py from its row table + art/bible/artbible.json -> bassDrop; do not edit by hand (run the script). Human plan: docs/games/bass-drop/ART_PLAN.md. Finish: docs/games/bass-drop/STYLE_DECISION.md (formula D foreground, painted-environment backgrounds). 'render' is the exact tools/gen/genlib.py command that prints each planned prompt; promptHash is its sha256. Credits are Higgsfield MCP credits (measured 2026-09-26). Nothing here has been generated except the adopted anchor rows.",
    "game": "bass-drop",
    "planVersion": 2,
    "updated": UPDATED,
    "docs": ["docs/games/bass-drop/ART_PLAN.md", "docs/games/bass-drop/STYLE_DECISION.md", "docs/games/bass-drop/DESIGN.md",
             "docs/games/bass-drop/ANIMATION_SET.md", "docs/ART_BIBLE.md", "art/bible/prompts/README.md"],
    "route": {
        "route": ROUTE, "vendor": "Higgsfield", "licenseId": "higgsfield", "clearance": "pending (build and preview only; nothing ships)",
        "call": "generate_image_batch {requests:[{index, params:{model, prompt, aspect_ratio, resolution, medias:[{value: <approved job_id>, role: 'image_references'}]}}]}; one job per candidate. Always pass model explicitly (the MCP's default image model is denylisted).",
        "never": ["gpt_image_2", "gpt_image_2_5", "openai_hazel", "any OpenAI model (licenses/denylist.json openai-gpt-image)"],
        "noSeedNoNegative": True,
        "manifest": "route higgsfield-mcp, vendor Higgsfield, model = the id the job reports (nano_banana_2 for Nano Banana Pro), seed null, jobId, promptPath, promptHash, refHashes",
        "specs": "python3 art/plan/build_plan.py spec --batch <id> > art/_work/hf-plans/bd_<id>.spec.json; pnpm gen:hf-ingest plan --spec art/_work/hf-plans/bd_<id>.spec.json",
    },
    "styleFormulas": {"foreground": "artbible.bassDrop.styleFormula (formula D)", "backgrounds": "artbible.bassDrop.environmentFormula",
                      "bannedPromptWords": list(BANNED)},
    "models": MODELS,
    "styleAnchors": [a for a, _ in ANCHORS] + ["bg_base_landscape (backgrounds)", "mascot_gumbo_sheet / mascot_croak_sheet (mascots)"],
    "phases": PHASES,
}


def plan_doc() -> dict:
    b = build()
    doc = dict(HEADER)
    doc["budget"] = b["budget"]
    doc["batches"] = b["batches"]
    doc["assets"] = b["assets"]
    doc["notGenerated"] = NOT_GENERATED
    doc["superseded"] = b["superseded"]
    return doc


def dumps(doc: dict) -> str:
    return json.dumps(doc, indent=2, ensure_ascii=False) + "\n"


# --------------------------------------------------------------------------- CLI

TABLE_BEGIN = "<!-- BEGIN asset-table (generated: python3 art/plan/build_plan.py table --doc) -->"
TABLE_END = "<!-- END asset-table -->"


def table_md(doc: dict) -> str:
    lines = ["| # | Asset | What | Template | Model · res · aspect | Cand. | References | Pri. | Credits base → w/ retries | Rig |",
             "|---|---|---|---|---|---|---|---|---|---|"]
    for a in doc["assets"]:
        model = {"nano_banana_pro": "NBP", "nano_banana_2": "NB2"}[a["model"]]
        refs = ", ".join(f"`{r['ref']}`" for r in a["refs"]) or "–"
        cred = f"{a['credits']['spent']:g} spent" if a["jobIds"] else f"{a['credits']['base']:g} → {a['credits']['withRetries']:g}"
        rig = a["rig"].split(" (")[0].split(",")[0]
        tpl = f"`{a['template']}`" if a["template"] else "stored prompt"
        lines.append(f"| {a['order']} | `{a['id']}` | {a['what']} | {tpl} | {model} · {a['resolution']} · "
                     f"{a['aspectRatio']} | {a['candidates'] or '–'} | {refs} | {a['priority']} | {cred} | {rig} |")
    return "\n".join(lines)


def doc_with_table(doc: dict) -> tuple[str, str]:
    """(current ART_PLAN.md text, the same text with the generated asset table spliced in)."""
    cur = DOC_PATH.read_text(encoding="utf-8")
    i, j = cur.find(TABLE_BEGIN), cur.find(TABLE_END)
    if i < 0 or j < i:
        raise SystemExit(f"{DOC_PATH.relative_to(REPO)}: asset-table markers missing")
    return cur, cur[:i] + TABLE_BEGIN + "\n" + table_md(doc) + "\n" + cur[j:]


def cmd_table(doc: dict, write_doc: bool) -> int:
    if not write_doc:
        print(table_md(doc))
        return 0
    cur, new = doc_with_table(doc)
    if new != cur:
        DOC_PATH.write_text(new, encoding="utf-8")
    print(f"{DOC_PATH.relative_to(REPO)}: asset table {'updated' if new != cur else 'already current'}")
    return 0


def cmd_spec(doc: dict, batch: str, approvals_path: Path, allow_unapproved: bool) -> int:
    rows = [a for a in doc["assets"] if a["batch"] == batch]
    if not rows:
        print(f"error: no batch {batch!r} (have {[b['id'] for b in doc['batches']]})", file=sys.stderr)
        return 2
    if rows[0]["status"] != "planned":
        print(f"error: batch {batch} is already generated", file=sys.stderr)
        return 2
    approved = json.loads(approvals_path.read_text(encoding="utf-8")).get("approvals", {}) if approvals_path.is_file() else {}
    missing, jobs, index = [], [], 0
    for a in rows:
        medias = []
        for ref in a["refs"]:
            val = approved.get(ref["ref"], {}).get("job_id")
            if not val:
                missing.append(f"{a['id']} -> {ref['ref']}")
                val = f"UNAPPROVED:{ref['ref']}"
            medias.append({"value": val, "role": "image_references"})
        for k in range(1, a["candidates"] + 1):
            job = {"index": index, "name": f"{a['id']}.c{k}", "template": a["template"], "vars": a["ledgerVars"],
                   "resolution": a["resolution"], "aspect_ratio": a["aspectRatio"], "credits": a["credits"]["perImage"],
                   "asset": a["id"], "stage": a["stage"]}
            if a["model"] != "nano_banana_pro":
                job["request_model"] = a["model"]
            if medias:
                job["medias"] = medias
            jobs.append(job)
            index += 1
    if missing and not allow_unapproved:
        print("error: references not approved yet (add them to art/plan/approvals.json):\n  " + "\n  ".join(missing), file=sys.stderr)
        return 3
    spec = {"batch": f"bd_{batch}", "model": "nano_banana_pro", "planTier": "Higgsfield Plus",
            "purpose": f"Bass Drop Phase C batch {batch}: " + ", ".join(a["id"] for a in rows), "jobs": jobs}
    print(json.dumps(spec, indent=2, ensure_ascii=False))
    return 0


def cmd_summary(doc: dict) -> int:
    bud = doc["budget"]
    print(f"balance {bud['balance']} credits ({bud['balanceDate']}), retry factor {bud['retryFactor']}, P0 cap {bud['p0Cap']}")
    for p in ("P0", "P1"):
        x = bud["perPriority"][p]
        print(f"  {p}: base {x['base']} -> with retries {x['withRetries']} + reserves {x['reserves']} = {x['total']}")
    p2 = bud["perPriority"]["P2"]
    print(f"  P2: {p2['total']} planned; funded {p2['funded']}, unfunded {p2['unfunded']}; unallocated {bud['unallocated']}; "
          f"retry allowance inside P0+P1 {bud['retryAllowance']}")
    for b in doc["batches"]:
        print(f"  {b['id']:7s} {b['priority']} {b['jobs']:>2} jobs {b['credits']:>5} cr  needs {','.join(b['needsApproved']) or '-':18s} {' '.join(b['rows'])}")
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cmd", nargs="?", default="write", choices=["write", "summary", "table", "spec"])
    ap.add_argument("--check", action="store_true", help="write: fail (exit 1) when bass-drop.json or the ART_PLAN.md table is stale")
    ap.add_argument("--batch", help="spec: batch id (see 'summary')")
    ap.add_argument("--approvals", default=str(APPROVALS_PATH), help="spec: approved job ids per plan row")
    ap.add_argument("--allow-unapproved", action="store_true", help="spec: emit UNAPPROVED:<id> placeholders (review only)")
    ap.add_argument("--doc", action="store_true", help="table: splice the table into docs/games/bass-drop/ART_PLAN.md")
    a = ap.parse_args(argv)
    doc = plan_doc()
    if a.cmd == "summary":
        return cmd_summary(doc)
    if a.cmd == "table":
        return cmd_table(doc, a.doc)
    if a.cmd == "spec":
        if not a.batch:
            ap.error("spec needs --batch")
        return cmd_spec(doc, a.batch, Path(a.approvals), a.allow_unapproved)
    text = dumps(doc)
    if a.check:
        cur = PLAN_PATH.read_text(encoding="utf-8") if PLAN_PATH.is_file() else ""
        if cur != text:
            print(f"{PLAN_PATH.relative_to(REPO)} is stale: run python3 art/plan/build_plan.py", file=sys.stderr)
            return 1
        cur_doc, new_doc = doc_with_table(doc)
        if cur_doc != new_doc:
            print(f"{DOC_PATH.relative_to(REPO)} asset table is stale: run python3 art/plan/build_plan.py table --doc", file=sys.stderr)
            return 1
        print(f"{PLAN_PATH.relative_to(REPO)} is up to date ({len(doc['assets'])} rows)")
        return 0
    PLAN_PATH.write_text(text, encoding="utf-8")
    print(f"wrote {PLAN_PATH.relative_to(REPO)}: {len(doc['assets'])} rows")
    return 0


if __name__ == "__main__":
    sys.exit(main())
