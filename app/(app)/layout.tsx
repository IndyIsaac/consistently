import { AppHeader } from "@/components/AppHeader";
import { Arrival } from "@/components/Arrival";
import { BottomNav } from "@/components/BottomNav";
import { getSession } from "@/lib/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
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
