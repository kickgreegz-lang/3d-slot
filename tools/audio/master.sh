#!/usr/bin/env bash
# master.sh - loudness-master one cue and encode the web formats (+ QA + provenance).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"

usage() {
  cat <<'EOF'
Usage: tools/audio/master.sh IN OUT_BASE [options]
Writes OUT_BASE.webm (Opus) + OUT_BASE.m4a (AAC) [+ .ogg (Vorbis)] [+ --wav master], e.g.
  tools/audio/master.sh art/source/audio/masters/land_heavy_01.wav public/assets/audio/sfx/land_heavy_01 --mode sfx --peak -6
  tools/audio/master.sh stems/base.wav public/assets/audio/music/base --mode loop --crossfade-ms 250

Modes:
  music  2-pass loudnorm (EBU R128) to --lufs/--tp with linear=true; the pass-2 report MUST say
         normalization_type=linear. If loudnorm would go dynamic (gain limited by true peak), it
         falls back to a static gain + alimiter (never loudnorm's pumping dynamic mode).
  loop   music + seam crossfade: the last --crossfade-ms is equal-power mixed into the first,
         output = input - crossfade, so the wrap point is continuous (no trim, no fades).
  sfx    silence trim (start and end, --trim-db), 2 ms fade-in / --fade-out-ms fade-out, then
         sample-peak normalise to --peak dBFS (integrated LUFS is meaningless on sub-second
         one-shots); --sfx-lufs N uses 2-pass loudnorm instead (cues >= 3 s, e.g. risers).
Options:
  --lufs N (-16)  --tp N (-1)  --lra N (11)  --peak N (-1)  --sfx-lufs N  --trim-db N (-60)
  --crossfade-ms N (250)  --fade-out-ms N (15)  --no-trim
  --no-aac-align  keep the exact loop length (m4a then loops with a <= 21 ms gap; its seam gate is skipped)
  --formats LIST  comma list of webm,m4a,ogg (default webm,m4a; the runtime picks per browser)
  --opus-kbps N (96)  --aac-kbps N (128)  --vorbis-q N (5)  --channels keep|1|2 (keep)
  --wav PATH      also write the 48 kHz 24-bit master WAV
  --qa-dir DIR    default build/qa/audio/<basename OUT_BASE>
  --manifest FILE also append rows (e.g. art/manifest.json); default none
  --parent-id ID  row id of the input (licence inherited)   --license-id ID   --shipped
Exit: 0 ok, 1 QA failed (loudness/peak/seam gate, or non-linear loudnorm), 2 usage/ffmpeg.
EOF
}
[ $# -ge 1 ] && { [ "$1" = -h ] || [ "$1" = --help ]; } && { usage; exit 0; }
[ $# -ge 2 ] || { usage >&2; exit 2; }
IN=$1; OUT=$2; shift 2
MODE=music; LUFS=-16; TP=-1; LRA=11; PEAK=-1; SFX_LUFS=""; TRIM_DB=-60; XF_MS=250; FO_MS=15; TRIM=1
AAC_ALIGN=1; FORMATS=webm,m4a; OPUS=96; AAC=128; VQ=5; CH=keep; WAV=""; QA_DIR=""; MANIFEST=none; PARENT=(); LIC=(); SHIP=()
while [ $# -gt 0 ]; do
  case "$1" in
    --mode) MODE=$2; shift 2;; --lufs) LUFS=$2; shift 2;; --tp) TP=$2; shift 2;; --lra) LRA=$2; shift 2;;
    --peak) PEAK=$2; shift 2;; --sfx-lufs) SFX_LUFS=$2; shift 2;; --trim-db) TRIM_DB=$2; shift 2;;
    --crossfade-ms) XF_MS=$2; shift 2;; --fade-out-ms) FO_MS=$2; shift 2;; --no-trim) TRIM=0; shift;;
    --no-aac-align) AAC_ALIGN=0; shift;;
    --formats) FORMATS=$2; shift 2;; --opus-kbps) OPUS=$2; shift 2;; --aac-kbps) AAC=$2; shift 2;;
    --vorbis-q) VQ=$2; shift 2;; --channels) CH=$2; shift 2;; --wav) WAV=$2; shift 2;; --qa-dir) QA_DIR=$2; shift 2;;
    --manifest) MANIFEST=$2; shift 2;; --parent-id) PARENT+=(--parent-id "$2"); shift 2;;
    --license-id) LIC=(--license-id "$2"); shift 2;; --shipped) SHIP=(--shipped); shift;;
    -h|--help) usage; exit 0;;
    *) echo "error: unknown option $1" >&2; exit 2;;
  esac
done
[ -f "$IN" ] || { echo "error: input not found: $IN" >&2; exit 2; }
[[ "$MODE" =~ ^(music|loop|sfx)$ ]] || { echo "error: --mode music|loop|sfx" >&2; exit 2; }
FF_NEEDS="loudnorm ebur128 silenceremove areverse afade acrossfade alimiter volume atrim amix concat aresample libopus aac libvorbis"
# shellcheck source=../video/ffenv.sh
source "$REPO/tools/video/ffenv.sh" || exit 2
export FFMPEG="$FF"
PY=${PIPELINE_PY:-python3}
QA_DIR=${QA_DIR:-$REPO/build/qa/audio/$(basename "$OUT")}
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
mkdir -p "$QA_DIR" "$(dirname "$OUT")"
ffq() { "$FF" -hide_banner -loglevel error -nostdin -y "$@"; }
CHARG=(); [ "$CH" != keep ] && CHARG=(-ac "$CH")

# 0) decode to 48 kHz float
ffq -i "$IN" -vn "${CHARG[@]}" -af aresample=48000:resampler=soxr -c:a pcm_f32le "$TMP/a.wav" 2>/dev/null \
  || ffq -i "$IN" -vn "${CHARG[@]}" -ar 48000 -c:a pcm_f32le "$TMP/a.wav"
SRC="$TMP/a.wav"
nsamples() { "$FF" -hide_banner -nostdin -i "$1" -af astats=measure_perchannel=none:measure_overall=Number_of_samples -f null - 2>&1 \
  | grep -oE 'Number of samples: [0-9]+' | tail -1 | grep -oE '[0-9]+'; }

# 1) edit: sfx trim + micro fades, or loop seam crossfade
EXTRA="{}"
if [ "$MODE" = sfx ] && [ "$TRIM" = 1 ]; then
  ffq -i "$SRC" -af "silenceremove=start_periods=1:start_threshold=${TRIM_DB}dB:start_silence=0.002:detection=peak,areverse,silenceremove=start_periods=1:start_threshold=${TRIM_DB}dB:start_silence=0.004:detection=peak,areverse" -c:a pcm_f32le "$TMP/t.wav"
  N=$(nsamples "$TMP/t.wav"); [ -n "$N" ] && [ "$N" -gt 0 ] || { echo "error: $IN is silent after trimming at ${TRIM_DB} dB" >&2; exit 2; }
  D=$(awk -v n="$N" 'BEGIN{printf "%.6f", n/48000}')
  FO=$(awk -v d="$D" -v f="$FO_MS" 'BEGIN{x=f/1000; if (x>d/2) x=d/2; printf "%.6f", x}')
  ffq -i "$TMP/t.wav" -af "afade=t=in:d=0.002:curve=tri,afade=t=out:st=$(awk -v d="$D" -v f="$FO" 'BEGIN{printf "%.6f", d-f}'):d=$FO:curve=tri" -c:a pcm_f32le "$TMP/e.wav"
  SRC="$TMP/e.wav"
elif [ "$MODE" = loop ]; then
  N=$(nsamples "$SRC"); X=$((XF_MS * 48)); [ "$N" -gt $((3 * X)) ] || { echo "error: loop too short for a ${XF_MS} ms crossfade" >&2; exit 2; }
  # AAC pads the last frame (1024 samples) and the padding is NOT trimmed on decode, which breaks
  # m4a loops: lengthen the crossfade by <= 21 ms so the loop is a whole number of AAC frames
  if [ "$AAC_ALIGN" = 1 ]; then X=$((X + (N - X) % 1024)); fi
  ffq -i "$SRC" -filter_complex \
    "[0:a]asplit=3[x][y][z];[x]atrim=end_sample=$X,asetpts=PTS-STARTPTS,afade=t=in:ss=0:ns=$X:curve=qsin[h];[y]atrim=start_sample=$((N - X)),asetpts=PTS-STARTPTS,afade=t=out:ss=0:ns=$X:curve=qsin[t];[h][t]amix=inputs=2:normalize=0:duration=longest[xf];[z]atrim=start_sample=$X:end_sample=$((N - X)),asetpts=PTS-STARTPTS[mid];[xf][mid]concat=n=2:v=0:a=1" \
    -c:a pcm_f32le "$TMP/e.wav"
  SRC="$TMP/e.wav"; EXTRA="{\"loopCrossfadeSamples\": $X, \"inputSamples\": $N, \"outputSamples\": $((N - X)), \"aacAligned\": $([ "$AAC_ALIGN" = 1 ] && echo true || echo false)}"
fi

# 2) loudness. Measurement always runs on SRC; processing runs on SRCP, which for loops is SRC
#    circularly padded (tail + SRC + head), then trimmed back: resampler/limiter edge transients
#    land in the padding, so the loop seam stays sample-continuous.
NS=$(nsamples "$SRC")
P=0; SRCP="$SRC"
if [ "$MODE" = loop ]; then
  P=$(( NS / 4 < 24000 ? NS / 4 : 24000 ))
  ffq -i "$SRC" -filter_complex "[0:a]asplit=3[a][b][c];[a]atrim=start_sample=$((NS - P)),asetpts=PTS-STARTPTS[t];[c]atrim=end_sample=$P,asetpts=PTS-STARTPTS[h];[t][b][h]concat=n=3:v=0:a=1" -c:a pcm_f32le "$TMP/p.wav"
  SRCP="$TMP/p.wav"
fi
apply() { # $1 = filter chain -> $TMP/n.wav (48 kHz float, trimmed back to SRC's length)
  ffq -i "$SRCP" -af "$1,aresample=48000,atrim=start_sample=$P:end_sample=$((P + NS)),asetpts=PTS-STARTPTS" -ar 48000 -c:a pcm_f32le "$TMP/n.wav"
}
measure_i() { "$PY" "$HERE/audio_qa.py" measure "$1" | "$PY" -c 'import json,sys; print(json.load(sys.stdin)["I"])'; }
NORM=""
loudnorm2() { # $1 target I
  local I=$1
  "$FF" -hide_banner -nostdin -i "$SRC" -af "loudnorm=I=$I:TP=$TP:LRA=$LRA:print_format=json" -f null - 2>"$TMP/p1.txt" || true
  local J; J=$("$PY" "$HERE/audio_qa.py" loudnorm-json "$TMP/p1.txt") || { echo "error: loudnorm pass 1 failed" >&2; exit 2; }
  local mi mtp mlra mth off
  read -r mi mtp mlra mth off < <("$PY" -c 'import json,sys; j=json.loads(sys.argv[1]); print(j["input_i"], j["input_tp"], j["input_lra"], j["input_thresh"], j["target_offset"])' "$J")
  "$FF" -hide_banner -nostdin -y -i "$SRCP" -af "loudnorm=I=$I:TP=$TP:LRA=$LRA:measured_I=$mi:measured_TP=$mtp:measured_LRA=$mlra:measured_thresh=$mth:offset=$off:linear=true:print_format=json,aresample=48000,atrim=start_sample=$P:end_sample=$((P + NS)),asetpts=PTS-STARTPTS" \
    -ar 48000 -c:a pcm_f32le "$TMP/n.wav" 2>"$TMP/p2.txt" || { cat "$TMP/p2.txt" >&2; exit 2; }
  local J2 nt; J2=$("$PY" "$HERE/audio_qa.py" loudnorm-json "$TMP/p2.txt")
  nt=$("$PY" -c 'import json,sys; print(json.loads(sys.argv[1])["normalization_type"])' "$J2")
  if [ "$nt" = linear ]; then
    NORM="loudnorm-2pass-linear"
  else
    # loudnorm refused linear mode (gain would break the true-peak ceiling, or LRA=0 on a steady
    # tone): static gain + 4x-oversampled true-peak limiter, re-measured until within 0.5 LU
    local g lim iter=0 got
    g=$(awk -v t="$I" -v m="$mi" 'BEGIN{printf "%.3f", t-m}')
    lim=$(awk -v tp="$TP" 'BEGIN{printf "%.6f", 10^((tp-0.3)/20)}')
    while :; do
      apply "volume=${g}dB,aresample=192000,alimiter=limit=$lim:attack=5:release=50:level=false:latency=true"
      got=$(measure_i "$TMP/n.wav"); iter=$((iter + 1))
      awk -v a="$got" -v t="$I" 'BEGIN{d=a-t; exit !(d<=0.5 && d>=-0.5)}' && break
      [ "$iter" -ge 4 ] && break
      g=$(awk -v g="$g" -v t="$I" -v a="$got" 'BEGIN{printf "%.3f", g+t-a}')
    done
    NORM="static-gain+alimiter (loudnorm reported $nt; gain ${g} dB, $iter pass(es))"
  fi
  EXTRA=$("$PY" -c 'import json,sys; e=json.loads(sys.argv[1]); e["loudnormPass1"]=json.loads(sys.argv[2]); e["loudnormPass2"]=json.loads(sys.argv[3]); e["normalization"]=sys.argv[4]; print(json.dumps(e))' "$EXTRA" "$J" "$J2" "$NORM")
}
if [ "$MODE" = sfx ] && [ -z "$SFX_LUFS" ]; then
  PK=$("$PY" "$HERE/audio_qa.py" measure "$SRC" | "$PY" -c 'import json,sys; print(json.load(sys.stdin)["samplePeak"])')
  [ "$PK" != None ] && [ "$PK" != null ] || { echo "error: silent input" >&2; exit 2; }
  G=$(awk -v c="$PEAK" -v p="$PK" 'BEGIN{printf "%.3f", c-p}')
  apply "volume=${G}dB"
  NORM="sample-peak ${PEAK} dBFS (gain ${G} dB)"
  EXTRA=$("$PY" -c 'import json,sys; e=json.loads(sys.argv[1]); e["normalization"]=sys.argv[2]; print(json.dumps(e))' "$EXTRA" "$NORM")
else
  loudnorm2 "${SFX_LUFS:-$LUFS}"
fi

# 3) encode (bit-exact containers: re-runs give identical bytes)
BX=(-map_metadata -1 -fflags +bitexact -flags:a +bitexact)
OUTS=()
if [ -n "$WAV" ]; then mkdir -p "$(dirname "$WAV")"; ffq -i "$TMP/n.wav" -c:a pcm_s24le -ar 48000 "${BX[@]}" "$WAV"; OUTS+=("$WAV"); fi
IFS=, read -r -a FMT <<<"$FORMATS"
for f in "${FMT[@]}"; do
  case "$f" in
    webm) ffq -i "$TMP/n.wav" -c:a libopus -b:a "${OPUS}k" -vbr on -application audio -ar 48000 "${BX[@]}" "$OUT.webm";;
    m4a)  ffq -i "$TMP/n.wav" -c:a aac -b:a "${AAC}k" -ar 48000 -movflags +faststart "${BX[@]}" "$OUT.m4a";;
    ogg)  ffq -i "$TMP/n.wav" -c:a libvorbis -q:a "$VQ" -ar 48000 "${BX[@]}" "$OUT.ogg";;
    *) echo "error: unknown format $f (webm,m4a,ogg)" >&2; exit 2;;
  esac
  OUTS+=("$OUT.$f")
done

# 4) QA every output (decoded back) + provenance
printf '%s' "$EXTRA" >"$TMP/extra.json"
QA_ARGS=(--mode "$MODE" --lufs "$LUFS" --tp "$TP" --peak "$PEAK" --report "$QA_DIR/qa.json" --extra "$TMP/extra.json")
[ -n "$SFX_LUFS" ] && QA_ARGS+=(--lufs-sfx "$SFX_LUFS")
[ "$AAC_ALIGN" = 0 ] && QA_ARGS+=(--no-seam-ext m4a)
PASSED=1
"$PY" "$HERE/audio_qa.py" check "${OUTS[@]}" "${QA_ARGS[@]}" >/dev/null || PASSED=0
if [ "$MODE" != sfx ] || [ -n "$SFX_LUFS" ]; then
  case "$NORM" in loudnorm-2pass-linear|static-gain+alimiter*) ;; *) PASSED=0;; esac
fi
python3 "$REPO/tools/video/record.py" --path "${OUTS[@]}" --stage audio-post --model tools/audio/master.sh --inputs "$IN" \
  --sidecar "$QA_DIR/manifest.json" --manifest "$MANIFEST" --asset-id "$(basename "$OUT")" --kind ext \
  --qa-json "$QA_DIR/qa.json" --notes "$MODE: $NORM" "${PARENT[@]}" "${LIC[@]}" "${SHIP[@]}" >/dev/null
echo "$MODE: $NORM -> ${OUTS[*]} (qa: $QA_DIR/qa.json)"
[ "$PASSED" = 1 ] || { echo "error: QA failed (see $QA_DIR/qa.json)" >&2; exit 1; }
