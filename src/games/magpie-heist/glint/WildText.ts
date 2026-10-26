import { BitmapText, Container } from 'pixi.js';
import type { GameContext, GameModule } from '../../../game/context';
import { label } from '../../../present/common/text';
import { symbolMounts } from '../../../symbols/mounts';
import WORD from './wildWord.json';

/**
 * The Bandit Mask's live ribbon word: a BitmapText "WILD" (i18n `mh.wild`, style ./wildWord.json, rig units) mounted
 * in the sym_W rig's empty `txt_wild` slot on every W view (symbolMounts), so it rides the banner's squash, wave and
 * explode fade with the rig (SpinePool.addSlotObject: the text takes the slot's alpha).
 *
 * The board sprite (art/source/magpie-heist/symbols/W/board.png, tools/mhart/rigs/render_board.mjs) already carries
 * this exact text baked at the slot's setup transform: the static -> Spine swap cannot pop. So on the STATIC sprite
 * (SymbolRig's `slotMounts` layer) the live word stays hidden (drawing it twice would double its anti-aliased
 * edges); it shows only while a Spine instance holds the view. Without a sym_W rig the mount is never used
 * (SymbolRig ignores mounts of a symbol without a rig). Registered at construction, so no W view is built without it.
 */
const STATIC_LAYER = 'slotMounts';

const makeWord = (): Container => {
  const holder = new Container({ label: 'wildWord' });
  const text = new BitmapText({
    text: label(WORD.i18nKey, WORD.text),
    style: {
      fontFamily: WORD.fontFamily,
      fontSize: WORD.fontSize,
      fill: WORD.fill,
      stroke: { color: WORD.stroke, width: WORD.strokeWidth, join: 'round' },
      dropShadow: { color: WORD.shadow, alpha: 1, blur: 0, distance: WORD.shadowDistance, angle: Math.PI / 2 },
      letterSpacing: WORD.letterSpacing,
    },
    anchor: 0.5,
  });
  if (text.width > WORD.maxWidth) text.scale.set(WORD.maxWidth / text.width);
  text.y = WORD.y;
  holder.addChild(text);
  // the static board sprite shows the baked twin of this word: draw the live one only inside a rig slot
  holder.onRender = () => {
    text.visible = holder.parent?.label !== STATIC_LAYER;
  };
  return holder;
};

export class WildText implements GameModule {
  constructor(_ctx: GameContext) {
    symbolMounts.set('W', WORD.slot, makeWord);
  }

  destroy(): void {
    symbolMounts.set('W', WORD.slot, null);
  }
}
