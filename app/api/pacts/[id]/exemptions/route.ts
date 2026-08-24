import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/**
 * Thrown for the guard conditions a caller is meant to see and act on (e.g.
 * "you can't vote on your own exemption"). Anything else -- a Prisma error, a
 * malformed request body -- must never reach the client as-is: Prisma's
 * `findUniqueOrThrow` messages embed absolute source file paths and a
 * snippet of the calling code, so an unauthenticated caller passing a bogus
 * id must not see the raw error. See app/api/pacts/[id]/sessions/route.ts
 * for the same pattern.
 */
class ExemptionGuardError extends Error {}

/**
 * Membership statuses that count toward the crew that gets a say in an
 * exemption -- both as the denominator ("eligible") and as who is allowed
 * to cast a vote at all. `invited` (never staked) and `left` (walked away)
 * members are excluded from both; keeping the same set for both prevents
 * the numerator and denominator from drifting apart.
 */
const ELIGIBLE_STATUSES = ["staked", "passed", "failed"];

export async function requestExemption(params: {
  pactId: string;
  userWallet: string;
  periodKey: string;
  reason: string;
}): Promise<{ exemptionId: string }> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { walletAddress: params.userWallet },
  });
  const membership = await prisma.membership.findUniqueOrThrow({
    where: { pactId_userId: { pactId: params.pactId, userId: user.id } },
  });

  const exemption = await prisma.exemption.create({
    data: {
      membershipId: membership.id,
      periodKey: params.periodKey,
      reason: params.reason.slice(0, 280),
    },
  });

  await prisma.feedItem.create({
    data: {
      pactId: params.pactId,
      membershipId: membership.id,
      type: "exemption_request",
      body: `${user.displayName} is asking to be let off: "${params.reason.slice(0, 140)}"`,
    },
  });

  return { exemptionId: exemption.id };
}

export async function castVote(params: {
  exemptionId: string;
  userWallet: string;
  approve: boolean;
}): Promise<{ status: "pending" | "granted" | "denied"; approvals: number; needed: number }> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { walletAddress: params.userWallet },
  });

  const exemption = await prisma.exemption.findUniqueOrThrow({
    where: { id: params.exemptionId },
    include: { membership: { include: { pact: true, user: true } }, votes: true },
  });

  const voterMembership = await prisma.membership.findUnique({
    where: {
      pactId_userId: { pactId: exemption.membership.pactId, userId: user.id },
    },
  });
  if (!voterMembership || !ELIGIBLE_STATUSES.includes(voterMembership.status)) {
    throw new ExemptionGuardError("Only current pact members can vote on exemptions.");
  }

  if (exemption.membership.userId === user.id) {
    throw new ExemptionGuardError("You cannot vote on your own exemption");
  }
  if (exemption.status !== "pending") {
    return {
      status: exemption.status,
      approvals: exemption.votes.filter((v) => v.approve).length,
      needed: 0,
    };
  }

  await prisma.vote.upsert({
    where: { exemptionId_userId: { exemptionId: exemption.id, userId: user.id } },
    update: { approve: params.approve },
    create: { exemptionId: exemption.id, userId: user.id, approve: params.approve },
  });

  const eligible = await prisma.membership.count({
    where: {
      pactId: exemption.membership.pactId,
      status: { in: ["staked", "passed", "failed"] },
      NOT: { id: exemption.membershipId },
    },
  });
  const needed = Math.floor(eligible / 2) + 1;

  const votes = await prisma.vote.findMany({ where: { exemptionId: exemption.id } });
  const approvals = votes.filter((v) => v.approve).length;
  const rejections = votes.length - approvals;

  let status: "pending" | "granted" | "denied" = "pending";
  if (approvals >= needed) status = "granted";
  else if (rejections >= needed) status = "denied";

  if (status !== "pending") {
    await prisma.exemption.update({ where: { id: exemption.id }, data: { status } });
    await prisma.feedItem.create({
      data: {
        pactId: exemption.membership.pactId,
        membershipId: exemption.membershipId,
        type: "exemption_result",
        body:
          status === "granted"
            ? `The crew let ${exemption.membership.user.displayName} off this one.`
            : `The crew said no. ${exemption.membership.user.displayName} still owes.`,
      },
    });
  }

  return { status, approvals, needed };
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  try {
    const body = await req.json();

    if (body.action === "request") {
      return NextResponse.json(
        await requestExemption({
          pactId: id,
          userWallet: body.userWallet,
          periodKey: body.periodKey,
          reason: body.reason,
        }),
      );
    }
    if (body.action === "vote") {
      return NextResponse.json(
        await castVote({
          exemptionId: body.exemptionId,
          userWallet: body.userWallet,
          approve: Boolean(body.approve),
        }),
      );
    }
    return NextResponse.json({ error: "action must be request or vote" }, { status: 400 });
  } catch (e) {
    if (e instanceof ExemptionGuardError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    console.error("POST /api/pacts/[id]/exemptions failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Exemption request failed" }, { status: 500 });
  }
}
