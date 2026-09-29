import { gsap } from 'gsap';
import type { Container } from 'pixi.js';
import { BET_MODES, GAME_META } from '../../../config/game';
import { clock } from '../../../core/clock';
import { sUi } from '../../../core/timing';
import type { GameContext, GameModule } from '../../../game/context';
import type { HudState } from '../../../game/events';
import { OverlayStage, releaseTitlesIfIdle } from '../../../present/common/OverlayStage';
import { visibleDesignRect } from '../../../present/common/placement';
import { BASS_DROP_TIMING } from '../timing';
import { screenArt } from './art/ScreenArt';
import { type UiArtKey, uiArt } from './art/uiArt';
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
/** The three card illustrations, held from boot until the intro is done (or not shown). */
const CARD_ART: readonly UiArtKey[] = ['cardMeter', 'cardJukeJam', 'cardMegaMix'];
/** HUD alpha under the portrait intro's footer (times the 0.8 dim: the balance / bet row is a ghost). */
const HUD_UNDER_FOOTER = 0.3;
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
  private artHeld = false;
  private layerTweens: gsap.core.Tween[] = [];
  /** layout kind the layer fades were decided for (a rotation re-decides them) */
  private fadedKind: string | null = null;

  constructor(private readonly ctx: GameContext) {
    this.stage = new OverlayStage(ctx, 'introScreen');
  }

  async init(): Promise<void> {
    const { ctx } = this;
    ensureScreenFonts(ctx.app.renderer);
    screenArt.retain(ctx.app.renderer);
    // the card art loads with the boot: the intro shows at the first idle (never in replay)
    if (!ctx.params.replay) {
      this.artHeld = true;
      await uiArt.acquire(CARD_ART);
    }
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
    this.dropArt();
    this.stage.destroy();
    screenArt.release();
  }

  /** The intro is over or will not show: its card art goes (2.25 MiB each). */
  private dropArt(): void {
    if (!this.artHeld) return;
    this.artHeld = false;
    uiArt.release(CARD_ART);
  }

  private onState(st: HudState): void {
    this.spaceAllowed = st.spacebarAllowed !== false;
    if (this.decided) return;
    if (this.ctx.params.replay || st.replay) {
      this.decided = true;
      this.dropArt();
      return;
    }
    const phase = st.phase;
    if (phase === 'resume' || phase === 'error' || phase === 'replay') {
      this.decided = true;
      this.dropArt();
      return;
    }
    if (phase !== 'idle') return;
    this.decided = true;
    this.skip = readSkip();
    if (!this.skip) this.show();
    else this.dropArt();
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
    // a rotation re-decides which layers sit out (the portrait footer covers the HUD's bottom row)
    if (!this.closing && this.fadedKind !== null && this.fadedKind !== this.ctx.layout.kind) this.fadeGameLayers(true, 0);
  }

  /**
   * The intro sets its own logo: the game's logo layer fades out with the dim and back in on close.
   * Through the dimmer it read as a second word-mark (portrait: right under the intro's; compact:
   * stacked above it). In portrait the footer (toggle + "press to continue", y 1850) lies on the
   * HUD's balance / bet row, so the HUD fades to a ghost there too (it still reads through, and is
   * back at full alpha before the first spin can start).
   */
  private fadeGameLayers(hide: boolean, duration: number): void {
    const { layers, layout } = this.ctx;
    const targets: Array<[Container, number]> = [
      [layers.logo, hide ? 0 : 1],
      [layers.hud, hide && layout.kind === 'portrait' ? HUD_UNDER_FOOTER : 1],
    ];
    this.fadedKind = hide ? layout.kind : null;
    for (const t of this.layerTweens) t.kill();
    this.layerTweens = [];
    for (const [layer, alpha] of targets) {
      if (duration <= 0 || layer.alpha === alpha) layer.alpha = alpha;
      else this.layerTweens.push(gsap.to(layer, { alpha, duration, ease: 'power2.out' }));
    }
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
    this.fadeGameLayers(true, sUi(I.dimIn));
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
        this.fadeGameLayers(false, sUi(I.out * 0.6));
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
    this.fadeGameLayers(false, 0);
    this.offKey?.();
    this.offKey = null;
    this.catcher.handler = null;
    this.cards.clear();
    this.dropArt();
    this.gate.close();
    releaseTitlesIfIdle(this.ctx);
  }
}
