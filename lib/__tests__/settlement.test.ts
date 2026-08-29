import { describe, it, expect } from "vitest";
import {
  periodToSettle,
  splitPot,
  SettlementError,
  SettlementRecordSchema,
  readSettlement,
  settlementLine,
} from "@/lib/settlement";
import type { RuleConfig } from "@/lib/rules";

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

describe("settlementLine", () => {
  it("names the token each winner was paid in, because that is the DFlow story", () => {
    const line = settlementLine({
      winners: [
        { displayName: "Nam", amountUsdc: 1_500_000n, payoutMint: "So11111111111111111111111111111111111111112" },
        { displayName: "Indy", amountUsdc: 1_500_000n, payoutMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" },
      ],
      usdRate: 1,
      currency: "USD",
    });
    expect(line).toContain("Nam");
    expect(line).toContain("SOL");
    expect(line).toContain("Indy");
    expect(line).toContain("USDC");
  });

  it("reports in the crew's own currency, not USD -- the vault holds USDC either way", () => {
    // A ฿1,000 stake (28,500,000 atomic at the pact's locked 0.0285 rate).
    // USD is the one currency where a missing conversion is invisible, so
    // this has to be the case that proves the rate and symbol are both used.
    const line = settlementLine({
      winners: [
        { displayName: "Nam", amountUsdc: 28_500_000n, payoutMint: "So11111111111111111111111111111111111111112" },
      ],
      usdRate: 0.0285,
      currency: "THB",
    });
    expect(line).toBe("Nam took ฿1,000 in SOL.");
  });

  it("reports nothing moving when nobody won", () => {
    expect(settlementLine({ winners: [], usdRate: 1, currency: "USD" })).toBe(
      "Nobody missed. Nothing moved.",
    );
  });
});

/* ---------------------------------------------------------------------------
 * Which period a bare `/settle` means.
 *
 * The one the crew is in cannot be it: that period is still running, the guard
 * refuses it, and a `/settle` that can only ever be refused funnels every
 * member into `/settle force` -- the destructive command -- to get anything to
 * happen at all. So the safe command has to name a period that is genuinely
 * over, which is what "close the week that just ended" meant all along.
 * ------------------------------------------------------------------------- */
describe("periodToSettle", () => {
  const week: RuleConfig = {
    cadence: 5, period: "week", sessionType: "checkin_checkout", minDurationMins: 30,
    windowStart: "05:00", windowEnd: "22:00", proof: "photo",
    failsWhenMissedExceeds: 0, split: "equal", exemption: "majority", durationPeriods: 12,
  };
  const day: RuleConfig = { ...week, period: "day", cadence: 1 };

  // Friday 2026-08-28 in Asia/Bangkok. The crew is in the week of Monday the
  // 24th; the week that just ended began Monday the 17th.
  const now = new Date("2026-08-28T10:00:00.000Z");
  const tz = "Asia/Bangkok";
  const began = new Date("2026-07-01T00:00:00.000Z");

  it("means the week that just ended, not the one the crew is in", () => {
    const key = periodToSettle({ rule: week, timezone: tz, now, began, settled: [] });
    expect(key).toBe("2026-08-17");
    // The destructive one, stated so a refactor cannot quietly return it.
    expect(key).not.toBe("2026-08-24");
  });

  it("skips back over weeks that are already settled", () => {
    expect(
      periodToSettle({ rule: week, timezone: tz, now, began, settled: ["2026-08-17"] }),
    ).toBe("2026-08-10");
    expect(
      periodToSettle({ rule: week, timezone: tz, now, began, settled: ["2026-08-17", "2026-08-10"] }),
    ).toBe("2026-08-03");
  });

  it("does the same arithmetic a day at a time for a daily rule", () => {
    expect(periodToSettle({ rule: day, timezone: tz, now, began, settled: [] })).toBe("2026-08-27");
    expect(
      periodToSettle({ rule: day, timezone: tz, now, began, settled: ["2026-08-27"] }),
    ).toBe("2026-08-26");
  });

  it("refuses a pact that has not finished a period yet, rather than reaching back past it", () => {
    // The demo case: a pact created minutes ago. The week before it existed is
    // one nobody could have checked into, so settling it would mark the whole
    // crew failed for a week that was never theirs.
    expect(() =>
      periodToSettle({
        rule: week, timezone: tz, now, settled: [],
        began: new Date("2026-08-25T09:00:00.000Z"),
      }),
    ).toThrow(SettlementError);
    expect(() =>
      periodToSettle({
        rule: week, timezone: tz, now, settled: [],
        began: new Date("2026-08-25T09:00:00.000Z"),
      }),
    ).toThrow(/has not finished a week yet/);
  });

  it("counts the period the pact began in as the crew's own", () => {
    // Began Wednesday of the week of the 17th: that week is finished and it is
    // theirs, so it settles rather than being treated as before their time.
    expect(
      periodToSettle({
        rule: week, timezone: tz, now, settled: [],
        began: new Date("2026-08-19T09:00:00.000Z"),
      }),
    ).toBe("2026-08-17");
  });

  it("says so when every finished period is already settled", () => {
    expect(() =>
      periodToSettle({
        rule: week, timezone: tz, now,
        began: new Date("2026-08-11T00:00:00.000Z"),
        settled: ["2026-08-17", "2026-08-10"],
      }),
    ).toThrow(/Every week that has ended is settled/);
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
