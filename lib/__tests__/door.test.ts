import { describe, expect, it } from "vitest";
import {
  BOUNCE_KEY,
  BOUNCE_TTL_MS,
  type MarkStore,
  clearBounced,
  hasBounced,
  markBounced,
 phantomBrowseLink, walletPath,
} from "@/lib/door";

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

  /**
   * The commonest way anybody arrives is a scanned QR, and the token is not in
   * the URL by the time this runs. proxy.ts stashes it in an httpOnly cookie
   * and redirects to a clean address -- and Phantom's browser is a different
   * cookie jar, so a jump that carried only the address would land somebody in
   * the app signed in, with no crew, and nothing on screen to say why.
   */
  it("re-attaches a stashed invite the URL no longer carries", () => {
    const link = phantomBrowseLink("https://x.example/", "tok_abc");
    const target = decodeURIComponent(link.split("/ul/browse/")[1].split("?ref=")[0]);
    expect(target).toBe("https://x.example/?invite=tok_abc");
  });

  it("leaves the address alone when no invite is waiting", () => {
    const link = phantomBrowseLink("https://x.example/", null);
    const target = decodeURIComponent(link.split("/ul/browse/")[1].split("?ref=")[0]);
    expect(target).toBe("https://x.example/");
  });
});

/* ---------------------------------------------------------------------------
 * The bounce mark.
 *
 * This guard has now caused the same reported bug twice -- "it says I am signed
 * in and tells me to reload" -- so it is pinned here rather than trusted.
 * ------------------------------------------------------------------------- */

function store(): MarkStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

/** A private-mode window, where every access throws. */
const sealed: MarkStore = {
  getItem() {
    throw new Error("denied");
  },
  setItem() {
    throw new Error("denied");
  },
  removeItem() {
    throw new Error("denied");
  },
};

describe("the bounce mark", () => {
  it("is not set to begin with", () => {
    expect(hasBounced(store())).toBe(false);
  });

  it("counts an attempt made a moment ago", () => {
    const s = store();
    expect(markBounced(s, 1_000)).toBe(true);
    expect(hasBounced(s, 1_400)).toBe(true);
  });

  it("stops counting one made before this visit", () => {
    // The reported bug. The mark is written on the path that works, so a member
    // who signed in normally kept it; an hour later, sent back to the door by
    // an expired cookie, they were told to reload and reloading changed nothing.
    const s = store();
    markBounced(s, 1_000);
    expect(hasBounced(s, 1_000 + BOUNCE_TTL_MS + 1)).toBe(false);
  });

  it("throws the stale mark away rather than re-reading it forever", () => {
    const s = store();
    markBounced(s, 1_000);
    hasBounced(s, 1_000 + BOUNCE_TTL_MS + 1);
    expect(s.map.has(BOUNCE_KEY)).toBe(false);
  });

  it("forgets an attempt once there is a session to see", () => {
    const s = store();
    markBounced(s, 1_000);
    clearBounced(s);
    expect(hasBounced(s, 1_100)).toBe(false);
  });

  it("reports that a browser refusing storage did not record the attempt", () => {
    // The caller must not navigate on this. A browser that will not hold the
    // mark will not hold the session cookie either, and it would come straight
    // back to try again.
    expect(markBounced(sealed)).toBe(false);
  });

  it("treats a browser refusing storage as never having bounced", () => {
    expect(hasBounced(sealed)).toBe(false);
    expect(() => clearBounced(sealed)).not.toThrow();
  });

  it("ignores a mark that is not a time", () => {
    const s = store();
    s.map.set(BOUNCE_KEY, "1");
    expect(hasBounced(s)).toBe(false);
  });
});
