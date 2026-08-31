"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import { useCreateWallet, useWallets } from "@privy-io/react-auth/solana";
import { Check, Copy, TriangleAlert } from "lucide-react";
import { CodePlate } from "@/components/CodePlate";
import { DashedRule, FieldLabel, Panel } from "@/components/Panel";

/* ---------------------------------------------------------------------------
 * The threshold.
 *
 * Two jobs, in this order. Say what the thing is -- the landing page is one
 * line on purpose, so this is the first place anyone is told. Then hold the
 * door until the wallet can actually pay a stake.
 *
 * The wallet itself is not a step. One is made below for anybody who does not
 * already have one, without ever asking them to, and this screen is the first
 * time the user hears it exists; the ask is money, not setup, which is the
 * only version of a wallet gate that is honest about what it wants. PRODUCT.md
 * principle 5 says "no setup errand before the thing works", and a funding
 * gate is an errand -- the trade is deliberate: an unfunded member reaches a
 * stake button that cannot work, and finding that out here is better than
 * finding it out in front of their crew.
 * ------------------------------------------------------------------------- */

type InvitePreview = { name: string; rule: string | null; stake: string } | null;

/** Four seconds while somebody is actively sending, ten once they clearly are not. */
const FAST_POLL_MS = 4_000;
const SLOW_POLL_MS = 10_000;
const BACK_OFF_AFTER_MS = 60_000;

export function Onboarding({ invite }: { invite: InvitePreview }) {
  const router = useRouter();
  const { ready, authenticated, user, getAccessToken } = usePrivy();
  const { ready: walletsReady, wallets } = useWallets();
  const { createWallet } = useCreateWallet();

  const [address, setAddress] = useState<string | null>(null);
  const [funded, setFunded] = useState(false);
  /**
   * Whether the wallet has been looked at yet.
   *
   * Asking somebody to fund an account that already holds something is the
   * rudest thing this screen can do, and it used to do it every time: the
   * plate rendered the moment an address existed, and the balance came back a
   * poll later. So nothing is offered until the answer is in -- funded members
   * are gone by then, and the ones who see the QR are the ones who need it.
   */
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // The server says whether this deployment is rehearsing; no second env var.
  const [rehearsal, setRehearsal] = useState(false);

  const bootstrapped = useRef(false);
  const creatingWallet = useRef(false);
  // Stamped on the first poll rather than at render: reading the clock during
  // render is impure, and the back-off wants the moment polling began anyway.
  const startedAt = useRef(0);

  /**
   * Nothing is on record yet, so there is no address to match against. Prefer
   * the wallet Privy considers the user's primary -- for somebody who signed
   * in *with* Phantom that is Phantom, and handing them an embedded wallet's
   * address instead would ask them to fund an account they will never use.
   */
  const primary = user?.wallet?.address;
  const wallet = wallets.find((w) => w.address === primary) ?? wallets[0] ?? null;

  /**
   * Whether Privy already holds a wallet for this member -- which is a
   * different question from what is connected in this browser, and the
   * difference is the whole of the condition below.
   *
   * `wallets` is the connected list, and it answers the wrong question twice
   * over. A member who signed in with Phantom but has not reconnected the
   * extension in this tab appears there as nothing; a member who signed in with
   * an email address on a machine that happens to have Phantom installed
   * appears there as Phantom. Reading "the list is empty" as "make one" would
   * hand the first of those a second, empty wallet -- and `createWallet` does
   * not politely decline that, it throws, which would turn a sign-in that works
   * today into a screen that does not.
   *
   * `linkedAccounts` is Privy's own record of what is attached to this user:
   * Phantom for anyone who signed in with it, the embedded wallet for anyone
   * who has already been through this screen once. Nothing of type `wallet` in
   * it means nothing anywhere, which is the only member who should be handed
   * one -- the same rule `createOnLogin: "users-without-wallets"` applies in
   * app/providers.tsx, asked here because Privy never asks it for us.
   */
  const hasWallet =
    user?.linkedAccounts.some((a) => a.type === "wallet" && a.chainType === "solana") ?? false;

  /** Every call carries the bearer as well as the cookie -- see lib/auth.ts. */
  const authed = useCallback(
    async (path: string, init?: RequestInit) => {
      const token = await getAccessToken();
      return fetch(path, {
        ...init,
        headers: {
          ...(init?.headers ?? {}),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(init?.body ? { "content-type": "application/json" } : {}),
        },
      });
    },
    [getAccessToken],
  );

  // Nobody signed in has any business here. The proxy only checks that a
  // cookie exists; this is the client noticing it does not mean anything.
  useEffect(() => {
    if (ready && !authenticated) router.replace("/");
  }, [ready, authenticated, router]);

  /**
   * The wallet the email door never made.
   *
   * `createOnLogin: "users-without-wallets"` in app/providers.tsx only fires
   * for a login that goes through Privy's own modal -- Privy's dashboard says
   * so in as many words. components/FrontDoor.tsx runs the whitelabel
   * `useLoginWithEmail` flow instead, on the app's own surface, so nothing was
   * ever created and the effect below sat waiting on a wallet that was not
   * coming. Every member who arrived by email watched "Making one." forever.
   * Phantom is what hid it: a member who brings their own wallet was never
   * waiting on this in the first place, and that is who this was tested with.
   *
   * The ordering against /api/me is structural, not a promise chain. Creating
   * the wallet updates the Privy user, `useWallets()` reports the new account
   * on the render after that, and the effect below -- which returns early
   * while `wallet` is null -- runs then and not before. There is no window in
   * which the server could be told an address that does not exist yet.
   */
  useEffect(() => {
    if (!authenticated || !walletsReady || hasWallet || creatingWallet.current) return;
    // Latched before the await, like `bootstrapped` below: a re-render landing
    // mid-flight must not start a second wallet.
    creatingWallet.current = true;

    createWallet().catch(() => {
      // The latch stays shut. Privy throws when the user already has an
      // embedded wallet, so asking again for one it has just refused to make
      // is a loop rather than a recovery. A reload is the retry, and remounting
      // this component is what performs it -- which is what the copy says.
      setError("Could not make you a wallet. Reload the page and it will try again.");
    });
  }, [authenticated, walletsReady, hasWallet, createWallet]);

  /**
   * Pair the verified sign-in with the wallet Privy just made. The server
   * cannot learn the address from the token, so it is asserted once here and
   * written on create only -- see app/api/me/route.ts.
   */
  useEffect(() => {
    if (!authenticated || !walletsReady || !wallet || bootstrapped.current) return;
    bootstrapped.current = true;

    (async () => {
      /**
       * A name to be called by, from whatever they signed in with.
       *
       * Email gives a local part. A wallet gives nothing -- Phantom knows no
       * name -- so it takes the shortened address, which is at least theirs
       * and is what every other Solana product would show them. "Member" was
       * the old fallback and it is worse than either: a crew of four where
       * one is called Member reads as a bug, and Settings lets them change it
       * to something they picked.
       */
      const email = user?.email?.address ?? "";
      const address = wallet.address;
      const displayName = email
        ? email.split("@")[0].slice(0, 40)
        : `${address.slice(0, 4)}…${address.slice(-4)}`;

      const res = await authed("/api/me", {
        method: "POST",
        body: JSON.stringify({ walletAddress: wallet.address, displayName }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        /**
         * `bootstrapped` is latched before this runs and is never lowered, so
         * a reload is the only retry there is -- exactly as it is for the
         * wallet above, which says so. This did not, and a member sat on a
         * sentence with nothing to do about it. The server's own message is
         * kept when it sent one, since it names the actual problem.
         */
        setError(
          body.error
            ? `${body.error} Reload the page to try again.`
            : "Could not finish setting up this account. Reload the page and it will try again.",
        );
        return;
      }
      const me = await res.json();
      setAddress(me.walletAddress);
      if (me.funded) setFunded(true);
    })().catch(() =>
      setError("Could not finish setting up this account. Reload the page and it will try again."),
    );
  }, [authenticated, walletsReady, wallet, user, authed]);

  /**
   * Poll while the door is shut. This is the only place in the app that asks an
   * RPC for a balance: the first time it comes back with anything, the server
   * stamps the user row and nothing asks again.
   */
  useEffect(() => {
    if (!address || funded) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    if (startedAt.current === 0) startedAt.current = Date.now();

    async function look() {
      try {
        const res = await authed("/api/wallet/balance");
        if (cancelled) return;
        if (res.ok) {
          const body = await res.json();
          if (body.rehearsal) setRehearsal(true);
          if (body.funded) {
            setFunded(true);
            return;
          }
          // Looked at, and empty. This is the only place that can say so.
          setChecked(true);
        }
        // A 503 is the RPC being unreachable, not an empty wallet. Either way
        // the answer is to look again.
      } catch {
        // Same.
      }
      if (cancelled) return;
      const elapsed = Date.now() - startedAt.current;
      timer = setTimeout(look, elapsed > BACK_OFF_AFTER_MS ? SLOW_POLL_MS : FAST_POLL_MS);
    }

    void look();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [address, funded, authed]);

  // Through. An invite waiting means the pact is where they were going all
  // along; /join redeems it and lands them in the channel.
  useEffect(() => {
    if (funded) router.replace(invite ? "/join" : "/dashboard");
  }, [funded, invite, router]);

  async function copy() {
    if (!address) return;
    await navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2_000);
  }

  return (
    <main className="mx-auto flex w-full max-w-[34rem] flex-1 flex-col justify-center px-5 py-14 sm:px-8">
      <h1 className="text-[clamp(1.9rem,7vw,2.75rem)] leading-[1.05] font-extrabold tracking-[-0.035em] text-ink">
        {invite ? invite.name : "How this works."}
      </h1>

      {invite ? (
        <p className="mt-4 max-w-[38ch] text-[15px] leading-relaxed text-grey-on-ground">
          You have been asked to join. {invite.rule ? `${invite.rule}. ` : ""}
          {invite.stake} each, and it only moves if someone misses.
        </p>
      ) : (
        <ol className="mt-7 flex flex-col gap-4">
          {[
            "A crew agrees one rule, and the number that rides on it.",
            "Everyone puts the same money up before it starts.",
            "Whoever misses forfeits it to whoever did not. Nobody has to ask.",
          ].map((line, i) => (
            <li key={i} className="flex gap-4">
              <span className="figure w-4 shrink-0 pt-[3px] text-[13px] text-grey-on-ground">
                {i + 1}
              </span>
              <span className="text-[15px] leading-relaxed text-ink">{line}</span>
            </li>
          ))}
        </ol>
      )}

      <Panel className="mt-9">
        <FieldLabel>Your wallet</FieldLabel>

        {error ? (
          <p
            role="alert"
            className="mt-4 flex items-start gap-2 text-[14px] leading-relaxed text-ink"
          >
            <TriangleAlert className="mt-px size-4 shrink-0" aria-hidden="true" />
            {error}
          </p>
        ) : !hasWallet ? (
          <p className="mt-4 text-[15px] text-grey-on-ground">Making you a wallet.</p>
        ) : !address || !checked ? (
          /* A member who signed in with Phantom is not having a wallet made
             for them, and telling them so was simply untrue. What is actually
             happening is that their wallet is being looked at. */
          <p className="mt-4 text-[15px] text-grey-on-ground">Checking your wallet.</p>
        ) : (
          <>
            <p className="mt-3 text-[15px] leading-relaxed text-ink">
              Send it anything on Solana and the door opens.
            </p>

            <div className="mt-6 flex flex-col items-center">
              <CodePlate value={address} size={196} title="Your wallet address" />

              <p className="figure mt-5 w-full text-center text-[13px] leading-relaxed break-all text-grey-on-ground select-all">
                {address}
              </p>

              <button
                type="button"
                onClick={copy}
                className="mt-4 inline-flex items-center gap-2 rounded-full border border-hairline px-5 py-2.5 text-[13px] text-ink transition-colors hover:bg-surface"
              >
                {copied ? (
                  <Check className="size-3.5" aria-hidden="true" />
                ) : (
                  <Copy className="size-3.5" aria-hidden="true" />
                )}
                {copied ? "Copied" : "Copy address"}
              </button>
            </div>

            <DashedRule className="mt-7" />

            <p className="mt-5 text-[14px] leading-relaxed text-grey-on-ground">
              {/* Deadpan, and true: the poll is running, and there is nothing
                  for them to press. Saying so is better than a spinner. */}
              Watching for it. Any token will do, and you will not need SOL for
              fees — that part is covered.
            </p>

            {/* Only under STAKE_DRY_RUN, and it says so. The screen still
                appears because it is a demo beat worth seeing; what changes is
                that a rehearsal is not stopped by a wall asking for money. */}
            {rehearsal && (
              <button
                type="button"
                onClick={async () => {
                  const res = await authed("/api/wallet/balance?rehearse=1");
                  const body = await res.json().catch(() => ({}));
                  // `res.ok` is not the question. The route answers 200 for an
                  // unfunded wallet too, so trusting the status let the screen
                  // navigate on a "no" -- and the gate, reading the database,
                  // sent them straight back here. Ask what it actually said.
                  if (body.funded) setFunded(true);
                  else setError(body.error ?? "Could not skip the gate. Is STAKE_DRY_RUN set?");
                }}
                className="mt-4 w-full rounded-full border border-hairline py-3 text-[12px] tracking-[0.24em] text-grey-on-ground uppercase transition-colors hover:border-ink/40 hover:text-ink"
              >
                Skip — rehearsing
              </button>
            )}
          </>
        )}
      </Panel>
    </main>
  );
}
