import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { privyIdFromRequest, PRIVY_CONFIGURED } from "@/lib/auth";
import { prisma } from "@/lib/db";

/* ---------------------------------------------------------------------------
 * POST /api/me -- the one write that turns a Privy sign-in into a row.
 *
 * Privy creates the embedded Solana wallet in the browser, so the server
 * cannot learn the address from the token alone. The client posts it here once,
 * after login, and this route pairs it with a *verified* Privy user id.
 *
 * The address is written on create and never on update. The client is asserting
 * its own wallet, and while a lie cannot move money -- every transaction is
 * signed by the real key -- it could otherwise be used to overwrite somebody
 * else's address later. Create-only, plus the @unique column, closes that
 * without any further ceremony.
 * ------------------------------------------------------------------------- */

const BodySchema = z.object({
  walletAddress: z.string().min(32).max(44),
  displayName: z.string().min(1).max(40),
});

export async function POST(req: NextRequest) {
  if (!PRIVY_CONFIGURED) {
    return NextResponse.json({ error: "Sign-in is not configured" }, { status: 503 });
  }

  const privyId = await privyIdFromRequest(req);
  if (!privyId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const parsed = BodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "walletAddress and displayName are required" }, { status: 400 });
  }
  const { walletAddress, displayName } = parsed.data;

  try {
    const user = await prisma.user.upsert({
      where: { privyId },
      update: { displayName },
      create: { privyId, walletAddress, displayName },
    });

    return NextResponse.json({
      id: user.id,
      walletAddress: user.walletAddress,
      displayName: user.displayName,
      funded: user.walletFundedAt !== null,
    });
  } catch (e) {
    /**
     * Only P2002 means what this used to say.
     *
     * The collision on walletAddress -- somebody claiming an address already
     * paired with another sign-in -- was the expected failure, and every other
     * one was reported as it. A first-time member meeting a cold database was
     * told their wallet belonged to somebody else: a sentence that is wrong,
     * unactionable, and sticks, because Onboarding latches on the error and
     * offers no way to try again.
     */
    if (typeof e === "object" && e !== null && "code" in e && e.code === "P2002") {
      return NextResponse.json(
        { error: "That wallet is already linked to another account." },
        { status: 409 },
      );
    }
    console.error("POST /api/me failed:", e instanceof Error ? e.message : e);
    return NextResponse.json(
      { error: "Could not finish setting up this account. Try again in a moment." },
      { status: 500 },
    );
  }
}

/* ---------------------------------------------------------------------------
 * PATCH /api/me -- name, face, one sentence, where else you are, and the
 * email that gets you back in.
 *
 * Every field here is optional and independently overwritable, which is why
 * the client only sends what changed: an absent key leaves that column alone
 * instead of clearing it. walletAddress is not in the schema below at all, for
 * the same reason it is absent from the POST's update branch above -- it is
 * write-on-create only.
 *
 * bio and avatarUrl are also `.nullable()`, which displayName and email are
 * not: those two are things you clear back to nothing (an empty bio reads as
 * "no bio", not as the literal empty string), and Prisma's own vocabulary for
 * a `String?` column already has a value for that -- null. JSON.stringify
 * drops `undefined` keys entirely, so a client sending `undefined` to mean
 * "clear this" would instead omit the key and leave the old value in place;
 * null is the only value that reaches Prisma and means what the client wants.
 *
 * email carries the same @unique collision risk as walletAddress above, and
 * for the same reason: two sign-ins recovering into the same address would
 * let one hand its stakes to the other. The try/catch below answers it the
 * same way the POST handler answers its own.
 * ------------------------------------------------------------------------- */

const PatchSchema = z.object({
  displayName: z.string().min(1).max(40).optional(),
  bio: z.string().max(280).nullable().optional(),
  avatarUrl: z.string().url().nullable().optional(),
  /**
   * The four the profile form offers, and no others.
   *
   * `z.record(z.string(), ...)` accepted any key and any number of them, so a
   * signed-in caller could PATCH an arbitrarily large JSON blob into a column
   * nothing else bounds. `z.object` strips what it does not name, which makes
   * the allowlist and the cap the same line: four keys, 200 characters each.
   */
  socials: z
    .object({
      x: z.string().max(200),
      github: z.string().max(200),
      instagram: z.string().max(200),
      telegram: z.string().max(200),
    })
    .partial()
    .optional(),
  email: z.string().email().optional(),
});

export async function PATCH(req: NextRequest) {
  if (!PRIVY_CONFIGURED) {
    return NextResponse.json({ error: "Sign-in is not configured" }, { status: 503 });
  }
  const privyId = await privyIdFromRequest(req);
  if (!privyId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const parsed = PatchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Nothing valid to update." }, { status: 400 });
  }

  try {
    // walletAddress is deliberately absent: it is write-on-create only, for
    // the reason given above the POST handler.
    const user = await prisma.user.update({ where: { privyId }, data: parsed.data });
    return NextResponse.json({
      displayName: user.displayName,
      bio: user.bio,
      avatarUrl: user.avatarUrl,
      socials: user.socials,
      email: user.email,
    });
  } catch (err) {
    // P2002 is Prisma's unique-constraint violation, and email is the only
    // column here that carries one -- so it is the only failure this checks
    // for by name. Anything else (a dropped connection, a row that vanished
    // mid-request) is a real failure and is reported as one, not relabeled as
    // an email collision it was never about.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json(
        { error: "That email is already linked to another account." },
        { status: 409 },
      );
    }
    console.error("PATCH /api/me failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Could not save." }, { status: 500 });
  }
}
