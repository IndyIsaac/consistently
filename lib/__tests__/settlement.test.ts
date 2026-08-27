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

describe("settlePact period guard", () => {
  it("refuses to judge a period that is still running", async () => {
    const { prisma } = await import("@/lib/db");
    const { settlePact, SettlementError } = await import("@/lib/settlement");
    const { periodDayKeys } = await import("@/lib/pact-view");
    const { createVault } = await import("@/lib/vault");

    const stamp = Date.now();
    const user = await prisma.user.create({
      data: { privyId: `guard-${stamp}`, walletAddress: `guard-w-${stamp}`, displayName: "G" },
    });
    const vault = createVault();
    const rule = {
      cadence: 5,
      period: "week" as const,
      sessionType: "checkin_checkout" as const,
      minDurationMins: 30,
      windowStart: "05:00",
      windowEnd: "22:00",
      proof: "photo" as const,
      failsWhenMissedExceeds: 0,
      split: "equal" as const,
      exemption: "majority" as const,
      durationPeriods: 12,
    };

    const pact = await prisma.pact.create({
      data: {
        name: "Guard", inviteToken: `g-${stamp}`, createdById: user.id, ruleConfig: rule,
        stakeAmount: "1000", stakeCurrency: "THB", fxRateToUsd: "0.0285",
        fxFetchedAt: new Date(), stakeUsdc: 28_500_000n,
        vaultAddress: vault.publicKey, vaultSecretEnc: vault.secretEnc, status: "active",
        memberships: { create: { userId: user.id, status: "staked" } },
      },
    });

    const now = new Date();
    const thisPeriod = periodDayKeys(rule, "Asia/Bangkok", now)[0];

    // Nobody has met a five-a-week cadence mid-week. Settling here would mark
    // the whole crew failed and burn the mutex that stops a correct re-run.
    await expect(settlePact(pact.id, thisPeriod, now)).rejects.toThrow(SettlementError);
    expect(await prisma.settlement.count({ where: { pactId: pact.id } })).toBe(0);

    const after = await prisma.membership.findFirstOrThrow({ where: { pactId: pact.id } });
    expect(after.status).toBe("staked");

    await prisma.pact.delete({ where: { id: pact.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });
});
