#!/usr/bin/env bash
# Bass Drop env rigs (ANIMATION_SET 4), end to end, no Spine licence and no network:
#   tools/bdart/build_env.sh speaker_stack [--cut] [--capture <dir>]
# 1. --cut: re-make the parts (tools/bdart/env_<id>.py)
# 2. envgen.py (bdgen.py + the CR-8 env budgets) -> build/spine/bd/env_<id>.json
# 3. validate.mjs --kind env --strict; check_env.py (the ANIMATION_SET 4 table)
# 4. pack.py -> build/spine/bd/env_<id>.{atlas,png}; validate.mjs --atlas --strict
# 5. --capture: capture_env.mjs contact sheets on spine-pixi-v8
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
PY="${PYTHON:-$REPO/tools/.venv/bin/python}"
export PYTHONDONTWRITEBYTECODE=1
ID="${1:?usage: build_env.sh <speaker_stack> [--cut] [--capture dir]}"; shift
CUT=0; CAP=""
while [ $# -gt 0 ]; do
  case "$1" in
    --cut) CUT=1 ;;
    --capture) CAP="$2"; shift ;;
    *) echo "build_env.sh: unknown argument $1" >&2; exit 2 ;;
  esac
  shift
done
cd "$REPO"
SK="env_$ID"; SRC="art/source/env/$ID"; OUT=build/spine/bd; QA="build/qa/rigs/$SK"
mkdir -p "$OUT" "$QA"
[ "$CUT" = 1 ] && (cd "$HERE" && "$PY" "env_$ID.py")
"$PY" "$HERE/envgen.py" "$SRC/rig.yaml" -o "$OUT/$SK.json" --quiet
GAME=bass-drop node tools/spine/validate.mjs "$OUT/$SK.json" --kind env --strict --report "$QA/validate.json" --quiet \
  || { echo "build_env.sh: validate.mjs --strict failed for $SK" >&2; exit 1; }
"$PY" "$HERE/check_env.py" "$OUT/$SK.json" --report "$QA/check_env.json"
"$PY" tools/spine/pack.py --images art/source/env/spine/images --skeleton "$OUT/$SK.json" --out "$OUT" --name "$SK" --quiet
GAME=bass-drop node tools/spine/validate.mjs "$OUT/$SK.json" --kind env --atlas "$OUT/$SK.atlas" --strict --quiet
echo "build_env.sh: $SK ok -> $OUT/$SK.{json,atlas,png}"
[ -n "$CAP" ] && node "$HERE/capture_env.mjs" --skel "$OUT/$SK.json" --atlas "$OUT/$SK.atlas" --out "$CAP"
exit 0
