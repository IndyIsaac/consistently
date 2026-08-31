import { describe, expect, it } from "vitest";
import { walletPath } from "@/lib/door";

/* ---------------------------------------------------------------------------
 * What the door offers beneath the email field.
 *
 * The door builds its wallet list from the Solana wallet-standard registry,
 * which is populated by browser extensions announcing themselves. A phone has
 * no extensions: the Phantom app injects nothing into mobile Safari, so the
 * registry is empty and the list is empty with it. The door used to end there,
 * on a sentence, with Phantom installed and unreachable on the same device.
 * ------------------------------------------------------------------------- */

describe("what the door offers under the email field", () => {
  it("offers the wallets this browser actually announced", () => {
    expect(walletPath([{ name: "Phantom" }])).toBe("installed");
  });

  it("hands off to Privy when the registry is empty", () => {
    // The phone. Privy's own sheet owns the WalletConnect wallet entry, and
    // with it the deep link that opens Phantom -- neither of which the
    // hand-rolled list can reach.
    expect(walletPath([])).toBe("handoff");
  });

  it("says there is nothing to hand off to when Privy is absent", () => {
    expect(walletPath(null)).toBe("unconfigured");
  });
});
