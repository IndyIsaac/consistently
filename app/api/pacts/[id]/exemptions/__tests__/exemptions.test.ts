import { describe, it, expect } from "vitest";
import type { MemberStatus, Prisma } from "@prisma/client";
import { requestExemption, castVote } from "@/app/api/pacts/[id]/exemptions/route";
import { prisma } from "@/lib/db";
import { createVault } from "@/lib/vault";

// A schema-valid rule config (mirrors the fixture used by sessions.test.ts).
// `requestExemption` now parses `pact.ruleConfig` to check whether the crew
// has turned exemptions off (`exemption: "none"`), so the fixture must be a
// real, parseable config rather than `{}` -- exactly what a pact created
// through the real creation route always has, since that route validates
// against this same schema before persisting.
const DEFAULT_RULE_CONFIG = {
  cadence: 5, period: "week", sessionType: "checkin_checkout", minDurationMins: 30,
  windowStart: "00:00", windowEnd: "23:59", proof: "photo",
  failsWhenMissedExceeds: 0, split: "equal", exemption: "majority", durationPeriods: 4,
};

async function crew(
  size: number,
  ruleConfig: Prisma.InputJsonValue = DEFAULT_RULE_CONFIG,
) {
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
      name: "T", inviteToken: `t-${stamp}`, createdById: users[0].id, ruleConfig,
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

async function setMembershipStatus(pactId: string, userId: string, status: MemberStatus) {
  await prisma.membership.update({
    where: { pactId_userId: { pactId, userId } },
    data: { status },
  });
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
    ).rejects.toThrow(/unique|already/i);
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

  it("refuses to request an exemption for a member who isn't currently eligible (invited or left)", async () => {
    const { users, pact, cleanup } = await crew(2);
    await setMembershipStatus(pact.id, users[0].id, "left");
    await expect(
      requestExemption({
        pactId: pact.id, userWallet: users[0].walletAddress, periodKey: "2026-W35", reason: "a",
      }),
    ).rejects.toThrow(/member/i);
    await cleanup();
  });

  it("refuses to request an exemption when the pact's rules say exemptions are off", async () => {
    const { users, pact, cleanup } = await crew(2, { ...DEFAULT_RULE_CONFIG, exemption: "none" });
    await expect(
      requestExemption({
        pactId: pact.id, userWallet: users[0].walletAddress, periodKey: "2026-W35", reason: "a",
      }),
    ).rejects.toThrow(/exemption/i);
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

  it("ignores further votes once resolved, reports the real threshold (not zero), and does not re-post the result to the feed", async () => {
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
    // fact -- must not be recorded and must not flip the result. The
    // reported `needed` must still be the real threshold (3), not the
    // sentinel 0 the resolved-branch used to return -- the demo moment is
    // "2 of 3 needed", not "2 of 0 needed".
    const late = await castVote({
      exemptionId, userWallet: users[4].walletAddress, approve: true,
    });
    expect(late.status).toBe("denied");
    expect(late.needed).toBe(3);
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
    expect(flipAttempt.needed).toBe(3);
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

  it("rejects a vote from a member whose status isn't eligible (invited or left), and leaves the tally unchanged", async () => {
    const { users, pact, cleanup } = await crew(4); // requester + 3 others
    const { exemptionId } = await requestExemption({
      pactId: pact.id, userWallet: users[0].walletAddress, periodKey: "2026-W35", reason: "a",
    });

    // users[1] never staked; users[2] walked away. Both have a real
    // Membership row in this pact -- this exercises the status-mismatch
    // branch of the guard, not the "no membership at all" branch test 8
    // above already covers.
    await setMembershipStatus(pact.id, users[1].id, "invited");
    await setMembershipStatus(pact.id, users[2].id, "left");

    await expect(
      castVote({ exemptionId, userWallet: users[1].walletAddress, approve: true }),
    ).rejects.toThrow(/member/i);
    await expect(
      castVote({ exemptionId, userWallet: users[2].walletAddress, approve: true }),
    ).rejects.toThrow(/member/i);

    const voteCount = await prisma.vote.count({ where: { exemptionId } });
    expect(voteCount).toBe(0);

    await cleanup();
  });

  it("scopes the tally to members who are still eligible when it's read, ignoring a departed voter's vote", async () => {
    // 5-person crew: 4 members other than the requester, needed = floor(4/2)+1 = 3.
    const { users, pact, cleanup } = await crew(5);
    const { exemptionId } = await requestExemption({
      pactId: pact.id, userWallet: users[0].walletAddress, periodKey: "2026-W35", reason: "a",
    });

    await castVote({ exemptionId, userWallet: users[1].walletAddress, approve: true });
    await castVote({ exemptionId, userWallet: users[2].walletAddress, approve: true });
    await castVote({ exemptionId, userWallet: users[3].walletAddress, approve: false });
    const midway = await castVote({
      exemptionId, userWallet: users[4].walletAddress, approve: false,
    });
    // 2 approvals, 2 rejections, needed = 3 -- neither side has reached it.
    expect(midway.status).toBe("pending");

    // users[1] (an approving voter) leaves the pact. Their approval must no
    // longer count toward either side: eligible drops to 3 (users[2],
    // users[3], users[4]), so needed = floor(3/2)+1 = 2. Excluding
    // users[1]'s phantom approval, the remaining tally is 1 approval / 2
    // rejections -- a real majority to deny. An implementation that keeps
    // counting the departed member's vote would instead see 2 approvals /
    // 2 rejections and grant it (approvals is checked first), which is
    // exactly backwards.
    await setMembershipStatus(pact.id, users[1].id, "left");

    const after = await castVote({
      exemptionId, userWallet: users[3].walletAddress, approve: false,
    });
    expect(after.needed).toBe(2);
    expect(after.approvals).toBe(1);
    expect(after.status).toBe("denied");

    await cleanup();
  });

  it("leaves a solo member's exemption pending forever -- there is no one else to vote", async () => {
    const { users, pact, cleanup } = await crew(1);
    const { exemptionId } = await requestExemption({
      pactId: pact.id, userWallet: users[0].walletAddress, periodKey: "2026-W35", reason: "a",
    });
    // The only possible caller is the requester themselves, and they are
    // blocked from voting on their own exemption -- so there is genuinely
    // no path to resolution, not just an untried one.
    await expect(
      castVote({ exemptionId, userWallet: users[0].walletAddress, approve: true }),
    ).rejects.toThrow(/own/i);
    const exemption = await prisma.exemption.findUniqueOrThrow({ where: { id: exemptionId } });
    expect(exemption.status).toBe("pending");
    await cleanup();
  });
});
