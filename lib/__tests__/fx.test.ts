import { afterEach, describe, it, expect, vi } from "vitest";
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

/* ---------------------------------------------------------------------------
 * The rate lookup is somebody else's API on the path that creates a pact.
 *
 * It had no timeout, so a third party that was slow rather than down held
 * POST /api/pacts open with no upper bound: the create form span, and there
 * was nothing to read and no end to it. Failing in five seconds is a
 * sentence; hanging is a demo.
 * ------------------------------------------------------------------------- */

describe("when the rate provider does not answer", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("gives up rather than waiting forever", async () => {
    // What `AbortSignal.timeout` throws when it fires.
    vi.stubGlobal("fetch", async () => {
      const e = new Error("The operation was aborted due to timeout");
      e.name = "TimeoutError";
      throw e;
    });

    await expect(fetchUsdRate("THB")).rejects.toThrow(/FX lookup failed for THB/);
  });

  it("asks for a signal at all, which is the whole fix", async () => {
    let sawSignal = false;
    vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
      sawSignal = init?.signal instanceof AbortSignal;
      return new Response(JSON.stringify({ rates: { USD: 0.03 } }), { status: 200 });
    });

    await fetchUsdRate("THB");
    expect(sawSignal).toBe(true);
  });

  it("still short-circuits the currencies that need no lookup", async () => {
    // No fetch stubbed on purpose: reaching one would be the bug.
    vi.stubGlobal("fetch", async () => {
      throw new Error("should not have been called");
    });
    expect(await fetchUsdRate("USDC")).toBe(1);
    expect(await fetchUsdRate("USD")).toBe(1);
  });
});
