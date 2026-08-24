import { NextRequest, NextResponse } from "next/server";
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

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const viewer = req.nextUrl.searchParams.get("viewer") ?? "";
  return NextResponse.json(await getFeed(id, viewer));
}
