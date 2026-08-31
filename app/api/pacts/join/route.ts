import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { z } from "zod";

const BodySchema = z.object({
  inviteToken: z.string().min(1),
  privyId: z.string().min(1),
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

export async function POST(req: NextRequest) {
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
      where: { privyId: b.privyId },
      update: { walletAddress: b.walletAddress, displayName: b.displayName },
      create: {
        privyId: b.privyId,
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
