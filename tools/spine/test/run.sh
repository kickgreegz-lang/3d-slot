#!/usr/bin/env bash
# All tools/spine tests (no Spine licence, no API keys, no network):
#   PYTHON=<python with tools/requirements-spine.txt> tools/spine/test/run.sh [--capture]
# 1. python unit tests (curves, physics, generator, packer, characters)   2. demo chain gen -> validate -> pack -> validate(atlas)
# 3. validator negative tests (symbols + characters)                      4. export.sh argument tests (fake Spine)
# 5. character demo chain (both mascots): parts drift, gen -> validate --kind character -> pack -> validate(atlas)
# 6. --capture: Playwright render of the demos on spine-pixi-v8 (headless Chromium, ~60 s)
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
TAIL=3 quiet_run "$PY" tools/spine/test/test_character.py
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
echo "== character demo chain (chr_gumbo, chr_croak)"
CD=tools/spine/examples/character_demo
# drift: the committed placeholder parts are exactly what make_parts.mjs renders
node "$CD/make_parts.mjs" --out "$TMP/parts" >/dev/null
for c in gumbo croak; do
  cmp -s "$CD/$c/parts.json" "$TMP/parts/$c/parts.json" || { echo "drift: $CD/$c/parts.json is not what make_parts.mjs writes" >&2; exit 1; }
  diff -rq "$CD/$c/images" "$TMP/parts/$c/images" >/dev/null || { echo "drift: $CD/$c/images differ from make_parts.mjs output" >&2; exit 1; }
  "$PY" tools/spine/gen.py "$CD/$c/rig.yaml" -o "$TMP/chr_$c.json" --quiet
  node tools/spine/validate.mjs "$TMP/chr_$c.json" --kind character --quiet
  "$PY" tools/spine/pack.py --images "$CD/$c/images" --skeleton "$TMP/chr_$c.json" --out "$TMP" --name "chr_$c" --quiet
  node tools/spine/validate.mjs "$TMP/chr_$c.json" --kind character --atlas "$TMP/chr_$c.atlas" --quiet
done
echo "both mascots validate (kind character) against their packed atlases"
TAIL=1 quiet_run node tools/spine/test/validate_character.test.mjs "$TMP/chr_gumbo.json"
if [ "$CAPTURE" = 1 ]; then
  echo "== capture on spine-pixi-v8"
  node tools/spine/preview/capture.mjs --skel "$TMP/sym_demo.json" --atlas "$TMP/sym_demo.atlas" --out "$TMP/capture" --scenarios land,explode
  node tools/spine/preview/capture.mjs --skel "$TMP/chr_croak.json" --atlas "$TMP/chr_croak.atlas" --out "$TMP/capture_croak" --scenarios charge_drop
fi
echo "tools/spine: all tests passed"
