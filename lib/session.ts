import type { FeedItemDto } from "@/app/api/pacts/[id]/feed/route";
import { currentUser, DB_CONFIGURED, privyIdFromCookie, PRIVY_CONFIGURED } from "@/lib/auth";
import type { AppSession, PactView } from "@/lib/view";

/* ---------------------------------------------------------------------------
 * The seam.
 *
 * Every signed-in screen reads this file and does not know, or need to know,
 * whether the rows came from Postgres or from lib/mock-session.ts. It resolves
 * to the mock whenever it cannot name a viewer -- which covers a deployment
 * with no database, one with no Privy app, and a visitor who is simply not
 * signed in, all with the same branch and the same answer.
 *
 * That is what keeps the promise in the README literally true: `npm run dev`
 * with an empty environment still walks from the landing page to a furnished
 * dashboard, because the fallback is the demo rather than an error.
 *
 * The mock is loaded with a dynamic import so it never enters the production
 * server bundle when a database is configured. Deleting the file breaks only
 * the three `mock()` calls below.
 * ------------------------------------------------------------------------- */

/** Whether this deployment can serve real rows to a real signed-in person. */
export const LIVE = DB_CONFIGURED && PRIVY_CONFIGURED;

function mock() {
  return import("@/lib/mock-session");
}

export async function getSession(): Promise<AppSession> {
  const viewer = await currentUser();
  if (!viewer) return (await mock()).getSession();

  const { liveSession } = await import("@/lib/queries");
  return liveSession(viewer, new Date());
}

export async function getPact(id: string): Promise<PactView | null> {
  const viewer = await currentUser();
  if (!viewer) return (await mock()).getPact(id);

  const { livePact } = await import("@/lib/queries");
  return livePact(id, viewer, new Date());
}

export async function getChannel(
  pactId: string,
  viewerWallet: string,
): Promise<FeedItemDto[]> {
  // Branches on the same condition as its siblings above, not on LIVE. A
  // deployment with a database but nobody signed in serves the demo session,
  // and its pact ids are the mock's -- querying the real feed for one would
  // quietly return an empty channel under a furnished header.
  const viewer = await currentUser();
  if (!viewer) return (await mock()).getChannel(pactId, viewerWallet);

  const { getFeed } = await import("@/app/api/pacts/[id]/feed/route");
  return getFeed(pactId, viewerWallet);
}

/**
 * Whether the viewer may enter the interior.
 *
 * - `signed-out` -- no valid token. The proxy usually catches this first; this
 *   is the case it cannot, because a forged or expired cookie is present.
 * - `needs-onboarding` -- signed in, but either no row has been written for
 *   them yet or their wallet has never been seen holding anything.
 * - `ok` -- through. Also the answer on a deployment with no database, where
 *   the whole app is the demo and there is nothing to gate.
 *
 * The funding check is a column read, not an RPC call: `walletFundedAt` is
 * stamped once by GET /api/wallet/balance and never looked at again. So the
 * gate costs one indexed query per navigation, which is the same query the
 * page was about to make anyway.
 */
export type Gate = "ok" | "signed-out" | "needs-onboarding";

export async function gate(): Promise<Gate> {
  if (!LIVE) return "ok";

  const viewer = await currentUser();
  if (viewer) return viewer.walletFundedAt ? "ok" : "needs-onboarding";

  // No row. Either nobody is signed in, or they are and this is their first
  // visit -- and those need different destinations.
  return (await privyIdFromCookie()) ? "needs-onboarding" : "signed-out";
}
