import type { RuleConfig, SessionRecord } from "@/lib/rules";
import type { LeaderRow } from "@/lib/stats";

/* ---------------------------------------------------------------------------
 * What a screen is handed, regardless of where it came from.
 *
 * Types only -- this file imports nothing that touches Prisma, the network or
 * the mock, so both lib/queries.ts (real) and lib/mock-session.ts (fallback)
 * can satisfy it without either one knowing about the other.
 *
 * The shapes are the mock's, because the mock was written against Prisma's
 * column names on purpose. They moved here rather than being re-derived so
 * that lib/channel-view.ts keeps its structural typing: it still declares its
 * own `ChannelPactInput` and never imports from here, which is what lets the
 * pact screen be fed by either source without a cast.
 * ------------------------------------------------------------------------- */

/** Prisma `User`, plus the initials no column holds. */
export type ViewerUser = {
  id: string;
  privyId: string;
  walletAddress: string;
  displayName: string;
  initials: string;
  /**
   * The photo, when there is one. Initials are the fallback, not the only
   * option -- this type carried no avatar at all, so a member could set a
   * profile picture, see it in the form's own preview, and then find every
   * other place in the product still showing their initials. The photo was
   * stored and unreachable.
   */
  avatarUrl: string | null;
};

/** `LeaderRow` from lib/stats.ts, plus the `Membership` columns a row draws. */
export type CrewMember = LeaderRow & {
  /** Prisma `Membership.userId`. `memberId` (from LeaderRow) is the membership id. */
  userId: string;
  initials: string;
  /** Prisma `MemberStatus`. */
  status: "invited" | "staked" | "passed" | "failed" | "left";
  isViewer: boolean;
  /** Money forfeited across every settled period so far, in the pact's currency. */
  forfeitedToDate: number;
  /** Periods this member has forfeited in. */
  forfeitedPeriods: number;
  /**
   * THE CURRENT PERIOD ONLY. `countValidDays` and `hasFailed` both document this
   * as a precondition -- they count every day key handed to them and do not
   * window by `rule.period` themselves. A lifetime list here silently inflates
   * every standing on screen and stops anyone ever failing.
   */
  sessions: SessionRecord[];
};

/** Prisma `Exemption`, plus the tally and the two facts no column holds. */
export type PendingExemption = {
  id: string;
  membershipId: string;
  /** The first day of the period being asked about, in the crew's timezone. */
  periodKey: string;
  reason: string;
  /** Prisma `ExemptionStatus`. */
  status: "pending" | "granted" | "denied";
  createdAt: Date;
  approvals: number;
  needed: number;
  requesterName: string;
  /** Whether the viewer has a `Vote` row -- or is the requester, who cannot vote. */
  viewerVoted: boolean;
};

export type PactView = {
  id: string;
  name: string;
  inviteToken: string;
  ruleConfig: RuleConfig;
  timezone: string;
  stakeAmount: number;
  stakeCurrency: string;
  /** Prisma `PactStatus`. */
  status: "funding" | "active" | "settled";
  startsAt: Date;
  /** Periods already settled -- the periods the money has actually moved for. */
  settledPeriods: number;
  crew: CrewMember[];
  /** The viewer's `Membership.id` in this pact. */
  viewerMemberId: string;
  /** The viewer's take and loss in this pact, in `stakeCurrency`. */
  viewerEarned: number;
  viewerLost: number;
  /** The one exemption still waiting on the crew, if there is one. */
  pendingExemption: PendingExemption | null;

  // --- what the money path needs and no screen drew before -----------------

  /** Where a stake is delivered. Public; the key that spends it is not. */
  vaultAddress: string;
  /**
   * `Pact.stakeUsdc` as a decimal string, never a number. JSON.stringify throws
   * on a BigInt, and atomic units at six decimals leave safe-integer range for
   * a large enough stake.
   */
  stakeUsdc: string;
  /** The viewer's own `Membership.status` -- what the stake panel switches on. */
  viewerStatus: CrewMember["status"];
  /**
   * The viewer's unclosed `Session`, if any. Seeded from the server so a page
   * refresh, a tab the phone discarded, or a walk through the Groups link does
   * not lose an open session -- see the note in components/Channel.tsx.
   *
   * `startedAt` is milliseconds, not a Date: this crosses from a server
   * component into a client one, and it feeds an elapsed-minutes count.
   */
  viewerOpenSession: { sessionId: string; startedAt: number } | null;
};

export type AppSession = {
  user: ViewerUser;
  now: Date;
  /**
   * The currency the dashboard totals in. Pacts each carry their own
   * `stakeCurrency`, so anything summed across them must be converted through
   * each pact's locked rate first -- see `lib/queries.ts`.
   */
  currency: string;
  pacts: PactView[];
};

/**
 * "Nat Suwannarat" -> "NS", "Indy" -> "IN". No column holds this, and three
 * components draw it, so it is derived in one place.
 *
 * A one-word name takes two letters from that word rather than one. Avatars sit
 * in a row -- a lone "I" beside "NS" and "PC" reads as a rendering fault rather
 * than as a shorter name.
 */
export function initialsOf(displayName: string): string {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return parts
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
}
