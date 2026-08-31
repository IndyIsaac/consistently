/* ---------------------------------------------------------------------------
 * Which of the three wallet offers the front door makes.
 *
 * The door lists wallets in its own language rather than behind Privy's modal,
 * and that list comes from the Solana wallet-standard registry -- which is an
 * announcement protocol, not a discovery one. An extension registers itself
 * with the page; nothing else does. A phone therefore reports no wallets at
 * all, however many the member has installed, because the Phantom app injects
 * nothing into mobile Safari.
 *
 * So an empty list is not "you have no wallet". It is "this browser cannot
 * introduce us", and the answer to that is Privy's own sheet: it holds the
 * WalletConnect wallet entry, and with it the deep link that hands a phone to
 * the Phantom app and takes the signature back. That entry is reachable from
 * the modal and from nowhere else, which is why the door stops talking here
 * rather than trying to finish the job itself.
 * ------------------------------------------------------------------------- */

/**
 * `unconfigured` -- no Privy app, so there is nothing behind any of it.
 * `installed`    -- the registry named wallets; the door lists them itself.
 * `handoff`      -- the registry named none; Privy's sheet takes it from here.
 */
export type WalletPath = "unconfigured" | "installed" | "handoff";

export function walletPath(wallets: readonly unknown[] | null): WalletPath {
  if (wallets === null) return "unconfigured";
  return wallets.length > 0 ? "installed" : "handoff";
}
