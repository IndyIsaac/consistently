import { NextRequest, NextResponse } from "next/server";
import { UnauthorizedError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  ELIGIBLE_STATUSES,
  ELIGIBLE_STATUS_SET,
  tallyExemption,
} from "@/lib/exemptions";
import { RuleConfigSchema } from "@/lib/rules";

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
 * The eligible-status list and the tally now live in lib/exemptions.ts, so the
 * pact screen's "one more yes" is computed by the same function that decides
 * whether the vote actually carried. See the note at the top of that file.
 */

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
  if (!ELIGIBLE_STATUS_SET.has(membership.status)) {
    throw new ExemptionGuardError("Only current pact members can request an exemption.");
  }

  const pact = await prisma.pact.findUniqueOrThrow({
    where: { id: params.pactId },
    select: { ruleConfig: true },
  });
  const parsedRule = RuleConfigSchema.safeParse(pact.ruleConfig);
  if (parsedRule.success && parsedRule.data.exemption === "none") {
    throw new ExemptionGuardError("This pact's rules don't allow exemptions.");
  }

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
    include: { membership: { include: { user: true } }, votes: true },
  });

  const voterMembership = await prisma.membership.findUnique({
    where: {
      pactId_userId: { pactId: exemption.membership.pactId, userId: user.id },
    },
  });
  if (!voterMembership || !ELIGIBLE_STATUS_SET.has(voterMembership.status)) {
    throw new ExemptionGuardError("Only current pact members can vote on exemptions.");
  }

  if (exemption.membership.userId === user.id) {
    throw new ExemptionGuardError("You cannot vote on your own exemption");
  }
  if (exemption.status !== "pending") {
    const eligible = await prisma.membership.count({
      where: {
        pactId: exemption.membership.pactId,
        status: { in: ELIGIBLE_STATUSES },
        NOT: { id: exemption.membershipId },
      },
    });
    return {
      status: exemption.status,
      approvals: exemption.votes.filter((v) => v.approve).length,
      needed: Math.floor(eligible / 2) + 1,
    };
  }

  await prisma.vote.upsert({
    where: { exemptionId_userId: { exemptionId: exemption.id, userId: user.id } },
    update: { approve: params.approve },
    create: { exemptionId: exemption.id, userId: user.id, approve: params.approve },
  });

  // The denominator and the numerator must describe the same population read
  // at the same moment -- otherwise a vote from a member who has since left
  // keeps a phantom say in the outcome while no longer counting toward
  // `needed`. `tallyExemption` is where that invariant is enforced, and the
  // pact screen calls the same function.
  const [memberships, votes] = await Promise.all([
    prisma.membership.findMany({
      where: { pactId: exemption.membership.pactId },
      select: { id: true, userId: true, status: true },
    }),
    prisma.vote.findMany({ where: { exemptionId: exemption.id } }),
  ]);

  const { approvals, needed, status } = tallyExemption({
    requesterMembershipId: exemption.membershipId,
    memberships,
    votes,
  });

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
    /**
     * An expired sign-in is not a fault. Without this it fell to the generic
     * 500 below, so a member whose token had aged out got "request failed" --
     * indistinguishable from a crash, to them and to anyone debugging it. The
     * client can only tell them to sign in again if it is told that is what
     * happened.
     */
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: 401 });
    }
    console.error("POST /api/pacts/[id]/exemptions failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Exemption request failed" }, { status: 500 });
  }
}
