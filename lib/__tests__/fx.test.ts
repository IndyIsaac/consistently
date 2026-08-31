import { describe, it, expect } from "vitest";
import { fetchUsdRate, fromUsdcAtomic, toUsdcAtomic } from "@/lib/fx";

describe("fx", () => {
  it("returns 1 for USD", async () => {
    expect(await fetchUsdRate("USD")).toBe(1);
  });

  it("returns a plausible THB rate", async () => {
    const r = await fetchUsdRate("THB");
    expect(r).toBeGreaterThan(0.01);
    expect(r).toBeLessThan(0.1);
  });

  it("converts 1000 THB at 0.0285 to 28.5 USDC in atomic units", () => {
    expect(toUsdcAtomic(1000, 0.0285)).toBe(28_500_000n);
  });

  it("rounds to the nearest atomic unit", () => {
    expect(toUsdcAtomic(1, 0.0285123456)).toBe(28_512n);
  });
});

describe("fromUsdcAtomic", () => {
  it("is the inverse of toUsdcAtomic", () => {
    expect(fromUsdcAtomic(28_500_000n, 0.0285)).toBeCloseTo(1000, 6);
  });

  it("returns USDC unchanged at a rate of 1", () => {
    expect(fromUsdcAtomic(1_500_000n, 1)).toBe(1.5);
  });

  it("does not round, so a sum of shares does not drift", () => {
    // A 28.5 USDC pot split three ways: each share is 9.5 USDC exactly, but at
    // a THB rate the terms are irrational. Rounding here would lose baht.
    const share = fromUsdcAtomic(9_500_000n, 0.0285);
    expect(share * 3).toBeCloseTo(1000, 6);
  });
});
