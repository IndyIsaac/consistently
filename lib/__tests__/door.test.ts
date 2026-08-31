import { describe, expect, it } from "vitest";
import { phantomBrowseLink, walletPath } from "@/lib/door";

/* ---------------------------------------------------------------------------
 * What the door offers beneath the email field.
 *
 * The door builds its wallet list from the Solana wallet-standard registry,
 * which is populated by browser extensions announcing themselves. A phone has
 * no extensions: the Phantom app injects nothing into mobile Safari, so the
 * registry is empty and the list is empty with it.
 *
 * The two empty cases are not the same problem. On a desktop the member is one
 * install away and Privy's sheet says so. On a phone there is nothing to
 * install -- the wallet is already there, in another app -- and the only
 * reliable way into it is its own browser, where it does inject.
 * ------------------------------------------------------------------------- */

describe("what the door offers under the email field", () => {
  it("offers the wallets this browser actually announced", () => {
    expect(walletPath([{ name: "Phantom" }], { mobile: false })).toBe("installed");
  });

  it("still offers them on a phone, inside a wallet's own browser", () => {
    // Phantom's in-app browser does inject, so the registry is populated and
    // the ordinary list is right even though this is a phone.
    expect(walletPath([{ name: "Phantom" }], { mobile: true })).toBe("installed");
  });

  it("hands a desktop to Privy, which can offer an install or a QR", () => {
    expect(walletPath([], { mobile: false })).toBe("handoff");
  });

  it("sends a phone to the wallet app rather than Privy's sheet", () => {
    // WalletConnect's pairing dies here: approving means leaving Safari, iOS
    // suspends the tab, and the relay socket that was to carry the answer back
    // is gone before it returns. The wallet's own browser needs no socket.
    expect(walletPath([], { mobile: true })).toBe("wallet-app");
  });

  it("says there is nothing to hand off to when Privy is absent", () => {
    expect(walletPath(null, { mobile: true })).toBe("unconfigured");
  });
});

describe("the link into Phantom's browser", () => {
  it("carries the page it should open, encoded", () => {
    const link = phantomBrowseLink("https://consistently.example/?invite=tok_abc");
    expect(link).toBe(
      "https://phantom.app/ul/browse/" +
        encodeURIComponent("https://consistently.example/?invite=tok_abc") +
        "?ref=" +
        encodeURIComponent("https://consistently.example"),
    );
  });

  it("keeps a scanned invite attached across the jump", () => {
    // The commonest way anybody arrives is a scanned QR, and losing the token
    // on the way into Phantom would land them in the app with no crew.
    expect(phantomBrowseLink("https://x.example/?invite=tok_abc")).toContain(
      encodeURIComponent("invite=tok_abc"),
    );
  });
});
