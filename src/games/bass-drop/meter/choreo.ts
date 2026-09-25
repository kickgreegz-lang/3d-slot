import { s } from '../../../core/timing';
import { GROOVE } from '../config';
import type { GrooveFeature, MeterMode } from '../events';
import { BASS_DROP_TIMING, GOLD, PINK, TEAL } from '../timing';
import type { MeterFx } from './effects';
import { GEOM, METER_LOOK as LOOK, NOTCHES, R_REF, type RigLayout, notchIndex, polar, valueDeg } from './geometry';
import { lockOf } from './look';
import type { MeterRig } from './MeterRig';
import { Notches } from './Notches';

const T = BASS_DROP_TIMING;
const M = T.meter;
const SMOKE = 0xd6cce2;

/**
 * The meter's one-shot beats (rig clip + screen FX + SFX + mascot cues), timed and sized from
 * BASS_DROP_TIMING. Stateless: the GrooveMeter module decides when they play.
 */

/** Design-space position of the notch badge of threshold t. */
export const notchPoint = (g: RigLayout, t: number): { x: number; y: number } => {
  const p = polar(valueDeg((notchIndex(t) + 1) * 10), R_REF * GEOM.notchRadius);
  return { x: g.cx + p.x * g.scale, y: g.cy + p.y * g.scale };
};

/**
 * Threshold burst on the notch (DESIGN §6.4): minor 10/20/30/50 (`threshold_minor`, 500 ms,
 * ring flash, 24 sparks, trauma 0.1, meter_threshold pitched by notch, cue meterThreshold
 * notch/6); major 40/60 (`threshold_major`, 900 ms, gold / pink wave twice around, trauma
 * 0.3 / 0.4, one flash α 0.25, hit-stop 60 (normal only), meter_lock_*, cue featureLock 1/2).
 */
export const thresholdBurst = (rig: MeterRig, fx: MeterFx, g: RigLayout, mode: MeterMode, t: number): void => {
  const i = notchIndex(t);
  const lock = lockOf(mode, t);
  const major = lock !== null || t === GROOVE.superAt;
  const superish = lock === 'super' || t === GROOVE.superAt;
  const color = major ? (superish ? PINK : GOLD) : Notches.burstColor(NOTCHES[i]);
  const sec = s(major ? M.thresholdMajor : M.thresholdMinor);
  rig.notches.badges[i].burst(major, sec, color);
  rig.led.sweep(color, sec * 0.85, major ? 2 : 1);
  rig.flashRim(color, sec);
  const p = notchPoint(g, t);
  fx.sparks(p.x, p.y, g.k, major ? LOOK.sparksMajor : LOOK.sparksMinor, color, LOOK.sparkLife[major ? 1 : 0], major ? 1.3 : 1);
  const SH = T.shake;
  if (major) {
    fx.shake(superish ? SH.thresholdSuper : SH.thresholdBonus);
    fx.flash(superish ? PINK : GOLD, T.flash.thresholdMajor, 150);
    fx.hitStop(T.hitStop.thresholdMajor);
    fx.sfx(superish ? 'meter_lock_super' : 'meter_lock_bonus');
    if (lock) fx.cue('featureLock', lock === 'super' ? 2 : 1);
    else fx.cue('meterThreshold', 1);
  } else {
    fx.shake(SH.thresholdMinor);
    fx.sfx('meter_threshold', 2 ** ((i * 2) / 12));
    fx.cue('meterThreshold', (i + 1) / 6);
  }
};

/**
 * The meter's boom (DESIGN §8.1 t = charge): the `boom` clip (cone 1.2, cabinet 1.08), three
 * additive sound-wave rings from the woofer 90 ms apart and the speaker-blast puff. The boom's
 * shake / flash / hit-stop / shockwave / SFX belong to the BassDrop module.
 */
export const boomBeat = (rig: MeterRig, fx: MeterFx, g: RigLayout): void => {
  rig.boom();
  fx.soundRings(g.cx, g.cy, g.k, g.R * GEOM.counterR, TEAL);
  fx.smoke(g.cx, g.cy, g.k, g.R * 0.9, LOOK.blastSmoke, SMOKE);
};

/**
 * One `feature_trigger` pump (DESIGN §10.1): trauma 0.2 / 0.3 / 0.6; the last one also flashes
 * α 0.3 white for 140 ms, hit-stops 80 ms (normal only), plays fs_trigger and the feature blast
 * (`fx_feature_blast` fallback: the big explode burst + rings + smoke).
 */
export const triggerPump = (
  rig: MeterRig,
  fx: MeterFx,
  g: RigLayout,
  i: number,
  feature: GrooveFeature,
  burst: (x: number, y: number, color: number) => void,
): void => {
  const color = feature === 'super' ? PINK : GOLD;
  rig.featurePump(i);
  fx.shake(T.shake.triggerPumps[i] ?? T.shake.triggerPumps[0]);
  if (i < T.shake.triggerPumps.length - 1) {
    fx.sparks(g.cx, g.cy - g.R * 0.2, g.k, 14, color, 450, 0.8);
    return;
  }
  fx.flash(0xffffff, T.flash.trigger, T.flash.triggerMs);
  fx.hitStop(T.hitStop.triggerFinal);
  fx.sfx('fs_trigger');
  burst(g.cx, g.cy, color);
  fx.soundRings(g.cx, g.cy, g.k, g.R * GEOM.counterR, color);
  fx.smoke(g.cx, g.cy, g.k, g.R * 0.9, LOOK.blastSmoke, SMOKE);
};
