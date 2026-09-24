> **Reference copy.** Copied verbatim from the 2026-09-24 multi-agent research run (see [README](README.md)). The only change: absolute paths into the temporary research workspace were replaced with `[research sandbox]/…`. Those files no longer exist. The generated 7x5 fixture books mentioned below now live in `mock/books/` in this repo. Treat this file as a historical record. The maintained docs are in `docs/`.

# critic
## gapsFilled
- No 7x5 book fixtures exist in the current upload format. The web-sdk cluster samples are legacy 7x7 books with float payoutMultiplier and winWithoutMult, so the FE cannot be built or tested against realistic data before the math exists.: I generated them. I copied math-sdk games/0_0_cluster to games/g7x5, set num_rows=[5]*7, and ran create_books(base 2000, bonus 500, batch 500, 2 threads, compression False); it took 4.0 s. The output is in the current format: reveal.board is 7 reels x 7 (5 visible + 2 padding); updateGrid.gridMultipliers is 7x5 and unpadded; winInfo/tumble/freeSpinTrigger positions use padded rows 1..5; payoutMultiplier and winWithoutMult are int x100. Event counts in 500 bonus books: updateGrid 8326, reveal 5748, winInfo 3179, tumbleBoard 3160, setWin 2325, freeSpinRetrigger 16, wincap 7. Scenario fixtures: base_fixtures.json {loss:id6, small_win_1_tumble:id0, tumble_chain:id3, fs_trigger:id8 (55 events), bigwin_L6plus:id9 (49.1x), fs_retrigger:id532, wincap:id549 (5000x)}, plus bonus_fixtures.json, books_base_200.json and books_bonus_100.json. Two setup traps: math-sdk needs Python >=3.12 (setup.py python_requires; on 3.11 utils/get_file_hash.py:36 raises SyntaxError), and it needs pip zstandard. The reels were tuned for 7 rows, so the RTP is meaningless (base ~0.2%). Use these fixtures only for FE development. To regenerate: cd [research sandbox]/msdk7/games/g7x5 && PYTHONPATH=../..:../../../pydeps python3.12 run7.py ([research sandbox]/msdk7/games/g7x5/{game_config.py,run7.py,library/books/*} ; [research sandbox]/books/g7x5/{base_fixtures.json,bonus_fixtures.json,books_base_200.json,books_bonus_100.json} ; ref/math-sdk/setup.py:6)
- When the multiplier-spot animation should fire, and what updateGrid values look like with current math, was unclear.: Observed order per free spin in the generated books: updateFreeSpin, reveal, updateGrid (current grid, all 0 on the first spin), then repeated [winInfo, updateTumbleWin, updateGrid (post-win increments), tumbleBoard], then setWin (only when win>0), then setTotalWin. Values are additive +1 per hit: the distribution runs 0,1,2,3,... with a long tail, not powers of two. The FE must therefore (a) keep lastGrid and animate only cells where next!=last (mark 0->1, upgrade n->m); (b) play that animation at the updateGrid that follows winInfo, while exploding symbols are still visible and before tumbleBoard; (c) map values to visual tiers through a configurable band table, never hard-coded powers of 2. base-game books contain no updateGrid, because math-sdk calls update_grid_mults only in run_freespin. ([research sandbox]/books/g7x5/bonus_fixtures.json ; ref/math-sdk/games/0_0_cluster/game_executables.py ; game_override.py)
- Console stripping was never verified for the Vite version actually installed. The repo pins vite ^8.3.0, and its vite.config.ts strips nothing.: Tested with vite 8.3.0. build.rolldownOptions.output.minify = {compress:{dropConsole:true, dropDebugger:true}, mangle:true} leaves 0 occurrences of 'console' in dist. esbuild:{drop:['console','debugger']} is silently ignored: console.log and console.error remain in the output. base './' emits src="./assets/index-*.js", and new URL('./x.png', import.meta.url) becomes a relative hashed asset. This also strips three.js console.warn deprecation messages, such as 'THREE.Clock deprecated' observed in r186. Add the rolldownOptions block to /home/user/3d-slot/vite.config.ts. ([research sandbox]/v8t/{vite.config.js,dist} ; /home/user/3d-slot/vite.config.ts)
- The three.js to RenderTarget to Pixi ExternalSource path was medium confidence and had never been run.: I ran it in headless Chromium 153 with SwiftShader (WebGL2) using pixi.js 8.21.0, three 0.186.0 and the repo's CC0 RobotExpressive.glb. It works: MeshToonMaterial with a 3-step gradientMap, OutlineEffect rendering inside the RT, WebGLRenderTarget with samples:4 resolved into a Pixi Sprite with scale.y=-1, composited between Pixi layers, and a Pixi UI drawn over it. glError stays 0 across frames and the only network host requested is the page host. BUG FOUND: if Pixi creates the context first (Application.init) and you then construct THREE.WebGLRenderer({canvas: app.canvas, context: app.renderer.gl}), you get GL INVALID_OPERATION 1282: 'texImage3D: FLIP_Y or PREMULTIPLY_ALPHA isn't allowed for uploading 3D textures'. The cause is that Pixi leaves UNPACK_PREMULTIPLY_ALPHA_WEBGL=true, and three's WebGLState constructor then creates default 2D-array/3D textures. Fix: call app.renderer.resetState() immediately BEFORE new THREE.WebGLRenderer(...). After that there are 0 GL errors. Pixi's context attributes: webgl2, alpha false, antialias false, stencil true, premultipliedAlpha true. ([research sandbox]/x3/src/main.ts ; [research sandbox]/x3/cap.mjs ; [research sandbox]/x3/shot_fix_1_cm_0.png ; node_modules/three/src/renderers/webgl/WebGLState.js:1130-1140,1207-1275 ; node_modules/pixi.js/lib/rendering/renderers/gl/texture/GlTextureSystem.mjs:201,420)
- No working browser or test harness was defined, and it was unknown whether WebGL screenshot tests can run in CI or in this container.: Playwright 1.63 (already a repo devDependency) driving the bundled Chromium at [research sandbox]/harness/chrome renders WebGL2 through SwiftShader. Launch args: --use-angle=swiftshader --enable-unsafe-swiftshader --use-gl=angle --no-sandbox --ignore-gpu-blocklist --in-process-gpu, with LD_LIBRARY_PATH=chrome/ss:chrome/al/lib. Use it for the approval-critical CI tests: (1) screenshots at the 7 required viewports (1200x675, 1024x576, 800x450, 400x225, 425x812, 375x667, 320x568) for each fixture book; (2) page.on('request') asserting that only the page origin and rgs_url host are ever contacted; (3) page.on('console'/'pageerror') asserting zero output in the prod build. Run one scenario per browser launch: a second newPage in --single-process mode hung. ([research sandbox]/harness/capture.mjs ; [research sandbox]/x3/cap.mjs ; ref/engine-docs/src/routes/docs/reference/dimensions/+page.svx)
- Local development against a mock RGS conflicts with the rule that rgs_url is a scheme-less hostname and the client prepends https://.: Build base = (import.meta.env.DEV && /^(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(rgs_url) ? 'http://' : 'https://') + rgs_url. In prod this collapses to https only. Mount the mock as a Vite dev-server middleware plugin at /__rgs implementing POST /wallet/authenticate|play|end-round|balance, POST /bet/event and GET /bet/replay/{game}/{version}/{mode}/{event}, with the exact response shapes (money x1e6, round.state = book.events). It should serve [research sandbox]/books/g7x5 fixtures and honour a ?book=<id>&mode=<base|bonus> override. Dev URL: http://localhost:5173/?sessionID=dev&rgs_url=localhost:5173/__rgs&lang=en&currency=USD&device=desktop. Replay: add &replay=true&game=g7x5&version=1&mode=base&event=549. (ref/ts-client/src/client.ts:48-76 (protocol option) ; ref/engine-docs/src/routes/docs/reference/url-structure/+page.svx)
- The popout sizes (400x225, 800x450) were never checked for legibility. With the 1920x1080 design space scaled by min() to 400x225 the scale is 0.208, so a 38 px value label becomes about 8 CSS px, which fails the 'popups legible' requirement.: Add a fourth design space, 'compact' = 960x540, used when the canvas is landscape and min(w,h) <= 480 (covers Popout S 400x225, Popout L 800x450 and mobile landscape). In it: cell 90, gap 3, grid 648x462, 3D mascots OFF (three is not rendered at all), and the HUD collapses to a right column 280 wide with spin, bet +/-, menu, and balance/win text at 28-32 design px (about 11.7-13 CSS px at 400x225). The other spaces are landscape 1920x1080, portrait 1080x1920 and tablet 1920x1920, following the SDK createLayout breakpoints: AR >=1.3 landscape, <=0.8 portrait, otherwise tablet. Fix the SDK isStacked bug by using ['portrait','tablet']. (ref/web-sdk/packages/utils-layout/src/createLayout.svelte.ts ; ref/engine-docs/src/routes/docs/approval/frontend-requirements/+page.svx (fastplay/popout legibility))
- The portrait layout numbers do not fit: a 136-140 px cell plus panel padding plus 50 px posts exceeds 1080 px of width.: Portrait 1080x1920: cell 132, gap 4, pitch 136. Grid 948x676 at (66,620). Panel (54,608,972,700). Frame outer about (20,556,1040,812), with 34 px posts, a 52 px beam and a 52 px sill. Mascots sit in the 150-600 band above the beam, partially occluded by it. Logo at the top (y 30-140). HUD band y 1390-1920. Minimum touch target is 150 design px, because at Mobile S (320x568) the scale is 0.296 and 150 design px is 44 CSS px. Landscape 1920x1080 keeps the reference-derived spec: cell 150, gap 4, pitch 154, grid (413,149) 1074x766, centres cx=488+154c and cy=224+154r, panel (401,137,1098,790), frame about (326,72,1260,922), logo about (592,25,741,105), mascot slots L (0,557,434,496) and R (1531,441,389,568), spin 293x271 centred (1747,800) and tilted 20 deg, autoplay (1770,636), turbo (1841,662), menu (166,712), bonus-buy (130,846), bet- (1529,1009), bet+ (1854,1009). (derived from reference-layout measurements (uniform map x*1.01266, y*1.01266+3.8) and the Mobile S 320x568 dimension)
- Unique audio is required for approval, but no brief covered where audio comes from.: The Higgsfield CLI catalog has audio models: mirelo_text_to_audio (--prompt, --duration; SFX) and sonilo_music (--prompt, --duration; music), plus seed_audio and inworld TTS for voice lines. Use mirelo for SFX drafts (0.2-4 s: land, pop, tumble, spot-upgrade, scatter land x3 with rising pitch, button clicks) and sonilo for 30-60 s loopable stems (base, anticipation, free spins, big-win tiers). Master everything locally: ffmpeg loudnorm, I=-16 for music and about -13 for SFX; trim leading silence; seam-crossfade the loops; encode .m4a (AAC) and .ogg. Confirm the commercial license covers audio outputs (ToS §4.4 covers Outputs generally). A human composer or ElevenLabs is the fallback if the quality isn't there. ([research sandbox]/hf/cli/MODELS.md:926-990)
- The dark neon-club art direction conflicts with the game-tile rules. No brief planned the tile art.: The tile is built in the ACP Tile Editor from a background (PNG/JPG), a foreground (transparent PNG), a gradient and a title layer. The background must be brighter than the Stake lobby with no dark edges, the foreground must fill the red key-focus box, and there may be no text or multipliers in either image. Produce dedicated tile art: a daytime or bright-lit version of the club background (nano_banana_2 16:9 4k, 'brightly lit, pastel neon, light edges') and a hero foreground rendered from the actual 3D mascot GLB (offscreen three render at 2048 px with a transparent background) or a nano_banana_2 key pose. Put the provider logo in Team Settings > Branding. (ref/engine-docs/src/routes/docs/approval/game-tile/+page.svx ; ref/engine-docs/static/mockchecklist.json (Game Thumbnail group))
- Using KTX2/Basis compressed textures would load transcoders from cdn.jsdelivr.net by default (pixi setKTXTranscoderPath/setBasisTranscoderPath, three KTX2Loader transcoder path), which violates the no-external-request rule.: v1 ships NO KTX2/Basis. 2D uses webp+png atlases. GLB textures use EXT_texture_webp via gltf-transform --texture-compress webp. The meshopt decoder (three/examples/jsm/libs/meshopt_decoder.module.js) embeds its wasm and makes no network fetch. If VRAM profiling later requires GPU formats, copy node_modules/pixi.js/transcoders/{ktx,basis} and three/examples/jsm/libs/basis/* into public/ and point the setters at relative paths. (asset-pipeline verdict item 6 ; node_modules/pixi.js/lib/compressed-textures/{ktx2,basis}/utils/set*TranscoderPath.mjs ; three/examples/jsm/libs)
- No decision on how to render text-heavy menus (rules, paytable, UI guide, disclaimer, autoplay and buy confirms, error modal) or on which state-machine library to use.: The in-canvas HUD is Pixi, built from a custom HexButton class (default/hover/pressed/disabled textures, GSAP scale 0.92 for 60 ms on press, 1.03 for 100 ms on hover); @pixi/ui is not needed. All modal and scrolling content is a DOM overlay (vanilla TS + CSS, self-hosted woff2 via @font-face), because native scrolling, text wrapping, i18n/social string swaps and long rules tables are far cheaper in DOM than in Pixi. Flow control is a hand-rolled typed async controller rather than xstate: states rendering|idle|spinning|presenting|autoplay|resume|replay|error, with an AbortController-style skip token. It mirrors the web-sdk bet/autoBet/resumeBet machines at about 300 LOC. (ref/web-sdk/packages/utils-xstate/src/* ; ref/math-sdk/docs/fe_docs/ui.md (SDK UI is functional but not beautiful))
- The runtime font strategy for counters and multiplier numbers was undecided (MSDF pipeline vs dynamic BitmapFont).: The repo already bundles OFL/Apache fonts as woff2: Anton, Bebas Neue, Lilita One, Luckiest Guy, Titan One (public/assets/fonts). Load them with the FontFace API, then create bitmap fonts at runtime with BitmapFont.install({name, style:{fontFamily, fontSize, fill, stroke:{color:0x000000,width}}, chars:[['0','9'],'x.,$€£¥₹₩₺ GCSC'], resolution: textureTier}), at fixed sizes: big-win counter 160, multiplier spot 72 (4 px stroke), HUD values 40. Skip the MSDF toolchain. Suggested roles: labels = Bebas Neue/Anton; values = Titan One; spot numbers and royals = Lilita One. (/home/user/3d-slot/public/assets/fonts/* (commit 8ff2340) ; pixi.js 8.21.0 BitmapFont / SplitBitmapText (lib/scene/index.d.ts:165))
- Symbol canvas size conflicts between briefs (320 px @2x vs 360x360 @2x) and the scale convention AssetPack expects.: Every symbol lives on a fixed 360x360 @2x canvas (cell 300 @2x = 150 design px), anchor (0.5,0.5). Content height: royals 255-270 px (85-90% of the cell), highs 288-300 (96-100%), specials 330-345 (110-115%, rotated -12 to -30 deg). The outline is 8 px @2x (about 2.7% of the cell), and the plum #4b283d extrusion is 12-18 px @2x toward the lower-right. AssetPack resolutions {high:2, default:1, low:0.5} treat all sources as @2x, so Spine must also be exported at scale 1.0 of the @2x art. Never export Spine at 1x into a folder that AssetPack mipmaps. (reference-layout brief (outline/extrusion measurements, corrected) ; asset-pipeline verdicts (AssetPack resolutions, Spine export scale))
- The mascot render-target size and MSAA memory were wrong in one brief and had no tiering.: Per-pixel cost of a WebGLRenderTarget with samples s = 4 + 8s bytes (resolve RGBA8 + MSAA colour + MSAA depth24s8). Desktop/high tier: 512x768 per mascot, s=4 (14.2 MB each, 28 MB for two). Mobile/low tier: 341x512, s=2 (3.5 MB each). Compact layout: not rendered at all. On low tier, render the RT every other frame (30 fps). Size the RT to min(onscreen physical height, 768). (arithmetic ; three/src/renderers/webgl/WebGLTextures.js:2104-2137 (per aaa-animation verdict))
- Quality-tier detection was undefined, although many budgets depend on it.: tier='low' if any of: navigator.deviceMemory <= 4 (where available); gl MAX_TEXTURE_SIZE < 4096; median frame time over the first 90 frames of the intro > 22 ms; iOS with screen.width <= 375. Low tier gets: resolution cap 1.5, texture resolution 1x or 0.5x, mascot RT 341x512 s2 at 30 fps, at most 400 live particles, at most 1 live filter, no idle shine shaders. Otherwise high tier gets: resolution cap 2, textures 2x when stageScale*resolution >= 1.25, mascots 512x768 s4 at 60 fps, 1000 particles, 3 filters. (aaa-animation brief (DPR, filter and particle budgets) ; asset-pipeline brief (VRAM math))
- The spot-multiplier growth rule (additive math-sdk vs doubling in the reference) and whether spots exist in the base game are undecided, and the FE tiers depend on them.: FE renders any integer through a config band table. Tiers: T0 (0) = no spot, dark tile #1f2e4d; T1 (1) = marked, teal/gold payframe glow and no number; T2 = dim number, text #67400d to #833206; T3 = red-tinted tile bottom #5c1c10 with text #b02800; T4 'hot' = full vertical fill #ae231f to #d7371a to #dc4812, soft 3-4 px rim #ff5a1e, yellow #ffcc00 text with a black stroke; T5 'blazing' = the T4 fill plus a vertical-gradient stroke (#ff6600 top, #ffcc03 sides, #ffff10 bottom), a 2 px #ffffdc specular line and an 8 px #ff7e20 outer glow. Default band thresholds [2,32,128,256,512] for doubling math, or [2,4,8,16,32] for additive math. The number is drawn BEHIND the symbol, which matches the reference. (reference-layout verdict (heat-tier colours, corrected) ; [research sandbox]/books/g7x5 (additive value distribution))
- The repo scaffold is missing pipeline dependencies and prod safety settings.: /home/user/3d-slot (commit 8ff2340) already has pixi.js ^8.21.0, three ^0.186.0, gsap ^3.15.0, @esotericsoftware/spine-pixi-v8 ^4.3.13, @pixi/sound ^6.0.1, pixi-filters ^6.1.5, vite ^8.3.0, typescript ^7.0.2 and playwright 1.63.0. To add: devDeps @assetpack/core@1.7.0 (exact pin, because of the known bugs) and @gltf-transform/cli@4.5.0. Replace the ^ ranges with exact pins for pixi.js, spine-pixi-v8 and three, since the Spine editor/runtime lock and the __webglTexture internal are version-sensitive. Add the rolldown dropConsole block to vite.config.ts. (/home/user/3d-slot/package.json ; /home/user/3d-slot/vite.config.ts)
- The frame vs symbol z-order is ambiguous: the SDK draws the frame behind symbols, while the reference-layout brief puts the frame above.: The frame goes ABOVE the board. The board is clipped by a rectangle mask (scissor, the cheapest option) to the panel opening. Anything that must spill over the frame (win pops at 1.2x, scatter lands, spot fly-outs, cluster labels) is attached to a RenderLayer 'winLayer' above the frame and detached afterwards. RenderLayer children escape ancestor filters and masks, which is intended here. (ref/web-sdk/apps/cluster/src/components/Game.svelte ; pixi.js lib/scene/layers/RenderLayer.d.ts:142-153)
- The Higgsfield tooling conflicts with the user's explicit request to use the MCP.: Two paths. Interactive and ideation work uses the MCP in claude.ai/Desktop (Customize > Connectors > Add custom connector https://mcp.higgsfield.ai/mcp) or in Claude Code (claude mcp add --transport http --scope user higgsfield https://mcp.higgsfield.ai/mcp, then /mcp, then select_workspace). Production batches use @higgsfield/cli@1.1.26, because as of 2026-09-24 the MCP has open bugs #76 (Claude Code OAuth) and #93 (generate_* schema, 'params: Invalid input'). On npm installs use 'higgsfield workspace list/set', not 'hf', which clashes with the Hugging Face CLI. Both paths feed the same art-src provenance layout. Model ids differ between MCP and CLI: MCP nano_banana_pro is CLI nano_banana_2. Resolve ids with models_explore or 'model list --json'. (higgsfield brief + verdicts ; https://github.com/higgsfield-ai/cli/issues/76 ; https://github.com/higgsfield-ai/cli/issues/93)
- GSAP, Spine and three all need a clock, and no single frame clock was defined.: Application.init({sharedTicker:true}) so Spine autoUpdate and the app share Ticker.shared. Call gsap.ticker.remove(gsap.updateRoot) and drive GSAP from Pixi with app.ticker.add(() => gsap.updateRoot(app.ticker.lastTime/1000), null, UPDATE_PRIORITY.HIGH=25). The mascot 3D pass runs at UPDATE_PRIORITY.NORMAL=0, before Application.render at LOW=-25. All gameplay tweens live on one gsap timeline 'gameTL' whose timeScale is the speed profile; UI tweens stay on the root. Pooled Spine instances use autoUpdate:false and are updated with spine.update(deltaMS/1000), since dt is in seconds. (node_modules/pixi.js/lib/ticker/const.mjs:3-7 ; lib/app/TickerPlugin.mjs:28,43 ; node_modules/gsap/dist/gsap.js:2493,3992,4025 ; spine-pixi-v8 Spine.ts:460-466)
## contradictions
- MASCOT MEDIUM: the higgsfield brief favours a 2D AI-video-to-atlas route (closest to the 2D cel reference); aaa-animation favours Spine rigs or stacked-alpha video, with real-time three.js behind a quality flag; asset-pipeline favours real-time meshopt glTF; reference-layout says a 3D mascot is only acceptable as toon ramp + outline. RESOLVED: real-time three.js toon-shaded GLB mascots, which the user asked for. They are the only 3D route that fits mobile memory: an AI-video atlas of a 3 s 512x768 clip is ~113 MB VRAM, while a GLB is ~5-6 MB for any number of clips. The shared-context path is now verified end to end. They are disabled in the compact/popout layout.
- SYMBOL ANIMATION: the higgsfield brief proposes kling3_0 AI video (start=end) for high-pay/wild/scatter internal motion; asset-pipeline and aaa-animation say Spine from stills, with AI video only for VFX. RESOLVED: shipped symbols never use AI video (outline boiling, 12.6 MB per 48-frame 256 px symbol). High pays and specials use Spine 4.3 rigs; royals use GSAP + shaders. AI video is only for VFX flipbooks and as motion reference.
- STYLE FORMULA vs REFERENCE: the higgsfield brief's formula specifies a dark-plum outer outline, a cyan rim light, glossy sheen and a consistent frontal three-quarter view. The pixel-measured reference has pure-black 3-5 px outlines, plum only in the extrusion, no rim light or neon on any foreground asset (neon only in the background), and specials rotated -12 to -30 deg. RESOLVED with a corrected formula (see art pipeline).
- KEY COLOUR: the higgsfield brief's rule defaults to #FF00FF, but its own symbol template and the asset-pipeline brief use #00FF00. RESOLVED: #00FF00 by default, because ffmpeg despill supports only green/blue and the palette is magenta/violet-heavy. Use #FF00FF for green-containing assets (e.g. a green Q royal) and #0000FF if both clash. outline_matte is key-agnostic for closed black outlines.
- ROYALS: the higgsfield brief AI-generates letters (A/K/Q/J/10 in one request); asset-pipeline builds them as vector. RESOLVED: vector geometry (deterministic weight and spelling) rendered with resvg, followed by an optional nano_banana_2 edit pass for material, then re-matting and registration back onto the vector silhouette.
- SYMBOL CANVAS: 320 px @2x with 8% pad (asset-pipeline) vs 360x360 @2x (reference-layout). RESOLVED: 360x360 @2x, so specials can overflow the cell by 1.15x and scale-pops have room.
- GPU MEMORY BUDGET: 200-250 MB (aaa-animation) vs ~150 MB (asset-pipeline) vs about 100-150 MB for low-end iOS (aaa verdict, citing iPhone SE page kills around 100 MB). RESOLVED: 120 MB total on mobile/low tier, 250 MB on desktop.
- CONSOLE STRIPPING: the stake-engine brief prescribes esbuild drop; the verdict (and my test) show Vite 8.3 ignores it. RESOLVED: rolldownOptions.output.minify.compress.dropConsole, tested.
- assetsInlineLimit: stake-engine brief says 'small', asset-pipeline says 0, web-sdk uses Infinity. RESOLVED: 0, so all assets load from relative URLs and the loading bar works.
- SPINE EXPORT SCALE: asset-pipeline says 'export @1x and let AssetPack make @0.5x', but its own AssetPack config treats every source as @2x. RESOLVED: export Spine at @2x art scale. Also ship webp atlases only, or post-fix the page names in .png.atlas, because AssetPack's 1x png.atlas points at the @2x page.
- TUMBLE/GRAVITY EASING: aaa-animation says 'power2.in' for gravity, but power2 is cubic. RESOLVED: 'power1.in' (quad), with duration = sqrt(2d/g). The SDK baseline also is not a linear fall: it uses a fixed 200 ms backOut.
- SDK SPIN CADENCE: aaa-animation estimates 2.6-3.0 s for 7 reels; the verdict recomputes 3.5-4.2 s. Either way it is too slow, and our own profile replaces it.
- RT MSAA MEMORY: 14 MB (aaa-animation) vs 32-35 MB (verdict) for 768x1152 s4. RESOLVED formula: w*h*(4+8s) bytes; the RT sizes are chosen to fit it.
- RENDERER/CONTEXT: the SDK's pixi-svelte defaults to preference:'webgpu', which cannot share with three. RESOLVED: preference 'webgl' (WebGL2), with Pixi creating the context and three attaching after app.renderer.resetState(), a step no brief mentioned.
- OUTLINE FOR 3D: asset-pipeline bakes an inverted-hull Solidify in Blender with export_apply=True, which drops shape keys and cannot be applied to meshes that have shape keys; aaa-animation uses the runtime OutlineEffect. RESOLVED: runtime OutlineEffect (verified inside the RT, screen-constant thickness = 2*px/rtHeight) and export_apply=False.
- LAYOUT SIZES: the SDK cluster sample uses 1422x800 desktop and 1000x1000 tablet, while the SDK standard and both briefs use 1920x1080 and 1920x1920. The SDK isStacked checks 'almostSquare', which layoutType never returns. RESOLVED: 1920x1080 / 1080x1920 / 1920x1920 plus a new 960x540 compact space; isStacked = portrait|tablet.
- BACKGROUND BLEED: aaa-animation says 16:9 masters at 2560x1440 with key art in the centre 16:9. The verdict points out that cover-scaling onto 21:9 crops top and bottom, not the sides. RESOLVED: 2:1 landscape master (3072x1536) and 1:2 portrait master (1536x3072).
- FRAME Z-ORDER: the SDK sample draws BoardFrame behind the symbols; reference-layout puts the frame above. RESOLVED: frame above a scissor-masked board, with a RenderLayer for spill-over.
- GRID MULTIPLIER RULE: the math-sdk docstring says 'double' but the code does +=1 (cap 512); the reference shows powers of two (the lighter mechanic in Ganja Snail doubles). RESOLVED for the FE: render any int through configurable bands. The math decision is deferred to the user.
- KTX2: aaa-animation recommends ASTC/ETC/KTX2 through AssetPack compress; asset-pipeline says skip it for 2D, and the Pixi/three transcoders default to jsdelivr, which breaks the no-external-request rule. RESOLVED: no GPU compressed formats in v1.
- REPLAY DEFAULT AMOUNT: the docs say 1 USD / 1 SC when amount is missing; the web-sdk defaults to 0. RESOLVED: follow the docs.
- SOCIAL CURRENCY DISPLAY: the docs say '10.00 GC' (suffix); web-sdk renders 'GC 10.00'. RESOLVED: suffix, as in the docs.
- DOCS vs CLIENT DETAILS: config.jurisdiction is marked 'Do not used. Ignore.' on the authenticate page but documented elsewhere (implement it defensively). Polish is 'po' in the docs and 'pl' in the RGS.md/ts-client (accept both). XGC/NGN decimals and PEN symbol position differ (follow the docs). Max-win hit-rate is 1 in 20M in the checklist and about 1 in 10M on the math page (math concern). Play currency is required in the OpenAPI schema but omitted in the docs (send it). The round id is betID in real responses and roundID in the OpenAPI schema (read both).
- HIGGSFIELD SPECIFICS: 'hf workspace set' fails on npm installs (use 'higgsfield workspace set'). MCP id nano_banana_pro = CLI nano_banana_2. Seedance 1.5 defaults to 12 s over MCP and 4 s on the CLI (always pass --duration). Higgsfield's loop recipe uses start=end frames, while ffmpeg.party reports near-static output with it (two-half fallback). Higgsfield's catalog prose names Nano Banana 2 (flash) as the cartoon default but its preferred-defaults line says nano_banana_2 (Pro). RESOLVED: nano_banana_2 (Pro) for all finals.
- PIXI FILTER API: the Pixi docs/skill say Filter.from({gl:{fragment}}) supplies a default vertex; in 8.21.0 it throws. RESOLVED: always pass vertex: defaultFilterVert.
- SPINE VERSION: the SDK pins 4.2.74 runtime with 4.1.x exports; our stack uses 4.3.13. RESOLVED: Editor 4.3.x frozen, runtime pinned to exactly 4.3.13, nothing reused from the SDK's Spine assets (which are rejected for approval anyway).
## recommendedArchitecture
DECISION: a standalone static SPA with no web-sdk runtime. Vite 8.3 (rolldown) + TypeScript + PixiJS 8.21 on WebGL2 is the single canvas. three.js 0.186 renders toon 3D mascots into render targets inside Pixi's GL context, and those are composited as Pixi Sprites. GSAP 3.15 is the only animation clock. Spine 4.3 is used for high-pay and special symbols. The architecture mirrors web-sdk's three pieces: a sequential book player, an awaitable emitter, and a flow state machine.

1) PINNED STACK (repo /home/user/3d-slot already has most of this). Use exact versions:
- pixi.js 8.21.0
- three 0.186.0
- gsap 3.15.0, with CustomEase, CustomBounce, PixiPlugin, MotionPathPlugin and Physics2DPlugin registered
- @esotericsoftware/spine-pixi-v8 4.3.13 (Spine Editor 4.3.x frozen)
- @pixi/sound 6.0.1
- pixi-filters 6.1.5 (per-filter imports)
- @assetpack/core 1.7.0 (dev)
- @gltf-transform/cli 4.5.0 (dev)
- playwright 1.63 (dev)
- vite 8.3.0, Node >= 22.12, pnpm 10

Do NOT add Svelte, xstate, @pixi/ui, particle-emitter libraries, KTX2/Basis, Google Fonts or the stake-engine npm client (it logs its version).

vite.config.ts:
- base './'
- build.target 'es2022'
- build.assetsInlineLimit 0
- build.rolldownOptions.output.minify = {compress:{dropConsole:true, dropDebugger:true}, mangle:true} (tested; esbuild.drop is ignored in Vite 8)
- a dev plugin mounting the mock RGS at /__rgs
- an AssetPack plugin: watch() under serve, run() under build

Upload the CONTENTS of dist/.

2) MODULE LAYOUT (src/):
- env/url.ts: sessionID, rgs_url, lang ('br' maps to 'pt'; accept 'po' and 'pl'), currency, device, social, demo, replay, game, version, mode, event, amount
- env/tier.ts: low/high tier heuristic
- rgs/client.ts, about 150 LOC: authenticate, play (sends currency), endRound, balance (60 s poll), event, replay
  - https:// plus rgs_url; http only for localhost in DEV
  - throws on data.error and on an empty round.state
- rgs/mockPlugin.ts: serves [research sandbox]/books/g7x5 fixtures; override with ?book=&mode=
- money/: all money as integer API units (1e6). winRaw = betRaw*bookAmount/100. A table-driven currency formatter following the docs; XGC/XSC render as '10.00 GC'.
- i18n/: en.json and en-social.json (full restricted-phrase table). Social mode forces en-social whatever lang says.
- flow/controller.ts: typed async FSM rendering|idle|spinning|presenting|autoplay|resume|replay|error
- flow/endRound.ts:
  - noWin: nothing
  - single reveal with a win: call end-round immediately after play; hold the balance until the animation ends
  - multi-reveal with a win: POST /bet/event `${index}` on every reveal, then end-round after the animation
- flow/resume.ts: if authenticate returns round.active === true, snapshot from updateGlobalMult, freeSpinTrigger, updateFreeSpin and setTotalWin, then play the remaining events. Always restore bet level and mode from round.amount and round.mode.
- flow/replay.ts: no session calls. GET replay, then a Start button showing mode, base bet, cost multiplier and real cost (default 1 USD / 1 SC), then playback, then Play Again. Balance, bet and autoplay are hidden, and there is no path into real play.
- flow/jurisdiction.ts: enforce every flag. disabledTurbo, disabledSuperTurbo, disabledAutoplay, disabledSlamstop, disabledSpacebar, disabledBuyFeature and disabledFullscreen hide or disable controls. displayNetPosition, displayRTP and displaySessionTimer show widgets. minimumRoundDuration holds the next play until elapsed >= value.
- book/types.ts: 7x5 event union from math-sdk events.py. Board is [reel][row] with 7 rows padded; positions are padded; gridMultipliers are 7x5 unpadded.
- book/adapter.ts: normalises legacy floats (winWithoutMult, payoutMultiplier).
- book/player.ts: for-await over events, ctx.bookEvents = the whole array; a missing handler throws in DEV.
- core/emitter.ts: broadcast (fire-and-forget) and broadcastAsync (Promise.all).
- core/clock.ts: single RAF plus gameTL.
- core/timing.ts: speed profiles.
- render/{app.ts, layout.ts, layers.ts}
- scene/: Background, BgFx, Panel, TileGrid (heat tiers + numbers), Board (SymbolView pool), TumbleBoard, Anticipation, WinPresenter (dim/pop/cluster labels), BigWin, FreeSpins (intro, counter, outro), Transition, Mascots3D, Particles
- ui/hud/: HexButton, SpinButton, BetControl (steps through ALL betLevels as indices; spacebar = bet), BalanceWin (count-up to finalWin), Turbo, Auto, Menu, BonusBuy
- ui/dom/: Rules, Paytable, UIGuide, Disclaimer, AutoplayConfirm (10/25/50/75/100/250/500/1000/inf; loss and single-win limits), BuyConfirm (any mode costing more than 2x), Settings (sound toggle), ErrorModal, ReplayBar
- audio/: @pixi/sound for SFX. Music streams through an <audio> element into createMediaElementSource and a GainNode, so iOS can fade it and never decodes 100+ MB of PCM.
- dev/: ?dev=gallery symbol/state gallery at normal and turbo speed; ?dev=books fixture picker.

3) RENDER CORE (tested order, [research sandbox]/x3/src/main.ts):
- await app.init({preference:'webgl', resizeTo:window, autoDensity:true, resolution:min(devicePixelRatio, tier cap 2 or 1.5), antialias:false, background:'#0a0420', sharedTicker:true})
- app.renderer.resetState()  <- REQUIRED, otherwise GL INVALID_OPERATION from three's 3D default textures
- three = new THREE.WebGLRenderer({canvas: app.canvas, context: app.renderer.gl}); three.autoClear = false; THREE.ColorManagement.enabled = false; set colorSpace = NoColorSpace on all GLB textures (gamma-space toon pipeline that matches Pixi)
- For each mascot:
  - rt = new WebGLRenderTarget(w, h, {samples}); three.initRenderTarget(rt)
  - tex = new Texture({source: new ExternalSource({resource: three.properties.get(rt.texture).__webglTexture, renderer: app.renderer, width: w, height: h})})
  - sprite.scale.y = -1
  - after any rt.setSize(), call source.updateGPUTexture(newHandle, w, h)
- Ticker order:
  1. HIGH(25): gsap.updateRoot(app.ticker.lastTime/1000), after gsap.ticker.remove(gsap.updateRoot)
  2. NORMAL(0): three.resetState(); for each mascot: mixer.update(dt), setRenderTarget(rt), setClearColor(0,0), clear(), outlineEffect.render(scene, cam); then setRenderTarget(null); app.renderer.resetState()
  3. LOW(-25): Pixi render

Spine pool instances use autoUpdate:false with update(dt in seconds) while active. Before the first spin and before the bonus intro, call renderer.prepare.upload(container) and three.compileAsync.

4) LAYER STACK (back to front):
- background (cover-scaled, 2:1 and 1:2 masters)
- bgFx (additive neon pulses, haze)
- panel (gradient #0c3149 to #080418)
- tiles (heat skins)
- spot numbers (BitmapText, behind symbols)
- board symbols (rectangle scissor mask to the panel opening)
- frame (posts, beam, sill)
- logo
- winLayer (RenderLayer: win pops, scatter lands, cluster labels, spot fly-outs)
- mascots (two Sprites of the RTs, blob shadows)
- HUD
- bigWin/FS overlays; during a big win, mascots are re-attached above the dimmer through a RenderLayer
- DOM modals

5) LAYOUT: port createLayout (AR >= 1.3 landscape, <= 0.8 portrait, otherwise tablet; plus compact when landscape and min(w,h) <= 480). Contain-scale the main container, cover-scale the background.
- Landscape 1920x1080: cell 150, gap 4, pitch 154, grid (413,149) 1074x766, centres (488+154c, 224+154r). Panel (401,137,1098,790). Frame about (326,72,1260,922). Mascot slots L (0,557,434,496) and R (1531,441,389,568). HUD positions as in gapsFilled.
- Portrait 1080x1920: cell 132, pitch 136, grid (66,620) 948x676. Mascots in the 150-600 band. HUD 1390-1920. Touch targets >= 150 design px.
- Tablet 1920x1920: landscape composition with headroom.
- Compact 960x540: cell 90, grid 648x462, no 3D, HUD right column.
- Resolution cap is 2. Resolve texture resolution from stageScale*resolution: >= 1.25 gives @2x, >= 0.6 gives @1x, otherwise @0.5x.

6) SYMBOL SYSTEM: 35 SymbolViews plus a pool of 14 for tumbles. States: static | spin(blur) | land | win | postWinStatic | explode | anticipation.
- static, blur and land for royals are atlas Sprites, which batch into 1-3 draw calls.
- High pays and specials borrow a pooled Spine instance (about 4 per symbol type) for land, win, anticipation and idle-accent, then return it.
- Royals animate with GSAP only: pop, a shine Mesh shader, and a particle burst.
- Per-symbol glow is a pre-baked additive sprite; no GlowFilter per symbol.
- Explode is a 16-24 frame VFX flipbook plus 16-24 particles.
- Motion blur is a pre-blurred texture variant, swapped in above 1.5 px/ms.

7) TIMING PROFILE (normal; turbo = gameTL.timeScale(2) with staggers 0; superTurbo = 3 if allowed). All values live in timing.ts.
- Spin press fires /wallet/play immediately.
- Fall-out: 'power1.in', 260 ms per symbol, 35 ms column stagger, 15 ms row stagger bottom-first, about 530 ms total.
- Fall-in waits for the RGS response AND fall-out completion. Gravity g = 12000 design px/s², so t = sqrt(2d/g): 160 ms for 1 cell, 358 ms for 5 cells. 60 ms column stagger, 25 ms row stagger. Landing squash scaleX/scaleY 1.12/0.86, then 'back.out(2)' 160 ms. The board lands in about 980 ms.
- Anticipation: each remaining column holds +1200 ms with a Spine intro (300 ms), loop and out (250 ms); non-anticipating cells tint 0x7f7f7f.
- winInfo: non-winners dim to 0x5a5a5a in 170 ms. Winners pop to 1.2 in 130 ms 'back.out(3)' and play Spine win (<= 900 ms). Cluster label: in 250 ms 'back.out(2)', hold 700, float 40 px and fade 400.
- Explode: 0.9 in 80 ms 'power2.in', then 1.35 with alpha 0 in 180 ms, then a 100 ms hit-stop.
- updateGrid: per changed cell, number roll plus a punch 1 to 1.3 to 1 over 200 ms; a tier change adds a 150 ms flash.
- tumbleBoard: gravity per distance (g = 9000 for weight), 50 ms column stagger, 'back.out(2)' 150 ms landing.
- Screen shake 6-12 px decaying over 300 ms, only for wins >= L6 and feature triggers.
- setWin tiers L2-L5 count up over 600/1000/1500/2000 ms. BIG / SUPER / MEGA / EPIC / MAX (15/30/50/100x/wincap) run 5/7/9/13/18 s: linear count-up with a 'power3.out' final 10%, a tier punch of 300 ms 'back.out(2.5)', a BGM stem change, first tap jumps to the final value, second tap closes.
- In autoplay, overlays auto-close 1.5 s after the count-up.
- The win counter always increments up to finalWin (approval rule).

8) MASCOTS3D:
- GLB is 8-15k tris, <= 65 bones, 4 weights, 1 material, 1024 webp base colour, <= 8 morphs; clips idle, idle_bored, anticipation, react_small, win_big, celebrate, fs_trigger; target <= 1.5 MB.
- Loaded with GLTFLoader + MeshoptDecoder.
- Materials become MeshToonMaterial with a 3-step Nearest gradientMap [90,170,255], lit by 1 DirectionalLight from the top-left plus a Hemisphere light. No realtime shadows; blob shadow sprite in Pixi.
- OutlineEffect with defaultThickness = 2*3px/(rtH*displayScale) and colour #000.
- AnimationMixer crossfades 0.25 s (0.15 s in turbo). Events map book types to clips: anticipation on reveal.anticipation, react on winInfo, celebrate on setWin >= 6, fs_trigger on freeSpinTrigger.
- RT sizes: 512x768 s4 on high tier (28 MB for two), 341x512 s2 at 30 fps on low tier (7 MB). Off in compact.
- Optional secondary motion: @pixiv/three-vrm-springbone 3.5.5 (MIT, peer three >= 0.137) on tails, ears and chains.

9) FX AND PERFORMANCE:
- At most 3 live filters (low tier 1), each on a container with filterArea and resolution 0.5. Custom filters must pass vertex: defaultFilterVert.
- Custom Mesh shaders for shine and dissolve.
- In-house ParticleContainer emitter, <= 1000 particles (low tier 400).
- GPU memory: low tier <= 120 MB, desktop <= 250 MB. Atlas pages <= 2048 on mobile.
- Download (gzip, from manifest progressSize): preload <= 3 MB, game <= 15 MB, bonus <= 8 MB.
- Assets.init({basePath:'assets/', manifest:'manifest.json'}). A 'assets/manifest.json' path double-prefixes. Then loadBundle('preload') and backgroundLoadBundle('game').
- A tap-to-start gate unlocks audio.

10) CI GATES (Playwright + SwiftShader, verified working here):
- 7 viewports x fixture books: screenshots
- request-host allowlist (page origin and rgs host only)
- zero console output and zero pageerror in the prod build
- grep dist for http(s):// outside the rgs path
- no .atlas region line ending in an image extension
- no texture larger than 2048 on the mobile bundle
- VRAM sum per bundle
- gltf-transform validate and inspect budgets
- replay URL smoke test
- social-mode string scan for restricted words

11) MILESTONES:
- M1: URL, RGS client, mock, flow, end-round, replay, resume, jurisdiction, layout (4 spaces) with grey-box art.
- M2: board drop-in, tumbles, multiplier heat grid and timing profiles, driven only by g7x5 fixtures.
- M3: HUD, DOM menus, compliance texts, social and currency.
- M4: 2D art ingest and Spine symbols.
- M5: 3D mascots.
- M6: big win, free-spin intro/outro, VFX, audio.
- M7: performance tiers, all approval checklist items, replay event IDs per mode (normal, big win, wincap, loss, bonus).
## recommendedArtPipeline
DECISION: Nano Banana Pro (Higgsfield id nano_banana_2) generates every 2D still, locked by one corrected style formula plus approved anchor references.
- A deterministic local key/matte pipeline turns the outputs into clean assets.
- Spine 4.3 animates high pays and specials.
- Vector art plus an optional AI material pass makes the royals.
- Higgsfield multi_image_to_3d (Meshy engine), then Blender 5.2, then gltf-transform, produces real-time toon 3D mascots.
- AI video is used only for VFX flipbooks.
- No GPT Image output ships, because OpenAI's usage policy prohibits real-money gambling.
- No text is baked into any art: every word, number and currency value is rendered live, as social mode and i18n require.

0) TOOLING
- Interactive: the Higgsfield MCP (claude.ai connector, or `claude mcp add --transport http --scope user higgsfield https://mcp.higgsfield.ai/mcp`, then /mcp, then select_workspace).
- Production: `npm i -g @higgsfield/cli@1.1.26 && higgsfield auth login && higgsfield workspace list && higgsfield workspace set <id>`. The MCP bugs #76 and #93 are open as of 2026-09-24.
- Snapshot the model catalog: `higgsfield model list --json > art-src/_meta/models-2026-09.json`, plus `model get` for nano_banana_2, seedance_2_0, kling3_0, multi_image_to_3d, 3d_rigging, mirelo_text_to_audio and sonilo_music.
- tools/hf/gen.mjs wraps `higgsfield generate create <job> ... --wait --json` and writes art-src/<asset>/v<NN>/{prompt.txt, args.json, refs/, job.json, raw.png|mp4}. This provenance matters for IP review and for human-authorship evidence.
- Always pass --aspect_ratio, --resolution and --duration explicitly, with audio off (--generate_audio false / --sound off).
- Run `higgsfield generate cost` before every batch. Budget: Ultra plan, about 2,200 credits for the first full pass.

1) STYLE BIBLE (freeze this before generating any other asset)
Formula (paste byte-identical into every prompt):
"Premium 2D slot-game art, bold cel shading: one flat base tone, two hard-edged shadow tones and one crisp white specular streak, no soft gradients, no texture noise. Uniform thick pure-black outline around every shape with thinner black interior lines; chunky rounded exaggerated forms with a short dark-plum extrusion toward the lower right. Key light from the upper left on every object. Warm saturated candy colours for symbols and characters, molten gold for special features; foreground objects carry no rim light or glow, neon exists only in the deep violet-indigo environment. Clean readable silhouettes, adult characters."

Per-kind suffixes carry the background and keying instructions:
- Symbol: "single object, centred, filling 85% of the frame, no text, no letters. On a solid uniform flat #00FF00 background, no gradient, no vignette, no cast shadow, no floor, nothing cropped."
- Use #FF00FF for green assets.

Anchor step:
- Generate one 4k 1:1 sheet of 9 symbols in a 3x3 grid with wide gutters, in up to 6 rounds.
- Approve it and slice into art-src/anchors/a1..a9.png. Every later still passes 3-6 anchors as --image refs.

Contact sheet QC:
- Composite the assets on the real panel colour at 150 px and 75 px.
- Reject any asset whose outline weight, light direction or perspective differs, or that shows gibberish text, plastic sheen or baked bloom.
- Budget is 2 regenerations per asset, then take the best.

2) SYMBOL STILLS (4 high pays, 5 royals, W, S, plus value/collector/booster specials once the math is fixed)
- Command: `higgsfield generate create nano_banana_2 --image a1.png --image a2.png --image a3.png --aspect_ratio 1:1 --resolution 2k --wait --json`
- Matte: `python tools/outline_matte.py raw.png H1@2x.png --key 00ff00 --dark 70 --seal 3 --out-size 360` onto a fixed 360x360 @2x canvas. Content heights: royals 255-270 px, highs 288-300, specials 330-345 rotated -12 to -30 deg.
- Guards: reject any image with a dark vignette or drop shadow, since max(RGB) < 70 is treated as outline. Cross-check the mask with `rembg i -m birefnet-general-lite`; flag when IoU < 0.98. Never use rembg's default bria-rmbg (non-commercial) or isnet-anime (it deletes objects).
- Variants (ffmpeg, tested one-liners): blur, `avgblur=sizeX=1:sizeY=14` on a padded canvas; additive glow, `gblur sigma 14`, gold #FFD54A.
- ROYALS (10 J Q K A): SVG built from Lilita One or Titan One (already in public/assets/fonts). 8 px black stroke @2x, plum #4b283d extrusion offset 12-18 px toward the lower-right, one hue per letter (10 #aa621b, J #e6a37f, Q #75d92a, K #f1c81c, A #d13242 or re-mapped per theme). Rasterise with @resvg/resvg-js 2.6.2. Optional material pass: nano_banana_2 edit with the render as the ONLY ref ("Same letter as the reference, identical silhouette and outline; change only the surface to glossy candy enamel"), then re-matte and register back onto the vector alpha (OpenCV findTransformECC MOTION_AFFINE).

3) SYMBOL ANIMATION (high pays and specials)
Parts:
- nano_banana_2 edit with the approved symbol as ref: "Exploded part sheet of the same symbol: <lid>, <body>, <eyes>, <highlight> as separate pieces with wide gaps, occluded areas painted in, identical style, flat #00FF00".
- Alternatively Qwen-Image-Layered 640 px buckets, only if a large-VRAM GPU is available.
- outline_matte each part, then assemble a PSD (psd-tools) on the 360 @2x canvas with its origin at the canvas centre.

Spine 4.3 Professional (meshes, weights, physics constraints):
- Import PSD.
- Animations: land 300-450 ms, win <= 900 ms loopable, anticipation intro/loop/out (scatter), idle accent for W/S. Add Spine events 'impact' and 'burst' to sync SFX and particles.
- Export with the CLI: `Spine -u 4.3.xx -i art-src/spine/symbols.spine -o raw-assets/game{m}/spine-symbols -e art-src/spine/export.json`, with binary+pack, PMA on, bleed off, max 2048, padding 2, and scale 1.0 of the @2x art.
- Region names carry no file extension; CI greps for them because AssetPack crashes on them.
- Ship webp atlases, or post-fix the .png.atlas page names.

4) VFX FLIPBOOKS (cluster explode, coin burst, scatter land, spot-upgrade spark, booster lightning)
- Key frame from nano_banana_2 on #00FF00.
- `higgsfield generate create seedance_2_0 --start-image fx.png --aspect_ratio 1:1 --duration 4 --resolution 720p --mode fast --generate_audio false --wait --json`. Use kling3_0 --mode std --sound off for simple motion.
- For loops use start=end; if the motion comes out dead, fall back to two halves.
- `tools/key_video.sh clip.mp4 out fx 256 12 24 auto green`: fps normalise, crossfade the loop on the opaque clip, chromakey, despill, 1 px alpha erode.
- Keep <= 24 frames at 256 px in a {tps} folder; playback animationSpeed = fps/60.
- Particles and glows stay procedural.

5) ENVIRONMENT
Background landscape:
- nano_banana_2 21:9 4k, with the prompt: "underground neon nightclub behind slot reels, wide establishing view, no characters, no UI, no text or readable signage, darker low-detail central 60%, brightest neon masses at far left and right edges, thinner lower-contrast linework than foreground".
- Crop to a 2:1 3072x1536 master.
- Portrait: 9:16 4k, then `higgsfield generate create outpaint` to 1:2 at 1536x3072.
- Optional parallax and pulse layers: an edit pass "same scene, only the neon tubes, on flat black" gives an additive layer.

Frame:
- Generated as orthographic pieces (beam, post, sill, corner cap) on #00FF00.
- outline_matte clears the enclosed interior.
- 3-slice: posts tile vertically, and the beam is stretched only in its centre segment.

Panel and heat tiles are code, not art: rounded rects plus a gradient mesh and cached textures per tier.

6) UI KIT
- Hex buttons are vector (SVG, then resvg) with exact translucent fills and strokes: small hex 72x70 at 85% black with a 2 px #8a8a8a stroke; spin 293x271 at 30% black with a 2 px white stroke at 60% alpha, tilted 20 deg; bonus-buy with a single hot accent colour.
- States: default, hover, pressed, disabled.
- Icons: `higgsfield generate create recraft_v4_1 --model_type vector --colors '["#e8e8e8"]'` (prompt only), or hand-drawn SVG.
- Logo: nano_banana_2 on key colour, no letters. The title word-mark is set in vector type and styled to match (1-2 px top-left outline, 5-15 px black extrusion bottom-right).

7) MASCOTS (real-time 3D; 2 adult-coded anthropomorphic characters)
Step a. Turnaround:
- nano_banana_2, 21:9 4k, 4 views on a flat white background, A-pose, head about 1/4 of body height. Never use kid, cute or chibi wording.
- Expression sheet 3:2 from the front crop.
- Crop each view into its own file.

Step b. 3D:
- `higgsfield generate create multi_image_to_3d --image front.png --image side.png --image back.png --image tq.png --should_texture true --topology quad --target_polycount 20000 --pose_mode a-pose --symmetry_mode auto --enable_rigging true --wait --json`
- Fallback: Meshy 7 direct, or Rodin Gen-2 quad.
- Extra preset clips: `higgsfield preset list animation-action --query idle --json`, then `3d_rigging --model_url <glb> --enable_animation true --animation_action_id <id>`.

Step c. Blender 5.2 LTS:
- Apply transforms, origin at the feet. Merge by distance 0.0001, recalc normals.
- Retopo to 8-15k tris with deformation loops.
- Bake the texture to a 2048 UV set and flatten the AI's baked lighting (posterise), because the runtime toon ramp does all shading.
- Limit Total 4 weights and Normalize. <= 65 bones (mitten hands).
- Hand-key or Cascadeur-polish these actions at 30 fps: idle 3-6 s loop, idle_bored, anticipation lean-in, react_small 1.2-2 s, win_big, celebrate loop, fs_trigger. Mocap presets are a starting point only.
- Loops have first key == last key. No outline hull in the mesh.
- Export: `blender -b m.blend --python-expr "import bpy; bpy.ops.export_scene.gltf(filepath='m_raw.glb', export_format='GLB', export_apply=False, export_animation_mode='ACTIONS', export_force_sampling=True, export_skins=True, export_influence_nb=4, export_def_bones=True)"`

Step d. Optimise:
- `npx gltf-transform optimize m_raw.glb public/models/m.glb --compress meshopt --texture-compress webp --texture-size 1024 --flatten false --join false --instance false --palette false --simplify false`, then `gltf-transform validate`.
- Keep GLBs out of AssetPack.

Step e. Look-dev in the ?dev=gallery page against the real background: key light top-left, 3 px outline at display size, palette matched to the symbols.
QC: flat colours not muddy, outline continuous, no facing flips, silhouettes adult.

8) AUDIO
- SFX drafts: `higgsfield generate create mirelo_text_to_audio --prompt '...' --duration 2 --wait`
- Music stems (base, bonus, big-win tiers, anticipation riser): `sonilo_music --duration 30-60`
- Master in ffmpeg: loudnorm I=-16 for music, about -13 for SFX; silenceremove; seam crossfade.
- Encode m4a AAC (96-128k) and ogg. Music streams; SFX load per file via the AssetPack manifest.

9) TILE: a bright background variant plus a transparent PNG foreground rendered from the GLB at 2048. No text or multipliers. Compose in the ACP Tile Editor.

10) INGESTION AND BUILD
Flow: art-src (git-lfs masters + provenance) → tools/ (outline_matte.py, key_video.sh, glow/blur, resvg, psd assembly) → raw-assets/ (generated, AssetPack-tagged: preload{m}, game{m}/symbols{tps}, game{m}/spine-symbols, game{m}/vfx-*{tps}, game{m}/bg/*.jpg, bonus{m}) → AssetPack 1.7.0 (resolutions high 2 / default 1 / low 0.5; webp and palette-png, measured per folder; sheets max 2048; audio m4a and ogg; manifest with gzip progressSize) → public/assets.
- Use the scratchpad asset-pipeline assetpack.config.js with the fixes: manifest path relative to basePath, spine atlas post-fix, full audio outputs override.
- CI gates: zero key-tinted edge pixels, uniform 360 canvases, no texture over 2048 on mobile, VRAM and download budgets per bundle, no text detected in art (OCR spot-check), and GLB validate plus inspect budgets.
## openQuestionsForUser
- The reference screenshot is Donut Gaming's live Stake Engine title 'Ganja Snail'. Stake requires original, IP-clean games, so we will only match its quality, layout and energy, not its snails, cannabis content, rasta logo or 'Berserk' naming. Which theme do you want: 'Swamp Funk' (gator bouncer + bullfrog DJ in a bayou juke joint), 'Beast Mode Gym' (gorilla + ram in an underground gym), or your own? What is the working title? It must be unique, with no 'Megaways'/'Xways'.
- Mechanics for the front-end mock, pending math: should multiplier spots also appear in the BASE game, or only during free spins as in the math-sdk sample? Should they grow additively (+1, the current math-sdk code) or by doubling (x2, x4 ... x512, as in the reference)? Which specials do you want (value symbols, a collector, a booster that doubles neighbouring spots, W, S)? What is the wincap (5,000x as in the sample, or 50,000x)?
- Which bet modes and costs will exist? For example BASE 1x, a bonus buy at 100x, and a 'super' buy at 500x. Modes cannot be added after approval, and every mode costing more than 2x needs a confirmation step.
- Do you own, or will you buy, Spine 4.3 Professional (meshes and physics), and who will animate the symbols in it? If nobody, symbol animation falls back to code-driven GSAP/shader rigs, which Claude can author but which look less organic.
- Who will clean up and animate the 3D mascots in Blender (you, a hired 3D animator, or Higgsfield/Meshy mocap presets only)? Presets are fast but look generic. AAA-feeling celebrate and anticipation clips need hand-keyed animation.
- Is 3D required on mobile portrait? The plan renders toon 3D mascots on all tiers except the compact/popout layout, and at 30 fps on low-tier phones. What is the oldest target device (e.g. iPhone SE 2nd/3rd gen)? That sets the 120 MB GPU budget.
- Which Higgsfield plan do you have (Ultra is recommended, about 2,200 credits for the first pass)? Will you generate from Claude Desktop/claude.ai with the connector, or from Claude Code on your machine? The latter currently has an open OAuth bug, #76. Which OS are you on? Windows has quoting bug #83.
- Legal sign-offs: (a) OK to exclude GPT Image models from all shipped art, since OpenAI's policy prohibits real-money gambling? (b) Do you accept that raw AI art is likely not copyrightable in the US, so we keep provenance and add human paint-over? (c) Higgsfield trains on your content by default unless you are on Enterprise or delete it. Is that acceptable for unreleased game art?
- Audio: are AI-generated SFX and music from Higgsfield's mirelo_text_to_audio / sonilo_music acceptable after we verify the license, or will you use a composer or sound library? Should the game play with the iOS silent switch on (navigator.audioSession.type='playback')?
- Which languages ship beyond English? Only 'en' needs Latin fonts. ja/zh/ko/ar/hi need additional self-hosted fonts and larger bitmap-font glyph sets.
- Will you also launch on Stake.us (social mode)? If so, we enforce the full restricted-phrase table in the UI, the rules and the replay screen from day one.
- Do you have Stake Engine ACP access with a team, a game slug and a dev session, so we can test against the real RGS (sessionID + rgs_url) in addition to the local mock? Math will come later. Should we keep generating front-end fixtures from the math-sdk cluster sample adapted to 7x5 (already done), or do you have a math designer?