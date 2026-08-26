import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { addMember, findOpenPact, JoinError } from "@/app/api/pacts/join/route";
import { INVITE_COOKIE } from "@/proxy";

/* ---------------------------------------------------------------------------
 * GET /join -- redeems the invite the proxy stashed, then gets out of the way.
 *
 * A route handler rather than a page because this has to clear the cookie, and
 * a server component cannot. It is the last hop of the scan: QR -> sign in ->
 * fund -> here -> the channel, ready to stake.
 *
 * The cookie is cleared on every outcome, including the refusals. An invite
 * that cannot be redeemed will not start working later, and leaving it set
 * would bounce the member through this route on every visit for an hour.
 * ------------------------------------------------------------------------- */

function to(path: string, req: NextRequest) {
  const res = NextResponse.redirect(new URL(path, req.nextUrl));
  res.cookies.delete(INVITE_COOKIE);
  return res;
}

export async function GET(req: NextRequest) {
  const token = req.cookies.get(INVITE_COOKIE)?.value;
  if (!token) return NextResponse.redirect(new URL("/dashboard", req.nextUrl));

  let user;
  try {
    user = await requireUser(req);
  } catch {
    // Signed out, or here before onboarding wrote a row. Either way /welcome is
    // the right room, and the invite stays set so it can be redeemed after.
    return NextResponse.redirect(new URL("/welcome", req.nextUrl));
  }

  try {
    const pact = await findOpenPact(token);
    const { pactId } = await addMember(pact.id, user.id);
    return to(`/pacts/${pactId}`, req);
  } catch (e) {
    if (e instanceof JoinError) {
      // The crew already started, or the link is dead. Neither is worth an
      // error page: the dashboard says what they do have.
      //
      // Not `?invite=` -- the proxy captures that parameter on any path and
      // would set the cookie straight back, from the very redirect that is
      // meant to clear it.
      return to("/dashboard?crew=closed", req);
    }
    throw e;
  }
}
