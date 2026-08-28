"use client";

import { useRouter } from "next/navigation";
import { useLogout, usePrivy } from "@privy-io/react-auth";
import { LogOut } from "lucide-react";

/* ---------------------------------------------------------------------------
 * The way out.
 *
 * Absent until now, which is a strange thing for a product to be missing and a
 * blocking one for anybody rehearsing: two members means two sign-ins, and
 * without this the only way to become somebody else is to clear site data by
 * hand.
 *
 * Privy's session is the thing being ended. The cookie the proxy checks goes
 * with it, so the next navigation is turned away at the door.
 * ------------------------------------------------------------------------- */

export function SignOut() {
  const router = useRouter();
  const { authenticated } = usePrivy();
  const { logout } = useLogout({
    onSuccess: () => {
      // `replace`, not push: the interior should not be one back-press away
      // from somebody who has just left it.
      router.replace("/");
      router.refresh();
    },
  });

  if (!authenticated) return null;

  return (
    <button
      type="button"
      onClick={() => void logout()}
      className="inline-flex items-center gap-2 rounded-full border border-hairline px-5 py-2.5 text-[13px] text-ink transition-colors hover:border-ink/40 hover:bg-surface"
    >
      <LogOut className="size-3.5" aria-hidden="true" strokeWidth={1.75} />
      Sign out
    </button>
  );
}
