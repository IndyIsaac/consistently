import { describe, it, expect } from "vitest";
import { tallyExemption } from "@/lib/exemptions";
import type { MemberStatus } from "@prisma/client";

/**
 * The crew of a four-person pact. `dave` is the one asking to be let off, so
 * the other three decide it and two of them are a majority.
 */
const CREW = [
  { id: "m_indy", userId: "u_indy", status: "staked" as MemberStatus },
  { id: "m_nat", userId: "u_nat", status: "staked" as MemberStatus },
  { id: "m_pim", userId: "u_pim", status: "staked" as MemberStatus },
  { id: "m_dave", userId: "u_dave", status: "staked" as MemberStatus },
];

const asking = { requesterMembershipId: "m_dave", memberships: CREW };

describe("tallyExemption", () => {
  it("excludes the requester from the denominator", () => {
    const t = tallyExemption({ ...asking, votes: [] });
    expect(t.eligible).toBe(3);
    expect(t.needed).toBe(2);
  });

  it("stays pending short of a majority", () => {
    const t = tallyExemption({ ...asking, votes: [{ userId: "u_nat", approve: true }] });
    expect(t.approvals).toBe(1);
    expect(t.status).toBe("pending");
  });

  it("grants on a majority", () => {
    const t = tallyExemption({
      ...asking,
      votes: [
        { userId: "u_nat", approve: true },
        { userId: "u_pim", approve: true },
      ],
    });
    expect(t.status).toBe("granted");
  });

  it("denies when the majority refuses", () => {
    const t = tallyExemption({
      ...asking,
      votes: [
        { userId: "u_nat", approve: false },
        { userId: "u_pim", approve: false },
      ],
    });
    expect(t.rejections).toBe(2);
    expect(t.status).toBe("denied");
  });

  it("ignores a vote from someone who has since left", () => {
    // A member who left keeps their Vote row. Counting it would give them a
    // say in an outcome they are no longer part of the denominator for.
    const left = CREW.map((m) => (m.userId === "u_nat" ? { ...m, status: "left" as MemberStatus } : m));
    const t = tallyExemption({
      requesterMembershipId: "m_dave",
      memberships: left,
      votes: [{ userId: "u_nat", approve: true }],
    });
    expect(t.eligible).toBe(2);
    expect(t.approvals).toBe(0);
    expect(t.status).toBe("pending");
  });

  it("ignores an invited member who has not staked", () => {
    const invited = [...CREW, { id: "m_kwan", userId: "u_kwan", status: "invited" as MemberStatus }];
    expect(tallyExemption({ ...asking, memberships: invited, votes: [] }).eligible).toBe(3);
  });

  it("counts a settled member, who is still in the crew", () => {
    const settled = CREW.map((m) =>
      m.userId === "u_nat" ? { ...m, status: "passed" as MemberStatus } : m,
    );
    expect(tallyExemption({ ...asking, memberships: settled, votes: [] }).eligible).toBe(3);
  });

  it("needs the only other member's yes in a pair", () => {
    const pair = [
      { id: "m_indy", userId: "u_indy", status: "staked" as MemberStatus },
      { id: "m_kwan", userId: "u_kwan", status: "staked" as MemberStatus },
    ];
    const t = tallyExemption({
      requesterMembershipId: "m_kwan",
      memberships: pair,
      votes: [],
    });
    expect(t.eligible).toBe(1);
    expect(t.needed).toBe(1);
  });

  it("is unresolvable when the requester is the only member left", () => {
    const alone = [{ id: "m_indy", userId: "u_indy", status: "staked" as MemberStatus }];
    const t = tallyExemption({
      requesterMembershipId: "m_indy",
      memberships: alone,
      votes: [],
    });
    // Nobody can vote, so `needed` of 1 can never be reached. Pending is the
    // honest answer: the screen shows "0 of 1" rather than granting by default.
    expect(t.eligible).toBe(0);
    expect(t.status).toBe("pending");
  });
});
