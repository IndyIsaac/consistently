import { describe, it, expect } from "vitest";
import {
  blocksSettlement,
  canAppeal,
  checkInStands,
  tallyChallenge,
} from "@/lib/challenge-photo";
import type { MemberStatus } from "@prisma/client";

/* The crew the cases below are read against: four who have money in, one who
   never staked, and one who walked. Only the first four have a say. */
const CREW: { id: string; userId: string; status: MemberStatus }[] = [
  { id: "m_dave", userId: "u_dave", status: "staked" },
  { id: "m_nat", userId: "u_nat", status: "staked" },
  { id: "m_indy", userId: "u_indy", status: "passed" },
  { id: "m_pim", userId: "u_pim", status: "failed" },
  { id: "m_new", userId: "u_new", status: "invited" },
  { id: "m_gone", userId: "u_gone", status: "left" },
];

const accused = "m_dave";

describe("tallyChallenge", () => {
  it("counts only staked members, and never the accused", () => {
    const t = tallyChallenge({ accusedMembershipId: accused, memberships: CREW, votes: [] });
    // Nat, Indy and Pim. Not Dave (accused), not the invited, not the departed.
    expect(t.eligible).toBe(3);
    expect(t.needed).toBe(2);
    expect(t.untouched).toBe(true);
    expect(t.stage).toBe("open");
  });

  it("stays open until a majority lands", () => {
    const t = tallyChallenge({
      accusedMembershipId: accused,
      memberships: CREW,
      votes: [{ userId: "u_nat", against: true }],
    });
    expect(t.against).toBe(1);
    expect(t.stage).toBe("open");
  });

  it("upholds once a majority says the photo does not count", () => {
    const t = tallyChallenge({
      accusedMembershipId: accused,
      memberships: CREW,
      votes: [
        { userId: "u_nat", against: true },
        { userId: "u_indy", against: true },
      ],
    });
    expect(t.stage).toBe("upheld");
  });

  it("dismisses once a majority says it stands", () => {
    const t = tallyChallenge({
      accusedMembershipId: accused,
      memberships: CREW,
      votes: [
        { userId: "u_nat", against: false },
        { userId: "u_indy", against: false },
      ],
    });
    expect(t.stage).toBe("dismissed");
  });

  it("leaves the photo standing on a tie", () => {
    // Four eligible, three needed: two each is not a majority either way, and
    // the burden is on the crew to agree somebody lied.
    const four = [...CREW, { id: "m_kit", userId: "u_kit", status: "staked" as MemberStatus }];
    const t = tallyChallenge({
      accusedMembershipId: accused,
      memberships: four,
      votes: [
        { userId: "u_nat", against: true },
        { userId: "u_indy", against: true },
        { userId: "u_pim", against: false },
        { userId: "u_kit", against: false },
      ],
    });
    expect(t.eligible).toBe(4);
    expect(t.needed).toBe(3);
    expect(t.stage).toBe("open");
  });

  it("drops a vote from somebody no longer in the electorate", () => {
    // The departed member's vote must not count towards a denominator they are
    // not in — the same rule lib/exemptions.ts holds.
    const t = tallyChallenge({
      accusedMembershipId: accused,
      memberships: CREW,
      votes: [
        { userId: "u_gone", against: true },
        { userId: "u_new", against: true },
      ],
    });
    expect(t.against).toBe(0);
    expect(t.untouched).toBe(true);
    expect(t.stage).toBe("open");
  });

  it("does not count the accused's own vote", () => {
    const t = tallyChallenge({
      accusedMembershipId: accused,
      memberships: CREW,
      votes: [{ userId: "u_dave", against: false }],
    });
    expect(t.forPhoto).toBe(0);
    expect(t.stage).toBe("open");
  });

  it("never resolves a crew of one", () => {
    // The accused alone: nobody is eligible, so nothing can carry. Without the
    // `eligible > 0` guard, `needed` is 1 and zero votes would read as upheld.
    const t = tallyChallenge({
      accusedMembershipId: accused,
      memberships: [CREW[0]],
      votes: [],
    });
    expect(t.eligible).toBe(0);
    expect(t.stage).toBe("open");
  });
});

describe("what a stage permits", () => {
  it("allows an appeal only against an upheld challenge", () => {
    expect(canAppeal("upheld")).toBe(true);
    for (const s of ["open", "dismissed", "appealed", "under_review", "overturned", "final"] as const) {
      expect(canAppeal(s)).toBe(false);
    }
  });

  it("freezes settlement while a human has it, and only then", () => {
    expect(blocksSettlement("appealed")).toBe(true);
    expect(blocksSettlement("under_review")).toBe(true);
    for (const s of ["open", "upheld", "dismissed", "overturned", "final"] as const) {
      expect(blocksSettlement(s)).toBe(false);
    }
  });

  it("voids the check-in only where the verdict went against it", () => {
    expect(checkInStands("upheld")).toBe(false);
    expect(checkInStands("final")).toBe(false);
    // An open challenge has decided nothing, so the check-in still counts.
    expect(checkInStands("open")).toBe(true);
    expect(checkInStands("appealed")).toBe(true);
    expect(checkInStands("overturned")).toBe(true);
  });
});
