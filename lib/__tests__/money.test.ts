import { describe, expect, it } from "vitest";
import { CURRENCIES, formatMoney, isSupportedCurrency } from "@/lib/money";

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

/* ---------------------------------------------------------------------------
 * How much it says you are staking.
 *
 * `formatMoney` rounded to whole units, which is right for the product's own
 * example -- ฿1,000, where the satang are noise -- and wrong the moment the
 * currency is USDC. A crew staking a dollar each read "$0 each · $0 on the
 * week · $0 to join" on a product whose entire subject is the money.
 * ------------------------------------------------------------------------- */

describe("writing an amount", () => {
  it("keeps whole amounts whole, and grouped", () => {
    expect(formatMoney(1000, "THB")).toBe("฿1,000");
    expect(formatMoney(1333, "THB")).toBe("฿1,333");
    expect(formatMoney(1, "USDC")).toBe("$1");
  });

  it("shows the cents when there are cents to show", () => {
    // The bug: this was "$0" on screen, on a staking product.
    expect(formatMoney(0.4, "USDC")).toBe("$0.40");
    expect(formatMoney(1.5, "USDC")).toBe("$1.50");
  });

  it("still says nothing is nothing", () => {
    expect(formatMoney(0, "USDC")).toBe("$0");
  });

  it("says dust is nothing, plainly", () => {
    // One atomic unit of USDC at a THB pact's rate. lib/stake.ts uses this to
    // tell somebody that what arrived was not a stake -- "฿0.00" would be a
    // more precise way of saying the same nothing.
    expect(formatMoney(0.000035, "THB")).toBe("฿0");
  });

  it("is unsigned -- the sign is carried by where the figure sits", () => {
    expect(formatMoney(-1.25, "USDC")).toBe("$1.25");
  });
});
