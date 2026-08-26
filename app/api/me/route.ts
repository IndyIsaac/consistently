import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
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
  } catch {
    // The only expected failure is the @unique collision on walletAddress:
    // somebody is claiming an address already paired with another sign-in.
    return NextResponse.json(
      { error: "That wallet is already linked to another account." },
      { status: 409 },
    );
  }
}
