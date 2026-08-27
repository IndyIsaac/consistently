import "dotenv/config";
import { Keypair } from "@solana/web3.js";
import { buildOrder, USDC_MINT, WSOL_MINT } from "../lib/dflow";
import { assertIsOurStakeTx, headroomFor, sizeInputLeg, StakeGuardError } from "../lib/stake";
import { deserializeTx, signWith, simulateOnly } from "../lib/solana";
import { getQuote } from "../lib/dflow";

/* ---------------------------------------------------------------------------
 * npm run rehearse
 *
 * The whole stake path, server side, with throwaway keys and no money:
 *
 *   price it -> size the input leg -> build the order -> member signs ->
 *   sponsor co-signs -> the guard checks it -> the network verifies both
 *   signatures and simulates it
 *
 * WHAT THIS PROVES. That `signWith` adds the sponsor's signature without
 * clearing the member's -- which is the assumption the entire sponsored-swap
 * design rests on, and the one that is invisible until a validator looks at
 * it. `sigVerify: true` makes the simulator check both before running an
 * instruction, so a broken signing path fails here rather than on stage.
 *
 * WHAT IT DOES NOT PROVE. That a *wallet* preserves the sponsor's empty slot
 * through its own signing round-trip. This signs with a local keypair, which
 * is what Privy or Phantom would do to the same bytes -- so if this passes and
 * the browser does not, the fault is unambiguously in the wallet's
 * serialisation, and that is worth knowing precisely.
 *
 * Nothing is broadcast. Nothing is spent. No database is touched.
 * ------------------------------------------------------------------------- */

const STAKE_USDC = 1_000_000n; // $1 -- the stake a sane demo actually uses
const SLIPPAGE_BPS = 100;

function line(mark: string, text: string) {
  console.log(`  ${mark}  ${text}`);
}

async function main() {
  console.log("");
  console.log("  Rehearsing a $1 stake in SOL. Throwaway keys, nothing broadcast.");
  console.log("");

  const member = Keypair.generate();
  const sponsor = Keypair.generate();
  const vault = Keypair.generate();

  line("··", `member   ${member.publicKey.toBase58()}`);
  line("··", `sponsor  ${sponsor.publicKey.toBase58()}`);
  line("··", `vault    ${vault.publicKey.toBase58()}`);
  console.log("");

  // 1. Price the reverse direction -- DFlow has no exact-out.
  const probe = await getQuote({
    inputMint: USDC_MINT,
    outputMint: WSOL_MINT,
    amount: STAKE_USDC,
    slippageBps: SLIPPAGE_BPS,
  });
  const headroom = headroomFor(Number(probe.priceImpactPct), SLIPPAGE_BPS);
  const inputAmount = sizeInputLeg(BigInt(probe.outAmount), headroom);
  line("ok", `priced: $1 is ${(Number(probe.outAmount) / 1e9).toFixed(6)} SOL, +${(headroom * 100).toFixed(1)}% headroom`);

  // 2. The real order, delivering into the vault, sponsor as fee payer.
  const order = await buildOrder({
    inputMint: WSOL_MINT,
    outputMint: USDC_MINT,
    amount: inputAmount,
    userPublicKey: member.publicKey.toBase58(),
    destinationWallet: vault.publicKey.toBase58(),
    sponsor: sponsor.publicKey.toBase58(),
    sponsorExec: false,
    slippageBps: SLIPPAGE_BPS,
  });
  line("ok", `order built: worst case ${order.minOutAmount} USDC out (need ${STAKE_USDC})`);

  if (BigInt(order.minOutAmount) < STAKE_USDC) {
    line("!!", "the guaranteed output is below the stake -- headroom is too thin for this pair");
  }

  const tx = deserializeTx(order.transaction!);
  line("ok", `route: ${order.routePlan?.map((l) => l.venue).join(" > ")}`);

  // 3. Both signatures, in the order the product does it.
  const before = tx.signatures.map((s) => s.some((b) => b !== 0));
  signWith(tx, [member]);
  const afterMember = tx.signatures.map((s) => s.some((b) => b !== 0));
  signWith(tx, [sponsor]);
  const afterSponsor = tx.signatures.map((s) => s.some((b) => b !== 0));

  line("··", `slots from DFlow      [${before.join(", ")}]`);
  line("··", `after the member      [${afterMember.join(", ")}]`);
  line("··", `after the sponsor     [${afterSponsor.join(", ")}]`);

  if (!afterSponsor.every(Boolean)) {
    line("!!", "a slot is still empty -- signWith cleared one it should have kept");
    process.exit(1);
  }
  line("ok", "both slots filled: co-signing does not clear the first signature");

  // 4. The guard that stops the sponsor paying for a stranger's transaction.
  try {
    assertIsOurStakeTx(tx, { sponsor: sponsor.publicKey, vault: vault.publicKey, kind: "swap" });
    line("ok", "guard accepts it: two signers, our sponsor paying, our vault, our programs");
  } catch (e) {
    line("!!", `guard REFUSED a real order: ${e instanceof StakeGuardError ? e.message : e}`);
    process.exit(1);
  }

  // 5. The network's verdict, signatures checked first.
  const sim = await simulateOnly(tx);

  console.log("");
  if (sim.ok) {
    line("ok", `the network would accept this. ${sim.unitsConsumed ?? "?"} compute units.`);
    console.log("");
    console.log("  Every step passed, including a funded one -- which is unexpected for a");
    console.log("  wallet generated ten seconds ago. Check nothing is pointing at real keys.");
  } else {
    const broke = sim.error ?? "";
    const funds = /insufficient|InsufficientFunds|0x1\b|AccountNotFound/i.test(broke);
    if (funds) {
      line("ok", "signatures verified. Refused for lack of funds, which is the expected end.");
      console.log("");
      console.log("  This is a pass. The simulator checks every signature BEFORE it runs an");
      console.log("  instruction, so reaching a balance error means the route, the guard, the");
      console.log("  accounts and both signatures were all accepted. The only thing missing");
      console.log("  from a real stake is the money.");
    } else {
      line("!!", `refused for something other than funds: ${broke}`);
      console.log("");
      for (const log of sim.logs.slice(-8)) console.log(`      ${log}`);
      process.exit(1);
    }
  }
  console.log("");
}

main().catch((e) => {
  console.error("\n  rehearsal failed:", e instanceof Error ? e.message : e, "\n");
  process.exit(1);
});
