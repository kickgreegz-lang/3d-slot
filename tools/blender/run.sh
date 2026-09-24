#!/usr/bin/env bash
# run.sh — run a tools/blender script with whichever Blender is available.
#
#   tools/blender/run.sh render_symbol --glyph K --clip turn
#   BLENDER=/opt/blender-5.2.2/blender tools/blender/run.sh turntable cand.glb --out art/_work/tt
#
# $BLENDER set  -> "$BLENDER" -b --factory-startup --python-exit-code 1 -P <script> -- <args>
# otherwise     -> "${BPY_PYTHON:-python3}" <script> <args>   (bpy 5.2.2 as a module)
# Exit code is the script's (0 ok, 1 error, 2 usage, 3 QA/budget gate failure).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ $# -lt 1 ] || [ "$1" = "-h" ] || [ "$1" = "--help" ]; then
  sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'
  echo "scripts: $(cd "$HERE" && ls *.py | sed 's/\.py$//' | tr '\n' ' ')"
  exit 0
fi
S="$1"; shift
case "$S" in
  */*) ;;
  *.py) S="$HERE/$S" ;;
  *) S="$HERE/$S.py" ;;
esac
[ -f "$S" ] || { echo "ERROR: no such script: $S" >&2; exit 1; }
if [ -n "${BLENDER:-}" ]; then
  exec "$BLENDER" -b --factory-startup --python-exit-code 1 -P "$S" -- "$@"
fi
PY="${BPY_PYTHON:-python3}"
if ! "$PY" -c "import bpy" >/dev/null 2>&1; then
  echo "ERROR: $PY cannot import bpy. Set BLENDER=/path/to/blender or BPY_PYTHON=<venv>/bin/python" >&2
  echo "       (pip install -r tools/blender/requirements.txt into a Python 3.13 venv)" >&2
  exit 1
fi
exec "$PY" "$S" "$@"
