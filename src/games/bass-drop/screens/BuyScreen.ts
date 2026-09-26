import { clock } from '../../../core/clock';
import { FEATURES } from '../../../config/game';
import { sUi } from '../../../core/timing';
import type { GameContext, GameModule } from '../../../game/context';
import type { HudState } from '../../../game/events';
import { ensureAmountFont } from '../../../present/common/fonts';
import { OverlayStage, releaseTitlesIfIdle } from '../../../present/common/OverlayStage';
import { visibleDesignRect } from '../../../present/common/placement';
import { modalState, uiBus } from '../../../ui/bus';
import { buyModes } from '../../../ui/dom/gameInfo';
import { screenArt } from './art/ScreenArt';
import { type BuyOffer, BuyCards } from './BuyCards';
import { ensureScreenFonts } from './fonts';
import { SCREENS_TIMING, buyRects } from './look';
import { ModalGate, TapCatcher, onScreenKey } from './ui';

/**
 * BONUS BUY SCREEN (DESIGN §13): the canvas 2-card buy screen, opened by the bonus-buy hex
 * (uiBus 'dialog:buy'; FEATURES.buyScreen 'game' makes the DOM overlay ignore it).
 *
 *  - choose: JUKE JAM (8 FREE SPINS, bet x 100) and MEGA MIX (10 FREE SPINS, bet x 300), costs
 *    and spins from the bet-mode table (ui/dom/gameInfo buyModes()), prices in the live
 *    currency (ctx.money, bet from 'hud:state'); a card the balance cannot cover is greyed
 *    with INSUFFICIENT BALANCE and cannot be chosen;
 *  - confirm (mandatory, cost > 2x): the chosen card moves to the confirm slot, the price
 *    shows large, CONFIRM (#F828C8) / CANCEL; nothing has focus and SPACE / ENTER do nothing;
 *    CONFIRM emits ctx.ui 'ui:buy' {mode} and closes; CANCEL / ESC go back; X / ESC close;
 *  - never opens in replay, during autoplay, with buyAllowed false (jurisdiction, round
 *    running) or over another modal, and closes itself if the state stops allowing it.
 * Social wording comes from the i18n table (BONUS BUY -> BONUS, BUY -> PLAY, x BET -> x PLAY,
 * COST -> PLAY AMOUNT). While open: uiBus 'modal:state' open, every pointer event outside the
 * cards is swallowed. UI time throughout.
 */
export class BuyScreen implements GameModule {
  private readonly stage: OverlayStage;
  private cards!: BuyCards;
  private readonly catcher = new TapCatcher();
  private readonly gate = new ModalGate();
  private offs: Array<() => void> = [];
  private offKey: (() => void) | null = null;
  private state: HudState | null = null;
  private open = false;
  private closing = false;
  private offers: BuyOffer[] = [];
  private selected = -1;
  private destroyed = false;

  constructor(private readonly ctx: GameContext) {
    this.stage = new OverlayStage(ctx, 'buyScreen');
  }

  init(): void {
    const { ctx } = this;
    ensureScreenFonts(ctx.app.renderer);
    screenArt.retain(ctx.app.renderer);
    this.cards = new BuyCards(
      ctx,
      ensureAmountFont(ctx.app.renderer, ctx.money),
      (i) => this.select(i),
      () => this.confirm(),
      () => this.back(),
      () => this.close(),
    );
    this.stage.under.addChild(this.catcher);
    this.stage.front.addChild(this.cards.view);
    this.offs.push(
      uiBus.on('dialog:buy', () => this.tryOpen()),
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
    this.closing = false;
    this.closeNow();
    this.destroyed = true;
    this.gate.destroy();
    this.cards.destroy();
    this.stage.destroy();
    screenArt.release();
  }

  private res(): number {
    return Math.min(2, Math.max(0.5, this.ctx.app.renderer.resolution * this.ctx.scale));
  }

  layout(): void {
    const view = visibleDesignRect(this.ctx);
    this.catcher.cover(view.x, view.y, view.w, view.h);
    if (!this.open) return;
    this.stage.layout();
    this.cards.layout(buyRects(this.ctx.layout), this.res());
  }

  /** May the screen be (or stay) open in this HUD state? */
  private allowed(st: HudState | null): boolean {
    if (!st || FEATURES.buyScreen !== 'game') return false;
    if (st.replay || this.ctx.params.replay) return false;
    if (st.autoplayRemaining !== null) return false;
    if (st.isSpinning || !st.buyAllowed) return false;
    return st.phase === undefined || st.phase === 'idle';
  }

  private onState(st: HudState): void {
    this.state = st;
    if (!this.open || this.closing) return;
    if (!this.allowed(st)) {
      this.closeNow();
      return;
    }
    this.refreshOffers();
  }

  /** Offers from the bet-mode table with the live bet / balance. */
  private refreshOffers(): void {
    const st = this.state;
    if (!st) return;
    const money = this.ctx.money;
    this.offers = buyModes()
      .slice(0, 2)
      .map((m) => {
        const price = Math.round(st.bet * m.cost);
        return {
          mode: m.mode,
          skin: m.mode.toUpperCase() === 'SUPER' ? 'megamix' : 'jukejam',
          spins: m.spins ?? 0,
          costX: m.cost,
          priceText: money.format(price),
          affordable: st.balance >= price,
        } satisfies BuyOffer;
      });
    this.cards.setOffers(this.offers);
  }

  private tryOpen(): void {
    if (this.open || modalState.open || !this.allowed(this.state) || buyModes().length === 0) return;
    const { ctx } = this;
    const B = SCREENS_TIMING.buy;
    this.open = true;
    this.closing = false;
    this.gate.open();
    this.stage.open({ dim: B.dim, fadeIn: sUi(B.dimIn) });
    this.layout();
    this.refreshOffers();
    this.catcher.handler = null;
    this.offKey = onScreenKey((k) => {
      // SPACE / ENTER never buy (no default focus); ESC steps back / closes
      if (k !== 'escape') return;
      if (this.cards.currentStep === 'confirm') this.back();
      else this.close();
    });
    ctx.game.broadcast('sfx', { id: 'buy_open' });
    this.cards.playIn(Math.min(2, Math.max(1, this.res() * 1.1)), (i) =>
      ctx.game.broadcast('sfx', { id: 'intro_card', rate: 1 + i * 0.08, volume: 0.8 }),
    );
  }

  private select(i: number): void {
    if (!this.open || this.closing || this.cards.currentStep !== 'choose') return;
    const offer = this.offers[i];
    if (!offer?.affordable) return;
    this.ctx.game.broadcast('sfx', { id: 'buy_select' });
    this.cards.select(i);
    this.selected = i;
  }

  private back(): void {
    if (!this.open || this.closing || this.cards.currentStep !== 'confirm') return;
    this.ctx.game.broadcast('sfx', { id: 'ui_click' });
    this.cards.back();
    this.selected = -1;
  }

  private confirm(): void {
    if (!this.open || this.closing || this.cards.currentStep !== 'confirm') return;
    const offer = this.offers[this.selected];
    // the state may have changed under the confirm step (balance poll): re-check
    if (!offer || !this.allowed(this.state) || !offer.affordable) {
      this.closeNow();
      return;
    }
    this.ctx.game.broadcast('sfx', { id: 'buy_confirm' });
    void this.closeAnimated();
    this.ctx.ui.broadcast('ui:buy', { mode: offer.mode });
  }

  private close(): void {
    if (!this.open || this.closing) return;
    this.ctx.game.broadcast('sfx', { id: 'ui_click' });
    void this.closeAnimated();
  }

  private async closeAnimated(): Promise<void> {
    this.closing = true;
    this.offKey?.();
    this.offKey = null;
    // hotkeys come back with the close; the flow already owns the round if one was bought
    this.gate.close();
    const out = this.cards.playOut();
    await this.stage.close(sUi(SCREENS_TIMING.buy.out));
    await out;
    this.finish();
  }

  /**
   * State no longer allows buying / teardown: gone at once. A confirmed buy is already
   * animating out (its round starts during the out) and finishes on its own.
   */
  private closeNow(): void {
    if (!this.open || this.closing) return;
    void this.stage.close(0);
    this.finish();
  }

  private finish(): void {
    if (!this.open || this.destroyed) return;
    this.open = false;
    this.closing = false;
    this.selected = -1;
    this.offKey?.();
    this.offKey = null;
    this.cards.clear();
    this.gate.close();
    releaseTitlesIfIdle(this.ctx);
  }
}
