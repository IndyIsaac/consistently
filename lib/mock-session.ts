import { leaderboard, type LeaderRow } from "@/lib/stats";
import type { RuleConfig, SessionRecord } from "@/lib/rules";

/* ===========================================================================
 * ██  DEV-ONLY MOCK SESSION  ██
 *
 * The app is viewable at localhost:3000 with no DATABASE_URL, no Privy app id
 * and no funded wallet because every screen reads from this file instead of the
 * database. It is the builder's own situation: a five-day gym pact with four
 * members, a two-person CFA study pact, Thai baht, mid-week.
 *
 * TO DELETE IT: remove this file. Three call sites break, and each one is the
 * exact place a real query belongs:
 *
 *   app/(app)/dashboard/page.tsx   -> getSession()
 *   app/(app)/groups/page.tsx      -> getSession()
 *   app/(app)/pacts/[id]/page.tsx  -> getPact(id)
 *
 * Nothing here invents a shape. `MockCrewMember` extends `LeaderRow` from
 * lib/stats.ts and the rows are produced by the real `leaderboard()` function
 * over real `SessionRecord`s; `MockPact` and `MockUser` carry the Prisma column
 * names from prisma/schema.prisma. Swapping in real rows is a query, not a
 * refactor.
 * ======================================================================== */

/**
 * The mock clock is frozen so the demo composes the same way every time: a
 * Thursday morning, mid-week, before the viewer has been to the gym. Real data
 * will use `new Date()`; nothing outside this file reads it.
 */
export const MOCK_NOW = new Date("2026-08-27T02:12:00.000Z"); // Thu 27 Aug 2026, 09:12 in Bangkok

const TIMEZONE = "Asia/Bangkok";

/** Prisma `User`. */
export type MockUser = {
  id: string;
  privyId: string;
  walletAddress: string;
  displayName: string;
  initials: string;
};

/** `LeaderRow` from lib/stats.ts, plus the Prisma `Membership` columns a row draws. */
export type MockCrewMember = LeaderRow & {
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
  sessions: SessionRecord[];
};

/** Prisma `Pact`, minus the columns no screen draws (vault, fx, invite plumbing). */
export type MockPact = {
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
  /** Periods already settled — the weeks the money has actually moved for. */
  settledPeriods: number;
  crew: MockCrewMember[];
  /** The viewer's `Membership.id` in this pact. */
  viewerMemberId: string;
  /** The viewer's take and loss in this pact, in `stakeCurrency`. */
  viewerEarned: number;
  viewerLost: number;
};

export type MockSession = {
  user: MockUser;
  now: Date;
  currency: string;
  pacts: MockPact[];
};

// --- session fixtures -------------------------------------------------------

/** A crew-local wall-clock time on a crew-local date. */
function at(day: string, hhmm: string): Date {
  return new Date(`${day}T${hhmm}:00.000+07:00`);
}

function did(day: string, start: string, minutes: number): SessionRecord {
  const startedAt = at(day, start);
  return { startedAt, endedAt: new Date(startedAt.getTime() + minutes * 60_000) };
}

const MON = "2026-08-24";
const TUE = "2026-08-25";
const WED = "2026-08-26";
const THU = "2026-08-27"; // today

// --- pact one: the five-day gym pact ---------------------------------------

const GYM_RULE: RuleConfig = {
  cadence: 5,
  period: "week",
  sessionType: "checkin_checkout",
  minDurationMins: 30,
  windowStart: "05:00",
  windowEnd: "22:00",
  proof: "photo",
  failsWhenMissedExceeds: 0,
  split: "equal",
  exemption: "majority",
  durationPeriods: 12,
};

/** Sessions are the CURRENT week only, which is what `leaderboard()` requires:
 *  it counts every day key it is handed, so the caller does the period window. */
const GYM_SESSIONS: Record<string, SessionRecord[]> = {
  nat: [did(MON, "05:50", 62), did(TUE, "05:45", 58), did(WED, "05:55", 65), did(THU, "05:40", 61)],
  indy: [did(MON, "06:05", 55), did(TUE, "06:10", 48), did(WED, "06:02", 71)],
  pim: [did(MON, "18:20", 46), did(TUE, "18:35", 52), did(THU, "07:10", 44)],
  dave: [did(MON, "19:05", 38)],
};

const CFA_RULE: RuleConfig = {
  cadence: 6,
  period: "week",
  sessionType: "checkin_checkout",
  minDurationMins: 120,
  windowStart: "06:00",
  windowEnd: "23:00",
  proof: "photo",
  failsWhenMissedExceeds: 0,
  split: "equal",
  exemption: "majority",
  durationPeriods: 10,
};

const CFA_SESSIONS: Record<string, SessionRecord[]> = {
  indy: [did(MON, "20:10", 135), did(TUE, "20:05", 128), did(WED, "19:50", 142), did(THU, "06:00", 140)],
  kwan: [did(MON, "21:00", 126), did(TUE, "20:40", 133), did(THU, "06:20", 121)],
};

const VIEWER: MockUser = {
  id: "usr_indy",
  privyId: "did:privy:mock-indy",
  walletAddress: "7Nq4mVQiRb3zRk8sYyF2vJp1WcHt6XdAe9LhKuP4sTgB",
  displayName: "Indy",
  initials: "IN",
};

type Person = {
  key: string;
  userId: string;
  displayName: string;
  initials: string;
  forfeitedToDate: number;
  forfeitedPeriods: number;
};

const GYM_CREW: Person[] = [
  { key: "indy", userId: "usr_indy", displayName: "Indy", initials: "IN", forfeitedToDate: 1000, forfeitedPeriods: 1 },
  { key: "nat", userId: "usr_nat", displayName: "Nat Suwannarat", initials: "NS", forfeitedToDate: 0, forfeitedPeriods: 0 },
  { key: "pim", userId: "usr_pim", displayName: "Pim Chaiyaphum", initials: "PC", forfeitedToDate: 1000, forfeitedPeriods: 1 },
  { key: "dave", userId: "usr_dave", displayName: "Dave Whitfield", initials: "DW", forfeitedToDate: 3000, forfeitedPeriods: 5 },
];

const CFA_CREW: Person[] = [
  { key: "indy", userId: "usr_indy", displayName: "Indy", initials: "IN", forfeitedToDate: 0, forfeitedPeriods: 0 },
  { key: "kwan", userId: "usr_kwan", displayName: "Kwan Ratanakul", initials: "KR", forfeitedToDate: 2000, forfeitedPeriods: 2 },
];

/**
 * Builds the crew rows through the real `leaderboard()` so ranking, day counts
 * and streaks come out of lib/stats.ts rather than being written by hand.
 */
function buildCrew(
  pactId: string,
  people: Person[],
  sessionsByKey: Record<string, SessionRecord[]>,
  rule: RuleConfig,
): MockCrewMember[] {
  const memberId = (key: string) => `mem_${pactId}_${key}`;

  const rows = leaderboard(
    people.map((p) => ({
      memberId: memberId(p.key),
      displayName: p.displayName,
      sessions: sessionsByKey[p.key] ?? [],
    })),
    rule,
    TIMEZONE,
    MOCK_NOW,
  );

  return rows.map((row) => {
    const person = people.find((p) => memberId(p.key) === row.memberId)!;
    return {
      ...row,
      userId: person.userId,
      initials: person.initials,
      status: "staked" as const,
      isViewer: person.userId === VIEWER.id,
      forfeitedToDate: person.forfeitedToDate,
      forfeitedPeriods: person.forfeitedPeriods,
      sessions: sessionsByKey[person.key] ?? [],
    };
  });
}

const PACTS: MockPact[] = [
  {
    id: "pact_five_a_week",
    name: "Five a week",
    inviteToken: "mock-five-a-week",
    ruleConfig: GYM_RULE,
    timezone: TIMEZONE,
    stakeAmount: 1000,
    stakeCurrency: "THB",
    status: "active",
    startsAt: at("2026-07-20", "00:00"),
    settledPeriods: 5,
    crew: buildCrew("five", GYM_CREW, GYM_SESSIONS, GYM_RULE),
    viewerMemberId: "mem_five_indy",
    // Dave forfeited three weeks and Pim one; each ฿1,000 split three ways, the
    // indivisible remainder to the first winner.
    viewerEarned: 1333,
    viewerLost: 1000,
  },
  {
    id: "pact_cfa_level_two",
    name: "CFA Level II",
    inviteToken: "mock-cfa-level-two",
    ruleConfig: CFA_RULE,
    timezone: TIMEZONE,
    stakeAmount: 1000,
    stakeCurrency: "THB",
    status: "active",
    startsAt: at("2026-07-20", "00:00"),
    settledPeriods: 5,
    crew: buildCrew("cfa", CFA_CREW, CFA_SESSIONS, CFA_RULE),
    viewerMemberId: "mem_cfa_indy",
    // Two members: a forfeited stake goes to the one person who kept the rule.
    viewerEarned: 2000,
    viewerLost: 0,
  },
];

const SESSION: MockSession = {
  user: VIEWER,
  now: MOCK_NOW,
  currency: "THB",
  pacts: PACTS,
};

/** Stands in for the signed-in user's dashboard query. */
export async function getSession(): Promise<MockSession> {
  return SESSION;
}

/** Stands in for `GET /api/pacts/[id]/view`. */
export async function getPact(id: string): Promise<MockPact | null> {
  return SESSION.pacts.find((p) => p.id === id) ?? null;
}
