import { NextRequest, NextResponse } from "next/server";
import { requireUser, UnauthorizedError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { checkedInLine, checkedOutLine, earlyCheckoutRefusal } from "@/lib/bot";
import { dayKeyFor, RuleConfigSchema } from "@/lib/rules";

/**
 * Thrown for the guard conditions a caller is meant to see and act on (e.g. "a
 * session is already open"). Anything else -- a Prisma error, a malformed
 * request body -- must never reach the client as-is: Prisma's
 * `findUniqueOrThrow` messages embed absolute source file paths and a snippet
 * of the calling code, so an unauthenticated caller passing a bogus id must
 * not see the raw error.
 */
class SessionGuardError extends Error {}

export async function openSession(params: {
  pactId: string;
  userWallet: string;
  photoUrl: string | null;
}): Promise<{ sessionId: string }> {
  const pact = await prisma.pact.findUniqueOrThrow({ where: { id: params.pactId } });
  const user = await prisma.user.findUniqueOrThrow({
    where: { walletAddress: params.userWallet },
  });
  const membership = await prisma.membership.findUniqueOrThrow({
    where: { pactId_userId: { pactId: pact.id, userId: user.id } },
  });

  /**
   * A pact that has not started has no period to check into.
   *
   * It runs only once everybody has staked -- lib/stake.ts is explicit that
   * nobody should be exposed to a rule the rest of the crew has not paid for.
   * A session opened before that counts towards a week nobody is being judged
   * on, and towards a cadence that decides whose money moves.
   *
   * components/Channel.tsx stops offering the button while a crew is still
   * paying. That is the affordance and not the rule: this route is reachable
   * without it, and the check belongs where the row gets written.
   */
  if (pact.status !== "active") {
    throw new SessionGuardError(
      pact.status === "funding"
        ? "This pact has not started. Everyone has to stake first."
        : "This pact is settled. There is nothing left to check into.",
    );
  }

  const open = await prisma.session.findFirst({
    where: { membershipId: membership.id, endedAt: null },
  });
  if (open) throw new SessionGuardError("A session is already open. Check out first.");

  const startedAt = new Date();
  const session = await prisma.session.create({
    data: {
      membershipId: membership.id,
      startedAt,
      dayKey: dayKeyFor(startedAt, pact.timezone),
      startPhotoUrl: params.photoUrl,
    },
  });

  await prisma.feedItem.create({
    data: {
      pactId: pact.id,
      membershipId: membership.id,
      type: "checkin",
      body: checkedInLine(user.displayName),
      photoUrl: params.photoUrl,
    },
  });

  return { sessionId: session.id };
}

export async function closeSession(params: {
  sessionId: string;
  photoUrl: string | null;
}): Promise<{ durationMins: number }> {
  const session = await prisma.session.findUniqueOrThrow({
    where: { id: params.sessionId },
    include: { membership: { include: { user: true, pact: true } } },
  });
  if (session.endedAt) throw new SessionGuardError("Session is already closed.");

  const endedAt = new Date();
  const durationMins = Math.floor((endedAt.getTime() - session.startedAt.getTime()) / 60_000);

  // A short session is refused here rather than recorded and judged at
  // settlement. `isValidSession` would have discarded it days later, by which
  // time the member has already lost the stake and cannot do anything about
  // it; refusing at the moment of the attempt is the whole point of the bot.
  //
  // The condition mirrors `isValidSession` exactly -- a `checkin`-only rule
  // ignores `minDurationMins`, so this must too, or the API would refuse
  // check-outs the rule engine would have accepted.
  //
  // A pact whose stored ruleConfig no longer parses is not a reason to trap a
  // member in an open session: with no rule to enforce, the check-out is
  // recorded as it was before.
  const parsedRule = RuleConfigSchema.safeParse(session.membership.pact.ruleConfig);
  if (parsedRule.success) {
    const rule = parsedRule.data;
    if (
      rule.sessionType === "checkin_checkout" &&
      rule.minDurationMins !== null &&
      durationMins < rule.minDurationMins
    ) {
      throw new SessionGuardError(earlyCheckoutRefusal(durationMins, rule.minDurationMins));
    }
  }

  await prisma.session.update({
    where: { id: session.id },
    data: { endedAt, endPhotoUrl: params.photoUrl },
  });

  await prisma.feedItem.create({
    data: {
      pactId: session.membership.pactId,
      membershipId: session.membershipId,
      type: "checkout",
      body: checkedOutLine(session.membership.user.displayName, durationMins),
      photoUrl: params.photoUrl,
    },
  });

  return { durationMins };
}

/**
 * The caller is who they say they are, and the session is theirs to touch.
 *
 * This route took `userWallet` from the request body and believed it, and
 * `close` took a bare `sessionId` and believed that. The README says what
 * that amounts to -- "the inputs to a settlement verdict are forgeable" --
 * and a check-in is exactly such an input: it decides who kept the cadence
 * and therefore whose stake moves. A member's address is printed on the pact
 * page, so anyone in the crew could record a day for somebody else, or close
 * a session they were still in.
 *
 * The client has sent a bearer since lib/channel-client.ts started asking the
 * SDK for one, so this costs an honest member nothing.
 */
async function callerWallet(req: NextRequest, claimed: unknown): Promise<string> {
  const user = await requireUser(req);
  if (typeof claimed === "string" && claimed !== user.walletAddress) {
    // A guard error, so it leaves as a 400 carrying this sentence -- the one
    // shape lib/channel-client.ts passes through to the member.
    throw new SessionGuardError("That is not your wallet.");
  }
  return user.walletAddress;
}

/** The session exists, and it belongs to whoever is asking to close it. */
async function ownSession(
  req: NextRequest,
  pactId: string,
  sessionId: unknown,
): Promise<string> {
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    throw new SessionGuardError("That is not a session.");
  }
  const user = await requireUser(req);
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { membership: { select: { userId: true, pactId: true } } },
  });
  if (!session) throw new SessionGuardError("That session is not open.");
  if (session.membership.userId !== user.id) {
    throw new SessionGuardError("That is not your session.");
  }
  /**
   * And it belongs to the pact being posted to. `closeSession` works from the
   * session id alone, so the pact in the URL was never checked against it --
   * a check-out for one crew could be posted to another's endpoint. Nothing
   * moved to the wrong place, because the write follows the session, but the
   * request and the row it altered described different pacts, and a guard read
   * later would have been reasoning about the wrong one.
   */
  if (session.membership.pactId !== pactId) {
    throw new SessionGuardError("That session is not in this pact.");
  }
  return sessionId;
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  try {
    const body = await req.json();

    if (body.action === "open") {
      return NextResponse.json(
        await openSession({
          pactId: id,
          userWallet: await callerWallet(req, body.userWallet),
          photoUrl: body.photoUrl ?? null,
        }),
      );
    }
    if (body.action === "close") {
      return NextResponse.json(
        await closeSession({
          sessionId: await ownSession(req, id, body.sessionId),
          photoUrl: body.photoUrl ?? null,
        }),
      );
    }
    return NextResponse.json({ error: "action must be open or close" }, { status: 400 });
  } catch (e) {
    if (e instanceof SessionGuardError) {
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
    console.error("POST /api/pacts/[id]/sessions failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Session request failed" }, { status: 500 });
  }
}
