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
