import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/db";

describe("data model", () => {
  it("creates a pact with a member and a session", async () => {
    const user = await prisma.user.create({
      data: {
        privyId: `test-${Date.now()}`,
        walletAddress: `wallet-${Date.now()}`,
        displayName: "Test",
      },
    });

    const pact = await prisma.pact.create({
      data: {
        name: "Five day fitness",
        inviteToken: `tok-${Date.now()}`,
        createdById: user.id,
        ruleConfig: { cadence: 5, period: "week" },
        stakeAmount: "1000",
        stakeCurrency: "THB",
        fxRateToUsd: "0.0285",
        fxFetchedAt: new Date(),
        stakeUsdc: 28_500_000n,
        vaultAddress: "vault-addr",
        vaultSecretEnc: "enc",
      },
    });

    const m = await prisma.membership.create({
      data: { pactId: pact.id, userId: user.id, status: "staked" },
    });

    const s = await prisma.session.create({
      data: { membershipId: m.id, startedAt: new Date(), dayKey: "2026-08-25" },
    });

    expect(pact.stakeUsdc).toBe(28_500_000n);
    expect(s.membershipId).toBe(m.id);

    await prisma.pact.delete({ where: { id: pact.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});
