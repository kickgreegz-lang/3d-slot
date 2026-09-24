#!/usr/bin/env bash
# key_video.sh - AI key-colour clip -> seamless loop -> keyed, despilled RGBA PNG frames.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"

usage() {
  cat <<'EOF'
Usage: tools/video/key_video.sh IN.mp4 OUT_DIR NAME [options]

Pipeline (ffmpeg): fps normalise -> loop crossfade (on the opaque clip) -> denoise -> chromakey
(YUV) or colorkey (RGB) -> despill -> alpha erode -> premultiplied Lanczos scale -> RGBA PNGs
OUT_DIR/NAME_0001.png ... (1-based, 4 digits: AssetPack {tps} detects the animation NAME).

Options:
  --size PX          output width (height keeps the aspect, even), default 256
  --fps N            output frame rate, default 24
  --fade N           crossfade frames for the loop seam (output = N_in - fade frames), default 12
  --no-loop          no crossfade (one-shots)
  --key auto|RRGGBB  key colour (the prompt's KEY_HEX); auto samples a 16x16 top-left patch
  --keyer chromakey|colorkey   default chromakey (YUV; robust to H.264 chroma subsampling)
  --similarity F     default 0.12        --blend F   default 0.04
  --despill auto|green|blue|magenta|none   default auto (from the key colour)
  --despill-mix F    ffmpeg despill mix (green/blue), default 0.6
  --erode N          alpha erosion passes after keying, default 1
  --denoise 0|1      hqdn3d before keying, default 1
  --qa-dir DIR       default build/qa/video/NAME
  --manifest FILE    also append the provenance row (e.g. art/manifest.json); default none
  --parent-id ID     manifest row id of the input clip (licence is inherited from it)
  --license-id ID    override the row licence (default: parent's, else ffmpeg)
  -h, --help
Env: FFMPEG=/path/to/ffmpeg (full build; see tools/video/ffenv.sh). Exit: 0 ok, 1 QA fail, 2 usage/ffmpeg.
EOF
}

[ $# -ge 1 ] && { [ "$1" = -h ] || [ "$1" = --help ]; } && { usage; exit 0; }
[ $# -ge 3 ] || { usage >&2; exit 2; }
IN=$1; OUT=$2; NAME=$3; shift 3
SIZE=256; FPS=24; FADE=12; LOOP=1; KEY=auto; KEYER=chromakey; SIM=0.12; BLEND=0.04
DESPILL=auto; DMIX=0.6; ERODE=1; DENOISE=1; QA_DIR=""; MANIFEST=none; PARENT=(); LIC=()
while [ $# -gt 0 ]; do
  case "$1" in
    --size) SIZE=$2; shift 2;; --fps) FPS=$2; shift 2;; --fade) FADE=$2; shift 2;; --no-loop) LOOP=0; shift;;
    --key) KEY=$2; shift 2;; --keyer) KEYER=$2; shift 2;; --similarity) SIM=$2; shift 2;; --blend) BLEND=$2; shift 2;;
    --despill) DESPILL=$2; shift 2;; --despill-mix) DMIX=$2; shift 2;; --erode) ERODE=$2; shift 2;;
    --denoise) DENOISE=$2; shift 2;; --qa-dir) QA_DIR=$2; shift 2;; --manifest) MANIFEST=$2; shift 2;;
    --parent-id) PARENT+=(--parent-id "$2"); shift 2;; --license-id) LIC=(--license-id "$2"); shift 2;;
    -h|--help) usage; exit 0;;
    *) echo "error: unknown option $1" >&2; exit 2;;
  esac
done
[ -f "$IN" ] || { echo "error: input not found: $IN" >&2; exit 2; }
[[ "$NAME" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*$ ]] || { echo "error: bad NAME $NAME" >&2; exit 2; }
[[ "$KEYER" =~ ^(chromakey|colorkey)$ ]] || { echo "error: --keyer chromakey|colorkey" >&2; exit 2; }
FF_NEEDS="fps hqdn3d chromakey colorkey despill geq erosion premultiply unpremultiply scale ssim libx264rgb png"
# shellcheck source=ffenv.sh
source "$HERE/ffenv.sh" || exit 2
QA_DIR=${QA_DIR:-$REPO/build/qa/video/$NAME}
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
ffq() { "$FF" -hide_banner -loglevel error -nostdin -y "$@"; }
count_frames() { "$FF" -hide_banner -nostdin -i "$1" -map 0:v:0 -f null - 2>&1 | tr "\r" "\n" | grep -oE 'frame= *[0-9]+' | tail -1 | grep -oE '[0-9]+'; }

# 1) normalise fps into a lossless RGB intermediate (no extra chroma loss)
ffq -i "$IN" -vf "fps=$FPS,format=rgb24" -an -c:v libx264rgb -qp 0 -preset ultrafast "$TMP/n.mkv"
N=$(count_frames "$TMP/n.mkv")
[ -n "$N" ] && [ "$N" -gt 1 ] || { echo "error: could not decode frames from $IN" >&2; exit 2; }

# 2) key colour: the prompt's hex, or the median-ish top-left patch
if [ "$KEY" = auto ]; then
  KEY=$("$FF" -hide_banner -loglevel error -nostdin -i "$TMP/n.mkv" -vf "crop=16:16:0:0,scale=1:1:flags=area,format=rgb24" \
        -frames:v 1 -f rawvideo - | od -An -tx1 | tr -d ' \n')
fi
KEY=${KEY#\#}; KEY=${KEY#0x}; KEY=$(tr 'a-f' 'A-F' <<<"$KEY")
[[ "$KEY" =~ ^[0-9A-F]{6}$ ]] || { echo "error: bad key colour $KEY" >&2; exit 2; }
R=$((16#${KEY:0:2})); G=$((16#${KEY:2:2})); B=$((16#${KEY:4:2}))
if [ "$DESPILL" = auto ]; then
  if [ $G -ge 128 ] && [ $R -lt 128 ] && [ $B -lt 128 ]; then DESPILL=green
  elif [ $B -ge 128 ] && [ $R -lt 128 ] && [ $G -lt 128 ]; then DESPILL=blue
  elif [ $R -ge 128 ] && [ $B -ge 128 ] && [ $G -lt 128 ]; then DESPILL=magenta
  else DESPILL=none; fi
fi

# 3) seamless loop on the OPAQUE clip: the first FADE frames fade in (weights 0..1 inclusive) over the
#    last FADE frames; the last output frame IS input frame FADE-1, so the wrap to FADE is a natural step
SRC="$TMP/n.mkv"; OUTN=$N
if [ "$LOOP" = 1 ] && [ "$FADE" -gt 0 ]; then
  [ "$N" -gt $((2 * FADE)) ] || { echo "error: clip has $N frames; need > 2*fade ($((2 * FADE)))" >&2; exit 2; }
  ffq -i "$TMP/n.mkv" -filter_complex \
    "[0:v]split[body][pre];[pre]trim=end_frame=$FADE,setpts=PTS-STARTPTS,format=yuva444p,fade=t=in:s=0:n=$((FADE - 1)):alpha=1,setpts=PTS+($((N - 2 * FADE))/$FPS)/TB[jt];[body]trim=start_frame=$FADE,setpts=PTS-STARTPTS,format=yuva444p[main];[main][jt]overlay=eof_action=pass:format=yuv444,format=rgb24" \
    -fps_mode passthrough -c:v libx264rgb -qp 0 -preset ultrafast "$TMP/loop.mkv"
  SRC="$TMP/loop.mkv"; OUTN=$((N - FADE))
fi

# 4) key -> despill -> erode alpha -> premultiplied scale -> straight RGBA PNGs
DN=""; [ "$DENOISE" = 1 ] && DN="hqdn3d=1.5:1.5:4:4,"
case "$KEYER" in
  chromakey) KF="format=yuv444p,chromakey=color=0x$KEY:similarity=$SIM:blend=$BLEND";;
  colorkey)  KF="format=rgb24,colorkey=color=0x$KEY:similarity=$SIM:blend=$BLEND";;
esac
case "$DESPILL" in
  green|blue) DS=",format=rgba,despill=type=$DESPILL:mix=$DMIX:expand=0.1";;
  magenta)    DS=",format=rgba,geq=r='r(X\,Y)-max(0\,min(r(X\,Y)\,b(X\,Y))-g(X\,Y))':g='g(X\,Y)':b='b(X\,Y)-max(0\,min(r(X\,Y)\,b(X\,Y))-g(X\,Y))':a='alpha(X\,Y)'";;
  none)       DS="";;
  *) echo "error: --despill auto|green|blue|magenta|none" >&2; exit 2;;
esac
ER=""; for ((i = 0; i < ERODE; i++)); do ER+=",erosion=threshold0=0:threshold1=0:threshold2=0"; done
# a final generic spill clamp on RGB (min(key channels) <= max(other channels)) after scaling
case "$DESPILL" in
  green)   CL=",geq=r='r(X\,Y)':g='min(g(X\,Y)\,max(r(X\,Y)\,b(X\,Y)))':b='b(X\,Y)':a='alpha(X\,Y)'";;
  blue)    CL=",geq=r='r(X\,Y)':g='g(X\,Y)':b='min(b(X\,Y)\,max(r(X\,Y)\,g(X\,Y)))':a='alpha(X\,Y)'";;
  magenta) CL=",geq=r='r(X\,Y)-max(0\,min(r(X\,Y)\,b(X\,Y))-g(X\,Y))':g='g(X\,Y)':b='b(X\,Y)-max(0\,min(r(X\,Y)\,b(X\,Y))-g(X\,Y))':a='alpha(X\,Y)'";;
  *)       CL="";;
esac
mkdir -p "$OUT"
rm -f "$OUT/${NAME}_"[0-9][0-9][0-9][0-9].png
ffq -i "$SRC" -vf "${DN}${KF}${DS},format=yuva444p${ER},format=rgba,premultiply=inplace=1,scale=$SIZE:-2:flags=lanczos,unpremultiply=inplace=1,format=rgba${CL}" \
  -fps_mode passthrough -start_number 1 "$OUT/${NAME}_%04d.png"
GOT=$(find "$OUT" -maxdepth 1 -name "${NAME}_[0-9][0-9][0-9][0-9].png" | wc -l)

# 5) QA: frame count + loop seam. The seam (last -> first) must look like an ordinary step:
#    its SSIM may not fall below the worst consecutive-frame SSIM of the clip (minus 0.01).
ssim() { "$FF" -hide_banner -nostdin -i "$1" -i "$2" -lavfi "[0:v]format=rgba[a];[1:v]format=rgba[b];[a][b]ssim" -f null - 2>&1 | grep -oE 'All:[0-9.]+' | tail -1 | cut -d: -f2; }
F1="$OUT/${NAME}_0001.png"; FL=$(printf "%s/%s_%04d.png" "$OUT" "$NAME" "$GOT")
SEAM=$(ssim "$FL" "$F1")
"$FF" -hide_banner -loglevel error -nostdin -framerate "$FPS" -start_number 1 -i "$OUT/${NAME}_%04d.png" \
  -framerate "$FPS" -start_number 2 -i "$OUT/${NAME}_%04d.png" \
  -lavfi "[0:v]format=rgba[a];[1:v]format=rgba[b];[a][b]ssim=stats_file=$TMP/ssim.log" -f null - || true
STEP=$(grep -oE 'All:[0-9.]+' "$TMP/ssim.log" 2>/dev/null | cut -d: -f2 | sort -g | head -1)
PASSED=true
[ "$GOT" -eq "$OUTN" ] || PASSED=false
if [ "$LOOP" = 1 ] && [ -n "$STEP" ]; then awk -v s="$SEAM" -v t="$STEP" 'BEGIN{exit !(s + 0.01 >= t)}' || PASSED=false; fi
mkdir -p "$QA_DIR"
cat >"$QA_DIR/qa.json" <<EOF
{
  "tool": "tools/video/key_video.sh", "in": "$IN", "out": "$OUT", "name": "$NAME",
  "fps": $FPS, "inFrames": $N, "expectedFrames": $OUTN, "frames": $GOT, "fade": $([ "$LOOP" = 1 ] && echo "$FADE" || echo 0),
  "key": "#$KEY", "keyer": "$KEYER", "similarity": $SIM, "blend": $BLEND, "despill": "$DESPILL", "erode": $ERODE, "size": $SIZE,
  "seamSSIM": ${SEAM:-null}, "minStepSSIM": ${STEP:-null}, "passed": $PASSED
}
EOF
python3 "$HERE/record.py" --path "$OUT" --stage video --model tools/video/key_video.sh --inputs "$IN" \
  --sidecar "$QA_DIR/manifest.json" --manifest "$MANIFEST" --asset-id "$NAME" --kind frames --qa-json "$QA_DIR/qa.json" \
  --notes "key #$KEY $KEYER, $GOT frames @ $FPS fps, ${SIZE}px" "${PARENT[@]}" "${LIC[@]}" >/dev/null
echo "key=#$KEY despill=$DESPILL in_frames=$N out_frames=$GOT seam_ssim=$SEAM min_step_ssim=$STEP -> $OUT (qa: $QA_DIR/qa.json)"
[ "$PASSED" = true ] || { echo "error: QA failed (see $QA_DIR/qa.json)" >&2; exit 1; }
