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
  /**
   * FLOW ONLY: the authoritative currency comes from the RGS authenticate balance
   * (the URL `currency` is only a hint / the replay display currency).
   */
  configure?(opts: { currency?: string; social?: boolean }): void;
}

interface CurrencyFmt {
  symbol: string;
  decimals: number;
  /** symbol after the number ("10.00 GC") */
  suffix?: boolean;
}

/**
 * Full Stake Engine currency table (engine-docs reference/currencies — where the docs and
 * the npm ts-client disagree (XGC/NGN decimals, PEN placement) the docs win).
 * GBP/AUD are not Stake currencies but kept for local testing.
 */
export const CURRENCIES: Record<string, CurrencyFmt> = {
  USD: { symbol: '$', decimals: 2 },
  CAD: { symbol: 'CA$', decimals: 2 },
  JPY: { symbol: '¥', decimals: 0 },
  EUR: { symbol: '€', decimals: 2 },
  RUB: { symbol: '₽', decimals: 2 },
  CNY: { symbol: 'CN¥', decimals: 2 },
  PHP: { symbol: '₱', decimals: 2 },
  INR: { symbol: '₹', decimals: 2 },
  IDR: { symbol: 'Rp', decimals: 0 },
  KRW: { symbol: '₩', decimals: 0 },
  BRL: { symbol: 'R$', decimals: 2 },
  MXN: { symbol: 'MX$', decimals: 2 },
  DKK: { symbol: 'KR', decimals: 2, suffix: true },
  PLN: { symbol: 'zł', decimals: 2, suffix: true },
  VND: { symbol: '₫', decimals: 0, suffix: true },
  TRY: { symbol: '₺', decimals: 2 },
  CLP: { symbol: 'CLP', decimals: 0, suffix: true },
  ARS: { symbol: 'ARS', decimals: 2, suffix: true },
  PEN: { symbol: 'S/', decimals: 2 },
  NGN: { symbol: '₦', decimals: 2 },
  SAR: { symbol: 'SAR', decimals: 2, suffix: true },
  ILS: { symbol: 'ILS', decimals: 2, suffix: true },
  AED: { symbol: 'AED', decimals: 2, suffix: true },
  TWD: { symbol: 'NT$', decimals: 2 },
  NOK: { symbol: 'kr', decimals: 2 },
  KWD: { symbol: 'KD', decimals: 2 },
  JOD: { symbol: 'JD', decimals: 2 },
  CRC: { symbol: '₡', decimals: 2 },
  TND: { symbol: 'TND', decimals: 2, suffix: true },
  SGD: { symbol: 'SG$', decimals: 2 },
  MYR: { symbol: 'RM', decimals: 2 },
  OMR: { symbol: 'OMR', decimals: 2, suffix: true },
  QAR: { symbol: 'QAR', decimals: 2, suffix: true },
  BHD: { symbol: 'BD', decimals: 2 },
  // Stake.us social casino: never a '$' prefix
  XGC: { symbol: 'GC', decimals: 2, suffix: true },
  XSC: { symbol: 'SC', decimals: 2, suffix: true },
  GBP: { symbol: '£', decimals: 2 },
  AUD: { symbol: 'A$', decimals: 2 },
};

/** Docs fallback for unknown codes: "10.00 CODE". */
export const currencyFormat = (currency: string): CurrencyFmt =>
  CURRENCIES[currency] ?? { symbol: currency, decimals: 2, suffix: true };

export const formatMoney = (apiUnits: number, currency: string): string => {
  const fmt = currencyFormat(currency);
  const value = Math.abs(apiUnits) / API_MONEY_SCALE;
  const num = value.toLocaleString('en-US', {
    minimumFractionDigits: fmt.decimals,
    maximumFractionDigits: fmt.decimals,
  });
  const sign = apiUnits < 0 && num.replace(/[0.,]/g, '') !== '' ? '-' : '';
  return fmt.suffix ? `${sign}${num} ${fmt.symbol}` : `${sign}${fmt.symbol}${num}`;
};

export const createMoney = (currency: string, social: boolean, initialBet = API_MONEY_SCALE): MoneyApi => {
  let bet = initialBet;
  let cur = currency;
  let soc = social;
  return {
    bet: () => bet,
    setBet: (v) => {
      bet = v;
    },
    fromBook: (bookAmount) => Math.round((bet * bookAmount) / BOOK_AMOUNT_SCALE),
    format: (apiUnits) => formatMoney(apiUnits, cur),
    multiple: (apiUnits) => (bet > 0 ? apiUnits / bet : 0),
    get currency() {
      return cur;
    },
    get social() {
      return soc;
    },
    configure: (opts) => {
      if (opts.currency) cur = opts.currency.toUpperCase();
      if (opts.social !== undefined) soc = opts.social;
    },
  };
};
