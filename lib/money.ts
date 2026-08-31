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

export function currencySymbol(currency: string): string {
  const code = currency.toUpperCase();
  return SYMBOLS[code] ?? `${code} `;
}

/** `formatMoney(3333, "THB")` -> `"฿3,333"`. Always unsigned; the sign is carried
 *  by where the figure sits and by the one colour it is allowed. */
export function formatMoney(amount: number, currency: string): string {
  return `${currencySymbol(currency)}${GROUPED.format(Math.abs(Math.round(amount)))}`;
}
