import { describe, it, expect } from "vitest";
import { splitPot, SettlementRecordSchema, readSettlement } from "@/lib/settlement";

describe("splitPot", () => {
  it("splits one failed stake between three winners", () => {
    const r = splitPot({ failedStakes: [28_500_000n], winnerIds: ["a", "b", "c"] });
    expect(r).toEqual([
      { winnerId: "a", amount: 9_500_000n },
      { winnerId: "b", amount: 9_500_000n },
      { winnerId: "c", amount: 9_500_000n },
    ]);
  });

  it("gives the indivisible remainder to the first winner, losing nothing", () => {
    const r = splitPot({ failedStakes: [10n], winnerIds: ["a", "b", "c"] });
    expect(r.map((p) => p.amount)).toEqual([4n, 3n, 3n]);
    expect(r.reduce((s, p) => s + p.amount, 0n)).toBe(10n);
  });

  it("sums multiple failed stakes", () => {
    const r = splitPot({ failedStakes: [100n, 200n], winnerIds: ["a", "b"] });
    expect(r.map((p) => p.amount)).toEqual([150n, 150n]);
  });

  it("returns nothing when nobody failed", () => {
    expect(splitPot({ failedStakes: [], winnerIds: ["a", "b"] })).toEqual([]);
  });

  it("returns nothing when everybody failed", () => {
    // The pot has nowhere to go. The money stays in the vault rather than
    // being invented a recipient for.
    expect(splitPot({ failedStakes: [100n], winnerIds: [] })).toEqual([]);
  });
});

describe("SettlementRecordSchema", () => {
  const record = {
    periodKey: "2026-08-24",
    stakeUsdc: "28500000",
    potUsdc: "28500000",
    failed: [{ membershipId: "m_dave", stakeUsdc: "28500000" }],
    payouts: [
      {
        membershipId: "m_indy",
        principalUsdc: "28500000",
        shareUsdc: "9500000",
        payoutMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        signature: null,
      },
    ],
  };

  it("accepts a well-formed record", () => {
    expect(() => SettlementRecordSchema.parse(record)).not.toThrow();
  });

  it("rejects a numeric amount, which would lose precision", () => {
    const bad = { ...record, stakeUsdc: 28_500_000 };
    expect(() => SettlementRecordSchema.parse(bad)).toThrow();
  });

  it("rejects an amount that is not a whole number of atomic units", () => {
    expect(() => SettlementRecordSchema.parse({ ...record, stakeUsdc: "28.5" })).toThrow();
  });
});

describe("readSettlement", () => {
  const rate = 0.0285; // THB locked at pact creation

  const record = {
    periodKey: "2026-08-24",
    stakeUsdc: "28500000",
    potUsdc: "28500000",
    failed: [{ membershipId: "m_dave", stakeUsdc: "28500000" }],
    payouts: [
      {
        membershipId: "m_indy",
        principalUsdc: "28500000",
        shareUsdc: "9500000",
        payoutMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        signature: "sig1",
      },
    ],
  };

  it("reads a member's share back in the pact's own currency", () => {
    const r = readSettlement(record, rate);
    expect(r.shareFor("m_indy")).toBeCloseTo(333.33, 1);
  });

  it("returns nothing for a member who took no payout", () => {
    expect(readSettlement(record, rate).shareFor("m_nat")).toBe(0);
  });

  it("names who forfeited and what it cost them", () => {
    const r = readSettlement(record, rate);
    expect(r.forfeitedBy("m_dave")).toBeCloseTo(1000, 6);
    expect(r.forfeitedBy("m_indy")).toBe(0);
  });

  it("tolerates a legacy record written before the schema widened", () => {
    // Settlements written by an earlier build carry only {memberId, amount}.
    // They must not throw the whole dashboard -- they simply report nothing.
    const legacy = [{ memberId: "m_indy", amount: "9500000", signature: null }];
    const r = readSettlement(legacy, rate);
    expect(r.shareFor("m_indy")).toBe(0);
    expect(r.forfeitedBy("m_dave")).toBe(0);
  });
});
