export async function fetchUsdRate(currency: string): Promise<number> {
  const code = currency.toUpperCase();
  if (code === "USD" || code === "USDC") return 1;

  const res = await fetch(`https://api.frankfurter.app/latest?from=${code}&to=USD`);
  if (!res.ok) throw new Error(`FX lookup failed for ${code}: ${res.status}`);

  const body = (await res.json()) as { rates?: Record<string, number> };
  const rate = body.rates?.USD;
  if (typeof rate !== "number") throw new Error(`No USD rate returned for ${code}`);
  return rate;
}

/** USDC has 6 decimals. Rounds half-up to the nearest atomic unit. */
export function toUsdcAtomic(amount: number, usdRate: number): bigint {
  return BigInt(Math.round(amount * usdRate * 1_000_000));
}

/**
 * The inverse of `toUsdcAtomic`: USDC atomic units back into the pact's own
 * currency.
 *
 * `usdRate` must be the rate stored on the pact at creation, never a fresh
 * lookup. A settlement that happened at last month's rate has to keep reporting
 * itself at last month's rate, or the ledger on the dashboard drifts every time
 * the page is opened.
 *
 * Returns an unrounded number. `formatMoney` does the rounding, so a sum of
 * several of these does not accumulate a rounding error per term.
 */
export function fromUsdcAtomic(atomic: bigint, usdRate: number): number {
  return Number(atomic) / 1_000_000 / usdRate;
}
