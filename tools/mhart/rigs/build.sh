#!/usr/bin/env bash
# Magpie Heist Spine symbol rigs, end to end (no Spine licence, no network):
#   tools/mhart/rigs/build.sh <ID> [--cut] [--capture <dir>] [--scenarios a,b] [--ship] [--provenance]
# 1. --cut: re-cut the parts from the approved master (cut_<ID>.py) and make the _blur variants (make_blur.py)
# 2. mhgen.py (stock tools/spine generator + bdgen clip layer + heist.yaml) -> build/spine/mh/sym_<ID>.json
# 3. tools/spine/validate.mjs --strict, GAME=magpie-heist, kind / cell from heist.yaml (`validate_kind`, `cell`)
# 4. tools/spine/pack.py -> build/spine/mh/sym_<ID>.atlas/.png (PMA), validate.mjs --atlas --strict
# 5. --capture: capture_mh.mjs contact sheets of every clip on spine-pixi-v8
# 6. --ship: ship_rig.py (part-image rows, the ship-ready rig trio, the board sprites = the setup pose rendered on
#    the 360 @2x canvas + _blur/_glow, provenance rows, ship-spec items) then tools/licence/ship.py
# --provenance: append the generator / packer rows to art/manifest.json (build outputs; --ship writes its own rows).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
PY="${PYTHON:-$REPO/tools/.venv/bin/python}"
export PYTHONDONTWRITEBYTECODE=1
ID="${1:?usage: build.sh <ID> [--cut] [--capture dir] [--scenarios list] [--ship] [--provenance]}"; shift
CUT=0; CAP=""; SCEN="all"; PROV=0; SHIP=0
while [ $# -gt 0 ]; do
  case "$1" in
    --cut) CUT=1 ;;
    --capture) CAP="$2"; shift ;;
    --scenarios) SCEN="$2"; shift ;;
    --provenance) PROV=1 ;;
    --ship) SHIP=1 ;;
    *) echo "build.sh: unknown argument $1" >&2; exit 2 ;;
  esac
  shift
done
cd "$REPO"
SK="sym_$ID"; SRC="art/source/magpie-heist/symbols/$ID"; OUT=build/spine/mh; QA="build/qa/rigs/mh_$SK"
[ -f "$SRC/rig.yaml" ] || { echo "build.sh: $SRC/rig.yaml missing" >&2; exit 2; }
mkdir -p "$OUT" "$QA"
if [ "$CUT" = 1 ]; then
  "$PY" "$HERE/cut_$ID.py"
  BLUR="$(python3 -c "import json; d=json.load(open('$SRC/parts.json')); print(','.join(d.get('\$blur', [])))")"
  [ -n "$BLUR" ] && "$PY" tools/spine/make_blur.py "$SRC/parts.json" --only "$BLUR" >/dev/null
fi
read -r KINDV CELL <<<"$("$PY" "$HERE/mhgen.py" "$SRC/rig.yaml" --config)"
PROVARGS=(); [ "$PROV" = 1 ] && PROVARGS=(--manifest art/manifest.json)
"$PY" "$HERE/mhgen.py" "$SRC/rig.yaml" -o "$OUT/$SK.json" --quiet "${PROVARGS[@]}"
GAME=magpie-heist node tools/spine/validate.mjs "$OUT/$SK.json" --kind "$KINDV" --cell "$CELL" --strict --report "$QA/validate.json" --quiet \
  || { echo "build.sh: validate.mjs --strict failed for $SK" >&2; exit 1; }
"$PY" tools/spine/pack.py --images art/source/magpie-heist/spine/images --skeleton "$OUT/$SK.json" --out "$OUT" --name "$SK" --quiet "${PROVARGS[@]}"
GAME=magpie-heist node tools/spine/validate.mjs "$OUT/$SK.json" --kind "$KINDV" --cell "$CELL" --atlas "$OUT/$SK.atlas" --strict --quiet
echo "build.sh: $SK ok (validate --kind $KINDV --cell $CELL --strict) -> $OUT/$SK.{json,atlas,png}"
if [ -n "$CAP" ]; then
  node "$HERE/capture_mh.mjs" --skel "$OUT/$SK.json" --atlas "$OUT/$SK.atlas" --out "$CAP" --scenarios "$SCEN"
fi
if [ "$SHIP" = 1 ]; then
  "$PY" "$HERE/ship_rig.py" "$ID"
  "$PY" tools/licence/ship.py tools/licence/ship/magpie_heist.json
fi
