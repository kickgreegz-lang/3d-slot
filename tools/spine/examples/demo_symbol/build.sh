#!/usr/bin/env bash
# End-to-end AI Spine pipeline on the demo symbol, no Spine editor needed:
#   make_parts.mjs -> make_blur.py -> gen.py -> validate.mjs (synthetic atlas) -> pack.py
#   -> validate.mjs (real atlas) -> publish to public/assets/spine/demo/ -> [capture.mjs]
#
#   tools/spine/examples/demo_symbol/build.sh [--build-dir DIR] [--publish DIR] [--no-publish]
#                                             [--capture DIR] [--kick -27] [--help]
#
# Every gate must pass before anything is published (set -e + validator exit codes).
# Env: PYTHON = python with tools/requirements-spine.txt installed (default: python3).
# Deterministic: re-running on unchanged inputs rewrites nothing (all tools write-on-change).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../../.." && pwd)"
PY="${PYTHON:-python3}"
export PYTHONDONTWRITEBYTECODE=1
BUILD="$REPO/build/spine/demo"
PUBLISH="$REPO/public/assets/spine/demo"
DO_PUBLISH=1
CAPTURE=""
KICK="-27"

usage() { sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'; }
while [ $# -gt 0 ]; do
  case "$1" in
    --build-dir) BUILD="$(realpath -m "$2")"; shift 2 ;;
    --publish) PUBLISH="$(realpath -m "$2")"; shift 2 ;;
    --no-publish) DO_PUBLISH=0; shift ;;
    --capture) CAPTURE="$(realpath -m "$2")"; shift 2 ;;
    --kick) KICK="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "build.sh: unknown argument $1" >&2; usage >&2; exit 2 ;;
  esac
done

cd "$REPO"
mkdir -p "$BUILD"
echo "== 1/6 parts (resvg-js)"
node "$HERE/make_parts.mjs"
echo "== 2/6 blur variants"
"$PY" tools/spine/make_blur.py "$HERE/parts.json"
echo "== 3/6 generate skeleton"
# images path as seen from the published JSON (Spine editor import resolves it relative to the file)
IMAGES_REL="$(realpath -m --relative-to="$PUBLISH" "$HERE/images")/"
"$PY" tools/spine/gen.py "$HERE/rig.yaml" -o "$BUILD/sym_demo.json" --images-path "$IMAGES_REL" \
  --provenance "$BUILD/provenance.json"
echo "== 4/6 validate (synthetic atlas)"
node tools/spine/validate.mjs "$BUILD/sym_demo.json" --report "$BUILD/validate.json"
echo "== 5/6 pack atlas (PMA) + validate against the real atlas"
"$PY" tools/spine/pack.py --images "$HERE/images" --skeleton "$BUILD/sym_demo.json" --out "$BUILD" --name sym_demo \
  --provenance "$BUILD/provenance.json"
node tools/spine/validate.mjs "$BUILD/sym_demo.json" --atlas "$BUILD/sym_demo.atlas" --quiet
if [ "$DO_PUBLISH" = 1 ]; then
  echo "== 6/6 publish -> ${PUBLISH#"$REPO"/}"
  mkdir -p "$PUBLISH"
  for f in sym_demo.json sym_demo.atlas sym_demo.png; do
    cmp -s "$BUILD/$f" "$PUBLISH/$f" || cp "$BUILD/$f" "$PUBLISH/$f"
  done
  "$PY" - "$PUBLISH" "$BUILD/provenance.json" "$HERE/provenance.json" <<'PYEOF'
import json, sys
from pathlib import Path
sys.path.insert(0, str(Path("tools/spine").resolve()))
from spinegen import provenance as prov
pub, build_rows, dest = sys.argv[1], sys.argv[2], sys.argv[3]
built = {r["sha256"]: r for r in json.loads(Path(build_rows).read_text())["rows"]}
rows = []
for f in ("sym_demo.json", "sym_demo.atlas", "sym_demo.png"):
    path = Path(pub) / f
    src = built.get(prov.sha256_file(path))
    if src is None:
        sys.exit(f"provenance: no build row for {path}")
    row = prov.make_row(asset_id=f"sym_demo.published.{f.split('.')[-1]}", path=path, stage=src["stage"],
                        model=src["model"], version=src["version"], parents=[src["id"]], shipped=True,
                        license_id=src["licenseId"],
                        notes="demo rig (not production art); built by tools/spine/examples/demo_symbol/build.sh")
    row["refHashes"] = src["refHashes"]
    rows.append(row)
n = prov.append_rows(dest, rows, "tools/spine/examples/demo_symbol/build.sh")
print(f"provenance: {n} row(s) added -> {dest}")
PYEOF
else
  echo "== 6/6 publish skipped"
fi
if [ -n "$CAPTURE" ]; then
  echo "== capture (Playwright + spine-pixi-v8)"
  SRC="$BUILD"
  [ "$DO_PUBLISH" = 1 ] && SRC="$PUBLISH"
  node tools/spine/preview/capture.mjs --skel "$SRC/sym_demo.json" --atlas "$SRC/sym_demo.atlas" --out "$CAPTURE" \
    --kick "$KICK" --scenarios land,win,explode,idle,anticipation,appear
fi
echo "demo build OK"
