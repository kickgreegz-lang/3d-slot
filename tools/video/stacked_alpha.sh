#!/usr/bin/env bash
# stacked_alpha.sh - RGBA frames -> stacked-alpha H.264 MP4 (premultiplied colour on top, alpha below).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"

usage() {
  cat <<'EOF'
Usage: tools/video/stacked_alpha.sh FRAMES OUT.mp4 [options]

FRAMES is a folder of RGBA PNGs named <name>_0001.png ... (any fixed digit count), or an ffmpeg
pattern like 'dir/f_%03d.png'. Filter graph (docs/PIPELINE.md 5.4, research-tested):
  [0:v]format=rgba,split[c][a];[a]alphaextract[am];[c]premultiply=inplace=1[cp];[cp][am]vstack=inputs=2,format=yuv420p
plus: even-size padding, a height cap for the stacked frame, and explicit BT.709 limited-range
tags so browsers decode both halves with the same matrix. Plays with alpha in every browser via a
10-line recombine shader (alpha = bottom.r; colour = top.rgb, already premultiplied).

Options:
  --fps N           input frame rate, default 30
  --crf N           x264 CRF, default 20        --preset P   x264 preset, default slow
  --max-height PX   cap on the STACKED height (2 x frame), default 2160
  --qa-dir DIR      default build/qa/video/<out stem>
  --no-verify       skip the decode-back check (alpha and colour error vs the source frames)
  --manifest FILE   also append the provenance row (e.g. art/manifest.json); default none
  --parent-id ID    row id of the source frames      --license-id ID   override the row licence
  --shipped         mark the row shipped (the file goes to public/assets)
Env: FFMPEG (full build). Exit: 0 ok, 1 verification failed, 2 usage/ffmpeg.
EOF
}
[ $# -ge 1 ] && { [ "$1" = -h ] || [ "$1" = --help ]; } && { usage; exit 0; }
[ $# -ge 2 ] || { usage >&2; exit 2; }
SRC=$1; OUT=$2; shift 2
FPS=30; CRF=20; PRESET=slow; MAXH=2160; QA_DIR=""; VERIFY=1; MANIFEST=none; PARENT=(); LIC=(); SHIP=()
while [ $# -gt 0 ]; do
  case "$1" in
    --fps) FPS=$2; shift 2;; --crf) CRF=$2; shift 2;; --preset) PRESET=$2; shift 2;; --max-height) MAXH=$2; shift 2;;
    --qa-dir) QA_DIR=$2; shift 2;; --no-verify) VERIFY=0; shift;; --manifest) MANIFEST=$2; shift 2;;
    --parent-id) PARENT+=(--parent-id "$2"); shift 2;; --license-id) LIC=(--license-id "$2"); shift 2;;
    --shipped) SHIP=(--shipped); shift;;
    -h|--help) usage; exit 0;;
    *) echo "error: unknown option $1" >&2; exit 2;;
  esac
done
FF_NEEDS="format split alphaextract premultiply vstack pad scale libx264"
# shellcheck source=ffenv.sh
source "$HERE/ffenv.sh" || exit 2

# resolve the input pattern + start number
if [ -d "$SRC" ]; then
  FIRST=$(find "$SRC" -maxdepth 1 -name '*.png' | sort | head -1)
  [ -n "$FIRST" ] || { echo "error: no PNG frames in $SRC" >&2; exit 2; }
  B=$(basename "$FIRST" .png)
  DIG=$(grep -oE '[0-9]+$' <<<"$B") || { echo "error: $FIRST has no frame number" >&2; exit 2; }
  PAT="$SRC/${B%"$DIG"}%0${#DIG}d.png"; START=$((10#$DIG))
  INPUTS=$(find "$SRC" -maxdepth 1 -name '*.png' | sort)
else
  PAT=$SRC; START=$(ls $(dirname "$SRC") 2>/dev/null | grep -oE '[0-9]+\.png$' | sort -n | head -1 | cut -d. -f1); START=$((10#${START:-1}))
  INPUTS=""
fi
QA_DIR=${QA_DIR:-$REPO/build/qa/video/$(basename "$OUT" .mp4)}
mkdir -p "$(dirname "$OUT")" "$QA_DIR"
# frame size -> even dims, stacked height cap
read -r W H < <("$FF" -hide_banner -nostdin -start_number "$START" -i "$PAT" -frames:v 1 -f null - 2>&1 | grep -oE 'Stream.*Video.* [0-9]+x[0-9]+' | head -1 | grep -oE '[0-9]+x[0-9]+' | tr x ' ')
[ -n "${W:-}" ] || { echo "error: cannot read frames $PAT" >&2; exit 2; }
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
if [ $((2 * H)) -gt "$MAXH" ]; then
  # height cap: premultiplied Lanczos into temp frames, so the encode AND the verification use
  # exactly the same scaled pixels
  NH=$(( (MAXH / 2) / 2 * 2 ))
  "$FF" -hide_banner -loglevel error -nostdin -y -start_number "$START" -i "$PAT" \
    -vf "format=rgba,premultiply=inplace=1,scale=-2:$NH:flags=lanczos,unpremultiply=inplace=1,format=rgba" \
    -start_number 1 "$TMP/s_%05d.png"
  PAT="$TMP/s_%05d.png"; START=1
fi
"$FF" -hide_banner -loglevel error -nostdin -y -framerate "$FPS" -start_number "$START" -i "$PAT" -filter_complex \
  "[0:v]format=rgba,pad=ceil(iw/2)*2:ceil(ih/2)*2:0:0:color=black@0,format=rgba,split[c][a];[a]alphaextract[am];[c]premultiply=inplace=1[cp];[cp][am]vstack=inputs=2,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p[v]" \
  -map "[v]" -c:v libx264 -crf "$CRF" -preset "$PRESET" -pix_fmt yuv420p \
  -colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv -movflags +faststart -an "$OUT"

PASSED=true
if [ "$VERIFY" = 1 ]; then
  PY=${PIPELINE_PY:-$REPO/tools/.venv/bin/python}; [ -x "$PY" ] || PY=python3
  FFMPEG="$FF" "$PY" "$HERE/stacked_check.py" "$PAT" "$START" "$OUT" --report "$QA_DIR/qa.json" || PASSED=false
else
  printf '{"tool":"tools/video/stacked_alpha.sh","out":"%s","verified":false,"passed":true}\n' "$OUT" >"$QA_DIR/qa.json"
fi
# shellcheck disable=SC2086
python3 "$HERE/record.py" --path "$OUT" --stage video --model tools/video/stacked_alpha.sh --inputs $INPUTS \
  --sidecar "$QA_DIR/manifest.json" --manifest "$MANIFEST" --kind stacked --qa-json "$QA_DIR/qa.json" \
  --notes "stacked alpha (premultiplied top, alpha bottom), source ${W}x${H}, stacked height cap $MAXH, $FPS fps, crf $CRF" "${PARENT[@]}" "${LIC[@]}" "${SHIP[@]}" >/dev/null
echo "$OUT (qa: $QA_DIR/qa.json)"
[ "$PASSED" = true ] || { echo "error: decode-back verification failed (see $QA_DIR/qa.json)" >&2; exit 1; }
