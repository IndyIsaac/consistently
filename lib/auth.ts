import { cookies } from "next/headers";
import { PrivyClient } from "@privy-io/server-auth";
import { prisma } from "@/lib/db";
import type { User } from "@prisma/client";

/* ---------------------------------------------------------------------------
 * Who is signed in, on the server.
 *
 * Privy runs in the browser, so the server learns the user from the access
 * token Privy leaves in the `privy-token` cookie (server components) or that
 * the client sends as a bearer (route handlers). Either way the token is
 * verified against the app's signing key before a single row is read -- the
 * point of this file is that nothing downstream has to be told who the caller
 * is and believe it.
 *
 * PRODUCT.md records "no authentication in v1: requests name a wallet and are
 * believed" as a known limitation, and most routes still work that way. The
 * ones that move money or read across pacts do not, and they call `requireUser`
 * below.
 *
 * With no app id and secret -- the zero-env-var path -- every function here
 * resolves to null and the caller falls back to lib/mock-session.ts. It never
 * throws for want of configuration, because a missing env var must degrade to
 * the demo, not to a stack trace on the landing page.
 * ------------------------------------------------------------------------- */

const APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";
const APP_SECRET = process.env.PRIVY_APP_SECRET ?? "";

/** Both halves are needed: the id alone cannot verify a signature. */
export const PRIVY_CONFIGURED = APP_ID.length > 0 && APP_SECRET.length > 0;

export const DB_CONFIGURED = (process.env.DATABASE_URL ?? "").length > 0;

let client: PrivyClient | null = null;

function privy(): PrivyClient {
  client ??= new PrivyClient(APP_ID, APP_SECRET);
  return client;
}

/** The cookie Privy writes for server-side reads. */
const TOKEN_COOKIE = "privy-token";

async function verify(token: string | undefined): Promise<string | null> {
  if (!PRIVY_CONFIGURED || !token) return null;
  try {
    const claims = await privy().verifyAuthToken(token);
    return claims.userId;
  } catch {
    // Expired, malformed, or signed for another app. All three mean the same
    // thing to a caller -- nobody is signed in -- and none of them is worth
    // surfacing a Privy error message for.
    return null;
  }
}

/** The verified Privy user id from the cookie, for server components. */
export async function privyIdFromCookie(): Promise<string | null> {
  if (!PRIVY_CONFIGURED) return null;

  /**
   * `cookies()` throws outside a request scope, and that throw is not an
   * authentication failure -- it escaped as a 500, so a route that meant to
   * answer "nobody is signed in" answered "something broke" instead. Outside
   * a request there is no jar, which is indistinguishable from an empty one:
   * either way nobody is signed in, and that is a thing every caller here
   * already knows how to say.
   */
  let jar;
  try {
    jar = await cookies();
  } catch {
    return null;
  }
  return verify(jar.get(TOKEN_COOKIE)?.value);
}

/**
 * The verified Privy user id for a route handler. Prefers the bearer the client
 * sends explicitly and falls back to the cookie, so a fetch that forgot the
 * header still works from a browser and a call from outside one still can.
 */
export async function privyIdFromRequest(req: Request): Promise<string | null> {
  if (!PRIVY_CONFIGURED) return null;

  const bearer = req.headers.get("authorization")?.replace(/^Bearer /i, "");
  return (await verify(bearer)) ?? privyIdFromCookie();
}

/** The signed-in user's row, or null when nobody is signed in or none exists yet. */
export async function currentUser(): Promise<User | null> {
  if (!DB_CONFIGURED) return null;
  const privyId = await privyIdFromCookie();
  if (!privyId) return null;
  return prisma.user.findUnique({ where: { privyId } });
}

/** Thrown when a route that moves money cannot name its caller. */
export class UnauthorizedError extends Error {
  constructor(message = "Not signed in") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

/**
 * The caller's row, or a throw. For the routes where believing the request
 * would mean letting a stranger move somebody else's stake.
 */
export async function requireUser(req: Request): Promise<User> {
  if (!PRIVY_CONFIGURED) {
    throw new UnauthorizedError("Sign-in is not configured on this deployment");
  }
  const privyId = await privyIdFromRequest(req);
  if (!privyId) throw new UnauthorizedError();

  const user = await prisma.user.findUnique({ where: { privyId } });
  if (!user) throw new UnauthorizedError("No account for this sign-in yet");
  return user;
}
