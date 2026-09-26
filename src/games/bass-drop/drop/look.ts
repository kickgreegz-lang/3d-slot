/**
 * BASS DROP placeholder look: sizes and counts of the drop's procedural visuals, as fractions
 * of the cell (or design px x k, k = pitch / 154) so every design space reads the same.
 * Choreography times live in BASS_DROP_TIMING (DESIGN.md §18.2); these are the art numbers
 * (ANIMATION_SET §2.6 badge geometry, §7.2 live effects, §8 code-drawn elements) that the
 * Spine rigs and flipbooks take over in phase C.
 */
export const DROP_LOOK = {
  /** reference cell (art units) every baked texture is drawn for; sprites scale by cell / REF */
  ref: 100,
  /** texture bake resolution (texels per art unit): 400 px per cell stays crisp up to 4K */
  bakeRes: 4,

  // ---- multiplier badge (sym_W slot `badge` + `txt_mult`)
  /** plate centre below the cell centre (x cell): plate bottom overlaps the cell edge by 10% */
  badgeY: 0.4,
  /** digit cap height 30% of the cell (DESIGN §0); BitmapText size = cap / capRatio */
  badgeCap: 0.3,
  capRatio: 0.72,
  badgeZ: 20,
  /** win-time badge punch + sticky idle heartbeat (sticky_idle: 1.0 -> 1.04 at f0 and f30 of 60) */
  heartbeat: 1.04,
  heartbeatPeriod: 2000,

  // ---- sticky clamps (sym_W slots clamp_L / clamp_R)
  clampX: 0.43,
  clampY: -0.02,
  /** clamps slide in from +-210 / 300 of the cell */
  clampFrom: 0.7,
  clampZ: 10,

  // ---- flight proxy
  /** additive glow behind the flying wild (fx_glow flare) */
  proxyGlow: 1.6,
  /** fx_wild_trail ribbon: 12 points, width x cell at scale 1 */
  trailPoints: 12,
  trailWidth: 0.46,
  /** share of the flight path the ribbon covers behind the wild */
  trailSpan: 0.32,
  /** share of the flight that finishes the spin (rotation eases to 0 by then) */
  spinEndAt: 0.9,
  /**
   * launch layering (DESIGN §8.2): the proxy flies inside the meter's fx_blast slot until its
   * centre passes the rim's inner edge (x the ring radius), then takes winLayer; the trail
   * ribbon starts there
   */
  rimExit: 0.875,

  // ---- reticle + landing shadow
  reticleD: 0.9,
  shadowD: 0.96,
  shadowStart: 0.4,
  shadowReticleAlpha: 0.2,
  reticleIn: 140,
  reticleOut: 120,

  // ---- impact (fx_wild_impact fallback: 16 dust + debris + shock ring)
  dust: 16,
  debris: 8,
  dustColor: 0xcbb8e8,
  debrisColors: [0x4b283d, 0x6b3a57, 0x2c1636, 0xb8742f] as readonly number[],
  shockRing: 1.4,
  shockRingMs: 300,

  // ---- badge / lock garnish
  multSparks: 10,
  multSparkMs: 350,
  lockGlints: 6,
  lockGlintMs: 300,
  returnRing: 1.35,
  returnRingMs: 320,

  // ---- sticky +1 preview (Titan One 36 x k)
  plusOneSize: 36,

  // ---- label-sum badge clones
  cloneLift: 0.9,
  cloneEndScale: 0.72,

  /** particle budget share of the tier (dust, debris, sparks) / of the label-sum sparks */
  particleShare: 0.2,
  labelParticleShare: 0.05,
} as const;

/** Frame counts of the W rig clips the procedural placeholders mirror (30 fps, ANIMATION_SET §2.6). */
export const W_CLIPS = {
  drop_launch: 8,
  drop_fall: 12,
  sticky_lock: 12,
  lock_snap: 6,
  sticky_unlock: 9,
  mult_up: 12,
  mult_swap: 4,
  appear: 9,
} as const;

/** ms of `frames` frames of a 30 fps clip (the caller s()-scales it). */
export const clipMs = (frames: number): number => (frames * 1000) / 30;
