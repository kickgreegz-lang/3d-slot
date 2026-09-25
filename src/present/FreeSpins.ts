import { gsap } from 'gsap';
import { BitmapText, Container } from 'pixi.js';
import type { Position } from '../book/types';
import { FONTS } from '../assets/fonts';
import { toSpotRow } from '../config/game';
import { cellCenter, type LayoutSpec } from '../config/layout';
import { clock } from '../core/clock';
import { registerTiming, s, stagger, TIMING } from '../core/timing';
import { GodRays } from '../fx/filters/GodRays';
import { rand } from '../fx/util';
import type { GameContext, GameModule } from '../game/context';
import type { GameEvents } from '../game/events';
import { ensureAmountFont, ensureLabelFont, ensureValueFont } from './common/fonts';
import { CYAN, GOLD, type GlyphStyle, PINK } from './common/glyphs';
import { OverlayStage, releaseTitlesIfIdle } from './common/OverlayStage';
import { placementFor, visibleDesignRect } from './common/placement';
import { Plate } from './common/Plate';
import { label } from './common/text';
import { punchScale, scaleTo } from './common/anim';
import { Title } from './common/Title';
import { Wipe } from './common/Wipe';

/** Local choreography (ms, speed-scaled with s()). Candidates for TIMING.freeSpins. */
export const FS_TIMING = registerTiming('freeSpinsPresent', {
  scatterStagger: 140,
  /** scatter celebration before the banner */
  scatterHold: 1100,
  /** light dim under the curtain (the curtain itself is the backdrop) */
  dimUnderWipe: 0.35,
  dimIn: 300,
  wipe: 620,
  numberSlam: 520,
  letterIn: 420,
  letterStagger: 40,
  /** taps are ignored until the banner has landed */
  tapLock: 900,
  exit: 420,
  retriggerHold: 1500,
  outroCount: 1800,
  outroIn: 480,
} as const);

const COUNTER_ACCENT = 0x35f2e0;

/** Display type for banners (sizes are landscape design px; the stage scales per layout). */
const TYPE = { family: FONTS.title, extrude: 0.1 } as const;
const NUMBER_STYLE: GlyphStyle = { ...TYPE, size: 330, palette: GOLD, outline: 0.06, tracking: 0.02 };
const WORDS_STYLE: GlyphStyle = { ...TYPE, size: 165, palette: CYAN, outline: 0.07, tracking: 0.03 };
const PLUS_STYLE: GlyphStyle = { ...TYPE, size: 260, palette: PINK, outline: 0.06 };
const TOTAL_STYLE: GlyphStyle = { ...TYPE, size: 140, palette: GOLD, outline: 0.065, tracking: 0.03 };

/** "FREE SPINS 3 / 10" plate, shown during the free game. */
class FsCounter extends Container {
  private plate = new Plate(COUNTER_ACCENT, 0.7);
  private caption: BitmapText;
  private value: BitmapText;
  private stacked = true;
  private base = 1;
  shown = false;
  current = 0;
  total = 0;
  private tweens: gsap.core.Tween[] = [];

  constructor(labelFont: string, valueFont: string) {
    super({ label: 'fsCounter' });
    this.caption = new BitmapText({
      text: label('freeSpins', 'FREE SPINS'),
      style: { fontFamily: labelFont, fontSize: 34 },
      anchor: 0.5,
    });
    this.value = new BitmapText({ text: '', style: { fontFamily: valueFont, fontSize: 58 }, anchor: 0.5 });
    this.addChild(this.plate, this.caption, this.value);
    this.visible = false;
  }

  place(L: LayoutSpec): void {
    const p = placementFor(L).fsCounter;
    this.position.set(p.x, p.y);
    this.stacked = p.stacked;
    this.base = p.scale;
    if (!this.tweens.some((t) => t.isActive())) this.scale.set(this.shown ? p.scale : 0);
    this.arrange();
  }

  private arrange(): void {
    if (this.stacked) {
      this.caption.style.fontSize = 34;
      this.value.style.fontSize = 58;
      this.caption.position.set(0, -30);
      this.value.position.set(0, 22);
      this.plate.resize(Math.max(250, this.value.width + 90, this.caption.width + 80), 128);
    } else {
      this.caption.style.fontSize = 30;
      this.value.style.fontSize = 44;
      const gap = 14;
      const w = this.caption.width + gap + this.value.width;
      this.caption.position.set(-w / 2 + this.caption.width / 2, 0);
      this.value.position.set(w / 2 - this.value.width / 2, 2);
      this.plate.resize(Math.max(300, w + 90), 64);
    }
  }

  set(current: number, total: number, punch: number): void {
    const grew = total > this.total && this.total > 0;
    this.current = current;
    this.total = total;
    this.value.text = label('hud.fsOf', '{current}/{total}', { current, total }).replace('/', ' / ');
    this.arrange();
    if (!this.shown || punch <= 0) return;
    this.tweens.push(
      punchScale(this.scale, 1.22, punch, 'back.out(3)', this.base),
    );
    if (grew) {
      this.plate.accentColor = 0xff3fa8;
      this.tweens.push(gsap.delayedCall(punch * 3, () => (this.plate.accentColor = COUNTER_ACCENT)));
    }
  }

  show(duration: number): void {
    if (this.shown) return;
    this.shown = true;
    this.visible = true;
    this.killTweens();
    this.scale.set(0);
    this.tweens.push(gsap.to(this.scale, { x: this.base, y: this.base, duration, ease: 'back.out(2.2)' }));
  }

  hide(duration: number): void {
    if (!this.shown) return;
    this.shown = false;
    this.killTweens();
    this.tweens.push(
      gsap.to(this.scale, {
        x: 0,
        y: 0,
        duration,
        ease: 'back.in(2)',
        onComplete: () => {
          this.visible = false;
        },
      }),
    );
  }

  private killTweens(): void {
    for (const t of this.tweens) t.kill();
    this.tweens = [];
  }
}

/**
 * Free-spins presentation:
 *  - 'fs:trigger'  scatter celebration, then the INTRO banner ("10 FREE SPINS") behind a
 *                  colour-band wipe; retrigger: a "+5 FREE SPINS" pop. Awaited: tap to
 *                  continue or auto after TIMING.freeSpins.introDuration.
 *  - 'fs:update'   counter plate "FREE SPINS 3 / 10" with a punch.
 *  - 'fs:end'      OUTRO summary panel "TOTAL WIN" with a count-up (tap: finish, tap: close).
 *  - 'mode:change' shows/hides the counter.
 */
export class FreeSpins implements GameModule {
  private stage: OverlayStage;
  private wipe = new Wipe();
  private counter!: FsCounter;
  private autoplay = false;
  private offs: Array<() => void> = [];
  private busy: Promise<void> | null = null;

  constructor(private ctx: GameContext) {
    this.stage = new OverlayStage(ctx, 'freeSpins');
  }

  init(): void {
    const { ctx } = this;
    const r = ctx.app.renderer;
    this.counter = new FsCounter(ensureLabelFont(r), ensureValueFont(r, ctx.money));
    ctx.layers.overlay.addChild(this.counter);
    this.stage.under.addChild(this.wipe);
    this.counter.place(ctx.layout);
    const g = ctx.game;
    this.offs.push(
      g.on('fs:trigger', (p) => this.serial(() => this.trigger(p))),
      g.on('fs:update', ({ current, total }) => this.update(current, total)),
      g.on('fs:end', (p) => this.serial(() => this.outro(p))),
      g.on('mode:change', ({ gameType }) => {
        if (gameType === 'freegame') this.counter.show(s(TIMING.freeSpins.counterPunch * 1.6));
        else this.counter.hide(s(TIMING.freeSpins.counterPunch));
      }),
      g.on('layout:change', ({ layout }) => {
        this.counter.place(layout);
        if (this.stage.isOpen) this.stage.layout(layout);
        this.wipe.relayout(visibleDesignRect(ctx));
      }),
      ctx.hud.on('hud:state', (st) => {
        this.autoplay = st.autoplayRemaining !== null && st.autoplayRemaining !== 0;
      }),
    );
  }

  private async serial(job: () => Promise<void>): Promise<void> {
    while (this.busy) await this.busy;
    this.busy = job();
    try {
      await this.busy;
    } finally {
      this.busy = null;
    }
  }

  private update(current: number, total: number): void {
    if (!this.counter.shown) this.counter.show(s(TIMING.freeSpins.counterPunch * 1.6));
    this.counter.set(current, total, s(TIMING.freeSpins.counterPunch));
  }

  private res(): number {
    return Math.min(2, this.ctx.app.renderer.resolution * this.ctx.scale * this.stage.scale * 1.1);
  }

  private design(x: number, y: number): { x: number; y: number } {
    const L = this.ctx.layout;
    const k = this.stage.scale;
    return { x: L.center.x + x * k, y: L.center.y + y * k };
  }

  // ── trigger: scatter celebration + intro / retrigger ─────────────────────

  private async celebrateScatters(positions: Position[]): Promise<void> {
    const { ctx } = this;
    const L = ctx.layout;
    ctx.game.broadcast('sfx', { id: 'fs_trigger' });
    ctx.game.broadcast('mascot:cue', { cue: 'fsTrigger', intensity: 1 });
    ctx.game.broadcast('fx:shake', { trauma: 0.45 });
    positions.forEach((p, i) => {
      const c = cellCenter(L, p.reel, toSpotRow(p.row));
      gsap.delayedCall(s(i * stagger(FS_TIMING.scatterStagger)), () => {
        ctx.game.broadcast('fx:burst', { kind: 'scatter', x: c.x, y: c.y, color: 0xffd54a });
        ctx.game.broadcast('fx:shake', { trauma: 0.22 });
      });
    });
    await clock.wait(FS_TIMING.scatterHold + positions.length * stagger(FS_TIMING.scatterStagger));
  }

  private async trigger(p: GameEvents['fs:trigger']): Promise<void> {
    const prevTotal = this.counter.total;
    if (p.positions.length) await this.celebrateScatters(p.positions);
    if (p.retrigger) {
      const added = prevTotal > 0 && p.total > prevTotal ? p.total - prevTotal : p.total;
      await this.retrigger(added);
      if (this.counter.shown && p.total > this.counter.total) {
        this.counter.set(this.counter.current, p.total, s(TIMING.freeSpins.counterPunch));
      }
      return;
    }
    await this.intro(p.total);
  }

  private waitTapOrTimeout(ms: number, lockMs: number): Promise<void> {
    return new Promise((resolve) => {
      let done = false;
      const finish = (): void => {
        if (done) return;
        done = true;
        timer.kill();
        unlock.kill();
        this.stage.onTap(null);
        resolve();
      };
      const timer = gsap.delayedCall(s(ms), finish);
      const unlock = gsap.delayedCall(s(lockMs), () => this.stage.onTap(finish));
    });
  }

  private async intro(total: number): Promise<void> {
    const { ctx } = this;
    const F = FS_TIMING;
    const L = ctx.layout;
    const res = this.res();
    const content = this.stage.content;
    const tweens: Array<gsap.core.Tween | gsap.core.Timeline> = [];

    this.stage.open({ dim: F.dimUnderWipe, fadeIn: s(F.dimIn), liftMascots: true, liftFx: true });
    const wipeDone = this.wipe.coverIn(visibleDesignRect(ctx), s(F.wipe));
    ctx.game.broadcast('sfx', { id: 'fs_intro' });

    const rays = new GodRays({ size: 1500, color: 0xff3fa8, speed: 0.2, alpha: 0.7 });
    rays.y = -40;
    rays.scale.set(0);
    this.stage.backdrop.addChild(rays);

    const number = new Title([{ text: String(total), style: NUMBER_STYLE }], res, { maxWidth: 900 });
    number.y = -120;
    number.scale.set(0);
    const words = new Title(
      [{ text: label('freeSpins', 'FREE SPINS'), style: WORDS_STYLE }],
      res,
      { maxWidth: placementFor(L).overlayMaxWidth },
    );
    words.y = 150;
    const hint = new BitmapText({
      text: label('tapToContinue', 'TAP TO CONTINUE'),
      style: { fontFamily: ensureLabelFont(ctx.app.renderer), fontSize: 34 },
      anchor: 0.5,
    });
    hint.y = 325;
    hint.alpha = 0;
    content.addChild(number, words, hint);
    for (const g of words.glyphs) g.sprite.alpha = 0;
    const offTick = clock.onUpdate((dt) => {
      number.tick(dt);
      words.tick(dt);
    });

    // banner lands as the wipe clears the centre
    const land = s(F.wipe * 0.5);
    tweens.push(
      gsap.to(rays.scale, { x: 1, y: 1, duration: s(700), delay: land, ease: 'back.out(1.5)' }),
      gsap.fromTo(
        number.scale,
        { x: 2.4, y: 2.4 },
        { x: 1, y: 1, duration: s(F.numberSlam), delay: land, ease: 'back.out(1.7)', immediateRender: false },
      ),
      gsap.delayedCall(land + s(F.numberSlam * 0.35), () => {
        const c = this.design(0, number.y);
        ctx.game.broadcast('fx:shake', { trauma: 0.55 });
        ctx.game.broadcast('fx:flash', { color: 0xffe08a, alpha: 0.32, durationMs: 200 });
        ctx.game.broadcast('fx:burst', { kind: 'scatter', x: c.x, y: c.y, color: 0xffd54a, power: 1.4 });
        const Lc = ctx.layout;
        for (const fx of [0.12, 0.88]) {
          const x = Lc.width * fx;
          ctx.game.broadcast('fx:burst', { kind: 'confetti', x, y: Lc.height + 20, count: 50, power: 1.5 });
        }
      }),
      gsap.delayedCall(land + s(F.numberSlam * 0.5), () => {
        tweens.push(words.popIn({ duration: s(F.letterIn), stagger: s(F.letterStagger), lineDelay: 0 }));
      }),
      gsap.to(number, { waveAmp: 6, duration: s(800), delay: land + s(F.numberSlam) }),
      gsap.to(words, { waveAmp: 6, duration: s(800), delay: land + s(F.numberSlam + F.letterIn) }),
      gsap.delayedCall(land + s(F.numberSlam + 500), () => void number.sweep(s(620))),
    );
    if (!this.autoplay && this.stage.tapsAllowed) {
      tweens.push(gsap.to(hint, { alpha: 1, duration: s(300), delay: land + s(900) }));
      const pulse = { duration: s(600), delay: land + s(900), ease: 'sine.inOut', yoyo: true, repeat: -1 };
      tweens.push(scaleTo(hint.scale, 1.06, pulse));
    }

    // idle sparkle while waiting
    let spark = 0;
    const offSpark = clock.onUpdate((dt) => {
      spark += dt;
      if (spark < 0.3) return;
      spark = 0;
      const c = this.design(rand(-420, 420), rand(-300, 200));
      ctx.game.broadcast('fx:burst', { kind: 'sparkle', x: c.x, y: c.y, count: 4, color: 0xfff0a0 });
    });

    await wipeDone;
    await this.waitTapOrTimeout(TIMING.freeSpins.introDuration, F.tapLock);
    offSpark();

    // exit: banner collapses, the curtain carries on and reveals the game
    for (const t of tweens) t.kill();
    tweens.length = 0;
    const exit = s(F.exit);
    tweens.push(
      gsap.to(number.scale, { x: 0, y: 0, duration: exit, ease: 'back.in(2)' }),
      gsap.to(words.scale, { x: 0, y: 0, duration: exit, ease: 'back.in(2)', delay: s(40) }),
      gsap.to(hint, { alpha: 0, duration: exit * 0.5 }),
      gsap.to(rays.scale, { x: 0, y: 0, duration: exit, ease: 'power2.in' }),
    );
    await clock.wait(F.exit * 0.55);
    const back = this.wipe.coverOut(s(F.wipe));
    await this.stage.close(s(F.wipe * 0.8));
    await back;
    offTick();
    for (const t of tweens) t.kill();
    number.destroy();
    words.destroy();
    hint.destroy();
    rays.destroy();
    releaseTitlesIfIdle(ctx);
  }

  private async retrigger(added: number): Promise<void> {
    const { ctx } = this;
    const F = FS_TIMING;
    const res = this.res();
    const content = this.stage.content;
    this.stage.open({ dim: 0.45, fadeIn: s(F.dimIn), liftMascots: true, liftFx: true });
    ctx.game.broadcast('sfx', { id: 'fs_intro', volume: 0.8 });
    const plus = new Title([{ text: `+${added}`, style: PLUS_STYLE }], res, { maxWidth: 800 });
    plus.y = -70;
    const words = new Title(
      [{ text: label('freeSpins', 'FREE SPINS'), style: { ...WORDS_STYLE, size: 112 } }],
      res,
      { maxWidth: placementFor(ctx.layout).overlayMaxWidth },
    );
    words.y = 110;
    content.addChild(plus, words);
    for (const g of words.glyphs) g.sprite.alpha = 0;
    const offTick = clock.onUpdate((dt) => {
      plus.tick(dt);
      words.tick(dt);
    });
    const tweens: Array<gsap.core.Tween | gsap.core.Timeline> = [
      gsap.fromTo(plus.scale, { x: 2.6, y: 2.6 }, { x: 1, y: 1, duration: s(F.numberSlam), ease: 'back.out(1.8)' }),
      words.popIn({ duration: s(F.letterIn), stagger: s(F.letterStagger), lineDelay: 0 }),
      gsap.to([plus, words], { waveAmp: 6, duration: s(600), delay: s(F.numberSlam) }),
    ];
    gsap.delayedCall(s(F.numberSlam * 0.35), () => {
      const c = this.design(0, plus.y);
      ctx.game.broadcast('fx:shake', { trauma: 0.4 });
      ctx.game.broadcast('fx:burst', { kind: 'scatter', x: c.x, y: c.y, color: 0xff3fa8, power: 1.1 });
    });
    await clock.wait(F.retriggerHold);
    // fly toward the counter and punch it
    const L = ctx.layout;
    const target = placementFor(L).fsCounter;
    const k = this.stage.scale;
    const tx = (target.x - L.center.x) / k;
    const ty = (target.y - L.center.y) / k;
    const fly = s(F.exit);
    tweens.push(
      gsap.to([plus, words], { x: tx, y: ty, duration: fly, ease: 'power2.in' }),
      gsap.to([plus.scale, words.scale], { x: 0.15, y: 0.15, duration: fly, ease: 'power2.in' }),
    );
    await clock.wait(F.exit);
    ctx.game.broadcast('fx:burst', { kind: 'sparkle', x: target.x, y: target.y, count: 10, color: 0xff8fcf });
    await this.stage.close(s(F.dimIn));
    offTick();
    for (const t of tweens) t.kill();
    plus.destroy();
    words.destroy();
    releaseTitlesIfIdle(ctx);
  }

  // ── outro summary ─────────────────────────────────────────────────────────

  private async outro(p: GameEvents['fs:end']): Promise<void> {
    const { ctx } = this;
    const F = FS_TIMING;
    const money = ctx.money;
    const res = this.res();
    const content = this.stage.content;
    const finalApi = money.fromBook(Math.max(0, p.amount));
    const spins = this.counter.total;

    this.stage.open({ dim: F.dimUnderWipe, fadeIn: s(F.dimIn), liftMascots: true, liftFx: true });
    const wipeDone = this.wipe.coverIn(visibleDesignRect(ctx), s(F.wipe));
    ctx.game.broadcast('sfx', { id: 'fs_outro' });
    ctx.game.broadcast('mascot:cue', { cue: 'fsEnd', intensity: Math.min(1, 0.4 + p.level * 0.08) });

    const rays = new GodRays({ size: 1500, color: 0xffb321, speed: 0.16, alpha: 0.7 });
    rays.y = -40;
    rays.scale.set(0);
    this.stage.backdrop.addChild(rays);

    const panel = new Container({ label: 'fsOutro' });
    const plate = new Plate(0xffd54a, 0.86, 'round');
    plate.resize(920, 430);
    const title = new Title(
      [{ text: label('totalWin', 'TOTAL WIN'), style: TOTAL_STYLE }],
      res,
      { maxWidth: 860 },
    );
    title.y = -215;
    const amount = new BitmapText({
      text: money.format(0),
      style: { fontFamily: ensureAmountFont(ctx.app.renderer, money), fontSize: 132 },
      anchor: 0.5,
    });
    amount.y = 10;
    const sub = new BitmapText({
      text: spins > 0 ? label('fs.summary', '{n} FREE SPINS', { n: spins }) : '',
      style: { fontFamily: ensureLabelFont(ctx.app.renderer), fontSize: 50 },
      anchor: 0.5,
    });
    sub.y = 140;
    panel.addChild(plate, amount, sub, title);
    panel.y = 20;
    panel.scale.set(0);
    content.addChild(panel);
    for (const g of title.glyphs) g.sprite.alpha = 0;
    const offTick = clock.onUpdate((dt) => title.tick(dt));

    const tweens: Array<gsap.core.Tween | gsap.core.Timeline> = [];
    const land = s(F.wipe * 0.5);
    tweens.push(
      gsap.to(rays.scale, { x: 1, y: 1, duration: s(700), delay: land, ease: 'back.out(1.5)' }),
      gsap.to(panel.scale, { x: 1, y: 1, duration: s(F.outroIn), delay: land, ease: 'back.out(1.6)' }),
      gsap.delayedCall(land + s(F.outroIn * 0.5), () => {
        tweens.push(title.popIn({ duration: s(F.letterIn), stagger: s(F.letterStagger), lineDelay: 0 }));
        ctx.game.broadcast('fx:shake', { trauma: 0.35 });
      }),
      gsap.to(title, { waveAmp: 5, duration: s(800), delay: land + s(F.outroIn + F.letterIn) }),
    );

    // count-up (tap: finish; tap again: close)
    const fitAmount = (): void => {
      const max = 820;
      amount.scale.set(1);
      if (amount.width > max) amount.scale.set(max / amount.width);
    };
    const state = { v: 0 };
    let counted = false;
    let lastText = '';
    const finishCount = (): void => {
      if (counted) return;
      counted = true;
      amount.text = money.format(finalApi); // must end exactly on the final amount
      fitAmount();
      ctx.game.broadcast('sfx', { id: 'counter_end' });
      const c = this.design(0, panel.y + amount.y);
      ctx.game.broadcast('fx:burst', { kind: 'confetti', x: c.x - 260, y: c.y, count: 45, power: 1.2 });
      ctx.game.broadcast('fx:burst', { kind: 'confetti', x: c.x + 260, y: c.y, count: 45, power: 1.2 });
      ctx.game.broadcast('fx:burst', { kind: 'coins', x: c.x, y: c.y, count: 26, power: 1.2 });
      ctx.game.broadcast('fx:shake', { trauma: 0.3 });
      tweens.push(punchScale(amount.scale, 1.2, s(420), 'elastic.out(1, 0.5)', amount.scale.x));
      void title.sweep(s(620));
    };
    const count = gsap.to(state, {
      v: 1,
      duration: s(F.outroCount),
      delay: land + s(F.outroIn),
      ease: 'power2.out',
      onUpdate: () => {
        const txt = money.format(Math.round(finalApi * state.v));
        if (txt !== lastText) {
          lastText = txt;
          amount.text = txt;
          fitAmount();
        }
      },
      onComplete: finishCount,
    });
    tweens.push(count);

    await wipeDone;
    await new Promise<void>((resolve) => {
      let closed = false;
      const close = (): void => {
        if (closed) return;
        closed = true;
        hold?.kill();
        resolve();
      };
      let hold: gsap.core.Tween | null = null;
      const armHold = (): void => {
        hold = gsap.delayedCall(s(TIMING.freeSpins.outroDuration), close);
      };
      count.eventCallback('onComplete', () => {
        finishCount();
        armHold();
      });
      if (count.progress() >= 1) armHold();
      this.stage.onTap(() => {
        if (!counted) {
          count.progress(1);
          return;
        }
        close();
      });
    });

    const exit = s(F.exit);
    tweens.push(
      gsap.to(panel.scale, { x: 0, y: 0, duration: exit, ease: 'back.in(1.8)' }),
      gsap.to(rays.scale, { x: 0, y: 0, duration: exit, ease: 'power2.in' }),
    );
    await clock.wait(F.exit * 0.55);
    const back = this.wipe.coverOut(s(F.wipe));
    await this.stage.close(s(F.wipe * 0.8));
    await back;
    offTick();
    for (const t of tweens) t.kill();
    title.destroy();
    panel.destroy({ children: true });
    rays.destroy();
    releaseTitlesIfIdle(ctx);
  }

  destroy(): void {
    for (const off of this.offs) off();
    this.stage.destroy();
    this.counter.destroy({ children: true });
  }
}
