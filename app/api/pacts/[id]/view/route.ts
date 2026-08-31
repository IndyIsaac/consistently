import { NextRequest, NextResponse } from "next/server";
import { requireUser, UnauthorizedError } from "@/lib/auth";
import { livePact } from "@/lib/queries";

/* ---------------------------------------------------------------------------
 * GET /api/pacts/[id]/view
 *
 * What the pact screen redraws itself from. components/Channel.tsx polls this
 * every five seconds -- the clock keeps moving whether or not anyone touches
 * the screen, and a day ending is the commonest way a cadence goes out of
 * reach.
 *
 * Everything crosses as JSON, so every `Date` here becomes an ISO string and
 * the client revives them. That is not cosmetic: `channelView` ->
 * `weekDayMarks` -> `isValidSession` calls `.getTime()` on those fields, and a
 * string would not throw -- it would quietly produce the wrong day count.
 * ------------------------------------------------------------------------- */

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

  const pact = await livePact(id, user, new Date());
  if (!pact) return NextResponse.json({ error: "No such pact" }, { status: 404 });

  // Only members see a crew's standings.
  if (!pact.crew.some((m) => m.userId === user.id)) {
    return NextResponse.json({ error: "You are not in this crew." }, { status: 403 });
  }

  return NextResponse.json(pact);
}
