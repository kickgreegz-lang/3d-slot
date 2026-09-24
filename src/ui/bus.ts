import { Emitter } from '../core/emitter';

/**
 * UI-internal channel between the Pixi HUD and the DOM overlay (both owned by the
 * UI module). Gameplay commands still go out on ctx.ui (UiEvents); this bus only
 * carries HUD <-> DOM chrome traffic that the flow does not need to see.
 */
export type UiLocalEvents = {
  /** HUD autoplay button -> open the autoplay confirmation dialog */
  'dialog:autoplay': void;
  /** HUD bonus-buy button -> open the buy confirmation for `mode` */
  'dialog:buy': { mode: string };
  /** DOM overlay -> HUD: a modal is (not) covering the game (blocks hotkeys) */
  'modal:state': { open: boolean };
};

export const uiBus = new Emitter<UiLocalEvents>();

/** Live modal flag (mirrors the last 'modal:state'). */
export const modalState = { open: false };
uiBus.on('modal:state', ({ open }) => {
  modalState.open = open;
});
