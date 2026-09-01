import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { createVault } from "@/lib/vault";
import { livePact } from "@/lib/queries";

/* ---------------------------------------------------------------------------
 * The check-in route, from both sides of the guard.
 *
 * The route now verifies the caller and refuses a `userWallet` or a
 * `sessionId` that is not theirs -- a check-in decides who kept the cadence,
 * and an early check-out decides whether a day counted, so both decide whose
 * stake moves.
 *
 * Proving a forged post is refused is the easy half and does not on its own
 * show the route still works: a guard that refuses everybody would pass that
 * test. So the important case here is the honest one -- a signed-in member
 * checking themselves in, which is what the whole product does.
 *
 * Only the authentication boundary is stubbed. Everything past it -- the pact
 * status guard, the open-session check, the row that gets written -- is the
 * real thing against the real database.
 * ------------------------------------------------------------------------- */

/** Who `requireUser` should say is calling, or null for nobody. */
const caller: { current: { id: string; walletAddress: string } | null } = { current: null };

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...actual,
    requireUser: async () => {
      if (!caller.current) throw new actual.UnauthorizedError("Not signed in");
      return caller.current;
    },
  };
});

const { openSession, POST } = await import("@/app/api/pacts/[id]/sessions/route");

async function fixture() {
  const stamp = crypto.randomUUID();
  const user = await prisma.user.create({
    data: { privyId: `p-${stamp}`, walletAddress: `w-${stamp}`, displayName: "Tester" },
  });
  const vault = createVault();
  const pact = await prisma.pact.create({
    data: {
      name: "T",
      inviteToken: `t-${stamp}`,
      createdById: user.id,
      ruleConfig: {
        cadence: 5,
        period: "week",
        sessionType: "checkin_checkout",
        minDurationMins: 30,
        windowStart: "00:00",
        windowEnd: "23:59",
        proof: "photo",
        failsWhenMissedExceeds: 0,
        split: "equal",
        exemption: "majority",
        durationPeriods: 4,
      },
      stakeAmount: "1000",
      stakeCurrency: "THB",
      fxRateToUsd: "0.0285",
      fxFetchedAt: new Date(),
      stakeUsdc: 28_500_000n,
      vaultAddress: vault.publicKey,
      vaultSecretEnc: vault.secretEnc,
      status: "active",
      memberships: { create: { userId: user.id, status: "staked" } },
    },
  });
  return { user, pact };
}

function post(pactId: string, body: unknown) {
  const req = new NextRequest(`http://localhost/api/pacts/${pactId}/sessions`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return POST(req, { params: Promise.resolve({ id: pactId }) });
}

async function cleanup(pactId: string, userId: string) {
  await prisma.pact.delete({ where: { id: pactId } });
  await prisma.user.delete({ where: { id: userId } });
}

describe("checking in, now that the route checks who is asking", () => {
  beforeEach(() => {
    caller.current = null;
  });

  it("still lets a signed-in member check themselves in", async () => {
    // The case the guard exists to leave alone, and the one a demo depends on.
    const { user, pact } = await fixture();
    caller.current = user;

    const res = await post(pact.id, { action: "open", userWallet: user.walletAddress });
    expect(res.status).toBe(200);

    const { sessionId } = await res.json();
    expect(typeof sessionId).toBe("string");

    const stored = await prisma.session.findUnique({
      where: { id: sessionId },
      select: { membership: { select: { userId: true } } },
    });
    expect(stored?.membership.userId).toBe(user.id);

    await cleanup(pact.id, user.id);
  });

  it("lets a member check themselves in without naming a wallet at all", async () => {
    // The wallet is taken from the verified caller, so the body need not carry
    // one -- and when it does not, there is nothing left to forge.
    const { user, pact } = await fixture();
    caller.current = user;

    const res = await post(pact.id, { action: "open" });
    expect(res.status).toBe(200);

    await cleanup(pact.id, user.id);
  });

  it("refuses a check-in posted on somebody else's behalf", async () => {
    const { user, pact } = await fixture();
    const other = await fixture();
    caller.current = user;

    const res = await post(pact.id, { action: "open", userWallet: other.user.walletAddress });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("That is not your wallet.");

    await cleanup(other.pact.id, other.user.id);
    await cleanup(pact.id, user.id);
  });

  it("refuses closing a session that belongs to somebody else", async () => {
    // Worse than the above: a check-out time decides whether their day counted.
    const mine = await fixture();
    const theirs = await fixture();

    caller.current = theirs.user;
    const { sessionId } = await openSession({
      pactId: theirs.pact.id,
      userWallet: theirs.user.walletAddress,
      photoUrl: null,
    });

    caller.current = mine.user;
    const res = await post(mine.pact.id, { action: "close", sessionId });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("That is not your session.");

    await cleanup(theirs.pact.id, theirs.user.id);
    await cleanup(mine.pact.id, mine.user.id);
  });

  it("hands an already-open session back to the next page load", async () => {
    /**
     * The regression that made this worth a database test.
     *
     * The screen kept the open session in component state and nothing else, so
     * leaving the page -- the Groups link, a reload, a phone discarding a
     * backgrounded tab across a thirty-minute rule -- lost it. The button read
     * "Check in" again, the guard refused because the row was still open, and
     * check-out is keyed by an id the client had thrown away. The orphan then
     * blocked every check-in for the rest of the pact, because that guard's
     * lookup is not scoped to a day.
     *
     * So this asserts the whole round trip rather than the shape of a type:
     * open a session, then read the pact exactly as the page does, and require
     * the id and the start time to come back.
     */
    const { user, pact } = await fixture();
    caller.current = user;

    const { sessionId } = await openSession({
      pactId: pact.id,
      userWallet: user.walletAddress,
      photoUrl: null,
    });

    const view = await livePact(pact.id, user, new Date());
    expect(view?.viewerOpenSession?.sessionId).toBe(sessionId);
    // The elapsed timer counts from this, so a missing or zero value would
    // render as a session that started at the epoch.
    expect(view?.viewerOpenSession?.startedAt).toBeGreaterThan(0);

    await cleanup(pact.id, user.id);
  });

  it("carries nothing once the session is checked out", async () => {
    const { user, pact } = await fixture();
    caller.current = user;

    const { sessionId } = await openSession({
      pactId: pact.id,
      userWallet: user.walletAddress,
      photoUrl: null,
    });
    // The fixture's rule asks for thirty minutes and the route enforces it at
    // the moment of the attempt, so an honest check-out needs a session that
    // has actually run that long.
    await prisma.session.update({
      where: { id: sessionId },
      data: { startedAt: new Date(Date.now() - 31 * 60_000) },
    });

    const res = await post(pact.id, { action: "close", sessionId });
    expect(res.status).toBe(200);

    const view = await livePact(pact.id, user, new Date());
    expect(view?.viewerOpenSession).toBeNull();

    await cleanup(pact.id, user.id);
  });

  it("refuses a caller who is not signed in at all", async () => {
    const { user, pact } = await fixture();
    // caller.current stays null.

    const res = await post(pact.id, { action: "open", userWallet: user.walletAddress });
    expect(res.status).toBe(401);

    await cleanup(pact.id, user.id);
  });
});
