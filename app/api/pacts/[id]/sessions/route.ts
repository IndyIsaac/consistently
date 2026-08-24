import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { dayKeyFor } from "@/lib/rules";

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

  const open = await prisma.session.findFirst({
    where: { membershipId: membership.id, endedAt: null },
  });
  if (open) throw new Error("A session is already open. Check out first.");

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
      body: `${user.displayName} checked in`,
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
  if (session.endedAt) throw new Error("Session is already closed.");

  const endedAt = new Date();
  const durationMins = Math.floor((endedAt.getTime() - session.startedAt.getTime()) / 60_000);

  await prisma.session.update({
    where: { id: session.id },
    data: { endedAt, endPhotoUrl: params.photoUrl },
  });

  await prisma.feedItem.create({
    data: {
      pactId: session.membership.pactId,
      membershipId: session.membershipId,
      type: "checkout",
      body: `${session.membership.user.displayName} checked out after ${durationMins} minutes`,
      photoUrl: params.photoUrl,
    },
  });

  return { durationMins };
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json();

  try {
    if (body.action === "open") {
      return NextResponse.json(
        await openSession({
          pactId: id,
          userWallet: body.userWallet,
          photoUrl: body.photoUrl ?? null,
        }),
      );
    }
    if (body.action === "close") {
      return NextResponse.json(
        await closeSession({ sessionId: body.sessionId, photoUrl: body.photoUrl ?? null }),
      );
    }
    return NextResponse.json({ error: "action must be open or close" }, { status: 400 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "session failed" },
      { status: 400 },
    );
  }
}
