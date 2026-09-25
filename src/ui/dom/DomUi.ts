import { gsap } from 'gsap';
import { FEATURES, GAME_META } from '../../config/game';
import type { SpeedProfile } from '../../core/timing';
import type { GameContext, GameModule } from '../../game/context';
import { safeText, t } from '../../i18n';
import { uiBus } from '../bus';
import { type HudStateExt, allowedSpeeds } from '../state';
import { type AutoplayChoice, autoplayDialog, buyDialog, errorDialog } from './dialogs';
import { buyMode, buyModes } from './gameInfo';
import { clear, h, svg } from './h';
import { type ModalHandle, ModalStack } from './Modal';
import { MENU_PAGES, type MenuPage, type PageDeps, guidePage, paytablePage, rulesPage, settingsPage } from './pages';
import { SVG_ICONS } from './svgIcons';
import './ui.css';

/** Per-viewer conveniences only (never game state) — every access guarded; prefixed per game. */
const STORE_KEYS = {
  sound: `${GAME_META.storagePrefix}.sound`,
  skipIntro: `${GAME_META.storagePrefix}.skipIntro`,
  autoplay: `${GAME_META.storagePrefix}.autoplay`,
} as const;
const store = {
  get(k: string): string | null {
    try {
      return window.localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string): void {
    try {
      window.localStorage.setItem(k, v);
    } catch {
      /* storage unavailable (private mode, sandbox) */
    }
  },
};

/** Info toasts auto-hide after this long (UI seconds). */
const TOAST_SECONDS = 3.4;

interface MenuView {
  handle: ModalHandle;
  tabs: Map<MenuPage, HTMLButtonElement>;
  ink: HTMLElement;
  body: HTMLElement;
  page: MenuPage;
  syncSettings: (() => void) | null;
}

/**
 * DOM overlay in #ui-root: game-info menu (paytable / rules / UI guide / settings),
 * autoplay + bonus-buy confirmations, blocking error modal and info toasts.
 * Commands go out as UiEvents on ctx.ui; all copy goes through t() (social-safe).
 *
 * Demo: __slot.ctx.ui.broadcast('ui:menu', {open:true, page:'paytable'})
 */
export class DomUi implements GameModule {
  private root!: HTMLElement;
  private modals!: ModalStack;
  private toast!: HTMLElement;
  private toastHide: gsap.core.Tween | null = null;
  private state: HudStateExt;
  private menu: MenuView | null = null;
  private lastPage: MenuPage = 'paytable';
  private dialog: ModalHandle | null = null;
  private error: { handle: ModalHandle; text: HTMLElement } | null = null;
  private soundOn = true;
  private gotState = false;
  private closingFromEvent = false;
  private readonly symbolUrls = new Map<string, string>();
  private readonly offs: Array<() => void> = [];

  constructor(private readonly ctx: GameContext) {
    this.state = {
      balanceText: '',
      betText: '',
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
    };
  }

  init(): void {
    this.soundOn = store.get(STORE_KEYS.sound) !== 'off';
    this.root = h('div.ui', { lang: 'en' });
    (document.getElementById('ui-root') ?? document.body).appendChild(this.root);
    this.modals = new ModalStack(this.root, (open) => uiBus.broadcast('modal:state', { open }));
    this.toast = h('div.ui-toast', { role: 'status', 'aria-live': 'polite' });
    this.root.appendChild(this.toast);

    this.offs.push(
      this.ctx.ui.on('ui:menu', ({ open, page }) =>
        open ? this.openMenu(page ?? this.lastPage) : this.closeMenuFromEvent(),
      ),
      uiBus.on('dialog:autoplay', () => this.openAutoplay()),
      // FEATURES.buyScreen 'game': the game's own buy screen module answers the bonus-buy hex
      uiBus.on('dialog:buy', ({ mode }) => {
        if (FEATURES.buyScreen !== 'game') this.openBuy(mode);
      }),
      this.ctx.hud.on('hud:message', (m) => this.onMessage(m)),
      this.ctx.hud.on('hud:state', (s) => this.onState(s as HudStateExt)),
    );
  }

  destroy(): void {
    for (const off of this.offs) off();
    this.modals.closeAll();
    this.root.remove();
  }

  // ── state ──────────────────────────────────────────────────────────────

  private onState(s: HudStateExt): void {
    this.state = s;
    if (typeof s.soundEnabled === 'boolean') this.soundOn = s.soundEnabled;
    if (!this.gotState) {
      this.gotState = true;
      // restore the viewer's sound preference once the flow is listening
      if (store.get(STORE_KEYS.sound) === 'off' && s.soundEnabled !== false) this.setSound(false);
    }
    this.menu?.syncSettings?.();
    // a feature/buy/autoplay confirm must never outlive the state that allowed it
    if (this.dialog?.isOpen && (s.isSpinning || s.replay)) this.dialog.close();
  }

  private setSound(on: boolean): void {
    this.soundOn = on;
    store.set(STORE_KEYS.sound, on ? 'on' : 'off');
    this.ctx.ui.broadcast('ui:sound', { enabled: on });
  }

  /**
   * ui:turbo cycles the allowed profiles; step until the requested one is active. A
   * barred target is ignored, and a full cycle back to the start stops the loop, so it
   * never lands on a profile the player did not ask for.
   */
  private setTurbo(target: SpeedProfile): void {
    const start = this.state.turbo;
    if (allowedSpeeds(this.state).includes(target)) {
      for (let i = 0; i < 3 && this.state.turbo !== target; i++) {
        this.ctx.ui.broadcast('ui:turbo', undefined);
        if (this.state.turbo === start) break;
      }
    }
    this.menu?.syncSettings?.();
  }

  // ── menu ───────────────────────────────────────────────────────────────

  private readonly deps: PageDeps = {
    state: () => this.state,
    symbolImage: (id) => this.symbolImage(id),
    sound: () => this.soundOn,
    setSound: (on) => this.setSound(on),
    setTurbo: (sp) => this.setTurbo(sp),
    skipIntro: () => store.get(STORE_KEYS.skipIntro) === '1',
    setSkipIntro: (on) => store.set(STORE_KEYS.skipIntro, on ? '1' : '0'),
  };

  private openMenu(page: MenuPage): void {
    const target = MENU_PAGES.includes(page) ? page : 'paytable';
    if (this.menu?.handle.isOpen) {
      this.showPage(target);
      return;
    }
    const tabsEl = h('div.ui-tabs', { role: 'tablist', 'aria-label': t('menu.title') });
    const ink = h('div.ui-tab-ink', { 'aria-hidden': 'true' });
    const tabs = new Map<MenuPage, HTMLButtonElement>();
    for (const p of MENU_PAGES) {
      const attrs = { type: 'button', role: 'tab', 'aria-selected': 'false', id: `ui-tab-${p}` };
      const b = h('button.ui-tab', attrs, t(`menu.${p}`));
      b.addEventListener('click', () => this.showPage(p));
      tabs.set(p, b);
      tabsEl.append(b);
    }
    tabsEl.append(ink);
    const close = h('button.ui-iconbtn', { type: 'button', 'aria-label': t('close') }, svg(SVG_ICONS.close));
    const body = h('div.ui-body', { role: 'tabpanel' });
    const panel = h('div.ui-panel', null, h('div.ui-head', null, tabsEl, close), body);
    const handle = this.modals.open({
      panel,
      sheet: true,
      label: t('menu.title'),
      onClose: () => {
        this.menu = null;
        if (!this.closingFromEvent) this.ctx.ui.broadcast('ui:menu', { open: false });
      },
    });
    close.addEventListener('click', () => handle.close());
    this.menu = { handle, tabs, ink, body, page: target, syncSettings: null };
    this.showPage(target, true);
  }

  private closeMenuFromEvent(): void {
    if (!this.menu) return;
    this.closingFromEvent = true;
    this.menu.handle.close();
    this.closingFromEvent = false;
  }

  private showPage(page: MenuPage, first = false): void {
    const m = this.menu;
    if (!m) return;
    if (!first && page === m.page) return;
    m.page = page;
    this.lastPage = page;
    for (const [p, b] of m.tabs) b.setAttribute('aria-selected', String(p === page));
    const tab = m.tabs.get(page);
    if (tab) {
      m.body.setAttribute('aria-labelledby', tab.id);
      m.ink.style.width = `${Math.max(10, tab.offsetWidth - 28)}px`;
      m.ink.style.transform = `translateX(${tab.offsetLeft + 14}px)`;
      tab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    m.syncSettings = null;
    let el: HTMLElement;
    if (page === 'paytable') el = paytablePage(this.deps);
    else if (page === 'rules') el = rulesPage();
    else if (page === 'guide') el = guidePage();
    else {
      const s = settingsPage(this.deps);
      m.syncSettings = s.sync;
      el = s.el;
    }
    clear(m.body);
    m.body.append(el);
    m.body.scrollTop = 0;
  }

  /** Symbol art from ctx.art rendered to a data URL (cached per session). */
  private symbolImage(id: string): string | null {
    const hit = this.symbolUrls.get(id);
    if (hit) return hit;
    try {
      const canvas = this.ctx.app.renderer.extract.canvas({ target: this.ctx.art.symbol(id, 'static') });
      const url = (canvas as HTMLCanvasElement).toDataURL('image/png');
      this.symbolUrls.set(id, url);
      return url;
    } catch {
      return null;
    }
  }

  // ── dialogs ────────────────────────────────────────────────────────────

  private openAutoplay(): void {
    const s = this.state;
    if (this.dialog?.isOpen || s.replay || !s.autoplayAllowed) return;
    const initial = this.loadAutoplay();
    const panel = autoplayDialog({
      state: s,
      format: (v) => this.ctx.money.format(v),
      initial,
      onStart: (c) => {
        this.saveAutoplay(c);
        this.dialog?.close();
        const bet = this.state.bet;
        this.ctx.ui.broadcast('ui:autoplay', {
          rounds: c.rounds,
          lossLimit: c.lossX === null ? undefined : bet * c.lossX,
          singleWinLimit: c.winX === null ? undefined : bet * c.winX,
        });
      },
      onCancel: () => this.dialog?.close(),
    });
    this.dialog = this.modals.open({ panel, label: t('autoplay.title') });
  }

  private loadAutoplay(): AutoplayChoice {
    const fallback: AutoplayChoice = { rounds: 10, lossX: null, winX: null };
    try {
      const raw = JSON.parse(store.get(STORE_KEYS.autoplay) ?? 'null') as {
        rounds?: number;
        lossX?: number | null;
        winX?: number | null;
      } | null;
      if (!raw) return fallback;
      return {
        rounds: raw.rounds === -1 ? Number.POSITIVE_INFINITY : (raw.rounds ?? 10),
        lossX: raw.lossX ?? null,
        winX: raw.winX ?? null,
      };
    } catch {
      return fallback;
    }
  }

  private saveAutoplay(c: AutoplayChoice): void {
    store.set(STORE_KEYS.autoplay, JSON.stringify({ ...c, rounds: Number.isFinite(c.rounds) ? c.rounds : -1 }));
  }

  private openBuy(mode: string): void {
    const s = this.state;
    const modes = buyModes();
    if (!modes.length || this.dialog?.isOpen || s.replay || !s.buyAllowed) return;
    const asked = buyMode(mode);
    const selected = Math.max(0, modes.findIndex((m) => m.mode === asked?.mode));
    const panel = buyDialog({
      options: modes.map((m) => ({
        name: t(m.nameKey),
        desc: t(m.buyDescKey ?? 'buy.desc'),
        costText: this.ctx.money.format(s.bet * m.cost),
        costX: m.cost,
      })),
      selected,
      onConfirm: (i) => {
        this.dialog?.close();
        this.ctx.ui.broadcast('ui:buy', { mode: modes[i].mode });
      },
      onCancel: () => this.dialog?.close(),
    });
    this.dialog = this.modals.open({ panel, label: t('buy.title') });
  }

  // ── messages ───────────────────────────────────────────────────────────

  private onMessage(m: { text: string; kind: 'info' | 'error' } | null): void {
    if (m === null) {
      this.hideToast();
      this.error?.handle.close();
      return;
    }
    const text = safeText(m.text);
    if (m.kind === 'info') {
      this.showToast(text);
      return;
    }
    this.hideToast();
    if (this.error?.handle.isOpen) {
      this.error.text.textContent = text;
      return;
    }
    const panel = errorDialog({
      text,
      onOk: () => this.error?.handle.close(),
      onReload: () => window.location.reload(),
    });
    const textEl = panel.querySelector<HTMLElement>('.er-text') ?? panel;
    const handle = this.modals.open({ panel, label: t('error.title'), onClose: () => void (this.error = null) });
    this.error = { handle, text: textEl };
  }

  private showToast(text: string): void {
    this.toast.textContent = text;
    this.toast.classList.add('is-shown');
    this.toastHide?.kill();
    this.toastHide = gsap.delayedCall(TOAST_SECONDS, () => this.hideToast());
  }

  private hideToast(): void {
    this.toastHide?.kill();
    this.toastHide = null;
    this.toast.classList.remove('is-shown');
  }
}
