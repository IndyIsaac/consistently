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
 * control returns to. The whole URL is carried through encoded, query and all,
 * so a scanned invite survives the jump -- losing `?invite=` here would land
 * somebody in the app with no crew and no way to tell what went wrong.
 */
export function phantomBrowseLink(url: string): string {
  const { origin } = new URL(url);
  return `https://phantom.app/ul/browse/${encodeURIComponent(url)}?ref=${encodeURIComponent(origin)}`;
}
