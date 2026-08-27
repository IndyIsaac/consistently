"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { toSolanaWalletConnectors } from "@privy-io/react-auth/solana";

/* ---------------------------------------------------------------------------
 * Privy, mounted once around the whole tree.
 *
 * `NEXT_PUBLIC_PRIVY_APP_ID` is inlined at build time. With nothing to call,
 * the provider is not mounted at all and the app keeps its zero-env-var path:
 * components/FrontDoor.tsx runs its own timings and every screen reads
 * lib/mock-session.ts. Mounting a provider with an empty app id would throw on
 * first render, which is the one outcome worse than not having Privy.
 *
 * TWO DOORS, ONE INTEGRATION.
 *
 * Privy is not a wallet -- it is the thing that makes one. So it is not an
 * alternative to Phantom; it is what lets the app take both.
 *
 *   - Somebody who already has Phantom connects it and signs with it. Nothing
 *     is created for them and nothing is custodied on their behalf.
 *   - Somebody who has never held a token gets an embedded wallet made during
 *     an email sign-in, and is never asked what a wallet is.
 *
 * That second case is the whole of PRODUCT.md's user: a gym group of six, none
 * of whom went looking for crypto. The first is the crew this was built for,
 * who turn out to have Phantom already. Refusing either would be a choice
 * about who gets to use it.
 *
 * `createOnLogin: "users-without-wallets"` is what keeps the two from
 * colliding: a member who arrives with Phantom is not handed a second, empty
 * wallet they did not ask for and would have to fund separately.
 * ------------------------------------------------------------------------- */

const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";

export function Providers({ children }: { children: React.ReactNode }) {
  if (!PRIVY_APP_ID) return <>{children}</>;

  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        loginMethods: ["email", "wallet"],
        externalWallets: { solana: { connectors: toSolanaWalletConnectors() } },
        embeddedWallets: { solana: { createOnLogin: "users-without-wallets" } },
        // The product has exactly two grounds and the front door is always the
        // inverse of the app. Privy's own modal cannot follow that flip, so it
        // is pinned to the door's value: near-black, which is the light-theme
        // door and reads as deliberate against the dark one.
        appearance: { theme: "dark", accentColor: "#FAFAFA" },
      }}
    >
      {children}
    </PrivyProvider>
  );
}
