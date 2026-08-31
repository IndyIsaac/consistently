import { describe, expect, it } from "vitest";
import { fundingStanding } from "@/lib/channel-view";
import { fundingReply } from "@/lib/bot";

/* ---------------------------------------------------------------------------
 * Whether the crew is still waiting on somebody's money.
 *
 * A pact starts only when every member has staked -- lib/stake.ts is explicit
 * that nobody should be exposed to a rule the rest of the crew has not paid
 * for. The channel had no idea: it carried no status at all, so a pact waiting
 * on half its members rendered exactly like one that had started, week grid
 * and check-in button and all. The member who had paid was shown a running
 * pact; the one who had not was shown no reason to hurry.
 * ------------------------------------------------------------------------- */

const member = (status: string) => ({ status }) as { status: string };

describe("what the channel says about funding", () => {
  it("counts who has paid while the pact is still funding", () => {
    expect(
      fundingStanding("funding", [member("staked"), member("invited"), member("invited")]),
    ).toEqual({ staked: 1, of: 3 });
  });

  it("says nothing once the pact is running", () => {
    expect(fundingStanding("active", [member("staked"), member("staked")])).toBeNull();
  });

  it("says nothing once it is settled", () => {
    expect(fundingStanding("settled", [member("passed"), member("failed")])).toBeNull();
  });

  it("does not count somebody who left as owing anything", () => {
    expect(fundingStanding("funding", [member("staked"), member("left")])).toEqual({
      staked: 1,
      of: 1,
    });
  });
});

/* ---------------------------------------------------------------------------
 * What /status says before the pact has started.
 *
 * It answered with the week: "0 of 1 this week. Seven days left. One to go."
 * There is no week. `startsAt` is null until everybody has staked, so the
 * period being counted down has not begun and the member is not in it.
 * ------------------------------------------------------------------------- */

describe("what the bot says while a pact is funding", () => {
  it("names who is still to pay, not a week nobody is in", () => {
    expect(fundingReply(1, 2)).toBe("1 of 2 staked. Nothing starts until everyone has.");
  });

  it("says so plainly when the money is all in but the pact has not flipped", () => {
    expect(fundingReply(2, 2)).toBe("2 of 2 staked. It starts the moment that lands.");
  });
});
