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

/** A pact whose week nobody has done a thing towards. */
async function fixture() {
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

describe("settling from the channel", () => {
  it("refuses a period that is still running, in words, as a 400", async () => {
    const { pact, cleanup } = await fixture();

    // No periodKey: the route defaults to the period the crew is in, which is
    // the only thing `/settle` from the channel can mean. That default is
    // always inside the current period, so this path is the whole command.
    const res = await post(pact.id, {});

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/is not over/);
    // Nothing was decided. No settlement row means a proper run is still
    // possible when the week actually ends.
    expect(await prisma.settlement.count({ where: { pactId: pact.id } })).toBe(0);
    await cleanup();
  });

  it("still refuses when force is asked for and answered no", async () => {
    const { pact, cleanup } = await fixture();
    const res = await post(pact.id, { force: false });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/is not over/);
    await cleanup();
  });

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
    // settlement for this period, and two members marked as having missed it.
    // A week rule's period key is the Monday of the crew-local week, which is
    // exactly what the route defaults to when the channel sends no key.
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
