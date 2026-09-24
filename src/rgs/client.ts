import {
  type AuthenticateResponse,
  type BalanceResponse,
  type EndRoundResponse,
  type EventResponse,
  type PlayRequest,
  type PlayResponse,
  type ReplayRequest,
  type ReplayResponse,
  RgsError,
} from './types';

/**
 * Minimal Stake Engine RGS client (mirrors web-sdk rgs-requests + the official
 * ts-client, minus its console output). Every call is a JSON POST with the
 * sessionID in the body — there are no auth headers. Money is integer API units.
 *
 *   authenticate -> play -> [event]* -> end-round      (+ balance poll)
 *   replay: GET /bet/replay/{game}/{version}/{mode}/{event}, no session
 */

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/;
const REQUEST_TIMEOUT_MS = 30_000;

/** `rgs_url` is a scheme-less host(+path). https always, except localhost in DEV (mock RGS). */
export const rgsBaseUrl = (rgsUrl: string): string => {
  const host = rgsUrl.trim().replace(/^[a-z]+:\/\//i, '').replace(/\/+$/, '');
  const scheme = import.meta.env.DEV && LOCAL_HOST.test(host) ? 'http' : 'https';
  return `${scheme}://${host}`;
};

export interface RgsClientOptions {
  rgsUrl: string;
  /** null in replay mode (no session calls allowed) */
  sessionID: string | null;
  language: string;
  /**
   * DEV-only query parameters forwarded to the mock RGS (forced fixture book,
   * jurisdiction overrides...). Ignored in production builds.
   */
  devQuery?: () => Record<string, string | null | undefined>;
}

type Json = Record<string, unknown>;

export class RgsClient {
  readonly base: string;

  constructor(private readonly opts: RgsClientOptions) {
    this.base = rgsBaseUrl(opts.rgsUrl);
  }

  authenticate(): Promise<AuthenticateResponse> {
    return this.post<AuthenticateResponse>('/wallet/authenticate', {
      sessionID: this.session(),
      language: this.opts.language,
    });
  }

  /** `amount` is the BASE bet; the RGS debits amount x mode cost. */
  async play(req: PlayRequest): Promise<PlayResponse> {
    const res = await this.post<PlayResponse>('/wallet/play', {
      sessionID: this.session(),
      amount: req.amount,
      mode: req.mode,
      currency: req.currency,
    });
    if (!res.round || !Array.isArray(res.round.state) || res.round.state.length === 0) {
      throw new RgsError('ERR_EMPTY_STATE', 'Empty state in play response', 200);
    }
    return res;
  }

  endRound(): Promise<EndRoundResponse> {
    return this.post<EndRoundResponse>('/wallet/end-round', { sessionID: this.session() });
  }

  balance(): Promise<BalanceResponse> {
    return this.post<BalanceResponse>('/wallet/balance', { sessionID: this.session() });
  }

  /** Records bonus progress (the reveal's book-event index) so a reload can resume. */
  event(index: number | string): Promise<EventResponse> {
    return this.post<EventResponse>('/bet/event', { sessionID: this.session(), event: `${index}` });
  }

  async replay(req: ReplayRequest): Promise<ReplayResponse> {
    const parts = [req.game, req.version, req.mode, req.event].map(encodeURIComponent);
    const res = await this.request<ReplayResponse>('GET', `/bet/replay/${parts.join('/')}`);
    if (!Array.isArray(res.state) || res.state.length === 0) {
      throw new RgsError('ERR_EMPTY_STATE', 'Empty replay state', 200);
    }
    return res;
  }

  private session(): string {
    if (!this.opts.sessionID) throw new RgsError('ERR_IS', 'No sessionID', 0);
    return this.opts.sessionID;
  }

  private post<T>(path: string, body: Json): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  private url(path: string): string {
    const url = `${this.base}${path}`;
    if (!import.meta.env.DEV || !this.opts.devQuery) return url;
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(this.opts.devQuery())) if (v) q.set(k, v);
    const qs = q.toString();
    return qs ? `${url}?${qs}` : url;
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: Json): Promise<T> {
    let response: Response;
    try {
      response = await fetch(this.url(path), {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (e) {
      throw new RgsError('ERR_NETWORK', e instanceof Error ? e.message : 'Network error', 0);
    }
    let data: unknown = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }
    const obj = (data && typeof data === 'object' ? data : {}) as Json;
    if (!response.ok || typeof obj.error === 'string') {
      const code = typeof obj.error === 'string' ? obj.error : response.status >= 500 ? 'ERR_GEN' : 'ERR_VAL';
      const message = typeof obj.message === 'string' ? obj.message : `HTTP ${response.status}`;
      throw new RgsError(code, message, response.status);
    }
    if (data === null) throw new RgsError('ERR_GEN', 'Malformed RGS response', response.status);
    return data as T;
  }
}
