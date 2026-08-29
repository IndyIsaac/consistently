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
  const githubHandle =
    (viewer?.socials as Record<string, string> | null)?.github?.trim() || null;

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
