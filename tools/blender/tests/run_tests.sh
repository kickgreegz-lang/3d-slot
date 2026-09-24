#!/usr/bin/env bash
# run_tests.sh — end-to-end verification of tools/blender + tools/gltf (headless, CPU only).
#
#   BPY_PYTHON=~/.venvs/bpy/bin/python tools/blender/tests/run_tests.sh            # full (~3 min on 4 CPUs)
#   tools/blender/tests/run_tests.sh --quick --out art/_work/test_run --shots /tmp/shots
#
# Env: BPY_PYTHON (python with bpy 5.2.2; default python3), SLOT_PYTHON (numpy+Pillow python for
# pure post steps; default python3), THREADS (render threads; default 0 = all).
# Everything is written under --out (default art/_work/test_run, gitignored). Exit 0 = all green.
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$REPO"
TB=tools/blender
PY="${BPY_PYTHON:-python3}"
POST="${SLOT_PYTHON:-python3}"
THREADS="${THREADS:-0}"
OUT=art/_work/test_run
SHOTS=""
QUICK=0
while [ $# -gt 0 ]; do
  case "$1" in
    --quick) QUICK=1; shift ;;
    --out) OUT="$2"; shift 2 ;;
    --shots) SHOTS="$2"; shift 2 ;;
    -h|--help) sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option $1" >&2; exit 1 ;;
  esac
done
SHOTS="${SHOTS:-$OUT/shots}"
if [ $QUICK = 1 ]; then SIZE=128; FRAMES=8; SPP=8; else SIZE=256; FRAMES=24; SPP=16; fi
mkdir -p "$OUT" "$SHOTS"
NOISE='^Fra:|Saved:|^ Time|Sample |Synchroniz|Initializ|Loading|Updating|Compil|Waiting|Finished$|Rendering|Remaining|INFO|Draco is not|MeshOptimizer is not|^Info:|Baking animation|^$|^❯|^✔|warn: instance'
PASS=0; FAILS=()

run() {  # run <expected rc> <label> <cmd...>
  local want="$1" label="$2"; shift 2
  local log="$OUT/logs/$(echo "$label" | tr -c 'A-Za-z0-9_.-' '_').log"
  mkdir -p "$OUT/logs"
  echo "=== $label"
  set +e; "$@" > "$log" 2>&1; local rc=$?; set -e
  { grep -v -E "$NOISE" "$log" || true; } | tail -n 14 | sed 's/^/    /'
  if [ "$rc" = "$want" ]; then PASS=$((PASS + 1)); echo "    -> ok (exit $rc)";
  else FAILS+=("$label (exit $rc, want $want)"); echo "    -> FAILED (exit $rc, want $want; log $log)"; fi
}

# 1. pure-Python units
run 0 "unit tests" "$POST" $TB/tests/test_units.py

# 2. --help in both invocation styles
for s in render_symbol build_actions cleanup_mascot turntable export_glb frames_post sheet_post; do
  run 0 "help $s (python)" "$PY" $TB/$s.py --help
done
run 0 "help render_symbol (blender argv)" "$PY" $TB/tests/sim_blender.py $TB/render_symbol.py -- --help
run 0 "help optimize.sh" bash tools/gltf/optimize.sh --help
run 0 "help budget.mjs" node tools/gltf/budget.mjs --help

# 3. baked symbol inserts (Cycles CPU emission toon = deterministic reference)
R="$PY $TB/render_symbol.py --threads $THREADS --samples $SPP"
run 0 "K royal turn ${SIZE}px ${FRAMES}f" $R --glyph K --clip turn --size $SIZE --frames $FRAMES \
  --out $OUT/frames/L2_turn --qa-dir $OUT/qa/L2_turn --work $OUT/raw/L2_turn
run 0 "coin spin ${SIZE}px ${FRAMES}f" $R --sym coin --proc coin --clip spin --size $SIZE --frames $FRAMES \
  --out $OUT/frames/coin_spin --qa-dir $OUT/qa/coin_spin --work $OUT/raw/coin_spin
run 0 "A shatter" $R --glyph A --clip shatter --size 160 \
  --out $OUT/frames/L1_shatter --qa-dir $OUT/qa/L1_shatter --work $OUT/raw/L1_shatter
run 0 "Q land" $R --glyph Q --clip land --size 160 \
  --out $OUT/frames/L3_land --qa-dir $OUT/qa/L3_land --work $OUT/raw/L3_land
run 0 "gem turn (convex, even-offset hull)" $R --sym gem --proc gem --clip turn --size 160 --frames 12 --color '#35F2E0' --shade '#0B3B52' \
  --out $OUT/frames/gem_turn --qa-dir $OUT/qa/gem_turn --work $OUT/raw/gem_turn
run 0 "K static (frame-1 reference)" $R --glyph K --clip static --size $SIZE \
  --out $OUT/frames/L2_static --qa-dir $OUT/qa/L2_static --work $OUT/raw/L2_static
run 0 "K turn frame 1 == static sprite" $R --glyph K --clip turn --size $SIZE --frames 4 \
  --static $OUT/frames/L2_static/L2_static_0001.png \
  --out $OUT/frames/L2_turn4 --qa-dir $OUT/qa/L2_turn4 --work $OUT/raw/L2_turn4
run 3 "gate failure: Q counter closed by a full-width hull" $R --glyph Q --clip static --size 160 --counter-outline 1.0 \
  --out $OUT/frames/L3_bleed --qa-dir $OUT/qa/L3_bleed --work $OUT/raw/L3_bleed
run 0 "blender-binary argv + no Pillow (subprocess post)" "$PY" $TB/tests/sim_blender.py $TB/render_symbol.py -- \
  --glyph J --clip static --size 128 --samples 4 --out $OUT/frames/L4_static --qa-dir $OUT/qa/L4_static --work $OUT/raw/L4_static
run 1 "path-like --sym is refused" $R --sym ../escape --glyph K --clip static --dry-run
# --work must only lose the render's own scratch files, never unrelated content
mkdir -p $OUT/raw/L4_keep && echo keep > $OUT/raw/L4_keep/keep.txt
run 0 "render into a --work folder with foreign files" $R --glyph J --clip static --size 128 --samples 4 \
  --out $OUT/frames/L4_keep --qa-dir $OUT/qa/L4_keep --work $OUT/raw/L4_keep
run 0 "foreign file in --work survived" test -f $OUT/raw/L4_keep/keep.txt
# determinism: an identical re-render into a second folder must match frame by frame
run 0 "coin spin re-render (determinism)" $R --sym coin --proc coin --clip spin --size $SIZE --frames $FRAMES \
  --out $OUT/frames/coin_spin_b --qa-dir $OUT/qa/coin_spin_b --work $OUT/raw/coin_spin_b
run 0 "coin spin frames identical" "$POST" $TB/tests/compare_frames.py $OUT/frames/coin_spin $OUT/frames/coin_spin_b
run 0 "K turn re-render (determinism)" $R --glyph K --clip turn --size $SIZE --frames $FRAMES \
  --out $OUT/frames/L2_turn_b --qa-dir $OUT/qa/L2_turn_b --work $OUT/raw/L2_turn_b
run 0 "K turn frames identical" "$POST" $TB/tests/compare_frames.py $OUT/frames/L2_turn $OUT/frames/L2_turn_b
# idempotency: re-running into the same folder keeps the manifest row (id + date) unchanged
cp $OUT/qa/L2_static/manifest.json $OUT/qa/L2_static.first.json
run 0 "K static re-run in place" $R --glyph K --clip static --size $SIZE \
  --out $OUT/frames/L2_static --qa-dir $OUT/qa/L2_static --work $OUT/raw/L2_static
run 0 "K static manifest row unchanged" cmp $OUT/qa/L2_static.first.json $OUT/qa/L2_static/manifest.json

# 4. mascot animation from JSON on the CC0 placeholder
ROBOT=public/assets/characters/placeholder/RobotExpressive.glb
run 0 "anim JSON --check" "$POST" $TB/build_actions.py --check $TB/examples/celebrate_test.json
run 0 "build_actions celebrate_test -> GLB" "$PY" $TB/build_actions.py --glb $ROBOT $TB/examples/celebrate_test.json \
  --describe $OUT/anim/robot_rig.json --out-blend $OUT/anim/robot_celebrate_test.blend \
  --export-glb $OUT/anim/robot_celebrate_test.glb
run 0 "clip contact sheet" "$PY" $TB/turntable.py $OUT/anim/robot_celebrate_test.glb --action celebrate_test --frames 8 \
  --yaw 25 --size 256 --threads $THREADS --out "$SHOTS" --recolor 'Main=#3F9D3A,Grey=#2B6B2A,Black=#15101C'
run 0 "export_glb: only the clip + bone rename" "$PY" $TB/export_glb.py --blend $OUT/anim/robot_celebrate_test.blend \
  --out $OUT/anim/robot_celebrate_only.glb --actions celebrate_test --rename-map '{"Head":"head","Neck":"neck"}'
run 0 "exported GLB has clip/morph/renamed bones" node tools/gltf/budget.mjs $OUT/anim/robot_celebrate_only.glb \
  --require-clips celebrate_test --require-morphs Surprised
run 0 "renamed joints present" "$POST" -c "import json,sys; d=json.load(open('$OUT/anim/robot_celebrate_only.export.json')); \
sys.exit(0 if {'head','neck'} <= set(d['jointNames']) and d['animations']==['celebrate_test'] else 1)"

# Rigify rename: a generated Rigify rig has control bones called hips/chest/neck/head, so the
# DEF-* -> runtime renames must not end up as 'hips.001' (three.js: 'hips001', never found)
run 0 "Rigify fixture (generated rig)" "$PY" $TB/tests/make_rigify_fixture.py --out $OUT/fixtures/rigify_rig.blend
run 0 "export_glb --rigify-names on a generated Rigify rig" "$PY" $TB/export_glb.py --blend $OUT/fixtures/rigify_rig.blend \
  --out $OUT/anim/rigify_renamed.glb --rigify-names
run 0 "Rigify runtime names exact (no .001)" "$POST" -c "import json,sys; j=json.load(open('$OUT/anim/rigify_renamed.export.json'))['jointNames']; \
bad=[n for n in j if '.' in n or n.startswith('DEF-')]; need={'hips','spine','chest','neck','head'}; print(len(j),'joints; missing',need-set(j),'bad',bad[:5]); \
sys.exit(0 if need <= set(j) and not bad else 1)"

# 5. vendor-mesh cleanup + bake-off turntables
run 0 "fixtures" "$PY" $TB/tests/make_fixtures.py --out $OUT/fixtures
run 0 "cleanup fixture (46k tris, baked-light texture)" "$PY" $TB/cleanup_mascot.py $OUT/fixtures/fixture_mascot.glb \
  --out $OUT/mascots/clean_fixture.glb --height 1.8 --target-tris 14000 --colors 5 --strict
run 0 "turntable raw candidate" "$PY" $TB/turntable.py $OUT/fixtures/fixture_mascot.glb --out "$SHOTS" --name raw_fixture \
  --size 256 --threads $THREADS
run 0 "turntable cleaned candidate" "$PY" $TB/turntable.py $OUT/mascots/clean_fixture.glb --out "$SHOTS" --name clean_fixture \
  --size 256 --threads $THREADS
run 0 "cleanup rigged placeholder (43 bones, morphs, rigid parts)" "$PY" $TB/cleanup_mascot.py $ROBOT \
  --out $OUT/mascots/clean_robot.glb --height 1.8 --colors 4 --strict
run 0 "cleanup leaves unreduced low-poly parts unrelaxed" "$POST" -c "import json,sys; r=json.load(open('$OUT/mascots/clean_robot.report.json')); \
print('reduce', r['reduce']['method'], 'relaxed', r['relax']['meshes']); sys.exit(0 if r['reduce']['method'] is None and not r['relax']['meshes'] else 1)"
run 0 "turntable cleaned rig posed (Wave f20)" "$PY" $TB/turntable.py $OUT/mascots/clean_robot.glb --pose Wave --frame 20 \
  --angles 4 --size 192 --threads $THREADS --out "$SHOTS" --name clean_robot_wave
run 0 "prop GLB through render_symbol --mesh" $R --sym jar --mesh $OUT/fixtures/fixture_prop.glb --clip turn --size 128 --frames 8 \
  --out $OUT/frames/jar_turn --qa-dir $OUT/qa/jar_turn --work $OUT/raw/jar_turn

# 6. glTF optimise + validate + budget gate
run 0 "optimize RobotExpressive" bash tools/gltf/optimize.sh $ROBOT $OUT/gltf/RobotExpressive.opt.glb --report-dir $OUT/gltf/robot
run 0 "optimize exported clip GLB" bash tools/gltf/optimize.sh $OUT/anim/robot_celebrate_test.glb $OUT/gltf/robot_celebrate_test.opt.glb \
  --report-dir $OUT/gltf/robot_celebrate --require-clips celebrate_test --require-morphs surprised
run 0 "optimize cleaned fixture (WebP palette)" bash tools/gltf/optimize.sh $OUT/mascots/clean_fixture.glb $OUT/gltf/clean_fixture.opt.glb \
  --report-dir $OUT/gltf/clean_fixture --max-draw-calls 2
run 3 "budget breach: raw 46k-tri candidate" bash tools/gltf/optimize.sh $OUT/fixtures/fixture_mascot.glb $OUT/gltf/raw_fixture.opt.glb \
  --report-dir $OUT/gltf/raw_fixture
run 3 "budget breach: --mascot preset on the placeholder" bash tools/gltf/optimize.sh $ROBOT $OUT/gltf/robot_mascot_gate.opt.glb \
  --report-dir $OUT/gltf/robot_mascot_gate --mascot
run 1 "optimize failure never keeps a stale output" bash tools/gltf/optimize.sh $ROBOT $OUT/gltf/RobotExpressive.opt.glb \
  --report-dir $OUT/gltf/robot_bad --texture-compress bogus
cp $OUT/gltf/RobotExpressive.opt.glb $OUT/gltf/RobotExpressive.opt.first.glb
run 0 "optimize is deterministic" bash -c "bash tools/gltf/optimize.sh $ROBOT $OUT/gltf/RobotExpressive.opt.glb \
  --report-dir $OUT/gltf/robot >/dev/null && cmp $OUT/gltf/RobotExpressive.opt.glb $OUT/gltf/RobotExpressive.opt.first.glb"

# 7. every sidecar manifest row validates against art/manifest.schema.json
run 0 "manifest sidecars validate" "$POST" -c "
import json, glob, sys
sys.path.insert(0, 'tools/blender')
from slotbl import provenance
files = glob.glob('$OUT/**/*manifest.json', recursive=True)
rows = [r for f in files for r in json.load(open(f))['rows']]
errs = provenance.validate_rows(rows)
print(len(files), 'sidecars', len(rows), 'rows', 'OK' if not errs else errs[:5])
sys.exit(1 if errs or not rows else 0)"

echo
echo "passed $PASS, failed ${#FAILS[@]}"
for f in "${FAILS[@]+"${FAILS[@]}"}"; do echo "  FAILED: $f"; done
echo "outputs: $OUT (frames/, qa/, anim/, mascots/, gltf/, logs/), sheets: $SHOTS"
[ ${#FAILS[@]} -eq 0 ]
