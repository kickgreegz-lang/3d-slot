import { API_MONEY_SCALE, BOOK_AMOUNT_SCALE } from '../config/game';

/**
 * Money helpers. ALL money in the app is integer RGS API units (1 = 1e-6 currency unit).
 * Book amounts are bet multiples x100: winApi = betApi * bookAmount / 100.
 * The flow module owns the bet (setBet) and currency/social settings; everyone else
 * only reads through ctx.money.
 */
export interface MoneyApi {
  /** current bet in API units */
  bet(): number;
  setBet(apiUnits: number): void;
  /** book amount (x100 bet multiple) -> API units at the current bet */
  fromBook(bookAmount: number): number;
  /** API units -> display string (currency symbol/position/decimals, social GC/SC suffix) */
  format(apiUnits: number): string;
  /** API units -> multiple of the current bet (e.g. 15.2) */
  multiple(apiUnits: number): number;
  readonly currency: string;
  readonly social: boolean;
}

interface CurrencyFmt {
  symbol: string;
  decimals: number;
  /** symbol after the number ("10.00 GC") */
  suffix?: boolean;
}

/** Minimal table — the flow module extends this to the full Stake currency list. */
export const CURRENCIES: Record<string, CurrencyFmt> = {
  USD: { symbol: '$', decimals: 2 },
  EUR: { symbol: '€', decimals: 2 },
  GBP: { symbol: '£', decimals: 2 },
  CAD: { symbol: 'CA$', decimals: 2 },
  AUD: { symbol: 'A$', decimals: 2 },
  JPY: { symbol: '¥', decimals: 0 },
  BRL: { symbol: 'R$', decimals: 2 },
  INR: { symbol: '₹', decimals: 2 },
  XGC: { symbol: 'GC', decimals: 2, suffix: true },
  XSC: { symbol: 'SC', decimals: 2, suffix: true },
};

export const formatMoney = (apiUnits: number, currency: string): string => {
  const fmt = CURRENCIES[currency] ?? { symbol: `${currency} `, decimals: 2 };
  const value = apiUnits / API_MONEY_SCALE;
  const num = value.toLocaleString('en-US', {
    minimumFractionDigits: fmt.decimals,
    maximumFractionDigits: fmt.decimals,
  });
  return fmt.suffix ? `${num} ${fmt.symbol}` : `${fmt.symbol}${num}`;
};

export const createMoney = (currency: string, social: boolean, initialBet = API_MONEY_SCALE): MoneyApi => {
  let bet = initialBet;
  return {
    bet: () => bet,
    setBet: (v) => {
      bet = v;
    },
    fromBook: (bookAmount) => Math.round((bet * bookAmount) / BOOK_AMOUNT_SCALE),
    format: (apiUnits) => formatMoney(apiUnits, currency),
    multiple: (apiUnits) => (bet > 0 ? apiUnits / bet : 0),
    currency,
    social,
  };
};
