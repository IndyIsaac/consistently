import { NextRequest, NextResponse } from "next/server";
import { UnauthorizedError, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export type FeedItemDto = {
  id: string;
  type: string;
  body: string;
  photoUrl: string | null;
  authorName: string | null;
  createdAt: string;
  reactions: { emoji: string; count: number; mine: boolean }[];
};

export async function getFeed(pactId: string, viewerWallet: string): Promise<FeedItemDto[]> {
  const viewer = await prisma.user.findUnique({ where: { walletAddress: viewerWallet } });

  const items = await prisma.feedItem.findMany({
    where: { pactId },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      membership: { include: { user: true } },
      reactions: true,
    },
  });

  return items.map((item) => {
    const byEmoji = new Map<string, { count: number; mine: boolean }>();
    for (const r of item.reactions) {
      const entry = byEmoji.get(r.emoji) ?? { count: 0, mine: false };
      entry.count += 1;
      if (viewer && r.userId === viewer.id) entry.mine = true;
      byEmoji.set(r.emoji, entry);
    }
    return {
      id: item.id,
      type: item.type,
      body: item.body,
      photoUrl: item.photoUrl,
      authorName: item.membership?.user.displayName ?? null,
      createdAt: item.createdAt.toISOString(),
      reactions: [...byEmoji.entries()].map(([emoji, v]) => ({ emoji, ...v })),
    };
  });
}

export async function toggleReaction(itemId: string, userWallet: string, emoji: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { walletAddress: userWallet } });
  const key = { feedItemId_userId_emoji: { feedItemId: itemId, userId: user.id, emoji } };
  const existing = await prisma.reaction.findUnique({ where: key });

  if (existing) {
    await prisma.reaction.delete({ where: key });
    return { on: false };
  }
  await prisma.reaction.create({ data: { feedItemId: itemId, userId: user.id, emoji } });
  return { on: true };
}

/**
 * A crew's feed, for somebody in that crew.
 *
 * It used to take the viewer from `?viewer=` and check nothing at all, so the
 * pact id was the only thing standing between a stranger and the whole channel:
 * every member's name, every bot line naming who checked in and who missed, and
 * the photo URLs. That id is in the address bar of any pact page, which makes a
 * screenshot enough -- and it kept working for somebody who had left the crew.
 *
 * The `viewer` parameter never guarded anything either. It only decided which
 * reactions came back marked `mine`, so passing somebody else's wallet was a
 * way to read the feed as them.
 *
 * Both now come from the verified caller, and a caller with no membership in
 * this pact is refused. An `invited` membership is enough: they are in the crew,
 * they just have not paid yet, and the channel is where they are asked to.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  let user;
  try {
    user = await requireUser(req);
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: 401 });
    }
    throw e;
  }

  const membership = await prisma.membership.findUnique({
    where: { pactId_userId: { pactId: id, userId: user.id } },
    select: { id: true },
  });
  if (!membership) {
    return NextResponse.json({ error: "You are not in this crew." }, { status: 403 });
  }

  return NextResponse.json(await getFeed(id, user.walletAddress));
}
