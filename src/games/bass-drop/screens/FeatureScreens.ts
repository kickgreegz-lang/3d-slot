import { gsap } from 'gsap';
import { Sprite, Texture } from 'pixi.js';
import { mulberry32 } from '../../../board/model';
import type { LayoutSpec } from '../../../config/layout';
import { clock } from '../../../core/clock';
import { followSpeed, s, sUi, TIMING } from '../../../core/timing';
import type { GameContext, GameModule } from '../../../game/context';
import type { GameEvents } from '../../../game/events';
import { ensureAmountFont } from '../../../present/common/fonts';
import { OverlayStage, releaseTitlesIfIdle } from '../../../present/common/OverlayStage';
import { visibleDesignRect } from '../../../present/common/placement';
import { label } from '../../../present/common/text';
import type { GrooveFeature } from '../events';
import { BASS_DROP_LAYOUT } from '../layout';
import { BASS_DROP_TIMING, GOLD, PINK } from '../timing';
import { screenArt } from './art/ScreenArt';
import { type BannerEvent, FeatureBanner } from './FeatureBanner';
import { FeaturePlate } from './FeaturePlate';
import { FeatureWipe } from './FeatureWipe';
import { ensureScreenFonts } from './fonts';
import { SCREENS_TIMING, SKINS, skinOf } from './look';
import { ModalGate, onScreenKey } from './ui';
import { type UpgradeEvent, UpgradeBanner } from './UpgradeBanner';

const T = BASS_DROP_TIMING;
const S = SCREENS_TIMING;
/** Music tempo per feature (DESIGN §17): the emblem pump sits on the beat. */
const BPM = { bonus: 106, super: 112 } as const;

/**
 * FEATURE SCREENS (DESIGN §10, §14) — replaces the engine FreeSpins presenter for Bass Drop:
 *
 *  - 'feature:trigger'  held until the feature intro is dismissed (the flow then switches to
 *                       the free game while the curtain still covers the screen):
 *                         t 0      HUD blocked (transparent stage + hotkeys; SPACE / ENTER are
 *                                  the screen's tap), the grid dims to 0.5 / 300 ms
 *                         t 200    mascot cue fsTrigger (the meter owns the 3 pumps, flash,
 *                                  hit-stop and fs_trigger SFX on its own schedule)
 *                         t 1800   wipe (620 ms) in the feature colour + fs_intro
 *                         t 2420   JUKE JAM / MEGA MIX intro `in`: title_hit (trauma 0.35),
 *                                  count_hit "8" / "10" (trauma 0.2), shine; "TAP TO START"
 *                                  (1 Hz; hidden in autoplay). Taps unlock after 900 UI ms;
 *                                  autoplay (or a jurisdiction without skipping) continues
 *                                  after TIMING.freeSpins.introDuration.
 *                       A book that starts with featureTrigger (no reveal this round, [M-7])
 *                       goes straight to the wipe. A bought feature plays the same.
 *  - 'feature:upgrade'  2,200 ms: crack, shatter (0.3), Mega Mix slam (0.5 + pink flash),
 *                       "+4 FREE SPINS" (0.2); a tap skips the hold. Plate + music retitle
 *                       on the slam.
 *  - 'fs:end'           (after the flow's bigwin:show) curtain + TOTAL WIN counting 1,800 ms
 *                       with a final punch; 1st tap jumps the count, 2nd closes; auto-closes
 *                       after TIMING.freeSpins.outroDuration. Resolves under the curtain, so
 *                       the base game returns behind it.
 *  - 'fs:update' / 'mode:change' / 'meter:set'  the feature plate (landscape / tablet only:
 *                       portrait / compact show the free spins in the meter chip).
 * Mega Mix sets the 'music:stem' variant behind the curtain / on the upgrade slam (and on a
 * resumed Mega Mix); mode:change basegame clears it. Gameplay time throughout (s(),
 * followSpeed), except the 900 ms tap lock (UI time).
 */
export class FeatureScreens implements GameModule {
  private readonly stage: OverlayStage;
  private readonly wipe = new FeatureWipe();
  private banner!: FeatureBanner;
  private readonly upgrade = new UpgradeBanner();
  private readonly plate = new FeaturePlate();
  private readonly dim = new Sprite({ texture: Texture.WHITE, tint: 0x000000, alpha: 0 });
  /** HUD hotkeys are blocked while a screen is up (DESIGN §14): SPACE / ENTER act as its tap */
  private readonly gate = new ModalGate();
  private offKey: (() => void) | null = null;
  private tapFn: (() => void) | null = null;
  private spaceAllowed = true;
  private dimTween: gsap.core.Tween | null = null;
  private offs: Array<() => void> = [];
  private busy: Promise<void> | null = null;
  /** the curtain still sweeping out after a screen resolved */
  private tail: Promise<void> | null = null;
  private feature: GrooveFeature | null = null;
  private fs = { current: 0, total: 0 };
  private revealed = false;
  private autoplay = false;
  private freegame = false;
  /** pending waits / taps: destroy() resolves them so nothing can hang */
  private readonly pending = new Set<() => void>();
  /** a waiting intro / outro re-checks autoplay when the HUD state changes */
  private onAutoplay: (() => void) | null = null;
  private sparkT = 0;
  private sparks = false;
  private rnd = mulberry32(0xb0d5);
  /** set by destroy(): running sequences stop at their next step */
  private dead = false;

  constructor(private readonly ctx: GameContext) {
    this.stage = new OverlayStage(ctx, 'featureScreens');
  }

  init(): void {
    const { ctx } = this;
    ensureScreenFonts(ctx.app.renderer);
    screenArt.retain(ctx.app.renderer);
    this.banner = new FeatureBanner(ensureAmountFont(ctx.app.renderer, ctx.money));
    this.stage.under.addChild(this.wipe);
    this.stage.backdrop.addChild(this.banner.back, this.upgrade.back);
    this.stage.content.addChild(this.banner.front, this.upgrade.front);
    // grid dim for the trigger: above the symbols, under the frame (the board layer is masked
    // to the panel by the Board's own mask only, so the rect is sized to the panel)
    this.dim.label = 'featureDim';
    ctx.layers.board.addChild(this.dim);
    ctx.layers.logo.addChild(this.plate.view);
    this.layout(ctx.layout);

    const g = ctx.game;
    this.offs.push(
      g.on('feature:trigger', (p) => this.serial(() => this.trigger(p))),
      g.on('feature:upgrade', (p) => this.serial(() => this.upgradeScreen(p))),
      g.on('fs:end', (p) => this.serial(() => this.outro(p))),
      g.on('fs:update', ({ current, total }) => this.onFsUpdate(current, total)),
      g.on('mode:change', ({ gameType }) => this.onModeChange(gameType === 'freegame')),
      g.on('meter:set', ({ mode }) => this.onMeterSet(mode)),
      g.on('round:start', () => this.onRoundStart()),
      g.on('board:reveal', () => void (this.revealed = true)),
      g.on('layout:change', ({ layout }) => this.layout(layout)),
      ctx.hud.on('hud:state', (st) => {
        this.spaceAllowed = st.spacebarAllowed !== false;
        const auto = st.autoplayRemaining !== null && st.autoplayRemaining !== 0;
        if (auto === this.autoplay) return;
        this.autoplay = auto;
        this.onAutoplay?.();
      }),
      clock.onUpdate((dt) => this.update(dt)),
    );
  }

  layout(L: LayoutSpec): void {
    const p = L.panel;
    this.dim.position.set(p.x, p.y);
    this.dim.width = p.w;
    this.dim.height = p.h;
    const rect = BASS_DROP_LAYOUT[L.kind].fsPlate;
    this.plate.place(rect === 'meterChip' ? null : rect, this.bakeRes());
    if (this.stage.isOpen) this.stage.layout(L);
    this.wipe.relayout(visibleDesignRect(this.ctx));
    this.banner?.rebake(this.res());
  }

  destroy(): void {
    this.dead = true;
    for (const off of this.offs) off();
    this.offs = [];
    for (const done of [...this.pending]) done();
    this.pending.clear();
    this.unblock();
    this.gate.destroy();
    this.dimTween?.kill();
    this.banner.destroy();
    this.upgrade.destroy();
    this.wipe.destroy();
    this.plate.destroy();
    this.dim.destroy();
    this.stage.destroy();
    screenArt.release();
  }

  // ------------------------------------------------------------------ plumbing

  private async serial(job: () => Promise<void>): Promise<void> {
    while (this.busy) await this.busy;
    this.busy = (async () => {
      if (this.tail) await this.tail;
      await job();
    })();
    try {
      await this.busy;
    } finally {
      this.busy = null;
    }
  }

  /**
   * A screen is up: the HUD is disabled (DESIGN §14). The stage already swallows every pointer
   * event; the gate blocks the HUD hotkeys too, so SPACE never slam-stops the rest of the
   * feature from under a banner. SPACE / ENTER act as the screen's own tap instead (same
   * jurisdiction rules as the HUD: spacebarAllowed, and taps need slamStopAllowed).
   */
  private block(): void {
    this.gate.open();
    this.offKey ??= onScreenKey((key) => {
      if (key === 'confirm' && this.spaceAllowed && this.stage.tapsAllowed) this.tapFn?.();
    });
  }

  /** The flow moves on (hand-off, round start, teardown): the HUD takes its keys back. */
  private unblock(): void {
    this.gate.close();
    this.offKey?.();
    this.offKey = null;
  }

  /** The current tap handler (pointer taps through the stage, SPACE / ENTER through block()). */
  private setTap(fn: (() => void) | null): void {
    this.tapFn = fn;
    this.stage.onTap(fn);
  }

  /** Gameplay wait (s(), follows a slam-stop); resolved early by destroy(). */
  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      let call: gsap.core.Tween | null = null;
      const done = (): void => {
        this.pending.delete(done);
        call?.kill();
        resolve();
      };
      this.pending.add(done);
      call = followSpeed(gsap.delayedCall(s(ms), done));
    });
  }

  /** Title bake resolution (display px per content px). */
  private res(): number {
    const r = this.ctx.app.renderer.resolution * this.ctx.scale * this.stage.scale * 1.1;
    return Math.min(2, Math.max(1, r));
  }

  /** Art bake resolution for the plate (display px per design px). */
  private bakeRes(): number {
    return Math.min(2, Math.max(0.5, this.ctx.app.renderer.resolution * this.ctx.scale));
  }

  /** Content space -> design space. */
  private design(x: number, y: number): { x: number; y: number } {
    const L = this.ctx.layout;
    const k = this.stage.scale;
    return { x: L.center.x + x * k, y: L.center.y + y * k };
  }

  private dimBoard(alpha: number, duration: number): void {
    this.dimTween?.kill();
    this.dimTween = null;
    if (duration <= 0) {
      this.dim.alpha = alpha;
      return;
    }
    this.dimTween = followSpeed(gsap.to(this.dim, { alpha, duration, ease: 'power2.out' }));
  }

  /** Can the player tap through this screen (jurisdiction) and is anyone there (autoplay)? */
  private get manual(): boolean {
    return !this.autoplay && this.stage.tapsAllowed;
  }

  private update(dt: number): void {
    this.banner?.tick(dt);
    this.upgrade.tick(dt);
    if (!this.sparks) return;
    this.sparkT += dt;
    if (this.sparkT < 0.3) return;
    this.sparkT = 0;
    const c = this.design((this.rnd() - 0.5) * 840, (this.rnd() - 0.5) * 500 - 50);
    const color = this.feature === 'super' ? 0xff9ae6 : 0xfff0a0;
    this.ctx.game.broadcast('fx:burst', { kind: 'sparkle', x: c.x, y: c.y, count: 4, color });
  }

  // ------------------------------------------------------------------ plate / mode

  private onFsUpdate(current: number, total: number): void {
    this.fs = { current, total };
    if (this.freegame && !this.plate.shown) this.plate.show(s(S.plate.show));
    this.plate.set(current, total, s(S.plate.punch));
  }

  private onModeChange(freegame: boolean): void {
    this.freegame = freegame;
    if (freegame) {
      this.plate.setSkin(skinOf(this.feature ?? 'bonus'));
      this.plate.set(this.fs.current, this.fs.total, 0);
      this.plate.show(s(S.plate.show));
      return;
    }
    this.plate.hide(s(S.plate.hide));
    this.feature = null;
    this.fs = { current: 0, total: 0 };
  }

  /** Resume / replay start: the folded feature (plate title, Mega Mix music). */
  private onMeterSet(mode: 'base' | GrooveFeature): void {
    if (mode === 'base') return;
    this.feature = mode;
    this.plate.setSkin(skinOf(mode));
    if (mode === 'super') this.ctx.game.broadcast('music:stem', { stem: 'megamix' });
  }

  private onRoundStart(): void {
    this.revealed = false;
    this.unblock();
    // a curtain still sweeping out from the last round ends now
    this.wipe.finish();
  }

  // ------------------------------------------------------------------ trigger + intro

  private async trigger(p: GameEvents['feature:trigger']): Promise<void> {
    const { ctx } = this;
    const skin = skinOf(p.feature);
    this.feature = p.feature;
    this.fs = { current: 0, total: p.totalFs };
    this.plate.setSkin(skin);
    this.plate.set(0, p.totalFs, 0);
    // the HUD is blocked from t 0 (transparent stage over everything); nothing skips the trigger
    this.stage.open({ dim: 0, fadeIn: 0 });
    this.setTap(null);
    this.block();
    // the music dips under the trigger from t 0 (Bass Drop has no fs:trigger, whose duck the
    // engine Sound applies); fs_trigger (last pump) and fs_intro (wipe) extend it
    ctx.game.broadcast('music:duck', { db: S.trigger.duckDb, holdMs: S.trigger.duckHold });
    const meter = BASS_DROP_LAYOUT[ctx.layout.kind].meter;
    const look = { x: meter.cx, y: meter.cy };
    if (this.revealed) {
      this.dimBoard(T.feature.triggerDim, s(S.trigger.dimIn));
      const cue = followSpeed(
        gsap.delayedCall(s(S.trigger.mascotAt), () => ctx.game.broadcast('mascot:cue', { cue: 'fsTrigger', intensity: 1, look })),
      );
      await this.wait(T.feature.triggerTotal);
      cue.kill();
      if (this.dead) return;
    } else {
      // [M-7] the round starts with featureTrigger: no meter overload, straight to the wipe
      ctx.game.broadcast('mascot:cue', { cue: 'fsTrigger', intensity: 1, look });
    }
    ctx.game.broadcast('sfx', { id: 'fs_intro' });
    this.stage.open({ dim: S.trigger.stageDim, fadeIn: s(300), liftMascots: true, liftFx: true });
    await this.wipe.coverIn(visibleDesignRect(ctx), SKINS[skin], s(S.trigger.wipe));
    if (this.dead) return;
    // behind the curtain: the grid un-dims, Mega Mix switches the music variant
    this.dimBoard(0, 0);
    if (p.feature === 'super') ctx.game.broadcast('music:stem', { stem: 'megamix' });
    await this.featureIntro(p.feature, p.totalFs);
  }

  private async featureIntro(feature: GrooveFeature, total: number): Promise<void> {
    const F = S.featureIntro;
    const banner = this.banner;
    this.rnd = mulberry32(0xb0d5 + total * 31 + (feature === 'super' ? 7 : 0));
    banner.setup({ mode: 'intro', skin: skinOf(feature), res: this.res(), count: total, bpm: BPM[feature] });
    banner.playIn(s, (e) => this.onBannerEvent(e, 'intro'));
    this.sparks = true;
    await this.waitStart();
    if (this.dead) return;
    this.sparks = false;
    banner.hidePress();
    banner.playOut(s(F.out));
    await this.wait(F.out);
    if (this.dead) return;
    banner.clear();
    this.handOff();
  }

  /**
   * Tap after the 900 UI-ms lock; autoplay (or no tap allowed) after introDuration from the
   * banner's `in`. "TAP TO START" shows once the count has landed, only for a manual start.
   */
  private waitStart(): Promise<void> {
    const F = S.featureIntro;
    return new Promise((resolve) => {
      let unlocked = false;
      let auto: gsap.core.Tween | null = null;
      let pressShown = false;
      const started = clock.time;
      const unlock = gsap.delayedCall(sUi(T.feature.introTapLock), () => (unlocked = true));
      const finish = (): void => {
        if (!this.pending.has(finish)) return;
        this.pending.delete(finish);
        unlock.kill();
        auto?.kill();
        this.setTap(null);
        this.onAutoplay = null;
        resolve();
      };
      const arm = (): void => {
        if (this.manual) {
          auto?.kill();
          auto = null;
          if (!pressShown) {
            pressShown = true;
            const at = Math.max(0, s(F.pressIn) - (clock.time - started));
            this.banner.showPress(label('bd.feature.tapToStart', 'TAP TO START'), at);
          }
          return;
        }
        this.banner.hidePress();
        pressShown = false;
        if (auto) return;
        const left = Math.max(0, s(TIMING.freeSpins.introDuration) - (clock.time - started));
        auto = followSpeed(gsap.delayedCall(left, finish));
      };
      this.pending.add(finish);
      this.onAutoplay = arm;
      this.setTap(() => {
        if (unlocked) finish();
      });
      arm();
    });
  }

  /** Resolve the screen now: the curtain sweeps out on its own while the flow moves on. */
  private handOff(): void {
    this.unblock();
    const back = this.wipe.coverOut(s(S.trigger.wipe));
    const closed = this.stage.close(s(S.trigger.wipe * 0.8));
    this.tail = Promise.all([back, closed]).then(() => {
      this.tail = null;
      if (!this.stage.isOpen) releaseTitlesIfIdle(this.ctx);
    });
  }

  private onBannerEvent(e: BannerEvent, mode: 'intro' | 'outro'): void {
    const { ctx } = this;
    const accent = this.feature === 'super' ? PINK : GOLD;
    if (e === 'title_hit') {
      const c = this.design(this.banner.emblemPos.x, this.banner.emblemPos.y);
      ctx.game.broadcast('fx:shake', { trauma: mode === 'intro' ? T.shake.introTitle : T.shake.titleHit });
      ctx.game.broadcast('fx:burst', { kind: 'scatter', x: c.x, y: c.y, color: accent, power: 1.3 });
      return;
    }
    if (e === 'count_hit') {
      const c = this.design(this.banner.countPos.x, this.banner.countPos.y);
      ctx.game.broadcast('fx:shake', { trauma: T.shake.countHit });
      ctx.game.broadcast('fx:burst', { kind: 'explode', x: c.x, y: c.y, color: accent, power: 0.8 });
      const L = ctx.layout;
      for (const fx of [0.12, 0.88]) ctx.game.broadcast('fx:burst', { kind: 'confetti', x: L.width * fx, y: L.height + 20, count: 40, power: 1.4 });
      return;
    }
    this.banner.shine(s(620));
  }

  // ------------------------------------------------------------------ upgrade

  private async upgradeScreen(p: GameEvents['feature:upgrade']): Promise<void> {
    const { ctx } = this;
    const U = S.upgrade;
    const addFs = p.addFs;
    this.stage.open({ dim: 0.6, fadeIn: s(220), liftMascots: true, liftFx: true });
    this.setTap(null);
    this.block();
    ctx.game.broadcast('mascot:cue', { cue: 'featureUpgrade', intensity: 1 });
    const up = this.upgrade;
    up.setup(this.res(), addFs);
    up.playIn(s, (e) => this.onUpgradeEvent(e, addFs));
    await this.wait(U.in);
    if (this.dead) return;
    // hold (a tap skips it), then out: 2,200 ms in all
    const hold = T.feature.upgrade - U.in - U.out;
    await this.holdOrTap(hold);
    if (this.dead) return;
    up.playOut(s(U.out));
    await this.wait(U.out);
    if (this.dead) return;
    up.clear();
    this.unblock();
    await this.stage.close(s(160));
    releaseTitlesIfIdle(ctx);
  }

  private holdOrTap(ms: number): Promise<void> {
    return new Promise((resolve) => {
      let call: gsap.core.Tween | null = null;
      const done = (): void => {
        if (!this.pending.has(done)) return;
        this.pending.delete(done);
        call?.kill();
        this.setTap(null);
        resolve();
      };
      this.pending.add(done);
      this.setTap(done);
      call = followSpeed(gsap.delayedCall(s(Math.max(0, ms)), done));
    });
  }

  private onUpgradeEvent(e: UpgradeEvent, addFs: number): void {
    const { ctx } = this;
    const at = (pt: { x: number; y: number }): { x: number; y: number } => this.design(pt.x, pt.y);
    switch (e) {
      case 'crack': {
        ctx.game.broadcast('sfx', { id: 'feature_upgrade' });
        ctx.game.broadcast('fx:shake', { trauma: 0.12 });
        break;
      }
      case 'shatter': {
        const c = at(this.upgrade.emblemPos);
        ctx.game.broadcast('fx:shake', { trauma: T.shake.upgradeShatter });
        ctx.game.broadcast('fx:burst', { kind: 'explode', x: c.x, y: c.y, color: GOLD, power: 1.2 });
        ctx.game.broadcast('fx:burst', { kind: 'sparkle', x: c.x, y: c.y, count: 14, color: 0x35f2e0 });
        break;
      }
      case 'title_hit': {
        const c = at(this.upgrade.emblemPos);
        ctx.game.broadcast('fx:shake', { trauma: T.shake.upgrade });
        ctx.game.broadcast('fx:flash', { color: PINK, alpha: T.flash.upgrade, durationMs: S.upgrade.flashMs });
        ctx.game.broadcast('fx:burst', { kind: 'scatter', x: c.x, y: c.y, color: PINK, power: 1.4 });
        // behind the screen: the plate re-titles and its total jumps, the music goes Mega Mix
        this.feature = 'super';
        this.plate.setSkin('megamix', s(S.plate.retitle));
        this.fs = { current: this.fs.current, total: this.fs.total + addFs };
        this.plate.set(this.fs.current, this.fs.total, s(S.plate.punch));
        ctx.game.broadcast('music:stem', { stem: 'megamix' });
        break;
      }
      case 'count_hit': {
        const c = at(this.upgrade.addPos);
        ctx.game.broadcast('fx:shake', { trauma: T.shake.countHit });
        ctx.game.broadcast('fx:burst', { kind: 'explode', x: c.x, y: c.y, color: GOLD, power: 0.8 });
        break;
      }
    }
  }

  // ------------------------------------------------------------------ outro

  private async outro(p: GameEvents['fs:end']): Promise<void> {
    const { ctx } = this;
    const O = S.outro;
    const money = ctx.money;
    const feature = this.feature ?? 'bonus';
    const skin = skinOf(feature);
    const finalApi = money.fromBook(Math.max(0, p.amount));
    this.stage.open({ dim: S.trigger.stageDim, fadeIn: s(300), liftMascots: true, liftFx: true });
    this.setTap(null);
    this.block();
    ctx.game.broadcast('sfx', { id: 'fs_outro' });
    await this.wipe.coverIn(visibleDesignRect(ctx), SKINS[skin], s(S.trigger.wipe));
    if (this.dead) return;
    const banner = this.banner;
    this.rnd = mulberry32(0x0e7d + (p.amount % 9973));
    banner.setup({ mode: 'outro', skin, res: this.res(), count: 0, bpm: BPM[feature] });
    banner.amount.text = money.format(0);
    banner.fitAmount();
    banner.playIn(s, (e) => this.onBannerEvent(e, 'outro'));
    this.sparks = true;

    // count-up after the `in`: 1st tap jumps it, 2nd closes; auto-close after the hold
    await new Promise<void>((resolve) => {
      const state = { v: 0 };
      let counted = false;
      let last = '';
      let hold: gsap.core.Tween | null = null;
      const close = (): void => {
        if (!this.pending.has(close)) return;
        this.pending.delete(close);
        count.kill();
        hold?.kill();
        this.setTap(null);
        this.onAutoplay = null;
        resolve();
      };
      const finishCount = (): void => {
        if (counted) return;
        counted = true;
        banner.amount.text = money.format(finalApi); // ends exactly on the feature total
        banner.fitAmount();
        banner.punchAmount(s(O.punch * 3));
        const c = this.design(banner.countPos.x, banner.countPos.y);
        ctx.game.broadcast('sfx', { id: 'counter_end' });
        ctx.game.broadcast('fx:shake', { trauma: T.shake.countHit });
        ctx.game.broadcast('fx:burst', { kind: 'coins', x: c.x, y: c.y, count: 26, power: 1.2 });
        for (const dx of [-260, 260]) ctx.game.broadcast('fx:burst', { kind: 'confetti', x: c.x + dx, y: c.y, count: 40, power: 1.2 });
        banner.shine(s(620));
        if (this.manual) banner.showPress(label('bd.feature.tapToContinue', 'TAP TO CONTINUE'), s(O.pressIn));
        hold = followSpeed(gsap.delayedCall(s(TIMING.freeSpins.outroDuration), close));
      };
      const count = followSpeed(
        gsap.to(state, {
          v: 1,
          duration: s(O.count),
          delay: s(O.in),
          ease: 'power2.out',
          onUpdate: () => {
            const txt = money.format(Math.round(finalApi * state.v));
            if (txt === last) return;
            last = txt;
            banner.amount.text = txt;
            banner.fitAmount();
          },
          onComplete: finishCount,
        }),
      );
      this.pending.add(close);
      this.onAutoplay = () => {
        if (!this.manual) banner.hidePress();
      };
      this.setTap(() => {
        if (!counted) {
          count.progress(1);
          return;
        }
        close();
      });
    });

    if (this.dead) return;
    this.sparks = false;
    banner.hidePress();
    banner.playOut(s(O.out));
    await this.wait(O.out);
    if (this.dead) return;
    banner.clear();
    this.handOff();
  }
}
