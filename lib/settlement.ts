import { z } from "zod";
import { fromUsdcAtomic } from "@/lib/fx";

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
