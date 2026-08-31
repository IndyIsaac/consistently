/**
 * Currency is always written with its symbol and grouping — `฿1,000`, `£10`.
 * Never abbreviated to `1k`: an abbreviated forfeit reads as a score rather than
 * a debt. (DESIGN.md, Type.)
 */
const SYMBOLS: Record<string, string> = {
  THB: "฿",
  GBP: "£",
  USD: "$",
  USDC: "$",
  EUR: "€",
  JPY: "¥",
};

/**
 * The currencies a stake can be set in, and the one place that decides.
 *
 * This was three lists that disagreed: the form's own array, the symbols
 * above, and `z.string().length(3)` on POST /api/pacts -- which is a length,
 * not a set. USDC is four characters and is what the form opens on, so the
 * commonest pact anybody could make was refused before it reached the
 * database. Reading the codes off SYMBOLS means a currency exists exactly
 * when it can be written, which is the only definition that cannot drift.
 */
export const CURRENCIES = Object.keys(SYMBOLS);

export function isSupportedCurrency(currency: string): boolean {
  return currency.toUpperCase() in SYMBOLS;
}

const GROUPED = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
/**
 * The same grouping, to the cent.
 *
 * Rounding to whole units is right for the currency this product was written
 * against -- ฿1,000, where the satang are noise nobody agreed on. It is wrong
 * the moment the crew stakes in USDC: a dollar each rounded to "$1" is
 * survivable, forty cents rounded to "$0" is a staking product telling four
 * people they have staked nothing.
 */
const TO_THE_CENT = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function currencySymbol(currency: string): string {
  const code = currency.toUpperCase();
  return SYMBOLS[code] ?? `${code} `;
}

/** `formatMoney(3333, "THB")` -> `"฿3,333"`. Always unsigned; the sign is carried
 *  by where the figure sits and by the one colour it is allowed. */
export function formatMoney(amount: number, currency: string): string {
  // Whole amounts stay whole: ฿1,000 is what the crew agreed and what it should
  // read as. Anything with a fraction is written out, because the alternative
  // is rounding somebody's stake away in front of them.
  //
  // Dust is the exception, and it is deliberate. One atomic unit of USDC is
  // ฿0.000035, and "฿0.00" is a more precise way of saying the same nothing
  // that "฿0" says more plainly -- see the shortfall message in lib/stake.ts,
  // which exists to tell somebody that what arrived was not a stake.
  const size = Math.abs(amount);
  if (Number.isInteger(size)) return `${currencySymbol(currency)}${GROUPED.format(size)}`;

  const cents = TO_THE_CENT.format(size);
  const written = cents === TO_THE_CENT.format(0) ? GROUPED.format(0) : cents;
  return `${currencySymbol(currency)}${written}`;
}
