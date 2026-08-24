import { describe, it, expect } from "vitest";
import { getFeed, toggleReaction } from "@/app/api/pacts/[id]/feed/route";
import { prisma } from "@/lib/db";
import { createVault } from "@/lib/vault";

async function fixture() {
  const stamp = Date.now();
  const user = await prisma.user.create({
    data: { privyId: `p-${stamp}`, walletAddress: `w-${stamp}`, displayName: "Tester" },
  });
  const vault = createVault();
  const pact = await prisma.pact.create({
    data: {
      name: "T", inviteToken: `t-${stamp}`, createdById: user.id, ruleConfig: {},
      stakeAmount: "1000", stakeCurrency: "THB", fxRateToUsd: "0.0285",
      fxFetchedAt: new Date(), stakeUsdc: 28_500_000n,
      vaultAddress: vault.publicKey, vaultSecretEnc: vault.secretEnc,
      memberships: { create: { userId: user.id, status: "staked" } },
      feedItems: { create: { type: "bot", body: "Pact created" } },
    },
    include: { feedItems: true },
  });
  return { user, pact };
}

describe("feed", () => {
  it("returns items newest first with zero reactions", async () => {
    const { user, pact } = await fixture();

    // A second item, explicitly timestamped later than the fixture's first
    // item, so ordering is actually exercised -- with only one item (as in
    // the brief's literal test), an implementation with no ORDER BY at all,
    // or one sorted ascending, would still pass.
    const second = await prisma.feedItem.create({
      data: {
        pactId: pact.id,
        type: "bot",
        body: "Second event",
        createdAt: new Date(Date.now() + 60_000),
      },
    });

    const items = await getFeed(pact.id, user.walletAddress);
    expect(items).toHaveLength(2);
    expect(items[0].id).toBe(second.id);
    expect(items[0].body).toBe("Second event");
    expect(items[1].body).toBe("Pact created");
    expect(items[0].reactions).toEqual([]);
    expect(items[1].reactions).toEqual([]);

    await prisma.pact.delete({ where: { id: pact.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });

  it("toggles a reaction on and back off", async () => {
    const { user, pact } = await fixture();
    const itemId = pact.feedItems[0].id;

    await toggleReaction(itemId, user.walletAddress, "💪");
    let items = await getFeed(pact.id, user.walletAddress);
    expect(items[0].reactions).toEqual([{ emoji: "💪", count: 1, mine: true }]);

    await toggleReaction(itemId, user.walletAddress, "💪");
    items = await getFeed(pact.id, user.walletAddress);
    expect(items[0].reactions).toEqual([]);

    await prisma.pact.delete({ where: { id: pact.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });

  it("does not error for an unknown viewer and reports mine:false", async () => {
    const { user, pact } = await fixture();
    const itemId = pact.feedItems[0].id;

    await toggleReaction(itemId, user.walletAddress, "🔥");

    // An empty-string viewer matches no User row. getFeed must use
    // findUnique (not findUniqueOrThrow) here so this resolves to a feed
    // with mine:false rather than rejecting -- a findUniqueOrThrow
    // implementation would throw and this call would reject instead of
    // resolving.
    const items = await getFeed(pact.id, "");
    expect(items[0].reactions).toEqual([{ emoji: "🔥", count: 1, mine: false }]);

    await prisma.pact.delete({ where: { id: pact.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });
});
