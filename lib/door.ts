/* ---------------------------------------------------------------------------
 * Which of the four wallet offers the front door makes.
 *
 * The door lists wallets in its own language rather than behind Privy's modal,
 * and that list comes from the Solana wallet-standard registry -- which is an
 * announcement protocol, not a discovery one. An extension registers itself
 * with the page; nothing else does. A phone therefore reports no wallets at
 * all, however many the member has installed, because the Phantom app injects
 * nothing into mobile Safari.
 *
 * An empty list is not "you have no wallet", and what to do about it depends
 * entirely on the device.
 *
 * On a desktop the member is one install away, and Privy's sheet is the right
 * thing: it names the wallets, links the extension, and can put a QR up for a
 * phone to scan.
 *
 * On a phone that same sheet leads somewhere that does not work. Privy hands
 * off to WalletConnect, whose pairing needs the page to stay alive while the
 * member is in another app approving -- and iOS suspends a backgrounded tab,
 * taking the relay socket with it. The approval is given and there is nothing
 * left listening for it, which is why the wallet gives up and opens its own
 * browser instead, stranding the tab that started it.
 *
 * So a phone is sent to the wallet's browser deliberately rather than ending
 * up there by accident. Inside it the registry is populated, the ordinary list
 * below applies, and the whole exchange happens in one place with no socket to
 * survive being backgrounded.
 * ------------------------------------------------------------------------- */

/**
 * `unconfigured` -- no Privy app, so there is nothing behind any of it.
 * `installed`    -- the registry named wallets; the door lists them itself.
 * `handoff`      -- nothing on a desktop; Privy's sheet can still help.
 * `wallet-app`   -- nothing on a phone; the wallet's own browser is the way in.
 */
export type WalletPath = "unconfigured" | "installed" | "handoff" | "wallet-app";

export function walletPath(
  wallets: readonly unknown[] | null,
  { mobile }: { mobile: boolean },
): WalletPath {
  if (wallets === null) return "unconfigured";
  if (wallets.length > 0) return "installed";
  return mobile ? "wallet-app" : "handoff";
}

/**
 * Open this page inside Phantom's browser.
 *
 * `ref` is the origin Phantom shows as the site asking, and is what its back
 * control returns to.
 *
 * The invite has to be put back by hand. proxy.ts takes `?invite=` off the
 * URL on the way in and stashes it in an httpOnly cookie, which is the right
 * thing for a cookie and useless here: Phantom's browser has its own jar, so
 * nothing carried in this jump except the address itself survives. A member
 * who scanned a QR would arrive signed in, with no crew, and no way to tell
 * what went wrong. The token is read on the server -- app/page.tsx -- and
 * threaded down for exactly this line.
 */
export function phantomBrowseLink(url: string, invite?: string | null): string {
  const target = new URL(url);
  if (invite) target.searchParams.set("invite", invite);

  return (
    `https://phantom.app/ul/browse/${encodeURIComponent(target.toString())}` +
    `?ref=${encodeURIComponent(target.origin)}`
  );
}

/* ---------------------------------------------------------------------------
 * The bounce mark: "this tab already tried crossing and came straight back".
 *
 * proxy.ts decides who is signed in by whether the session cookie is present.
 * The door checks the same cookie before navigating, so the two normally agree
 * -- and when they do not, pushing anyway produces a loop that costs the member
 * their browser rather than their place in it. The mark is what stops the
 * second attempt.
 *
 * It has to survive the navigation to be worth anything, which is why it lives
 * in sessionStorage rather than a module variable: a hard navigation reloads
 * the document and takes module state with it. That is also what made it
 * dangerous. It is written immediately before the navigation, including the
 * navigation that WORKS, and there is no code that runs afterwards to take it
 * back -- a successful navigation is the end of that document.
 *
 * So it expires. A real loop returns within about one redirect; anything older
 * is a different visit and must not be treated as evidence about this one.
 * Without the expiry a member who signed in normally carried the mark for the
 * life of the tab, and the next time they reached the door -- an hour later,
 * cookie expired, sent back by the proxy -- they were told they were signed in
 * and the server could not see it, forever, because the check ran before
 * anything that could have cleared it. Only a new tab escaped.
 *
 * Storage and clock are parameters so this is testable without a browser, and
 * because every access is one a private-mode window can throw on.
 * ------------------------------------------------------------------------- */

export const BOUNCE_KEY = "consistently:bounced-once";

/** Long enough for a redirect to come back, far short of a session. */
export const BOUNCE_TTL_MS = 30_000;

/** Just the part of `Storage` this needs, so a test can pass a Map. */
export type MarkStore = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export function clearBounced(store: MarkStore): void {
  try {
    store.removeItem(BOUNCE_KEY);
  } catch {
    // Nothing was stored, so there is nothing to forget.
  }
}

/**
 * True only for a mark made recently enough to describe what is happening now.
 * A stale one is deleted rather than merely ignored, so a long-lived tab does
 * not carry a dead mark around.
 */
export function hasBounced(store: MarkStore, now: number = Date.now()): boolean {
  try {
    const at = Number(store.getItem(BOUNCE_KEY));
    if (!Number.isFinite(at) || at <= 0) return false;
    if (now - at > BOUNCE_TTL_MS) {
      clearBounced(store);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Records the attempt, and reports whether the record took.
 *
 * A browser that will not hold this will not hold the session cookie either,
 * and an attempt nobody can remember making is the first step of the loop --
 * so the caller is expected to stop rather than navigate anyway.
 */
export function markBounced(store: MarkStore, now: number = Date.now()): boolean {
  try {
    const stamp = String(now);
    store.setItem(BOUNCE_KEY, stamp);
    return store.getItem(BOUNCE_KEY) === stamp;
  } catch {
    return false;
  }
}
