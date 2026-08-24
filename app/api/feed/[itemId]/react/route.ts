import { NextRequest, NextResponse } from "next/server";
import { toggleReaction } from "@/app/api/pacts/[id]/feed/route";

export async function POST(req: NextRequest, ctx: { params: Promise<{ itemId: string }> }) {
  const { itemId } = await ctx.params;

  try {
    const { userWallet, emoji } = await req.json();

    if (typeof emoji !== "string" || emoji.length > 8) {
      return NextResponse.json({ error: "invalid emoji" }, { status: 400 });
    }
    if (typeof userWallet !== "string" || userWallet.length === 0) {
      return NextResponse.json({ error: "invalid userWallet" }, { status: 400 });
    }

    return NextResponse.json(await toggleReaction(itemId, userWallet, emoji));
  } catch (e) {
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
