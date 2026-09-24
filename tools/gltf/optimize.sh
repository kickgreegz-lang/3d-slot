#!/usr/bin/env bash
# optimize.sh — GLB -> shippable GLB: meshopt geometry/animation + WebP textures, then glTF
# validator, inspect report and the budget gate (tools/gltf/budget.mjs).
#
#   tools/gltf/optimize.sh raw.glb public/assets/mascots/mascot_gumbo.glb --mascot
#   tools/gltf/optimize.sh in.glb out.glb --report-dir art/_work/gltf/robot --max-draw-calls 20
#
# Settings (docs/PIPELINE.md §4.4, ANIMATION_CONTRACT §7.5-7.6):
#   --compress meshopt --texture-compress webp --texture-size 1024
#   --join false --simplify false --flatten false   (keep eye_*/mouth_* meshes, skins, named nodes)
#   --palette false                                  (keep material names; the placeholder recolours by name)
# KTX2 is NOT the default: gltf-transform's KTX2 path needs the Basis transcoder at runtime, whose
# default is a public CDN (Stake: no external requests). --texture-compress ktx2 requires
# --allow-ktx2 and self-hosted transcoders.
# Exit: 0 ok · 1 error/usage · 2 glTF validator errors · 3 budget breach.
set -euo pipefail

usage() {
  sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'
  cat <<'EOF'
usage: tools/gltf/optimize.sh <in.glb> <out.glb> [options]
  --texture-compress webp|ktx2|auto|false   default webp (ktx2 needs --allow-ktx2)
  --texture-size N          default 1024
  --palette true|false      default false
  --report-dir DIR          default build/qa/gltf/<out stem>
  --no-optimize             only validate + inspect + budget <in.glb> (out = in)
  budget options (passed to tools/gltf/budget.mjs):
  --max-tris N --max-bones N --bones-target A-B --max-texture PX --max-bytes N
  --max-draw-calls N --require-clips a,b --require-morphs a,b --mascot --allow-ktx2
EOF
}

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
GT="$REPO/node_modules/.bin/gltf-transform"
[ -x "$GT" ] || GT="npx --no-install gltf-transform"

[ $# -ge 1 ] && { [ "$1" = "-h" ] || [ "$1" = "--help" ]; } && { usage; exit 0; }
[ $# -ge 2 ] || { usage >&2; exit 1; }
IN="$1"; OUT="$2"; shift 2
TEX="webp"; TEXSIZE=1024; PALETTE=false; REPORT=""; OPT=1; ALLOW_KTX2=0
BUDGET_ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --texture-compress) TEX="$2"; shift 2 ;;
    --texture-size) TEXSIZE="$2"; shift 2 ;;
    --palette) PALETTE="$2"; shift 2 ;;
    --report-dir) REPORT="$2"; shift 2 ;;
    --no-optimize) OPT=0; shift ;;
    --allow-ktx2) ALLOW_KTX2=1; BUDGET_ARGS+=("$1"); shift ;;
    --mascot) BUDGET_ARGS+=("$1"); shift ;;
    --max-tris|--max-bones|--bones-target|--max-texture|--max-bytes|--max-draw-calls|--require-clips|--require-morphs)
      BUDGET_ARGS+=("$1" "$2"); shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "ERROR: unknown option $1" >&2; usage >&2; exit 1 ;;
  esac
done
[ -f "$IN" ] || { echo "ERROR: input not found: $IN" >&2; exit 1; }
if [ "$TEX" = "ktx2" ] && [ "$ALLOW_KTX2" != 1 ]; then
  echo "ERROR: --texture-compress ktx2 needs --allow-ktx2 (self-host the Basis transcoder first; Stake forbids the CDN default)" >&2
  exit 1
fi
STEM="$(basename "$OUT" .glb)"
[ -n "$REPORT" ] || REPORT="$REPO/build/qa/gltf/$STEM"
mkdir -p "$REPORT" "$(dirname "$OUT")"

if [ "$OPT" = 1 ]; then
  echo "[optimize] $IN -> $OUT (meshopt, $TEX, $TEXSIZE px, join/simplify/flatten off, palette $PALETTE)"
  # shellcheck disable=SC2086
  $GT optimize "$IN" "$OUT" --compress meshopt --texture-compress "$TEX" --texture-size "$TEXSIZE" \
    --join false --simplify false --flatten false --palette "$PALETTE" 2>&1 | tee "$REPORT/optimize.log" | grep -v '^$' || true
  [ -s "$OUT" ] || { echo "ERROR: optimize produced no output" >&2; exit 1; }
else
  OUT="$IN"
fi

echo "[validate] $OUT"
set +e
# shellcheck disable=SC2086
$GT validate "$OUT" --format md > "$REPORT/validate.md" 2>&1
VRC=$?
# shellcheck disable=SC2086
$GT inspect "$OUT" --format md > "$REPORT/inspect.md" 2>&1
IRC=$?
set -e
if [ $VRC -ne 0 ]; then
  echo "ERROR: glTF validator reported errors (see $REPORT/validate.md)" >&2
  grep -A20 -m1 'ERROR' "$REPORT/validate.md" >&2 || true
  exit 2
fi
[ $IRC -eq 0 ] || { echo "ERROR: gltf-transform inspect failed (see $REPORT/inspect.md)" >&2; exit 1; }
WARN=$(awk '/^ WARNING/{f=1;next} /^ INFO/{f=0} f && /^\| [A-Z_]+ /{print $2}' "$REPORT/validate.md" | sort | uniq -c | tr '\n' ';')
echo "[validate] no errors${WARN:+ (warnings: $WARN)}"

set +e
node "$HERE/budget.mjs" "$OUT" --json "$REPORT/budget.json" ${BUDGET_ARGS[@]+"${BUDGET_ARGS[@]}"}
BRC=$?
set -e
IN_BYTES=$(wc -c < "$IN"); OUT_BYTES=$(wc -c < "$OUT")
echo "[optimize] $IN_BYTES -> $OUT_BYTES bytes; reports in $REPORT/{optimize.log,validate.md,inspect.md,budget.json}"
exit $BRC
