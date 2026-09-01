import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";

/**
 * Who the verified token says is calling, or null for nobody.
 *
 * Only the authentication boundary is stubbed -- everything past it is the real
 * route against the real database. The route used to read `privyId` out of the
 * request body, so these tests could name anybody they liked and did; now the
 * identity has to come from here.
 */
const caller: { current: string | null } = { current: null };

vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  privyIdFromRequest: async () => caller.current,
}));

const { POST } = await import("@/app/api/pacts/join/route");

function joinRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/pacts/join", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/pacts/join", () => {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const privyIds = {
    unknownToken: `join-invitee-unknown-${suffix}`,
    notFunding: `join-invitee-notfunding-${suffix}`,
    idempotent: `join-invitee-idempotent-${suffix}`,
  };

  let creator: Awaited<ReturnType<typeof prisma.user.create>>;
  let fundingPact: Awaited<ReturnType<typeof prisma.pact.create>>;
  let activePact: Awaited<ReturnType<typeof prisma.pact.create>>;

  beforeAll(async () => {
    creator = await prisma.user.create({
      data: {
        privyId: `join-creator-${suffix}`,
        walletAddress: `join-creator-wallet-${suffix}`,
        displayName: "Creator",
      },
    });

    const base = {
      createdById: creator.id,
      ruleConfig: { cadence: 5, period: "week" },
      stakeAmount: "1000",
      stakeCurrency: "THB",
      fxRateToUsd: "0.0285",
      fxFetchedAt: new Date(),
      stakeUsdc: 28_500_000n,
      vaultSecretEnc: "enc",
    };

    fundingPact = await prisma.pact.create({
      data: {
        ...base,
        name: "Join test pact (funding)",
        inviteToken: `join-tok-funding-${suffix}`,
        vaultAddress: `vault-addr-funding-${suffix}`,
        status: "funding",
      },
    });

    activePact = await prisma.pact.create({
      data: {
        ...base,
        name: "Join test pact (active)",
        inviteToken: `join-tok-active-${suffix}`,
        vaultAddress: `vault-addr-active-${suffix}`,
        status: "active",
      },
    });
  });

  afterAll(async () => {
    await prisma.membership.deleteMany({
      where: { pactId: { in: [fundingPact.id, activePact.id] } },
    });
    await prisma.pact.deleteMany({ where: { id: { in: [fundingPact.id, activePact.id] } } });
    await prisma.user.deleteMany({
      where: { privyId: { in: [creator.privyId, ...Object.values(privyIds)] } },
    });
    await prisma.$disconnect();
  });

  it("404s for an unknown invite token", async () => {
    caller.current = privyIds.unknownToken;
    const res = await POST(
      joinRequest({
        inviteToken: `no-such-token-${suffix}`,
        walletAddress: `wallet-${privyIds.unknownToken}`,
        displayName: "Invitee",
      }),
    );
    expect(res.status).toBe(404);
  });

  it("refuses a caller who is not signed in", async () => {
    caller.current = null;
    const res = await POST(
      joinRequest({
        inviteToken: fundingPact.inviteToken,
        walletAddress: "wallet-anonymous",
        displayName: "Nobody",
      }),
    );
    expect(res.status).toBe(401);

    // The point of the refusal: a pact starts only once every member has
    // staked, so a member added by a stranger -- who never will -- would have
    // frozen this pact permanently, with everyone's money already in the vault.
    const memberships = await prisma.membership.findMany({
      where: { pactId: fundingPact.id },
    });
    expect(memberships.length).toBe(0);
  });

  it("cannot rewrite somebody else's payout address", async () => {
    // Settlement pays a member at user.walletAddress, and the body used to
    // carry the privyId whose row got written.
    caller.current = privyIds.unknownToken;
    const res = await POST(
      joinRequest({
        inviteToken: fundingPact.inviteToken,
        walletAddress: "attacker-wallet",
        displayName: "Invitee",
      }),
    );
    expect(res.status).toBe(200);

    const victim = await prisma.user.findUnique({ where: { privyId: creator.privyId } });
    expect(victim?.walletAddress).toBe(`join-creator-wallet-${suffix}`);

    await prisma.membership.deleteMany({ where: { pactId: fundingPact.id } });
  });

  it("refuses to join a pact that is not in funding status", async () => {
    caller.current = privyIds.notFunding;
    const res = await POST(
      joinRequest({
        inviteToken: activePact.inviteToken,
        walletAddress: `wallet-${privyIds.notFunding}`,
        displayName: "Invitee",
      }),
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBeTruthy();

    const user = await prisma.user.findUnique({ where: { privyId: privyIds.notFunding } });
    expect(user).toBeNull();
  });

  it("joining twice returns the same membership and does not duplicate it", async () => {
    caller.current = privyIds.idempotent;
    const payload = {
      inviteToken: fundingPact.inviteToken,
      walletAddress: `wallet-${privyIds.idempotent}`,
      displayName: "Invitee",
    };

    const first = await POST(joinRequest(payload));
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    expect(firstBody.pactId).toBe(fundingPact.id);
    expect(firstBody.alreadyMember).toBe(false);
    expect(typeof firstBody.membershipId).toBe("string");

    const second = await POST(joinRequest(payload));
    expect(second.status).toBe(200);
    const secondBody = await second.json();
    expect(secondBody.membershipId).toBe(firstBody.membershipId);
    expect(secondBody.alreadyMember).toBe(true);

    const memberships = await prisma.membership.findMany({
      where: { pactId: fundingPact.id },
    });
    expect(memberships.length).toBe(1);
    expect(memberships[0].status).toBe("invited");
  });
});
