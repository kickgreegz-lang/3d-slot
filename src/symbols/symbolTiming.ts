import { registerTiming } from '../core/timing';

/**
 * Symbol-local animation constants that are NOT (yet) in the TIMING bible
 * (core/timing.ts is a frozen contract). Everything here is a tuning knob for the
 * procedural symbol rig; durations are ms and go through `s()` / `sUi()` at the
 * GSAP boundary exactly like TIMING. Proposed for promotion into TIMING.symbol.
 *
 * Squash is expressed in "squash units" `a`: a = 1 reproduces TIMING.land.squashX/Y
 * exactly; a < 0 is stretch. See SymbolView.applySquash().
 */
export const SYMBOL_TIMING = registerTiming('symbol', {
  land: {
    /** Impact speed (design px/s) that produces the nominal TIMING squash (≈ a full spin drop). */
    refVelocity: 4500,
    /** squash ∝ (v / ref)^curve, clamped — keeps short tumble drops readable. */
    velocityCurve: 0.5,
    minVelocityFactor: 0.5,
    maxVelocityFactor: 1.15,
    /** Soft knee: squash units above 1 are compressed (heavy/special read through hop, rock, shake, dust instead). */
    squashKnee: 0.45,
    /** Tumble refills land a little softer and quieter. */
    tumbleSoftness: 0.85,
    tumbleVolume: 0.55,
    /** Rebound velocity at the squash peak (fraction of peak·ω): shortens the pancake dwell. */
    reboundVelocity: 0.6,
    /** Gravity of the secondary hop (lighter than the drop so a 6 px hop still reads). */
    hopGravity: 2400,
    /** Touch-down of the hop re-kicks the squash spring by this much per px/s. */
    hopKick: 0.004,
    /** Rotation wobble about the feet (degrees) for heavy / special landings. */
    wobbleDeg: { light: 0, medium: 0, heavy: 3, special: 4.5 } as Record<string, number>,
    rotStiffness: 240,
    rotDamping: 9,
    /** Screen shake per heavy / special landing (Fx module decays it). */
    shakeTrauma: { heavy: 0.08, special: 0.15 } as Record<string, number>,
    /** Land SFX base volume per weight. */
    sfxVolume: { light: 0.5, medium: 0.65, heavy: 0.85, special: 1 } as Record<string, number>,
    /** Land promise resolves once visually settled (squash units); the tail keeps animating. */
    resolveEpsilon: 0.1,
    /** Rig goes fully idle (mesh swapped back to a sprite) below this. */
    settleEpsilon: 0.004,
  },
  jelly: {
    /** MeshPlane grid resolution (10x10 = 100 verts keeps it batchable). */
    verts: 10,
    /** Barrel bulge of the mid-section (fraction of width). */
    bulgeStiffness: 520,
    bulgeDamping: 13,
    /** Vertical lag of the top (fraction of height). */
    lagStiffness: 640,
    lagDamping: 15,
    /** Horizontal shear of the top (design px) — follows the rotation wobble. */
    shearStiffness: 300,
    shearDamping: 10,
    /** Shear target per radian of wobble (fraction of height): top lags behind the rock. */
    shearFollow: 0.55,
    /** Land impulses (per unit of squash). */
    landBulgeKick: 0.8,
    landLagKick: 0.45,
    /** Win pop impulses. */
    winBulgeKick: 2.6,
    winLagKick: -1.4,
  },
  blur: {
    /** Stretch while falling fast (squash units, negative = taller). */
    stretch: -0.45,
  },
  idle: {
    breathScale: 1.015,
    breathPeriodMin: 2000,
    breathPeriodMax: 3000,
    glintDuration: 520,
    glintIntensity: 0.55,
    /** Soft jelly nudge (bulge velocity) that accompanies a glint. */
    glintBulge: 0.9,
    wiggleDeg: 5,
    wiggleDuration: 620,
    wiggles: 5,
  },
  win: {
    /** White hit-flash at the pop. */
    flash: 0.8,
    flashDuration: 180,
    /** pop (TIMING.win.popScale) -> hold -> dip -> second beat -> settle, inside TIMING.win.winAnimDuration */
    holdAfterPop: 60,
    dipScale: 1.03,
    dipDuration: 170,
    beatScale: 1.13,
    beatDuration: 150,
    beatEase: 'back.out(2.5)',
    /** jelly impulse on the second beat relative to the pop */
    beatJelly: 0.6,
    settleEase: 'power2.inOut',
    postWinScale: 1.06,
    postWinPulseScale: 1.085,
    postWinPulsePeriod: 1100,
    /** Any leftover wiggle rotation eases out when postWin starts. */
    straightenDuration: 200,
    glowScale: 1.12,
    glowAlpha: 1,
    glowPostAlpha: 0.55,
    shineWidth: 0.16,
    shineIntensity: 0.9,
    /** Near-constant band speed so the sweep reads across the whole symbol. */
    shineEase: 'sine.inOut',
    wiggleDeg: 3.5,
    wiggles: 3,
    sparkleCount: 14,
  },
  explode: {
    /** White "charge-up" during the squeeze. */
    chargeFlash: 0.7,
    burstEase: 'power2.out',
    dissolveEase: 'power1.in',
    fadeEase: 'power2.in',
    /** Hot edge colour = mix(def.color, white, edgeWhiten). */
    edgeWhiten: 0.35,
    /** Glow halo during the squeeze and at the burst (kept modest: the Fx module adds its own flash). */
    glowCharge: 0.6,
    glowPeak: 0.65,
    glowScale: 1.2,
    noiseScale: 7,
  },
  anticipation: {
    swayDeg: 2.6,
    swayPeriod: 1500,
    glowAlpha: 0.95,
    /** Halo flare on the intro (> 1 = over-bright for a moment, clamped to 1 on the sprite). */
    glowFlare: 1.2,
    /** Heartbeat rest scale = 1 + (pulseScale - 1) * restFraction. */
    restFraction: 0.35,
    /** Heartbeat lub-dub (CustomEase) — scale follows it between rest and pulseScale. */
    heartbeat: 'M0,0 C0.06,0 0.1,1 0.18,1 0.26,1 0.3,0.35 0.38,0.35 0.45,0.35 0.48,0.7 0.54,0.7 0.62,0.7 0.7,0 1,0',
    /** Jelly breathing per unit of heartbeat. */
    bulge: 0.07,
    lag: -0.05,
  },
  feedback: {
    /** Identical land SFX closer than this (ms of game time) are dropped. */
    sfxMinGap: 30,
    /** Shake trauma is capped per window so a full-board landing does not explode the camera. */
    shakeWindow: 70,
    shakeWindowMax: 0.22,
  },
  spine: {
    /** Spine skeletons are authored on the @2x symbol canvas (360 px = texture width). */
    canvasPx: 360,
    /** Procedural body squash is scaled down when a Spine land animation also squashes. */
    squashScale: 0.5,
    /** physicsTranslate impulse (skeleton units) per unit of squash on land (applied upward). */
    physicsImpulse: 26,
    /** Container-motion inheritance for physics after the impact (hop/squash drive the parts). */
    landInheritance: 0.6,
    /** Largest container move (skeleton units per frame) still inherited; bigger = teleport, dropped. */
    maxInheritStep: 40,
    /** Cap on the land kick (skeleton units) however fast the drop was. */
    maxImpulse: 36,
    /** docs/ANIMATION_CONTRACT.md §3 mixes (seconds). '*' = from any animation. */
    mix: 0.08,
    mixes: [
      ['land', 'idle', 0.15],
      ['idle', 'win', 0.06],
      ['win', 'win_loop', 0],
      ['*', 'explode', 0.05],
      ['blur', 'idle', 0],
      ['idle', 'blur', 0],
    ] as ReadonlyArray<readonly [string, string, number]>,
  },
} as const);
