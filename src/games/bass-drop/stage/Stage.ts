import { gsap } from 'gsap';
import { Container } from 'pixi.js';
import type { LayoutSpec } from '../../../config/layout';
import { clock } from '../../../core/clock';
import { followSpeed, s, sUi } from '../../../core/timing';
import { onReducedMotion, reducedMotion } from '../../../fx/motion';
import { mixColor } from '../../../fx/util';
import type { GameContext, GameModule } from '../../../game/context';
import type { GameEvents } from '../../../game/events';
import type { MeterMode } from '../events';
import { BASS_DROP_LAYOUT } from '../layout';
import { BASS_DROP_TIMING } from '../timing';
import { Booth } from './Booth';
import { Horn } from './Horn';
import { HORN_REF_W } from './hornArt';
import { STAGE_LOOK } from './look';
import { LowerCabinet } from './LowerCabinet';
import { SKIN_COLOR, type StageSkin } from './palette';
import { bakeRes } from './rig';

const D = BASS_DROP_TIMING.drop;
const F = BASS_DROP_TIMING.feature;
/** Floor of a chained charge (s): DESIGN §18.1 "67 (floor 60)", as the meter and the drop use. */
const CHAINED_FLOOR = 0.06;
/** The feature wipe (DESIGN §10.1, 620 ms) covers the screen this long after triggerTotal. */
const WIPE_COVER = 620;
/** Feature upgrade: the Mega Mix emblem slams at f28 of ui_feature_upgrade (DESIGN §10.4). */
const UPGRADE_SKIN_AT = 933;

const skinOf = (mode: MeterMode): StageSkin => (mode === 'bonus' ? 'jukejam' : mode === 'super' ? 'megamix' : 'base');

/**
 * STAGE — the room around the reels (DESIGN.md §15, §8.1 horns / lower cabinet, §10.1):
 * procedural placeholders of the lower speaker cabinet (`env_speaker_stack`, under the
 * Groove Meter, behind Gumbo and the menu / bonus-buy hexes), the two frame horns
 * (`env_horn`, bolted on the frame's top corners) and Croak's DJ booth (`env_dj_booth`).
 * A null rect in BASS_DROP_LAYOUT hides the piece (compact: none; portrait: no cabinet).
 *
 * Reactions are timed from BASS_DROP_TIMING alone (never by talking to the meter or the drop
 * module), so they land on the same frames:
 *  - 'wild:drop'       the booth presses its drop button over the charge; at the boom (the
 *                      charge: first of a step max(s(charge), chargeFloor), chained
 *                      max(s(chargeChained), 60 ms)) horns, cabinet and booth play boom_follow;
 *  - 'feature:trigger' horns + cabinet play feature_follow from triggerHold (pumps 2 frames
 *                      behind the meter's triggerHold + i x pumpGap), skin swap behind the wipe;
 *  - cluster-win / threshold mascot cues -> booth `scratch`; 'celebrate' -> booth frenzy;
 *    big win -> pumps; an idle pump on the music beat (600 / 566 / 536 ms per mode).
 * Every handler resolves at once (never holds the round). Layers: the cabinet at the very back
 * of the root (behind the meter cabinet, the mascots and the HUD, in front of the
 * background), the horns on the frame, the booth in front of Croak (DESIGN §15.1: "Croak
 * behind the booth") and below the particles and the HUD (layers.fx, index 0).
 */
export class Stage implements GameModule {
  private readonly back = new Container({ label: 'stageBack' });
  private readonly horns = new Container({ label: 'stageHorns' });
  private readonly front = new Container({ label: 'stageBooth' });
  private readonly cabinet = new LowerCabinet();
  private readonly hornL = new Horn(0x40a1);
  private readonly hornR = new Horn(0x40a2);
  private readonly booth = new Booth();
  private readonly beats = new Set<gsap.core.Tween>();
  private offs: Array<() => void> = [];
  private beat = 0;
  private mode: MeterMode = 'base';
  private revealed = false;
  private skin: StageSkin = 'base';
  private readonly tint = { from: SKIN_COLOR.base, to: SKIN_COLOR.base, t: 1 };
  private skinTween: gsap.core.Tween | null = null;

  constructor(private readonly ctx: GameContext) {}

  init(): void {
    const { ctx } = this;
    this.back.addChild(this.cabinet.view);
    this.horns.addChild(this.hornL.view, this.hornR.view);
    this.front.addChild(this.booth.view);
    ctx.layers.panel.addChildAt(this.back, 0);
    ctx.layers.frame.addChild(this.horns);
    ctx.layers.fx.addChildAt(this.front, 0);
    this.booth.onSfx = () => ctx.game.broadcast('sfx', { id: 'dj_scratch' });
    this.applyMotion(reducedMotion());
    this.applyTint();
    this.layout(ctx.layout);

    const g = ctx.game;
    this.offs.push(
      g.on('layout:change', ({ layout }) => this.layout(layout)),
      g.on('round:start', () => {
        this.revealed = false;
        this.booth.stopLoop();
      }),
      g.on('round:end', () => this.booth.stopLoop()),
      g.on('board:reveal', () => {
        this.revealed = true;
        this.booth.stopLoop();
      }),
      g.on('board:set', () => this.cancelBeats()),
      g.on('wild:drop', (p) => this.onWildDrop(p)),
      g.on('feature:trigger', (p) => this.onFeatureTrigger(p)),
      g.on('feature:upgrade', () => this.later(s(UPGRADE_SKIN_AT), () => this.setMode('super'))),
      g.on('mode:change', ({ gameType }) => {
        if (gameType === 'basegame') this.setMode('base');
      }),
      g.on('meter:set', ({ mode }) => this.setMode(mode, true)),
      g.on('mascot:cue', ({ cue, intensity }) => this.onCue(cue, intensity ?? 1)),
      g.on('bigwin:show', () => this.pump()),
      g.on('sfx', ({ id }) => {
        if (id === 'bigwin_tier') this.pump();
      }),
      onReducedMotion((on) => this.applyMotion(on)),
      clock.onUpdate((dt) => this.update(dt)),
    );
  }

  layout(L: LayoutSpec): void {
    const X = BASS_DROP_LAYOUT[L.kind];
    const r = this.ctx.app.renderer;
    const display = this.ctx.scale * r.resolution;
    // keep the cabinet at the very back of the root (the meter body is inserted at 0 on its init)
    if (this.back.parent) this.back.parent.setChildIndex(this.back, 0);

    const cab = X.lowerCabinet;
    this.cabinet.view.visible = !!cab;
    if (cab) {
      this.cabinet.view.position.set(cab.x + cab.w / 2, cab.y + cab.h);
      this.cabinet.build(r, cab.w, cab.h, bakeRes(display));
    }

    const horns = X.frameHorns;
    this.hornL.view.visible = this.hornR.view.visible = !!horns;
    if (horns) {
      const k = horns[0].w / HORN_REF_W;
      this.hornL.view.position.set(L.frame.x, L.frame.y);
      this.hornL.view.scale.set(k, k);
      this.hornR.view.position.set(L.frame.x + L.frame.w, L.frame.y);
      this.hornR.view.scale.set(-k, k);
      const res = bakeRes(display * k);
      this.hornL.build(r, res);
      this.hornR.build(r, res);
    }

    const booth = X.booth;
    this.booth.view.visible = !!booth;
    if (booth) {
      this.booth.view.position.set(booth.x + booth.w / 2, booth.y + booth.h);
      this.booth.build(r, booth.w, booth.h, bakeRes(display));
    }
  }

  destroy(): void {
    for (const off of this.offs) off();
    this.offs = [];
    this.cancelBeats();
    this.skinTween?.kill();
    this.cabinet.destroy();
    this.hornL.destroy();
    this.hornR.destroy();
    this.booth.destroy();
    this.back.destroy({ children: true });
    this.horns.destroy({ children: true });
    this.front.destroy({ children: true });
  }

  // ======================================================================= choreography

  /**
   * DESIGN §8.1 / §8.4: t = 0 charge (the booth's drop button glows and goes down at f14 of the
   * charge), t = C boom: horns + lower cabinet boom_follow, the booth hops and flashes its LEDs.
   */
  private onWildDrop(p: GameEvents['wild:drop']): void {
    const first = p.chainIndex <= 0;
    const charge = first ? Math.max(s(D.charge), D.chargeFloor / 1000) : Math.max(s(D.chargeChained), CHAINED_FLOOR);
    this.booth.play('drop_press', charge);
    this.later(charge, () => {
      this.cabinet.play('boom_follow');
      this.hornL.play('boom_follow');
      this.hornR.play('boom_follow');
      this.booth.play('boom_follow');
    });
  }

  /**
   * DESIGN §10.1: the meter's three pumps at triggerHold + i x pumpGap; the horns and the lower
   * cabinet follow with feature_follow (pumps at f2 / f20 / f38 from triggerHold). A book that
   * starts with featureTrigger (no reveal: resume) skips the pumps. The skin swaps behind the wipe.
   */
  private onFeatureTrigger(p: GameEvents['feature:trigger']): void {
    const mode: MeterMode = p.feature;
    if (!this.revealed) {
      this.setMode(mode, true);
      return;
    }
    this.later(s(F.triggerHold), () => {
      this.cabinet.play('feature_follow');
      this.hornL.play('feature_follow');
      this.hornR.play('feature_follow');
    });
    this.later(s(F.triggerTotal + WIPE_COVER), () => this.setMode(mode));
  }

  private onCue(cue: GameEvents['mascot:cue']['cue'], intensity: number): void {
    switch (cue) {
      case 'reactSmall':
      case 'reactTumble':
        this.booth.play('scratch');
        break;
      case 'meterThreshold':
        // Croak adds react_small (a scratch) from notch 3 on
        if (intensity >= 0.5) this.booth.play('scratch');
        break;
      case 'featureLock':
        if (intensity < 2) this.booth.play('scratch');
        break;
      case 'celebrate':
        this.booth.play('frenzy_loop');
        break;
    }
  }

  private pump(): void {
    this.cabinet.play('pump');
    this.hornL.play('pump');
    this.hornR.play('pump');
  }

  // ======================================================================= skin / beat

  private setMode(mode: MeterMode, instant = false): void {
    this.mode = mode;
    const skin = skinOf(mode);
    if (skin === this.skin && !instant) return;
    this.skin = skin;
    this.skinTween?.kill();
    const cur = mixColor(this.tint.from, this.tint.to, this.tint.t);
    this.tint.from = cur;
    this.tint.to = SKIN_COLOR[skin];
    this.tint.t = instant ? 1 : 0;
    this.applyTint();
    if (!instant) {
      this.skinTween = gsap.to(this.tint, { t: 1, duration: sUi(STAGE_LOOK.skinFade), ease: 'sine.inOut', onUpdate: () => this.applyTint() });
    }
  }

  private applyTint(): void {
    const c = mixColor(this.tint.from, this.tint.to, this.tint.t);
    this.cabinet.setColor(c);
    this.hornL.setColor(c);
    this.hornR.setColor(c);
    this.booth.setColor(c);
  }

  private applyMotion(reduced: boolean): void {
    const m = reduced ? 0 : 1;
    this.cabinet.motion = this.hornL.motion = this.hornR.motion = this.booth.motion = m;
  }

  private update(dt: number): void {
    const beatMs = STAGE_LOOK.beatMs[this.mode];
    this.beat = (this.beat + (dt * 1000) / beatMs) % 1;
    const env = (1 - this.beat) ** 3;
    if (this.cabinet.view.visible) this.cabinet.update(dt, env);
    if (this.hornL.view.visible) {
      this.hornL.update(dt, env);
      this.hornR.update(dt, env);
    }
    if (this.booth.view.visible) this.booth.update(dt, this.beat, env);
  }

  // ======================================================================= scheduling

  /** Game-clock call `sec` (already s()-scaled) from now; a slam retimes it (followSpeed). */
  private later(sec: number, fn: () => void): void {
    const call = followSpeed(
      gsap.delayedCall(sec, () => {
        this.beats.delete(call);
        fn();
      }),
    );
    this.beats.add(call);
  }

  private cancelBeats(): void {
    for (const b of this.beats) b.kill();
    this.beats.clear();
  }
}
