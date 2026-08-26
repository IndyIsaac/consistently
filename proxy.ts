import { NextResponse, type NextRequest } from "next/server";

/* ---------------------------------------------------------------------------
 * Redirects, and nothing else.
 *
 * Next 16 renamed the `middleware` convention to `proxy`, and its docs are
 * explicit that this runs separately from the render code and must not rely on
 * shared modules or globals. So this file only ever asks whether a cookie is
 * present -- no crypto, no database, no RPC.
 *
 * The authority is app/(app)/layout.tsx, which verifies the token's signature
 * and reads the funding stamp. A forged `privy-token` gets you past this file
 * and no further. That split is deliberate: the cheap check runs on every
 * navigation, the real one runs where a row is being read anyway.
 * ------------------------------------------------------------------------- */

const PRIVY_TOKEN = "privy-token";
export const INVITE_COOKIE = "pact-invite";

/**
 * With no Privy app there is no sign-in to enforce, and the whole app is the
 * demo in lib/mock-session.ts. Redirecting on a cookie that can never be set
 * would lock the zero-env-var path out of its own dashboard.
 */
const SIGN_IN_ENFORCED = (process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "").length > 0;

/** The signed-in interior. `/pacts` covers `/pacts/[id]` and `/pacts/new`. */
const INTERIOR = ["/dashboard", "/groups", "/pacts", "/settings"];

export function proxy(req: NextRequest) {
  const url = req.nextUrl;

  /**
   * The invite QR encodes `/?invite=<token>`, and the token has to survive
   * sign-in and the whole of onboarding before anything can redeem it. A
   * server component cannot set a cookie, so it is caught here -- on any path,
   * because a returning member may land deeper than the front door -- moved
   * into a cookie, and stripped from the URL so it is not carried around or
   * pasted into a screenshot.
   */
  const invite = url.searchParams.get("invite");
  if (invite) {
    const clean = new URL(url);
    clean.searchParams.delete("invite");
    const res = NextResponse.redirect(clean);
    res.cookies.set(INVITE_COOKIE, invite, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60,
      path: "/",
    });
    return res;
  }

  if (!SIGN_IN_ENFORCED) return NextResponse.next();

  const signedIn = req.cookies.has(PRIVY_TOKEN);
  const interior = INTERIOR.some((p) => url.pathname === p || url.pathname.startsWith(`${p}/`));

  if (interior && !signedIn) return NextResponse.redirect(new URL("/", url));
  if (url.pathname === "/welcome" && !signedIn) return NextResponse.redirect(new URL("/", url));

  // Somebody already through the door has no use for the door. Whether they
  // are actually let in is the layout's decision -- it may bounce them to
  // /welcome, which costs one hop and keeps the funding check in one place.
  if (url.pathname === "/" && signedIn) return NextResponse.redirect(new URL("/dashboard", url));

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|mock|api).*)"],
};
