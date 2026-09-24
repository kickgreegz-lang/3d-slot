#!/usr/bin/env bash
# All tools/spine tests (no Spine licence, no API keys, no network):
#   PYTHON=<python with tools/requirements-spine.txt> tools/spine/test/run.sh [--capture]
# 1. python unit tests (curves, physics, generator, packer)   2. demo chain gen -> validate -> pack -> validate(atlas)
# 3. validator negative tests                                  4. export.sh argument tests (fake Spine)
# 5. --capture: Playwright render of the demo on spine-pixi-v8 (headless Chromium, ~20 s)
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
PY="${PYTHON:-python3}"
export PYTHONDONTWRITEBYTECODE=1
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
cd "$REPO"
echo "== unit tests"
"$PY" tools/spine/test/test_spinegen.py 2>&1 | tail -3
echo "== demo chain (build dir $TMP)"
"$PY" tools/spine/gen.py tools/spine/examples/demo_symbol/rig.yaml -o "$TMP/sym_demo.json" --quiet
node tools/spine/validate.mjs "$TMP/sym_demo.json" --quiet
"$PY" tools/spine/pack.py --images tools/spine/examples/demo_symbol/images --skeleton "$TMP/sym_demo.json" --out "$TMP" --name sym_demo --quiet
node tools/spine/validate.mjs "$TMP/sym_demo.json" --atlas "$TMP/sym_demo.atlas" --quiet
if [ -f public/assets/spine/demo/sym_demo.json ]; then
  node tools/spine/validate.mjs public/assets/spine/demo/sym_demo.json --atlas public/assets/spine/demo/sym_demo.atlas --quiet
  echo "published demo validates"
fi
echo "== validator negative tests"
node tools/spine/test/validate.test.mjs "$TMP/sym_demo.json" | tail -1
echo "== export.sh tests"
tools/spine/test/export.test.sh | tail -1
if [ "${1:-}" = "--capture" ]; then
  echo "== capture on spine-pixi-v8"
  node tools/spine/preview/capture.mjs --skel "$TMP/sym_demo.json" --atlas "$TMP/sym_demo.atlas" --out "$TMP/capture" --scenarios land,explode
fi
echo "tools/spine: all tests passed"
