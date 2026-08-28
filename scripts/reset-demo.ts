import "dotenv/config";
import { prisma } from "../lib/db";

/* ---------------------------------------------------------------------------
 * npm run reset
 *
 * Empties the database so the next sign-in is somebody's first.
 *
 * Rehearsing this product means being two people, repeatedly: sign in, get a
 * wallet, be blocked by the gate, make a crew, scan the code as the other one.
 * Every run leaves rows that make the next run start halfway through -- an
 * account already past onboarding does not see the gate, which is the beat
 * being rehearsed.
 *
 * Cascades do most of the work: deleting a Pact takes its memberships,
 * sessions, feed and settlements with it. Users go last, once nothing points
 * at them.
 *
 * You still have to sign out in the browser -- Privy's session lives there,
 * not here. Settings has a button for it now.
 * ------------------------------------------------------------------------- */

async function main() {
  const before = {
    users: await prisma.user.count(),
    pacts: await prisma.pact.count(),
    settlements: await prisma.settlement.count(),
  };

  // Order matters where a relation has no cascade: reactions and votes point at
  // users, and a user cannot be deleted while one of those still names them.
  await prisma.reaction.deleteMany();
  await prisma.vote.deleteMany();
  await prisma.pact.deleteMany();
  await prisma.user.deleteMany();

  console.log("");
  console.log(`  Cleared ${before.users} users, ${before.pacts} pacts, ${before.settlements} settlements.`);
  console.log("");
  console.log("  Next: sign out in the browser too -- Privy's session is not in this database.");
  console.log("  Settings -> Sign out, or clear site data for localhost:3000.");
  console.log("");

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("\n  reset failed:", e instanceof Error ? e.message : e, "\n");
  await prisma.$disconnect();
  process.exit(1);
});
