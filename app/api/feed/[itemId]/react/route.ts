import { NextRequest, NextResponse } from "next/server";
import { toggleReaction } from "@/app/api/pacts/[id]/feed/route";
import { UnauthorizedError, requireUser } from "@/lib/auth";

/**
 * The wallet is the caller's own, taken from the verified token.
 *
 * It used to be read from the request body and used as-is, so anyone could
 * react in anybody's name -- and a reaction is attributed by name in the feed,
 * which makes it the crew's voice. Same reasoning as the check-in and exemption
 * routes: a body that names who is acting is a body that can name someone else.
 *
 * With nothing to name, the body carries only the emoji.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ itemId: string }> }) {
  const { itemId } = await ctx.params;

  try {
    const user = await requireUser(req);
    const { emoji } = await req.json();

    if (typeof emoji !== "string" || emoji.length > 8) {
      return NextResponse.json({ error: "invalid emoji" }, { status: 400 });
    }

    return NextResponse.json(await toggleReaction(itemId, user.walletAddress, emoji));
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: 401 });
    }
    // toggleReaction resolves the user with findUniqueOrThrow, whose thrown
    // message embeds an absolute source file path and a code snippet
    // (confirmed for this same pattern in Task 9). Never forward that, or
    // any other unexpected error (malformed JSON body, bad itemId), to the
    // caller -- log it server-side and answer with a generic message,
    // matching app/api/pacts/route.ts and the fixed
    // app/api/pacts/[id]/sessions/route.ts.
    console.error("POST /api/feed/[itemId]/react failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Reaction request failed" }, { status: 500 });
  }
}
