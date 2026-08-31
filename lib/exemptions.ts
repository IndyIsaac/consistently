import type { MemberStatus } from "@prisma/client";

/* ---------------------------------------------------------------------------
 * Who gets a say in an exemption, and whether they have said it yet.
 *
 * Pure arithmetic over the crew and the votes cast, extracted so the vote path
 * (POST /api/pacts/[id]/exemptions) and the read path (the pact screen's
 * "two of three") cannot drift apart. A screen that says "one more yes" while
 * the route needs two is worse than either number alone.
 * ------------------------------------------------------------------------- */

/**
 * A member has a say once they have money in -- and keeps it after a period
 * settles, because `passed` and `failed` are still members of the crew.
 * `invited` has not staked and `left` is gone.
 *
 * One canonical list drives who may request, who may vote, and the denominator.
 * Keeping them separate is how a numerator and a denominator start describing
 * different populations.
 */
export const ELIGIBLE_STATUSES = ["staked", "passed", "failed"] as const satisfies MemberStatus[];

export const ELIGIBLE_STATUS_SET: ReadonlySet<MemberStatus> = new Set(ELIGIBLE_STATUSES);

export type ExemptionTally = {
  /** Eligible members other than the requester. */
  eligible: number;
  /** A simple majority of `eligible`. */
  needed: number;
  approvals: number;
  rejections: number;
  status: "pending" | "granted" | "denied";
};

export function tallyExemption(params: {
  /** The asker's `Membership.id`. Nobody votes on their own. */
  requesterMembershipId: string;
  memberships: { id: string; userId: string; status: MemberStatus }[];
  votes: { userId: string; approve: boolean }[];
}): ExemptionTally {
  const electorate = params.memberships.filter(
    (m) => ELIGIBLE_STATUS_SET.has(m.status) && m.id !== params.requesterMembershipId,
  );
  const eligible = electorate.length;
  const needed = Math.floor(eligible / 2) + 1;

  // A vote from someone no longer in the electorate is dropped rather than
  // counted, so the numerator and the denominator describe one population read
  // at one moment.
  const voters = new Set(electorate.map((m) => m.userId));
  const counted = params.votes.filter((v) => voters.has(v.userId));
  const approvals = counted.filter((v) => v.approve).length;
  const rejections = counted.length - approvals;

  let status: ExemptionTally["status"] = "pending";
  if (eligible > 0 && approvals >= needed) status = "granted";
  else if (eligible > 0 && rejections >= needed) status = "denied";

  return { eligible, needed, approvals, rejections, status };
}
