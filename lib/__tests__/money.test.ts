import { describe, expect, it } from "vitest";
import { CURRENCIES, isSupportedCurrency } from "@/lib/money";

/* ---------------------------------------------------------------------------
 * Which currencies a pact may be denominated in.
 *
 * This existed in three places that disagreed. components/NewPact.tsx offered
 * six in a list of its own; lib/money.ts knew the same six, by their symbols;
 * and POST /api/pacts accepted `z.string().length(3)` -- which is not a set of
 * currencies at all, it is a length. USDC is four characters and is the form's
 * default, so the commonest pact anybody could create was rejected before it
 * reached the database, and the 400 said nothing a member could read.
 * ------------------------------------------------------------------------- */

describe("the currencies a stake can be set in", () => {
  it("accepts USDC, which is the default and is four characters", () => {
    expect(isSupportedCurrency("USDC")).toBe(true);
  });

  it("accepts every currency the form offers", () => {
    for (const code of CURRENCIES) expect(isSupportedCurrency(code)).toBe(true);
  });

  it("does not care about case", () => {
    expect(isSupportedCurrency("usdc")).toBe(true);
  });

  it("refuses one it has no symbol for", () => {
    expect(isSupportedCurrency("XYZ")).toBe(false);
  });
});
