import { describe, it, expect } from "vitest";
import { openSession, closeSession } from "@/app/api/pacts/[id]/sessions/route";
import { prisma } from "@/lib/db";
import { createVault } from "@/lib/vault";
import { dayKeyFor } from "@/lib/rules";

async function fixture() {
  const stamp = Date.now();
  const user = await prisma.user.create({
    data: { privyId: `p-${stamp}`, walletAddress: `w-${stamp}`, displayName: "Tester" },
  });
  const vault = createVault();
  const pact = await prisma.pact.create({
    data: {
      name: "T", inviteToken: `t-${stamp}`, createdById: user.id,
      ruleConfig: {
        cadence: 5, period: "week", sessionType: "checkin_checkout", minDurationMins: 30,
        windowStart: "00:00", windowEnd: "23:59", proof: "photo",
        failsWhenMissedExceeds: 0, split: "equal", exemption: "majority", durationPeriods: 4,
      },
      stakeAmount: "1000", stakeCurrency: "THB", fxRateToUsd: "0.0285",
      fxFetchedAt: new Date(), stakeUsdc: 28_500_000n,
      vaultAddress: vault.publicKey, vaultSecretEnc: vault.secretEnc,
      memberships: { create: { userId: user.id, status: "staked" } },
    },
  });
  return { user, pact };
}

describe("sessions", () => {
  it("opens a session and records the day it started", async () => {
    const { user, pact } = await fixture();
    const { sessionId } = await openSession({
      pactId: pact.id, userWallet: user.walletAddress, photoUrl: "https://x/1.jpg",
    });
    const s = await prisma.session.findUniqueOrThrow({ where: { id: sessionId } });
    expect(s.dayKey).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(s.endedAt).toBeNull();
    // The dayKey must come from dayKeyFor applied to the pact's timezone (not a UTC
    // date or the server's local zone) -- recompute from the persisted startedAt and
    // the pact's own timezone so this fails if the implementation derives dayKey any
    // other way.
    expect(s.dayKey).toBe(dayKeyFor(s.startedAt, pact.timezone));
    await prisma.pact.delete({ where: { id: pact.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });

  it("refuses to open a second session while one is open", async () => {
    const { user, pact } = await fixture();
    await openSession({ pactId: pact.id, userWallet: user.walletAddress, photoUrl: null });
    await expect(
      openSession({ pactId: pact.id, userWallet: user.walletAddress, photoUrl: null }),
    ).rejects.toThrow(/already open/i);
    await prisma.pact.delete({ where: { id: pact.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });

  it("closes a session and reports its duration", async () => {
    const { user, pact } = await fixture();
    const { sessionId } = await openSession({
      pactId: pact.id, userWallet: user.walletAddress, photoUrl: null,
    });
    await prisma.session.update({
      where: { id: sessionId },
      data: { startedAt: new Date(Date.now() - 45 * 60_000) },
    });
    const { durationMins } = await closeSession({ sessionId, photoUrl: null });
    expect(durationMins).toBeGreaterThanOrEqual(44);
    await prisma.pact.delete({ where: { id: pact.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });
});
