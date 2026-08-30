"use client";

import { useState } from "react";
import { useLinkAccount, usePrivy } from "@privy-io/react-auth";
import { DashedRule, FieldLabel } from "@/components/Panel";

/* ---------------------------------------------------------------------------
 * The wallet is the account. This is the second way back to it.
 *
 * Split in two, for the same reason components/FrontDoor.tsx is: a hook cannot
 * be called conditionally, and `useLinkAccount` throws outright when no
 * `PrivyProvider` is mounted above it. app/providers.tsx deliberately does not
 * mount one without an app id -- that is what keeps the zero-env-var path
 * running on lib/mock-session.ts -- so on that path this panel used to take the
 * whole of /settings to a 500 rather than degrading.
 *
 * `usePrivy` does not do this; it answers with an unauthenticated shape, which
 * is why components/ProfileForm.tsx needs no such split and this one does.
 * ------------------------------------------------------------------------- */

const PRIVY_CONFIGURED = (process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "").length > 0;

/**
 * The panel itself, which knows nothing about Privy. `onLink` is absent on the
 * demo path, and the row says so rather than offering a button that cannot do
 * anything.
 */
function Panel({
  walletAddress,
  linked,
  error,
  onLink,
}: {
  walletAddress: string;
  linked: string | null;
  error: string | null;
  onLink?: () => void;
}) {
  const short = `${walletAddress.slice(0, 4)}…${walletAddress.slice(-4)}`;

  return (
    <>
      <FieldLabel>Linked accounts</FieldLabel>

      <div className="mt-4 flex items-center justify-between gap-6">
        <span className="text-[15px] text-ink">Wallet</span>
        <span className="figure text-[13px] text-grey-on-ground">{short}</span>
      </div>

      <DashedRule className="mt-4" />

      <div className="mt-4 flex items-center justify-between gap-6">
        <span className="text-[15px] text-ink">Email</span>
        {linked ? (
          <span className="text-[13px] text-grey-on-ground">{linked}</span>
        ) : onLink ? (
          <button
            type="button"
            onClick={onLink}
            className="rounded-full border border-hairline px-4 py-2 text-[13px] text-ink transition-colors hover:bg-surface"
          >
            Link one
          </button>
        ) : (
          <span className="text-[13px] text-grey-on-ground">Not in the demo.</span>
        )}
      </div>

      <p className="mt-2 text-[13px] text-grey-on-ground">
        Lose the wallet and this is how you get back in. Nothing is sent to it.
      </p>

      {error && <p role="alert" className="mt-3 text-[13px] text-ink">{error}</p>}
    </>
  );
}

/** The half that talks to Privy, mounted only where a provider exists. */
function PrivyLinkedAccounts({ walletAddress, email }: { walletAddress: string; email: string | null }) {
  const { getAccessToken } = usePrivy();
  const [linked, setLinked] = useState(email);
  const [error, setError] = useState<string | null>(null);

  const { linkEmail } = useLinkAccount({
    onSuccess: async ({ linkedAccount }) => {
      if (linkedAccount.type !== "email") return;
      const token = await getAccessToken();
      const res = await fetch("/api/me", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ email: linkedAccount.address }),
      });
      if (res.ok) {
        // Same as ProfileForm: a save that goes on to succeed retires
        // whatever error the last attempt left on screen.
        setError(null);
        setLinked(linkedAccount.address);
      } else {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Could not link that email.");
      }
    },
    // PrivyErrorCode is declared by @privy-io/react-auth's types but not
    // actually exported by the package it ships -- `npm run build` catches
    // that a plain import does not -- so the codes are matched as the bare
    // strings Privy's own type file documents them as.
    onError: (code: string) => {
      // Closing Privy's modal is not a failure -- there is nothing to report
      // and nothing on screen to clear.
      if (code === "exited_link_flow") return;
      // Privy already knows this address belongs to a different Privy user,
      // which is the same collision app/api/me/route.ts guards on our side --
      // it just catches it before the request ever reaches our server.
      setError(
        code === "linked_to_another_user"
          ? "That email is already linked to another account."
          : "Could not link that email.",
      );
    },
  });

  return <Panel walletAddress={walletAddress} linked={linked} error={error} onLink={linkEmail} />;
}

export function LinkedAccounts({ walletAddress, email }: { walletAddress: string; email: string | null }) {
  return PRIVY_CONFIGURED ? (
    <PrivyLinkedAccounts walletAddress={walletAddress} email={email} />
  ) : (
    <Panel walletAddress={walletAddress} linked={email} error={null} />
  );
}
