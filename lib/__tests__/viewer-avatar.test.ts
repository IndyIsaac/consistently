import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { liveSession } from "@/lib/queries";

/* ---------------------------------------------------------------------------
 * The viewer's photo, from the database to the thing the header draws.
 *
 * The upload worked and the photo was stored; every surface still showed
 * initials, because ViewerUser had no avatar field for the value to travel in.
 * This is the round trip that was missing, pinned against a real row.
 * ------------------------------------------------------------------------- */

async function viewer(avatarUrl: string | null) {
  const stamp = crypto.randomUUID();
  return prisma.user.create({
    data: {
      privyId: `p-${stamp}`,
      walletAddress: `w-${stamp}`,
      displayName: "Nam Bouchara",
      avatarUrl,
    },
  });
}

describe("the viewer's avatar reaching the screen", () => {
  it("carries a stored photo through to the session the header reads", async () => {
    const url = "https://abc123.public.blob.vercel-storage.com/uploads/xyz";
    const user = await viewer(url);

    const session = await liveSession(user, new Date());
    expect(session.user.avatarUrl).toBe(url);
    // Initials still travel: they are the fallback when the image will not load.
    expect(session.user.initials).toBe("NB");

    await prisma.user.delete({ where: { id: user.id } });
  });

  it("carries null for a member who has not set one", async () => {
    const user = await viewer(null);
    const session = await liveSession(user, new Date());
    expect(session.user.avatarUrl).toBeNull();
    await prisma.user.delete({ where: { id: user.id } });
  });

  it("survives a save through /api/me", async () => {
    // The other half of the reported bug: the photo is only persisted when the
    // form is saved, and the header reads the saved value, not the form's.
    const user = await viewer(null);
    const url = "https://abc123.public.blob.vercel-storage.com/uploads/saved";

    await prisma.user.update({ where: { id: user.id }, data: { avatarUrl: url } });
    const fresh = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    const session = await liveSession(fresh, new Date());
    expect(session.user.avatarUrl).toBe(url);

    await prisma.user.delete({ where: { id: user.id } });
  });
});
