import { NextRequest, NextResponse } from "next/server";
import { PRIVY_CONFIGURED, privyIdFromRequest } from "@/lib/auth";

/* ---------------------------------------------------------------------------
 * POST /api/session -- put the session in a cookie the server can read, when
 * the browser would not do it itself.
 *
 * Privy writes `privy-token` from JavaScript, and the write can silently fail
 * to stick. Its expiry is the token's own `exp` as an absolute date, so a
 * machine whose clock runs fast is handed a cookie that is already expired and
 * discards it without a word. Confirmed in Railway's own HTTP logs: a member
 * signed in, the door sent them to /dashboard, proxy.ts found no cookie and
 * bounced them back, four times over. Privy said they were authenticated the
 * whole time, and they were -- the token was fine and never reached us.
 *
 * So the client hands us the token it already holds, we verify it exactly as
 * every other route does, and we set the cookie ourselves.
 *
 * `Max-Age`, not `Expires`. That is the point of the whole file: a relative
 * lifetime is never compared against the browser's clock, so a wrong clock
 * cannot expire it on arrival. Whatever was interfering with the JS write --
 * clock, extension, quirk we never diagnosed -- a Set-Cookie from here is not
 * subject to it.
 *
 * This grants nothing. `verifyAuthToken` is the same check `privyIdFromCookie`
 * runs, so a caller who is not signed in gets 401 and no cookie. It moves a
 * credential the client already had into the only place the server looks.
 *
 * A FALLBACK, AND ONLY THAT. components/FrontDoor.tsx calls it after its own
 * check has already failed, so the ordinary path never reaches this file. If
 * it fails, a member sees exactly what they saw before it existed.
 * ------------------------------------------------------------------------- */

const COOKIE = "privy-token";

/** An hour, unless the token says it has less left than that. */
const MAX_LIFETIME_S = 60 * 60;

/**
 * Seconds the cookie should live, from the token's own `exp`.
 *
 * The token is already verified by the time this runs, so reading its payload
 * is reading something the signature has vouched for. A token whose expiry
 * cannot be read is given the default rather than refused: the cookie is only
 * a carrier, and every route re-verifies the token inside it anyway, so an
 * over-long cookie ends in a redirect rather than in access.
 */
export function cookieLifetime(token: string, now: number = Date.now()): number {
  try {
    const [, payload] = token.split(".");
    const exp = JSON.parse(Buffer.from(payload, "base64url").toString()).exp;
    if (typeof exp !== "number") return MAX_LIFETIME_S;

    const left = Math.floor(exp - now / 1000);
    return Math.min(MAX_LIFETIME_S, Math.max(0, left));
  } catch {
    return MAX_LIFETIME_S;
  }
}

export async function POST(req: NextRequest) {
  if (!PRIVY_CONFIGURED) {
    return NextResponse.json({ error: "Sign-in is not configured" }, { status: 503 });
  }

  const token = req.headers.get("authorization")?.replace(/^Bearer /i, "");
  if (!token) return NextResponse.json({ error: "No token" }, { status: 401 });

  // The same verification every other route performs. Nothing is trusted here
  // that is not trusted everywhere else.
  const privyId = await privyIdFromRequest(req);
  if (!privyId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const maxAge = cookieLifetime(token);
  if (maxAge === 0) return NextResponse.json({ error: "That token has expired" }, { status: 401 });

  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE, token, {
    /**
     * Readable by script, deliberately: components/FrontDoor.tsx checks
     * `document.cookie` before it navigates, and a cookie it cannot see would
     * leave the door refusing to cross a threshold the server would have
     * allowed. This carries a token the client handed us in the first place,
     * so httpOnly would hide it from nobody who does not already have it.
     */
    httpOnly: false,
    /**
     * `Lax`, where Privy uses `Strict`. Strict withholds the cookie from the
     * first request of a cross-site landing -- somebody following an invite
     * link out of a chat app -- which is the case this whole path exists to
     * rescue. Lax sends it on a top-level navigation and still withholds it
     * from cross-site subrequests.
     */
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  });
  return res;
}
