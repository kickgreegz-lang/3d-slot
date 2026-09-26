#!/usr/bin/env bash
# End-to-end AI 2D CHARACTER pipeline on the two Bass Drop mascots, procedural placeholder parts,
# no Spine editor:
#   make_parts.mjs -> gen.py (kind: character) -> validate.mjs (synthetic atlas) -> pack.py
#   -> validate.mjs --atlas (one page) -> [capture.mjs contact sheets on spine-pixi-v8]
#
#   tools/spine/examples/character_demo/build.sh [--build-dir DIR] [--only gumbo|croak] [--no-parts]
#                                                [--capture DIR] [--scenarios idle,bass_drop,fs_trigger|all]
#                                                [--strict] [--help]
#
# Output: <build-dir>/chr_<id>.{json,atlas,png}, validate_<id>.json, provenance.json
# (default build dir: build/spine/character_demo). Nothing is published: the game loads the
# production rigs from public/assets/bass-drop/spine/ (ANIMATION_SET 0) once real parts exist.
# Env: PYTHON = python with tools/requirements-spine.txt installed (default: python3).
# Every gate must pass (set -e + validator exit codes); --strict also fails on validator warnings.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../../.." && pwd)"
PY="${PYTHON:-python3}"
export PYTHONDONTWRITEBYTECODE=1
BUILD="$REPO/build/spine/character_demo"
CAPTURE=""
SCENARIOS="idle,bass_drop,fs_trigger"
ONLY=""
PARTS=1
STRICT=""

usage() { sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; }
abspath() { node -e 'console.log(require("path").resolve(process.argv[1]))' "$1"; }
need_val() { [ $# -ge 2 ] && [ -n "$2" ] || { echo "build.sh: $1 needs a value" >&2; exit 2; }; }
while [ $# -gt 0 ]; do
  case "$1" in
    --build-dir) need_val "$@"; BUILD="$(abspath "$2")"; shift 2 ;;
    --only) need_val "$@"; ONLY="$2"; shift 2 ;;
    --no-parts) PARTS=0; shift ;;
    --capture) need_val "$@"; CAPTURE="$(abspath "$2")"; shift 2 ;;
    --scenarios) need_val "$@"; SCENARIOS="$2"; shift 2 ;;
    --strict) STRICT="--strict"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "build.sh: unknown argument $1" >&2; usage >&2; exit 2 ;;
  esac
done

cd "$REPO"
mkdir -p "$BUILD"
CHARS="gumbo croak"
[ -n "$ONLY" ] && CHARS="$ONLY"
if [ "$PARTS" = 1 ]; then
  echo "== 1/5 placeholder parts (resvg-js)"
  if [ -n "$ONLY" ]; then node "$HERE/make_parts.mjs" --only "$ONLY"; else node "$HERE/make_parts.mjs"; fi
fi
for c in $CHARS; do
  S="chr_$c"
  echo "== 2/5 $S: generate (rig.yaml + parts.json -> Spine 4.3 JSON)"
  "$PY" tools/spine/gen.py "$HERE/$c/rig.yaml" -o "$BUILD/$S.json" --provenance "$BUILD/provenance.json"
  echo "== 3/5 $S: validate (kind character, synthetic atlas)"
  node tools/spine/validate.mjs "$BUILD/$S.json" --kind character --report "$BUILD/validate_$c.json" $STRICT
  echo "== 4/5 $S: pack atlas (PMA, one page) + validate against it"
  "$PY" tools/spine/pack.py --images "$HERE/$c/images" --skeleton "$BUILD/$S.json" --out "$BUILD" --name "$S" \
    --provenance "$BUILD/provenance.json"
  node tools/spine/validate.mjs "$BUILD/$S.json" --kind character --atlas "$BUILD/$S.atlas" --quiet $STRICT
  if [ -n "$CAPTURE" ]; then
    echo "== 5/5 $S: contact sheets on spine-pixi-v8 ($SCENARIOS)"
    node tools/spine/preview/capture.mjs --skel "$BUILD/$S.json" --atlas "$BUILD/$S.atlas" --out "$CAPTURE/$c" \
      --scenarios "$SCENARIOS" --size 560 --tile 190
  fi
done
echo "character demo build OK -> ${BUILD#"$REPO"/}"
