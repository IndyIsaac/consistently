import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { TransactionMessage } from "@solana/web3.js";
import { prisma } from "@/lib/db";
import { buildOrder, getQuote, USDC_MINT, WSOL_MINT } from "@/lib/dflow";
import {
  deserializeTx,
  getConnection,
  loadSponsor,
  serializeTx,
  signWith,
  submitAndConfirm,
} from "@/lib/solana";

/* ---------------------------------------------------------------------------
 * Putting money in.
 *
 * A member stakes in whatever they hold. DFlow's /order converts it to USDC and
 * delivers it straight into the pact's vault via `destinationWallet`, and the
 * sponsor wallet pays the fee -- so a member needs neither the right token nor
 * any SOL. That is the product's fifth principle made mechanical, and it is the
 * half of the DFlow story that has a person in it.
 *
 * The shape of the transaction, verified against a live order:
 *   - two signers; `staticAccountKeys[0]` is the sponsor and the fee payer
 *   - both signature slots come back empty
 *   - exactly two programs: ComputeBudget and DFlow
 *   - two address-table lookups
 *   - the destination ATA is created by the route, rent paid by the fee payer,
 *     so a brand-new vault needs no setup and never needs SOL
 * ------------------------------------------------------------------------- */

export const DFLOW_PROGRAM_ID = "DF1ow4tspfHX9JwWJsAb9epbkA8hmpSEAtxXy1V27QBH";
const COMPUTE_BUDGET_PROGRAM_ID = "ComputeBudget111111111111111111111111111111";
const ATA_PROGRAM_ID = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";

/** Programs a sponsored swap is allowed to touch. Anything else is not ours. */
const SWAP_PROGRAMS = new Set([COMPUTE_BUDGET_PROGRAM_ID, DFLOW_PROGRAM_ID]);
/** Programs the plain USDC path is allowed to touch. */
const TRANSFER_PROGRAMS = new Set([
  COMPUTE_BUDGET_PROGRAM_ID,
  TOKEN_PROGRAM_ID.toBase58(),
  ATA_PROGRAM_ID,
]);

const SLIPPAGE_BPS = 100;

/** Native SOL is the input the route spends from directly; leave a little. */
const WSOL_MINT_STR = WSOL_MINT;
const SOL_BUFFER_LAMPORTS = 5_000_000n;

/**
 * The floor is not arbitrary. Measured on SOL/USDC -- the deepest pair on the
 * chain -- at 100bps: sizing the input leg from a reverse probe with no
 * headroom produces a worst-case output *below* the stake, deterministically.
 * The round trip pays the slippage tolerance twice and the spread once.
 */
const HEADROOM_FLOOR = 0.03;

/** Thin pairs read short in both directions, so cover the impact twice over. */
export function headroomFor(priceImpactPct: number, slippageBps: number): number {
  const impact = Math.max(0, priceImpactPct) / 100;
  return Math.max(HEADROOM_FLOOR, 2 * impact + slippageBps / 10_000);
}

/** Rounds up: rounding down here would leave the stake a unit short. */
export function sizeInputLeg(probeOut: bigint, headroom: number): bigint {
  const scale = 1_000_000n;
  const factor = BigInt(Math.round((1 + headroom) * Number(scale)));
  return (probeOut * factor + scale - 1n) / scale;
}

export function computeStakeInput(params: { inputMint: string; stakeUsdc: bigint }): {
  kind: "transfer" | "swap";
  amount: bigint;
} {
  return params.inputMint === USDC_MINT
    ? { kind: "transfer", amount: params.stakeUsdc }
    : { kind: "swap", amount: params.stakeUsdc };
}

/** A refusal the member is meant to read, as opposed to a server fault. */
export class StakeGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StakeGuardError";
  }
}

/**
 * The sponsor guard.
 *
 * `finaliseStake` signs whatever it is handed with the sponsor key, and the
 * sponsor is the fee payer -- so without this, anyone could post arbitrary
 * transaction bytes and have us pay for them. The checks are structural rather
 * than an exact byte comparison, because keeping the built message across a
 * serverless invocation would need a table this build does not have.
 *
 * What it cannot stop: somebody getting the sponsor to pay for a *different*
 * DFlow swap that still delivers into this vault. That is a donation to the
 * crew, not a theft, and it costs us one transaction fee.
 */
export function assertIsOurStakeTx(
  tx: VersionedTransaction,
  expected: { sponsor: PublicKey; vault: PublicKey; kind?: "swap" | "transfer" },
): void {
  const keys = tx.message.staticAccountKeys;

  if (tx.message.header.numRequiredSignatures !== 2) {
    throw new StakeGuardError("That transaction is not a stake.");
  }
  if (!keys[0]?.equals(expected.sponsor)) {
    throw new StakeGuardError("That transaction does not pay its fee the way ours do.");
  }
  if (!keys.some((k) => k.equals(expected.vault))) {
    throw new StakeGuardError("That transaction does not reach this pact's vault.");
  }

  const allowed = expected.kind === "transfer" ? TRANSFER_PROGRAMS : SWAP_PROGRAMS;
  for (const ix of tx.message.compiledInstructions) {
    const programId = keys[ix.programIdIndex]?.toBase58();
    if (!programId || !allowed.has(programId)) {
      throw new StakeGuardError("That transaction calls something we do not route through.");
    }
  }
}

export type BuiltStake = {
  transactionB64: string;
  lastValidBlockHeight: number;
  kind: "swap" | "transfer";
  quote: { inAmount: string; outAmount: string; minOutAmount: string; venues: string[] };
};

/**
 * Sizes the input leg by pricing the reverse direction.
 *
 * DFlow has no exact-out primitive -- `swapMode=ExactOut` is accepted and
 * silently ignored, returning a plain ExactIn quote -- so "give me exactly this
 * much USDC" has to be approximated by asking what that USDC is worth in the
 * member's token and then over-sending by the headroom above.
 */
async function buildSwapStake(params: {
  inputMint: string;
  stakeUsdc: bigint;
  userWallet: string;
  vaultAddress: string;
  attempt: number;
}): Promise<BuiltStake> {
  const sponsor = loadSponsor();

  const probe = await getQuote({
    inputMint: USDC_MINT,
    outputMint: params.inputMint,
    amount: params.stakeUsdc,
    slippageBps: SLIPPAGE_BPS,
  });

  const impact = Number(probe.priceImpactPct);
  if (Number.isFinite(impact) && impact > 1) {
    throw new StakeGuardError(
      "That token is too thin to price a stake in. Stake in SOL or USDC instead.",
    );
  }

  // One retry widens the headroom rather than repeating the same arithmetic:
  // the price moved between the two quotes, which is the usual reason.
  const headroom = headroomFor(impact, SLIPPAGE_BPS) + (params.attempt > 0 ? 0.02 : 0);
  const inputAmount = sizeInputLeg(BigInt(probe.outAmount), headroom);

  const afford = await affordability({
    userWallet: params.userWallet,
    inputMint: params.inputMint,
    inputAmount,
  });
  if (!afford.ok) {
    throw new StakeGuardError(
      `Not enough in the wallet: this stake needs ${inputAmount} and you have ${afford.held}.`,
    );
  }

  const order = await buildOrder({
    inputMint: params.inputMint,
    outputMint: USDC_MINT,
    amount: inputAmount,
    userPublicKey: params.userWallet,
    destinationWallet: params.vaultAddress,
    sponsor: sponsor.publicKey.toBase58(),
    sponsorExec: false,
    slippageBps: SLIPPAGE_BPS,
  });

  if (BigInt(order.minOutAmount) < params.stakeUsdc) {
    if (params.attempt === 0) {
      return buildSwapStake({ ...params, attempt: 1 });
    }
    throw new StakeGuardError("The price moved while we were pricing it. Try again.");
  }

  return {
    transactionB64: order.transaction!,
    lastValidBlockHeight: order.lastValidBlockHeight!,
    kind: "swap",
    quote: {
      inAmount: order.inAmount,
      outAmount: order.outAmount,
      minOutAmount: order.minOutAmount,
      venues: order.routePlan?.map((leg) => leg.venue) ?? [],
    },
  };
}

/**
 * The USDC path. No swap: DFlow cannot route a mint to itself, and a member
 * funded from an exchange most likely holds exactly USDC. The sponsor is still
 * the fee payer, so this member also needs no SOL.
 */
async function buildUsdcStake(params: {
  stakeUsdc: bigint;
  userWallet: string;
  vaultAddress: string;
}): Promise<BuiltStake> {
  const sponsor = loadSponsor();
  const mint = new PublicKey(USDC_MINT);
  const from = new PublicKey(params.userWallet);
  const to = new PublicKey(params.vaultAddress);

  const afford = await affordability({
    userWallet: params.userWallet,
    inputMint: USDC_MINT,
    inputAmount: params.stakeUsdc,
  });
  if (!afford.ok) {
    throw new StakeGuardError(
      `Not enough USDC in the wallet: this stake needs ${params.stakeUsdc} and you have ${afford.held}.`,
    );
  }

  const fromAta = getAssociatedTokenAddressSync(mint, from);
  const toAta = getAssociatedTokenAddressSync(mint, to);

  const { blockhash, lastValidBlockHeight } = await getConnection().getLatestBlockhash("confirmed");

  const message = new TransactionMessage({
    payerKey: sponsor.publicKey,
    recentBlockhash: blockhash,
    instructions: [
      // Idempotent: a vault that has already taken a stake has this account.
      createAssociatedTokenAccountIdempotentInstruction(sponsor.publicKey, toAta, to, mint),
      createTransferCheckedInstruction(fromAta, mint, toAta, from, params.stakeUsdc, 6),
    ],
  }).compileToV0Message();

  return {
    transactionB64: serializeTx(new VersionedTransaction(message)),
    lastValidBlockHeight,
    kind: "transfer",
    quote: {
      inAmount: params.stakeUsdc.toString(),
      outAmount: params.stakeUsdc.toString(),
      minOutAmount: params.stakeUsdc.toString(),
      venues: [],
    },
  };
}

/**
 * What the stake costs, without committing to anything.
 *
 * A quote-only call: no `userPublicKey`, so no transaction and no blockhash,
 * so it can sit on screen for as long as the member wants to look at it. The
 * order that actually gets signed is built on the tap -- see below.
 */
export async function previewStake(params: {
  pactId: string;
  inputMint: string;
}): Promise<{ kind: "swap" | "transfer"; inAmount: string; venues: string[] }> {
  const pact = await prisma.pact.findUniqueOrThrow({ where: { id: params.pactId } });

  if (params.inputMint === USDC_MINT) {
    return { kind: "transfer", inAmount: pact.stakeUsdc.toString(), venues: [] };
  }

  const probe = await getQuote({
    inputMint: USDC_MINT,
    outputMint: params.inputMint,
    amount: pact.stakeUsdc,
    slippageBps: SLIPPAGE_BPS,
  });

  const headroom = headroomFor(Number(probe.priceImpactPct), SLIPPAGE_BPS);
  return {
    kind: "swap",
    inAmount: sizeInputLeg(BigInt(probe.outAmount), headroom).toString(),
    venues: probe.routePlan?.map((leg) => leg.venue) ?? [],
  };
}

/**
 * Built on the tap, never ahead of it.
 *
 * The order's blockhash is good for about 149 blocks -- a minute. A flow that
 * shows a quote, waits for the member to read it, and only then builds is a
 * flow whose transaction is dead before it is signed. The stake sheet shows an
 * indicative `getQuote()` instead, which carries no blockhash and can sit on
 * screen indefinitely.
 */
export async function buildStakeTransaction(params: {
  pactId: string;
  userWallet: string;
  inputMint: string;
}): Promise<BuiltStake> {
  const pact = await prisma.pact.findUniqueOrThrow({ where: { id: params.pactId } });
  const { kind } = computeStakeInput({
    inputMint: params.inputMint,
    stakeUsdc: pact.stakeUsdc,
  });

  return kind === "transfer"
    ? buildUsdcStake({
        stakeUsdc: pact.stakeUsdc,
        userWallet: params.userWallet,
        vaultAddress: pact.vaultAddress,
      })
    : buildSwapStake({
        inputMint: params.inputMint,
        stakeUsdc: pact.stakeUsdc,
        userWallet: params.userWallet,
        vaultAddress: pact.vaultAddress,
        attempt: 0,
      });
}

/**
 * Whether the member can actually cover the input leg.
 *
 * Without this the transaction is built, signed, and then refused by the RPC
 * at preflight -- which produces a raw node error rather than a sentence, and
 * does not even carry a signature to reconcile against. Checking first is also
 * what makes the onboarding gate mean something: "holds anything" is not the
 * same as "holds enough".
 */
export async function affordability(params: {
  userWallet: string;
  inputMint: string;
  inputAmount: bigint;
}): Promise<{ ok: true } | { ok: false; held: bigint }> {
  const connection = getConnection();
  const owner = new PublicKey(params.userWallet);

  if (params.inputMint === WSOL_MINT_STR) {
    const lamports = BigInt(await connection.getBalance(owner));
    // Leave a little native SOL behind rather than draining the account to
    // zero: the sponsor covers fees here, but not everywhere forever.
    const spendable = lamports > SOL_BUFFER_LAMPORTS ? lamports - SOL_BUFFER_LAMPORTS : 0n;
    return spendable >= params.inputAmount ? { ok: true } : { ok: false, held: spendable };
  }

  const ata = getAssociatedTokenAddressSync(new PublicKey(params.inputMint), owner);
  try {
    const balance = await connection.getTokenAccountBalance(ata);
    const held = BigInt(balance.value.amount);
    return held >= params.inputAmount ? { ok: true } : { ok: false, held };
  } catch {
    // No token account at all means no balance.
    return { ok: false, held: 0n };
  }
}

/**
 * Co-signs the member's transaction with the sponsor and puts it on chain.
 *
 * `signWith` adds signatures without clearing the member's, which is the whole
 * reason the sponsor half happens here rather than on the client: the sponsor
 * key never leaves the server, and the outcome is learned from the chain rather
 * than from the caller's say-so.
 */
export async function finaliseStake(params: {
  pactId: string;
  userWallet: string;
  signedTxB64: string;
  lastValidBlockHeight: number;
  kind: "swap" | "transfer";
}): Promise<{ signature: string }> {
  const pact = await prisma.pact.findUniqueOrThrow({ where: { id: params.pactId } });
  const sponsor = loadSponsor();

  const tx = deserializeTx(params.signedTxB64);
  assertIsOurStakeTx(tx, {
    sponsor: sponsor.publicKey,
    vault: new PublicKey(pact.vaultAddress),
    kind: params.kind,
  });

  signWith(tx, [sponsor]);
  const signature = await submitAndConfirm(tx, params.lastValidBlockHeight);

  const user = await prisma.user.findUniqueOrThrow({
    where: { walletAddress: params.userWallet },
  });

  await prisma.membership.update({
    where: { pactId_userId: { pactId: params.pactId, userId: user.id } },
    data: { status: "staked", stakedAt: new Date(), stakeTxSig: signature },
  });

  await prisma.feedItem.create({
    data: {
      pactId: params.pactId,
      type: "bot",
      body: `${user.displayName} is in. Stake locked.`,
    },
  });

  // The pact starts only once everybody has staked. Nobody is exposed to a rule
  // the rest of the crew has not paid for yet.
  const members = await prisma.membership.findMany({
    where: { pactId: params.pactId, status: { not: "left" } },
  });
  if (members.length > 0 && members.every((m) => m.status === "staked")) {
    await prisma.pact.update({
      where: { id: params.pactId },
      data: { status: "active", startsAt: new Date() },
    });
    await prisma.feedItem.create({
      data: { pactId: params.pactId, type: "bot", body: "Everyone's staked. The pact is live." },
    });
  }

  return { signature };
}

/**
 * Puts a settled member back into funding for the next period.
 *
 * Their previous stake is gone either way -- winners were paid out and losers
 * forfeited -- so carrying on means putting a fresh one up.
 *
 * Note this returns the whole pact to `funding`, which is also the state
 * `POST /api/pacts/join` checks. That is why `findOpenPact` requires *both*
 * `funding` and no settlements: without the second condition, one member going
 * again would quietly re-open a months-old crew to anyone holding an old code.
 */
export async function reopenForNextPeriod(params: {
  pactId: string;
  userWallet: string;
}): Promise<{ membershipId: string }> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { walletAddress: params.userWallet },
  });

  const membership = await prisma.membership.findUniqueOrThrow({
    where: { pactId_userId: { pactId: params.pactId, userId: user.id } },
  });

  if (membership.status === "left") throw new StakeGuardError("You have left this crew.");
  if (membership.status === "staked") {
    throw new StakeGuardError("You are already staked for this period.");
  }

  await prisma.membership.update({
    where: { id: membership.id },
    data: { status: "invited", stakedAt: null, stakeTxSig: null, payoutTxSig: null },
  });

  await prisma.pact.update({
    where: { id: params.pactId },
    data: { status: "funding", startsAt: null },
  });

  await prisma.feedItem.create({
    data: {
      pactId: params.pactId,
      membershipId: membership.id,
      type: "bot",
      body: `${user.displayName} is going again. Waiting on their stake.`,
    },
  });

  return { membershipId: membership.id };
}
