import type { Prisma, Session, User } from "@prisma/client";
import { prisma } from "@/lib/db";
import { tallyExemption } from "@/lib/exemptions";
import { periodDayKeys } from "@/lib/pact-view";
import { RuleConfigSchema, type SessionRecord } from "@/lib/rules";
import { readSettlement } from "@/lib/settlement";
import { leaderboard } from "@/lib/stats";
import { initialsOf, type AppSession, type CrewMember, type PactView } from "@/lib/view";

/* ---------------------------------------------------------------------------
 * Prisma rows -> the shapes in lib/view.ts.
 *
 * The only module that knows both. Everything a screen draws is computed here
 * by the same pure functions the mock uses -- `leaderboard` for standings,
 * `tallyExemption` for the vote, `readSettlement` for the money -- so the real
 * app and the demo cannot disagree about arithmetic, only about where the rows
 * came from.
 * ------------------------------------------------------------------------- */

const pactInclude = {
  settlements: { orderBy: { periodKey: "asc" } },
  memberships: {
    include: {
      user: true,
      exemptions: { where: { status: "pending" }, include: { votes: true } },
    },
  },
} satisfies Prisma.PactInclude;

type PactRow = Prisma.PactGetPayload<{ include: typeof pactInclude }>;

/**
 * A coarse day-key window for the session query.
 *
 * The precise window is `periodDayKeys`, but that needs the pact's rule and
 * timezone, which are only known once the pact row is in hand. Rather than a
 * second round trip per pact, the query over-fetches a fortnight around `now`
 * -- comfortably a superset of any period in any timezone, since the largest
 * UTC offset is under a day -- and the exact narrowing happens in
 * `crewFor` below, where the rule is available.
 *
 * This rides `@@index([membershipId, dayKey])`, so the over-fetch is bounded
 * and cheap. What it must never become is an unfiltered `sessions: true`: both
 * `countValidDays` and `hasFailed` document that the caller windows first, and
 * an unwindowed list means every member's lifetime count exceeds the cadence
 * and nobody ever fails again.
 */
function coarseWindow(now: Date): { gte: string; lte: string } {
  const day = (offset: number) =>
    new Date(now.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
  return { gte: day(-9), lte: day(2) };
}

async function sessionsByMembership(
  membershipIds: string[],
  now: Date,
): Promise<Map<string, Session[]>> {
  if (membershipIds.length === 0) return new Map();

  const rows = await prisma.session.findMany({
    where: { membershipId: { in: membershipIds }, dayKey: coarseWindow(now) },
    orderBy: { startedAt: "asc" },
  });

  const byMember = new Map<string, Session[]>();
  for (const row of rows) {
    const list = byMember.get(row.membershipId);
    if (list) list.push(row);
    else byMember.set(row.membershipId, [row]);
  }
  return byMember;
}

/** Prisma's `Session` is already `SessionRecord` -- the two columns line up exactly. */
function toRecord(s: Session): SessionRecord {
  return { startedAt: s.startedAt, endedAt: s.endedAt };
}

function crewFor(
  pact: PactRow,
  sessions: Map<string, Session[]>,
  viewerUserId: string,
  now: Date,
): CrewMember[] {
  const rule = RuleConfigSchema.parse(pact.ruleConfig);
  const usdRate = pact.fxRateToUsd.toNumber();
  const inPeriod = new Set(periodDayKeys(rule, pact.timezone, now));

  const members = pact.memberships.filter((m) => m.status !== "left");

  const windowed = new Map<string, SessionRecord[]>(
    members.map((m) => [
      m.id,
      (sessions.get(m.id) ?? []).filter((s) => inPeriod.has(s.dayKey)).map(toRecord),
    ]),
  );

  // The standings come out of the real leaderboard, never written by hand --
  // and its ordering is load-bearing: the dashboard and groups pages read a
  // member's rank from their position in this array.
  const rows = leaderboard(
    members.map((m) => ({
      memberId: m.id,
      displayName: m.user.displayName,
      sessions: windowed.get(m.id) ?? [],
    })),
    rule,
    pact.timezone,
    now,
  );

  const history = pact.settlements.map((s) => readSettlement(s.payouts, usdRate));

  return rows.map((row) => {
    const member = members.find((m) => m.id === row.memberId)!;
    return {
      ...row,
      userId: member.userId,
      initials: initialsOf(member.user.displayName),
      status: member.status,
      isViewer: member.userId === viewerUserId,
      forfeitedToDate: history.reduce((sum, s) => sum + s.forfeitedBy(member.id), 0),
      forfeitedPeriods: history.filter((s) => s.didForfeit(member.id)).length,
      sessions: windowed.get(member.id) ?? [],
    };
  });
}

function pendingExemptionFor(pact: PactRow, viewerUserId: string, now: Date) {
  const rule = RuleConfigSchema.parse(pact.ruleConfig);
  const thisPeriod = periodDayKeys(rule, pact.timezone, now)[0];

  const memberships = pact.memberships.map((m) => ({
    id: m.id,
    userId: m.userId,
    status: m.status,
  }));

  for (const member of pact.memberships) {
    const exemption = member.exemptions.find((e) => e.periodKey === thisPeriod);
    if (!exemption) continue;

    const { approvals, needed } = tallyExemption({
      requesterMembershipId: member.id,
      memberships,
      votes: exemption.votes,
    });

    return {
      id: exemption.id,
      membershipId: member.id,
      periodKey: exemption.periodKey,
      reason: exemption.reason,
      status: exemption.status,
      createdAt: exemption.createdAt,
      approvals,
      needed,
      requesterName: member.user.displayName,
      // Nobody votes on their own, so the asker arrives with no vote to cast.
      viewerVoted:
        member.userId === viewerUserId ||
        exemption.votes.some((v) => v.userId === viewerUserId),
    };
  }
  return null;
}

function toPactView(
  pact: PactRow,
  sessions: Map<string, Session[]>,
  openSessions: Map<string, { sessionId: string; startedAt: number }>,
  viewer: User,
  now: Date,
): PactView {
  const usdRate = pact.fxRateToUsd.toNumber();
  const viewerMembership = pact.memberships.find((m) => m.userId === viewer.id);
  const history = pact.settlements.map((s) => readSettlement(s.payouts, usdRate));

  return {
    id: pact.id,
    name: pact.name,
    inviteToken: pact.inviteToken,
    ruleConfig: RuleConfigSchema.parse(pact.ruleConfig),
    timezone: pact.timezone,
    // `Decimal.toNumber()` rather than `Number(decimal)`: the second works only
    // by going through toString, and silently so.
    stakeAmount: pact.stakeAmount.toNumber(),
    stakeCurrency: pact.stakeCurrency,
    status: pact.status,
    // `startsAt` is null until everyone has staked; the screens type it as a
    // Date and only use it to say how long the pact has been running.
    startsAt: pact.startsAt ?? pact.createdAt,
    settledPeriods: pact.settlements.length,
    crew: crewFor(pact, sessions, viewer.id, now),
    viewerMemberId: viewerMembership?.id ?? "",
    viewerEarned: viewerMembership
      ? history.reduce((sum, s) => sum + s.shareFor(viewerMembership.id), 0)
      : 0,
    viewerLost: viewerMembership
      ? history.reduce((sum, s) => sum + s.forfeitedBy(viewerMembership.id), 0)
      : 0,
    pendingExemption: pendingExemptionFor(pact, viewer.id, now),

    vaultAddress: pact.vaultAddress,
    stakeUsdc: pact.stakeUsdc.toString(),
    viewerStatus: viewerMembership?.status ?? "invited",
    viewerOpenSession: viewerMembership ? (openSessions.get(viewerMembership.id) ?? null) : null,
  };
}

async function openSessionsFor(
  membershipIds: string[],
): Promise<Map<string, { sessionId: string; startedAt: number }>> {
  if (membershipIds.length === 0) return new Map();
  const rows = await prisma.session.findMany({
    where: { membershipId: { in: membershipIds }, endedAt: null },
    select: { id: true, membershipId: true, startedAt: true },
  });
  return new Map(
    rows.map((r) => [r.membershipId, { sessionId: r.id, startedAt: r.startedAt.getTime() }]),
  );
}

/**
 * Converts an amount in one pact's currency into another's, via USD, using the
 * rate each pact locked at creation.
 *
 * The dashboard sums earnings across every pact and prints one figure. Without
 * this it adds baht to pounds and prints the total as whichever currency it
 * happened to pick -- which is the first number a reader looks at.
 */
function convert(amount: number, fromRate: number, toRate: number): number {
  return toRate === 0 ? amount : (amount * fromRate) / toRate;
}

/** Every pact the viewer is in, with their standing in each. */
export async function liveSession(viewer: User, now: Date): Promise<AppSession> {
  const memberships = await prisma.membership.findMany({
    where: { userId: viewer.id, status: { not: "left" } },
    include: { pact: { include: pactInclude } },
    orderBy: { pact: { createdAt: "desc" } },
  });

  const allMembershipIds = memberships.flatMap((m) => m.pact.memberships.map((p) => p.id));
  const [sessions, openIds] = await Promise.all([
    sessionsByMembership(allMembershipIds, now),
    openSessionsFor(allMembershipIds),
  ]);

  const pacts = memberships.map((m) => toPactView(m.pact, sessions, openIds, viewer, now));

  // The dashboard totals in one currency: the newest pact's, since that is the
  // one the viewer most recently agreed to think in.
  const rates = new Map(memberships.map((m) => [m.pact.id, m.pact.fxRateToUsd.toNumber()]));
  const target = memberships[0]?.pact;
  const targetRate = target ? rates.get(target.id)! : 1;

  const converted = pacts.map((p) => {
    const rate = rates.get(p.id)!;
    if (rate === targetRate) return p;
    return {
      ...p,
      stakeAmount: convert(p.stakeAmount, rate, targetRate),
      viewerEarned: convert(p.viewerEarned, rate, targetRate),
      viewerLost: convert(p.viewerLost, rate, targetRate),
      stakeCurrency: target!.stakeCurrency,
      crew: p.crew.map((c) => ({
        ...c,
        forfeitedToDate: convert(c.forfeitedToDate, rate, targetRate),
      })),
    };
  });

  return {
    user: {
      id: viewer.id,
      privyId: viewer.privyId,
      walletAddress: viewer.walletAddress,
      displayName: viewer.displayName,
      initials: initialsOf(viewer.displayName),
      avatarUrl: viewer.avatarUrl,
    },
    now,
    currency: target?.stakeCurrency ?? "USD",
    pacts: converted,
  };
}

/** One pact, as the viewer sees it. Null when it does not exist. */
export async function livePact(
  pactId: string,
  viewer: User,
  now: Date,
): Promise<PactView | null> {
  const pact = await prisma.pact.findUnique({ where: { id: pactId }, include: pactInclude });
  if (!pact) return null;

  const membershipIds = pact.memberships.map((m) => m.id);
  const [sessions, openIds] = await Promise.all([
    sessionsByMembership(membershipIds, now),
    openSessionsFor(membershipIds),
  ]);

  return toPactView(pact, sessions, openIds, viewer, now);
}
