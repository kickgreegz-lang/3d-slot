import { type Bone, type Slot, Spine, type TrackEntry } from '@esotericsoftware/spine-pixi-v8';
import { Container, type Renderer } from 'pixi.js';
import { speedScale } from '../../../core/timing';
import { mixColor } from '../../../fx/util';
import type { CabinetClip, CabinetView } from './LowerCabinet';
import type { RigRef } from './spineAssets';

const FPS = 30;
/** the cabinet art is 608 units wide (authored at 2x: 304 design px in landscape) */
const CABINET_UNITS = 608;
/** idle is 72 f = 4 beats at 100 BPM */
const IDLE_BEATS = 4;
const IDLE_BEAT_SEC = 18 / FPS;
const RETURN_MIX = 0.12;

interface Clip {
  entry: TrackEntry;
  sp0: number;
}

/**
 * LOWER CABINET — the `env_speaker_stack` Spine rig (ANIMATION_SET §4.1, tools/bdart), replacing
 * the code-drawn LowerCabinet (which stays as the fallback). Root = the bottom centre of the
 * layout's lowerCabinet rect; scale = rect width / 608 units (landscape 0.5); not shown in portrait
 * or compact (the Stage hides it).
 *  - Track 0: `idle` (woofer breathes per beat, phase-locked to the shared music beat at the stem's
 *    tempo), `boom_follow` (18 f, woofer punch at f2 = 2 frames behind the meter's boom), then
 *    `feature_follow` (54 f, pumps at f2 / f20 / f38); one-shots play at 30 fps x speedScale() and
 *    return to idle.
 *  - Track 1: `pump` (6 f, additive) on big-win tiers.
 *  - `fx_glow` and the additive `floor_light` are tinted by mode (teal / gold / pink); the cables are
 *    physics chains (floppy) that ignore container motion (screen shake never whips them).
 *  - Reduced motion: the boom hop (cabinet translate) is dropped; scales and the woofer stay.
 * Updated from the engine clock by the Stage (hit-stop freezes it); autoUpdate off.
 */
export class SpeakerStack implements CabinetView {
  readonly view = new Container({ label: 'env_speaker_stack' });
  readonly spine: Spine;
  /** 0..1 screen-space motion (reduced motion: 0) */
  motion = 1;
  private readonly cabinetBone: Bone;
  private readonly glow: Slot;
  private readonly floor: Slot;
  private clip: Clip | null = null;
  private pumpClip: Clip | null = null;
  private idle: TrackEntry | null = null;
  private color = 0xffffff;
  private beats = 0;

  constructor(readonly ref: RigRef) {
    this.spine = new Spine({ skeleton: ref.skeleton, atlas: ref.atlas, autoUpdate: false });
    this.spine.label = 'env_speaker_stack_spine';
    const sk = this.spine.skeleton;
    const cab = sk.findBone('cabinet');
    const glow = sk.findSlot('fx_glow');
    const floor = sk.findSlot('floor_light');
    if (!cab || !glow || !floor) throw new Error('env_speaker_stack: rig parts missing');
    this.cabinetBone = cab;
    this.glow = glow;
    this.floor = floor;
    this.spine.skeletonPhysics.setPositionInheritance(0, 0);
    this.spine.beforeUpdateWorldTransforms = this.drive;
    this.spine.afterUpdateWorldTransforms = this.undrive;
    this.view.addChild(this.spine);
    this.startIdle(0);
    this.spine.update(0);
  }

  /** Size for a w x h rect (anchor = its bottom centre, set by the Stage). */
  build(_renderer: Renderer, w: number, _h: number, _res: number): void {
    this.spine.scale.set(w / CABINET_UNITS);
  }

  setColor(color: number): void {
    this.color = color;
  }

  play(name: CabinetClip): void {
    const st = this.spine.state;
    if (name === 'pump') {
      const e = st.setAnimation(1, 'pump', false);
      e.additive = true;
      e.mixDuration = 0;
      e.timeScale = speedScale();
      this.pumpClip = { entry: e, sp0: speedScale() };
      return;
    }
    const e = st.setAnimation(0, name, false);
    e.mixDuration = 0.05;
    e.timeScale = speedScale();
    this.clip = { entry: e, sp0: speedScale() };
    this.idle = null;
  }

  private startIdle(mix: number): void {
    const e = this.spine.state.setAnimation(0, 'idle', true);
    e.mixDuration = mix;
    this.idle = e;
    this.clip = null;
    this.lockIdle();
  }

  private lockIdle(): void {
    const e = this.idle;
    if (!e) return;
    e.timeScale = 0;
    const b = this.beats % IDLE_BEATS;
    e.trackTime = (b < 0 ? b + IDLE_BEATS : b) * IDLE_BEAT_SEC;
  }

  /**
   * beforeUpdateWorldTransforms: mode tint of the additive layers; reduced motion drops the hop; the
   * cabinet squash axes swapped for the world transform. RIG DEFECT (same as ui_groove_meter): the
   * `cabinet` bone points up (rotation 90) and envgen wrote the authored screen [sx, sy] keys into
   * its bone-local scaleX / scaleY, so the landing squash (sy 0.96) would widen instead. undrive()
   * swaps them back after the world transform so the animation's pose stays intact for mixing.
   */
  private readonly drive = (): void => {
    const cp = this.cabinetBone.pose;
    const sx = cp.scaleX;
    cp.scaleX = cp.scaleY;
    cp.scaleY = sx;
    const c = this.color;
    const r = ((c >> 16) & 255) / 255;
    const g = ((c >> 8) & 255) / 255;
    const b = (c & 255) / 255;
    const gc = this.glow.pose.color;
    gc.r = r;
    gc.g = g;
    gc.b = b;
    const f = mixColor(c, 0xffffff, 0.15);
    const fc = this.floor.pose.color;
    fc.r = ((f >> 16) & 255) / 255;
    fc.g = ((f >> 8) & 255) / 255;
    fc.b = (f & 255) / 255;
    if (this.motion < 1) {
      const p = this.cabinetBone.pose;
      const s = this.cabinetBone.data.setupPose;
      p.x = s.x + (p.x - s.x) * this.motion;
      p.y = s.y + (p.y - s.y) * this.motion;
    }
  };

  private readonly undrive = (): void => {
    const cp = this.cabinetBone.pose;
    const sx = cp.scaleX;
    cp.scaleX = cp.scaleY;
    cp.scaleY = sx;
  };

  /** dt game seconds; `beats` = the shared music beat count. */
  update(dt: number, _env: number, beats: number): void {
    this.beats = beats;
    const sp = speedScale();
    const c = this.clip;
    if (c) {
      if (c.entry.trackTime >= c.entry.animationEnd) this.startIdle(RETURN_MIX);
      else c.entry.timeScale = sp;
    }
    const p = this.pumpClip;
    if (p) {
      if (p.entry.trackTime >= p.entry.animationEnd) {
        this.spine.state.setEmptyAnimation(1, 0);
        this.pumpClip = null;
      } else p.entry.timeScale = sp;
    }
    this.lockIdle();
    this.spine.update(dt);
  }

  destroy(): void {
    this.spine.beforeUpdateWorldTransforms = () => undefined;
    this.spine.afterUpdateWorldTransforms = () => undefined;
    this.spine.state.clearTracks();
    // the atlas is unloaded by the owner: never reuse this SkeletonData
    this.spine.unloadFromCache();
    this.view.destroy({ children: true });
  }
}
