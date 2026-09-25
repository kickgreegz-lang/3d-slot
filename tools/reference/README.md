# tools/reference: capture third-party slot demos for study

> **Reference only.** These tools record frames, timings and network traffic from *other studios'
> public demo games* so we can study animation timing, pacing and presentation design. Nothing
> captured here is ours. It must **never be shipped, committed to `main`, redistributed, traced
> or used as a production asset**. Output goes to `art/_reference/`, which is gitignored.
> `--save-assets` downloads copyrighted files. Keep them on your machine for study and delete
> them when you are done. Treat the RGS logs the same way: they describe another company's
> product. Timing curves, notes and our own re-implementations are fine to keep. The captured
> pixels and files are not.

| Tool | What it does |
|---|---|
| `capture.mjs` | Opens a demo URL in Chromium and runs a script (click, key, wait, capture). It can step the game's clock frame by frame, so every captured frame is exactly 1000/60 ms of game time apart, however slowly the machine renders. It saves frames, screenshots, contact sheets, MP4s, `segments.json`, `network.json`, RGS request/response bodies and an asset list. |
| `timings.mjs` | Takes a capture (or any PNG/JPEG folder or video) and computes how much each frame changed from the previous one, overall and per region or reel column. It writes a CSV, `events.json` and an SVG plot. It also detects spin start, each reel stop, the landing tail and the win-flash cadence. |
| `postprocess.mjs` | Rebuilds contact sheets, grid overlays, MP4s and `index.html` for an existing run. |
| `test/run-tests.mjs` | End-to-end tests against local fixture pages (clock exactness plus a mock Stake-style slot). |

## Quick start on your own machine

You need Node ≥ 22.12 and the repo's dev dependencies (`pnpm install`). Playwright is one of
them. On a machine without this container's preinstalled Chromium, run once:

```bash
npx playwright install chromium
```

Then:

```bash
# 1. Calibration run: boots the game and saves screenshots with a 0..1 coordinate grid.
node tools/reference/capture.mjs --probe --url "https://paperclip.live.engine.io/dragonspire-frostfall/v7/?sessionID=...&rgs_url=rgsd.engine.io&lang=en&currency=USD&device=desktop&social=false&demo=true"
#    open art/_reference/dragonspire-frostfall/<run>/shots/*.grid.png and read off where the
#    spin / turbo / menu / info / close buttons are (x,y as fractions of the game canvas).

# 2. The full tour (default script), with your button positions:
node tools/reference/capture.mjs --url "<same url>" --run tour1 --video \
     --point turbo=0.66,0.91 --point menu=0.04,0.93 --point info=0.5,0.4 --point close=0.96,0.05

# 3. Timing analysis. Put the reel grid rect (from the grid screenshot) in --regions:
node tools/reference/timings.mjs art/_reference/dragonspire-frostfall/tour1 \
     --regions '{"grid":[0.25,0.14,0.5,0.62]}' --columns 5
```

Open `art/_reference/<game>/<run>/index.html` to browse the sheets, videos, screenshots and RGS
calls. `timings/timings.svg` has a hover crosshair.

Use a **fresh demo URL**, because `sessionID`s expire. The default viewport is 1920×1080.
Full-length PNG runs at that size need several GB, so add `--jpeg 90` (about 10× smaller) or
`--viewport 1280x720` when disk space or upload size matters. Add `--frames-scale 0.2` for a
quick smoke run of any script.

On a machine with a GPU, add `--headed` (a visible window) or `--gpu` (headless, hardware
WebGL). Frames are still virtual-time exact, and capture runs several times faster than
SwiftShader. `--channel chrome` uses your installed Google Chrome instead, which has
proprietary audio/video codecs.

Run `node tools/reference/capture.mjs --help` for every option.

### Behind a proxy (including this repo's Claude Code sandbox)

- A failed-request summary at the end of a run such as
  `paperclip.live.engine.io net::ERR_TUNNEL_CONNECTION_FAILED ×1` means the egress proxy blocks
  that host. **Every** host the game touches has to be allowed: the game page, the `rgs_url` host
  (e.g. `rgsd.engine.io`), and any asset/CDN/font host. `network.json` lists them all.
- TLS-inspecting proxies: Chromium uses its own trust store, not `SSL_CERT_FILE`, so
  `capture.mjs` pins the proxy CA's public key (`--ignore-certificate-errors-spki-list`). Only
  certificates issued by that CA are affected; every other site still verifies normally. In
  the Claude Code sandbox this happens automatically, using only the proxy/interception CAs from
  `/root/.ccr/ca-bundle.crt`. Behind a corporate proxy, pass `--trust-ca corp-proxy-ca.pem`.
- Capturing a local dev server (for example this repo's own game on Vite): add `--stub-ws`, or
  Vite's HMR reloads the page whenever a source file changes and the run stops.

## Sharing a capture (upload)

Raw frames are big. The MP4s (`--video`) hold the same frames in a far smaller file.
`ffmpeg -i video/04-spin-01.mp4 f%05d.png` turns them back into frames for `timings.mjs`, or
run `timings.mjs video/04-spin-01.mp4` on the video directly. To share:

```bash
cd art/_reference
zip -r dragonspire-frostfall-tour1.zip dragonspire-frostfall/tour1 -x '*/frames/*' '*/assets/*'
#   or: tar czf dragonspire-frostfall-tour1.tgz --exclude=frames --exclude=assets dragonspire-frostfall/tour1
```

Then either **attach** the zip, or commit it to a **throwaway branch that is never merged**:

```bash
git switch -c reference/dragonspire-frostfall
git add -f art/_reference/dragonspire-frostfall/tour1 ':!*/frames/*' ':!*/assets/*'
git commit -m "reference capture (study only, do not merge)" && git push -u origin HEAD
```

GitHub rejects files over 100 MB. Keep MP4s per segment (the default) or use `--jpeg`.
**Never include `assets/`** (the downloaded game files) in anything you upload.

## Outputs (`art/_reference/<game>/<run>/`)

| Path | Contents |
|---|---|
| `frames/f%05d.png` | Captured frames. The number is the **virtual frame index** since the first pause, and gaps are uncaptured frames. `.jpg` with `--jpeg`. |
| `frames.json` | `{file, frame, t, seg}` per captured frame. `t` = virtual ms since frame 0. |
| `segments.json` | `segments[]` (name, type `frames`/`hold`/`realtime`, `frameStart`–`frameEnd`, `tStart`–`tEnd`, `every`, `captured`, `notes`, `sheet`, `video`), `actions[]` (every click/key/wheel with frame and t), `shots[]`. |
| `segments/NN-name/sheet.png` | Contact sheet: up to `--sheet-max` (60) evenly spaced tiles, `--sheet-cols` (8) columns, `#frame t ms +ms-into-segment` under each tile. |
| `shots/NNN-name.png` | Full screenshots. Also `*.grid.png` with the 0..1 canvas grid when the step has `"grid": true`. |
| `video/NN-name.mp4`, `video/all.mp4` | `--video`: H.264 at 60 fps, played back in **real time** (an every-3rd frame is held for 3/60 s). `all.mp4` shortens uncaptured waits to 0.1 s. |
| `network.json` | Every request: url, method, resourceType, status, mime, encoded size, wall start/end, virtual frame/t, failures, websockets. |
| `rgs/NNNN-<endpoint>.json` | RGS calls (`wallet/authenticate`, `play`, `end-round`, `balance`, `bet/event`, `bet/replay`, and anything else on the `rgs_url` host), with the **parsed request and response bodies** and the frame when the call was sent and answered. |
| `rgs/summary.json` | Per round: book event types in order, `typeCounts`, and `fieldsByType` (the union of fields seen per book event type). Together these document the game's book format. |
| `assets.json` | Asset URLs classified as `spine-json`, `spine-skel`, `atlas`, `texture-atlas-json`, `image`, `texture`, `audio`, `font`, `video`, `json`, and so on. With `--save-assets` they are also saved under `assets/<host>/<path>`, with a `STUDY-ONLY.txt` note. |
| `console.txt`, `run.json` | Page console with frame stamps; run metadata (clock mode, base ticks, canvas rect, stats, warnings, page errors). |
| `timings/` | Written by `timings.mjs`. |

The `sessionID` is replaced by `<sessionID>` in every file unless you pass `--no-redact`.

## How the frame-exact clock works (and its limits)

`--clock virtual` is the default. It calls `context.clock.install()` (Playwright's Clock API)
**before navigation**. Time flows normally while the game boots. The first click, key press or
`frames` step pauses it with `clock.pauseAt()`. After that, each frame is
`clock.runFor(Δ)` (setTimeout/setInterval, `Date`, `performance.now`, `Event.timeStamp`) followed
by **exactly one** flush of the game's `requestAnimationFrame` queue.

A small init script (`lib/shim.mjs`) owns that queue. Playwright's own fake rAF fires on a fixed
16 ms grid, which would give 0 or 2 game frames per captured frame. The shim also covers code
that cached `window.requestAnimationFrame` or `Date.now` early; GSAP does both.

- Frame *n* is at `t = round(n·1000/60)` ms. Playwright's clock counts in whole milliseconds,
  so steps go 17, 16, 17… and **never drift**: every 60 frames are exactly 1000 ms, and every
  3 frames exactly 50 ms. The tests verify this from the pixels: 2D, WebGL, and 120 ms of real
  render time per frame.
- Render speed does not matter. SwiftShader at about 1 fps produces the same frames as a GPU.
- **Network is not virtual.** By default (`--no-net-sync` turns this off), before each frame the
  driver waits for any in-flight fetch/XHR (up to 5 s, `--net-sync-timeout`). An RGS reply
  therefore arrives within 1–2 virtual frames of the request, on every machine and every run.
  "Reel spin loop until the RGS answers" then shows as the shortest loop the game allows, so
  measure stop sequences from the first stop, not from the click. `rgs/*.json` records both
  frames.
- Not virtualised: CSS animations/transitions, `<video>`, `AudioContext.currentTime`, Web
  Workers' own timers, and `performance` objects cached before the clock was installed.
  Most Pixi/Spine/GSAP slots drive everything from rAF, `Date` and `performance.now`, so this
  rarely matters. If a DOM overlay (loading screen, HTML paytable) animates, its capture is
  wall-clock based.
- `waitReady` and `waitReal` let the clock run in real time, for boot and mid-game loading.

**If the game will not boot or misbehaves under the virtual clock**, try these in order:

| Mode | Boot | Frame-exact? | Trade-offs |
|---|---|---|---|
| `--clock virtual` (default) | fake timers flowing in real time | yes, from the first action | Boot runs on Playwright's fake timers. `performance.getEntries*/mark/measure` are stubbed (return nothing), which trips a few analytics/boot libraries. |
| `--clock after-boot` | 100% native | yes, from the first action | The clock is installed into the live page at the first action. The time bases are shifted so `Date.now()` and `performance.now()` stay continuous (Pixi's ticker ignores time going backwards). Timers scheduled **before** that moment still fire on wall-clock time until they re-arm. `performance`/`performance.now` references cached during boot stay native (the shim covers rAF and `Date.now` only). |
| `--clock realtime` / `--realtime` | 100% native | **no** | No clock at all. `frames` records a CDP screencast for n/60 s of wall time (frame numbers come from real timestamps), falling back to a screenshot loop. You get whatever the machine renders: 1–5 fps under SwiftShader, and usually 30–60 fps with `--headed`/`--gpu` on a real GPU. Timing precision is limited to the screencast cadence. |

## Scripts

Pass `--script <name|path>`. Names resolve in `tools/reference/scripts/`: `stake-default`
(the default) and `probe` (the same as `--probe`). Scripts are JSON, or `.mjs` for full
control. **Points** are fractions of the game canvas, `[0,0]` top-left to `[1,1]`
bottom-right, and the driver maps them to the canvas's page rect (the largest `<canvas>`,
iframes included).

```jsonc
{
  "name": "my-game",
  "viewport": "1920x1080",
  "points":  { "spin": [0.5, 0.9], "turbo": [0.62, 0.9] },   // override per run: --point spin=0.52,0.88
  "regions": { "grid": [0.25, 0.14, 0.5, 0.62] },           // picked up by timings.mjs automatically
  "columns": 5,                                              // -> grid.c1..grid.c5
  "steps": [
    { "do": "waitReady", "response": "/wallet/authenticate" },
    { "do": "click", "at": [0.5, 0.5] },
    { "do": "frames", "name": "intro-out", "n": 90, "every": 1 },
    { "do": "repeat", "times": 3, "steps": [
      { "do": "key", "key": "Space", "note": "spin {i}" },
      { "do": "frames", "name": "spin-{i}", "ms": 6000, "every": 3,
        "untilStill": { "threshold": 0.8, "frames": 60, "minFrames": 120 } }
    ] }
  ]
}
```

| Step | Fields | Meaning |
|---|---|---|
| `waitReady` | `timeout` 120000, `quietMs` 1500 (0 = ignore network), `minMs`, `response` (URL substring), `canvasMinArea` 0.3 | Clock runs in real time until the canvas is at least this fraction of the viewport, has visibly painted, the network has been quiet for `quietMs`, and `response` has been seen. It warns and continues on timeout. |
| `frames` | `name`, `n` or `ms`, `every` (1), `notes`, `untilStill` | Step `n` frames and capture every `every`-th one, as one **segment** (one sheet, one MP4). `untilStill` ends it early once the frame stays nearly unchanged (mean abs diff < `threshold`) for `frames` frames (PNG only). |
| `wait` / `hold` | `ms` or `n`, `name` | Advance time frame by frame without capturing (it still renders every frame, so tweens behave). |
| `waitReal` | `ms` | Let the clock run in real time, then pause again. Use it for mid-game asset loading. |
| `click` | `at`, `button`, `holdMs`, `note` | Mouse down and up at a point. `holdMs` keeps the button down for that many ms of *virtual* time (long-press). |
| `key` | `key` (Playwright key name: `Space`, `Enter`, `Escape`, `KeyT`), `holdMs`, `note` | Key down and up. |
| `wheel` | `at`, `dy`, `dx` | Mouse wheel at a point (scrolling paytables). |
| `move` | `at` | Hover. |
| `screenshot` | `name`, `grid` | Full screenshot into `shots/`. `grid: true` also writes the coordinate-grid version. |
| `repeat` | `times`, `start` (1), `steps` | `{i}` in names and notes is replaced by the index, zero-padded. |
| `note`, `eval`, `pause`, `resume` | `text` / `js` | Timeline marker; run JS in the page (do not await timers while paused, because they are frozen); explicit clock control. |

`.mjs` scripts are either `export default { ...same JSON... }` or a function:

```js
export const meta = { viewport: '1920x1080', points: { spin: [0.5, 0.9] } };
export default async function (ref) {
  await ref.waitReady({ response: '/wallet/authenticate' });
  await ref.click([0.5, 0.5]);
  for (let i = 1; i <= 5; i++) {
    await ref.key('Space');
    await ref.frames(`spin-${i}`, 360, { every: i === 1 ? 1 : 3 });
  }
  // ref.page is the raw Playwright page; ref.step() advances exactly one frame.
}
```

### The default script (`scripts/stake-default.json`)

The run goes: boot (waits for the `/wallet/authenticate` response) → grid screenshot → the
intro screen for 1 s → click "press to continue" and capture the transition at every frame
(1.5 s) → idle 3 s → **spin-01 at every frame for 6 s** → spins 02–11 at every 3rd frame (6 s
each) → click turbo → 5 turbo spins (4 s each, every 3rd frame) → turbo off → menu → info /
paytable, then 5× (wheel + screenshot) → Escape and close.

Its button points are **guesses** for a 16:9 desktop Stake-style layout, so calibrate them with
`--probe` first. A wrong turbo/menu point only makes that click miss or hit a neighbouring
control. It uses Space to spin. If the game has the spacebar disabled, copy the script and
replace `{"do":"key","key":"Space"}` with `{"do":"click","at":"spin"}`.

**Tip:** Stake Engine **replay URLs** (`...&replay=true&game=<g>&version=<v>&mode=<m>&event=<id>`)
replay one specific recorded round with no session. They are the most reliable way to capture
a particular bonus or big win deterministically. The replay fetch is logged under `rgs/`.

## timings.mjs

```bash
node tools/reference/timings.mjs <runDir | framesDir | video.mp4> \
  [--regions '{"grid":[x,y,w,h]}' | --regions regions.json] [--columns 5] [--columns-of grid] \
  [--segment spin-01,spin-02] [--width 320] [--fps 60] [--frac 0.15 | --threshold 3] [--min-spin 150] [--out dir]
```

- **Energy** is the mean absolute RGB difference (0–255) between consecutive *captured* frames
  of a segment. It is computed on frames area-averaged to `--width` px, with a worker pool.
  Regions are normalised to the **game canvas** (the canvas rect is in `run.json`). For plain
  folders and videos they are normalised to the image. Each segment starts a new diff chain,
  and `gap_frames` in the CSV shows the stride.
- `timings.csv`: one row per frame, one column per series (`full`, each region, `grid.c1…cN`).
- `events.json`, per segment and per series: activity threshold, **bursts** (start, last
  motion, peak) and **peaks**. The summary per segment gives:
  - `firstMotionMs`
  - `columnStops[]`: the last motion of each column's first ≥`--min-spin` ms burst after the
    spin input. This is when the reel's landing/bounce drops below the threshold.
  - `stopGapsMs`
  - `flashPeakSpacingMs`: the median spacing of diff peaks after the last stop. A blink cycle is
    2× this, because diff peaks fire on both "on" and "off".
  - `lastMotionMs`
- `timings.svg`: small multiples, one panel per segment (x = ms into the segment). Inputs are
  marked with ▼ and detected stops with ●. Hover shows exact values.

Thresholds are `p10 + 0.15·(p98 − p10)` of each series over the **whole input**, so a segment
where a reel spins most of the time does not set its own "quiet" level. Override them with
`--threshold` or `--frac`.

**Tumble/cascade games:** a column's first burst is usually the old symbols *leaving*, so
`columnStops` marks the end of the exit stagger. Read the later bursts in `events.json`
(`series["grid.cN"].bursts`) for the drop-in and each cascade step.

**Video input is approximate.** H.264 noise raises the floor, so absolute stop times can read
a few frames late. Gaps and cadence hold up. Prefer the PNG frames when you have them.

**Precision follows the capture stride.** Measure stop timings and bounces on every-frame
segments (±1 frame). Every-3rd segments resolve 50 ms steps, which is fine for durations and
cadence but not for turbo stop gaps of about 60 ms. These are heuristics for finding the
interesting frames fast. Confirm on the contact sheet or the frames.

## Tests

```bash
node tools/reference/test/run-tests.mjs            # all (about 9 min under SwiftShader)
node tools/reference/test/run-tests.mjs --only clock-virtual,mock
node tools/reference/test/serve.mjs --port 8765    # fixtures by hand: /anim.html, /mock-slot.html?sessionID=x&rgs_url=127.0.0.1:8765/rgs
```

- `test/anim.html` barcodes `performance.now()`, the rAF timestamp, the rAF count and a *cached*
  `Date.now` into every frame. The test reads them back from the PNGs. `?slow=MS` makes every
  frame really take MS of wall time, via a sync XHR.
- `test/mock-slot.html` is a Stake-shaped slot: intro, Space to spin, turbo, menu/paytable with
  wheel paging. It uses the RGS endpoints and assets served by `test/serve.mjs`, and it posts
  its own ground-truth timeline in `/bet/event`, which the test compares with what
  `timings.mjs` detects.

## Troubleshooting

- **The canvas never becomes "ready"**: check `console.txt` and the `boot` screenshot, and raise
  `timeout`. Games that keep streaming assets need `quietMs: 0` or a `response` match.
- **The game hangs or errors under the virtual clock**: use `--clock after-boot`, then `--realtime`
  (see the trade-offs above).
- **Clicks miss**: calibrate with `--probe` and the `*.grid.png` shots. Points are relative to the
  largest canvas, not the viewport.
- **"HeadlessChrome" blocked**: the user agent already reports plain Chrome. Try `--headed`.
- **Audio/video codec errors**: `--channel chrome`.
- **The run ends with "page reloaded/navigated at frame N"**: a new document mid-capture would
  reboot under a paused clock, so the run stops and keeps the outputs up to that frame. When
  the cause is a local dev server's HMR (Vite/webpack), pass `--stub-ws`.
- **Ctrl-C** stops after the current frame and still writes every output. Press it again to quit
  immediately.
