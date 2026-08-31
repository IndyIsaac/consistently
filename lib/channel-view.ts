import type { FeedItemDto } from "@/app/api/pacts/[id]/feed/route";
import type { BotPact } from "@/lib/bot";
import { formatMoney } from "@/lib/money";
import {
  daysLeft,
  ruleSentence,
  weekDayKeys,
  weekDayMarks,
  weekdayName,
  type DayMark,
} from "@/lib/pact-view";
import {
  cadenceOutlook,
  dayKeyFor,
  type CadenceOutlook,
  type RuleConfig,
  type SessionRecord,
} from "@/lib/rules";
import type { LeaderRow } from "@/lib/stats";

/* ---------------------------------------------------------------------------
 * Everything the channel draws, derived once.
 *
 * Structural props, not the mock's own types: this reads a pact the shape the
 * API returns, so deleting lib/mock-session.ts changes nothing here. The server
 * derives the view for the first paint and the client derives it again after
 * every action, from the same function — there is no second implementation of
 * "where does this member stand" anywhere in the product.
 *
 * The result is plain data: numbers, strings and booleans. That is what lets it
 * cross from a server component into the client one without a serialisation
 * question hanging over it.
 * ------------------------------------------------------------------------- */

export type ChannelPactInput = {
  id: string;
  name: string;
  inviteToken: string;
  ruleConfig: RuleConfig;
  timezone: string;
  stakeAmount: number;
  stakeCurrency: string;
  /** The pact's own Solana account. Public; the key that spends it is not. */
  vaultAddress: string;
  /** Prisma `PactStatus`. A pact runs only once everybody has staked. */
  status: "funding" | "active" | "settled";
  crew: (LeaderRow & {
    initials: string;
    isViewer: boolean;
    sessions: SessionRecord[];
    /** `Membership.status` -- who has actually paid. */
    status: string;
  })[];
  viewerEarned: number;
  viewerLost: number;
  pendingExemption: {
    id: string;
    reason: string;
    status: "pending" | "granted" | "denied";
    approvals: number;
    needed: number;
    requesterName: string;
    viewerVoted: boolean;
  } | null;
};

export type ChannelMember = {
  memberId: string;
  displayName: string;
  /** What the bot calls them in a sentence. */
  firstName: string;
  initials: string;
  isViewer: boolean;
  daysDone: number;
  required: number;
  outlook: CadenceOutlook;
  /** The streak row for this member's current period. Plain data, no `Date`s. */
  marks: DayMark[];
};

export type ChannelExemption = {
  id: string;
  requesterName: string;
  reason: string;
  approvals: number;
  needed: number;
  /** The crew is still deciding and the viewer has a vote left to cast. */
  canVote: boolean;
};

export type ChannelView = {
  pactId: string;
  name: string;
  inviteToken: string;
  rule: RuleConfig;
  ruleSentence: string;
  timezone: string;
  /** One member's stake, formatted. */
  stake: string;
  /** The whole crew's stake, formatted. */
  pot: string;
  settlesOn: string;
  /**
   * Null once the pact is running. While it is funding, how many of the crew
   * have paid -- which is the whole of what the screen should be saying.
   */
  funding: { staked: number; of: number } | null;
  /**
   * Where the crew's money actually is, carried to a screen on purpose.
   *
   * The stakes sit in an account this server holds the key to, which
   * docs/security/escrow-protocol.md states in its first sentence. A product
   * that asks four friends to hand it money and then keeps the address to
   * itself is asking for trust it has not earned; the address costs nothing to
   * show and turns the claim into something a member can go and check.
   */
  vaultAddress: string;
  /** The Monday of the current crew-local week — what an exemption is asked about. */
  periodKey: string;
  crew: ChannelMember[];
  viewer: ChannelMember | null;
  /** The same facts, in the shape lib/bot.ts answers commands from. */
  bot: BotPact;
  exemption: ChannelExemption | null;
};

/** The crew-local day the current period settles on, e.g. "Sunday". */
export function settlesOn(timezone: string, now: Date): string {
  return weekdayName(weekDayKeys(timezone, now).at(-1)!);
}

function firstNameOf(displayName: string): string {
  return displayName.split(" ")[0];
}

/**
 * Whether the crew is still waiting on somebody's money, and how far off it is.
 *
 * Null once the pact is running, because then there is nothing to wait for and
 * the standing block below says everything worth saying. While it is funding
 * this is the most important fact on the screen and the channel did not carry
 * it: a pact waiting on half its crew rendered exactly like one that had
 * started, week grid and check-in and all.
 *
 * Somebody who left is not counted on either side. They owe nothing and their
 * absence should not hold the rest of the crew.
 */
/**
 * How many members have actually put money in the vault.
 *
 * `/stake` used to answer this with the size of the crew, which counts everyone
 * invited whether or not they paid, so a funding pact with one payer and three
 * invitations told the channel "Four staked, ฿4,000 in the vault." The vault
 * held ฿1,000. The same count sizes the pot everywhere it is shown.
 *
 * Not `status === "staked"` alone: after a settlement a member is `passed` or
 * `failed`, and both of them staked. fundingStanding below can use the narrower
 * test because it only ever runs while the pact is still funding, when neither
 * of those exists yet.
 */
export function paidCount(crew: { status: string }[]): number {
  return crew.filter((m) => m.status !== "invited" && m.status !== "left").length;
}

export function fundingStanding(
  status: string,
  crew: { status: string }[],
): { staked: number; of: number } | null {
  if (status !== "funding") return null;

  const owing = crew.filter((m) => m.status !== "left");
  return { staked: owing.filter((m) => m.status === "staked").length, of: owing.length };
}

export function channelView(pact: ChannelPactInput, now: Date): ChannelView {
  const crew: ChannelMember[] = pact.crew.map((member) => {
    const marks = weekDayMarks(member.sessions, pact.ruleConfig, pact.timezone, now);
    return {
      memberId: member.memberId,
      displayName: member.displayName,
      firstName: firstNameOf(member.displayName),
      initials: member.initials,
      isViewer: member.isViewer,
      daysDone: member.daysDone,
      required: member.required,
      outlook: cadenceOutlook(member.daysDone, daysLeft(marks), pact.ruleConfig),
      marks,
    };
  });

  const viewer = crew.find((m) => m.isViewer) ?? null;
  const settles = settlesOn(pact.timezone, now);
  const stake = formatMoney(pact.stakeAmount, pact.stakeCurrency);
  const paid = paidCount(pact.crew);
  const pot = formatMoney(pact.stakeAmount * paid, pact.stakeCurrency);

  const exemption = pact.pendingExemption;

  return {
    pactId: pact.id,
    name: pact.name,
    inviteToken: pact.inviteToken,
    rule: pact.ruleConfig,
    ruleSentence: ruleSentence(pact.ruleConfig),
    timezone: pact.timezone,
    stake,
    pot,
    settlesOn: settles,
    vaultAddress: pact.vaultAddress,
    funding: fundingStanding(pact.status, pact.crew),
    periodKey: weekDayKeys(pact.timezone, now)[0],
    crew,
    viewer,
    bot: {
      rule: pact.ruleConfig,
      stake,
      pot,
      staked: paid,
      settlesOn: settles,
      viewerEarned: formatMoney(pact.viewerEarned, pact.stakeCurrency),
      viewerLost: formatMoney(pact.viewerLost, pact.stakeCurrency),
      crew: crew.map((m) => ({
        name: m.firstName,
        daysDone: m.daysDone,
        outlook: m.outlook,
        isViewer: m.isViewer,
      })),
    },
    exemption:
      exemption && exemption.status === "pending"
        ? {
            id: exemption.id,
            requesterName: exemption.requesterName,
            reason: exemption.reason,
            approvals: exemption.approvals,
            needed: exemption.needed,
            canVote: !exemption.viewerVoted,
          }
        : null,
  };
}

/**
 * One feed row with a reaction added or taken away. Pure, so the optimistic
 * update on screen and the mock's own store cannot disagree about what a toggle
 * does.
 */
export function withReactionToggled(item: FeedItemDto, emoji: string): FeedItemDto {
  const existing = item.reactions.find((r) => r.emoji === emoji);

  if (!existing) {
    return { ...item, reactions: [...item.reactions, { emoji, count: 1, mine: true }] };
  }
  if (existing.mine) {
    return {
      ...item,
      reactions:
        existing.count === 1
          ? item.reactions.filter((r) => r.emoji !== emoji)
          : item.reactions.map((r) =>
              r.emoji === emoji ? { ...r, count: r.count - 1, mine: false } : r,
            ),
    };
  }
  return {
    ...item,
    reactions: item.reactions.map((r) =>
      r.emoji === emoji ? { ...r, count: r.count + 1, mine: true } : r,
    ),
  };
}

/**
 * The name of the day that has just ended in the crew's timezone — what the
 * bot points at when it says a cadence is gone. Day keys carry no timezone, so
 * stepping one back with UTC arithmetic is safe. Same reasoning as `addDays` in
 * lib/pact-view.ts.
 */
export function dayJustClosed(timezone: string, now: Date): string {
  const today = new Date(`${dayKeyFor(now, timezone)}T00:00:00.000Z`);
  today.setUTCDate(today.getUTCDate() - 1);
  return weekdayName(today.toISOString().slice(0, 10));
}
