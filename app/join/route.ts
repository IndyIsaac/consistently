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

/**
 * A relative Location, deliberately.
 *
 * `NextResponse.redirect` demands an absolute URL, and the only origin a route
 * handler can see is the one the container was actually addressed on. Behind
 * Railway that is `localhost:8080`, not the public host -- so a redirect built
 * from `req.nextUrl` sent the member to a machine that is not theirs. The QR
 * scan is the whole point of this route, and it was broken on every device
 * except the server itself.
 *
 * The proxy builds redirects the same way and is fine, which is what made this
 * hard to see: middleware rewrites its own Location to a relative path before
 * it goes out. A route handler ships whatever it was handed.
 *
 * RFC 7231 allows a relative reference in Location, and the browser resolves it
 * against the address it actually asked for -- which is the public one.
 */
function redirectTo(path: string) {
  return new NextResponse(null, { status: 307, headers: { location: path } });
}

function to(path: string) {
  const res = redirectTo(path);
  res.cookies.delete(INVITE_COOKIE);
  return res;
}

export async function GET(req: NextRequest) {
  const token = req.cookies.get(INVITE_COOKIE)?.value;
  if (!token) return redirectTo("/dashboard");

  let user;
  try {
    user = await requireUser(req);
  } catch {
    // Signed out, or here before onboarding wrote a row. Either way /welcome is
    // the right room, and the invite stays set so it can be redeemed after.
    return redirectTo("/welcome");
  }

  try {
    const pact = await findOpenPact(token);
    const { pactId } = await addMember(pact.id, user.id);
    return to(`/pacts/${pactId}`);
  } catch (e) {
    if (e instanceof JoinError) {
      // The crew already started, or the link is dead. Neither is worth an
      // error page: the dashboard says what they do have.
      //
      // Not `?invite=` -- the proxy captures that parameter on any path and
      // would set the cookie straight back, from the very redirect that is
      // meant to clear it.
      return to("/dashboard?crew=closed");
    }
    throw e;
  }
}
