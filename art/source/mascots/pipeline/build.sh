#!/usr/bin/env bash
# Bass Drop 2D mascots, end to end on the real formula-D parts (no Spine licence, no network):
#   art/source/mascots/pipeline/build.sh <gumbo|croak> [--cut] [--capture DIR] [--scenarios a,b|all] [--publish]
#
#   --cut      re-cut the parts from the approved rig master (mastercut.py <id>/spine2d/cut.yaml)
#   1. tools/spine/gen.py (kind: character) -> build/spine/mascots/chr_<id>.json
#   2. gumbo: jawsync.py (mouth interior follows the jaw angle)
#   3. tools/spine/validate.mjs --kind character (exit 0 required)
#   4. tools/spine/pack.py (one PMA page) -> validate.mjs --atlas
#   --capture  tools/spine/preview/capture.mjs contact sheets (spine-pixi-v8) into DIR/<id>/
#   --publish  copy the runtime set (json + atlas + page png) to art/source/mascots/<id>/spine/
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../../.." && pwd)"
PY="${PYTHON:-$REPO/tools/.venv/bin/python}"
export PYTHONDONTWRITEBYTECODE=1
ID="${1:?usage: build.sh <gumbo|croak> [--cut] [--capture DIR] [--scenarios list] [--publish]}"; shift
CUT=0; CAP=""; SCEN="all"; PUB=0
while [ $# -gt 0 ]; do
  case "$1" in
    --cut) CUT=1 ;;
    --capture) CAP="$2"; shift ;;
    --scenarios) SCEN="$2"; shift ;;
    --publish) PUB=1 ;;
    *) echo "build.sh: unknown argument $1" >&2; exit 2 ;;
  esac
  shift
done
cd "$REPO"
SK="chr_$ID"
SRC="art/source/mascots/$ID/spine2d"
OUT=build/spine/mascots
QA="build/qa/$SK"
mkdir -p "$OUT" "$QA"
if [ "$CUT" = 1 ]; then
  echo "== cut: $SRC/cut.yaml"
  "$PY" "$HERE/mastercut.py" "$SRC/cut.yaml" > "$QA/cut.log"
  python3 -c "import json;r=json.load(open('$QA/cut/report.json'))['reassembly'];print('   reassembly ssim',r['ssim'],'IoU',r['alphaIoU'],'passed',r['passed'])"
fi
echo "== gen: $SK"
"$PY" tools/spine/gen.py "$SRC/rig.yaml" -o "$OUT/$SK.json" > "$QA/gen.log"
grep -E "bones|warning" "$QA/gen.log" || true
if [ "$ID" = gumbo ]; then
  "$PY" "$HERE/jawsync.py" "$OUT/$SK.json" --bone jaw --slot mouth --open-sign -1 \
    --map closed_pick:3.5,grin:9.5,open:18.5,roar:999 > "$QA/jawsync.log"
fi
echo "== validate (kind character)"
node tools/spine/validate.mjs "$OUT/$SK.json" --kind character --report "$QA/validate.json" > "$QA/validate.log" \
  || { cat "$QA/validate.log"; exit 1; }
grep -E "WARN|ERROR|PASS|FAIL" "$QA/validate.log" || true
echo "== pack"
"$PY" tools/spine/pack.py --images "$SRC/images" --skeleton "$OUT/$SK.json" --out "$OUT" --name "$SK"
node tools/spine/validate.mjs "$OUT/$SK.json" --kind character --atlas "$OUT/$SK.atlas" --quiet
if [ -n "$CAP" ]; then
  echo "== capture ($SCEN)"
  node tools/spine/preview/capture.mjs --skel "$OUT/$SK.json" --atlas "$OUT/$SK.atlas" --out "$CAP/$ID" \
    --scenarios "$SCEN" --size 560 --tile 190
fi
if [ "$PUB" = 1 ]; then
  DST="art/source/mascots/$ID/spine"
  mkdir -p "$DST"
  cp "$OUT/$SK.json" "$OUT/$SK.atlas" "$DST/"
  for f in "$OUT"/"$SK"*.png; do cp "$f" "$DST/"; done
  ls -la "$DST"
fi
echo "build.sh: $SK ok"
