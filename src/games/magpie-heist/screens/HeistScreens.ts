import { gsap } from 'gsap';
import { BitmapText, Container, Sprite } from 'pixi.js';
import type { Position } from '../../../book/types';
import { toSpotRow } from '../../../config/game';
import { cellCenter, type LayoutSpec } from '../../../config/layout';
import { clock } from '../../../core/clock';
import { s, stagger, TIMING } from '../../../core/timing';
import { GodRays } from '../../../fx/filters/GodRays';
import { rand } from '../../../fx/util';
import type { GameContext, GameModule } from '../../../game/context';
import type { GameEvents } from '../../../game/events';
import { punchScale, scaleTo } from '../../../present/common/anim';
import { ensureAmountFont, ensureLabelFont, ensureValueFont } from '../../../present/common/fonts';
import { OverlayStage, releaseTitlesIfIdle } from '../../../present/common/OverlayStage';
import { placementFor, visibleDesignRect } from '../../../present/common/placement';
import { Plate } from '../../../present/common/Plate';
import { label } from '../../../present/common/text';
import { Title } from '../../../present/common/Title';
import { Wipe } from '../../../present/common/Wipe';
import type { HeistFeature } from '../config';
import { HEIST_TIMING } from '../timing';
import { GOLD, HEIST_LOOK, RUBY, style } from './look';

const T = HEIST_TIMING.screens;
const WIPE = 620;
const SLAM = 520;
const LETTER_IN = 420;
const LETTER_STAGGER = 40;
const TAP_LOCK = 900;
const EXIT = 420;
const OUTRO_COUNT = 1800;
const OUTRO_IN = 480;

/** The heist's emblem: the bandit mask prowls, the safe is the vault, the star falls. */
const EMBLEM: Record<HeistFeature, string> = { prowl: 'W', vault: 'S', starfall: 'R' };

/** "NIGHT PROWL  3 / 8" plate shown during a heist (in the bonus-buy slot). */
class HeistPlate extends Container {
  private readonly plate = new Plate(HEIST_LOOK.prowl.accent, 0.78);
  private readonly caption: BitmapText;
  private readonly value: BitmapText;
  private base = 1;
  shown = false;
  current = 0;
  total = 0;
  private tweens: gsap.core.Tween[] = [];

  constructor(labelFont: string, valueFont: string) {
    super({ label: 'heistPlate' });
    this.caption = new BitmapText({ text: '', style: { fontFamily: labelFont, fontSize: 30 }, anchor: 0.5 });
    this.value = new BitmapText({ text: '', style: { fontFamily: valueFont, fontSize: 56 }, anchor: 0.5 });
    this.caption.y = -28;
    this.value.y = 22;
    this.addChild(this.plate, this.caption, this.value);
    this.visible = false;
  }

  place(L: LayoutSpec): void {
    const p = placementFor(L).fsCounter;
    this.position.set(p.x, p.y);
    this.base = p.scale;
    if (!this.tweens.some((t) => t.isActive())) this.scale.set(this.shown ? p.scale : 0);
  }

  setFeature(f: HeistFeature): void {
    this.caption.text = label(HEIST_LOOK[f].title, f.toUpperCase());
    this.plate.accentColor = HEIST_LOOK[f].accent;
    this.arrange();
  }

  private arrange(): void {
    this.plate.resize(Math.max(260, this.caption.width + 70, this.value.width + 90), 124);
  }

  set(current: number, total: number, punch: number): void {
    const grew = total > this.total && this.total > 0;
    this.current = current;
    this.total = total;
    this.value.text = label('heist.spinsOf', '{current} / {total}', { current, total });
    this.arrange();
    if (!this.shown || punch <= 0) return;
    this.tweens.push(punchScale(this.scale, 1.2, punch, 'back.out(3)', this.base));
    if (grew) {
      const was = this.plate.accentColor;
      this.plate.accentColor = 0xff3a52;
      this.tweens.push(gsap.delayedCall(punch * 3, () => (this.plate.accentColor = was)));
    }
  }

  show(duration: number): void {
    if (this.shown) return;
    this.shown = true;
    this.visible = true;
    this.kill();
    this.scale.set(0);
    this.tweens.push(gsap.to(this.scale, { x: this.base, y: this.base, duration, ease: 'back.out(2.2)' }));
  }

  hide(duration: number): void {
    if (!this.shown) return;
    this.shown = false;
    this.kill();
    this.tweens.push(gsap.to(this.scale, { x: 0, y: 0, duration, ease: 'back.in(2)', onComplete: () => void (this.visible = false) }));
  }

  private kill(): void {
    for (const t of this.tweens) t.kill();
    this.tweens = [];
  }
}

/**
 * HEIST SCREENS (replaces the engine FreeSpins presenter; DESIGN §7):
 *  - 'heist:trigger'   the Safes burst (staggered), then the heist INTRO behind a wipe: the heist's
 *                      emblem (mask / safe / star) on god rays, the title in the heist's colours, the
 *                      spin count slam and the one-line rule; tap or auto;
 *  - 'heist:retrigger' "+N FREE SPINS" pop that flies into the plate;
 *  - 'heist:upgrade'   "UPGRADE!" -> VAULT RAID slam, +N, the plate recolours;
 *  - 'fs:update'       the plate "NIGHT PROWL 3 / 8" with a punch;
 *  - 'fs:end'          the TOTAL LOOT outro with a count-up (tap: finish, tap: close);
 *  - 'mode:change'     shows / hides the plate.
 */
export class HeistScreens implements GameModule {
  private readonly stage: OverlayStage;
  private readonly wipe = new Wipe();
  private plate!: HeistPlate;
  private feature: HeistFeature = 'prowl';
  private autoplay = false;
  private offs: Array<() => void> = [];
  private busy: Promise<void> | null = null;

  constructor(private readonly ctx: GameContext) {
    this.stage = new OverlayStage(ctx, 'heistScreens');
  }

  init(): void {
    const { ctx } = this;
    const r = ctx.app.renderer;
    this.plate = new HeistPlate(ensureLabelFont(r), ensureValueFont(r, ctx.money));
    ctx.layers.overlay.addChild(this.plate);
    this.stage.under.addChild(this.wipe);
    this.plate.place(ctx.layout);
    const g = ctx.game;
    this.offs.push(
      g.on('heist:trigger', (p) => this.serial(() => this.trigger(p))),
      g.on('heist:retrigger', (p) => this.serial(() => this.retrigger(p.addFs, p.positions))),
      g.on('heist:upgrade', (p) => this.serial(() => this.upgrade(p))),
      g.on('heist:mode', ({ feature }) => {
        if (!feature) return;
        this.feature = feature;
        this.plate.setFeature(feature);
      }),
      g.on('fs:update', ({ current, total }) => this.update(current, total)),
      g.on('fs:end', (p) => this.serial(() => this.outro(p))),
      g.on('mode:change', ({ gameType }) => {
        if (gameType === 'freegame') this.plate.show(s(TIMING.freeSpins.counterPunch * 1.6));
        else this.plate.hide(s(TIMING.freeSpins.counterPunch));
      }),
      g.on('layout:change', ({ layout }) => {
        this.plate.place(layout);
        if (this.stage.isOpen) this.stage.layout(layout);
        this.wipe.relayout(visibleDesignRect(ctx));
      }),
      ctx.hud.on('hud:state', (st) => {
        this.autoplay = st.autoplayRemaining !== null && st.autoplayRemaining !== 0;
      }),
    );
  }

  destroy(): void {
    for (const off of this.offs) off();
    this.stage.destroy();
    this.plate.destroy({ children: true });
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
    if (!this.plate.shown) this.plate.show(s(TIMING.freeSpins.counterPunch * 1.6));
    this.plate.set(current, total, s(TIMING.freeSpins.counterPunch));
  }

  private res(): number {
    return Math.min(2, this.ctx.app.renderer.resolution * this.ctx.scale * this.stage.scale * 1.1);
  }

  private design(x: number, y: number): { x: number; y: number } {
    const L = this.ctx.layout;
    const k = this.stage.scale;
    return { x: L.center.x + x * k, y: L.center.y + y * k };
  }

  // ------------------------------------------------------------------ the safes crack open

  private async celebrate(positions: Position[], color: number): Promise<void> {
    const { ctx } = this;
    const L = ctx.layout;
    ctx.game.broadcast('sfx', { id: 'fs_trigger' });
    ctx.game.broadcast('mascot:cue', { cue: 'fsTrigger', intensity: 1 });
    ctx.game.broadcast('fx:shake', { trauma: 0.45 });
    positions.forEach((p, i) => {
      const c = cellCenter(L, p.reel, toSpotRow(p.row));
      gsap.delayedCall(s(i * stagger(140)), () => {
        ctx.game.broadcast('board:play', { reel: p.reel, row: p.row, clip: 'win', next: 'win_loop' });
        ctx.game.broadcast('fx:burst', { kind: 'scatter', x: c.x, y: c.y, color });
        ctx.game.broadcast('fx:burst', { kind: 'coins', x: c.x, y: c.y, count: 10, power: 0.9 });
        ctx.game.broadcast('fx:shake', { trauma: 0.22 });
      });
    });
    await clock.wait(T.triggerHold + positions.length * stagger(140));
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

  private async trigger(p: GameEvents['heist:trigger']): Promise<void> {
    this.feature = p.feature;
    this.plate.setFeature(p.feature);
    if (p.positions.length) await this.celebrate(p.positions, HEIST_LOOK[p.feature].accent);
    await this.intro(p.feature, p.totalFs);
  }

  private async intro(feature: HeistFeature, total: number): Promise<void> {
    const { ctx } = this;
    const look = HEIST_LOOK[feature];
    const res = this.res();
    const content = this.stage.content;
    const tweens: Array<gsap.core.Tween | gsap.core.Timeline> = [];

    this.stage.open({ dim: 0.4, fadeIn: s(300), liftMascots: true, liftFx: true });
    const wipeDone = this.wipe.coverIn(visibleDesignRect(ctx), s(WIPE));
    ctx.game.broadcast('sfx', { id: 'fs_intro' });

    const rays = new GodRays({ size: 1500, color: look.rays, speed: 0.18, alpha: 0.75 });
    rays.y = -150;
    rays.scale.set(0);
    this.stage.backdrop.addChild(rays);

    const emblem = new Sprite({ texture: ctx.art.symbol(EMBLEM[feature]), anchor: 0.5 });
    emblem.y = -235;
    emblem.scale.set(0);
    const title = new Title([{ text: label(look.title, feature.toUpperCase()), style: style(150, look.palette) }], res, { maxWidth: placementFor(ctx.layout).overlayMaxWidth });
    title.y = -40;
    const number = new Title([{ text: String(total), style: style(230, GOLD, 0.06, 0.02) }], res, { maxWidth: 600 });
    number.position.set(-170, 150);
    number.scale.set(0);
    const words = new Title([{ text: label('freeSpins', 'FREE SPINS'), style: style(96, GOLD) }], res, { maxWidth: 560 });
    words.position.set(120, 158);
    const desc = new BitmapText({ text: label(look.desc, ''), style: { fontFamily: ensureLabelFont(ctx.app.renderer), fontSize: 40 }, anchor: 0.5 });
    desc.y = 285;
    desc.alpha = 0;
    const hint = new BitmapText({ text: label('tapToContinue', 'TAP TO CONTINUE'), style: { fontFamily: ensureLabelFont(ctx.app.renderer), fontSize: 32 }, anchor: 0.5 });
    hint.y = 360;
    hint.alpha = 0;
    content.addChild(emblem, title, number, words, desc, hint);
    for (const t of [title, words]) for (const g of t.glyphs) g.sprite.alpha = 0;
    const offTick = clock.onUpdate((dt) => {
      title.tick(dt);
      number.tick(dt);
      words.tick(dt);
      emblem.rotation = Math.sin(clock.time * 1.6) * 0.04;
    });

    const land = s(WIPE * 0.5);
    tweens.push(
      gsap.to(rays.scale, { x: 1, y: 1, duration: s(700), delay: land, ease: 'back.out(1.5)' }),
      gsap.fromTo(emblem.scale, { x: 0, y: 0 }, { x: 1.55, y: 1.55, duration: s(560), delay: land, ease: 'back.out(2.2)', immediateRender: false }),
      gsap.delayedCall(land + s(180), () => tweens.push(title.popIn({ duration: s(LETTER_IN), stagger: s(LETTER_STAGGER), lineDelay: 0 }))),
      gsap.fromTo(number.scale, { x: 2.4, y: 2.4 }, { x: 1, y: 1, duration: s(SLAM), delay: land + s(520), ease: 'back.out(1.7)', immediateRender: false }),
      gsap.delayedCall(land + s(520 + SLAM * 0.35), () => {
        const c = this.design(number.x, number.y);
        ctx.game.broadcast('fx:shake', { trauma: 0.55 });
        ctx.game.broadcast('fx:flash', { color: 0xffe08a, alpha: 0.3, durationMs: 200 });
        ctx.game.broadcast('fx:burst', { kind: 'coins', x: c.x, y: c.y, count: 30, power: 1.3 });
        const L = ctx.layout;
        for (const fx of [0.12, 0.88]) ctx.game.broadcast('fx:burst', { kind: 'confetti', x: L.width * fx, y: L.height + 20, count: 50, power: 1.5 });
      }),
      gsap.delayedCall(land + s(520 + SLAM * 0.5), () => tweens.push(words.popIn({ duration: s(LETTER_IN), stagger: s(LETTER_STAGGER), lineDelay: 0 }))),
      gsap.to(desc, { alpha: 1, duration: s(300), delay: land + s(1100) }),
      gsap.to([title, number, words], { waveAmp: 5, duration: s(800), delay: land + s(1200) }),
      gsap.delayedCall(land + s(1300), () => void title.sweep(s(700))),
    );
    if (!this.autoplay && this.stage.tapsAllowed) {
      tweens.push(gsap.to(hint, { alpha: 1, duration: s(300), delay: land + s(1300) }));
      tweens.push(scaleTo(hint.scale, 1.06, { duration: s(600), delay: land + s(1300), ease: 'sine.inOut', yoyo: true, repeat: -1 }));
    }
    let spark = 0;
    const offSpark = clock.onUpdate((dt) => {
      spark += dt;
      if (spark < 0.25) return;
      spark = 0;
      const c = this.design(rand(-440, 440), rand(-360, 220));
      ctx.game.broadcast('fx:burst', { kind: 'sparkle', x: c.x, y: c.y, count: 4, color: look.rays });
    });

    await wipeDone;
    await this.waitTapOrTimeout(TIMING.freeSpins.introDuration + 1200, TAP_LOCK + 500);
    offSpark();
    for (const t of tweens) t.kill();
    tweens.length = 0;
    const exit = s(EXIT);
    tweens.push(
      gsap.to(emblem.scale, { x: 0, y: 0, duration: exit, ease: 'back.in(2)' }),
      gsap.to([title.scale, number.scale, words.scale], { x: 0, y: 0, duration: exit, ease: 'back.in(2)', stagger: s(40) }),
      gsap.to([hint, desc], { alpha: 0, duration: exit * 0.5 }),
      gsap.to(rays.scale, { x: 0, y: 0, duration: exit, ease: 'power2.in' }),
    );
    await clock.wait(EXIT * 0.55);
    const back = this.wipe.coverOut(s(WIPE));
    await this.stage.close(s(WIPE * 0.8));
    await back;
    offTick();
    for (const t of tweens) t.kill();
    for (const d of [title, number, words]) d.destroy();
    emblem.destroy();
    desc.destroy();
    hint.destroy();
    rays.destroy();
    releaseTitlesIfIdle(ctx);
  }

  // ------------------------------------------------------------------ +N spins

  private async retrigger(added: number, positions: Position[]): Promise<void> {
    const { ctx } = this;
    if (positions.length) await this.celebrate(positions, HEIST_LOOK[this.feature].accent);
    const res = this.res();
    const content = this.stage.content;
    this.stage.open({ dim: 0.45, fadeIn: s(300), liftMascots: true, liftFx: true });
    ctx.game.broadcast('sfx', { id: 'fs_intro', volume: 0.8 });
    const plus = new Title([{ text: `+${added}`, style: style(260, RUBY, 0.06, 0.02) }], res, { maxWidth: 800 });
    plus.y = -70;
    const words = new Title([{ text: label('freeSpins', 'FREE SPINS'), style: style(112, GOLD) }], res, { maxWidth: placementFor(ctx.layout).overlayMaxWidth });
    words.y = 110;
    content.addChild(plus, words);
    for (const g of words.glyphs) g.sprite.alpha = 0;
    const offTick = clock.onUpdate((dt) => {
      plus.tick(dt);
      words.tick(dt);
    });
    const tweens: Array<gsap.core.Tween | gsap.core.Timeline> = [
      gsap.fromTo(plus.scale, { x: 2.6, y: 2.6 }, { x: 1, y: 1, duration: s(SLAM), ease: 'back.out(1.8)' }),
      words.popIn({ duration: s(LETTER_IN), stagger: s(LETTER_STAGGER), lineDelay: 0 }),
      gsap.to([plus, words], { waveAmp: 6, duration: s(600), delay: s(SLAM) }),
    ];
    gsap.delayedCall(s(SLAM * 0.35), () => {
      const c = this.design(0, plus.y);
      ctx.game.broadcast('fx:shake', { trauma: 0.4 });
      ctx.game.broadcast('fx:burst', { kind: 'scatter', x: c.x, y: c.y, color: 0xff3a52, power: 1.1 });
    });
    await clock.wait(T.retrigger);
    const L = ctx.layout;
    const target = placementFor(L).fsCounter;
    const k = this.stage.scale;
    const tx = (target.x - L.center.x) / k;
    const ty = (target.y - L.center.y) / k;
    const fly = s(EXIT);
    tweens.push(
      gsap.to([plus, words], { x: tx, y: ty, duration: fly, ease: 'power2.in' }),
      gsap.to([plus.scale, words.scale], { x: 0.15, y: 0.15, duration: fly, ease: 'power2.in' }),
    );
    await clock.wait(EXIT);
    ctx.game.broadcast('fx:burst', { kind: 'sparkle', x: target.x, y: target.y, count: 10, color: 0xffd27a });
    await this.stage.close(s(300));
    offTick();
    for (const t of tweens) t.kill();
    plus.destroy();
    words.destroy();
    releaseTitlesIfIdle(ctx);
  }

  // ------------------------------------------------------------------ Night Prowl -> Vault Raid

  private async upgrade(p: GameEvents['heist:upgrade']): Promise<void> {
    const { ctx } = this;
    if (p.positions.length) await this.celebrate(p.positions, HEIST_LOOK[p.to].accent);
    const look = HEIST_LOOK[p.to];
    const res = this.res();
    const content = this.stage.content;
    this.stage.open({ dim: 0.5, fadeIn: s(300), liftMascots: true, liftFx: true });
    ctx.game.broadcast('sfx', { id: 'fs_intro' });
    ctx.game.broadcast('mascot:cue', { cue: 'featureUpgrade', intensity: 1 });
    const rays = new GodRays({ size: 1500, color: look.rays, speed: 0.22, alpha: 0.8 });
    rays.scale.set(0);
    this.stage.backdrop.addChild(rays);
    const up = new Title([{ text: label('heist.upgrade', 'UPGRADE!'), style: style(120, RUBY) }], res, { maxWidth: 900 });
    up.y = -190;
    const emblem = new Sprite({ texture: ctx.art.symbol(EMBLEM[p.to]), anchor: 0.5 });
    emblem.y = -20;
    emblem.scale.set(0);
    const title = new Title([{ text: label(look.title, p.to.toUpperCase()), style: style(150, look.palette) }], res, { maxWidth: placementFor(ctx.layout).overlayMaxWidth });
    title.y = 150;
    const plus = new Title([{ text: `+${p.addFs}`, style: style(140, GOLD) }], res, { maxWidth: 400 });
    plus.y = 300;
    plus.scale.set(0);
    content.addChild(up, emblem, title, plus);
    for (const t of [up, title]) for (const g of t.glyphs) g.sprite.alpha = 0;
    const offTick = clock.onUpdate((dt) => {
      up.tick(dt);
      title.tick(dt);
      plus.tick(dt);
    });
    const tweens: Array<gsap.core.Tween | gsap.core.Timeline> = [
      up.popIn({ duration: s(LETTER_IN), stagger: s(LETTER_STAGGER), lineDelay: 0 }),
      gsap.to(rays.scale, { x: 1, y: 1, duration: s(700), delay: s(300), ease: 'back.out(1.5)' }),
      gsap.to(emblem.scale, { x: 1.4, y: 1.4, duration: s(560), delay: s(500), ease: 'back.out(2.4)' }),
      gsap.delayedCall(s(700), () => {
        tweens.push(title.popIn({ duration: s(LETTER_IN), stagger: s(LETTER_STAGGER), lineDelay: 0 }));
        const c = this.design(0, emblem.y);
        ctx.game.broadcast('fx:shake', { trauma: 0.6 });
        ctx.game.broadcast('fx:flash', { color: look.rays, alpha: 0.35, durationMs: 220 });
        ctx.game.broadcast('fx:burst', { kind: 'scatter', x: c.x, y: c.y, color: look.accent, power: 1.5 });
        ctx.game.broadcast('heist:mode', { feature: p.to });
      }),
      gsap.fromTo(plus.scale, { x: 2.4, y: 2.4 }, { x: 1, y: 1, duration: s(SLAM), delay: s(1200), ease: 'back.out(1.8)', immediateRender: false }),
    ];
    await clock.wait(T.upgrade);
    tweens.push(
      gsap.to([up.scale, emblem.scale, title.scale, plus.scale], { x: 0, y: 0, duration: s(EXIT), ease: 'back.in(2)', stagger: s(30) }),
      gsap.to(rays.scale, { x: 0, y: 0, duration: s(EXIT), ease: 'power2.in' }),
    );
    await clock.wait(EXIT);
    this.feature = p.to;
    this.plate.setFeature(p.to);
    await this.stage.close(s(300));
    offTick();
    for (const t of tweens) t.kill();
    for (const d of [up, title, plus]) d.destroy();
    emblem.destroy();
    rays.destroy();
    releaseTitlesIfIdle(ctx);
  }

  // ------------------------------------------------------------------ outro

  private async outro(p: GameEvents['fs:end']): Promise<void> {
    const { ctx } = this;
    const money = ctx.money;
    const res = this.res();
    const content = this.stage.content;
    const finalApi = money.fromBook(Math.max(0, p.amount));
    const look = HEIST_LOOK[this.feature];
    const spins = this.plate.total;

    this.stage.open({ dim: 0.4, fadeIn: s(300), liftMascots: true, liftFx: true });
    const wipeDone = this.wipe.coverIn(visibleDesignRect(ctx), s(WIPE));
    ctx.game.broadcast('sfx', { id: 'fs_outro' });
    ctx.game.broadcast('mascot:cue', { cue: 'fsEnd', intensity: Math.min(1, 0.4 + p.level * 0.08) });

    const rays = new GodRays({ size: 1500, color: 0xffc53d, speed: 0.16, alpha: 0.7 });
    rays.y = -40;
    rays.scale.set(0);
    this.stage.backdrop.addChild(rays);
    const panel = new Container({ label: 'heistOutro' });
    const plate = new Plate(look.accent, 0.88, 'round');
    plate.resize(940, 450);
    const title = new Title([{ text: label('totalWin', 'TOTAL WIN'), style: style(140, GOLD) }], res, { maxWidth: 880 });
    title.y = -225;
    const amount = new BitmapText({ text: money.format(0), style: { fontFamily: ensureAmountFont(ctx.app.renderer, money), fontSize: 132 }, anchor: 0.5 });
    amount.y = 10;
    const sub = new BitmapText({
      text: `${label(look.title, '')}${spins > 0 ? `  ·  ${label('fs.summary', '{n} FREE SPINS', { n: spins })}` : ''}`,
      style: { fontFamily: ensureLabelFont(ctx.app.renderer), fontSize: 44 },
      anchor: 0.5,
    });
    sub.y = 150;
    panel.addChild(plate, amount, sub, title);
    panel.y = 20;
    panel.scale.set(0);
    content.addChild(panel);
    for (const g of title.glyphs) g.sprite.alpha = 0;
    const offTick = clock.onUpdate((dt) => title.tick(dt));
    const tweens: Array<gsap.core.Tween | gsap.core.Timeline> = [];
    const land = s(WIPE * 0.5);
    tweens.push(
      gsap.to(rays.scale, { x: 1, y: 1, duration: s(700), delay: land, ease: 'back.out(1.5)' }),
      gsap.to(panel.scale, { x: 1, y: 1, duration: s(OUTRO_IN), delay: land, ease: 'back.out(1.6)' }),
      gsap.delayedCall(land + s(OUTRO_IN * 0.5), () => {
        tweens.push(title.popIn({ duration: s(LETTER_IN), stagger: s(LETTER_STAGGER), lineDelay: 0 }));
        ctx.game.broadcast('fx:shake', { trauma: 0.35 });
      }),
      gsap.to(title, { waveAmp: 5, duration: s(800), delay: land + s(OUTRO_IN + LETTER_IN) }),
    );
    const fitAmount = (): void => {
      amount.scale.set(1);
      if (amount.width > 840) amount.scale.set(840 / amount.width);
    };
    const state = { v: 0 };
    let counted = false;
    let lastText = '';
    const finishCount = (): void => {
      if (counted) return;
      counted = true;
      amount.text = money.format(finalApi);
      fitAmount();
      ctx.game.broadcast('sfx', { id: 'counter_end' });
      const c = this.design(0, panel.y + amount.y);
      ctx.game.broadcast('fx:burst', { kind: 'confetti', x: c.x - 260, y: c.y, count: 45, power: 1.2 });
      ctx.game.broadcast('fx:burst', { kind: 'confetti', x: c.x + 260, y: c.y, count: 45, power: 1.2 });
      ctx.game.broadcast('fx:burst', { kind: 'coins', x: c.x, y: c.y, count: 30, power: 1.3 });
      ctx.game.broadcast('fx:shake', { trauma: 0.3 });
      tweens.push(punchScale(amount.scale, 1.2, s(420), 'elastic.out(1, 0.5)', amount.scale.x));
      void title.sweep(s(620));
    };
    const count = gsap.to(state, {
      v: 1,
      duration: s(OUTRO_COUNT),
      delay: land + s(OUTRO_IN),
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
      let hold: gsap.core.Tween | null = null;
      const close = (): void => {
        if (closed) return;
        closed = true;
        hold?.kill();
        resolve();
      };
      const armHold = (): void => void (hold = gsap.delayedCall(s(TIMING.freeSpins.outroDuration), close));
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
    tweens.push(
      gsap.to(panel.scale, { x: 0, y: 0, duration: s(EXIT), ease: 'back.in(1.8)' }),
      gsap.to(rays.scale, { x: 0, y: 0, duration: s(EXIT), ease: 'power2.in' }),
    );
    await clock.wait(EXIT * 0.55);
    const back = this.wipe.coverOut(s(WIPE));
    await this.stage.close(s(WIPE * 0.8));
    await back;
    offTick();
    for (const t of tweens) t.kill();
    title.destroy();
    panel.destroy({ children: true });
    rays.destroy();
    releaseTitlesIfIdle(ctx);
  }
}
