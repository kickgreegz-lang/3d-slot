#!/usr/bin/env bash
# Dragonspire Frostfall study capture (STUDY ONLY: output in art/_reference/dragonspire/, gitignored).
# usage: run-all.sh "<fresh demo URL>" [a b c d e]   (default: all, in order a b c d e)
# extra capture.mjs flags via $DF_FLAGS, e.g. DF_FLAGS='--point spin=0.75,0.91'
# clock: $DF_CLOCK (default after-boot: with the fake clock flowing during boot the game's rAF is
# not compositor-throttled, SwiftShader falls minutes behind and every screenshot times out)
set -u
URL="$1"; shift
SEGS="${*:-a b c d e}"
REPO="$(cd "$(dirname "$0")/../../../.." && pwd)"
HERE="$(cd "$(dirname "$0")" && pwd)"
TAG="${DF_TAG:-$(date +%m%d-%H%M)}"
declare -A SCRIPT=([a]=df-a-intro-idle [b]=df-b-normal [c]=df-c-turbo [d]=df-d-quickstop [e]=df-e-bonus)
mkdir -p "$REPO/art/_reference/dragonspire"; cd "$REPO"
for s in $SEGS; do
  run="${TAG}-${s}-${SCRIPT[$s]#df-?-}"
  echo "=== $s -> art/_reference/dragonspire/$run"
  node tools/reference/capture.mjs --url "$URL" --script "$HERE/${SCRIPT[$s]}.mjs" --game dragonspire --run "$run" \
    --viewport 1280x720 --jpeg 85 --clip canvas --video --clock "${DF_CLOCK:-after-boot}" ${DF_FLAGS:-} 2>&1 | tee "$REPO/art/_reference/dragonspire/$run.log"
  st=$(node -e "try{console.log(require('$REPO/art/_reference/dragonspire/$run/run.json').status)}catch{console.log('missing')}")
  echo "=== $s status: $st"
  if grep -q "RGS authenticate failed" "$REPO/art/_reference/dragonspire/$run.log"; then echo "session dead: stopping"; exit 2; fi
done
