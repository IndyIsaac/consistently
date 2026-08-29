import { describe, it, expect } from "vitest";
import {
  COMMANDS,
  checkedInLine,
  checkedOutLine,
  crewStandingLine,
  crewReply,
  earlyCheckoutRefusal,
  exemptionOpenedReply,
  helpReply,
  inviteReply,
  outOfReachVerdict,
  outlookLine,
  parseSettle,
  photoUploadRefusalLine,
  photoUploadSkippedLine,
  settleUnknownArgumentReply,
  settlingForcedLine,
  settlingLine,
  spellNumber,
  stakeReply,
  statusReply,
  unknownCommandReply,
  type BotPact,
} from "@/lib/bot";
import { cadenceOutlook, type RuleConfig } from "@/lib/rules";

const gym: RuleConfig = {
  cadence: 5,
  period: "week",
  sessionType: "checkin_checkout",
  minDurationMins: 30,
  windowStart: "05:00",
  windowEnd: "22:00",
  proof: "photo",
  failsWhenMissedExceeds: 0,
  split: "equal",
  exemption: "majority",
  durationPeriods: 12,
};

/** The whole product's voice, in one assertion: no exclamation marks, no emoji. */
function isDeadpan(s: string): boolean {
  return !s.includes("!") && !/\p{Extended_Pictographic}/u.test(s);
}

describe("spelling numbers", () => {
  it("spells the small counts that read badly as digits", () => {
    expect(spellNumber(0)).toBe("zero");
    expect(spellNumber(1)).toBe("one");
    expect(spellNumber(16)).toBe("sixteen");
    expect(spellNumber(20)).toBe("twenty");
    expect(spellNumber(45)).toBe("forty-five");
    expect(spellNumber(99)).toBe("ninety-nine");
  });

  it("gives up and hands back digits where the word is longer than the fact", () => {
    expect(spellNumber(100)).toBe("100");
    expect(spellNumber(120)).toBe("120");
    expect(spellNumber(-1)).toBe("-1");
    expect(spellNumber(2.5)).toBe("2.5");
  });
});

describe("what the bot says when a member acts", () => {
  it("states the check-in and nothing else", () => {
    expect(checkedInLine("Nat")).toBe("Nat checked in.");
  });

  it("states the check-out with its duration", () => {
    expect(checkedOutLine("Nat", 47)).toBe("Nat checked out. 47 minutes.");
  });

  it("does not say 1 minutes", () => {
    expect(checkedOutLine("Dave", 1)).toBe("Dave checked out. 1 minute.");
  });
});

describe("the early check-out refusal", () => {
  it("names the elapsed time, the rule and what is left", () => {
    expect(earlyCheckoutRefusal(14, 30)).toBe(
      "That’s 14 minutes. The pact says 30. Sixteen to go.",
    );
  });

  it("holds at the last minute before the minimum", () => {
    expect(earlyCheckoutRefusal(29, 30)).toBe("That’s 29 minutes. The pact says 30. One to go.");
  });

  it("does not say 1 minutes", () => {
    expect(earlyCheckoutRefusal(1, 30)).toBe(
      "That’s 1 minute. The pact says 30. Twenty-nine to go.",
    );
  });

  it("falls back to digits for a long rule rather than spelling a paragraph", () => {
    expect(earlyCheckoutRefusal(0, 120)).toBe("That’s 0 minutes. The pact says 120. 120 to go.");
  });

  it("never cheerleads", () => {
    expect(isDeadpan(earlyCheckoutRefusal(14, 30))).toBe(true);
  });
});

describe("the standing line", () => {
  it("is neutral and factual while the cadence is reachable", () => {
    expect(outlookLine(cadenceOutlook(3, 4, gym))).toBe("Four days left. Two to go.");
  });

  it("says so the moment it is not", () => {
    expect(outlookLine(cadenceOutlook(1, 3, gym))).toBe(
      "Three days left, four to go. That is not going to happen.",
    );
  });

  it("does not congratulate a member who is done", () => {
    const line = outlookLine(cadenceOutlook(5, 2, gym));
    expect(line).toBe("Made. Nothing else owed.");
    expect(isDeadpan(line)).toBe(true);
  });

  it("does not say 1 days", () => {
    expect(outlookLine(cadenceOutlook(4, 1, gym))).toBe("One day left. One to go.");
  });

  it("reads correctly with nothing left at all", () => {
    expect(outlookLine(cadenceOutlook(4, 0, gym))).toBe(
      "No days left, one to go. That is not going to happen.",
    );
  });
});

describe("the out-of-reach verdict", () => {
  it("names the day, the cadence, the stake and the day it settles", () => {
    expect(
      outOfReachVerdict({
        name: "Dave",
        cadence: 5,
        dayClosed: "Thursday",
        stake: "฿1,000",
        settlesOn: "Sunday",
      }),
    ).toBe("Thursday gone. Five is out of reach for Dave now. ฿1,000 settles Sunday.");
  });

  it("does not name the viewer to their face", () => {
    expect(
      outOfReachVerdict({
        name: null,
        cadence: 5,
        dayClosed: "Thursday",
        stake: "฿1,000",
        settlesOn: "Sunday",
      }),
    ).toBe("Thursday gone. Five is out of reach now. ฿1,000 settles Sunday.");
  });
});

describe("the commands", () => {
  const pact: BotPact = {
    rule: gym,
    stake: "฿1,000",
    pot: "฿4,000",
    settlesOn: "Sunday",
    viewerEarned: "฿1,333",
    viewerLost: "฿1,000",
    crew: [
      { name: "Nat", daysDone: 5, outlook: cadenceOutlook(5, 3, gym), isViewer: false },
      { name: "Indy", daysDone: 3, outlook: cadenceOutlook(3, 3, gym), isViewer: true },
      { name: "Dave", daysDone: 1, outlook: cadenceOutlook(1, 3, gym), isViewer: false },
    ],
  };

  // The count is asserted rather than derived on purpose: PRODUCT.md fixes the
  // command list, and adding one should have to be a deliberate edit here too.
  it("lists every command it answers, and counts them correctly", () => {
    const help = helpReply();
    expect(help.startsWith("Seven commands.")).toBe(true);
    for (const command of COMMANDS) expect(help).toContain(`/${command.name}`);
    expect(COMMANDS).toHaveLength(7);
  });

  // Force can take money off a member who has not broken the rule yet, so
  // /help has to say what it does rather than leave it to be found out.
  it("names force in the list and says what it costs", () => {
    const help = helpReply();
    expect(help).toContain("/settle [force]");
    expect(help).toMatch(/does not come back/);
  });

  it("corrects an unknown command dryly rather than erroring", () => {
    const reply = unknownCommandReply("gym");
    expect(reply).toBe("There is no /gym. /help lists the seven there are.");
    expect(isDeadpan(reply)).toBe(true);
  });

  it("answers /status from the viewer's own row", () => {
    expect(statusReply(pact)).toBe("3 of 5 this week. Three days left. Two to go.");
  });

  it("tells a non-member plainly rather than inventing a standing", () => {
    expect(statusReply({ ...pact, crew: [] })).toBe("You are not staked in this pact.");
  });

  it("answers /crew with one line each, in the order given", () => {
    expect(crewReply(pact).split("\n")).toEqual([
      "Nat — 5 of 5. Made. Nothing else owed.",
      "Indy — 3 of 5. Three days left. Two to go.",
      "Dave — 1 of 5. Three days left, four to go. That is not going to happen.",
    ]);
  });

  it("answers /stake with the money, the day and who is already past saving", () => {
    const reply = stakeReply(pact);
    expect(reply).toContain("฿1,000 each. Three staked, ฿4,000 in the vault.");
    expect(reply).toContain("It settles Sunday.");
    expect(reply).toContain("Dave is already past saving it.");
    expect(reply).toContain("You have taken ฿1,333 out of this pact and lost ฿1,000.");
  });

  it("leaves the past-saving line out when nobody is", () => {
    const safe: BotPact = { ...pact, crew: pact.crew.filter((m) => !m.outlook.outOfReach) };
    expect(stakeReply(safe)).not.toContain("past saving");
  });

  it("agrees with itself about how many others vote on an exemption", () => {
    expect(exemptionOpenedReply(3, 2)).toBe("Put to the crew. Three others vote, two have to say yes.");
    expect(exemptionOpenedReply(1, 1)).toBe("Put to the crew. One other votes, one has to say yes.");
  });

  it("keeps every reply deadpan", () => {
    for (const reply of [
      helpReply(),
      statusReply(pact),
      crewReply(pact),
      stakeReply(pact),
      inviteReply(),
      crewStandingLine("Dave", 1, 5, cadenceOutlook(1, 3, gym)),
      settlingForcedLine(),
      settleUnknownArgumentReply("tomorrow"),
      photoUploadRefusalLine("Photo upload is not configured."),
      photoUploadSkippedLine("Photo upload is not configured."),
    ]) {
      expect(isDeadpan(reply)).toBe(true);
    }
  });
});

/* ---------------------------------------------------------------------------
 * The one destructive command.
 *
 * Forcing a settlement judges a period that is still running, which marks
 * everyone who has not finished yet as having missed -- and the settlement row
 * is the mutex, so there is no second, proper run afterwards. The gate is this
 * parse and nothing else, so it is where the damage is either prevented or not.
 * ------------------------------------------------------------------------- */
describe("parsing /settle", () => {
  it("treats a bare /settle as the ordinary, refusable one", () => {
    expect(parseSettle("")).toEqual({ force: false });
    expect(parseSettle("   ")).toEqual({ force: false });
  });

  it("turns force on for the exact word, however it was capitalised", () => {
    expect(parseSettle("force")).toEqual({ force: true });
    expect(parseSettle("Force")).toEqual({ force: true });
    expect(parseSettle("  FORCE  ")).toEqual({ force: true });
  });

  it("refuses to read anything else as force, which is the safe way to be wrong", () => {
    // A typo, a near miss and an extra word all come back not understood. None
    // of them may fall through to an ordinary settle either, or a member who
    // meant to force would be told the week is not over and try harder.
    for (const argument of ["froce", "forced", "force now", "yes", "-f", "force everyone"]) {
      expect(parseSettle(argument)).toBeNull();
    }
  });

  it("says what was not understood, and what the two forms are", () => {
    expect(settleUnknownArgumentReply("tomorrow")).toBe(
      "There is no /settle tomorrow. /settle closes the period. /settle force closes one that is not over yet.",
    );
  });

  it("states plainly what forcing does before it does it", () => {
    const line = settlingForcedLine();
    expect(line).toMatch(/does not come back/);
    expect(line).not.toBe(settlingLine());
  });
});

describe("a check-in whose photo never reached storage", () => {
  it("refuses the check-in outright when the pact is one that wants a photo", () => {
    expect(photoUploadRefusalLine("Photo upload is not configured.")).toBe(
      "Photo upload is not configured. A check-in without a photo is not a check-in, so nothing was recorded.",
    );
  });

  it("keeps the check-in when the pact takes the member's word for it", () => {
    expect(photoUploadSkippedLine("Photo upload is not configured.")).toBe(
      "Photo upload is not configured. This pact takes your word for it, so it stands without one.",
    );
  });
});
