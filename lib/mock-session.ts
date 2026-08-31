import type { FeedItemDto } from "@/app/api/pacts/[id]/feed/route";
import {
  cadenceMetLine,
  checkedInLine,
  checkedOutLine,
  earlyCheckoutRefusal,
  exemptionOpenedReply,
  exemptionRequestLine,
  outOfReachVerdict,
} from "@/lib/bot";
import { settlesOn, withReactionToggled } from "@/lib/channel-view";
import { formatMoney } from "@/lib/money";
import { weekdayName } from "@/lib/pact-view";
import {
  cadenceOutlook,
  countValidDays,
  dayKeyFor,
  RuleConfigSchema,
  type RuleConfig,
  type SessionRecord,
} from "@/lib/rules";
import { leaderboard } from "@/lib/stats";
import type {
  AppSession,
  CrewMember,
  PactView,
  PendingExemption,
  ViewerUser,
} from "@/lib/view";

/* ===========================================================================
 * ██  DEV-ONLY MOCK SESSION  ██
 *
 * The app is viewable at localhost:3000 with no DATABASE_URL, no Privy app id
 * and no funded wallet because every screen reads from this file instead of the
 * database. It is the builder's own situation: a five-day gym pact with four
 * members, a two-person CFA study pact, Thai baht, late in the week.
 *
 * TO DELETE IT: remove this file. Four call sites break, and each one is the
 * exact place a real query belongs:
 *
 *   app/(app)/dashboard/page.tsx   -> getSession()
 *   app/(app)/groups/page.tsx      -> getSession()
 *   app/(app)/pacts/[id]/page.tsx  -> getPact(id), getChannel(id, wallet)
 *   components/Channel.tsx         -> the mock* functions at the foot of this file
 *
 * Nothing here invents a shape. `MockCrewMember` extends `LeaderRow` from
 * lib/stats.ts and the rows are produced by the real `leaderboard()` function
 * over real `SessionRecord`s; `MockPact` and `MockUser` carry the Prisma column
 * names from prisma/schema.prisma; the channel is `FeedItemDto[]` in the order
 * `GET /api/pacts/[id]/feed` returns it, and every mock* function below takes
 * and returns exactly what its route counterpart does. Swapping in the real
 * thing is a change of import.
 * ======================================================================== */

/**
 * The mock clock is frozen so the demo composes the same way every time: a
 * Friday morning, the fifth day of a five-a-week rule, before the viewer has
 * been to the gym. Real data will use `new Date()`; nothing outside this file
 * reads it.
 *
 * Friday is chosen, not arbitrary. It is the first day of the week on which a
 * five-a-week member can already be finished and another can already be out of
 * reach, so both ends of the record are on screen at once.
 */
export const MOCK_NOW = new Date("2026-08-28T02:12:00.000Z"); // Fri 28 Aug 2026, 09:12 in Bangkok

const TIMEZONE = "Asia/Bangkok";

/* ---------------------------------------------------------------------------
 * The shapes live in lib/view.ts, because the real queries have to satisfy the
 * same ones. The `Mock*` names are kept as aliases so the README's account of
 * this file -- and every existing import of them -- still reads true.
 * ------------------------------------------------------------------------- */

export type MockUser = ViewerUser;
export type MockCrewMember = CrewMember;
export type MockExemption = PendingExemption;
export type MockPact = PactView;
export type MockSession = AppSession;

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
const THU = "2026-08-27";
const FRI = "2026-08-28"; // today

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

/**
 * Sessions are the CURRENT week only, which is what `leaderboard()` requires:
 * it counts every day key it is handed, so the caller does the period window.
 *
 * The week is composed to demo: on Friday morning Nat is already finished, the
 * viewer and Pim are two short with three days to find them in, and Dave is
 * past saving — one day done, four owed and three left. Nobody's numbers are
 * asserted anywhere; every standing on screen is computed from these rows.
 */
const GYM_SESSIONS: Record<string, SessionRecord[]> = {
  nat: [
    did(MON, "05:50", 62),
    did(TUE, "05:45", 58),
    did(WED, "05:55", 65),
    did(THU, "05:40", 61),
    did(FRI, "05:38", 63),
  ],
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

/**
 * Dave has one day done, four owed and three left, and he is asking to be let
 * off the week his flight home was cancelled. Three others can vote; two of
 * them decide it. Nat has already said yes.
 */
const DAVE_EXEMPTION: MockExemption = {
  id: "exm_five_dave_w6",
  membershipId: "mem_five_dave",
  periodKey: MON,
  reason: "Flight out of Chiang Mai cancelled twice. Three nights in an airport.",
  status: "pending",
  createdAt: at(FRI, "08:05"),
  approvals: 1,
  needed: 2,
  requesterName: "Dave Whitfield",
  viewerVoted: false,
};

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
    // The four the money path needs. The vault addresses are real base58 and
    // hold nothing; the mock never builds a transaction, it only draws them.
    vaultAddress: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
    // 1,000 THB at the 0.0285 rate the pact locked. Atomic units, six decimals.
    stakeUsdc: "28500000",
    viewerStatus: "staked",
    viewerOpenSessionId: null,
    // Dave forfeited three weeks and Pim one; each ฿1,000 split three ways, the
    // indivisible remainder to the first winner.
    viewerEarned: 1333,
    viewerLost: 1000,
    pendingExemption: DAVE_EXEMPTION,
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
    // The four the money path needs. The vault addresses are real base58 and
    // hold nothing; the mock never builds a transaction, it only draws them.
    vaultAddress: "3Nq8kYtLxV5wRb2mPfDa7ZcJhE4sXgUn6TqWyA9vKrBd",
    // 1,000 THB at the 0.0285 rate the pact locked. Atomic units, six decimals.
    stakeUsdc: "28500000",
    viewerStatus: "staked",
    viewerOpenSessionId: null,
    // Two members: a forfeited stake goes to the one person who kept the rule.
    viewerEarned: 2000,
    viewerLost: 0,
    pendingExemption: null,
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

/* ===========================================================================
 * The channel
 *
 * `FeedItemDto` and the order below are `GET /api/pacts/[id]/feed`'s, exactly:
 * newest first, at most a hundred rows. The screen reverses it for display,
 * because a channel reads downwards.
 *
 * Every bot line here is built by lib/bot.ts from the crew's own sessions
 * rather than typed out, so the transcript cannot say something the numbers
 * do not. The out-of-reach verdicts in particular are `cadenceOutlook` run
 * twice — at the close of one day and the close of the next — and emitted for
 * whoever the arithmetic left behind in between.
 * ======================================================================== */

const PHOTOS = {
  rack: "/mock/checkin-rack.jpg",
  dumbbells: "/mock/checkin-dumbbells.jpg",
  treadmill: "/mock/checkin-treadmill.jpg",
} as const;

type Seed = {
  at: Date;
  type: FeedItemDto["type"];
  body: string;
  authorName?: string;
  photoUrl?: string;
  reactions?: FeedItemDto["reactions"];
};

/** Valid days a member had banked at the end of `dayKey`. */
function daysDoneThrough(sessions: SessionRecord[], rule: RuleConfig, dayKey: string): number {
  return countValidDays(
    sessions.filter((s) => dayKeyFor(s.startedAt, TIMEZONE) <= dayKey),
    rule,
    TIMEZONE,
  );
}

/**
 * The verdicts a day's close produced: whoever could still reach the cadence
 * before it and cannot after it. This is what the bot would have posted at
 * midnight, and it is computed, not written.
 */
function verdictsAtClose(pact: MockPact, dayKey: string, daysAfter: number): Seed[] {
  const settles = settlesOn(pact.timezone, MOCK_NOW);
  const stake = formatMoney(pact.stakeAmount, pact.stakeCurrency);

  return pact.crew
    .filter((member) => {
      const done = daysDoneThrough(member.sessions, pact.ruleConfig, dayKey);
      const before = cadenceOutlook(done, daysAfter + 1, pact.ruleConfig);
      const after = cadenceOutlook(done, daysAfter, pact.ruleConfig);
      return after.outOfReach && !before.outOfReach;
    })
    .map((member) => ({
      at: new Date(`${dayKey}T17:00:00.000Z`), // midnight in the crew's timezone
      type: "bot" as const,
      body: outOfReachVerdict({
        name: member.isViewer ? null : firstName(member.displayName),
        cadence: pact.ruleConfig.cadence,
        dayClosed: weekdayName(dayKey),
        stake,
        settlesOn: settles,
      }),
    }));
}

function firstName(displayName: string): string {
  return displayName.split(" ")[0];
}

function gymSeeds(pact: MockPact): Seed[] {
  const nat = "Nat Suwannarat";
  const pim = "Pim Chaiyaphum";

  return [
    {
      at: at(THU, "05:40"),
      type: "checkin",
      body: checkedInLine(firstName(nat)),
      authorName: nat,
      photoUrl: PHOTOS.rack,
      reactions: [{ emoji: "💪", count: 2, mine: false }],
    },
    { at: at(THU, "06:41"), type: "checkout", body: checkedOutLine(firstName(nat), 61), authorName: nat },
    {
      at: at(THU, "07:10"),
      type: "checkin",
      body: checkedInLine(firstName(pim)),
      authorName: pim,
      photoUrl: PHOTOS.dumbbells,
    },
    { at: at(THU, "07:54"), type: "checkout", body: checkedOutLine(firstName(pim), 44), authorName: pim },
    {
      at: at(THU, "21:00"),
      type: "bot",
      body: "Three hours left in Thursday. Indy and Dave have not been.",
    },

    // Midnight. Thursday closed with Dave one day done and four owed.
    ...verdictsAtClose(pact, THU, 3),

    {
      at: at(FRI, "05:38"),
      type: "checkin",
      body: checkedInLine(firstName(nat)),
      authorName: nat,
      photoUrl: PHOTOS.treadmill,
      reactions: [{ emoji: "🔥", count: 1, mine: true }],
    },
    {
      at: at(FRI, "06:41"),
      type: "checkout",
      body: checkedOutLine(firstName(nat), 63),
      authorName: nat,
      reactions: [
        { emoji: "💪", count: 2, mine: false },
        { emoji: "👏", count: 1, mine: false },
      ],
    },
    { at: at(FRI, "06:42"), type: "bot", body: cadenceMetLine(firstName(nat), pact.ruleConfig.cadence) },
    {
      at: DAVE_EXEMPTION.createdAt,
      type: "exemption_request",
      body: exemptionRequestLine(DAVE_EXEMPTION.requesterName, DAVE_EXEMPTION.reason),
      authorName: DAVE_EXEMPTION.requesterName,
    },
    {
      // A beat after the request itself: two rows sharing a timestamp to the
      // second sort by whichever the store happened to hold first.
      at: new Date(DAVE_EXEMPTION.createdAt.getTime() + 20_000),
      type: "bot",
      body: exemptionOpenedReply(pact.crew.length - 1, DAVE_EXEMPTION.needed),
    },
  ];
}

function cfaSeeds(pact: MockPact): Seed[] {
  const kwan = "Kwan Ratanakul";
  return [
    { at: at(THU, "06:00"), type: "checkin", body: checkedInLine("Indy"), authorName: "Indy" },
    { at: at(THU, "08:20"), type: "checkout", body: checkedOutLine("Indy", 140), authorName: "Indy" },
    {
      at: at(THU, "06:20"),
      type: "checkin",
      body: checkedInLine(firstName(kwan)),
      authorName: kwan,
    },
    { at: at(THU, "08:21"), type: "checkout", body: checkedOutLine(firstName(kwan), 121), authorName: kwan },
    ...verdictsAtClose(pact, THU, 3),
    {
      at: at(FRI, "07:30"),
      type: "bot",
      body: "Three days left in the week. Neither of you has been today.",
    },
  ];
}

function seedChannel(pact: MockPact): FeedItemDto[] {
  const seeds = pact.id === "pact_five_a_week" ? gymSeeds(pact) : cfaSeeds(pact);
  return seeds
    .map((seed, i) => ({
      id: `fi_${pact.id}_${String(i).padStart(2, "0")}`,
      type: seed.type,
      body: seed.body,
      photoUrl: seed.photoUrl ?? null,
      authorName: seed.authorName ?? null,
      createdAt: seed.at.toISOString(),
      reactions: seed.reactions ?? [],
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)); // newest first, as the route returns
}

/** Newest-first, exactly as `GET /api/pacts/[id]/feed` returns it. */
const channels = new Map<string, FeedItemDto[]>();

function channelFor(pactId: string): FeedItemDto[] {
  let items = channels.get(pactId);
  if (!items) {
    const pact = SESSION.pacts.find((p) => p.id === pactId);
    items = pact ? seedChannel(pact) : [];
    channels.set(pactId, items);
  }
  return items;
}

function post(pactId: string, item: Omit<FeedItemDto, "id" | "createdAt" | "reactions">): FeedItemDto {
  const row: FeedItemDto = {
    ...item,
    id: `fi_${crypto.randomUUID()}`,
    createdAt: mockNow().toISOString(),
    reactions: [],
  };
  channels.set(pactId, [row, ...channelFor(pactId)]);
  return row;
}

/** Stands in for `GET /api/pacts/[id]/feed?viewer=<wallet>`. */
export async function getChannel(pactId: string, viewerWallet: string): Promise<FeedItemDto[]> {
  void viewerWallet; // the real route reads it to mark which reactions are the viewer's
  return channelFor(pactId).slice(0, 100);
}

/* ---------------------------------------------------------------------------
 * The mock's stand-in for POST /api/pacts/[id]/sessions.
 *
 * Same arguments, same resolved shapes, same guard errors, and the refusal
 * sentence comes from the same lib/bot.ts function the route calls — so the
 * only difference the swap makes is where the row is written.
 * ------------------------------------------------------------------------- */

/** The mock's `SessionGuardError`: a message the caller is meant to show. */
export class MockSessionGuardError extends Error {}

/**
 * DEMO CLOCK — this file only.
 *
 * A mock check-in is recorded at real `now`, so with real minutes the second
 * half of the demo would mean standing on stage for thirty of them. Mock
 * sessions therefore run compressed: one real second counts as one minute. An
 * early check-out is still refused by the same arithmetic against the same
 * rule, thirty seconds later the same check-out is accepted, and the elapsed
 * figure the channel shows is the one the refusal quotes.
 *
 * The route this stands in for uses wall time (60_000). Nothing outside this
 * file reads this constant except the channel's own elapsed counter.
 */
export const MOCK_MS_PER_MINUTE = 1_000;

const BOOTED_AT = Date.now();

/**
 * The mock's own clock: it starts at `MOCK_NOW` and runs at the compressed rate
 * above, so a check-in at 09:12 and the check-out thirty real seconds later are
 * stamped 09:12 and 09:42 and the channel agrees with itself about how long the
 * session was. Real data will use `new Date()`.
 */
export function mockNow(): Date {
  return new Date(
    MOCK_NOW.getTime() + (Date.now() - BOOTED_AT) * (60_000 / MOCK_MS_PER_MINUTE),
  );
}

type OpenSessionRow = {
  id: string;
  pactId: string;
  membershipId: string;
  startedAt: number;
  dayKey: string;
  startPhotoUrl: string | null;
};

const openSessions = new Map<string, OpenSessionRow>();

/** The viewer's open session in this pact, if there is one. Prisma: `findFirst({ endedAt: null })`. */
export function mockOpenSessionFor(pactId: string): { sessionId: string; startedAt: number } | null {
  for (const row of openSessions.values()) {
    if (row.pactId === pactId) return { sessionId: row.id, startedAt: row.startedAt };
  }
  return null;
}

export async function mockOpenSession(params: {
  pactId: string;
  userWallet: string;
  photoUrl: string | null;
}): Promise<{ sessionId: string }> {
  const pact = SESSION.pacts.find((p) => p.id === params.pactId);
  if (!pact) throw new MockSessionGuardError("No such pact.");
  if (mockOpenSessionFor(pact.id)) {
    throw new MockSessionGuardError("A session is already open. Check out first.");
  }

  const startedAt = mockNow();
  const row: OpenSessionRow = {
    id: `ses_${crypto.randomUUID()}`,
    pactId: pact.id,
    membershipId: pact.viewerMemberId,
    startedAt: startedAt.getTime(),
    dayKey: dayKeyFor(startedAt, pact.timezone),
    startPhotoUrl: params.photoUrl,
  };
  openSessions.set(row.id, row);

  post(pact.id, {
    type: "checkin",
    body: checkedInLine(VIEWER.displayName),
    photoUrl: params.photoUrl,
    authorName: VIEWER.displayName,
  });

  return { sessionId: row.id };
}

export async function mockCloseSession(params: {
  sessionId: string;
  photoUrl: string | null;
}): Promise<{ durationMins: number }> {
  const row = openSessions.get(params.sessionId);
  if (!row) throw new MockSessionGuardError("Session is already closed.");

  const pact = SESSION.pacts.find((p) => p.id === row.pactId)!;
  const endedAt = mockNow();
  const durationMins = Math.floor((endedAt.getTime() - row.startedAt) / 60_000);

  const rule = RuleConfigSchema.safeParse(pact.ruleConfig);
  if (rule.success) {
    const { sessionType, minDurationMins } = rule.data;
    if (
      sessionType === "checkin_checkout" &&
      minDurationMins !== null &&
      durationMins < minDurationMins
    ) {
      throw new MockSessionGuardError(earlyCheckoutRefusal(durationMins, minDurationMins));
    }
  }

  openSessions.delete(row.id);

  post(pact.id, {
    type: "checkout",
    body: checkedOutLine(VIEWER.displayName, durationMins),
    photoUrl: params.photoUrl,
    authorName: VIEWER.displayName,
  });

  // The viewer's day is banked the moment the check-out is accepted, so every
  // standing the channel draws from here on counts it.
  const me = pact.crew.find((m) => m.isViewer);
  if (me) {
    me.sessions = [...me.sessions, { startedAt: new Date(row.startedAt), endedAt }];
    me.daysDone = countValidDays(me.sessions, pact.ruleConfig, pact.timezone);
  }

  return { durationMins };
}

/**
 * Stands in for `POST /api/feed/[itemId]/react`. It resolves with the route's
 * `{ on }`; the extra `pactId` is only how the mock finds the row, which the
 * route gets from the database and the wallet from the request body.
 */
export async function mockToggleReaction(
  pactId: string,
  itemId: string,
  emoji: string,
): Promise<{ on: boolean }> {
  const items = channelFor(pactId);
  const item = items.find((i) => i.id === itemId);
  if (!item) return { on: false };

  const updated = withReactionToggled(item, emoji);
  channels.set(pactId, items.map((row) => (row.id === item.id ? updated : row)));

  return { on: updated.reactions.some((r) => r.emoji === emoji && r.mine) };
}

/** Stands in for `POST /api/pacts/[id]/exemptions` with `action: "request"`. */
export async function mockRequestExemption(params: {
  pactId: string;
  userWallet: string;
  periodKey: string;
  reason: string;
}): Promise<{ exemptionId: string }> {
  const pact = SESSION.pacts.find((p) => p.id === params.pactId);
  if (!pact) throw new MockSessionGuardError("No such pact.");
  if (pact.ruleConfig.exemption === "none") {
    throw new MockSessionGuardError("This pact's rules don't allow exemptions.");
  }

  const reason = params.reason.slice(0, 280);
  const eligible = pact.crew.length - 1;

  pact.pendingExemption = {
    id: `exm_${crypto.randomUUID()}`,
    membershipId: pact.viewerMemberId,
    periodKey: params.periodKey,
    reason,
    status: "pending",
    createdAt: new Date(),
    approvals: 0,
    needed: Math.floor(eligible / 2) + 1,
    requesterName: VIEWER.displayName,
    // Nobody can vote on their own exemption, so the viewer's own request
    // arrives with no vote to cast.
    viewerVoted: true,
  };

  post(pact.id, {
    type: "exemption_request",
    body: exemptionRequestLine(VIEWER.displayName, reason),
    photoUrl: null,
    authorName: VIEWER.displayName,
  });
  post(pact.id, {
    type: "bot",
    body: exemptionOpenedReply(eligible, pact.pendingExemption.needed),
    photoUrl: null,
    authorName: null,
  });

  return { exemptionId: pact.pendingExemption.id };
}

/** Stands in for `POST /api/pacts/[id]/exemptions` with `action: "vote"`. */
export async function mockCastVote(params: {
  pactId: string;
  exemptionId: string;
  userWallet: string;
  approve: boolean;
}): Promise<{ status: "pending" | "granted" | "denied"; approvals: number; needed: number }> {
  const pact = SESSION.pacts.find((p) => p.id === params.pactId);
  const exemption = pact?.pendingExemption;
  if (!pact || !exemption || exemption.id !== params.exemptionId) {
    throw new MockSessionGuardError("No exemption is open.");
  }
  if (exemption.viewerVoted) throw new MockSessionGuardError("You have already voted.");

  const eligible = pact.crew.length - 1;
  exemption.viewerVoted = true;
  if (params.approve) exemption.approvals += 1;

  const rejections = eligible - exemption.approvals;
  if (exemption.approvals >= exemption.needed) exemption.status = "granted";
  else if (rejections >= exemption.needed) exemption.status = "denied";

  if (exemption.status !== "pending") {
    post(pact.id, {
      type: "exemption_result",
      body:
        exemption.status === "granted"
          ? `The crew let ${exemption.requesterName} off this one.`
          : `The crew said no. ${exemption.requesterName} still owes.`,
      photoUrl: null,
      authorName: null,
    });
  }

  return { status: exemption.status, approvals: exemption.approvals, needed: exemption.needed };
}
