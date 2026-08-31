import Link from "next/link";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ThemeToggle } from "@/components/ThemeToggle";

/**
 * Settings lives behind the profile, not in the bottom bar.
 *
 * The theme toggle sits here instead: a control reached for on every screen
 * has no business waiting behind a tap into Settings.
 */
export function AppHeader({
  user,
}: {
  user: { displayName: string; initials: string };
}) {
  return (
    <header className="sticky top-0 z-30 border-b border-hairline bg-ground/85 backdrop-blur-md">
      <div className="mx-auto flex h-[var(--app-header-h)] w-full max-w-[54rem] items-center justify-between px-5 sm:px-8">
        <Link
          href="/dashboard"
          className="rounded-sm text-[15px] font-extrabold tracking-[-0.045em] text-ink"
        >
          Consistently.
        </Link>

        <div className="flex items-center gap-4">
          <ThemeToggle />

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
      </div>
    </header>
  );
}
