import "dotenv/config";
import { prisma } from "../lib/db";
import { createVault } from "../lib/vault";
import { fetchUsdRate, toUsdcAtomic } from "../lib/fx";
import { dayKeyFor, type RuleConfig } from "../lib/rules";
import { weekDayKeys } from "../lib/pact-view";
import { liveSession, livePact } from "../lib/queries";
import { formatMoney } from "../lib/money";
import { randomBytes } from "node:crypto";

/* ---------------------------------------------------------------------------
 * npm run seed
 *
 * Writes a real crew into the database and then reads it back through the real
 * query path -- the one every screen uses and that, until this script, had
 * never run against a row.
 *
 * The crew is the mock's: a five-a-week gym pact, four members, mid-week, with
 * one member already finished, one out of reach, and one who has joined and
 * not paid. Same story as lib/mock-session.ts, in Postgres, so the demo reads
 * the same whichever source is behind it.
 *
 * Re-runnable: it deletes its own crew first. It touches nothing else.
 * ------------------------------------------------------------------------- */

const TIMEZONE = "Asia/Bangkok";
const MARKER = "seed-demo";

const RULE: RuleConfig = {
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

/** Days into this crew-local week, and how long they went for. */
const CREW = [
  { name: "Indy", days: [0, 1, 2], status: "staked" as const, viewer: true },
  { name: "Nat Suwannarat", days: [0, 1, 2, 3, 4], status: "staked" as const, viewer: false },
  { name: "Pim Chaiyaphum", days: [0, 1, 3], status: "staked" as const, viewer: false },
  { name: "Dave Whitfield", days: [0], status: "staked" as const, viewer: false },
  // Joined from the QR code and has not paid. The state the demo turns on.
  { name: "Kwan Ratanakul", days: [], status: "invited" as const, viewer: false },
];

function at(dayKey: string, hhmm: string): Date {
  return new Date(`${dayKey}T${hhmm}:00.000+07:00`);
}

async function main() {
  const now = new Date();
  const week = weekDayKeys(TIMEZONE, now);

  /**
   * Sessions are written by checking in, so one dated tomorrow cannot exist in
   * the product. Seeding one makes `currentStreak` return 0 for somebody who
   * looks finished -- correctly, because their last day is in the future --
   * which reads as a bug in the app rather than in the fixture.
   */
  const todayIndex = Math.max(0, week.indexOf(dayKeyFor(now, TIMEZONE)));

  // --- clear the last run -------------------------------------------------
  const old = await prisma.pact.findMany({ where: { name: { startsWith: MARKER } } });
  for (const p of old) await prisma.pact.delete({ where: { id: p.id } });
  await prisma.user.deleteMany({ where: { privyId: { startsWith: `did:privy:${MARKER}` } } });

  // --- the crew -----------------------------------------------------------
  const users = [];
  for (const person of CREW) {
    const slug = person.name.toLowerCase().split(" ")[0];
    users.push(
      await prisma.user.create({
        data: {
          privyId: `did:privy:${MARKER}-${slug}`,
          walletAddress: `${MARKER}-wallet-${slug}`,
          displayName: person.name,
          // Everybody is through the funding gate; that is not what this seeds.
          walletFundedAt: new Date(),
        },
      }),
    );
  }

  const usdRate = await fetchUsdRate("THB");
  const vault = createVault();

  const pact = await prisma.pact.create({
    data: {
      name: `${MARKER} · Five a week`,
      inviteToken: randomBytes(9).toString("base64url"),
      createdById: users[0].id,
      ruleConfig: RULE,
      timezone: TIMEZONE,
      stakeAmount: "1000",
      stakeCurrency: "THB",
      fxRateToUsd: usdRate.toFixed(8),
      fxFetchedAt: new Date(),
      stakeUsdc: toUsdcAtomic(1000, usdRate),
      vaultAddress: vault.publicKey,
      vaultSecretEnc: vault.secretEnc,
      status: "active",
      startsAt: at(week[0], "00:00"),
    },
  });

  for (const [i, person] of CREW.entries()) {
    const membership = await prisma.membership.create({
      data: {
        pactId: pact.id,
        userId: users[i].id,
        status: person.status,
        stakedAt: person.status === "staked" ? new Date() : null,
      },
    });

    for (const day of person.days.filter((d) => d <= todayIndex)) {
      const startedAt = at(week[day], "06:05");
      await prisma.session.create({
        data: {
          membershipId: membership.id,
          startedAt,
          endedAt: new Date(startedAt.getTime() + 55 * 60_000),
          dayKey: dayKeyFor(startedAt, TIMEZONE),
        },
      });
    }
  }

  // --- read it back through the real path ---------------------------------
  const viewer = users[0];
  const session = await liveSession(viewer, now);
  const view = await livePact(pact.id, viewer, now);

  console.log("");
  console.log(`  Seeded "${pact.name}" — ${CREW.length} members, week of ${week[0]}`);
  console.log(`  Read back through lib/queries.ts, which had never run against a row.`);
  console.log("");
  console.log(`  viewer            ${session.user.displayName} (${session.user.initials})`);
  console.log(`  pacts             ${session.pacts.length}`);
  console.log(`  currency          ${session.currency}`);
  console.log(`  stake             ${formatMoney(view!.stakeAmount, view!.stakeCurrency)}  = ${view!.stakeUsdc} atomic`);
  console.log(`  status            ${view!.status}, viewer is ${view!.viewerStatus}`);
  console.log(`  vault             ${view!.vaultAddress}`);
  console.log(`  settled periods   ${view!.settledPeriods}`);
  console.log("");
  console.log("  standings, computed by the real leaderboard():");
  for (const m of view!.crew) {
    const flag = m.isViewer ? "you" : "   ";
    console.log(
      `    ${flag}  ${m.displayName.padEnd(18)} ${m.daysDone} of ${m.required}` +
        `   streak ${m.currentStreak}   ${m.status}   sessions ${m.sessions.length}`,
    );
  }
  console.log("");

  // --- the checks worth failing loudly on ---------------------------------
  const problems: string[] = [];

  const nat = view!.crew.find((m) => m.displayName.startsWith("Nat"));
  const natExpected = CREW[1].days.filter((d) => d <= todayIndex).length;
  if (nat?.daysDone !== natExpected) {
    problems.push(`Nat should have ${natExpected} days, has ${nat?.daysDone}`);
  }
  if (nat && nat.currentStreak !== natExpected) {
    problems.push(`Nat has been every day, so the streak should be ${natExpected}, is ${nat.currentStreak}`);
  }
  if (view!.crew.some((m) => m.initials.length !== 2 && m.displayName.trim().length > 1)) {
    problems.push("an avatar came back with a single letter");
  }

  const kwan = view!.crew.find((m) => m.displayName.startsWith("Kwan"));
  if (kwan?.status !== "invited") problems.push(`Kwan should be invited, is ${kwan?.status}`);
  if (kwan?.daysDone !== 0) problems.push(`Kwan should have 0 days, has ${kwan?.daysDone}`);

  const everyone = view!.crew.every((m) => m.sessions.every((sn) => sn.startedAt instanceof Date));
  if (!everyone) problems.push("a session timestamp came back as something other than a Date");

  if (view!.crew.length !== CREW.length) {
    problems.push(`crew is ${view!.crew.length}, seeded ${CREW.length}`);
  }
  if (view!.crew[0].daysDone < view!.crew[view!.crew.length - 1].daysDone) {
    problems.push("crew is not ordered by standing -- rank is read from array position");
  }

  if (problems.length === 0) {
    console.log("  Every check passed. The real query path produces what the screens expect.");
  } else {
    console.log("  PROBLEMS:");
    for (const p of problems) console.log(`    !!  ${p}`);
  }
  console.log("");
  console.log(`  Open it:  /pacts/${pact.id}`);
  console.log("");

  await prisma.$disconnect();
  if (problems.length > 0) process.exit(1);
}

main().catch(async (e) => {
  console.error("\n  seed failed:", e instanceof Error ? e.message : e, "\n");
  await prisma.$disconnect();
  process.exit(1);
});
