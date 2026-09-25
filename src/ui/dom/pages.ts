import { FEATURES, GRID, SYMBOLS } from '../../config/game';
import type { SpeedProfile } from '../../core/timing';
import { t } from '../../i18n';
import { GAME_INFO, type TextRef, buyModes } from './gameInfo';
import { h, svg } from './h';
import { type HudStateExt, allowedSpeeds } from '../state';
import { SVG_ICONS } from './svgIcons';

export type MenuPage = 'paytable' | 'rules' | 'guide' | 'settings';
export const MENU_PAGES: MenuPage[] = ['paytable', 'rules', 'guide', 'settings'];

/** What the pages need from the DOM module (no direct ctx coupling). */
export interface PageDeps {
  state(): HudStateExt;
  /** data URL of a symbol's static art (null while unavailable) */
  symbolImage(id: string): string | null;
  sound(): boolean;
  setSound(on: boolean): void;
  setTurbo(target: SpeedProfile): void;
  skipIntro(): boolean;
  setSkipIntro(on: boolean): void;
}

const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;
const symName = (id: string): string => {
  const k = `sym.${id}`;
  const s = t(k);
  return s === k ? (SYMBOLS[id]?.label ?? id) : s;
};
/** Resolve a game-info text reference (keyVars are i18n keys, translated first). */
const tr = (ref: TextRef): string => {
  const vars: Record<string, string | number> = { ...ref.vars };
  for (const [k, key] of Object.entries(ref.keyVars ?? {})) vars[k] = t(key);
  return t(ref.key, vars);
};
const fmtX = (v: number): string => `×${Number.isInteger(v) ? v : v.toFixed(2).replace(/0$/, '')}`;
const h2 = (text: string): HTMLElement => h('h2.ui-h2', null, text);
const p = (text: string): HTMLElement => h('p.ui-p', null, text);

const art = (deps: PageDeps, id: string): HTMLElement => {
  const box = h('div.pt-art');
  box.style.setProperty('--c', hex(SYMBOLS[id]?.color ?? 0xffffff));
  const src = deps.symbolImage(id);
  if (src) box.append(h('img', { src, alt: '', draggable: 'false' }));
  return box;
};

// ── PAYTABLE ──────────────────────────────────────────────────────────────

export const paytablePage = (deps: PageDeps): HTMLElement => {
  const sizes = [...GAME_INFO.clusterSizes].reverse();
  const last = GAME_INFO.clusterSizes[GAME_INFO.clusterSizes.length - 1];
  let pending = false;

  const cards = GAME_INFO.paySymbols.map((id) => {
    const def = SYMBOLS[id];
    const pays = GAME_INFO.pays[id];
    if (!pays) pending = true;
    const cells = sizes.map((n) => {
      const i = GAME_INFO.clusterSizes.indexOf(n);
      const v = pays?.[i];
      return h(
        'div.pt-pay',
        null,
        h('span.n', null, n === last ? `${n}+` : String(n)),
        h('span.v', null, typeof v === 'number' ? fmtX(v) : '—'),
      );
    });
    return h(
      'div.pt-card.ui-card',
      null,
      art(deps, id),
      h(
        'div',
        null,
        h('div.pt-name', null, symName(id)),
        h('span.pt-kind', null, t(`paytable.kind.${def?.kind ?? 'royal'}`)),
      ),
      h('div.pt-pays', { 'aria-label': t('paytable.size') }, cells),
    );
  });

  const special = (id: string, title: string, desc: string): HTMLElement =>
    h('div.pt-special.ui-card', null, art(deps, id), h('div', null, h('div.pt-name', null, title), p(desc)));

  const spot = (label: string, bg: string, text: string, shadow?: string): HTMLElement => {
    const el = h('div.pt-spot', null, label);
    el.style.setProperty('--b', bg);
    el.style.setProperty('--t', text);
    if (shadow) el.style.setProperty('--s', shadow);
    return el;
  };

  // multiplier-spot legend: only for games with the spots feature (board/SpotGrid)
  const spots = FEATURES.multiplierSpots
    ? [
        h2(t('paytable.spots')),
        p(t('paytable.spots.desc')),
        h(
          'div.pt-spots',
          { 'aria-hidden': 'true' },
          spot(
            '',
            'linear-gradient(#26375a,#1c2945)',
            '#fff',
            'inset 0 0 0 2px rgba(255,190,90,.55), 0 0 12px rgba(255,160,60,.35)',
          ),
          spot('x2', 'linear-gradient(#26375a,#1f2e4d)', '#a77a2c'),
          spot('x4', 'linear-gradient(#2a2f4d,#6d190c)', '#e0501e'),
          spot('x8', 'linear-gradient(#ae231f,#dc4812)', '#ffcc00', '0 0 10px rgba(255,90,30,.55)'),
          spot(
            'x16',
            'linear-gradient(#c35221,#e0701f)',
            '#ffe34a',
            'inset 0 0 0 3px #ffc400, inset 0 -3px 0 3px #ffff9a, 0 0 14px rgba(255,126,32,.8)',
          ),
        ),
      ]
    : [];

  return h(
    'div.ui-page',
    null,
    p(t('paytable.intro')),
    h2(t('paytable.symbols')),
    h('div.pt-grid', null, cards),
    pending ? h('p.ui-note', null, t('paytable.pending')) : null,
    h2(t('paytable.specials')),
    h(
      'div.pt-grid',
      null,
      GAME_INFO.specials.map((sp) => special(sp.id, tr(sp.title), tr(sp.desc))),
    ),
    ...spots,
  );
};

// ── RULES ─────────────────────────────────────────────────────────────────

export const rulesPage = (): HTMLElement => {
  const buys = buyModes();
  const maxWin = Math.max(...GAME_INFO.modes.map((m) => m.maxWinX)).toLocaleString('en-US');
  const section = (key: string, ...body: Array<HTMLElement | null>): HTMLElement[] =>
    [h2(t(`rules.${key}.title`)), ...body].filter((x): x is HTMLElement => x !== null);

  const table = (rows: Array<{ label: TextRef; value: TextRef }>): HTMLElement =>
    h(
      'table.ui-table',
      null,
      h(
        'tbody',
        null,
        rows.map((r) => h('tr', null, h('td', null, tr(r.label)), h('td.num', null, tr(r.value)))),
      ),
    );

  // game feature sections (spots, wild, free spins, meters, ...) from the game's GAME_INFO
  const features = GAME_INFO.featureRules.flatMap((sec) =>
    section(sec.key, ...sec.blocks.map((b) => ('text' in b ? p(tr(b.text)) : table(b.table)))),
  );

  const modes = h(
    'table.ui-table',
    null,
    h(
      'thead',
      null,
      h(
        'tr',
        null,
        h('th', null, t('rules.modes.mode')),
        h('th', null, t('rules.modes.cost')),
        h('th', null, t('rules.modes.rtp')),
        h('th', null, t('rules.modes.maxWin')),
      ),
    ),
    h(
      'tbody',
      null,
      GAME_INFO.modes.map((m) =>
        h(
          'tr',
          null,
          h('td', null, t(m.nameKey)),
          h('td.num', null, t('rules.modes.costX', { x: m.cost })),
          h('td.num', null, m.rtp),
          h('td.num', null, `${m.maxWinX.toLocaleString('en-US')}×`),
        ),
      ),
    ),
  );

  return h(
    'div.ui-page',
    null,
    section('overview', p(t('rules.overview.body', { title: GAME_INFO.title, reels: GRID.reels, rows: GRID.rows }))),
    section('cluster', p(t('rules.cluster.body'))),
    section('tumble', p(t('rules.tumble.body'))),
    features,
    buys.length
      ? section('buy', ...buys.map((b) => p(t(b.buyBodyKey ?? 'rules.buy.body', { cost: b.cost, spins: b.spins ?? '' }))))
      : [],
    section('maxWin', p(t('rules.maxWin.body', { maxWin }))),
    section('rtp', p(t('rules.rtp.body'))),
    section('modes', modes),
    section(
      'more',
      p(t('rules.more.turbo')),
      p(t('rules.more.autoplay')),
      p(t('rules.more.keys')),
      p(t('rules.more.resume')),
    ),
    section(
      'disclaimer',
      h(
        'div.ui-disclaimer.ui-card',
        null,
        h('p.ui-p', null, t('rules.disclaimer.body')),
        h(
          'p.ui-p',
          null,
          t('rules.copyright', { title: GAME_INFO.title, year: GAME_INFO.year, holder: GAME_INFO.copyrightHolder }),
        ),
        h('p.ui-note', null, t('rules.version', { version: GAME_INFO.version })),
      ),
    ),
  );
};

// ── UI GUIDE ──────────────────────────────────────────────────────────────

export const guidePage = (): HTMLElement => {
  const row = (icon: string, key: string): HTMLElement =>
    h(
      'div.gd-row',
      null,
      svg(icon, 'gd-icon'),
      h('div', null, h('div.gd-title', null, t(`guide.${key}.title`)), h('p.gd-desc', null, t(`guide.${key}.desc`))),
    );
  const text = (key: string): HTMLElement =>
    h(
      'div.gd-row',
      null,
      h('div'),
      h('div', null, h('div.gd-title', null, t(`guide.${key}.title`)), h('p.gd-desc', null, t(`guide.${key}.desc`))),
    );
  return h(
    'div.ui-page',
    null,
    h(
      'div',
      null,
      row(SVG_ICONS.spin, 'spin'),
      row(SVG_ICONS.autoplay, 'autoplay'),
      row(SVG_ICONS.turbo, 'turbo'),
      row(SVG_ICONS.bet, 'bet'),
      row(SVG_ICONS.buy, 'buy'),
      row(SVG_ICONS.menu, 'menu'),
      row(SVG_ICONS.sound, 'sound'),
      text('balance'),
      text('win'),
    ),
  );
};

// ── SETTINGS ──────────────────────────────────────────────────────────────

const switchEl = (on: boolean, label: string, onToggle: (v: boolean) => void, disabled = false): HTMLButtonElement => {
  const attrs = { type: 'button', role: 'switch', 'aria-checked': String(on), 'aria-label': label, disabled };
  const b = h('button.ui-switch', attrs);
  b.addEventListener('click', () => {
    const v = b.getAttribute('aria-checked') !== 'true';
    b.setAttribute('aria-checked', String(v));
    onToggle(v);
  });
  return b;
};

export const settingsPage = (deps: PageDeps): { el: HTMLElement; sync(): void } => {
  const s = deps.state();
  const sound = switchEl(deps.sound(), t('settings.sound'), (v) => deps.setSound(v));
  const intro = switchEl(deps.skipIntro(), t('settings.intro'), (v) => deps.setSkipIntro(v));
  const speeds: SpeedProfile[] = ['normal', 'turbo', 'superTurbo'];
  const speedLabel: Record<SpeedProfile, string> = {
    normal: t('turbo.normal'),
    turbo: t('turbo.turbo'),
    superTurbo: t('turbo.superTurbo'),
  };
  const seg = h('div.ui-seg', { role: 'group', 'aria-label': t('settings.turbo') });
  const segBtns = speeds.map((sp) => {
    const b = h('button', { type: 'button', 'aria-pressed': String(s.turbo === sp) }, speedLabel[sp]);
    b.addEventListener('click', () => deps.setTurbo(sp));
    seg.append(b);
    return b;
  });
  const turboDesc = h('div.st-desc', null, s.turboAllowed ? t('settings.turbo.desc') : t('settings.turbo.locked'));
  const row = (label: string, desc: HTMLElement | string, control: HTMLElement): HTMLElement =>
    h(
      'div.st-row.ui-card',
      null,
      h('div', null, h('div.st-label', null, label), typeof desc === 'string' ? h('div.st-desc', null, desc) : desc),
      control,
    );

  const el = h(
    'div.ui-page',
    null,
    h(
      'div.st-list',
      null,
      row(t('settings.sound'), t('settings.sound.desc'), sound),
      row(t('settings.turbo'), turboDesc, seg),
      row(t('settings.intro'), t('settings.intro.desc'), intro),
    ),
    h(
      'p.ui-note',
      null,
      h('span.ui-kbd', null, 'SPACE'),
      ' / ',
      h('span.ui-kbd', null, 'ENTER'),
      ' — ',
      t('settings.keys'),
    ),
  );

  const sync = (): void => {
    const st = deps.state();
    const allowed = allowedSpeeds(st);
    sound.setAttribute('aria-checked', String(deps.sound()));
    segBtns.forEach((b, i) => {
      b.setAttribute('aria-pressed', String(st.turbo === speeds[i]));
      // a barred profile (disabledSuperTurbo) is disabled; disabledTurbo locks the whole row
      b.disabled = !st.turboAllowed || !allowed.includes(speeds[i]);
    });
    turboDesc.textContent = st.turboAllowed ? t('settings.turbo.desc') : t('settings.turbo.locked');
  };
  sync();
  return { el, sync };
};
