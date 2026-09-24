/**
 * Typed, awaitable event emitter (mirrors the Stake web-sdk eventEmitter).
 *
 *  - `on(type, handler)`            subscribe; returns an unsubscribe fn
 *  - `broadcast(type, payload)`     fire-and-forget
 *  - `broadcastAsync(type, payload)` resolves when EVERY subscriber's returned
 *                                    promise has resolved (Promise.all)
 *
 * Book handlers `await emitter.broadcastAsync(...)` so animation length — not a
 * timer — decides when the next book event plays.
 */
export type EventMap = Record<string, unknown>;
type Handler<P> = (payload: P) => void | Promise<unknown>;

export class Emitter<M extends EventMap> {
  private handlers = new Map<keyof M, Set<Handler<never>>>();

  on<K extends keyof M>(type: K, handler: Handler<M[K]>): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler as Handler<never>);
    return () => this.off(type, handler);
  }

  once<K extends keyof M>(type: K, handler: Handler<M[K]>): () => void {
    const off = this.on(type, (p) => {
      off();
      return handler(p);
    });
    return off;
  }

  off<K extends keyof M>(type: K, handler: Handler<M[K]>): void {
    this.handlers.get(type)?.delete(handler as Handler<never>);
  }

  broadcast<K extends keyof M>(type: K, payload: M[K]): void {
    const set = this.handlers.get(type);
    if (!set) return;
    for (const h of [...set]) (h as Handler<M[K]>)(payload);
  }

  async broadcastAsync<K extends keyof M>(type: K, payload: M[K]): Promise<void> {
    const set = this.handlers.get(type);
    if (!set) return;
    await Promise.all([...set].map((h) => (h as Handler<M[K]>)(payload)));
  }

  clear(): void {
    this.handlers.clear();
  }
}
