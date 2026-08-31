import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { PublicKey, TransactionMessage, VersionedTransaction } from "@solana/web3.js";

import { prisma } from "@/lib/db";
import { USDC_MINT } from "@/lib/dflow";
import { fromUsdcAtomic } from "@/lib/fx";
import { formatMoney } from "@/lib/money";
import { getConnection, loadSponsor, signWith, submitAndConfirm } from "@/lib/solana";
import { loadVault } from "@/lib/vault";

/* ---------------------------------------------------------------------------
 * npx tsx scripts/sweep-vault.ts <pactId> <destination> [--confirm]
 *
 * The way out.
 *
 * docs/security/escrow-protocol.md says in its first sentence that we can take
 * the money. Until this file that was true and unperformable: the vault key is
 * recoverable -- VAULT_ENCRYPTION_KEY plus the pact's `vaultSecretEnc` -- but
 * nothing in the product decrypts it outside a settlement, and there is no
 * refund, no leave, and no admin route. A stake that got stuck was stuck until
 * somebody wrote this, at whatever hour they discovered they needed it.
 *
 * It is deliberately not part of the app. No route reaches it; running it needs
 * the environment, which means Railway's variables or a copy of .env.
 *
 * READ-ONLY BY DEFAULT. Without `--confirm` it prints what it would move and
 * stops. That is the mode to run first, every time.
 *
 * The transfer is built here rather than borrowed from lib/settlement.ts on
 * purpose. That file's `send` honours STAKE_DRY_RUN and simulates instead of
 * broadcasting -- correct for a rehearsal, and precisely wrong for a recovery
 * tool, which would report success and move nothing. This one always
 * broadcasts once confirmed, whatever the environment says.
 *
 * The sponsor pays the fee, as it does everywhere else: the vault holds USDC
 * and no SOL, so it cannot pay its own way out.
 *
 * Everything runs inside `main`, like every other script here. tsx compiles
 * these to CJS, where a top-level await is a build error rather than a slower
 * start -- which is a thing to find out now and not while sweeping a vault.
 * ------------------------------------------------------------------------- */

async function main() {
  const [pactId, destination, ...flags] = process.argv.slice(2);
  const confirm = flags.includes("--confirm");

  if (!pactId || !destination) {
    console.error("usage: npx tsx scripts/sweep-vault.ts <pactId> <destination> [--confirm]");
    process.exit(1);
  }

  let owner: PublicKey;
  try {
    owner = new PublicKey(destination);
  } catch {
    console.error(`  ${destination} is not a Solana address.`);
    process.exit(1);
  }

  const pact = await prisma.pact.findUnique({
    where: { id: pactId },
    select: {
      name: true,
      vaultAddress: true,
      vaultSecretEnc: true,
      stakeCurrency: true,
      fxRateToUsd: true,
    },
  });

  if (!pact) {
    console.error(`  No pact with id ${pactId}.`);
    process.exit(1);
  }

  const mint = new PublicKey(USDC_MINT);
  const vault = loadVault(pact.vaultSecretEnc);
  const fromAta = getAssociatedTokenAddressSync(mint, vault.publicKey);
  const toAta = getAssociatedTokenAddressSync(mint, owner);

  const connection = getConnection();

  let amount: bigint;
  try {
    const balance = await connection.getTokenAccountBalance(fromAta);
    amount = BigInt(balance.value.amount);
  } catch {
    // No token account at all is the commonest "nothing to sweep": a vault that
    // was created and never funded has no USDC account, not an empty one.
    console.log(`\n  ${pact.name}`);
    console.log(`  Vault ${pact.vaultAddress} holds no USDC account. Nothing to sweep.\n`);
    return;
  }

  const inCrewMoney = formatMoney(
    fromUsdcAtomic(amount, pact.fxRateToUsd.toNumber()),
    pact.stakeCurrency,
  );

  console.log(`\n  Pact         ${pact.name}`);
  console.log(`  Vault        ${pact.vaultAddress}`);
  console.log(`  Holds        ${(Number(amount) / 1e6).toFixed(6)} USDC  (${inCrewMoney})`);
  console.log(`  Destination  ${destination}`);

  if (amount === 0n) {
    console.log(`\n  Nothing to sweep.\n`);
    return;
  }

  if (!confirm) {
    console.log(`\n  Nothing moved. Re-run with --confirm to send it.\n`);
    return;
  }

  const sponsor = loadSponsor();
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");

  const message = new TransactionMessage({
    payerKey: sponsor.publicKey,
    recentBlockhash: blockhash,
    instructions: [
      createAssociatedTokenAccountIdempotentInstruction(sponsor.publicKey, toAta, owner, mint),
      createTransferCheckedInstruction(fromAta, mint, toAta, vault.publicKey, amount, 6),
    ],
  }).compileToV0Message();

  const tx = new VersionedTransaction(message);
  signWith(tx, [vault, sponsor]);

  console.log(`\n  Sending…`);
  const signature = await submitAndConfirm(tx, lastValidBlockHeight);
  console.log(`  Done. https://explorer.solana.com/tx/${signature}\n`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error("\n  sweep failed:", e instanceof Error ? e.message : e, "\n");
    await prisma.$disconnect();
    process.exit(1);
  });
