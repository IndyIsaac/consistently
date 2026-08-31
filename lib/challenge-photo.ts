import type { MemberStatus } from "@prisma/client";
import { ELIGIBLE_STATUS_SET } from "@/lib/exemptions";

/* ---------------------------------------------------------------------------
 * Challenging a photo, and appealing the result.
 *
 * PRODUCT.md: "Proof is looked at by the group, not by software" and "the group
 * is the referee, not the software". Until now the group could look at a photo
 * and had no way to say anything about it — a check-in counted the moment it
 * was taken, and the only vote in the product excused an absence rather than
 * questioning an attendance. This is the other half: `/challenge <member>` puts
 * one photo to the crew.
 *
 * It deliberately does NOT verify anything. No image comparison, no model, no
 * heuristic — PRODUCT.md's first deliberate exclusion is "no automated proof
 * verification", and this does not reverse it. A person accuses, people vote,
 * and the software only counts.
 *
 * The arithmetic is a near-twin of lib/exemptions.ts and is kept separate on
 * purpose: an exemption asks the crew for a favour and a challenge accuses
 * somebody of lying. They read the same and they are not the same, so a change
 * to one must not silently move the other.
 * ------------------------------------------------------------------------- */

export type ChallengeCategory = "checkin" | "checkout";

export type ChallengeStage =
  /** Votes are still being cast. */
  | "open"
  /** The crew decided the photo does not count. The check-in is void. */
  | "upheld"
  /** The crew decided the photo stands. Nothing changes. */
  | "dismissed"
  /** Upheld, and the accused has asked a human to look at it. */
  | "appealed"
  /** A human took the appeal and has not answered yet. */
  | "under_review"
  /** A human overturned the crew. The check-in is restored. */
  | "overturned"
  /** A human agreed with the crew. This is the end of the road. */
  | "final";

export type ChallengeTally = {
  /** Members with a say: everyone staked except the accused. */
  eligible: number;
  /** A simple majority of `eligible`. */
  needed: number;
  /** Votes that the photo does not count. */
  against: number;
  /** Votes that the photo stands. */
  forPhoto: number;
  /** Nobody has voted yet and the row is still open. */
  untouched: boolean;
  stage: Extract<ChallengeStage, "open" | "upheld" | "dismissed">;
};

/**
 * Who gets a say, and what the votes add up to.
 *
 * The accused does not vote on themselves — the same rule the exemption path
 * uses, and for the same reason. The challenger does: raising the challenge is
 * not itself a ballot, because a challenger who looks again and changes their
 * mind should be able to say so, and a challenge that could never be withdrawn
 * would make the accusation the verdict.
 *
 * A tie is not a majority, so a tie leaves the photo standing. That asymmetry
 * is deliberate: the burden is on the crew to agree somebody lied, and the
 * default when they cannot is that the member is believed.
 */
export function tallyChallenge(params: {
  /** The accused member's `Membership.id`. Nobody votes on their own photo. */
  accusedMembershipId: string;
  memberships: { id: string; userId: string; status: MemberStatus }[];
  /** `against: true` means "this photo does not count". */
  votes: { userId: string; against: boolean }[];
}): ChallengeTally {
  const electorate = params.memberships.filter(
    (m) => ELIGIBLE_STATUS_SET.has(m.status) && m.id !== params.accusedMembershipId,
  );
  const eligible = electorate.length;
  const needed = Math.floor(eligible / 2) + 1;

  // A vote from somebody who has since left is dropped rather than counted, so
  // the numerator and the denominator describe one population at one moment.
  const voters = new Set(electorate.map((m) => m.userId));
  const counted = params.votes.filter((v) => voters.has(v.userId));
  const against = counted.filter((v) => v.against).length;
  const forPhoto = counted.length - against;

  let stage: ChallengeTally["stage"] = "open";
  if (eligible > 0 && against >= needed) stage = "upheld";
  else if (eligible > 0 && forPhoto >= needed) stage = "dismissed";

  return { eligible, needed, against, forPhoto, untouched: counted.length === 0, stage };
}

/**
 * Whether the accused may still ask a human to look at it.
 *
 * Only an upheld challenge can be appealed: a member whose photo stood has
 * nothing to appeal, and a member who has already had a human answer has had
 * the one review there is. One appeal per challenge, and the door shuts after.
 */
export function canAppeal(stage: ChallengeStage): boolean {
  return stage === "upheld";
}

/**
 * Whether money is allowed to move while this is outstanding.
 *
 * An upheld challenge voids a check-in, and a voided check-in can be the day
 * that decides a forfeit. Settling on top of an unanswered appeal would take
 * somebody's stake on the strength of a verdict they are still contesting, and
 * that money does not come back — settlement is a broadcast, not a draft.
 *
 * So an appeal freezes the period it belongs to. This is the one place in the
 * product where a human is deliberately in the money path, and it is the reason
 * the appeal exists at all.
 */
export function blocksSettlement(stage: ChallengeStage): boolean {
  return stage === "appealed" || stage === "under_review";
}

/** Whether the check-in under the challenge currently counts towards cadence. */
export function checkInStands(stage: ChallengeStage): boolean {
  return stage !== "upheld" && stage !== "final";
}

// --- the bot's lines --------------------------------------------------------

/** The feed row written the moment a challenge is raised. */
export function challengeOpenedLine(challenger: string, accused: string): string {
  return `${challenger} challenged ${accused}'s photo. The crew decides.`;
}

/** What the bot says when the command names nobody. */
export function challengeNeedsMemberReply(crew: string[]): string {
  return crew.length === 0
    ? "Name whose photo you are challenging. /challenge <member>."
    : `Name whose photo you are challenging. ${crew.join(", ")}.`;
}

/** What the bot says when the named member is not in the crew. */
export function challengeUnknownMemberReply(typed: string, crew: string[]): string {
  return `There is no ${typed} in this crew. ${crew.join(", ")}.`;
}

/** Challenging your own photo is not a thing. */
export function challengeSelfReply(): string {
  return "You cannot challenge your own photo. Delete it and take another.";
}

/** Only one challenge per photo, and it is already up. */
export function challengeAlreadyOpenReply(accused: string): string {
  return `${accused}'s photo is already being challenged. Vote on the one that is open.`;
}

/** The verdict, stated flatly. No adjective either way. */
export function challengeVerdictLine(params: {
  accused: string;
  upheld: boolean;
  against: number;
  eligible: number;
}): string {
  return params.upheld
    ? `${params.against} of ${params.eligible} say it does not count. ${params.accused}'s check-in is void.`
    : `The crew did not agree. ${params.accused}'s check-in stands.`;
}

/** Written when the accused sends it to a human. */
export function appealFiledLine(accused: string): string {
  return `${accused} appealed. The period is frozen until somebody reviews it.`;
}

/** The human's answer, either way. */
export function appealResolvedLine(params: { accused: string; overturned: boolean }): string {
  return params.overturned
    ? `Review done. ${params.accused}'s check-in is restored and the period is running again.`
    : `Review done. The crew was right. ${params.accused}'s check-in stays void.`;
}
