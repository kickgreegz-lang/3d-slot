#!/usr/bin/env bash
# Bass Drop Spine rigs, end to end (no Spine licence, no network):
#   tools/spine/examples/bass_drop/build.sh <H1|H2|H3|H4|W|meter> [--cut] [--capture <dir>] [--scenarios a,b] [--provenance]
# 1. --cut: re-cut the parts from the approved masters (cut/cut_<ID>.py) and make the _blur variants
# 2. bdgen.py (stock tools/spine generator + bassdrop.yaml) -> build/spine/bd/<skeleton>.json
# 3. tools/spine/validate.mjs (stock contract gate; specials use --cell per tools/spine/README "Headroom")
# 4. check_bd.mjs (ANIMATION_SET 2 / 3 / 10 / 12 rules: CR-8 clips, exact clip lengths and event frames, budgets)
# 5. tools/spine/pack.py -> build/spine/bd/<skeleton>.atlas/.png, validate.mjs --atlas
# 6. --capture: capture_bd.mjs contact sheets on spine-pixi-v8
# --provenance: append generator / packer rows to art/manifest.json.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../../.." && pwd)"
PY="${PYTHON:-$REPO/tools/.venv/bin/python}"
export PYTHONDONTWRITEBYTECODE=1
ID="${1:?usage: build.sh <H1|H2|H3|H4|W|meter> [--cut] [--capture dir] [--scenarios list] [--provenance]}"; shift
CUT=0; CAP=""; SCEN="all"; PROV=0
while [ $# -gt 0 ]; do
  case "$1" in
    --cut) CUT=1 ;;
    --capture) CAP="$2"; shift ;;
    --scenarios) SCEN="$2"; shift ;;
    --provenance) PROV=1 ;;
    *) echo "build.sh: unknown argument $1" >&2; exit 2 ;;
  esac
  shift
done
cd "$REPO"
if [ "$ID" = meter ]; then
  SK=ui_groove_meter; SRC=art/source/ui/meter; KINDV=any; CELL=(); CHK=(--kind ui)
else
  SK="sym_$ID"; SRC="art/source/symbols/$ID"; KINDV=high; CELL=(); CHK=()
  [ "$ID" = W ] && { KINDV=special; CELL=(--cell 368); }
fi
OUT=build/spine/bd
mkdir -p "$OUT"
if [ "$CUT" = 1 ]; then
  "$PY" "$HERE/cut/cut_$ID.py"
  BLUR="$(python3 -c "import json,sys; d=json.load(open('$SRC/parts.json')); print(','.join(d.get('\$blur', [])))")"
  [ -n "$BLUR" ] && "$PY" tools/spine/make_blur.py "$SRC/parts.json" --only "$BLUR" >/dev/null
fi
PROVARGS=(); [ "$PROV" = 1 ] && PROVARGS=(--manifest art/manifest.json)
"$PY" "$HERE/bdgen.py" "$SRC/rig.yaml" -o "$OUT/$SK.json" --quiet "${PROVARGS[@]}"
GAME=bass-drop node tools/spine/validate.mjs "$OUT/$SK.json" --kind "$KINDV" "${CELL[@]}" --report "build/qa/rigs/$SK/validate.json" --quiet \
  || { echo "build.sh: validate.mjs failed for $SK" >&2; [ "$ID" = meter ] || exit 1; }
node "$HERE/check_bd.mjs" "$OUT/$SK.json" "${CHK[@]}" --report "build/qa/rigs/$SK/check_bd.json" --quiet
"$PY" tools/spine/pack.py --images art/source/spine/images --skeleton "$OUT/$SK.json" --out "$OUT" --name "$SK" --quiet "${PROVARGS[@]}"
GAME=bass-drop node tools/spine/validate.mjs "$OUT/$SK.json" --kind "$KINDV" "${CELL[@]}" --atlas "$OUT/$SK.atlas" --quiet \
  || { [ "$ID" = meter ] || exit 1; }
echo "build.sh: $SK ok -> $OUT/$SK.{json,atlas,png}"
if [ -n "$CAP" ]; then
  node "$HERE/capture_bd.mjs" --skel "$OUT/$SK.json" --atlas "$OUT/$SK.atlas" --out "$CAP" --scenarios "$SCEN"
fi
