import { describe, it, expect } from "vitest";
import { fetchUsdRate, toUsdcAtomic } from "@/lib/fx";

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
