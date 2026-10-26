#!/usr/bin/env bash
# MONTY (chr_monty, Magpie Heist mascot), end to end on the approved art (no Spine licence, no network).
# A thin copy of art/source/mascots/pipeline/build.sh (Bass Drop) for the Magpie Heist paths:
#   tools/mhart/mascot/build.sh [--cut] [--capture DIR] [--scenarios a,b|all] [--publish] [--ship]
#
#   --cut      re-cut the parts from the approved master (tools/mhart/mascot/cut.py: hands.py + mastercut)
#   1. tools/spine/gen.py (kind: character) -> build/spine/mascots/chr_monty.json
#   2. tools/spine/validate.mjs --kind character --strict (exit 0, 0 warnings required)
#   3. tools/spine/pack.py (one PMA page, @1x + @0.5x) -> validate.mjs --atlas --strict
#   --capture  tools/spine/preview/capture.mjs contact sheets (spine-pixi-v8) into DIR/monty/
#   --publish  copy the runtime set (json + atlases + pages) to art/source/magpie-heist/mascot/spine/
#              and write the provenance rows of the sources (tools/mhart/mascot/prov_monty.py)
#   --ship     tools/mhart/mascot/ship_monty.py: public/assets/magpie-heist/mascot/chr_monty{,_half}.*
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
PY="${PYTHON:-$REPO/tools/.venv/bin/python}"
export PYTHONDONTWRITEBYTECODE=1
CUT=0; CAP=""; SCEN="all"; PUB=0; SHIP=0
while [ $# -gt 0 ]; do
  case "$1" in
    --cut) CUT=1 ;;
    --capture) CAP="$2"; shift ;;
    --scenarios) SCEN="$2"; shift ;;
    --publish) PUB=1 ;;
    --ship) SHIP=1 ;;
    *) echo "build.sh: unknown argument $1" >&2; exit 2 ;;
  esac
  shift
done
cd "$REPO"
SK=chr_monty
SRC=art/source/magpie-heist/mascot/spine2d
OUT=build/spine/mascots
QA="build/qa/$SK"
mkdir -p "$OUT" "$QA"
if [ "$CUT" = 1 ]; then
  echo "== cut: $SRC/cut.yaml"
  "$PY" "$HERE/cut.py" "$SRC/cut.yaml" > "$QA/cut.log"
  python3 -c "import json;r=json.load(open('$QA/cut/report.json'))['reassembly'];print('   reassembly ssim',r['ssim'],'IoU',r['alphaIoU'],'passed',r['passed'])"
fi
echo "== gen: $SK"
"$PY" tools/spine/gen.py "$SRC/rig.yaml" -o "$OUT/$SK.json" > "$QA/gen.log"
grep -E "bones|warning" "$QA/gen.log" || true
echo "== validate (kind character, strict)"
node tools/spine/validate.mjs "$OUT/$SK.json" --kind character --strict --report "$QA/validate.json" > "$QA/validate.log" \
  || { cat "$QA/validate.log"; exit 1; }
grep -E "WARN|ERROR|PASS|FAIL" "$QA/validate.log" || true
echo "== pack"
"$PY" tools/spine/pack.py --images "$SRC/images" --skeleton "$OUT/$SK.json" --out "$OUT" --name "$SK" --scale 1 --scale 0.5
node tools/spine/validate.mjs "$OUT/$SK.json" --kind character --strict --atlas "$OUT/$SK.atlas" --quiet
if [ -n "$CAP" ]; then
  echo "== capture ($SCEN)"
  node tools/spine/preview/capture.mjs --skel "$OUT/$SK.json" --atlas "$OUT/$SK.atlas" --out "$CAP/monty" \
    --scenarios "$SCEN" --size 724 --tile 220
fi
if [ "$PUB" = 1 ]; then
  DST=art/source/magpie-heist/mascot/spine
  mkdir -p "$DST"
  cp "$OUT/$SK.json" "$OUT/$SK"*.atlas "$DST/"
  for f in "$OUT"/"$SK"*.png; do cp "$f" "$DST/"; done
  ls -la "$DST"
  "$PY" "$HERE/prov_monty.py"
fi
if [ "$SHIP" = 1 ]; then
  "$PY" "$HERE/ship_monty.py"
fi
echo "build.sh: $SK ok"
