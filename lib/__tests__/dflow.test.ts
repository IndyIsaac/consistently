import { describe, it, expect } from "vitest";
import { getQuote, buildOrder, USDC_MINT, WSOL_MINT } from "@/lib/dflow";

describe("dflow client", () => {
  it("quotes SOL to USDC against mainnet liquidity", async () => {
    const q = await getQuote({
      inputMint: WSOL_MINT,
      outputMint: USDC_MINT,
      amount: 1_000_000_000n,
      slippageBps: 50,
    });

    expect(q.inputMint).toBe(WSOL_MINT);
    expect(q.outputMint).toBe(USDC_MINT);
    expect(BigInt(q.outAmount)).toBeGreaterThan(0n);
    expect(q.routePlan?.length).toBeGreaterThan(0);
    expect(q.transaction).toBeUndefined();
  });

  it("returns a signable transaction when given a user public key", async () => {
    const o = await buildOrder({
      inputMint: WSOL_MINT,
      outputMint: USDC_MINT,
      amount: 10_000_000n,
      userPublicKey: "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9",
      slippageBps: 50,
    });

    expect(typeof o.transaction).toBe("string");
    expect(o.transaction!.length).toBeGreaterThan(100);
    expect(o.lastValidBlockHeight).toBeGreaterThan(0);
  });

  it("throws a readable error for an impossible route", async () => {
    await expect(
      getQuote({
        inputMint: USDC_MINT,
        outputMint: USDC_MINT,
        amount: 1_000_000n,
      }),
    ).rejects.toThrow(/dflow/i);
  });
});
