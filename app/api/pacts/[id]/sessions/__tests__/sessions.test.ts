import { describe, it, expect, vi } from "vitest";
import { openSession, closeSession } from "@/app/api/pacts/[id]/sessions/route";
import { prisma } from "@/lib/db";
import { createVault } from "@/lib/vault";

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
    await prisma.pact.delete({ where: { id: pact.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });

  it("keys the session to the pact's timezone, not UTC, across the day boundary", async () => {
    const { user, pact } = await fixture();
    // Bangkok (pact.timezone default, UTC+7) and UTC only disagree on the
    // calendar date between 17:00 and 24:00 UTC. Pin the clock inside that
    // window so a hardcoded-UTC implementation would produce a *different*
    // (wrong) string than the pact-timezone-aware one -- re-deriving the
    // expected value from real "now" through dayKeyFor itself only catches
    // this bug ~29% of the time, since outside that window UTC and Bangkok
    // agree regardless of which one the implementation actually uses.
    // 2026-08-25T17:30:00.000Z is 2026-08-26 00:30 in Asia/Bangkok, so the
    // correct dayKey is 2026-08-26; a UTC implementation would record
    // 2026-08-25.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-25T17:30:00.000Z"));
    let sessionId: string;
    try {
      ({ sessionId } = await openSession({
        pactId: pact.id, userWallet: user.walletAddress, photoUrl: null,
      }));
    } finally {
      vi.useRealTimers();
    }
    const s = await prisma.session.findUniqueOrThrow({ where: { id: sessionId } });
    expect(s.dayKey).toBe("2026-08-26");
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

  it("refuses to close an already-closed session", async () => {
    const { user, pact } = await fixture();
    const { sessionId } = await openSession({
      pactId: pact.id, userWallet: user.walletAddress, photoUrl: null,
    });
    await closeSession({ sessionId, photoUrl: null });
    await expect(closeSession({ sessionId, photoUrl: null })).rejects.toThrow(/already closed/i);
    await prisma.pact.delete({ where: { id: pact.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });
});
