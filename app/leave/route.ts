import { NextRequest, NextResponse } from "next/server";

/* ---------------------------------------------------------------------------
 * GET /leave -- drop a session cookie the server cannot use, and go to the door.
 *
 * The loop this exists to break: proxy.ts decides who is signed in by testing
 * whether `privy-token` is *present*, because verifying it at the edge means
 * the secret and the round trip. app/(app)/layout.tsx then calls gate(), which
 * actually verifies, and a token that is present but does not verify comes back
 * "signed-out" -- so the layout redirected to `/`, the proxy saw a cookie and
 * sent them straight back to /dashboard, and nothing anywhere ever deleted it.
 * ERR_TOO_MANY_REDIRECTS, with the sign-in screen unreachable.
 *
 * It is not exotic. A rotated Privy app secret does it, so does a revoked
 * session, so does a token that outlived its signature. Every one of them ends
 * with a member who cannot get in and cannot get to the door to try.
 *
 * Deleting the cookie is what makes the next step possible rather than just
 * different. components/FrontDoor.tsx finds no cookie, asks Privy for a fresh
 * token, and posts it to /api/session, which mints a cookie the server can
 * actually read -- so an expired token recovers by itself. If the token is
 * genuinely dead the door says so in a sentence, which is the honest end and
 * still not a loop.
 *
 * A route handler because a Server Component cannot write a cookie; the layout
 * redirects here instead of to `/`.
 * ------------------------------------------------------------------------- */

export async function GET(req: NextRequest) {
  const res = NextResponse.redirect(new URL("/", req.url));
  res.cookies.delete("privy-token");
  return res;
}
