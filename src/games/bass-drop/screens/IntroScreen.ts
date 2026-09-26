import { gsap } from 'gsap';
import { BET_MODES, GAME_META } from '../../../config/game';
import { clock } from '../../../core/clock';
import { sUi } from '../../../core/timing';
import type { GameContext, GameModule } from '../../../game/context';
import type { HudState } from '../../../game/events';
import { OverlayStage, releaseTitlesIfIdle } from '../../../present/common/OverlayStage';
import { visibleDesignRect } from '../../../present/common/placement';
import { BASS_DROP_TIMING } from '../timing';
import { screenArt } from './art/ScreenArt';
import { ensureScreenFonts } from './fonts';
import { IntroCards } from './IntroCards';
import { SCREENS_TIMING, introRects } from './look';
import { ModalGate, TapCatcher, onScreenKey } from './ui';

/**
 * Same key as the DOM settings page's "Skip intro screen" switch (ui/dom/DomUi.ts STORE_KEYS),
 * so the card toggle and the menu stay in step. A per-viewer convenience: every access is
 * guarded and the game works without storage.
 */
const SKIP_KEY = `${GAME_META.storagePrefix}.skipIntro`;
const readSkip = (): boolean => {
  try {
    return window.localStorage.getItem(SKIP_KEY) === '1';
  } catch {
    return false;
  }
};
const writeSkip = (on: boolean): void => {
  try {
    window.localStorage.setItem(SKIP_KEY, on ? '1' : '0');
  } catch {
    /* storage unavailable (private mode, sandbox) */
  }
};

/**
 * GAME INTRO (DESIGN §12): the three feature cards over the dealt, dimmed board, once after
 * load. Decided from the flow's HUD phases: shown when the flow first reaches 'idle'; never in
 * replay, never after a resume ('resume' before the first idle: the player is mid-round) or a
 * boot error, never in the dev lab (no flow). Skipped when the viewer ticked "don't show
 * again" (or the settings switch).
 *
 * While shown: uiBus 'modal:state' open (HUD hotkeys blocked), the stage swallows every
 * pointer event (the HUD sits under the overlay), taps / SPACE / ENTER / ESC continue after
 * the 600 ms lock. UI time throughout. A round that starts anyway (automation) closes it
 * at once.
 */
export class IntroScreen implements GameModule {
  private readonly stage: OverlayStage;
  private cards!: IntroCards;
  private readonly catcher = new TapCatcher();
  private readonly gate = new ModalGate();
  private offs: Array<() => void> = [];
  private offKey: (() => void) | null = null;
  private decided = false;
  private open = false;
  private closing = false;
  private unlocked = false;
  private skip = false;
  private spaceAllowed = true;
  private calls: gsap.core.Tween[] = [];

  constructor(private readonly ctx: GameContext) {
    this.stage = new OverlayStage(ctx, 'introScreen');
  }

  init(): void {
    const { ctx } = this;
    ensureScreenFonts(ctx.app.renderer);
    screenArt.retain(ctx.app.renderer);
    this.cards = new IntroCards(ctx, BET_MODES.BASE?.maxWinX ?? 0, (on) => {
      this.skip = on;
      writeSkip(on);
    });
    this.stage.under.addChild(this.catcher);
    this.stage.front.addChild(this.cards.view);
    this.offs.push(
      ctx.hud.on('hud:state', (st) => this.onState(st)),
      ctx.game.on('round:start', () => this.closeNow()),
      ctx.game.on('layout:change', () => this.layout()),
      clock.onUpdate((dt) => {
        if (this.open) this.cards.tick(dt);
      }),
    );
  }

  destroy(): void {
    for (const off of this.offs) off();
    this.offs = [];
    this.closeNow();
    this.gate.destroy();
    this.cards.destroy();
    this.stage.destroy();
    screenArt.release();
  }

  private onState(st: HudState): void {
    this.spaceAllowed = st.spacebarAllowed !== false;
    if (this.decided) return;
    if (this.ctx.params.replay || st.replay) {
      this.decided = true;
      return;
    }
    const phase = st.phase;
    if (phase === 'resume' || phase === 'error' || phase === 'replay') {
      this.decided = true;
      return;
    }
    if (phase !== 'idle') return;
    this.decided = true;
    this.skip = readSkip();
    if (!this.skip) this.show();
  }

  private res(): number {
    return Math.min(2, Math.max(0.5, this.ctx.app.renderer.resolution * this.ctx.scale));
  }

  layout(): void {
    const view = visibleDesignRect(this.ctx);
    this.catcher.cover(view.x, view.y, view.w, view.h);
    if (!this.open) return;
    this.stage.layout();
    this.cards.layout(introRects(this.ctx.layout), this.res());
  }

  private show(): void {
    const { ctx } = this;
    const I = SCREENS_TIMING.introCards;
    this.open = true;
    this.closing = false;
    this.unlocked = false;
    this.gate.open();
    this.stage.open({ dim: I.dim, fadeIn: sUi(I.dimIn) });
    this.layout();
    this.cards.toggle.set(this.skip);
    this.catcher.handler = () => this.dismiss();
    this.offKey = onScreenKey((k) => {
      if (k === 'escape' || this.spaceAllowed) this.dismiss();
    });
    this.cards.playIn(
      (i) => ctx.game.broadcast('sfx', { id: 'intro_card', rate: 1 + i * 0.06 }),
      () => ctx.game.broadcast('fx:shake', { trauma: BASS_DROP_TIMING.shake.titleHit }),
      Math.min(2, Math.max(1, this.res() * 1.1)),
    );
    this.calls.push(gsap.delayedCall(sUi(BASS_DROP_TIMING.feature.introCardsTapLock), () => (this.unlocked = true)));
  }

  private dismiss(): void {
    if (!this.open || !this.unlocked || this.closing) return;
    this.closing = true;
    this.catcher.handler = null;
    this.offKey?.();
    this.offKey = null;
    this.ctx.game.broadcast('sfx', { id: 'ui_click' });
    this.cards.playOut();
    const I = SCREENS_TIMING.introCards;
    this.calls.push(
      gsap.delayedCall(sUi(I.out * 0.6), () => {
        void this.stage.close(sUi(I.out * 0.6)).then(() => this.finish());
      }),
    );
  }

  /** Round started (automation) / teardown: gone at once. */
  private closeNow(): void {
    if (!this.open) return;
    void this.stage.close(0);
    this.finish();
  }

  private finish(): void {
    if (!this.open) return;
    this.open = false;
    this.closing = false;
    for (const c of this.calls) c.kill();
    this.calls = [];
    this.offKey?.();
    this.offKey = null;
    this.catcher.handler = null;
    this.cards.clear();
    this.gate.close();
    releaseTitlesIfIdle(this.ctx);
  }
}
