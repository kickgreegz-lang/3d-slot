import type { BookEvent, BookEventOf, BookEventType } from './types';

/**
 * Sequential book player (mirrors web-sdk utils-book createPlayBookUtils):
 * a strictly sequential `for await` over the round's events, each dispatched to
 * `bookEventHandlerMap[event.type]`. A handler resolves when its presentation is
 * done (it awaits `ctx.game.broadcastAsync(...)`), so animation length — never a
 * timer — decides when the next event plays.
 *
 * A missing handler throws in DEV (so new math events are noticed immediately)
 * and is skipped silently in production (zero console output for approval).
 */
export type BookEventHandler<E extends BookEvent, C> = (event: E, ctx: C) => Promise<void>;

export type BookEventHandlerMap<C> = {
  [K in BookEventType]: BookEventHandler<BookEventOf<K>, C>;
};

export interface PlayBookOptions {
  /** start at this array position (resume) */
  from?: number;
  /** called before each event is dispatched (dev tracing, progress) */
  onEvent?: (event: BookEvent, position: number) => void;
  /** checked between events; returning true stops playback early */
  aborted?: () => boolean;
}

export class MissingBookHandlerError extends Error {
  override readonly name = 'MissingBookHandlerError';
  constructor(readonly eventType: string) {
    super(`Missing bookEventHandler for "${eventType}"`);
  }
}

export const playBookEvent = async <C>(
  map: BookEventHandlerMap<C>,
  event: BookEvent,
  ctx: C,
): Promise<void> => {
  const handler = (map as Partial<Record<string, BookEventHandler<BookEvent, C>>>)[event.type];
  if (!handler) {
    if (import.meta.env.DEV) throw new MissingBookHandlerError(String(event.type));
    return;
  }
  await handler(event, ctx);
};

export const playBookEvents = async <C>(
  map: BookEventHandlerMap<C>,
  events: readonly BookEvent[],
  ctx: C,
  opts: PlayBookOptions = {},
): Promise<void> => {
  const from = Math.max(0, Math.min(events.length, opts.from ?? 0));
  for (const [i, event] of events.slice(from).entries()) {
    if (opts.aborted?.()) return;
    opts.onEvent?.(event, from + i);
    await playBookEvent(map, event, ctx);
  }
};
