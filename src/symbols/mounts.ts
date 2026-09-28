import type { Container } from 'pixi.js';

/**
 * Symbol-level live mounts: display objects every view of a symbol carries in an empty `txt_*`
 * slot of its rig (ANIMATION_SET §0 "Text": never baked; e.g. Bass Drop's W ribbon word "WILD" in
 * `txt_wild`). A game registers a factory per (symbol id, slot) before its board shows the symbol;
 * each SymbolRig creates its own object (cached per id, destroyed with the view) and draws it
 *  - on the static board sprite: at the slot bone's SETUP transform (the sprite is the setup pose),
 *  - on a borrowed / held Spine instance: in the slot itself (addSlotObject: bone, alpha, draw order).
 * Units = skeleton units (the 360 @2x canvas), origin at the slot's bone. Needs the symbol's Spine
 * rig (the placement comes from its setup pose); symbols without one ignore their mounts.
 */
export type SymbolMountFactory = () => Container;

const registry = new Map<string, Map<string, SymbolMountFactory>>();
let version = 0;

export const symbolMounts = {
  /** Register (or with null remove) the mount factory of `slot` on symbol `id`. */
  set(id: string, slot: string, factory: SymbolMountFactory | null): void {
    let m = registry.get(id);
    if (factory) {
      if (!m) {
        m = new Map();
        registry.set(id, m);
      }
      m.set(slot, factory);
    } else if (m) {
      m.delete(slot);
      if (!m.size) registry.delete(id);
    }
    version++;
  },
  get(id: string): ReadonlyMap<string, SymbolMountFactory> | undefined {
    return registry.get(id);
  },
  /** bumped on every change (views rebuild their cached mounts lazily) */
  get version(): number {
    return version;
  },
};
