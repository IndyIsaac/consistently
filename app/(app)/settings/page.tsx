import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { LinkedAccounts } from "@/components/LinkedAccounts";
import { DashedRule, FieldLabel, Panel } from "@/components/Panel";
import { ProfileForm } from "@/components/ProfileForm";
import { GithubActivity } from "@/components/ui/retro-space-shooter-git-hub-calendar";
import { WalletPanel } from "@/components/WalletPanel";
import { currentUser } from "@/lib/auth";
import { readHoldings } from "@/lib/holdings";
import { LIVE } from "@/lib/session";
import { getSession } from "@/lib/session";

export const metadata = { title: "Settings · Consistently" };

// `socials` is a Prisma `Json?` column -- a cast to `Record<string, string>`
// would be a lie the type checker can't catch. This page is an async Server
// Component, so a bad value here (a raw DB edit, a future write path that
// isn't `app/api/me/route.ts`'s zod schema) would throw on `.trim()` and take
// down the whole page, not just this panel. A runtime check turns that into
// the panel simply not rendering.
function readGithubHandle(socials: unknown): string | null {
  if (!socials || typeof socials !== "object" || Array.isArray(socials)) return null;
  const value = (socials as Record<string, unknown>).github;
  if (typeof value !== "string") return null;
  /**
   * Forgiving on purpose. The field is a text box next to a GitHub logo, so
   * people type `@torvalds` and paste `github.com/torvalds`; the contributions
   * API takes a bare username and the URL encodes whatever it is given, so an
   * `@` arrives as `%40` and the graph just fails. Strip the two things anyone
   * actually types instead of asking them to know the difference.
   */
  return (
    value
      .trim()
      .replace(/^https?:\/\//i, "")
      .replace(/^(www\.)?github\.com\//i, "")
      .replace(/^@/, "")
      .replace(/\/+$/, "")
      .trim() || null
  );
}

export default async function SettingsPage() {
  const { user, pacts, currency } = await getSession();
  // One RPC call, on a page that was already awaiting the database.
  const holdings = LIVE ? await readHoldings(user.walletAddress) : null;
  const wallet = `${user.walletAddress.slice(0, 4)}…${user.walletAddress.slice(-4)}`;

  // AppSession's `user` carries only what every screen needs (id, wallet,
  // name, initials) -- bio, avatarUrl and socials are read straight off the
  // row here instead, the same way holdings above is a second call the mock
  // branch never has to make.
  const viewer = LIVE ? await currentUser() : null;

  // Gates the calendar below: no handle, no panel -- not an empty box, not
  // an error. A whitespace-only value counts as none.
  const githubHandle = readGithubHandle(viewer?.socials);

  return (
    <div className="mx-auto w-full max-w-[54rem] px-5 pt-8 sm:px-8 sm:pt-10">
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-1.5 rounded-sm text-[13px] text-grey-on-ground transition-colors hover:text-ink"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Dashboard
      </Link>

      <h1 className="mt-6 text-[clamp(1.75rem,6vw,2.5rem)] leading-[1.05] font-extrabold tracking-[-0.035em] text-ink">
        Settings.
      </h1>

      <Panel className="mt-8 max-w-[32rem]">
        <div className="flex items-center gap-4">
          <Avatar className="size-14">
            <AvatarFallback className="bg-surface text-[15px] font-semibold tracking-[0.02em] text-grey-on-surface">
              {user.initials}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate text-[17px] font-bold tracking-[-0.02em] text-ink">
              {user.displayName}
            </p>
            <p className="figure mt-0.5 text-[13px] text-grey-on-ground">{wallet}</p>
          </div>
        </div>

        <DashedRule className="mt-6" />

        <div className="mt-6">
          <ProfileForm
            initial={{
              displayName: user.displayName,
              bio: viewer?.bio ?? null,
              avatarUrl: viewer?.avatarUrl ?? null,
              socials: (viewer?.socials as unknown as Record<string, string> | null) ?? null,
            }}
          />
        </div>
      </Panel>

      {githubHandle && (
        <Panel className="mt-4 max-w-[32rem]">
          <GithubActivity username={githubHandle} />
        </Panel>
      )}

      <Panel className="mt-4 max-w-[32rem]">
        <LinkedAccounts walletAddress={user.walletAddress} email={viewer?.email ?? null} />
      </Panel>

      <Panel className="mt-4 max-w-[32rem]">
        {LIVE ? (
          <WalletPanel
            address={user.walletAddress}
            currency={currency}
            holdings={holdings}
            allocations={pacts.map((p) => ({
              pactId: p.id,
              name: p.name,
              stakeAmount: p.stakeAmount,
              stakeCurrency: p.stakeCurrency,
              status: p.viewerStatus,
            }))}
          />
        ) : (
          <>
            <FieldLabel>This session</FieldLabel>
            <p className="mt-2 max-w-[44ch] text-[14px] leading-relaxed text-grey-on-ground">
              No Privy app id is set, so nobody is really signed in. Every screen is reading{" "}
              <span className="font-mono text-[13px] text-ink">lib/mock-session.ts</span>. Delete
              that file to delete the mock.
            </p>
          </>
        )}
      </Panel>
    </div>
  );
}
