import "dotenv/config";
import type { User } from "@prisma/client";
import { prisma } from "../lib/db";
import { createVault } from "../lib/vault";
import { fetchUsdRate, toUsdcAtomic } from "../lib/fx";
import { dayKeyFor, type RuleConfig } from "../lib/rules";
import { weekDayKeys } from "../lib/pact-view";
import { liveSession, livePact } from "../lib/queries";
import { formatMoney } from "../lib/money";
import { checkedInLine, checkedOutLine } from "../lib/bot";
import type { SettlementRecord } from "../lib/settlement";
import { randomBytes } from "node:crypto";

/* ---------------------------------------------------------------------------
 * npm run seed
 *
 * lib/mock-session.ts, in Postgres.
 *
 * The same two crews, the same people, the same sessions to the minute, and a
 * settlement history that produces the same money on the dashboard -- so the
 * screens read identically whether they are being served the fixture or the
 * database. That is the whole point: the demo everyone has been looking at is
 * the one that has to keep working once the rows are real.
 *
 * Anybody who has actually signed in takes the viewer's seat, oldest account
 * first, keeping their own name and wallet. A real account with an empty
 * dashboard is a bad place to rehearse from -- every screen here (streaks, day
 * markers, the crew table, earned and lost) needs a populated crew to show
 * anything at all.
 *
 * Re-runnable: it deletes these two crews first. Real accounts are never
 * deleted, only re-enrolled.
 * ------------------------------------------------------------------------- */

const TIMEZONE = "Asia/Bangkok";

const GYM = "Five a week";
const CFA = "CFA Level II";
const RUN = "Long run";

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

/**
 * A third crew, and deliberately the least like the other two.
 *
 * Five a week is daily and photographed; CFA Level II is six two-hour sittings.
 * Both are heavy. This one is once a week and self-attested, which is what most
 * real pacts look like -- and it gives the screens a rule with no photo and a
 * cadence of one to render, rather than three variations on the same shape.
 */
const RUN_RULE: RuleConfig = {
  cadence: 1,
  period: "week",
  sessionType: "checkin",
  minDurationMins: null,
  windowStart: "05:00",
  windowEnd: "20:00",
  proof: "self_attest",
  failsWhenMissedExceeds: 0,
  split: "equal",
  exemption: "majority",
  durationPeriods: 12,
};

/** A session: which day of the crew-local week, what time, how long. */
type Sitting = { day: number; at: string; mins: number };

type Seat = {
  name: string;
  /** Weeks this member has forfeited in. Drives the settlement history below. */
  forfeits: number;
  sittings: Sitting[];
};

/** Exactly lib/mock-session.ts's GYM_SESSIONS, in the same order. */
const GYM_CREW: Seat[] = [
  {
    name: "Indy",
    forfeits: 1,
    sittings: [
      { day: 0, at: "06:05", mins: 55 },
      { day: 1, at: "06:10", mins: 48 },
      { day: 2, at: "06:02", mins: 71 },
    ],
  },
  {
    name: "Nat Suwannarat",
    forfeits: 0,
    sittings: [
      { day: 0, at: "05:50", mins: 62 },
      { day: 1, at: "05:45", mins: 58 },
      { day: 2, at: "05:55", mins: 65 },
      { day: 3, at: "05:40", mins: 61 },
      { day: 4, at: "05:38", mins: 63 },
    ],
  },
  {
    name: "Pim Chaiyaphum",
    forfeits: 1,
    sittings: [
      { day: 0, at: "18:20", mins: 46 },
      { day: 1, at: "18:35", mins: 52 },
      { day: 3, at: "07:10", mins: 44 },
    ],
  },
  {
    name: "Dave Whitfield",
    forfeits: 3,
    sittings: [{ day: 0, at: "19:05", mins: 38 }],
  },
];

/** Exactly CFA_SESSIONS. */
const CFA_CREW: Seat[] = [
  {
    name: "Indy",
    forfeits: 0,
    sittings: [
      { day: 0, at: "20:10", mins: 135 },
      { day: 1, at: "20:05", mins: 128 },
      { day: 2, at: "19:50", mins: 142 },
      { day: 3, at: "06:00", mins: 140 },
    ],
  },
  {
    name: "Kwan Ratanakul",
    forfeits: 2,
    sittings: [
      { day: 0, at: "21:00", mins: 126 },
      { day: 1, at: "20:40", mins: 133 },
      { day: 3, at: "06:20", mins: 121 },
    ],
  },
];

/**
 * Four seats on purpose.
 *
 * seedCrew fills seat i with real[i], so a crew is only as inclusive as it is
 * long: the two-seat CFA crew stopped at the second real account, which left
 * Indy in one crew while the viewer was in two. Four seats reaches every real
 * account there is.
 *
 * `checkin` sessions have no check-out, so these carry a nominal duration the
 * rule never reads.
 *
 * The days are early in the week on purpose. Only sittings on or before today
 * are seeded, so a crew whose runs were all on Sunday produced no sessions, no
 * feed rows and an empty channel -- which is the one screen a demo lingers on.
 * One run each, already done, except the member who is behind.
 */
const RUN_CREW: Seat[] = [
  { name: "Indy", forfeits: 0, sittings: [{ day: 1, at: "07:15", mins: 74 }] },
  { name: "Nat Suwannarat", forfeits: 0, sittings: [{ day: 0, at: "06:40", mins: 96 }] },
  { name: "Pim Chaiyaphum", forfeits: 1, sittings: [] },
  { name: "Kwan Ratanakul", forfeits: 0, sittings: [{ day: 2, at: "07:05", mins: 68 }] },
];

/**
 * The three committed check-in photos, dealt round the crew.
 *
 * A channel with no pictures in it is the emptiest screen in the product, and
 * these are the same files lib/mock-session.ts uses -- served by the app, so
 * nothing on a stage waits on someone else's CDN.
 */
const CHECKIN_PHOTOS = [
  "/mock/checkin-rack.jpg",
  "/mock/checkin-dumbbells.jpg",
  "/mock/checkin-treadmill.jpg",
];

/**
 * "Nat Suwannarat" -> "Nat". What the bot calls somebody in a sentence.
 * lib/channel-view.ts keeps its own copy private; this is three lines and not
 * worth widening that file's surface for a seed script.
 */
function firstName(displayName: string): string {
  return displayName.split(" ")[0] || displayName;
}

function at(dayKey: string, hhmm: string): Date {
  return new Date(`${dayKey}T${hhmm}:00.000+07:00`);
}

/** The Monday n weeks before the given one. */
function weeksBefore(mondayKey: string, n: number): string {
  return new Date(new Date(`${mondayKey}T00:00:00Z`).getTime() - n * 7 * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

async function seedCrew(params: {
  name: string;
  rule: RuleConfig;
  crew: Seat[];
  real: User[];
  week: string[];
  todayIndex: number;
  usdRate: number;
}) {
  const { name, rule, crew, real, week, todayIndex, usdRate } = params;

  const users: User[] = [];
  for (const [i, seat] of crew.entries()) {
    // The viewer's seat goes to whoever is actually signed in.
    if (real[i]) {
      users.push(
        await prisma.user.update({
          where: { id: real[i].id },
          data: { walletFundedAt: real[i].walletFundedAt ?? new Date() },
        }),
      );
      continue;
    }
    const slug = seat.name.toLowerCase().split(" ")[0];
    users.push(
      await prisma.user.upsert({
        where: { privyId: `did:privy:seed-${slug}` },
        update: {},
        create: {
          privyId: `did:privy:seed-${slug}`,
          walletAddress: `seed-wallet-${slug}`,
          displayName: seat.name,
          // A face rather than initials. Committed under public/mock/faces, so
          // this is a path the app serves itself and a demo never waits on
          // somebody else's CDN. Named for the seat: swapping one is a file
          // drop with no code change.
          avatarUrl: `/mock/faces/${slug}.jpg`,
          walletFundedAt: new Date(),
        },
      }),
    );
  }

  const stakeUsdc = toUsdcAtomic(1000, usdRate);
  const vault = createVault();

  const pact = await prisma.pact.create({
    data: {
      name,
      inviteToken: randomBytes(9).toString("base64url"),
      createdById: users[0].id,
      ruleConfig: rule,
      timezone: TIMEZONE,
      stakeAmount: "1000",
      stakeCurrency: "THB",
      fxRateToUsd: usdRate.toFixed(8),
      fxFetchedAt: new Date(),
      stakeUsdc,
      vaultAddress: vault.publicKey,
      vaultSecretEnc: vault.secretEnc,
      status: "active",
      startsAt: at(weeksBefore(week[0], 5), "00:00"),
    },
  });

  const membershipOf = new Map<string, string>();

  for (const [i, seat] of crew.entries()) {
    const membership = await prisma.membership.create({
      data: {
        pactId: pact.id,
        userId: users[i].id,
        status: "staked",
        stakedAt: new Date(),
      },
    });
    membershipOf.set(seat.name, membership.id);

    // Sessions are written by checking in, so one dated tomorrow cannot exist.
    for (const [n, sitting] of seat.sittings.filter((s) => s.day <= todayIndex).entries()) {
      const startedAt = at(week[sitting.day], sitting.at);
      const endedAt = new Date(startedAt.getTime() + sitting.mins * 60_000);
      await prisma.session.create({
        data: {
          membershipId: membership.id,
          startedAt,
          endedAt,
          dayKey: dayKeyFor(startedAt, TIMEZONE),
        },
      });

      /**
       * The channel, written from the sessions rather than invented beside
       * them. The seed used to create no feed rows at all, so every seeded
       * crew opened onto an empty chat -- the screen a demo spends the most
       * time on, with nothing in it.
       *
       * Each sitting leaves what the real routes leave: the member checking
       * in with a photo, and checking out with the duration. A `checkin` rule
       * has no check-out, so it only gets the first.
       */
      const who = firstName(users[i].displayName);
      await prisma.feedItem.create({
        data: {
          pactId: pact.id,
          membershipId: membership.id,
          type: "checkin",
          body: checkedInLine(who),
          photoUrl: CHECKIN_PHOTOS[(i + n) % CHECKIN_PHOTOS.length],
          createdAt: startedAt,
        },
      });
      if (rule.sessionType === "checkin_checkout") {
        await prisma.feedItem.create({
          data: {
            pactId: pact.id,
            membershipId: membership.id,
            type: "checkout",
            body: checkedOutLine(who, sitting.mins),
            createdAt: endedAt,
          },
        });
      }
    }
  }

  /**
   * The settled weeks behind this one.
   *
   * The mock states each member's forfeits as a number; this turns them back
   * into the settlements they would have come from, so `readSettlement` derives
   * the same figures the fixture asserts by hand. One forfeit per week, oldest
   * first, and the pot split between everyone who kept it.
   */
  const schedule: string[] = [];
  for (const seat of crew) for (let n = 0; n < seat.forfeits; n += 1) schedule.push(seat.name);

  for (const [i, loser] of schedule.entries()) {
    const periodKey = weeksBefore(week[0], schedule.length - i);
    const winners = crew.filter((s) => s.name !== loser);
    const share = stakeUsdc / BigInt(winners.length);
    const remainder = stakeUsdc - share * BigInt(winners.length);

    const record: SettlementRecord = {
      periodKey,
      stakeUsdc: stakeUsdc.toString(),
      potUsdc: stakeUsdc.toString(),
      failed: [{ membershipId: membershipOf.get(loser)!, stakeUsdc: stakeUsdc.toString() }],
      payouts: winners.map((w, j) => ({
        membershipId: membershipOf.get(w.name)!,
        principalUsdc: stakeUsdc.toString(),
        shareUsdc: (j === 0 ? share + remainder : share).toString(),
        payoutMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        signature: null,
      })),
    };

    await prisma.settlement.create({
      data: { pactId: pact.id, periodKey, totalPotUsdc: stakeUsdc, payouts: record },
    });
  }

  return { pact, users };
}

async function main() {
  const now = new Date();
  const week = weekDayKeys(TIMEZONE, now);
  const todayIndex = Math.max(0, week.indexOf(dayKeyFor(now, TIMEZONE)));

  // Both crews, and anything an older version of this script left behind.
  const stale = await prisma.pact.findMany({
    where: {
      OR: [{ name: GYM }, { name: CFA }, { name: RUN }, { name: { contains: "seed-demo" } }],
    },
  });
  for (const p of stale) await prisma.pact.delete({ where: { id: p.id } });

  const real = await prisma.user.findMany({
    where: { privyId: { not: { startsWith: "did:privy:seed-" } } },
    orderBy: { createdAt: "asc" },
  });

  const usdRate = await fetchUsdRate("THB");

  const gym = await seedCrew({
    name: GYM, rule: GYM_RULE, crew: GYM_CREW, real, week, todayIndex, usdRate,
  });
  await seedCrew({
    name: RUN, rule: RUN_RULE, crew: RUN_CREW, real, week, todayIndex, usdRate,
  });
  await seedCrew({
    name: CFA, rule: CFA_RULE, crew: CFA_CREW, real, week, todayIndex, usdRate,
  });

  // --- read it back through the real path ---------------------------------
  const viewer = gym.users[0];
  const session = await liveSession(viewer, now);
  const view = await livePact(gym.pact.id, viewer, now);

  console.log("");
  console.log(`  Seeded "${GYM}", "${RUN}" and "${CFA}" — the mock, in Postgres.`);
  if (real.length > 0) {
    console.log(`  Viewer is a real account: ${real[0].displayName}`);
  }
  console.log("");
  console.log(`  pacts             ${session.pacts.length}`);
  console.log(`  stake             ${formatMoney(view!.stakeAmount, view!.stakeCurrency)}`);
  console.log(`  settled weeks     ${view!.settledPeriods}`);
  console.log(
    `  your ledger       earned ${formatMoney(view!.viewerEarned, view!.stakeCurrency)}` +
      `, lost ${formatMoney(view!.viewerLost, view!.stakeCurrency)}`,
  );
  console.log("");
  for (const m of view!.crew) {
    const you = m.isViewer ? "you" : "   ";
    const lost = m.forfeitedToDate > 0
      ? `  lost ${formatMoney(m.forfeitedToDate, view!.stakeCurrency)} over ${m.forfeitedPeriods}`
      : "";
    console.log(
      `    ${you}  ${m.displayName.padEnd(18)} ${m.daysDone} of ${m.required}   streak ${m.currentStreak}${lost}`,
    );
  }

  const problems: string[] = [];
  // At least two: the viewer may have crews of their own, which is fine.
  if (session.pacts.length < 2) problems.push(`expected 2 pacts, got ${session.pacts.length}`);
  if (view!.crew.length !== GYM_CREW.length) {
    problems.push(`gym crew is ${view!.crew.length}, seeded ${GYM_CREW.length}`);
  }
  const dave = view!.crew.find((m) => m.displayName === "Dave Whitfield");
  if (dave && dave.forfeitedPeriods !== 3) {
    problems.push(`Dave should have forfeited 3 weeks, has ${dave.forfeitedPeriods}`);
  }
  if (view!.crew.some((m) => m.initials.length !== 2)) {
    problems.push("an avatar came back with the wrong number of letters");
  }

  /**
   * Every real account should be in more than one crew.
   *
   * seedCrew fills seat i with real[i], so a crew is only as inclusive as it is
   * long -- the two-seat CFA crew stopped at the second account, and everybody
   * after it ended up with a single crew and a dashboard with a hole in it.
   * Checking it here is cheaper than noticing on a screen.
   */
  // Only the accounts that actually take a seat. seedCrew fills seat i with
  // real[i], so anybody past the longest crew is never seated and is not
  // supposed to be -- checking them would fail on every leftover row in the
  // database rather than on anything real.
  const seated = real.slice(0, Math.max(GYM_CREW.length, RUN_CREW.length, CFA_CREW.length));
  for (const account of seated) {
    const inCrews = await prisma.membership.count({
      where: { userId: account.id, pact: { name: { in: [GYM, CFA, RUN] } } },
    });
    if (inCrews < 2) {
      problems.push(`${account.displayName} is in ${inCrews} seeded crew, expected at least 2`);
    }
  }

  console.log("");
  console.log(problems.length === 0
    ? "  Every check passed. The screens read the same from the database as from the fixture."
    : "  PROBLEMS:\n" + problems.map((p) => `    !!  ${p}`).join("\n"));
  console.log("");
  console.log(`  Open it:  /pacts/${gym.pact.id}`);
  console.log("");

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("\n  seed failed:", e instanceof Error ? e.message : e, "\n");
  await prisma.$disconnect();
  process.exit(1);
});
