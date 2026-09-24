/**
 * Stake Engine launch parameters.
 * https://{team}.live.stake-engine.com/{game}/v{version}/?sessionID=..&rgs_url=..&lang=..&currency=..&device=..&social=..&demo=..
 * Replay adds: replay=true&game=<uuid>&version=<math version>&mode=<mode>&event=<sim id>[&amount=<api units>]
 * Dev-only extras: dev=lab|gallery|books, book=<fixture key or id>, bookMode=base|bonus, tier=low|high, capture=1
 */
export interface UrlParams {
  sessionID: string | null;
  /** hostname without scheme, e.g. rgs.stake-engine.com (localhost:5173/__rgs in dev) */
  rgsUrl: string | null;
  lang: string;
  currency: string;
  device: 'desktop' | 'mobile';
  social: boolean;
  demo: boolean;
  replay: boolean;
  game: string | null;
  version: string | null;
  mode: string | null;
  event: string | null;
  amount: number | null;
  dev: string | null;
  book: string | null;
  bookMode: string | null;
  capture: boolean;
}

export const parseUrl = (search: string = location.search): UrlParams => {
  const q = new URLSearchParams(search);
  let lang = (q.get('lang') ?? 'en').toLowerCase();
  if (lang === 'br') lang = 'pt';
  if (lang === 'po') lang = 'pl';
  const amountRaw = q.get('amount');
  return {
    sessionID: q.get('sessionID'),
    rgsUrl: q.get('rgs_url'),
    lang,
    currency: (q.get('currency') ?? 'USD').toUpperCase(),
    device: q.get('device') === 'mobile' ? 'mobile' : 'desktop',
    social: q.get('social') === 'true',
    demo: q.get('demo') === 'true',
    replay: q.get('replay') === 'true',
    game: q.get('game'),
    version: q.get('version'),
    mode: q.get('mode'),
    event: q.get('event'),
    amount: amountRaw !== null && amountRaw !== '' ? Number(amountRaw) : null,
    dev: q.get('dev'),
    book: q.get('book'),
    bookMode: q.get('bookMode'),
    capture: q.get('capture') === '1',
  };
};
