#!/usr/bin/env python3
"""Bass Drop production visual set (Phase C): the machine-readable generation plan.

Builds art/plan/bass-drop.json from the rows below plus art/bible/artbible.json -> bassDrop. Every row names a
template (art/bible/prompts), its values, the Higgsfield MCP request (model, resolution, aspect, candidates,
references), credits, outputs, the downstream steps and the review gates. Prompts are rendered by
tools/gen/genlib.py, the same renderer every generation tool uses, so a row's promptHash is the hash a real
generation records. The human plan is docs/games/bass-drop/ART_PLAN.md.

  python3 art/plan/build_plan.py                  # rewrite art/plan/bass-drop.json
  python3 art/plan/build_plan.py --check          # exit 1 when the committed plan is stale
  python3 art/plan/build_plan.py summary          # budget per priority and per batch
  python3 art/plan/build_plan.py table            # markdown asset table (pasted into ART_PLAN.md)
  python3 art/plan/build_plan.py spec --batch c01 # 'pnpm gen:hf-ingest plan --spec' input for one batch;
                                                  # every reference must be approved in art/plan/approvals.json

Script-free route: each row's 'render' field is the exact tools/gen/genlib.py command that prints its prompt.
Nothing here calls a vendor or spends credits. Stdlib only.
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

UPDATED = "2026-09-26"
BALANCE = 279.75          # Higgsfield balance() on 2026-09-26 after probe1 (Plus plan)
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
# Titles of our own games: never in a prompt (the model would paint letters). Checked here and in the tests.
OWN_TITLES = ("swamp funk", "bass drop", "juke jam", "mega mix", "groove meter")

GATES = {
    "symbol": ["readability64", "silhouetteConfusion", "paletteDeltaE", "outlineHistogram", "styleSimilarity", "halo",
               "noText", "canvasAndPivot", "lightDirection"],
    "parts": ["spineSplit", "paletteDeltaE", "halo", "noText"],
    "prop": ["paletteDeltaE", "outlineHistogram", "styleSimilarity", "halo", "noText", "lightDirection"],
    "emblem": ["readability64", "paletteDeltaE", "outlineHistogram", "styleSimilarity", "halo", "noText", "lightDirection"],
    "card": ["noText", "paletteDeltaE", "styleSimilarity", "lightDirection"],
    "background": ["noText", "paletteDeltaE", "styleSimilarity", "darkerCentre"],
    "variant": ["noText", "paletteDeltaE", "darkerCentre", "layoutMatch"],
    "neon": ["noText", "layoutMatch"],
    "mascot": ["adultProportions", "styleSimilarity", "paletteDeltaE", "outlineHistogram", "halo", "noText", "lightDirection"],
    "mascotParts": ["spineSplit", "adultProportions", "styleSimilarity", "paletteDeltaE", "halo", "noText"],
}

M = "GAME=bass-drop python3 tools/matte/outline_matte.py"


def bd(path: str):
    """Value at artbible.bassDrop.<path> and its bible path (for 'varsFrom')."""
    cur = genlib.bible()["bassDrop"]
    for k in path.split("."):
        cur = cur[k]
    return cur, "bassDrop." + path


def ledger_jobs() -> dict:
    doc = json.loads(LEDGER_PATH.read_text(encoding="utf-8"))
    return {j["name"]: {**j, "batch": b["id"]} for b in doc["batches"] for j in b["jobs"]}


# --------------------------------------------------------------------------- rows

ROWS: list[dict] = []


def row(rid, *, phase, priority, batch, kind, template, what, rig=None, atlas=None, symbol=None, mascot=None,
        rig_ready=False, vars=None, model="nano_banana_pro", resolution="2k", aspect="1:1", candidates=1, refs=(),
        source=(), downstream=(), gates=None, fallback=None, notes=None, stage="2d-image", probe=None, asset=None):
    ROWS.append(dict(id=rid, phase=phase, priority=priority, batch=batch, kind=kind, template=template, what=what,
                     rig=rig, atlas=atlas, symbol=symbol, mascot=mascot, rig_ready=rig_ready, vars=dict(vars or {}),
                     model=model, resolution=resolution, aspect=aspect, candidates=candidates, refs=list(refs),
                     source=list(source), downstream=list(downstream), gates=gates or GATES[kind], fallback=fallback,
                     notes=notes, stage=stage, probe=probe, asset=asset))


def v(**pairs):
    """--var values: NAME=(value, bible path) or NAME=value (literal)."""
    out = {}
    for k, x in pairs.items():
        out[k] = x if isinstance(x, tuple) else (x, None)
    return out


def join(path, sep, key=None):
    val, src = bd(path)
    return (sep.join(p[key] if key else p for p in val), src)


# ---- phase 0: style anchors = the paid probe batch (review only, 0 credits)
SYMBOL_BEAUTY_DOWN = [
    f'{M} <raw> "build/pack/symbols{{tps}}/sym_{{ID}}.png" --symbol {{ID}} --key {{KEY}} '
    "--emit-master art/source/symbols/{ID}/master_2048.png --parent-id <raw row id> --manifest art/manifest.json",
    'GAME=bass-drop python3 tools/matte/variants.py "build/pack/symbols{tps}/sym_{ID}.png" --symbol {ID} --manifest art/manifest.json',
]
for sid, rig in (("H1", "sym_H1"), ("H2", "sym_H2"), ("H3", "sym_H3"), ("H4", "sym_H4"), ("W", "sym_W")):
    key = genlib.bible()["symbols"][sid]["keyHex"].lstrip("#")
    row(f"sym_{sid}", phase="anchors", priority="P0", batch="probe1", kind="symbol", template="symbol.txt",
        what=f"{genlib.bible()['symbols'][sid]['label']} beauty master (probe1); style anchor", rig=rig, atlas="symbols",
        symbol=sid, probe=f"sym_{sid}",
        source=[f"art/source/symbols/{sid}/master_2048.png", f"build/pack/symbols{{tps}}/sym_{sid}{{,_blur,_glow}}.png"],
        downstream=[s.replace("{ID}", sid).replace("{KEY}", key) for s in SYMBOL_BEAUTY_DOWN],
        fallback="Rejected probe: regenerate once from the same row (probe redo reserve), then paintover.")
for mid in ("gumbo", "croak"):
    row(f"mascot_{mid}_sheetA", phase="anchors", priority="P0", batch="probe1", kind="mascot",
        template="mascot_turnaround.txt#A", what=f"{genlib.bible()['mascots'][mid]['name']} design model sheet (probe1); identity reference",
        rig=f"chr_{mid}", mascot=mid, resolution="4k", aspect="21:9", probe=f"mascot_{mid}_sheetA", stage="mascot-sheets",
        source=[f"art/source/mascots/{mid}/sheets/design_sheet.png"],
        downstream=["Human approval of identity and adult proportions (ART_BIBLE §7), then copy the approved raw to the source path."],
        fallback="Rejected sheet: regenerate once (probe redo reserve). Everything in the mascots phase waits for this approval.")
row("bg_A_landscape", phase="anchors", priority="P0", batch="probe1", kind="background", template="background.txt#A",
    what="Base background plate, landscape (probe1)", rig="bg_landscape", resolution="4k", aspect="21:9",
    probe="bg_A_landscape", stage="backgrounds",
    source=["art/source/backgrounds/bass-drop/base_landscape.png (3072x1536)"],
    downstream=["Centre-crop 21:9 -> 2:1, Lanczos to 3072x1536 (planned background step, PIPELINE 2.2).",
                "Gates: OCR no text, darker central 60% (mean luminance below the edges)."])

ANCHORS = [("sym_H1", "style"), ("sym_W", "style"), ("sym_H3", "style")]

# ---- phase 1: symbols
RIG_DOWN = [
    f"{M} <raw> art/source/symbols/{{ID}}/master_rig_2048.png --key {{KEY}} --no-fit --parent-id <raw row id> --manifest art/manifest.json",
    "Split into parts: SAM masks + fills (PIPELINE 3.1; tools/split planned) -> art/source/spine/images/sym_{ID}/<part>.png + art/source/symbols/{ID}/parts.json",
    "python3 tools/spine/gen.py art/source/symbols/{ID}/rig.yaml -o build/spine/sym_{ID}.json",
    "GAME=bass-drop node tools/spine/validate.mjs build/spine/sym_{ID}.json --kind auto",
]
for sid in ("H1", "H2", "H3", "H4"):
    key = genlib.bible()["symbols"][sid]["keyHex"].lstrip("#")
    others = [a for a in ANCHORS if a[0] != f"sym_{sid}"][:2]
    row(f"sym_{sid}_rig", phase="symbols", priority="P0", batch="c01", kind="symbol", template="symbol.txt",
        what=f"{genlib.bible()['symbols'][sid]['label']} rig-ready master (parts clear of the body)", rig=f"sym_{sid}",
        atlas="symbols", symbol=sid, rig_ready=True, candidates=2, refs=[(f"sym_{sid}", "identity"), *others],
        source=[f"art/source/symbols/{sid}/master_rig_2048.png"],
        downstream=[s.replace("{ID}", sid).replace("{KEY}", key) for s in RIG_DOWN],
        fallback="Split the beauty master instead (SAM + fills); the rig loses clean part gaps.")
for sid in ("H1", "H2", "H3", "H4"):
    key = genlib.bible()["symbols"][sid]["keyHex"].lstrip("#")
    row(f"sym_{sid}_parts", phase="symbols", priority="P1", batch="c11", kind="parts", template="symbol_parts_sheet.txt#A",
        what=f"{genlib.bible()['symbols'][sid]['label']} exploded parts sheet (hidden areas painted in)", rig=f"sym_{sid}",
        atlas="symbols", symbol=sid, aspect="16:9", refs=[(f"sym_{sid}_rig", "edit-source")],
        source=[f"art/source/spine/images/sym_{sid}/<part>.png", f"art/source/symbols/{sid}/parts.json"],
        downstream=[f"{M} <raw> art/_work/sym_{sid}_parts/sheet.png --key {key} --no-fit",
                    "Cut the sheet into pieces and register each to master_rig_2048.png (ECC/SIFT; tools/split planned); pieces fill the hidden areas of the SAM split",
                    f"python3 tools/spine/gen.py art/source/symbols/{sid}/rig.yaml -o build/spine/sym_{sid}.json (bass_react, P1)"],
        fallback="Hidden areas from NB2 masked fills (symbol_parts_sheet.txt#C, fill reserve).")
for state in ("half", "closed", "wide"):
    row(f"sym_H3_eyes_{state}", phase="symbols", priority="P1", batch="c11", kind="parts", template="symbol_parts_sheet.txt#D",
        what=f"Crawfish eye state '{state}' (slot eyes)", rig="sym_H3", atlas="symbols", symbol="H3",
        vars=v(STATE_CHANGE=bd(f"symbols.H3.eyeStates.{state}")), model="nano_banana_2", resolution="1k",
        refs=[("sym_H3_rig", "edit-source (head crop)")],
        source=[f"art/source/spine/images/sym_H3/eyes_{state}.png"],
        downstream=[f"{M} <raw> art/_work/sym_H3_eyes_{state}/crop.png --key 00FF00 --no-fit",
                    "Register to the head crop of master_rig_2048.png (ECC), cut the eye region, attachment eyes/" + state],
        fallback="Procedural lids (black arc over the open eye) drawn in the rig.",
        notes="Nano Banana 2 at 1k: an edit of a head crop whose eyes are < 80 px on the 360 canvas; 1.5 instead of 2 credits.")

# ---- phase 2: wild
row("sym_W_rig", phase="wild", priority="P0", batch="c02", kind="symbol", template="symbol.txt",
    what="Wild rig-ready master (tooth, cap and chain clear of each other)", rig="sym_W", atlas="symbols", symbol="W",
    rig_ready=True, candidates=2, refs=[("sym_W", "identity"), ("sym_H1", "style")],
    source=["art/source/symbols/W/master_rig_2048.png"],
    downstream=[s.replace("{ID}", "W").replace("{KEY}", "FF00FF") for s in RIG_DOWN],
    fallback="Split the beauty master instead.")
row("sym_W_pieces", phase="wild", priority="P0", batch="c02", kind="prop", template="prop.txt#B",
    what="Wild pieces: blank ribbon, blank gold badge plate (t3), t5 flame crown, clamp closed + open", rig="sym_W",
    atlas="symbols", vars=v(PIECES=join("props.w_pieces.pieces", "; "), KEY_HEX=bd("props.w_pieces.keyHex")),
    aspect="16:9", candidates=2, refs=[("sym_W", "match"), ("sym_H1", "style")],
    source=["art/source/spine/images/sym_W/{ribbon,badge_t3,badge_flame,clamp,clamp_open}.png"],
    downstream=[f"{M} <raw> art/_work/sym_W_pieces/sheet.png --key 00FF00 --no-fit",
                "Cut into pieces; badge_t1/t2/t4/t5 = hue-mapped copies of badge_t3 (DESIGN §9 tier colours), t5 adds the flame crown; clamp_R = mirrored clamp_L",
                "Fit the badge to 192x120 units, centred 129 units below root (ANIMATION_SET §2.6)"],
    gates=["paletteDeltaE", "outlineHistogram", "styleSimilarity", "halo", "noText", "lightDirection"],
    fallback="Vector badge plates (hand SVG + resvg) and a code-drawn clamp; the ribbon as a vector plate.")
row("sym_W_parts", phase="wild", priority="P0", batch="c03", kind="parts", template="symbol_parts_sheet.txt#A",
    what="Wild exploded parts sheet (tooth, cap, chain)", rig="sym_W", atlas="symbols", symbol="W",
    vars=v(PART_LIST=bd("symbols.W.partList")), aspect="16:9", refs=[("sym_W_rig", "edit-source")],
    source=["art/source/spine/images/sym_W/{tooth,cap,chain}.png", "art/source/symbols/W/parts.json"],
    downstream=[f"{M} <raw> art/_work/sym_W_parts/sheet.png --key FF00FF --no-fit",
                "Cut + register to master_rig_2048.png; tooth mesh 5x5, chain mesh on phys_chain_1..4 (ANIMATION_SET §2.6)",
                "sym_W rig (Spine; wild kind, CR-8) -> GAME=bass-drop node tools/spine/validate.mjs build/spine/sym_W.json --kind auto"],
    fallback="SAM split of the rig master + NB2 masked fills.")

# ---- phase 3: stage props
PROP_DOWN = [
    "{M} <raw> art/source/bass-drop/{DIR}/master.png --key {KEY} --no-fit --parent-id <raw row id> --manifest art/manifest.json",
]


def prop_row(rid, pid, *, priority, batch, aspect, refs, what, direc, candidates=2, notes=None, fallback=None):
    p = genlib.bible()["bassDrop"]["props"][pid]
    key = p["keyHex"].lstrip("#")
    row(rid, phase="stage", priority=priority, batch=batch, kind="prop", template="prop.txt#A", what=what,
        rig=p["rig"], atlas=p["atlas"], aspect=aspect, candidates=candidates, refs=refs,
        vars=v(PROP=bd(f"props.{pid}.prop"), VIEW=bd(f"props.{pid}.view"), DETAIL=bd(f"props.{pid}.detail"),
               KEY_HEX=bd(f"props.{pid}.keyHex")),
        source=[f"art/source/bass-drop/{direc}/master.png"],
        downstream=[PROP_DOWN[0].replace("{M}", M).replace("{DIR}", direc).replace("{KEY}", key),
                    f"Authoring size {p.get('authoringUnits')} units at 2x (ANIMATION_SET §0); never upscale"],
        notes=notes, fallback=fallback)


def prop_parts_row(rid, pid, *, priority, batch, master, direc):
    p = genlib.bible()["bassDrop"]["props"][pid]
    key = p["keyHex"].lstrip("#")
    row(rid, phase="stage", priority=priority, batch=batch, kind="parts", template="symbol_parts_sheet.txt#A",
        what=f"{p['rig']} exploded parts sheet", rig=p["rig"], atlas=p["atlas"], aspect="16:9",
        vars=v(SYMBOL_NAME=bd(f"props.{pid}.prop"), PART_LIST=join(f"props.{pid}.parts", ", "), KEY_HEX=bd(f"props.{pid}.keyHex")),
        refs=[(master, "edit-source")],
        source=[f"art/source/bass-drop/spine/images/{p['rig']}/<slot>.png", f"art/source/bass-drop/{direc}/parts.json"],
        downstream=[f"{M} <raw> art/_work/{rid}/sheet.png --key {key} --no-fit",
                    "Cut into pieces, register to the master, name by bassDrop.props." + pid + ".slots",
                    f"{p['rig']} rig in the Spine Editor (env/ui kinds are CR-8) -> GAME=bass-drop node tools/spine/validate.mjs build/spine/{p['rig']}.json --kind any"],
        fallback="SAM split of the master + NB2 masked fills; circular meter parts can be redrawn as vector rings.")


prop_row("bd_meter_master", "meter_cabinet", priority="P0", batch="c03", aspect="4:5",
         refs=[("sym_H1", "style: speaker cones, gold"), ("sym_H2", "style: black gloss"), ("sym_W", "style")],
         what="Groove Meter: upper speaker cabinet with the woofer (housing, rim, cone, dust cap)", direc="ui/groove_meter",
         notes="The dust cap is left blank: the counter is live text in slot txt_count. The trim band is light grey so the runtime recolours it per mode.",
         fallback="Code-drawn meter (the phase B placeholder) keeps the game playable.")
prop_parts_row("bd_meter_parts", "meter_cabinet", priority="P0", batch="c04", master="bd_meter_master", direc="ui/groove_meter")
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
    row(fid, phase="stage", priority="P1", batch=batch, kind="prop", template="frame_piece.txt", what=f"Cypress frame {piece} (3-slice; shared with Swamp Funk)",
        rig="frame (code 3-slice)", atlas="bd_env", vars=v(PIECE=piece), aspect=aspect, refs=refs,
        source=[f"art/source/ui/{fid}.png"],
        downstream=[f"{M} <raw> art/source/ui/{fid}.png --key FF00FF --no-fit", "3-slice: posts tile vertically, the beam stretches only in its centre segment"],
        fallback="Keep the code-drawn frame from phase B.")

# ---- phase 4: emblems, icons, logo, cards
EMB_DOWN = "{M} <raw> art/source/bass-drop/ui/emblems/{NAME}.png --key {KEY} --no-fit --parent-id <raw row id> --manifest art/manifest.json"


def emblem_row(rid, eid, section, *, priority, batch, aspect, refs, what, candidates=2, extra_vars=None, fallback=None, notes=None):
    e = genlib.bible()["bassDrop"]["emblems"][eid]
    key = e["keyHex"].lstrip("#")
    vars_ = v(EMBLEM=bd(f"emblems.{eid}.subject"), PALETTE=bd(f"emblems.{eid}.palette"), KEY_HEX=bd(f"emblems.{eid}.keyHex")) \
        if section in ("A", "B") else v(ICONS=join(f"emblems.{eid}.icons", "; "), KEY_HEX=bd(f"emblems.{eid}.keyHex"))
    vars_.update(extra_vars or {})
    row(rid, phase="emblems", priority=priority, batch=batch, kind="emblem", template=f"emblem.txt#{section}", what=what,
        rig=", ".join(e["rigs"]), atlas=e["atlas"], vars=vars_, aspect=aspect, candidates=candidates, refs=refs,
        source=[f"art/source/bass-drop/ui/emblems/{eid}.png"],
        downstream=[EMB_DOWN.replace("{M}", M).replace("{NAME}", eid).replace("{KEY}", key),
                    "Region in the bd_ui atlas; attachment in the listed rigs (ANIMATION_SET §6)"],
        fallback=fallback, notes=notes)


emblem_row("bd_emblem_jukebox", "jukebox", "A", priority="P0", batch="c04", aspect="1:1",
           refs=[("sym_H1", "style: gold"), ("sym_W", "style: teal enamel"), ("sym_H2", "style: record")],
           what="Juke Jam emblem: glowing jukebox (intro, outro, upgrade old emblem)",
           fallback="Card art composited from the W and the meter; emblem as a flat vector.")
emblem_row("bd_emblem_mega_speaker", "mega_speaker", "A", priority="P0", batch="c05", aspect="1:1",
           refs=[("bd_meter_master", "match: cabinet design"), ("sym_H1", "style: gold"), ("bd_emblem_jukebox", "match: emblem scale and finish")],
           what="Mega Mix emblem: crowned speaker stack (intro, outro, upgrade new emblem)",
           fallback="Three scaled copies of the meter cabinet + a vector crown.")
emblem_row("bd_notch_icons", "notch_icons", "C", priority="P0", batch="c06", aspect="16:9",
           refs=[("sym_W", "simplify"), ("bd_emblem_jukebox", "simplify"), ("bd_emblem_mega_speaker", "simplify")],
           what="Groove Meter notch icons: W charm, jukebox glyph, crowned speaker glyph (states in code)",
           fallback="Downscaled emblems with a thicker outline pass.")
row("bd_emblem_jukebox_cracked", phase="emblems", priority="P1", batch="c14", kind="emblem", template="symbol_parts_sheet.txt#D",
    what="Juke Jam emblem crack state for the upgrade (crack f12, shatter f18)", rig="ui_feature_upgrade", atlas="bd_ui",
    vars=v(SYMBOL_NAME=bd("emblems.jukebox_cracked.symbolName"), STATE_CHANGE=bd("emblems.jukebox_cracked.stateChange"),
           KEY_HEX=bd("emblems.jukebox_cracked.keyHex")),
    refs=[("bd_emblem_jukebox", "edit-source")], source=["art/source/bass-drop/ui/emblems/jukebox_cracked.png"],
    downstream=[f"{M} <raw> art/source/bass-drop/ui/emblems/jukebox_cracked.png --key FF00FF --no-fit",
                "Register to jukebox.png (ECC); shard_1..6 = a seeded Voronoi cut of the cracked emblem (code)"],
    fallback="Procedural crack lines drawn over the emblem.")
emblem_row("bd_logo_emblem", "logo", "B", priority="P1", batch="c14", aspect="16:9",
           refs=[("bd_emblem_jukebox", "style"), ("bd_emblem_mega_speaker", "style"), ("sym_W", "match: tooth charm"), ("bd_meter_master", "match: cone")],
           what="Logo emblem, no letters (the word-mark is typeset vector on its blank banner)",
           notes="A typographer sets the word-mark; trademark search before release (ART_BIBLE §8).",
           fallback="Typeset word-mark alone on a vector plate.")
for cid, refs in (("art_meter", [("bd_meter_master", "match"), ("sym_W", "match"), ("bg_A_landscape", "backdrop")]),
                  ("art_jukejam", [("bd_emblem_jukebox", "match"), ("sym_W", "match"), ("sym_W_pieces", "match: badges"), ("bg_A_landscape", "backdrop")]),
                  ("art_megamix", [("bd_emblem_mega_speaker", "match"), ("sym_W", "match"), ("sym_W_pieces", "match: badges, clamps"), ("bg_A_landscape", "backdrop")])):
    c = genlib.bible()["bassDrop"]["cards"][cid]
    row(f"bd_card_{cid.removeprefix('art_')}", phase="emblems", priority="P1", batch="c14", kind="card", template="card_art.txt",
        what=f"Intro card illustration {cid}", rig=c["rig"], atlas=c["atlas"],
        vars=v(SCENE=bd(f"cards.{cid}.scene"), BACKDROP=bd(f"cards.{cid}.backdrop")), refs=refs,
        source=[f"art/source/bass-drop/ui/cards/{cid}.png"],
        downstream=["No matte (full-bleed). Crops: landscape skin ~3:2 (tall card art slot), portrait skin 1:1",
                    "Region card_N_art in bd_ui (ui_intro_cards, ANIMATION_SET §6.1)"],
        fallback="Composite the approved W, badges, emblem and meter over a background crop (0 credits).")

# ---- phase 5: backgrounds
BG_DOWN_L = "Centre-crop 21:9 -> 2:1, Lanczos to 3072x1536 -> art/source/backgrounds/bass-drop/{NAME}.png"
BG_DOWN_P = "Centre-crop the width 9:16 -> 1:2, Lanczos to 1536x3072 -> art/source/backgrounds/bass-drop/{NAME}.png"
row("bd_bg_base_portrait", phase="backgrounds", priority="P0", batch="c06", kind="background", template="background.txt#F",
    what="Base background plate, portrait (reframe of the landscape plate)", rig="bg_portrait", resolution="4k", aspect="9:16",
    refs=[("bg_A_landscape", "layout + palette")], stage="backgrounds",
    source=["art/source/backgrounds/bass-drop/base_portrait.png (1536x3072)"],
    downstream=[BG_DOWN_P.replace("{NAME}", "base_portrait"), "Gates: OCR, darker central column behind the grid (portrait grid 584-1396 of 1920)"],
    fallback="Crop the landscape plate's centre (loses the side neon masses).")
for mode in ("base", "jukejam", "megamix"):
    for orient, aspect in (("landscape", "21:9"), ("portrait", "9:16")):
        base_ref = "bg_A_landscape" if orient == "landscape" else "bd_bg_base_portrait"
        name = f"{mode}_{orient}"
        if mode != "base":
            row(f"bd_bg_{name}", phase="backgrounds", priority="P1", batch="c15", kind="variant", template="background.txt#E",
                what=f"{'Juke Jam (after hours)' if mode == 'jukejam' else 'Mega Mix (party lights)'} variant, {orient}",
                rig=f"bg_fs_{orient}", resolution="4k", aspect=aspect, stage="backgrounds",
                vars=v(VARIANT_NOTE=bd(f"backgrounds.{mode}.variantNote")), refs=[(base_ref, "edit-source")],
                source=[f"art/source/backgrounds/bass-drop/{name}.png"],
                downstream=[(BG_DOWN_L if orient == "landscape" else BG_DOWN_P).replace("{NAME}", name),
                            "layoutMatch: edge-map IoU against the base plate of the same orientation (crossfade must not swim)"],
                fallback="Colour-grade the base plate in code (tint + fog overlay).")
        prio, batch = ("P1", "c15") if mode == "base" else ("P2", "c22")
        src_row = base_ref if mode == "base" else f"bd_bg_{name}"
        row(f"bd_bg_{name}_neon", phase="backgrounds", priority=prio, batch=batch, kind="neon", template="background.txt#C",
            what=f"Neon-only additive layer, {mode} {orient}", rig=f"bg neon layer ({mode})", resolution="4k", aspect=aspect,
            refs=[(src_row, "edit-source")], stage="backgrounds",
            source=[f"art/source/backgrounds/bass-drop/{name}_neon.png"],
            downstream=["Same crop/resize as its plate; black = transparent under additive blend", "layoutMatch against its plate"],
            fallback="Procedural extraction: mask the bright saturated neon hues of the plate (0 credits).")

# ---- phase 6: mascots
for mid, aspect in (("gumbo", "4:5"), ("croak", "2:3")):
    mb = genlib.bible()["bassDrop"]["mascots"][mid]
    key = genlib.bible()["mascots"][mid]["keyHex"].lstrip("#")
    rig = mb["rig"]
    row(f"chr_{mid}_rig_master", phase="mascots", priority="P0", batch="c07", kind="mascot", template="mascot_parts_sheet.txt#A",
        what=f"{genlib.bible()['mascots'][mid]['name']} rig master (Spine setup pose, three-quarter view)", rig=rig, atlas=mb["atlas"],
        mascot=mid, vars=v(CHARACTER=bd(f"mascots.{mid}.character"), FACING=bd(f"mascots.{mid}.facing"),
                           POSE_NOTE=bd(f"mascots.{mid}.poseNote")),
        aspect=aspect, candidates=2, refs=[(f"mascot_{mid}_sheetA", "identity")], stage="mascot-sheets",
        source=[f"art/source/mascots/{mid}/spine2d/rig_master.png"],
        downstream=[f"{M} <raw> art/source/mascots/{mid}/spine2d/rig_master.png --key {key} --no-fit",
                    f"Adult-proportions gate: head bbox <= 0.27 of height; authoring height {mb['authoringHeightUnits']} units at 2x"],
        fallback="Use the design sheet's three-quarter view as the setup pose.")
    for sec, sheet, res, asp, cands in (("B", "body", "4k", "16:9", 2), ("C", "face", "4k", "16:9", 1),
                                        ("D", "hands", "2k", "3:2", 1), ("E", "props", "2k", "3:2", 1)):
        row(f"chr_{mid}_parts_{sheet}", phase="mascots", priority="P0", batch="c08", kind="mascotParts",
            template=f"mascot_parts_sheet.txt#{sec}", what=f"{genlib.bible()['mascots'][mid]['name']} {sheet} parts sheet",
            rig=rig, atlas=mb["atlas"], mascot=mid, vars=v(PART_LIST=join(f"mascots.{mid}.sheets.{sheet}", ", ", "piece")),
            resolution=res, aspect=asp, candidates=cands, stage="mascot-sheets",
            refs=[(f"chr_{mid}_rig_master", "view + scale"), (f"mascot_{mid}_sheetA", "identity")],
            source=[f"art/source/bass-drop/spine/images/{rig}/<slot>[_<attachment>].png", f"art/source/mascots/{mid}/spine2d/parts.json"],
            downstream=[f"{M} <raw> art/_work/chr_{mid}_parts_{sheet}/sheet.png --key {key} --no-fit",
                        f"Cut into pieces; name by bassDrop.mascots.{mid}.sheets.{sheet}[].slot; register each to rig_master.png (ECC/SIFT)",
                        "Hidden overlaps: symbol_parts_sheet.txt#C with Nano Banana 2 masked inpaint (fill reserve)",
                        f"{rig}: Spine Editor, human animator (ANIMATION_SET §11) -> GAME=bass-drop node tools/spine/validate.mjs build/spine/{rig}.json --kind any"],
            fallback="SAM split of the rig master + masked fills for every hidden overlap.")

# ---- P2 extras (funded from what P0/P1 leave; see budget.p2)
row("bd_bg_tile", phase="backgrounds", priority="P2", batch="c21", kind="background", template="background.txt#D",
    what="Bright game-tile plate (ACP Tile Editor)", rig="game tile", resolution="4k", aspect="21:9",
    refs=[("bg_A_landscape", "edit-source")], stage="backgrounds", source=["art/source/tile/bg_tile.png"],
    downstream=["Tile foreground = the finished Spine mascots rendered in celebrate (no generation)"],
    gates=["noText", "paletteDeltaE"], fallback="Brighten the base plate in code.")
row("royal_L1_material", phase="symbols", priority="P2", batch="c21", kind="symbol", template="royal_material_pass.txt",
    what="Material-pass test on the vector Ace (decides whether L1-L5 get one)", rig="sym_L1", atlas="symbols", symbol="L1",
    refs=[("local:art/source/ui/royal_L1.png", "edit-source (upload)")],
    source=["art/source/symbols/L1/material_test.png"],
    downstream=[f"{M} <raw> art/_work/royal_L1_material/raw_rgba.png --key 00FF00 --no-fit",
                "ECC-register onto the vector alpha (PIPELINE 2.2); A/B against the plain vector at 64 px"],
    gates=["readability64", "paletteDeltaE", "outlineHistogram", "halo"],
    fallback="Royals stay plain vector.", notes="Needs a media_upload of our own vector render (the only upload in this plan).")
prop_row("bd_horn_R_master", "horn_R", priority="P2", batch="c21", aspect="1:1", candidates=1,
         refs=[("bd_horn_master", "match")], what="Right horn, light-correct (instead of the mirrored left horn)", direc="env/horn_R",
         fallback="Mirror the left horn (key light reads upper right on that one prop).")
for cid, refs in (("art_jukejam_buy", [("bd_emblem_jukebox", "match"), ("sym_W", "match"), ("bg_A_landscape", "backdrop")]),
                  ("art_megamix_buy", [("bd_emblem_mega_speaker", "match"), ("sym_W_pieces", "match: clamp"), ("bg_A_landscape", "backdrop")])):
    c = genlib.bible()["bassDrop"]["cards"][cid]
    row(f"bd_card_{cid.removeprefix('art_')}", phase="emblems", priority="P2", batch="c21", kind="card", template="card_art.txt",
        what=f"Buy card illustration {cid}", rig=c["rig"], atlas=c["atlas"],
        vars=v(SCENE=bd(f"cards.{cid}.scene"), BACKDROP=bd(f"cards.{cid}.backdrop")), refs=refs,
        source=[f"art/source/bass-drop/ui/cards/{cid}.png"],
        downstream=["No matte; region card_N_art in bd_ui (ui_buy_cards, ANIMATION_SET §6.2)"],
        fallback="Crop the matching intro card art.")
for fx, eff, cols in (("speaker_blast", "cartoon speaker blast: a puff of chunky smoke rings bursting out of a woofer", "plum-grey #4B283D smoke with a cyan #35F2E0 core"),
                      ("wild_impact", "cartoon impact dust crown with flying debris chunks", "plum-grey #6B3A57 dust with gold #FFC629 sparks")):
    row(f"bd_vfx_{fx}", phase="emblems", priority="P2", batch="c22", kind="prop", template="vfx_keyframe.txt",
        what=f"Look-dev key frame for fx_{fx} (reference for the Blender flipbook, not shipped)", rig=f"fx_{fx} (flipbook)",
        atlas="bd_fx", vars=v(EFFECT=eff, PHASE="peak", COLOURS=cols), refs=[("sym_H1", "style")],
        source=[f"art/source/bass-drop/fx/lookdev_{fx}.png"],
        downstream=["Reference only: the shipped flipbook is a Blender toon render (ANIMATION_SET §7.1)"],
        gates=["styleSimilarity", "noText"], fallback="Blender look-dev without an AI key frame.")

RESERVES = [
    {"id": "probe_redo", "priority": "P0", "credits": 12,
     "what": "Redo rejected probe1 images (2 per symbol, 4 per design sheet or plate), e.g. two symbols + two sheets."},
    {"id": "fills_p0", "priority": "P0", "credits": 6, "model": "nano_banana_2", "resolution": "1k", "count": 4,
     "template": "symbol_parts_sheet.txt#C",
     "what": "Hidden-area fills for P0 splits (mascot overlaps the part sheets missed): Nano Banana 2 masked inpaint "
             "(is_inpaint true, medias image_references + mask); one row per fill is recorded when it runs."},
    {"id": "fills_p1", "priority": "P1", "credits": 6, "model": "nano_banana_2", "resolution": "1k", "count": 4,
     "template": "symbol_parts_sheet.txt#C", "what": "Hidden-area fills for P1 splits (symbols, props)."},
]

NOT_GENERATED = [
    {"id": "sym_L1..L5", "what": "Royals A K Q J 10", "how": "Vector glyphs (Lilita One / Titan One) + resvg; light Spine rig (P1). Material pass only if royal_L1_material wins.", "priority": "P1"},
    {"id": "ui_hud", "what": "Hex HUD buttons, spin button", "how": "Existing Swamp Funk vector (Recraft or hand SVG) + resvg.", "priority": "P0"},
    {"id": "ui_plates", "what": "Banner plates, feature plate, next-drop chip, buy/confirm/cancel plates and button states, card backs", "how": "Vector / code Plate; card frames = 9-slice of the frame beam texture + a code neon edge.", "priority": "P0"},
    {"id": "bd_ui_code_regions", "what": "LED ticks + glow arc, orbs, link wave, target reticle, landing shadow, home rim + clamps, lap pips, count pops", "how": "Code-drawn regions in bd_ui (ANIMATION_SET §8).", "priority": "P0"},
    {"id": "recolours", "what": "Meter rim trims (base/jukejam/megamix), notch states, badge tiers t1/t2/t4/t5, drop button down, LEDs on", "how": "Code recolour / transform of the generated art.", "priority": "P0"},
    {"id": "fx_slots", "what": "fx_glow, fx_ring, fx_trail, fx_swirl, fx_burst, fx_rays, fx_shine, fx_puff, button_glow, floor_light, fx_sweat, fx_note", "how": "Code-drawn additive regions (glow is never baked into art).", "priority": "P0"},
    {"id": "flipbooks", "what": "fx_speaker_blast, fx_wild_impact, fx_feature_blast, fx_title_shine", "how": "Blender toon renders (PIPELINE phase 5); live-particle fallbacks at P0. Optional AI look-dev rows bd_vfx_* (P2).", "priority": "P1"},
    {"id": "shards", "what": "H2 disc shards, W explode pieces, royal splinters, jukebox shards", "how": "Seeded Voronoi cut of the approved art (code).", "priority": "P1"},
    {"id": "ui_bigwin_bassdrop", "what": "Big-win skin: vinyl sunburst, flanking speaker cones", "how": "Sunburst from the H2 disc (code); cones reuse bd_meter_parts.", "priority": "P1"},
    {"id": "logo_wordmark", "what": "SWAMP FUNK / BASS DROP word-mark", "how": "Typographer, vector, on the blank banner of bd_logo_emblem; trademark search.", "priority": "P1"},
    {"id": "tile_foreground", "what": "Game-tile mascots", "how": "Render the finished Spine rigs in celebrate at 2048 px.", "priority": "P2"},
    {"id": "bg_parallax", "what": "Back / mid / front layers", "how": "Cut: the runtime pulses only the neon layer.", "priority": "cut"},
]

# --------------------------------------------------------------------------- build


def render_row(r: dict) -> tuple[str, str, dict, dict, dict]:
    name, section = genlib.split_template_ref(r["template"])
    ph = set(genlib.placeholders(name, section))
    overrides = {k: val for k, (val, _) in r["vars"].items()}
    unused = sorted(set(overrides) - ph)
    if unused:
        raise SystemExit(f"{r['id']}: vars {unused} are not placeholders of {r['template']} ({sorted(ph)})")
    vals = genlib.build_values(r["template"], symbol=r["symbol"], mascot=r["mascot"], rig_ready=r["rig_ready"],
                               overrides=overrides)
    text, h = genlib.render(r["template"], vals)
    low = text.lower()
    for t in OWN_TITLES:
        if t in low:
            raise SystemExit(f"{r['id']}: prompt contains the game title '{t}'")
    used = {k: vals[k] for k in sorted(ph)}
    return text, h, overrides, {k: s for k, (_, s) in r["vars"].items() if s}, used


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


def build() -> dict:
    jobs = ledger_jobs()
    ids = [r["id"] for r in ROWS]
    dup = {i for i in ids if ids.count(i) > 1}
    if dup:
        raise SystemExit(f"duplicate row ids {sorted(dup)}")
    batch_order = []  # probe1 first, then each priority's batches by id (c01 < c02 ...)
    for p in PRIORITIES:
        mine = {r["batch"] for r in ROWS if r["priority"] == p} - set(batch_order)
        batch_order += sorted(mine, key=lambda b: (b != "probe1", b))
    for b in batch_order:
        if len({r["priority"] for r in ROWS if r["batch"] == b}) != 1:
            raise SystemExit(f"batch {b} mixes priorities")
    ordered = sorted(ROWS, key=lambda r: (batch_order.index(r["batch"]), ROWS.index(r)))
    assets = []
    for n, r in enumerate(ordered, 1):
        text, h, overrides, vars_from, used = render_row(r)
        per = MODELS[r["model"]]["credits"].get(r["resolution"])
        if per is None:
            raise SystemExit(f"{r['id']}: no price for {r['model']} at {r['resolution']}")
        refs = []
        for ref, role in r["refs"]:
            if ref.startswith("local:"):
                refs.append({"ref": ref, "role": role, "jobId": None, "upload": ref.removeprefix("local:")})
                continue
            if ref not in ids:
                raise SystemExit(f"{r['id']}: reference {ref} is not a plan row")
            probe = next(x for x in ROWS if x["id"] == ref)["probe"]
            refs.append({"ref": ref, "role": role, "jobId": jobs[probe]["job_id"] if probe else None})
        status, job_ids, spent = "planned", [], 0
        if r["probe"]:
            j = jobs[r["probe"]]
            if j["promptHash"] != h:
                raise SystemExit(f"{r['id']}: ledger promptHash {j['promptHash']} != rendered {h} (template or bible drifted)")
            status, job_ids, spent = "probed (awaiting review)", [j["job_id"]], j.get("credits") or 0
        base = 0 if r["probe"] else per * r["candidates"]
        factor = RETRY if r["priority"] in ("P0", "P1") else 1.0
        asset = r["asset"] or (genlib.default_asset(r["template"], r["symbol"], r["mascot"], r["rig_ready"]) if r["probe"] else r["id"])
        key = used.get("KEY_HEX")
        assets.append({
            "order": n, "id": r["id"], "priority": r["priority"], "phase": r["phase"], "batch": r["batch"],
            "what": r["what"], "kind": r["kind"], "rig": r["rig"], "atlas": r["atlas"],
            "template": r["template"], "context": {k: x for k, x in (("symbol", r["symbol"]), ("mascot", r["mascot"]),
                                                                   ("rigReady", r["rig_ready"] or None)) if x},
            "vars": overrides, "varsFrom": vars_from, "keyHex": key,
            "promptHash": h, "render": render_cmd(r), "prompt": text,
            "model": r["model"], "manifestModel": MODELS[r["model"]]["reports"], "resolution": r["resolution"],
            "aspectRatio": r["aspect"], "candidates": 0 if r["probe"] else r["candidates"],
            "credits": {"perImage": per, "base": base, "withRetries": round(base * factor, 2), "spent": spent},
            "refs": refs, "status": status, "jobIds": job_ids, "stage": r["stage"],
            "ledgerVars": ledger_vars(r),
            "outputs": {"raw": f"art/_raw/{asset}/vNN/", "source": r["source"]},
            "downstream": r["downstream"], "gates": r["gates"], "fallback": r["fallback"], "notes": r["notes"],
        })
    by_id = {a["id"]: a for a in assets}
    for a in assets:
        for ref in a["refs"]:
            if ref["ref"] in by_id and by_id[ref["ref"]]["order"] >= a["order"]:
                raise SystemExit(f"{a['id']}: reference {ref['ref']} runs later (order)")
    return {"assets": assets, "budget": budget(assets, batch_order), "batches": batches(assets, batch_order)}


def budget(assets: list[dict], batch_order: list[str]) -> dict:
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
    for b in [b for b in batch_order if any(a["batch"] == b and a["priority"] == "P2" for a in assets)]:
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
    out["reserves"] = RESERVES
    return out


def batches(assets: list[dict], batch_order: list[str]) -> list[dict]:
    out = []
    by_id = {a["id"]: a for a in assets}
    for b in batch_order:
        rows = [a for a in assets if a["batch"] == b]
        deps = sorted({by_id[r["ref"]]["batch"] for a in rows for r in a["refs"] if r["ref"] in by_id} - {b},
                      key=batch_order.index)
        out.append({"id": b, "priority": rows[0]["priority"], "phases": sorted({a["phase"] for a in rows}, key=PHASES.index),
                    "rows": [a["id"] for a in rows], "jobs": sum(a["candidates"] for a in rows),
                    "credits": round(sum(a["credits"]["base"] for a in rows), 2), "needsApproved": deps})
    return out


HEADER = {
    "$comment": "GENERATED by art/plan/build_plan.py from its row table + art/bible/artbible.json -> bassDrop; do not edit by hand (run the script). Human plan: docs/games/bass-drop/ART_PLAN.md. 'render' is the exact tools/gen/genlib.py command that prints each prompt; promptHash is its sha256. Credits are Higgsfield MCP credits (measured 2026-09-26). Nothing here has been generated except the probe1 rows.",
    "game": "bass-drop",
    "planVersion": 1,
    "updated": UPDATED,
    "docs": ["docs/games/bass-drop/ART_PLAN.md", "docs/games/bass-drop/DESIGN.md", "docs/games/bass-drop/ANIMATION_SET.md",
             "docs/ART_BIBLE.md", "art/bible/prompts/README.md"],
    "route": {
        "route": ROUTE, "vendor": "Higgsfield", "licenseId": "higgsfield", "clearance": "pending (build and preview only; nothing ships)",
        "call": "generate_image_batch {requests:[{index, params:{model, prompt, aspect_ratio, resolution, medias:[{value: <approved job_id>, role: 'image_references'}]}}]}; one job per candidate. Always pass model explicitly (the MCP's default image model is denylisted).",
        "never": ["gpt_image_2", "gpt_image_2_5", "openai_hazel", "any OpenAI model (licenses/denylist.json openai-gpt-image)"],
        "noSeedNoNegative": True,
        "manifest": "route higgsfield-mcp, vendor Higgsfield, model = the id the job reports (nano_banana_2 for Nano Banana Pro), seed null, jobId, promptPath, promptHash, refHashes",
        "specs": "python3 art/plan/build_plan.py spec --batch <id> > art/_work/hf-plans/bd_<id>.spec.json; pnpm gen:hf-ingest plan --spec art/_work/hf-plans/bd_<id>.spec.json",
    },
    "models": MODELS,
    "styleAnchors": [a for a, _ in ANCHORS] + ["bg_A_landscape (backgrounds)", "mascot_*_sheetA (mascots)"],
    "phases": PHASES,
}


def plan_doc() -> dict:
    b = build()
    doc = dict(HEADER)
    doc["budget"] = b["budget"]
    doc["batches"] = b["batches"]
    doc["assets"] = b["assets"]
    doc["notGenerated"] = NOT_GENERATED
    return doc


def dumps(doc: dict) -> str:
    return json.dumps(doc, indent=2, ensure_ascii=False) + "\n"


# --------------------------------------------------------------------------- CLI


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
            if "upload" in ref:
                val = approved.get(ref["ref"], {}).get("media_id")
            else:
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
    print(f"  P2: {p2['total']} planned; funded {p2['funded']}, unfunded {p2['unfunded']}; unallocated after all: {bud['unallocated']}")
    for b in doc["batches"]:
        print(f"  {b['id']:4s} {b['priority']} {b['jobs']:>2} jobs {b['credits']:>5} cr  needs {','.join(b['needsApproved']) or '-':12s} {' '.join(b['rows'])}")
    return 0


def cmd_table(doc: dict) -> int:
    print("| # | Asset | What | Template | Model · res · aspect | Cand. | References | Pri. | Credits (base → w/ retries) | Rig / atlas |")
    print("|---|---|---|---|---|---|---|---|---|---|")
    for a in doc["assets"]:
        model = {"nano_banana_pro": "NBP", "nano_banana_2": "NB2"}[a["model"]]
        refs = ", ".join(f"`{r['ref']}`" for r in a["refs"]) or "none"
        if a["jobIds"]:
            cred = f"{a['credits']['spent']} spent"
        else:
            cred = f"{a['credits']['base']:g} → {a['credits']['withRetries']:g}"
        print(f"| {a['order']} | `{a['id']}` | {a['what']} | `{a['template']}` | {model} · {a['resolution']} · {a['aspectRatio']} | "
              f"{a['candidates'] or '–'} | {refs} | {a['priority']} | {cred} | {a['rig']} / {a['atlas'] or '–'} |")
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cmd", nargs="?", default="write", choices=["write", "summary", "table", "spec"])
    ap.add_argument("--check", action="store_true", help="write: fail (exit 1) when art/plan/bass-drop.json is stale")
    ap.add_argument("--batch", help="spec: batch id (see 'summary')")
    ap.add_argument("--approvals", default=str(APPROVALS_PATH), help="spec: approved job ids per plan row")
    ap.add_argument("--allow-unapproved", action="store_true", help="spec: emit UNAPPROVED:<id> placeholders (review only)")
    a = ap.parse_args(argv)
    doc = plan_doc()
    if a.cmd == "summary":
        return cmd_summary(doc)
    if a.cmd == "table":
        return cmd_table(doc)
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
        print(f"{PLAN_PATH.relative_to(REPO)} is up to date ({len(doc['assets'])} rows)")
        return 0
    PLAN_PATH.write_text(text, encoding="utf-8")
    print(f"wrote {PLAN_PATH.relative_to(REPO)}: {len(doc['assets'])} rows")
    return 0


if __name__ == "__main__":
    sys.exit(main())
