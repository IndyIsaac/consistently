import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
import { Keypair } from "@solana/web3.js";
import type { User } from "@prisma/client";
import { POST } from "@/app/api/pacts/[id]/settle/route";
import { prisma } from "@/lib/db";
import { weekDayKeys } from "@/lib/pact-view";
import { createVault } from "@/lib/vault";

/* ---------------------------------------------------------------------------
 * `/settle`, from the channel.
 *
 * The database is real, as it is in every other route test here. The chain is
 * not: a settlement signs with the vault and the sponsor and broadcasts, and
 * none of that is what these tests are about. What they are about is the guard
 * -- an unfinished period is refused, unless the member said `force` -- and
 * that the refusal arrives as a sentence the member can read rather than as a
 * 500 that replaces it with "Settlement did not finish."
 * ------------------------------------------------------------------------- */

const signedIn = vi.hoisted(() => ({ user: null as User | null }));

vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  requireUser: async () => signedIn.user,
}));

vi.mock("@/lib/solana", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/solana")>();
  return {
    ...actual,
    loadSponsor: () => Keypair.generate(),
    getConnection: () => ({
      // The vault holds nothing anyone has to be paid out of. `settlePact`
      // already treats a missing token account as a zero balance, which is
      // what a vault nobody has staked into really looks like.
      getTokenAccountBalance: async () => {
        throw new Error("could not find account");
      },
    }),
  };
});

/**
 * A pact whose week nobody has done a thing towards.
 *
 * `began` moves both `createdAt` and `startsAt`, which is how old the crew is
 * as far as `/settle` is concerned. A pact that began this week has no
 * finished period behind it; one that began a fortnight ago has last week.
 */
async function fixture(began?: Date) {
  const stamp = crypto.randomUUID();
  const users = await Promise.all(
    [0, 1].map((i) =>
      prisma.user.create({
        data: {
          privyId: `p-${stamp}-${i}`,
          walletAddress: Keypair.generate().publicKey.toBase58(),
          displayName: `M${i}`,
        },
      }),
    ),
  );
  const vault = createVault();
  const pact = await prisma.pact.create({
    data: {
      name: "T", inviteToken: `t-${stamp}`, createdById: users[0].id,
      ruleConfig: {
        cadence: 5, period: "week", sessionType: "checkin_checkout", minDurationMins: 30,
        windowStart: "00:00", windowEnd: "23:59", proof: "photo",
        failsWhenMissedExceeds: 0, split: "equal", exemption: "majority", durationPeriods: 4,
      },
      stakeAmount: "1000", stakeCurrency: "THB", fxRateToUsd: "0.0285",
      fxFetchedAt: new Date(), stakeUsdc: 28_500_000n,
      vaultAddress: vault.publicKey, vaultSecretEnc: vault.secretEnc,
      ...(began ? { createdAt: began, startsAt: began, status: "active" as const } : {}),
      memberships: { create: users.map((u) => ({ userId: u.id, status: "staked" as const })) },
    },
  });
  signedIn.user = users[0];

  const cleanup = async () => {
    await prisma.pact.delete({ where: { id: pact.id } });
    await prisma.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
  };
  return { users, pact, cleanup };
}

function post(pactId: string, body: unknown) {
  const req = new NextRequest(`http://localhost/api/pacts/${pactId}/settle`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return POST(req, { params: Promise.resolve({ id: pactId }) });
}

/** A fortnight back, so the week before this one is finished and unsettled. */
const A_FORTNIGHT_AGO = () => new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

describe("settling from the channel", () => {
  // The test that could not exist before: every `/settle` was refused, because
  // the route defaulted to the period the crew was still in.
  it("closes the week that just ended, which is what a bare /settle means", async () => {
    const { pact, cleanup } = await fixture(A_FORTNIGHT_AGO());

    const res = await post(pact.id, {});
    expect(res.status).toBe(200);

    // Settled, and settled on the *previous* week -- not the live one.
    const previous = weekDayKeys(pact.timezone, new Date(Date.now() - 7 * 24 * 60 * 60 * 1000))[0];
    const current = weekDayKeys(pact.timezone, new Date())[0];
    const rows = await prisma.settlement.findMany({ where: { pactId: pact.id } });
    expect(rows.map((r) => r.periodKey)).toEqual([previous]);
    expect(rows[0].periodKey).not.toBe(current);

    await cleanup();
  });

  it("moves on to the week before once the last one is settled", async () => {
    const { pact, cleanup } = await fixture(new Date(Date.now() - 28 * 24 * 60 * 60 * 1000));
    const previous = weekDayKeys(pact.timezone, new Date(Date.now() - 7 * 24 * 60 * 60 * 1000))[0];
    await prisma.settlement.create({
      data: { pactId: pact.id, periodKey: previous, totalPotUsdc: 0n, payouts: {} },
    });

    const res = await post(pact.id, {});
    expect(res.status).toBe(200);

    const twoBack = weekDayKeys(pact.timezone, new Date(Date.now() - 14 * 24 * 60 * 60 * 1000))[0];
    expect(
      await prisma.settlement.findUnique({
        where: { pactId_periodKey: { pactId: pact.id, periodKey: twoBack } },
      }),
    ).not.toBeNull();
    await cleanup();
  });

  it("refuses a pact with no finished week behind it, rather than judging one it did not exist for", async () => {
    // The demo pact, created minutes before the demo. The week before it was
    // made is not the crew's to be marked failed for.
    const { pact, cleanup } = await fixture();
    const res = await post(pact.id, {});

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/has not finished a week yet/);
    expect(await prisma.settlement.count({ where: { pactId: pact.id } })).toBe(0);
    await cleanup();
  });

  it("treats force: false exactly as a bare /settle, with no shortcut to the live week", async () => {
    const { pact, cleanup } = await fixture();
    const res = await post(pact.id, { force: false });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/has not finished a week yet/);
    expect(await prisma.settlement.count({ where: { pactId: pact.id } })).toBe(0);
    await cleanup();
  });

  it("still refuses a named period that is the live one, in words, as a 400", async () => {
    // Naming the current period explicitly is the one way left to ask for the
    // running week without force, and the original guard still answers it.
    const { pact, cleanup } = await fixture();
    const res = await post(pact.id, { periodKey: weekDayKeys(pact.timezone, new Date())[0] });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/is not over/);
    expect(await prisma.settlement.count({ where: { pactId: pact.id } })).toBe(0);
    await cleanup();
  });

  // Force means the opposite period to a bare /settle: the one still running.
  // On a pact minutes old that is the only period there is, which is exactly
  // the demo, and it is why force does not share the default above.
  it("closes the running period when the member asked for force, and says who missed", async () => {
    const { pact, cleanup } = await fixture();

    const res = await post(pact.id, { force: true });
    expect(res.status).toBe(200);

    // How many missed, said as a number and not left to be counted from the
    // payouts -- the payouts are the winners, and the channel was reading
    // their length as the number who missed. Both members missed here and
    // neither is owed anything, so the two lists are 2 and 0.
    const body = await res.json();
    expect(body.failed).toBe(2);
    expect(body.payouts).toHaveLength(0);

    // Nobody did anything, so nobody is owed anything -- the pot has no winner
    // to go to and stays in the vault. What force did is on the record: a
    // settlement for the live period, and two members marked as having missed
    // it.
    const periodKey = weekDayKeys(pact.timezone, new Date())[0];
    const settlement = await prisma.settlement.findUnique({
      where: { pactId_periodKey: { pactId: pact.id, periodKey } },
    });
    expect(settlement).not.toBeNull();

    const members = await prisma.membership.findMany({ where: { pactId: pact.id } });
    expect(members).toHaveLength(2);
    expect(members.every((m) => m.status === "failed")).toBe(true);

    await cleanup();
  });

  it("takes force only as a boolean, so a stray string cannot turn it on", async () => {
    const { pact, cleanup } = await fixture();
    const res = await post(pact.id, { force: "yes" });
    expect(res.status).toBe(400);
    expect(await prisma.settlement.count({ where: { pactId: pact.id } })).toBe(0);
    await cleanup();
  });
});
