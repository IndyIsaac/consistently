import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { z } from "zod";

const BodySchema = z.object({
  inviteToken: z.string().min(1),
  privyId: z.string().min(1),
  walletAddress: z.string().min(1),
  displayName: z.string().min(1).max(40),
});

export async function POST(req: NextRequest) {
  const parsed = BodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const b = parsed.data;

  const pact = await prisma.pact.findUnique({ where: { inviteToken: b.inviteToken } });
  if (!pact) {
    return NextResponse.json({ error: "No pact found for this invite link" }, { status: 404 });
  }
  if (pact.status !== "funding") {
    return NextResponse.json(
      { error: `This pact is ${pact.status} and is no longer open to new members` },
      { status: 409 },
    );
  }

  const user = await prisma.user.upsert({
    where: { privyId: b.privyId },
    update: { walletAddress: b.walletAddress, displayName: b.displayName },
    create: {
      privyId: b.privyId,
      walletAddress: b.walletAddress,
      displayName: b.displayName,
    },
  });

  // Idempotent join: @@unique([pactId, userId]) backs this. Check first so a
  // repeat visit to the invite link reports alreadyMember instead of re-creating.
  const existing = await prisma.membership.findUnique({
    where: { pactId_userId: { pactId: pact.id, userId: user.id } },
  });

  const membership = await prisma.membership.upsert({
    where: { pactId_userId: { pactId: pact.id, userId: user.id } },
    update: {},
    create: { pactId: pact.id, userId: user.id, status: "invited" },
  });

  return NextResponse.json({
    pactId: pact.id,
    membershipId: membership.id,
    alreadyMember: existing !== null,
  });
}
