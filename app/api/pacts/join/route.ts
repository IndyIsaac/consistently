import { NextRequest, NextResponse } from "next/server";
import { privyIdFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { z } from "zod";

/**
 * No `privyId`. It used to be read from here, which meant this route took the
 * caller's identity from the caller's own request body and never checked it --
 * see the note on POST below.
 */
const BodySchema = z.object({
  inviteToken: z.string().min(1),
  walletAddress: z.string().min(1),
  displayName: z.string().min(1).max(40),
});

/** Thrown for the two refusals a would-be member is meant to read. */
export class JoinError extends Error {
  constructor(
    message: string,
    public status: 404 | 409,
  ) {
    super(message);
    this.name = "JoinError";
  }
}

/**
 * The pact behind an invite token, if it is still open to new members.
 *
 * A pact is open while it is still funding AND has never settled a period.
 * `status` alone is not enough: a member re-staking for the next period puts
 * the whole pact back into `funding`, and without the second condition that
 * would quietly re-open a months-old crew to anyone holding an old QR code.
 * The spec is explicit that late joiners cannot join a pact once it has
 * started.
 */
export async function findOpenPact(inviteToken: string) {
  const pact = await prisma.pact.findUnique({
    where: { inviteToken },
    include: { _count: { select: { settlements: true } } },
  });
  if (!pact) throw new JoinError("No pact found for this invite link", 404);

  if (pact.status !== "funding" || pact._count.settlements > 0) {
    throw new JoinError(
      `This pact is ${pact.status === "funding" ? "already running" : pact.status} and is no longer open to new members`,
      409,
    );
  }
  return pact;
}

/**
 * Idempotent -- @@unique([pactId, userId]) backs it, and the pre-check is what
 * lets a repeat scan report `alreadyMember` rather than looking like a failure.
 */
export async function addMember(pactId: string, userId: string) {
  const existing = await prisma.membership.findUnique({
    where: { pactId_userId: { pactId, userId } },
  });

  const membership = await prisma.membership.upsert({
    where: { pactId_userId: { pactId, userId } },
    update: {},
    create: { pactId, userId, status: "invited" },
  });

  return { pactId, membershipId: membership.id, alreadyMember: existing !== null };
}

/** For a caller that already has a user: the whole join in one call. */
export async function joinByInvite(params: { inviteToken: string; userId: string }) {
  const pact = await findOpenPact(params.inviteToken);
  return addMember(pact.id, params.userId);
}

/**
 * Join by invite, for a caller who proves who they are.
 *
 * It used to take `privyId` from the request body and upsert on it, with no
 * authentication anywhere in the route. Two things followed, and neither needed
 * an account on this deployment:
 *
 * The upsert's `update` wrote `walletAddress`, and lib/settlement.ts pays a
 * member at `member.user.walletAddress`. So anyone holding a member's privyId
 * could point that member's payouts at their own address and collect the
 * principal and the share at the next settlement.
 *
 * Worse, because it needed no secret at all: a pact goes `active` only once
 * `members.every(status === "staked")` (lib/stake.ts). Posting an invented
 * privyId with a real invite token -- the kind shared in a group chat or on a
 * QR code -- added a member who would never stake, and the pact could never
 * start. Nobody could check in, and settlement requires `active`, so every
 * stake already paid stayed in the vault with no way out.
 *
 * The identity now comes from the verified token and the body cannot name
 * anybody. `walletAddress` and `displayName` still come from the body, but the
 * row they are written to is keyed on the privyId inside that token, so they
 * can only ever describe the caller -- the same thing PATCH /api/me allows.
 *
 * The signed-in browser path is app/join/route.ts, which has always called
 * requireUser. This route had no live callers at all when the hole was found.
 */
export async function POST(req: NextRequest) {
  const privyId = await privyIdFromRequest(req);
  if (!privyId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const parsed = BodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const b = parsed.data;

  try {
    // Checked before the upsert, deliberately: a refused invite must not leave
    // an account behind for someone who never got in.
    const pact = await findOpenPact(b.inviteToken);

    const user = await prisma.user.upsert({
      where: { privyId },
      update: { walletAddress: b.walletAddress, displayName: b.displayName },
      create: {
        privyId,
        walletAddress: b.walletAddress,
        displayName: b.displayName,
      },
    });

    return NextResponse.json(await addMember(pact.id, user.id));
  } catch (e) {
    if (e instanceof JoinError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }
}
