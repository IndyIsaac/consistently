import { describe, expect, it } from "vitest";
import { fundingStanding } from "@/lib/channel-view";

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
