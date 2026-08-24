import { describe, it, expect } from "vitest";
import { requestExemption, castVote } from "@/app/api/pacts/[id]/exemptions/route";
import { prisma } from "@/lib/db";
import { createVault } from "@/lib/vault";

async function crew(size: number) {
  const stamp = Date.now() + Math.floor(Math.random() * 1000);
  const users = await Promise.all(
    Array.from({ length: size }, (_, i) =>
      prisma.user.create({
        data: {
          privyId: `p-${stamp}-${i}`,
          walletAddress: `w-${stamp}-${i}`,
          displayName: `M${i}`,
        },
      }),
    ),
  );
  const vault = createVault();
  const pact = await prisma.pact.create({
    data: {
      name: "T", inviteToken: `t-${stamp}`, createdById: users[0].id, ruleConfig: {},
      stakeAmount: "1000", stakeCurrency: "THB", fxRateToUsd: "0.0285",
      fxFetchedAt: new Date(), stakeUsdc: 28_500_000n,
      vaultAddress: vault.publicKey, vaultSecretEnc: vault.secretEnc,
      memberships: { create: users.map((u) => ({ userId: u.id, status: "staked" as const })) },
    },
  });
  const cleanup = async () => {
    await prisma.pact.delete({ where: { id: pact.id } });
    await prisma.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
  };
  return { users, pact, cleanup };
}

describe("exemptions", () => {
  it("grants when a majority of the other members approve", async () => {
    const { users, pact, cleanup } = await crew(5);
    const { exemptionId } = await requestExemption({
      pactId: pact.id, userWallet: users[0].walletAddress,
      periodKey: "2026-W35", reason: "Food poisoning",
    });

    let r = await castVote({ exemptionId, userWallet: users[1].walletAddress, approve: true });
    expect(r.status).toBe("pending");
    expect(r.needed).toBe(3); // majority of the 4 members who are not the requester

    await castVote({ exemptionId, userWallet: users[2].walletAddress, approve: true });
    r = await castVote({ exemptionId, userWallet: users[3].walletAddress, approve: true });
    expect(r.status).toBe("granted");

    await cleanup();
  });

  it("refuses a second exemption for the same period", async () => {
    const { users, pact, cleanup } = await crew(3);
    await requestExemption({
      pactId: pact.id, userWallet: users[0].walletAddress, periodKey: "2026-W35", reason: "a",
    });
    await expect(
      requestExemption({
        pactId: pact.id, userWallet: users[0].walletAddress, periodKey: "2026-W35", reason: "b",
      }),
    ).rejects.toThrow();
    await cleanup();
  });

  it("does not let the requester vote on their own exemption", async () => {
    const { users, pact, cleanup } = await crew(3);
    const { exemptionId } = await requestExemption({
      pactId: pact.id, userWallet: users[0].walletAddress, periodKey: "2026-W35", reason: "a",
    });
    await expect(
      castVote({ exemptionId, userWallet: users[0].walletAddress, approve: true }),
    ).rejects.toThrow(/own/i);
    await cleanup();
  });

  it("does not resolve on raw vote count -- only a real majority either way -- and denies when rejections win", async () => {
    // 5-person crew: 4 members other than the requester, needed = floor(4/2)+1 = 3.
    const { users, pact, cleanup } = await crew(5);
    const { exemptionId } = await requestExemption({
      pactId: pact.id, userWallet: users[0].walletAddress, periodKey: "2026-W35", reason: "a",
    });

    await castVote({ exemptionId, userWallet: users[1].walletAddress, approve: false });
    await castVote({ exemptionId, userWallet: users[2].walletAddress, approve: false });
    // Third vote overall, but only the first *approval* -- an implementation
    // that resolves once total votes reach `needed` (ignoring the approve
    // flag) would wrongly grant or deny here. It must still be pending:
    // 1 approval and 2 rejections, neither of which has reached 3 yet.
    let r = await castVote({ exemptionId, userWallet: users[3].walletAddress, approve: true });
    expect(r.status).toBe("pending");

    r = await castVote({ exemptionId, userWallet: users[4].walletAddress, approve: false });
    expect(r.status).toBe("denied");
    expect(r.approvals).toBe(1);
    expect(r.needed).toBe(3);

    await cleanup();
  });

  it("lets a single vote decide in a two-person pact", async () => {
    // eligible = 1 (the only other member), needed = floor(1/2)+1 = 1.
    const { users, pact, cleanup } = await crew(2);
    const { exemptionId } = await requestExemption({
      pactId: pact.id, userWallet: users[0].walletAddress, periodKey: "2026-W35", reason: "a",
    });
    const r = await castVote({ exemptionId, userWallet: users[1].walletAddress, approve: true });
    expect(r.needed).toBe(1);
    expect(r.status).toBe("granted");
    await cleanup();
  });

  it("recomputes the tally when a voter changes their mind, without double-counting", async () => {
    // 3-person crew: 2 members other than the requester, needed = floor(2/2)+1 = 2.
    const { users, pact, cleanup } = await crew(3);
    const { exemptionId } = await requestExemption({
      pactId: pact.id, userWallet: users[0].walletAddress, periodKey: "2026-W35", reason: "a",
    });

    let r = await castVote({ exemptionId, userWallet: users[1].walletAddress, approve: true });
    expect(r.approvals).toBe(1);
    expect(r.status).toBe("pending");

    // Same voter flips their vote. Tally must be recomputed from the
    // (now-updated) vote rows, not incremented/decremented -- and it must
    // not throw a unique-constraint error, which it would if the vote were
    // re-created instead of upserted.
    r = await castVote({ exemptionId, userWallet: users[1].walletAddress, approve: false });
    expect(r.approvals).toBe(0);
    expect(r.status).toBe("pending");

    r = await castVote({ exemptionId, userWallet: users[1].walletAddress, approve: true });
    expect(r.approvals).toBe(1);

    r = await castVote({ exemptionId, userWallet: users[2].walletAddress, approve: true });
    expect(r.approvals).toBe(2);
    expect(r.status).toBe("granted");

    await cleanup();
  });

  it("ignores further votes once resolved, and does not re-post the result to the feed", async () => {
    // 5-person crew, needed = 3. Deny it with exactly 3 rejections.
    const { users, pact, cleanup } = await crew(5);
    const { exemptionId } = await requestExemption({
      pactId: pact.id, userWallet: users[0].walletAddress, periodKey: "2026-W35", reason: "a",
    });
    await castVote({ exemptionId, userWallet: users[1].walletAddress, approve: false });
    await castVote({ exemptionId, userWallet: users[2].walletAddress, approve: false });
    const resolved = await castVote({
      exemptionId, userWallet: users[3].walletAddress, approve: false,
    });
    expect(resolved.status).toBe("denied");

    const feedCountAfterResolution = await prisma.feedItem.count({
      where: { pactId: pact.id, type: "exemption_result" },
    });
    expect(feedCountAfterResolution).toBe(1);

    // A brand-new voter who never got a chance to vote tries after the
    // fact -- must not be recorded and must not flip the result.
    const late = await castVote({
      exemptionId, userWallet: users[4].walletAddress, approve: true,
    });
    expect(late.status).toBe("denied");
    const lateVote = await prisma.vote.findUnique({
      where: { exemptionId_userId: { exemptionId, userId: users[4].id } },
    });
    expect(lateVote).toBeNull();

    // An existing voter tries to flip their vote after resolution -- must
    // not be recorded either.
    const flipAttempt = await castVote({
      exemptionId, userWallet: users[1].walletAddress, approve: true,
    });
    expect(flipAttempt.status).toBe("denied");
    const unchangedVote = await prisma.vote.findUniqueOrThrow({
      where: { exemptionId_userId: { exemptionId, userId: users[1].id } },
    });
    expect(unchangedVote.approve).toBe(false);

    const feedCountFinal = await prisma.feedItem.count({
      where: { pactId: pact.id, type: "exemption_result" },
    });
    expect(feedCountFinal).toBe(1);

    await cleanup();
  });

  it("rejects a vote from someone who is not a member of the pact", async () => {
    const { users, pact, cleanup } = await crew(3);
    const { exemptionId } = await requestExemption({
      pactId: pact.id, userWallet: users[0].walletAddress, periodKey: "2026-W35", reason: "a",
    });

    const stamp = Date.now() + Math.floor(Math.random() * 1000);
    const outsider = await prisma.user.create({
      data: { privyId: `p-out-${stamp}`, walletAddress: `w-out-${stamp}`, displayName: "Outsider" },
    });

    await expect(
      castVote({ exemptionId, userWallet: outsider.walletAddress, approve: true }),
    ).rejects.toThrow(/member/i);

    await prisma.user.delete({ where: { id: outsider.id } });
    await cleanup();
  });

  it("leaves a solo member's exemption pending forever -- there is no one else to vote", async () => {
    const { users, pact, cleanup } = await crew(1);
    const { exemptionId } = await requestExemption({
      pactId: pact.id, userWallet: users[0].walletAddress, periodKey: "2026-W35", reason: "a",
    });
    const exemption = await prisma.exemption.findUniqueOrThrow({ where: { id: exemptionId } });
    expect(exemption.status).toBe("pending");
    await cleanup();
  });
});
