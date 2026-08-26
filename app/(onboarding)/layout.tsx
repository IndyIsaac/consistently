/**
 * Onboarding has its own shell: no header, no bottom nav.
 *
 * Everything those two navigate to is behind the gate this screen is holding.
 * Rendering them here would offer a room whose door has not opened yet, and a
 * nav bar over a hard block is a lie about where you are.
 *
 * It is interior, not the front door -- `ground`, `ink`, and the app's
 * grotesque. Only app/page.tsx takes the inverse value and the mono.
 */
export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-dvh flex-col bg-ground text-ink">{children}</div>;
}
