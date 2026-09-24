import type { LayoutSpec, Pt } from '../../config/layout';
import type { BuyLabelMode } from './BonusBuyButton';
import type { Align } from './LabeledValue';
import type { WinMode } from './WinDisplay';

/**
 * Concrete HUD placement per design space, derived from ctx.layout.hud.
 *
 * Landscape and tablet use the frozen layout numbers as-is (reference-measured).
 * Portrait and compact apply LOCAL overrides because several frozen anchors
 * collide there (portrait: menu vs balance vs bet row; compact: balance vs win vs
 * autoplay row). The overrides are listed in the UI module's contractRequests so
 * they can move into config/layout.ts, after which PORTRAIT_FIX / COMPACT_FIX go.
 *
 * Conventions: button x/y = hex centre; LabeledValue y = label baseline (value
 * hangs below); win 'row' y = centre line, 'stack' y = label baseline.
 */
export interface HudPlacement {
  spin: Pt & { r: number; tilt: number; hit: number };
  autoplay: Pt;
  turbo: Pt;
  menu: Pt;
  betMinus: Pt;
  betPlus: Pt;
  /** small hex: visual radius, touch radius */
  small: { r: number; hit: number };
  bonusBuy: Pt & { r: number; tilt: number; label: BuyLabelMode; hit: number; short: boolean };
  bet: Pt & { align: Align; maxWidth: number };
  balance: Pt & { align: Align; maxWidth: number };
  win: Pt & { mode: WinMode; maxWidth: number };
  replay: Pt & { align: Align; maxWidth: number };
  /** free-spin counter: hex in the bonus-buy slot, or stacked text in the bet slot */
  fs: Pt & { mode: 'hex' | 'stack'; r: number; tilt: number };
  /** replay start caption under (or over) the spin hex */
  caption: Pt & { size: number; anchorY: number };
  labelFont: number;
  valueFont: number;
  /** x that splits "left" (tilt -20°) from "right" (+20°) small hexes */
  mirrorX: number;
}

const SMALL_TILT = 20;

export const smallTilt = (P: HudPlacement, x: number): number => (x < P.mirrorX ? -SMALL_TILT : SMALL_TILT);

const PORTRAIT_FIX = {
  win: { x: 540, y: 1432 },
  spin: { x: 540, y: 1636 },
  bonusBuy: { x: 130, y: 1636 },
  autoplay: { x: 300, y: 1636 },
  turbo: { x: 780, y: 1636 },
  menu: { x: 950, y: 1636 },
  balance: { x: 60, y: 1826 },
  betValue: { x: 825, y: 1826 },
  betMinus: { x: 640, y: 1848 },
  betPlus: { x: 1010, y: 1848 },
} as const;

const COMPACT_FIX = {
  balance: { x: 828, y: 26 },
  win: { x: 828, y: 74 },
  autoplay: { x: 770, y: 144 },
  turbo: { x: 886, y: 144 },
  spin: { x: 828, y: 270 },
  menu: { x: 770, y: 408 },
  bonusBuy: { x: 886, y: 408 },
  betValue: { x: 828, y: 488 },
  betMinus: { x: 728, y: 502 },
  betPlus: { x: 928, y: 502 },
} as const;

export const resolveHudLayout = (L: LayoutSpec): HudPlacement => {
  const h = L.hud;
  switch (L.kind) {
    case 'portrait': {
      const f = PORTRAIT_FIX;
      const r = 58;
      return {
        spin: { ...f.spin, r: h.spin.size * 0.56, tilt: h.spin.tilt, hit: h.spin.size * 0.56 },
        autoplay: f.autoplay,
        turbo: f.turbo,
        menu: f.menu,
        betMinus: f.betMinus,
        betPlus: f.betPlus,
        small: { r, hit: Math.max(r, h.smallButton / 2) },
        bonusBuy: { ...f.bonusBuy, r: 76, tilt: -20, label: 'below', hit: 85, short: false },
        bet: { ...f.betValue, align: 'center', maxWidth: f.betPlus.x - f.betMinus.x - 2 * r - 24 },
        balance: { ...f.balance, align: 'left', maxWidth: f.betMinus.x - r - f.balance.x - 24 },
        win: { ...f.win, mode: 'row', maxWidth: 560 },
        replay: { x: f.balance.x, y: f.balance.y + 20, align: 'left', maxWidth: 560 },
        fs: { ...f.bonusBuy, mode: 'hex', r: 80, tilt: -20 },
        caption: { x: f.spin.x, y: f.spin.y + h.spin.size * 0.56 + 6, size: 28, anchorY: 0 },
        labelFont: h.labelFont,
        valueFont: h.valueFont,
        mirrorX: f.spin.x,
      };
    }
    case 'compact': {
      const f = COMPACT_FIX;
      const r = 30;
      return {
        spin: { ...f.spin, r: 80, tilt: h.spin.tilt, hit: 84 },
        autoplay: f.autoplay,
        turbo: f.turbo,
        menu: f.menu,
        betMinus: f.betMinus,
        betPlus: f.betPlus,
        small: { r, hit: Math.max(r + 6, h.smallButton / 2) },
        bonusBuy: { ...f.bonusBuy, r: 33, tilt: 20, label: 'below', hit: 42, short: true },
        bet: { ...f.betValue, align: 'center', maxWidth: f.betPlus.x - f.betMinus.x - 2 * r - 12 },
        balance: { ...f.balance, align: 'row', maxWidth: 252 },
        win: { ...f.win, mode: 'row', maxWidth: 252 },
        replay: { x: f.balance.x, y: f.balance.y, align: 'center', maxWidth: 252 },
        fs: { ...f.betValue, mode: 'stack', r: 0, tilt: 0 },
        caption: { x: f.spin.x, y: f.spin.y + 82, size: 20, anchorY: 0 },
        labelFont: 26,
        valueFont: 34,
        mirrorX: f.spin.x,
      };
    }
    default: {
      // landscape / tablet: frozen reference numbers
      const r = h.smallButton / 2;
      return {
        spin: { x: h.spin.x, y: h.spin.y, r: h.spin.size * 0.56, tilt: h.spin.tilt, hit: h.spin.size * 0.56 },
        autoplay: h.autoplay,
        turbo: h.turbo,
        menu: h.menu,
        betMinus: h.betMinus,
        betPlus: h.betPlus,
        small: { r, hit: r * 1.12 },
        bonusBuy: { ...h.bonusBuy, r: 88, tilt: -20, label: 'edge', hit: 92, short: false },
        bet: { ...h.betValue, align: 'center', maxWidth: h.betPlus.x - h.betMinus.x - 2 * r - 24 },
        balance: { ...h.balance, align: 'left', maxWidth: 420 },
        win: { ...h.win, mode: 'row', maxWidth: 640 },
        replay: { x: h.balance.x, y: h.balance.y + 12, align: 'left', maxWidth: 520 },
        fs: { ...h.bonusBuy, mode: 'hex', r: 88, tilt: -20 },
        caption: {
          x: h.spin.x,
          y: h.spin.y + h.spin.size * 0.56 * 0.98,
          size: Math.round(h.labelFont * 0.9),
          anchorY: 0,
        },
        labelFont: h.labelFont,
        valueFont: h.valueFont,
        mirrorX: L.width / 2,
      };
    }
  }
};
