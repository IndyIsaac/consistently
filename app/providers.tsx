"use client";

import { PrivyProvider } from "@privy-io/react-auth";

/* ---------------------------------------------------------------------------
 * Privy, mounted once around the whole tree.
 *
 * `NEXT_PUBLIC_PRIVY_APP_ID` is inlined at build time. With nothing to call,
 * the provider is not mounted at all and the app keeps its zero-env-var path:
 * components/FrontDoor.tsx runs its own timings and every screen reads
 * lib/mock-session.ts. Mounting a provider with an empty app id would throw on
 * first render, which is the one outcome worse than not having Privy.
 *
 * `createOnLogin: "all-users"` rather than "users-without-wallets": there are
 * no external wallets in this product, and the gate in app/(app)/layout.tsx
 * depends on every signed-in user definitively having an address. A user who
 * declined wallet creation once and could never be asked again would be stuck
 * outside the app with no way back in.
 * ------------------------------------------------------------------------- */

const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";

export function Providers({ children }: { children: React.ReactNode }) {
  if (!PRIVY_APP_ID) return <>{children}</>;

  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        loginMethods: ["email"],
        embeddedWallets: { solana: { createOnLogin: "all-users" } },
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
