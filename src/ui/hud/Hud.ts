import { Container, type Text } from 'pixi.js';
import type { LayoutSpec } from '../../config/layout';
import type { SpeedProfile } from '../../core/timing';
import type { GameContext, GameModule } from '../../game/context';
import type { HudState } from '../../game/events';
import { currentLang, isSocial, t } from '../../i18n';
import { modalState, uiBus } from '../bus';
import { GAME_INFO } from '../dom/gameInfo';
import type { HudStateExt } from '../state';
import { FsBadge, ReplayChip } from './Badges';
import { BonusBuyButton } from './BonusBuyButton';
import { HexButton, type HexButtonOptions } from './HexButton';
import { type HudPlacement, resolveHudLayout, smallTilt } from './hudLayout';
import { type IconDraw, arrowIcon, autoplayIcon, menuIcon, stopIcon, turboIcon } from './icons';
import { LabeledValue } from './LabeledValue';
import { SpinButton, type SpinMode } from './SpinButton';
import { StatusLine } from './StatusLine';
import { HUD_COLORS, TextPool, fitWidth, labelStyle } from './theme';
import { WinDisplay } from './WinDisplay';

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** What t() currently resolves against (social wording can switch on after boot). */
const i18nKey = (): string => `${currentLang()}|${isSocial()}`;

/** Neutral state shown until the flow's first 'hud:state' (and in ?dev=lab). */
const defaultState = (ctx: GameContext): HudState => ({
  balanceText: '–',
  betText: ctx.money.format(ctx.money.bet()),
  winText: '',
  balance: 0,
  bet: ctx.money.bet(),
  win: 0,
  spinEnabled: true,
  isSpinning: false,
  betUpEnabled: true,
  betDownEnabled: true,
  turbo: 'normal',
  turboAllowed: true,
  autoplayAllowed: true,
  autoplayRemaining: null,
  buyAllowed: true,
  freeSpins: null,
  replay: ctx.params.replay,
  social: ctx.params.social,
});

const TURBO_ICON: Record<SpeedProfile, IconDraw> = {
  normal: turboIcon(1, false),
  turbo: turboIcon(2, true),
  superTurbo: turboIcon(3, true),
};

/** Autoplay button shows a small stop square while autoplay runs. */
const autoplayStopIcon: IconDraw = (s) => stopIcon(s * 0.46);

/**
 * Pixi HUD: translucent hex controls + BALANCE / BET / WIN readouts in ctx.layers.hud.
 * It never computes money or game state — it renders 'hud:state' / 'hud:countWin'
 * and emits UiEvents on ctx.ui (plus DOM-dialog requests on the UI bus).
 *
 * Demo: __slot.ctx.hud.broadcast('hud:state', {...}) and
 *       __slot.ctx.hud.broadcast('hud:countWin', {from:0, to:12_500_000, durationMs:1500}).
 */
export class Hud implements GameModule {
  private readonly root = new Container({ label: 'hud' });
  private readonly texts = new TextPool();
  private state: HudStateExt;
  private spin!: SpinButton;
  private autoplay!: HexButton;
  private turbo!: HexButton;
  private menu!: HexButton;
  private buy!: BonusBuyButton;
  private betDown!: HexButton;
  private betUp!: HexButton;
  private bet!: LabeledValue;
  private balance!: LabeledValue;
  private win!: WinDisplay;
  private fs!: FsBadge;
  private replay!: ReplayChip;
  private replayInfo!: Text;
  private spinCaption!: Text;
  private status!: StatusLine;
  private shownTurbo: SpeedProfile | null = null;
  /** i18nKey() the captions were last read with */
  private shownI18n = '';
  private captionMax = 520;
  private replayMax = 520;
  /** compact: the free-spin counter replaces the bet readout */
  private fsInBetSlot = false;
  private autoIconStop = false;
  private readonly offs: Array<() => void> = [];

  constructor(private readonly ctx: GameContext) {
    this.state = defaultState(ctx);
  }

  init(): void {
    this.build();
    this.ctx.layers.hud.addChild(this.root);
    this.offs.push(
      this.ctx.hud.on('hud:state', (s) => this.apply(s)),
      this.ctx.hud.on('hud:countWin', ({ from, to, durationMs }) =>
        this.win.countTo(from, to, durationMs, (v) => this.ctx.money.format(v)),
      ),
      this.ctx.game.on('layout:change', ({ layout }) => this.layout(layout)),
      this.ctx.game.on('round:start', () => this.win.reset()),
    );
    window.addEventListener('keydown', this.onKey);
    this.layout(this.ctx.layout);
    this.apply(this.state, false);
  }

  destroy(): void {
    for (const off of this.offs) off();
    window.removeEventListener('keydown', this.onKey);
    this.root.destroy({ children: true });
  }

  // ── construction ───────────────────────────────────────────────────────

  private small(
    label: string,
    icon: IconDraw,
    onTap: () => void,
    sfx: HexButtonOptions['sfx'] = 'ui_click',
  ): HexButton {
    const b = new HexButton(this.ctx, {
      label,
      radius: 36,
      icon,
      iconScale: 0.56,
      corner: 0.2,
      fill: { color: HUD_COLORS.smallFill, alpha: HUD_COLORS.smallFillAlpha },
      rim: { color: HUD_COLORS.smallRim, alpha: 1, width: 2 },
      rimHover: { color: HUD_COLORS.smallRimHover, alpha: 1 },
      sfx,
      onTap,
    });
    this.root.addChild(b);
    return b;
  }

  private build(): void {
    const ui = this.ctx.ui;
    this.shownI18n = i18nKey();
    this.balance = new LabeledValue(this.texts, t('balance'), 'balance');
    this.bet = new LabeledValue(this.texts, t('bet'), 'bet');
    this.win = new WinDisplay(this.ctx, this.texts, t('win'));
    this.replay = new ReplayChip(this.ctx, this.texts, t('replay'));
    this.fs = new FsBadge(this.ctx, this.texts, t('freeSpins'));
    this.replayInfo = this.texts.make('', labelStyle(24, HUD_COLORS.value), 0, 0.5);
    this.replayInfo.visible = false;
    this.spinCaption = this.texts.make('', labelStyle(28), 0.5, 0);
    this.spinCaption.visible = false;
    this.status = new StatusLine(this.texts, GAME_INFO.title);
    this.root.addChild(this.status, this.balance, this.bet, this.win);
    this.root.addChild(this.replay, this.replayInfo, this.fs, this.spinCaption);

    this.menu = this.small('menu', menuIcon, () => ui.broadcast('ui:menu', { open: true }));
    this.autoplay = this.small('autoplay', autoplayIcon, () => {
      if (this.state.autoplayRemaining !== null) ui.broadcast('ui:autoplay', null);
      else uiBus.broadcast('dialog:autoplay', undefined);
    });
    this.turbo = this.small('turbo', TURBO_ICON.normal, () => ui.broadcast('ui:turbo', undefined));
    this.betDown = this.small('betDown', arrowIcon('down'), () => ui.broadcast('ui:betDown', undefined), 'ui_bet_down');
    this.betUp = this.small('betUp', arrowIcon('up'), () => ui.broadcast('ui:betUp', undefined), 'ui_bet_up');

    this.buy = new BonusBuyButton(
      this.ctx,
      {
        label: 'bonusBuy',
        radius: 88,
        tilt: -20,
        corner: 0.22,
        onTap: () => uiBus.broadcast('dialog:buy', { mode: 'BONUS' }),
      },
      this.texts,
      t('bonusBuy'),
    );
    this.root.addChild(this.buy);

    this.spin = new SpinButton(
      this.ctx,
      {
        label: 'spin',
        radius: 140,
        tilt: 20,
        corner: 0.22,
        icon: autoplayIcon,
        fill: { color: HUD_COLORS.spinFill, alpha: HUD_COLORS.spinFillAlpha },
        rim: { color: HUD_COLORS.spinRim, alpha: HUD_COLORS.spinRimAlpha, width: 2 },
        rimHover: { color: HUD_COLORS.spinRim, alpha: 0.95 },
        sfx: 'ui_click',
        onTap: () => this.onSpinTap(),
      },
      this.texts,
    );
    this.root.addChild(this.spin);
  }

  // ── input ──────────────────────────────────────────────────────────────

  /** One entry point for the spin hex and the keyboard: spin / skip / stop autoplay. */
  private onSpinTap(): void {
    const s = this.state;
    if (s.autoplayRemaining !== null) this.ctx.ui.broadcast('ui:autoplay', null);
    else if (s.isSpinning) {
      if (this.skipAllowed) this.ctx.ui.broadcast('ui:skip', undefined);
    } else if (s.spinEnabled) this.ctx.ui.broadcast('ui:spin', undefined);
  }

  /** A running round may be skipped (never under jurisdiction disabledSlamstop). */
  private get skipAllowed(): boolean {
    return this.state.isSpinning && this.state.slamStopAllowed !== false;
  }

  /**
   * SPACE / ENTER = the spin button (Stake: "spacebar mapped to the bet button").
   * Jurisdiction disabledSpacebar arrives as the optional `spacebarAllowed` field the
   * flow already sends (not yet in the frozen HudState — see contractRequests).
   */
  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.code !== 'Space' && e.code !== 'Enter' && e.code !== 'NumpadEnter') return;
    if (modalState.open || e.ctrlKey || e.metaKey || e.altKey) return;
    if (this.state.spacebarAllowed === false) return;
    const el = document.activeElement;
    if (el instanceof HTMLElement && el !== document.body && el.closest('#ui-root')) return;
    e.preventDefault();
    if (e.repeat) return;
    if (!this.spin.isEnabled) {
      // nothing left to slam (STOP hidden), but an open big-win / free-spin overlay still
      // takes the key as its skip tap (the overlay sits above the HUD, so taps reach it directly)
      if (this.skipAllowed) this.ctx.ui.broadcast('ui:skip', undefined);
      return;
    }
    this.spin.pressVisual();
    this.ctx.game.broadcast('sfx', { id: 'ui_click' });
    this.onSpinTap();
  };

  // ── layout ─────────────────────────────────────────────────────────────

  layout(L: LayoutSpec): void {
    const P: HudPlacement = resolveHudLayout(L);
    const textRes = clamp(this.ctx.scale * this.ctx.app.renderer.resolution, 0.3, 4);
    const bakeRes = clamp(textRes * 2, 0.5, 4);
    this.texts.setResolution(textRes);

    this.spin.configure({ radius: P.spin.r, tilt: P.spin.tilt, hitRadius: P.spin.hit });
    this.spin.rebake(bakeRes);
    this.spin.position.set(P.spin.x, P.spin.y);

    const smalls: Array<[HexButton, { x: number; y: number }]> = [
      [this.autoplay, P.autoplay],
      [this.turbo, P.turbo],
      [this.menu, P.menu],
      [this.betDown, P.betMinus],
      [this.betUp, P.betPlus],
    ];
    for (const [b, p] of smalls) {
      b.configure({ radius: P.small.r, hitRadius: P.small.hit, tilt: smallTilt(P, p.x) });
      b.rebake(bakeRes);
      b.position.set(p.x, p.y);
    }

    const bb = P.bonusBuy;
    this.buy.configure({ radius: bb.r, tilt: bb.tilt, hitRadius: bb.hit });
    this.buy.rebake(bakeRes);
    this.buy.setLabelMode(bb.label, Math.round(P.labelFont * (bb.label === 'edge' ? 0.95 : 0.8)));
    this.buy.setText(bb.short ? t('hud.buyShort') : t('bonusBuy'));
    this.buy.position.set(bb.x, bb.y);

    const fsHex = P.fs.mode === 'hex';
    this.fsInBetSlot = !fsHex;
    this.fs.configure({
      mode: P.fs.mode,
      radius: P.fs.r,
      tilt: P.fs.tilt,
      labelSize: fsHex ? Math.round(P.labelFont * 0.85) : P.labelFont,
      valueSize: fsHex ? Math.round(P.valueFont * 1.05) : P.valueFont,
      maxWidth: P.bet.maxWidth + P.small.r * 2,
      resolution: bakeRes,
    });
    this.fs.position.set(P.fs.x, P.fs.y);

    const fonts = { labelSize: P.labelFont, valueSize: P.valueFont };
    this.balance.configure({ ...fonts, align: P.balance.align, maxWidth: P.balance.maxWidth });
    this.balance.position.set(P.balance.x, P.balance.y);
    this.bet.configure({ ...fonts, align: P.bet.align, maxWidth: P.bet.maxWidth });
    this.bet.position.set(P.bet.x, P.bet.y);

    this.win.configure({
      mode: P.win.mode,
      labelSize: P.labelFont,
      valueSize: Math.round(P.valueFont * (P.win.mode === 'row' ? 1.15 : 1)),
      maxWidth: P.win.maxWidth,
      resolution: bakeRes,
    });
    this.win.position.set(P.win.x, P.win.y);

    this.replay.configure(P.labelFont, bakeRes);
    this.replay.position.set(P.replay.align === 'center' ? P.replay.x - this.replay.width / 2 : P.replay.x, P.replay.y);
    this.replayInfo.style = labelStyle(Math.round(P.labelFont * 0.8), HUD_COLORS.value);
    if (P.replay.align === 'center') {
      this.replayInfo.anchor.set(0.5, 0);
      this.replayInfo.position.set(P.replay.x, P.replay.y + P.labelFont * 0.82);
    } else {
      this.replayInfo.anchor.set(0, 0.5);
      this.replayInfo.position.set(P.replay.x + this.replay.width + P.labelFont * 0.5, P.replay.y);
    }
    this.spinCaption.style = labelStyle(P.caption.size);
    this.spinCaption.anchor.set(0.5, P.caption.anchorY);
    this.spinCaption.position.set(P.caption.x, P.caption.y);
    this.captionMax = Math.max(P.spin.r * 2.4, 200);
    fitWidth(this.spinCaption, this.captionMax);
    this.replayMax = P.replay.maxWidth;
    fitWidth(this.replayInfo, this.replayMax);

    this.layoutStatus(L);
    // layout-dependent visibility (e.g. compact free spins in the bet slot)
    this.apply(this.state, false);
  }

  /**
   * Status line = title | clock + the jurisdiction readouts (RTP, net position, session
   * timer), which must stay visible in every layout. Landscape puts the readouts on a
   * second line so they never reach the logo on the beam. Compact has no room at the
   * top (logo) or in the HUD column, so it shows the readouts alone, centred on the
   * frame's sill under the grid (the line hides itself when there are none).
   */
  private layoutStatus(L: LayoutSpec): void {
    if (L.kind === 'compact') {
      const f = L.frame;
      this.status.configure({
        size: 24,
        showTitle: false,
        showClock: false,
        split: false,
        maxWidth: f.w - 2 * L.frameParts.post - 16,
        anchorX: 0.5,
        anchorY: 0.5,
      });
      this.status.position.set(f.x + f.w / 2, f.y + f.h - L.frameParts.sill / 2);
      return;
    }
    const portrait = L.kind === 'portrait';
    const landscape = L.kind === 'landscape';
    const x = portrait ? 24 : 18;
    this.status.configure({
      size: portrait ? 28 : 26,
      showTitle: true,
      showClock: true,
      split: landscape,
      maxWidth: landscape ? L.logo.x - 16 - x : L.width - 2 * x,
      anchorX: 0,
      anchorY: 0,
    });
    this.status.position.set(x, portrait || landscape ? 6 : 8);
  }

  /**
   * Re-read every caption baked at build time. jurisdiction.socialCasino turns social
   * wording on at authenticate, after build ('BET' -> 'PLAY', 'BONUS BUY' -> 'GET BONUS').
   * The re-layout re-reads the bonus-buy caption, refits the labels and re-bakes the
   * replay chip to its new width.
   */
  private relabel(): void {
    this.balance.setLabel(t('balance'));
    this.bet.setLabel(t('bet'));
    this.fs.setLabel(t('freeSpins'));
    this.replay.setLabel(t('replay'));
    this.layout(this.ctx.layout);
  }

  // ── state ──────────────────────────────────────────────────────────────

  private apply(s: HudStateExt, animate = true): void {
    const i18n = i18nKey();
    if (i18n !== this.shownI18n) {
      this.shownI18n = i18n;
      this.relabel();
    }
    const prev = this.state;
    this.state = s;
    const replay = s.replay;
    const auto = s.autoplayRemaining !== null;
    const fs = s.freeSpins !== null;
    const idle = s.spinEnabled && !s.isSpinning && !auto;

    // round running: STOP only while pressing it can still slam (flow spinEnabled = canSlam)
    const stop = s.spinEnabled && s.slamStopAllowed !== false;
    const mode: SpinMode = auto ? 'autoplay' : s.isSpinning ? (stop ? 'spinning' : 'disabled') : s.spinEnabled ? 'idle' : 'disabled';
    this.spin.setMode(mode, s.autoplayRemaining);

    this.balance.visible = !replay;
    this.balance.setValue(s.balanceText, animate && prev.balanceText !== s.balanceText && s.balance > prev.balance);
    const betSlotFree = this.fsInBetSlot && fs;
    this.bet.visible = !replay && !betSlotFree;
    this.bet.setValue(s.betText, animate && prev.betText !== s.betText);
    this.replay.setShown(replay);
    const info = replay ? (s.replayInfoText ?? '') : '';
    this.replayInfo.visible = info !== '';
    if (info !== this.replayInfo.text) {
      this.replayInfo.text = info;
      fitWidth(this.replayInfo, this.replayMax);
    }
    const caption = replay ? (s.replayButtonText ?? '') : '';
    this.spinCaption.visible = caption !== '' && s.spinEnabled && !s.isSpinning;
    if (caption !== this.spinCaption.text) {
      this.spinCaption.text = caption;
      fitWidth(this.spinCaption, this.captionMax);
    }
    this.status.setExtras([s.rtpText, s.netPositionText, s.sessionTimeText]);

    this.betDown.setShown(!replay && !betSlotFree, animate);
    this.betUp.setShown(!replay && !betSlotFree, animate);
    this.betDown.setEnabled(s.betDownEnabled);
    this.betUp.setEnabled(s.betUpEnabled);

    this.autoplay.setShown(s.autoplayAllowed && !replay, animate);
    this.autoplay.setEnabled(auto || (idle && !fs));
    if (auto !== this.autoIconStop) {
      this.autoIconStop = auto;
      this.autoplay.setIcon(auto ? autoplayStopIcon : autoplayIcon);
    }

    this.turbo.setShown(s.turboAllowed, animate);
    if (s.turbo !== this.shownTurbo) {
      this.shownTurbo = s.turbo;
      this.turbo.setIcon(TURBO_ICON[s.turbo]);
    }

    this.buy.setShown(s.buyAllowed && !replay && !fs, animate);
    this.buy.setEnabled(idle && !fs);

    const fsText = s.freeSpins ? t('hud.fsOf', { current: s.freeSpins.current, total: s.freeSpins.total }) : null;
    this.fs.setCount(fsText);
    this.win.setLabel(fs ? t('totalWin') : t('win'));
    this.win.setStatic(s.winText, s.win > 0);
  }
}
