import { t } from '../../i18n';
import type { HudStateExt } from '../state';
import { h, svg } from './h';
import { SVG_ICONS } from './svgIcons';

/** Autoplay presets (Stake: autoplay needs an explicit confirmation — START). */
export const AUTOPLAY_ROUNDS = [10, 25, 50, 75, 100, 250, 500, 1000, Number.POSITIVE_INFINITY];
/** Stop limits as multiples of the current bet (null = off). */
export const LOSS_LIMITS: Array<number | null> = [null, 10, 25, 50, 100, 250];
export const WIN_LIMITS: Array<number | null> = [null, 10, 50, 100, 500, 1000];

export interface AutoplayChoice {
  rounds: number;
  lossX: number | null;
  winX: number | null;
}

const head = (title: string, onClose: () => void): HTMLElement =>
  h(
    'div.ui-head',
    null,
    h('h2.ui-title', null, title),
    h('button.ui-iconbtn', { type: 'button', 'aria-label': t('close'), onclick: onClose }, svg(SVG_ICONS.close)),
  );

/** One-of-N chip group; returns the element and a getter. */
const chipGroup = <T>(
  values: T[],
  initial: T,
  label: (v: T) => HTMLElement | string,
  aria: string,
  onChange: () => void,
): { el: HTMLElement; get(): T } => {
  let current = values.includes(initial) ? initial : values[0];
  const el = h('div.ui-chips', { role: 'group', 'aria-label': aria });
  const btns = values.map((v) => {
    const b = h('button.ui-chip', { type: 'button', 'aria-pressed': String(v === current) }, label(v));
    b.addEventListener('click', () => {
      current = v;
      btns.forEach((x, i) => x.setAttribute('aria-pressed', String(values[i] === current)));
      onChange();
    });
    el.append(b);
    return b;
  });
  return { el, get: () => current };
};

/**
 * AUTOPLAY dialog: rounds, optional loss limit and single-win limit (shown as money
 * at the current bet), START confirms. Limits are sent in API units.
 */
export const autoplayDialog = (opts: {
  state: HudStateExt;
  format: (api: number) => string;
  initial: AutoplayChoice;
  onStart: (c: AutoplayChoice) => void;
  onCancel: () => void;
}): HTMLElement => {
  const { state, format } = opts;
  const moneyChip = (x: number | null): HTMLElement | string =>
    x === null ? t('off') : h('span', null, format(state.bet * x), h('small', null, `${x}×`));
  const start = h('button.ui-btn.primary', { type: 'button', 'data-autofocus': true });
  const rounds = chipGroup(
    AUTOPLAY_ROUNDS,
    opts.initial.rounds,
    (n) => (Number.isFinite(n) ? String(n) : t('infinite')),
    t('autoplay.rounds'),
    () => sync(),
  );
  const loss = chipGroup(LOSS_LIMITS, opts.initial.lossX, moneyChip, t('autoplay.lossLimit'), () => sync());
  const win = chipGroup(WIN_LIMITS, opts.initial.winX, moneyChip, t('autoplay.winLimit'), () => sync());
  const sync = (): void => {
    const n = rounds.get();
    start.textContent = Number.isFinite(n) ? t('autoplay.startN', { n }) : t('autoplay.start');
  };
  sync();
  start.addEventListener('click', () => opts.onStart({ rounds: rounds.get(), lossX: loss.get(), winX: win.get() }));
  return h(
    'div.ui-panel.is-dialog',
    null,
    head(t('autoplay.title'), opts.onCancel),
    h(
      'div.dl-body.ui-body',
      null,
      h('div.dl-label', null, t('autoplay.rounds')),
      rounds.el,
      h('div.dl-label', null, t('autoplay.lossLimit')),
      h('p.dl-hint', null, t('autoplay.lossLimitHint')),
      loss.el,
      h('div.dl-label', null, t('autoplay.winLimit')),
      h('p.dl-hint', null, t('autoplay.winLimitHint')),
      win.el,
      h('p.dl-note', null, t('autoplay.note')),
    ),
    h('div.dl-foot', null, h('button.ui-btn.ghost', { type: 'button', onclick: opts.onCancel }, t('cancel')), start),
  );
};

/** BONUS BUY confirmation (required for any mode costing more than 2x). */
export const buyDialog = (opts: {
  costText: string;
  costX: number;
  onConfirm: () => void;
  onCancel: () => void;
}): HTMLElement =>
  h(
    'div.ui-panel.is-dialog',
    null,
    h(
      'div.dl-body',
      null,
      h(
        'div.by-hero',
        null,
        svg(SVG_ICONS.buy, 'by-icon'),
        h('div', null, h('h2.by-title', null, t('buy.title')), h('p.by-desc', null, t('buy.desc'))),
      ),
      h(
        'div.by-cost.ui-card',
        null,
        h('span.k', null, t('buy.costLabel')),
        h('span', null, h('span.v', null, opts.costText), h('span.x', null, t('buy.multiple', { x: opts.costX }))),
      ),
    ),
    h(
      'div.dl-foot',
      null,
      h('button.ui-btn.ghost', { type: 'button', onclick: opts.onCancel }, t('cancel')),
      h('button.ui-btn.accent', { type: 'button', onclick: opts.onConfirm, 'data-autofocus': true }, t('buy.confirm')),
    ),
  );

/** Blocking error (hud:message kind 'error'). */
export const errorDialog = (opts: { text: string; onOk: () => void; onReload: () => void }): HTMLElement =>
  h(
    'div.ui-panel.is-alert',
    { role: 'alertdialog' },
    h(
      'div.dl-body',
      null,
      svg(SVG_ICONS.alert, 'er-icon'),
      h('h2.er-title', null, t('error.title')),
      h('p.er-text', null, opts.text),
    ),
    h(
      'div.dl-foot',
      null,
      h('button.ui-btn.ghost', { type: 'button', onclick: opts.onReload }, t('reload')),
      h('button.ui-btn.primary', { type: 'button', onclick: opts.onOk, 'data-autofocus': true }, t('ok')),
    ),
  );
