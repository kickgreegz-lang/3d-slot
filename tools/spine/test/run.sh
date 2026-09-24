#!/usr/bin/env bash
# All tools/spine tests (no Spine licence, no API keys, no network):
#   PYTHON=<python with tools/requirements-spine.txt> tools/spine/test/run.sh [--capture]
# 1. python unit tests (curves, physics, generator, packer)   2. demo chain gen -> validate -> pack -> validate(atlas)
# 3. validator negative tests                                  4. export.sh argument tests (fake Spine)
# 5. --capture: Playwright render of the demo on spine-pixi-v8 (headless Chromium, ~20 s)
set -euo pipefail
CAPTURE=0
for arg in "$@"; do
  case "$arg" in
    -h|--help) sed -n '2,6p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    --capture) CAPTURE=1 ;;
    *) echo "run.sh: unknown argument $arg (see --help)" >&2; exit 2 ;;
  esac
done
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
PY="${PYTHON:-python3}"
export PYTHONDONTWRITEBYTECODE=1
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
cd "$REPO"
echo "== unit tests"
# show only the summary on success, everything on failure
quiet_run() { local out; if out="$("$@" 2>&1)"; then echo "$out" | tail -"$TAIL"; else echo "$out"; return 1; fi; }
TAIL=3 quiet_run "$PY" tools/spine/test/test_spinegen.py
echo "== demo chain (build dir $TMP)"
"$PY" tools/spine/gen.py tools/spine/examples/demo_symbol/rig.yaml -o "$TMP/sym_demo.json" --quiet
node tools/spine/validate.mjs "$TMP/sym_demo.json" --quiet
"$PY" tools/spine/pack.py --images tools/spine/examples/demo_symbol/images --skeleton "$TMP/sym_demo.json" --out "$TMP" --name sym_demo --quiet
node tools/spine/validate.mjs "$TMP/sym_demo.json" --atlas "$TMP/sym_demo.atlas" --quiet
if [ -f public/assets/spine/demo/sym_demo.json ]; then
  node tools/spine/validate.mjs public/assets/spine/demo/sym_demo.json --atlas public/assets/spine/demo/sym_demo.atlas --quiet
  # drift: the committed demo must be exactly what the committed generator/packer produce (build.sh publish)
  "$PY" tools/spine/gen.py tools/spine/examples/demo_symbol/rig.yaml -o public/assets/spine/demo/sym_demo.json \
    --images-path ../../../../tools/spine/examples/demo_symbol/images/ --check --quiet
  "$PY" tools/spine/pack.py --images tools/spine/examples/demo_symbol/images --skeleton public/assets/spine/demo/sym_demo.json \
    --out public/assets/spine/demo --name sym_demo --check --quiet
  echo "published demo validates and is up to date"
fi
echo "== validator negative tests"
TAIL=1 quiet_run node tools/spine/test/validate.test.mjs "$TMP/sym_demo.json"
echo "== export.sh tests"
TAIL=1 quiet_run tools/spine/test/export.test.sh
if [ "$CAPTURE" = 1 ]; then
  echo "== capture on spine-pixi-v8"
  node tools/spine/preview/capture.mjs --skel "$TMP/sym_demo.json" --atlas "$TMP/sym_demo.atlas" --out "$TMP/capture" --scenarios land,explode
fi
echo "tools/spine: all tests passed"
