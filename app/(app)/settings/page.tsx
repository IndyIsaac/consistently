import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { AppearanceSetting } from "@/components/AppearanceSetting";
import { DashedRule, FieldLabel, Panel } from "@/components/Panel";
import { getSession } from "@/lib/session";

export const metadata = { title: "Settings · Consistently" };

/** PLACEHOLDER. Profile name, profile photo and linked socials are a later task. */
export default async function SettingsPage() {
  const { user } = await getSession();
  const wallet = `${user.walletAddress.slice(0, 4)}…${user.walletAddress.slice(-4)}`;

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
          <FieldLabel>Profile photo, linked socials</FieldLabel>
          <p className="mt-2 text-[14px] text-grey-on-ground">Not built yet.</p>
        </div>
      </Panel>

      <Panel className="mt-4 max-w-[32rem]">
        <AppearanceSetting />
      </Panel>

      <Panel className="mt-4 max-w-[32rem] border-dashed">
        <FieldLabel>This session</FieldLabel>
        <p className="mt-2 max-w-[44ch] text-[14px] leading-relaxed text-grey-on-ground">
          No Privy app id is set, so nobody is really signed in. Every screen is reading{" "}
          <span className="font-mono text-[13px] text-ink">lib/mock-session.ts</span>. Delete
          that file to delete the mock.
        </p>
      </Panel>
    </div>
  );
}
