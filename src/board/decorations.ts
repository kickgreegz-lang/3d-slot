import type { Container } from 'pixi.js';
import type { SymbolView } from '../symbols/types';

/**
 * Board decorations ('board:decorate'): keyed display objects (multiplier badges, sticky
 * clamps, tags) hung on a SymbolView's `decor` holder, so they follow the VIEW — tumble
 * falls, squash, win pops and winLayer elevation — not the cell.
 *
 * Ownership stays with the emitter: the Board only adds / detaches. A view that is recycled
 * (explode -> pool, fall-out, board:set, a symbol swap) drops its decorations with
 * removeFromParent(); nothing is ever destroyed here. A display that is already somewhere
 * else (the owner took it back, or hung it on another view) is left alone.
 */
export class Decorations {
  private readonly byView = new Map<SymbolView, Map<string, Container>>();

  /** Hang `display` under `key` on `sv` (replacing that key), or remove the key (null). */
  set(sv: SymbolView, key: string, display: Container | null): void {
    let keys = this.byView.get(sv);
    const old = keys?.get(key);
    if (old && old !== display && old.parent === sv.decor) old.removeFromParent();
    if (!display) {
      keys?.delete(key);
      if (keys && !keys.size) this.byView.delete(sv);
      return;
    }
    this.forget(display);
    if (!keys) {
      keys = new Map();
      this.byView.set(sv, keys);
    }
    keys.set(key, display);
    sv.decor.addChild(display);
  }

  /** The view is being recycled: detach everything it still carries. */
  detach(sv: SymbolView): void {
    const keys = this.byView.get(sv);
    if (!keys) return;
    this.byView.delete(sv);
    for (const d of keys.values()) if (d.parent === sv.decor) d.removeFromParent();
  }

  /** Detach every decoration on the board (board:set, destroy). */
  clear(): void {
    for (const sv of [...this.byView.keys()]) this.detach(sv);
  }

  /** A display moving to a new view / key leaves its previous record. */
  private forget(display: Container): void {
    for (const [sv, keys] of this.byView) {
      for (const [k, d] of keys) {
        if (d !== display) continue;
        keys.delete(k);
        if (!keys.size) this.byView.delete(sv);
        return;
      }
    }
  }
}
