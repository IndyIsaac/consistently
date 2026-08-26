import type { FeedItemDto } from "@/app/api/pacts/[id]/feed/route";
import { currentUser, DB_CONFIGURED, PRIVY_CONFIGURED } from "@/lib/auth";
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
  if (!LIVE) return (await mock()).getChannel(pactId, viewerWallet);

  const { getFeed } = await import("@/app/api/pacts/[id]/feed/route");
  return getFeed(pactId, viewerWallet);
}
