import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
import { openSession, closeSession, POST } from "@/app/api/pacts/[id]/sessions/route";
import { prisma } from "@/lib/db";
import { createVault } from "@/lib/vault";

async function fixture() {
  const stamp = crypto.randomUUID();
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
      // Checking in is only possible once the crew has paid, which is what the
      // product means by a pact running. These cases are all about what a
      // session does, so they start from the state that allows one.
      status: "active",
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
    // The fixture's rule has a 30-minute minimum and closeSession now refuses
    // anything short of it, so the first close has to be a real one: without
    // back-dating, this asserted "already closed" against a session that was
    // never closed in the first place.
    await prisma.session.update({
      where: { id: sessionId },
      data: { startedAt: new Date(Date.now() - 45 * 60_000) },
    });
    await closeSession({ sessionId, photoUrl: null });
    await expect(closeSession({ sessionId, photoUrl: null })).rejects.toThrow(/already closed/i);
    await prisma.pact.delete({ where: { id: pact.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });

  it("refuses a check-out short of the rule's minimum, and says how much longer", async () => {
    const { user, pact } = await fixture();
    const { sessionId } = await openSession({
      pactId: pact.id, userWallet: user.walletAddress, photoUrl: null,
    });
    await prisma.session.update({
      where: { id: sessionId },
      data: { startedAt: new Date(Date.now() - 14 * 60_000) },
    });
    await expect(closeSession({ sessionId, photoUrl: null })).rejects.toThrow(
      "That’s 14 minutes. The pact says 30. Sixteen to go.",
    );
    await prisma.pact.delete({ where: { id: pact.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });

  it("leaves the session open and writes no feed row when it refuses", async () => {
    // A refusal that half-recorded the check-out would be worse than none: the
    // member could not try again, and the channel would carry a check-out that
    // never happened.
    const { user, pact } = await fixture();
    const { sessionId } = await openSession({
      pactId: pact.id, userWallet: user.walletAddress, photoUrl: null,
    });
    await prisma.session.update({
      where: { id: sessionId },
      data: { startedAt: new Date(Date.now() - 5 * 60_000) },
    });
    await expect(closeSession({ sessionId, photoUrl: "https://x/end.jpg" })).rejects.toThrow();

    const after = await prisma.session.findUniqueOrThrow({ where: { id: sessionId } });
    expect(after.endedAt).toBeNull();
    expect(after.endPhotoUrl).toBeNull();
    expect(await prisma.feedItem.count({ where: { pactId: pact.id, type: "checkout" } })).toBe(0);

    // ...and the same session closes cleanly once the minimum is behind it.
    await prisma.session.update({
      where: { id: sessionId },
      data: { startedAt: new Date(Date.now() - 31 * 60_000) },
    });
    const { durationMins } = await closeSession({ sessionId, photoUrl: null });
    expect(durationMins).toBeGreaterThanOrEqual(30);
    expect(await prisma.feedItem.count({ where: { pactId: pact.id, type: "checkout" } })).toBe(1);

    await prisma.pact.delete({ where: { id: pact.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });

  it("accepts a check-out exactly on the minimum", async () => {
    // The boundary: `isValidSession` counts a session of exactly minDurationMins,
    // so the API must not refuse one. Off by one here costs someone ฿1,000.
    const { user, pact } = await fixture();
    const { sessionId } = await openSession({
      pactId: pact.id, userWallet: user.walletAddress, photoUrl: null,
    });
    await prisma.session.update({
      where: { id: sessionId },
      data: { startedAt: new Date(Date.now() - 30 * 60_000) },
    });
    const { durationMins } = await closeSession({ sessionId, photoUrl: null });
    expect(durationMins).toBe(30);
    await prisma.pact.delete({ where: { id: pact.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });

  it("records a short check-out when the rule sets no minimum", async () => {
    // A pact with minDurationMins: null has nothing to enforce, and the refusal
    // must not invent a rule the crew never agreed.
    const { user, pact } = await fixture();
    await prisma.pact.update({
      where: { id: pact.id },
      data: {
        ruleConfig: {
          cadence: 5, period: "week", sessionType: "checkin_checkout", minDurationMins: null,
          windowStart: "00:00", windowEnd: "23:59", proof: "photo",
          failsWhenMissedExceeds: 0, split: "equal", exemption: "majority", durationPeriods: 4,
        },
      },
    });
    const { sessionId } = await openSession({
      pactId: pact.id, userWallet: user.walletAddress, photoUrl: null,
    });
    const { durationMins } = await closeSession({ sessionId, photoUrl: null });
    expect(durationMins).toBe(0);
    await prisma.pact.delete({ where: { id: pact.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });

  it("refuses an unsigned caller rather than closing somebody else's session", async () => {
    /**
     * This route used to take `sessionId` on trust, so anybody could close a
     * session another member was still inside -- and a check-out time decides
     * whether their day counted, which decides whose stake moves.
     *
     * It asserted a 400 before, because there was no authentication to fail
     * first. A refusal still has to travel as a refusal: what must never
     * happen is the 500 that carries a Prisma message with absolute paths and
     * a snippet of the calling code in it.
     */
    const { user, pact } = await fixture();
    const { sessionId } = await openSession({
      pactId: pact.id, userWallet: user.walletAddress, photoUrl: null,
    });
    const req = new NextRequest(`http://localhost/api/pacts/${pact.id}/sessions`, {
      method: "POST",
      body: JSON.stringify({ action: "close", sessionId }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: pact.id }) });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(typeof body.error).toBe("string");
    expect(body.error).not.toMatch(/prisma|invocation|\.ts:/i);

    await prisma.pact.delete({ where: { id: pact.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });
});
