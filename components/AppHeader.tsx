import Link from "next/link";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

/** Settings lives behind the profile, not in the bottom bar. */
export function AppHeader({
  user,
}: {
  user: { displayName: string; initials: string };
}) {
  return (
    <header className="sticky top-0 z-30 border-b border-hairline bg-ground/85 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-[54rem] items-center justify-between px-5 py-3.5 sm:px-8">
        <Link
          href="/dashboard"
          className="rounded-sm text-[15px] font-extrabold tracking-[-0.045em] text-ink"
        >
          Consistently.
        </Link>

        <Link
          href="/settings"
          aria-label={`${user.displayName} — profile and settings`}
          className="rounded-full"
        >
          <Avatar className="size-9 transition-opacity hover:opacity-75">
            <AvatarFallback className="bg-surface text-[12px] font-semibold tracking-[0.02em] text-grey-on-surface">
              {user.initials}
            </AvatarFallback>
          </Avatar>
        </Link>
      </div>
    </header>
  );
}
