import { gsap } from 'gsap';
import { BitmapText, Container } from 'pixi.js';
import { FONTS } from '../assets/fonts';
import { WIN_TIERS, type WinTierKey } from '../config/game';
import { clock } from '../core/clock';
import { registerTiming, sUi, TIMING } from '../core/timing';
import { pulseChromatic } from '../fx/filters/effects';
import { GodRays } from '../fx/filters/GodRays';
import { rand } from '../fx/util';
import type { GameContext, GameModule } from '../game/context';
import type { GameEvents } from '../game/events';
import { ensureAmountFont } from './common/fonts';
import { GOLD, glyphBakeJobs } from './common/glyphs';
import { OverlayStage, releaseTitlesIfIdle } from './common/OverlayStage';
import { placementFor } from './common/placement';
import { Plate } from './common/Plate';
import { label, titleLines } from './common/text';
import { punchScale, scaleTo } from './common/anim';
import { Title, type TitleLine } from './common/Title';

/**
 * Local choreography for the big-win sequence (ms, unscaled: the player controls
 * this screen with taps, so it does not speed up in turbo). Candidates for TIMING.bigWin.
 */
export const BIGWIN_TIMING = registerTiming('bigWinPresent', {
  dim: 0.72,
  dimIn: 260,
  raysIn: 650,
  letterDrop: 560,
  letterStagger: 55,
  /** count-up starts after the title has landed */
  countDelay: 420,
  amountIn: 380,
  /** hold after the count completes before auto-closing (manual play) */
  hold: 2600,
  outro: 520,
  /** amount punch when the count lands */
  finalPunch: 420,
  tickEvery: 95,
  glintEvery: 2300,
  glintDuration: 620,
  sparkleEvery: 340,
  flashAlpha: 0.45,
  flashMs: 240,
  startShake: 0.4,
  tierShake: 0.62,
  chroma: { duration: 260, amount: 0.028 },
} as const);

/** Per-tier accent (god rays, plate rim, flash tint). */
const TIER_TINT: Record<WinTierKey, number> = {
  big: 0xffb321,
  super: 0xff3fa8,
  mega: 0x35f2e0,
  epic: 0xa66bff,
  max: 0xff5a2a,
};

const TIER_KEYS = WIN_TIERS.map((t) => t.key);

interface TierStage {
  tier: number;
  /** book amount at which this tier title is reached */
  at: number;
}

/** Linear count with a power3.out tail whose initial slope matches the linear part. */
const countEase = (tau: number, fp: number): number => {
  const q = fp / (3 - 2 * fp);
  if (tau < 1 - fp) return (tau * (1 - q)) / (1 - fp);
  const w = (tau - (1 - fp)) / fp;
  return 1 - q + q * (1 - (1 - w) ** 3);
};

/**
 * BIG / SUPER / MEGA / EPIC / MAX win celebration on 'bigwin:show'.
 * Resolves when closed. The amount counts from 0 through the tier thresholds
 * (bet multiples from WIN_TIERS) — every crossing punches the title up a tier with
 * flash + shake + chromatic hit + sfx + mascot cue — and always ENDS exactly on the
 * final amount. First tap jumps to the final value, second tap closes.
 */
export class BigWin implements GameModule {
  private stage: OverlayStage;
  private title: Title | null = null;
  private titleHolder = new Container({ label: 'bigwin:title' });
  private amountHolder = new Container({ label: 'bigwin:amount' });
  private plate = new Plate(TIER_TINT.big, 0.74);
  private autoplay = false;
  private running: Promise<void> | null = null;
  private offs: Array<() => void> = [];

  constructor(private ctx: GameContext) {
    this.stage = new OverlayStage(ctx, 'bigWin');
  }

  init(): void {
    this.stage.content.addChild(this.titleHolder, this.amountHolder);
    this.amountHolder.addChild(this.plate);
    this.offs.push(
      this.ctx.game.on('bigwin:show', (p) => this.show(p)),
      this.ctx.game.on('layout:change', () => this.layout()),
      this.ctx.hud.on('hud:state', (s) => {
        this.autoplay = s.autoplayRemaining !== null && s.autoplayRemaining !== 0;
      }),
    );
  }

  layout(): void {
    if (this.stage.isOpen) this.stage.layout();
  }

  private async show(p: GameEvents['bigwin:show']): Promise<void> {
    while (this.running) await this.running;
    this.running = this.play(p);
    try {
      await this.running;
    } finally {
      this.running = null;
    }
  }

  /** Design-space point of a content-local point (for fx bursts). */
  private toDesign(x: number, y: number): { x: number; y: number } {
    const L = this.ctx.layout;
    const k = this.stage.scale;
    return { x: L.center.x + x * k, y: L.center.y + y * k };
  }

  private titleSpec(tier: number): { lines: TitleLine[]; res: number } {
    const text = label(`bigwin.${TIER_KEYS[tier]}`, WIN_TIERS[tier].label);
    const words = titleLines(text);
    const res = Math.min(2, this.ctx.app.renderer.resolution * this.ctx.scale * this.stage.scale * 1.1);
    const style = { family: FONTS.title, size: 250, palette: GOLD, outline: 0.065, extrude: 0.1, tracking: 0.03 };
    // "MEGA" over a slightly smaller "WIN"
    const lastSmall = (i: number): boolean => words.length > 1 && i === words.length - 1;
    const lines = words.map((t, i) => ({ text: t, style: lastSmall(i) ? { ...style, size: 210 } : style }));
    return { lines, res };
  }

  private makeTitle(tier: number): Title {
    const { lines, res } = this.titleSpec(tier);
    return new Title(lines, res, { maxWidth: placementFor(this.ctx.layout).overlayMaxWidth, lineGap: 1.08 });
  }

  private play(p: GameEvents['bigwin:show']): Promise<void> {
    const { ctx } = this;
    const T = BIGWIN_TIMING;
    const money = ctx.money;
    const finalBook = Math.max(0, p.amount);
    const finalApi = money.fromBook(finalBook);
    const finalTier = Math.max(0, TIER_KEYS.indexOf(p.tier));

    // tier stages: BIG from 0, then each higher tier at its threshold (MAX at the final amount)
    const stages: TierStage[] = [{ tier: 0, at: 0 }];
    for (let i = 1; i <= finalTier; i++) {
      const min = WIN_TIERS[i].minX;
      const at = Number.isFinite(min) ? Math.min(min * 100, finalBook) : finalBook;
      stages.push({ tier: i, at });
    }
    const knots = [0];
    for (const s of stages.slice(1)) if (s.at > knots[knots.length - 1] && s.at < finalBook) knots.push(s.at);
    knots.push(Math.max(finalBook, 1e-9));
    const valueAt = (u: number): number => {
      const n = knots.length - 1;
      const i = Math.min(n - 1, Math.floor(u * n));
      const f = u * n - i;
      return knots[i] + (knots[i + 1] - knots[i]) * f;
    };

    return new Promise<void>((resolve) => {
      const L = ctx.layout;
      const place = placementFor(L);
      const font = ensureAmountFont(ctx.app.renderer, money);
      let tierIdx = 0;
      let nextStage = 1;
      let counting = false;
      let done = false;
      let closing = false;
      let coinAcc = 0;
      let tickAcc = 0;
      let sparkleAcc = 0;
      let glintAcc = 0;
      let lastText = '';
      let holdCall: gsap.core.Tween | null = null;
      const timelines: Array<gsap.core.Timeline | gsap.core.Tween> = [];
      // pre-bake the upcoming tier titles one glyph per frame during the count-up
      const bakeQueue: Array<() => void> = [];
      for (const st of stages.slice(1)) {
        const spec = this.titleSpec(st.tier);
        for (const line of spec.lines) bakeQueue.push(...glyphBakeJobs(line.text, line.style, spec.res));
      }

      // --- build ---------------------------------------------------------
      this.stage.open({ dim: T.dim, fadeIn: sUi(T.dimIn), liftMascots: true, liftFx: true });
      const rays = new GodRays({ size: 1500, color: TIER_TINT.big, speed: 0.18, alpha: 0.75 });
      rays.y = -170;
      rays.scale.set(0);
      this.stage.backdrop.addChild(rays);

      this.titleHolder.y = -170;
      this.titleHolder.scale.set(1);
      const title = this.makeTitle(0);
      this.titleHolder.addChild(title);
      this.title = title;

      const amount = new BitmapText({
        text: money.format(0),
        style: { fontFamily: font, fontSize: 132 },
        anchor: { x: 0.5, y: 0.52 },
      });
      this.amountHolder.addChild(amount);
      this.amountHolder.y = 205;
      this.amountHolder.scale.set(0);
      this.plate.accentColor = TIER_TINT.big;
      const fitPlate = (): void => {
        const w = Math.max(620, amount.width + 170);
        this.plate.resize(Math.min(w, place.overlayMaxWidth), 168);
        const maxW = place.overlayMaxWidth - 120;
        amount.scale.set(amount.width > maxW ? maxW / (amount.width / amount.scale.x) : 1);
      };
      fitPlate();

      // --- per-frame: title wave, coin fountain, sparkles, tick sfx ------
      const offTick = clock.onUpdate((dt) => {
        for (const ch of this.titleHolder.children) if (ch instanceof Title) ch.tick(dt);
        if (closing) return;
        bakeQueue.shift()?.();
        const Lc = ctx.layout;
        // continuous coin fountain from below the stage (rate climbs with the tier)
        coinAcc += dt * TIMING.bigWin.coinRate * (1 + 0.35 * tierIdx) * (done ? 0.45 : 1);
        if (coinAcc >= 1) {
          const n = Math.floor(coinAcc);
          coinAcc -= n;
          const spread = 330 * this.stage.scale;
          ctx.game.broadcast('fx:burst', {
            kind: 'coins',
            x: Lc.center.x + rand(-spread, spread),
            y: Lc.height + 40,
            count: n,
            power: Math.sqrt(Lc.height / 1080) * rand(1.15, 1.5),
          });
        }
        glintAcc += dt * 1000;
        if (glintAcc >= T.glintEvery) {
          glintAcc = 0;
          this.title?.sweep(sUi(T.glintDuration));
        }
        sparkleAcc += dt * 1000;
        if (sparkleAcc >= T.sparkleEvery) {
          sparkleAcc = 0;
          const pt = this.toDesign(rand(-430, 430), this.titleHolder.y + rand(-150, 130));
          ctx.game.broadcast('fx:burst', { kind: 'sparkle', x: pt.x, y: pt.y, count: 5, color: 0xfff0a0 });
        }
        if (counting) {
          tickAcc += dt * 1000;
          if (tickAcc >= T.tickEvery) {
            tickAcc = 0;
            ctx.game.broadcast('sfx', { id: 'counter_tick', volume: 0.5, rate: 1 + 0.12 * tierIdx });
          }
        }
      });

      const setAmount = (api: number): void => {
        const txt = money.format(api);
        if (txt === lastText) return;
        lastText = txt;
        amount.text = txt;
        fitPlate();
      };

      // --- tier punch ------------------------------------------------------
      const punchMs = TIMING.bigWin.tierPunch;
      const punchEase = TIMING.bigWin.tierPunchEase;
      const punch = (tier: number): void => {
        tierIdx = tier;
        const tint = TIER_TINT[TIER_KEYS[tier]];
        const old = this.title;
        if (old) {
          const tl = old.blowOut(sUi(150));
          tl.eventCallback('onComplete', () => old.destroy());
          timelines.push(tl);
        }
        const next = this.makeTitle(tier);
        next.waveAmp = 0;
        this.titleHolder.addChild(next);
        this.title = next;
        timelines.push(
          next.slamIn({ duration: sUi(punchMs * 1.6), stagger: sUi(22), ease: punchEase }),
          gsap.to(next, { waveAmp: 7, duration: sUi(900), delay: sUi(300) }),
          gsap.delayedCall(sUi(TIMING.bigWin.tierPunch), () => void next.sweep(sUi(T.glintDuration))),
          punchScale(this.titleHolder.scale, 1.18, sUi(punchMs), punchEase),
          punchScale(rays.scale, 1.25, sUi(punchMs * 2), 'power2.out'),
          punchScale(this.amountHolder.scale, 1.14, sUi(punchMs), punchEase),
        );
        rays.color = tint;
        this.plate.accentColor = tint;
        const c = this.toDesign(0, this.titleHolder.y);
        ctx.game.broadcast('fx:flash', { color: tint, alpha: T.flashAlpha, durationMs: T.flashMs });
        ctx.game.broadcast('fx:shake', { trauma: T.tierShake });
        ctx.game.broadcast('fx:burst', { kind: 'scatter', x: c.x, y: c.y, color: tint, power: 1.3 });
        ctx.game.broadcast('fx:burst', { kind: 'coins', x: c.x, y: c.y + 60, count: 22, power: 1.2 });
        ctx.game.broadcast('sfx', { id: 'bigwin_tier' });
        ctx.game.broadcast('mascot:cue', { cue: 'celebrate', intensity: 0.6 + 0.1 * tier });
        const { width, height } = ctx.app.screen;
        const view = { stage: ctx.layers.stage, root: ctx.layers.root, width, height };
        pulseChromatic(view, c.x, c.y, { duration: sUi(T.chroma.duration), amount: T.chroma.amount });
      };

      // --- count-up ----------------------------------------------------------
      const state = { tau: 0 };
      const fp = TIMING.bigWin.finalPortion;
      const duration = TIMING.bigWin.tierDurations[TIER_KEYS[finalTier]] ?? TIMING.bigWin.tierDurations.big;
      const onCount = (): void => {
        const done01 = state.tau >= 1;
        const v = done01 ? finalBook : valueAt(countEase(state.tau, fp));
        setAmount(done01 ? finalApi : money.fromBook(v));
        let reached = -1;
        while (nextStage < stages.length && (done01 || v >= stages[nextStage].at)) {
          reached = stages[nextStage].tier;
          nextStage++;
        }
        if (reached > tierIdx) punch(reached);
      };
      const countTween = gsap.to(state, {
        tau: 1,
        duration: sUi(duration),
        delay: sUi(T.countDelay),
        ease: 'none',
        paused: false,
        onStart: () => {
          counting = true;
        },
        onUpdate: onCount,
        onComplete: () => finishCount(),
      });
      timelines.push(countTween);

      const finishCount = (): void => {
        if (done) return;
        done = true;
        counting = false;
        state.tau = 1;
        onCount();
        setAmount(finalApi); // the counter must END exactly on the final amount
        ctx.game.broadcast('sfx', { id: 'counter_end' });
        const c = this.toDesign(0, this.amountHolder.y);
        ctx.game.broadcast('fx:burst', { kind: 'confetti', x: c.x, y: c.y, count: 60, power: 1.25 });
        ctx.game.broadcast('fx:shake', { trauma: 0.3 });
        timelines.push(
          punchScale(this.amountHolder.scale, 1.22, sUi(T.finalPunch), 'elastic.out(1, 0.5)'),
        );
        holdCall = gsap.delayedCall(sUi(this.autoplay ? TIMING.bigWin.autoCloseDelay : T.hold), () => close());
      };

      // --- close -------------------------------------------------------------
      const close = (): void => {
        if (closing) return;
        closing = true;
        holdCall?.kill();
        if (!done) {
          countTween.progress(1);
          finishCount();
          holdCall?.kill();
        }
        ctx.game.broadcast('sfx', { id: 'bigwin_end' });
        ctx.game.broadcast('mascot:cue', { cue: 'idle' });
        const outro = sUi(T.outro);
        const cur = this.title;
        if (cur) timelines.push(cur.dropOut({ duration: outro * 0.8, stagger: sUi(18), height: 260 }));
        timelines.push(
          scaleTo(this.amountHolder.scale, 0, { duration: outro * 0.7, ease: 'back.in(2)', delay: outro * 0.15 }),
          gsap.to(rays.scale, { x: 0, y: 0, duration: outro, ease: 'power2.in' }),
        );
        void this.stage.close(outro).then(() => {
          offTick();
          for (const tl of timelines) tl.kill();
          this.title?.destroy();
          this.title = null;
          for (const child of [...this.titleHolder.children]) child.destroy({ children: true });
          amount.destroy();
          rays.destroy();
          releaseTitlesIfIdle(ctx);
          resolve();
        });
      };

      this.stage.onTap(() => {
        if (closing) return;
        if (!done) {
          // first tap: jump straight to the final value (with the remaining tier punch)
          countTween.progress(1);
          if (!done) finishCount();
        } else {
          close();
        }
      });

      // --- intro ---------------------------------------------------------------
      const c = this.toDesign(0, this.titleHolder.y);
      ctx.game.broadcast('sfx', { id: 'bigwin_start' });
      ctx.game.broadcast('mascot:cue', { cue: 'winBig', intensity: 0.5 + 0.1 * finalTier });
      ctx.game.broadcast('fx:shake', { trauma: T.startShake });
      ctx.game.broadcast('fx:flash', { color: 0xffe08a, alpha: T.flashAlpha * 0.8, durationMs: T.flashMs });
      ctx.game.broadcast('fx:burst', { kind: 'scatter', x: c.x, y: c.y, color: TIER_TINT.big, power: 1.2 });
      timelines.push(
        gsap.to(rays.scale, { x: 1, y: 1, duration: sUi(T.raysIn), ease: 'back.out(1.6)' }),
        title.popIn({
          duration: sUi(T.letterDrop),
          stagger: sUi(T.letterStagger),
          lineDelay: sUi(T.letterStagger * 3),
        }),
        gsap.to(title, { waveAmp: 7, duration: sUi(900), delay: sUi(T.letterDrop) }),
        gsap.delayedCall(sUi(T.letterDrop + T.letterStagger * 6), () => void title.sweep(sUi(T.glintDuration))),
        scaleTo(this.amountHolder.scale, 1, {
          duration: sUi(T.amountIn),
          delay: sUi(T.countDelay * 0.6),
          ease: 'back.out(2.2)',
        }),
      );
    });
  }

  destroy(): void {
    for (const off of this.offs) off();
    this.stage.destroy();
  }
}
