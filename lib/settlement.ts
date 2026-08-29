import {
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { buildOrder, PAYOUT_MINTS, USDC_MINT } from "@/lib/dflow";
import { fromUsdcAtomic } from "@/lib/fx";
import { formatMoney } from "@/lib/money";
import { periodDayKeys } from "@/lib/pact-view";
import { dayKeyFor, hasFailed, RuleConfigSchema } from "@/lib/rules";
import {
  deserializeTx,
  DRY_RUN,
  DRY_RUN_SIGNATURE_PREFIX,
  getConnection,
  loadSponsor,
  signWith,
  simulateOnly,
  submitAndConfirm,
} from "@/lib/solana";
import { loadVault } from "@/lib/vault";

/* ---------------------------------------------------------------------------
 * What a settled period leaves behind.
 *
 * The pure half: how a pot divides, and how a stored settlement is read back.
 * `settlePact` -- the half that signs and submits -- lives below in the same
 * file so the shape and the writer cannot drift.
 *
 * WHY THE RECORD IS THIS WIDE. `Settlement` stores `totalPotUsdc` and a
 * `payouts` Json blob. `totalPotUsdc / stakeUsdc` says how many members
 * forfeited but never which ones, and `Membership.status` is overwritten the
 * next period -- so by Tuesday last week's losers are invisible. That makes
 * "You are ฿333 up" and "Dave owes ฿3,000 and has for five weeks" -- the
 * dashboard headline and the crew table -- unbackable by anything stored.
 * Recording `failed` and splitting each payout into principal and share is
 * what makes both derivable, and it needs no migration because the column is
 * already Json.
 * ------------------------------------------------------------------------- */

/** A whole number of atomic units, as a decimal string. Never a number: `JSON.stringify` throws on a BigInt, and six-decimal atomic units leave safe-integer range for a large enough stake. */
const Atomic = z.string().regex(/^\d+$/, "must be a whole number of atomic units");

export const SettlementRecordSchema = z.object({
  periodKey: z.string(),
  /** The pact's per-member stake at the moment it settled. */
  stakeUsdc: Atomic,
  /**
   * What was actually in the vault and got redistributed. Not `n × stakeUsdc`:
   * a member staking a non-USDC token overpays by the slippage headroom, and
   * that surplus belongs to the crew rather than accreting in the vault.
   */
  potUsdc: Atomic,
  failed: z.array(z.object({ membershipId: z.string(), stakeUsdc: Atomic })),
  payouts: z.array(
    z.object({
      membershipId: z.string(),
      /** Their own stake, returned. A winner keeps what they put in. */
      principalUsdc: Atomic,
      /** Their cut of the forfeited stakes. */
      shareUsdc: Atomic,
      payoutMint: z.string(),
      /** Null until the swap lands, so a resumed settlement knows what is left. */
      signature: z.string().nullable(),
    }),
  ),
});

export type SettlementRecord = z.infer<typeof SettlementRecordSchema>;

/**
 * Divides the forfeited stakes equally between the members who kept the rule.
 *
 * The indivisible remainder goes to the first winner rather than being dropped,
 * so the pot always sums back to exactly what went in. `leaderboard()` orders
 * the crew by standing, so "the first winner" is the member who did best --
 * which is the only tie-break that does not need explaining to a crew.
 *
 * Returns nothing when nobody failed (no pot) or nobody passed (no recipient).
 * In the second case the money stays in the vault; inventing a recipient for it
 * would be worse than leaving it where the crew can see it.
 */
export function splitPot(params: {
  failedStakes: bigint[];
  winnerIds: string[];
}): { winnerId: string; amount: bigint }[] {
  const pot = params.failedStakes.reduce((sum, v) => sum + v, 0n);
  const n = BigInt(params.winnerIds.length);
  if (pot === 0n || n === 0n) return [];

  const share = pot / n;
  const remainder = pot - share * n;

  return params.winnerIds.map((winnerId, i) => ({
    winnerId,
    amount: i === 0 ? share + remainder : share,
  }));
}

/**
 * Reads a stored settlement back, in the pact's own currency.
 *
 * `usdRate` must be the rate the pact locked at creation. A settlement that
 * happened at last month's rate has to keep reporting itself at last month's
 * rate, or every figure on the dashboard drifts each time the page is opened.
 *
 * A record this cannot parse -- one written by an earlier build -- reports
 * zeroes rather than throwing. A dashboard that renders one stale week as
 * blank is recoverable; one that 500s because of a row from August is not.
 */
export function readSettlement(payouts: unknown, usdRate: number) {
  const parsed = SettlementRecordSchema.safeParse(payouts);
  const record = parsed.success ? parsed.data : null;

  return {
    record,
    /** This member's cut of the forfeited stakes. Excludes their own returned principal. */
    shareFor(membershipId: string): number {
      const row = record?.payouts.find((p) => p.membershipId === membershipId);
      return row ? fromUsdcAtomic(BigInt(row.shareUsdc), usdRate) : 0;
    },
    /** What this member forfeited in this period, if they did. */
    forfeitedBy(membershipId: string): number {
      const row = record?.failed.find((f) => f.membershipId === membershipId);
      return row ? fromUsdcAtomic(BigInt(row.stakeUsdc), usdRate) : 0;
    },
    /** Whether this member forfeited in this period. */
    didForfeit(membershipId: string): boolean {
      return Boolean(record?.failed.some((f) => f.membershipId === membershipId));
    },
  };
}

/**
 * One line for the settlement feed: who took what, and in which token.
 *
 * This is where the DFlow story becomes visible. `settlePact` builds one
 * order per winner, routing their share into the mint *they* chose in the
 * stake sheet -- a plain transfer cannot do that, and without this line
 * nothing on screen said it had happened; the feed only named the winners.
 * Deadpan, per the product's voice: it reports the payout, it does not
 * congratulate anyone for receiving it.
 */
export function settlementLine(s: {
  winners: { displayName: string; amountUsdc: bigint; payoutMint: string }[];
}): string {
  if (s.winners.length === 0) return "Nobody missed. Nothing moved.";

  const label = (mint: string) => PAYOUT_MINTS.find((m) => m.mint === mint)?.label ?? "USDC";

  return (
    s.winners
      .map(
        (w) =>
          `${w.displayName} took ${formatMoney(Number(w.amountUsdc) / 1e6, "USDC")} in ${label(w.payoutMint)}`,
      )
      .join(". ") + "."
  );
}

/* ---------------------------------------------------------------------------
 * The other half: deciding who kept the rule, and moving the money.
 * ------------------------------------------------------------------------- */

/** What the vault actually holds, which is not always `n × stakeUsdc`. */
async function vaultUsdcBalance(vaultAddress: string): Promise<bigint> {
  const ata = getAssociatedTokenAddressSync(
    new PublicKey(USDC_MINT),
    new PublicKey(vaultAddress),
  );
  try {
    const balance = await getConnection().getTokenAccountBalance(ata);
    return BigInt(balance.value.amount);
  } catch {
    return 0n;
  }
}

export class SettlementError extends Error {}

/**
 * Broadcast, or rehearse. See the note on `simulateOnly` in lib/solana.ts --
 * under `STAKE_DRY_RUN=1` the vault and sponsor really sign, the simulator
 * really verifies both signatures against live state, and only the broadcast
 * is skipped. Both payout paths go through here so they cannot diverge.
 */
async function send(tx: VersionedTransaction, lastValidBlockHeight: number): Promise<string> {
  if (!DRY_RUN) return submitAndConfirm(tx, lastValidBlockHeight);

  const result = await simulateOnly(tx);
  if (!result.ok) {
    throw new SettlementError(`Dry run: the network refused a payout. ${result.error ?? ""}`.trim());
  }
  return `${DRY_RUN_SIGNATURE_PREFIX}${Date.now()}`;
}

/**
 * Settles one period.
 *
 * Four things here are not obvious and all four were wrong in the first draft:
 *
 * 1. Sessions are windowed to the period before `hasFailed` sees them. Its own
 *    doc states that precondition, and an unwindowed list means every member's
 *    lifetime count exceeds the cadence -- after week two nobody ever fails
 *    again and the product silently stops working.
 *
 * 2. A winner gets their own stake back *plus* a share. Paying only the share
 *    would mean every member loses their principal every period, which is not
 *    what "whoever breaks it forfeits their stake to whoever kept it" says.
 *
 * 3. The `Settlement` row is written before any money moves, and
 *    `@@unique([pactId, periodKey])` makes it the mutex. A throw part-way
 *    through used to leave some winners paid and no record, so a re-run paid
 *    them twice. Now a re-run resumes: anything already carrying a signature
 *    is skipped.
 *
 * 4. The pot is the vault's actual balance minus the winners' principal, not
 *    `losers × stake`. A member staking a non-USDC token overpays by the
 *    slippage headroom, and that surplus belongs to the crew rather than
 *    accreting in a wallet nobody can reach.
 */
export async function settlePact(
  pactId: string,
  periodKey: string,
  now: Date = new Date(),
  options: { force?: boolean } = {},
): Promise<{ payouts: SettlementRecord["payouts"]; potUsdc: string }> {
  const pact = await prisma.pact.findUniqueOrThrow({
    where: { id: pactId },
    include: {
      settlements: true,
      memberships: {
        include: { user: true, sessions: true, exemptions: true },
      },
    },
  });

  const rule = RuleConfigSchema.parse(pact.ruleConfig);
  const inPeriod = new Set(periodDayKeys(rule, pact.timezone, now));

  /**
   * A period that is still running cannot be judged.
   *
   * Nobody has met a five-a-week cadence on a Wednesday, so settling mid-week
   * marks the entire crew failed and moves every stake to nobody -- which is
   * both wrong and unrecoverable, since the settlement row is the mutex that
   * stops it being run again properly.
   *
   * `force` exists for the demo and for tests. It is not reachable from the
   * channel: `/settle` on an unfinished week gets the sentence below.
   */
  const thisPeriod = periodDayKeys(rule, pact.timezone, now);
  const stillRunning = thisPeriod.includes(periodKey) || periodKey >= thisPeriod[0];
  if (stillRunning && !options.force) {
    const left = thisPeriod.filter((day) => day > dayKeyFor(now, pact.timezone)).length;
    throw new SettlementError(
      left > 0
        ? `The ${rule.period} is not over. ${left} ${left === 1 ? "day" : "days"} left.`
        : `The ${rule.period} is not over yet.`,
    );
  }

  const failed: typeof pact.memberships = [];
  const winners: typeof pact.memberships = [];

  for (const m of pact.memberships) {
    if (m.status === "left" || m.status === "invited") continue;

    const excused = m.exemptions.some((e) => e.periodKey === periodKey && e.status === "granted");
    // See note 1. `hasFailed` counts every day key it is handed.
    const thisPeriod = m.sessions.filter((s) => inPeriod.has(s.dayKey));
    const broke = hasFailed(thisPeriod, rule, pact.timezone);

    if (broke && !excused) failed.push(m);
    else winners.push(m);
  }

  const principal = pact.stakeUsdc;
  const balance = await vaultUsdcBalance(pact.vaultAddress);
  const winnersPrincipal = principal * BigInt(winners.length);
  // See note 4.
  const pot = balance > winnersPrincipal ? balance - winnersPrincipal : 0n;

  const shares = splitPot({
    failedStakes: pot > 0n ? [pot] : [],
    winnerIds: winners.map((w) => w.id),
  });
  const shareFor = new Map(shares.map((s) => [s.winnerId, s.amount]));

  const planned: SettlementRecord = {
    periodKey,
    stakeUsdc: principal.toString(),
    potUsdc: pot.toString(),
    failed: failed.map((m) => ({ membershipId: m.id, stakeUsdc: principal.toString() })),
    payouts: winners.map((w) => ({
      membershipId: w.id,
      // See note 2.
      principalUsdc: principal.toString(),
      shareUsdc: (shareFor.get(w.id) ?? 0n).toString(),
      payoutMint: w.payoutMint,
      signature: null,
    })),
  };

  // See note 3. The unique index refuses a second attempt at the same period,
  // so a resumed run reads the existing plan rather than inventing a new one.
  const existing = pact.settlements.find((s) => s.periodKey === periodKey);
  const record = existing
    ? SettlementRecordSchema.parse(existing.payouts)
    : ((
        await prisma.settlement.create({
          data: { pactId, periodKey, totalPotUsdc: pot, payouts: planned },
        })
      ).payouts as unknown as SettlementRecord);

  const vault = loadVault(pact.vaultSecretEnc);
  const sponsor = loadSponsor();
  const byId = new Map(pact.memberships.map((m) => [m.id, m]));

  for (const payout of record.payouts) {
    if (payout.signature) continue; // Already landed on an earlier attempt.

    const member = byId.get(payout.membershipId);
    if (!member) continue;

    const amount = BigInt(payout.principalUsdc) + BigInt(payout.shareUsdc);
    if (amount === 0n) continue;

    let signature: string | null = null;

    if (payout.payoutMint === USDC_MINT) {
      // Nothing to route: DFlow cannot swap a mint to itself.
      signature = await transferUsdc({
        vault,
        sponsor,
        to: member.user.walletAddress,
        amount,
      });
    } else {
      const order = await buildOrder({
        inputMint: USDC_MINT,
        outputMint: payout.payoutMint,
        amount,
        userPublicKey: vault.publicKey.toBase58(),
        destinationWallet: member.user.walletAddress,
        sponsor: sponsor.publicKey.toBase58(),
        sponsorExec: false,
        slippageBps: 100,
        platformFeeBps: Number(process.env.PLATFORM_FEE_BPS ?? 0) || undefined,
        feeAccount: process.env.PLATFORM_FEE_ACCOUNT || undefined,
      });

      const tx = deserializeTx(order.transaction!);
      // Both keys are here, so there is no client round trip and no race with
      // the order's sixty-second blockhash.
      signWith(tx, [vault, sponsor]);
      signature = await send(tx, order.lastValidBlockHeight!);
    }

    payout.signature = signature;
    await prisma.settlement.update({
      where: { pactId_periodKey: { pactId, periodKey } },
      data: { payouts: record },
    });
    await prisma.membership.update({
      where: { id: member.id },
      data: { status: "passed", payoutTxSig: signature },
    });
  }

  for (const m of failed) {
    await prisma.membership.update({ where: { id: m.id }, data: { status: "failed" } });
  }

  // Only the last period ends the pact. A twelve-week rule settled after one
  // week used to mark the whole thing done.
  const periodsRun = existing ? pact.settlements.length : pact.settlements.length + 1;
  if (periodsRun >= rule.durationPeriods) {
    await prisma.pact.update({ where: { id: pactId }, data: { status: "settled" } });
  }

  const names = (list: typeof pact.memberships) =>
    list.map((m) => m.user.displayName).join(", ") || "nobody";

  await prisma.feedItem.create({
    data: {
      pactId,
      type: "settlement",
      body:
        failed.length === 0
          ? "Everyone made it. Nobody paid a thing."
          : winners.length === 0
            ? `Nobody made it. Every stake stays in the vault until someone does.`
            : `${names(failed)} missed. ${settlementLine({
                winners: record.payouts.map((p) => ({
                  displayName: byId.get(p.membershipId)?.user.displayName ?? "Someone",
                  amountUsdc: BigInt(p.principalUsdc) + BigInt(p.shareUsdc),
                  payoutMint: p.payoutMint,
                })),
              })} Settled automatically.`,
    },
  });

  return { payouts: record.payouts, potUsdc: pot.toString() };
}

/** A winner taking USDC needs a transfer, not a route. */
async function transferUsdc(params: {
  vault: Keypair;
  sponsor: Keypair;
  to: string;
  amount: bigint;
}): Promise<string> {
  const mint = new PublicKey(USDC_MINT);
  const to = new PublicKey(params.to);
  const fromAta = getAssociatedTokenAddressSync(mint, params.vault.publicKey);
  const toAta = getAssociatedTokenAddressSync(mint, to);

  const { blockhash, lastValidBlockHeight } = await getConnection().getLatestBlockhash("confirmed");

  const message = new TransactionMessage({
    payerKey: params.sponsor.publicKey,
    recentBlockhash: blockhash,
    instructions: [
      createAssociatedTokenAccountIdempotentInstruction(params.sponsor.publicKey, toAta, to, mint),
      createTransferCheckedInstruction(
        fromAta,
        mint,
        toAta,
        params.vault.publicKey,
        params.amount,
        6,
      ),
    ],
  }).compileToV0Message();

  const tx = new VersionedTransaction(message);
  signWith(tx, [params.vault, params.sponsor]);
  return send(tx, lastValidBlockHeight);
}
