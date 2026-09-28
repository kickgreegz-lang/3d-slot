import { gsap } from 'gsap';
import { BitmapText, Container } from 'pixi.js';
import { FONTS } from '../../../assets/fonts';
import { followSpeed, s } from '../../../core/timing';
import { label } from '../../../present/common/text';
import { symbolMounts } from '../../../symbols/mounts';
import type { SymbolLook } from '../../../symbols/types';
import { multTier } from '../timing';
import { MULT_FONT } from './art';
import { clipMs, W_CLIPS } from './look';

/**
 * The `sym_W` rig's live parts (ANIMATION_SET §2.6, ART_STATUS §7.5), in RIG UNITS (the 360 @2x
 * canvas, cell = 300 units; a mount's origin is its slot bone):
 *  - `txt_wild`: the ribbon word "WILD" (i18n `bd.wild`), on every W view (symbolMounts);
 *  - `txt_mult`: the live "×N" on the badge plate, cap height 90 units (30% of the cell);
 *  - `ctrl_badge_scale`: the runtime's plate scale (slam, appear, maxed punch), a bone no clip keys.
 * Nothing here is baked: the plate art is the rig's `badge_t1..t5` attachment, the number is text.
 */
export const W_RIG = {
  /** ribbon word: Luckiest Guy, warm white, ink stroke; fits the ribbon's inner band */
  wordSize: 54,
  wordMaxW: 144,
  wordFill: 0xfff1c9,
  wordStroke: 7,
  wordShadow: 0x4b283d,
  /** baseline nudge (units, y-down) so the caps sit in the band's optical centre */
  wordY: 2,
  /** txt_mult cap height (units) / Lilita One cap-height ratio of the installed MULT_FONT */
  multCap: 90,
  capRatio: 0.72,
  /** share of the 192-unit plate the value may use */
  multMaxW: 150,
  multY: 3,
} as const;

/** The W's ribbon word: one live BitmapText per W view, placed by SymbolRig (static sprite or rig slot). */
const makeWildWord = (): Container => {
  const holder = new Container({ label: 'wildWord' });
  const text = new BitmapText({
    text: label('bd.wild', 'WILD'),
    style: {
      fontFamily: FONTS.title,
      fontSize: W_RIG.wordSize,
      fill: W_RIG.wordFill,
      stroke: { color: 0x160a12, width: W_RIG.wordStroke, join: 'round' },
      dropShadow: { color: W_RIG.wordShadow, alpha: 1, blur: 0, distance: 3, angle: Math.atan2(0.83, 0.56) },
      letterSpacing: 1,
    },
    anchor: 0.5,
  });
  if (text.width > W_RIG.wordMaxW) text.scale.set(W_RIG.wordMaxW / text.width);
  text.y = W_RIG.wordY;
  holder.addChild(text);
  return holder;
};

/** Every W view (board, pool, flying proxies) carries the live ribbon word. Returns the unregister. */
export const registerWildWord = (): (() => void) => {
  symbolMounts.set('W', 'txt_wild', makeWildWord);
  return () => symbolMounts.set('W', 'txt_wild', null);
};

export type WildSkin = 'mult' | 'sticky';

/**
 * One multiplier / sticky wild's rig look (the W rig replaces the phase-B code badge + clamps):
 * skin `mult` (badge) or `sticky` (badge + clamps), the tier attachment, the live "×N" mounted in
 * `txt_mult`, and the plate-scale channel. The registry hands `look()` to the Board ('board:look',
 * 'board:transform' cells) and plays the rig's own clips ('board:play': sticky_lock, mult_up,
 * sticky_unlock). Pooled by the registry: free once `owner` is null and the Board has detached
 * the text (the view was recycled).
 */
export class RigWild {
  /** txt_mult mount (the view mounts it; the holder keeps the value text's own scale) */
  readonly text = new Container({ label: 'wildMult' });
  /** ctrl_badge_scale channel, written into the bone every rig update */
  readonly badge = { scaleX: 1, scaleY: 1 };
  private readonly digits: BitmapText;
  private anim: gsap.core.Animation | null = null;
  skin: WildSkin = 'mult';
  value = 0;
  tier = 1;
  owner: object | null = null;

  constructor() {
    this.digits = new BitmapText({
      text: '',
      style: { fontFamily: MULT_FONT, fontSize: W_RIG.multCap / W_RIG.capRatio },
      anchor: 0.5,
    });
    this.digits.y = W_RIG.multY;
    this.text.addChild(this.digits);
  }

  /** Value text + tier plate (the tier applies with the next look()). */
  setValue(mult: number): void {
    this.value = mult;
    this.tier = multTier(mult).tier;
    const d = this.digits;
    d.text = label('bd.drop.mult', '×{n}', { n: mult });
    d.scale.set(1);
    if (d.width > W_RIG.multMaxW) d.scale.set(W_RIG.multMaxW / d.width);
  }

  /** The Board look for the current state (a fresh object: the view diffs it). */
  look(): SymbolLook {
    return {
      skin: this.skin,
      attachments: { badge: `badge_t${this.tier}` },
      mounts: { txt_mult: this.text },
      bones: { ctrl_badge_scale: this.badge },
      rest: this.skin === 'sticky' ? 'sticky_idle' : 'idle',
    };
  }

  /** Plate scale now (0 = hidden until the slam / appear). */
  setBadge(k: number): void {
    this.anim?.kill();
    this.anim = null;
    this.badge.scaleX = k;
    this.badge.scaleY = k;
  }

  /** DESIGN §8.1 multiplier slam: the plate drops in from 2.2 to 1.0 in 180 ms (back.out(3)). */
  slam(): Promise<void> {
    return this.tween(2.2, 1, s(180), 'back.out(3)');
  }

  /** A home's return (§9.3.3): the plate pops in over the `appear` 9 f. */
  appear(): Promise<void> {
    return this.tween(0, 1, s(clipMs(W_CLIPS.appear)), 'back.out(2)');
  }

  /** Cap x25 (§9.4): the maxed punch, no number change. */
  punch(): Promise<void> {
    return this.tween(1.14, 1, s(300), 'back.out(2.5)');
  }

  /** Taken from / returned to the pool: plate at rest, no tween. */
  rest(): void {
    this.setBadge(1);
  }

  private tween(from: number, to: number, sec: number, ease: string): Promise<void> {
    this.setBadge(from);
    return new Promise((resolve) => {
      this.anim = followSpeed(
        gsap.to(this.badge, {
          scaleX: to,
          scaleY: to,
          duration: sec,
          ease,
          onComplete: () => resolve(),
          onInterrupt: () => resolve(),
        }),
      );
    });
  }

  destroy(): void {
    this.anim?.kill();
    this.text.destroy({ children: true });
  }
}
