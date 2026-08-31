"use client";

import { getAccessToken } from "@privy-io/react-auth";
import type { FeedItemDto } from "@/app/api/pacts/[id]/feed/route";
import type { PactView } from "@/lib/view";

/* ---------------------------------------------------------------------------
 * The channel's transport.
 *
 * Every function here has the same signature and the same resolved shape as
 * its counterpart in lib/mock-session.ts, so components/Channel.tsx is
 * unchanged apart from the import. Which of the two is behind it is decided
 * once, here, by whether this deployment has a Privy app -- the same condition
 * lib/session.ts uses on the server.
 *
 * Two things this has to get right that the mock did not have to:
 *
 * 1. REVIVING DATES. Over JSON, `startsAt` and every session's `startedAt` and
 *    `endedAt` arrive as strings. `channelView` -> `weekDayMarks` ->
 *    `isValidSession` calls `.getTime()` on them, and a string does not throw
 *    there -- it silently produces the wrong day count, on every screen, with
 *    no error anywhere. The mock never had this problem because it hands the
 *    client real Date objects in the same realm.
 *
 * 2. TELLING A REFUSAL FROM A FAULT. The routes already draw that line: a
 *    guard the member is meant to read comes back 400 with a sentence, and
 *    anything else is a generic 500 (Prisma's messages embed absolute source
 *    paths). `ChannelError` is the 400 half, and `Channel.capture()` branches
 *    on exactly that distinction.
 *
 *    That line had a hole in it, and everything fell through: 401. It is not a
 *    fault and it is not a guard, it is a session that aged out, and it was
 *    thrown as a plain Error. `Channel.capture()` rethrows anything that is
 *    not a `ChannelError`, and `CheckInCamera` awaits it with no catch -- so
 *    the rejection went unhandled and the member was told nothing at all. A
 *    channel left open past its token stopped checking in, checking out,
 *    reacting and voting, silently, all five.
 *
 *    So every failure leaves here as a `ChannelError` now. Only the 400 keeps
 *    the server's own sentence; the rest get one written here, because that is
 *    what kept Prisma's absolute paths off the screen in the first place.
 * ------------------------------------------------------------------------- */

const LIVE = (process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "").length > 0;

/** A message the member is meant to see, e.g. "you've got another 15 minutes". */
export class ChannelError extends Error {}

function mock() {
  return import("@/lib/mock-session");
}

/**
 * The channel's clock.
 *
 * Real data runs on wall time. The mock runs one real second to the minute so
 * a thirty-minute rule can be demonstrated in thirty seconds rather than by
 * standing on a stage for half an hour -- so this is the one place that
 * difference lives, rather than an import Channel has to swap.
 */
export function now(): Date {
  if (LIVE) return new Date();
  // Synchronous, because the elapsed counter ticks every second. The mock
  // module is already loaded by then; before it is, wall time is close enough
  // for one frame.
  return mockClock?.() ?? new Date();
}

let mockClock: (() => Date) | null = null;
if (!LIVE) {
  void mock().then((m) => {
    mockClock = m.mockNow;
  });
}

async function send(path: string, body: unknown): Promise<Record<string, unknown>> {
  /**
   * The bearer, not just the cookie.
   *
   * This sent neither, and leaned entirely on `privy-token`. But that cookie
   * carries an access token with an expiry, and `privyIdFromCookie` verifies
   * it -- so once it aged out the routes answered 401 and every button in the
   * channel stopped working. The client SDK holds a fresh token the whole
   * time; nothing was asking it for one. Onboarding and ProfileForm both
   * already do exactly this, which is why they kept working.
   */
  const token = await getAccessToken().catch(() => null);

  let res: Response;
  try {
    res = await fetch(path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
  } catch {
    // A phone at the back of a gym. Worth a sentence, not a stack trace.
    throw new ChannelError("No connection. Try that again.");
  }

  const json = await res.json().catch(() => ({}));
  if (res.ok) return json as Record<string, unknown>;

  if (res.status === 400 && typeof json.error === "string") throw new ChannelError(json.error);
  if (res.status === 401) {
    throw new ChannelError("Your sign-in expired. Refresh the page and try that again.");
  }
  throw new ChannelError("That did not go through. Try again.");
}

/** See note 1 above. Silent, not loud, if it is missed. */
function revivePactView(raw: PactView): PactView {
  return {
    ...raw,
    startsAt: new Date(raw.startsAt),
    pendingExemption: raw.pendingExemption
      ? { ...raw.pendingExemption, createdAt: new Date(raw.pendingExemption.createdAt) }
      : null,
    crew: raw.crew.map((member) => ({
      ...member,
      sessions: member.sessions.map((s) => ({
        startedAt: new Date(s.startedAt),
        endedAt: s.endedAt === null ? null : new Date(s.endedAt),
      })),
    })),
  };
}

export async function getPact(pactId: string): Promise<PactView | null> {
  if (!LIVE) return (await mock()).getPact(pactId);

  const res = await fetch(`/api/pacts/${pactId}/view`);
  if (!res.ok) return null;
  return revivePactView((await res.json()) as PactView);
}

export async function getChannel(pactId: string, viewerWallet: string): Promise<FeedItemDto[]> {
  if (!LIVE) return (await mock()).getChannel(pactId, viewerWallet);

  const res = await fetch(
    `/api/pacts/${pactId}/feed?viewer=${encodeURIComponent(viewerWallet)}`,
  );
  if (!res.ok) return [];
  return (await res.json()) as FeedItemDto[];
}

export async function openSession(params: {
  pactId: string;
  userWallet: string;
  photoUrl: string | null;
}): Promise<{ sessionId: string }> {
  if (!LIVE) return (await mock()).mockOpenSession(params);

  const body = await send(`/api/pacts/${params.pactId}/sessions`, {
    action: "open",
    userWallet: params.userWallet,
    photoUrl: params.photoUrl,
  });
  return { sessionId: body.sessionId as string };
}

export async function closeSession(params: {
  pactId: string;
  sessionId: string;
  photoUrl: string | null;
}): Promise<{ durationMins: number }> {
  if (!LIVE) {
    return (await mock()).mockCloseSession({
      sessionId: params.sessionId,
      photoUrl: params.photoUrl,
    });
  }

  const body = await send(`/api/pacts/${params.pactId}/sessions`, {
    action: "close",
    sessionId: params.sessionId,
    photoUrl: params.photoUrl,
  });
  return { durationMins: body.durationMins as number };
}

export async function toggleReaction(
  pactId: string,
  itemId: string,
  emoji: string,
): Promise<{ on: boolean }> {
  if (!LIVE) return (await mock()).mockToggleReaction(pactId, itemId, emoji);

  // No wallet: the route takes it from the verified token now, and a body that
  // can name who reacted is a body that can name somebody else.
  const body = await send(`/api/feed/${itemId}/react`, { emoji });
  return { on: body.on as boolean };
}

export async function requestExemption(params: {
  pactId: string;
  userWallet: string;
  periodKey: string;
  reason: string;
}): Promise<{ exemptionId: string }> {
  if (!LIVE) return (await mock()).mockRequestExemption(params);

  const body = await send(`/api/pacts/${params.pactId}/exemptions`, {
    action: "request",
    userWallet: params.userWallet,
    periodKey: params.periodKey,
    reason: params.reason,
  });
  return { exemptionId: body.exemptionId as string };
}

export async function castVote(params: {
  pactId: string;
  exemptionId: string;
  userWallet: string;
  approve: boolean;
}): Promise<{ status: "pending" | "granted" | "denied"; approvals: number; needed: number }> {
  if (!LIVE) return (await mock()).mockCastVote(params);

  const body = await send(`/api/pacts/${params.pactId}/exemptions`, {
    action: "vote",
    exemptionId: params.exemptionId,
    userWallet: params.userWallet,
    approve: params.approve,
  });
  return body as { status: "pending" | "granted" | "denied"; approvals: number; needed: number };
}
