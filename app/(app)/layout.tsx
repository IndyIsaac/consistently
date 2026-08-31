import { AppHeader } from "@/components/AppHeader";
import { Arrival } from "@/components/Arrival";
import { BottomNav } from "@/components/BottomNav";
import { redirect } from "next/navigation";
import { gate, getSession } from "@/lib/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // The hard block. The proxy has already turned away anyone with no token at
  // all; what is left for this file is the two it cannot see -- a token that
  // does not verify, and a wallet that has never held anything.
  const entry = await gate();
  // /leave, not `/`: the proxy lets anyone holding a cookie back through, and
  // gate() reaching "signed-out" means this one does not verify. Sending them
  // to the door with it still set is the redirect loop. See app/leave/route.ts.
  if (entry === "signed-out") redirect("/leave");
  if (entry === "needs-onboarding") redirect("/welcome");

  const { user } = await getSession();

  return (
    <div className="flex min-h-dvh flex-col bg-ground">
      <AppHeader user={user} />
      {/* The nav floats over the last 108px of every page. */}
      <Arrival className="flex-1 pb-[7rem]">{children}</Arrival>
      <BottomNav />
    </div>
  );
}
