import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Avatar, AvatarFallback, AvatarGroup } from "@/components/ui/avatar";
import { DashedRule, FieldLabel, Panel } from "@/components/Panel";
import { Skeleton } from "@/components/Skeleton";
import { formatMoney } from "@/lib/money";
// MOCK: swap for GET /api/pacts/[id]/view. See lib/mock-session.ts.
import { getPact } from "@/lib/mock-session";
import { ruleSentence } from "@/lib/pact-view";

/**
 * PLACEHOLDER. The group screen — the bot channel, the slash-command input, the
 * camera and the QR invite — is a later task. This stands in so the Groups tab
 * has somewhere honest to land, and says plainly what is missing.
 */
export default async function PactPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pact = await getPact(id);
  if (!pact) notFound();

  return (
    <div className="mx-auto w-full max-w-[54rem] px-5 pt-8 sm:px-8 sm:pt-10">
      <Link
        href="/groups"
        className="inline-flex items-center gap-1.5 rounded-sm text-[13px] text-grey-on-ground transition-colors hover:text-ink"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Groups
      </Link>

      <h1 className="mt-6 text-[clamp(1.75rem,6vw,2.5rem)] leading-[1.05] font-extrabold tracking-[-0.035em] text-ink">
        {pact.name}
      </h1>
      <p className="mt-3 text-[15px] text-grey-on-ground">{ruleSentence(pact.ruleConfig)}</p>

      <div className="mt-7 flex items-center gap-4">
        <AvatarGroup>
          {pact.crew.map((member) => (
            <Avatar key={member.memberId} className="size-9">
              <AvatarFallback className="bg-surface text-[12px] font-semibold tracking-[0.02em] text-grey-on-surface">
                {member.initials}
              </AvatarFallback>
            </Avatar>
          ))}
        </AvatarGroup>
        <span className="figure text-[13px] text-grey-on-ground">
          {formatMoney(pact.stakeAmount, pact.stakeCurrency)} each, a {pact.ruleConfig.period}
        </span>
      </div>

      <Panel className="mt-9">
        <FieldLabel>The channel</FieldLabel>
        <p className="mt-3 max-w-[46ch] text-[15px] leading-relaxed text-ink">
          The bot&rsquo;s running commentary, the camera, the QR to hand round and the
          settlement notice all land here.
        </p>
        <p className="mt-2 text-[14px] text-grey-on-ground">Not built yet.</p>

        <DashedRule className="mt-6" />

        {/* The shape of what lands here: bot rows, timestamped, with photos. */}
        <div className="mt-6 flex flex-col gap-5" aria-hidden="true">
          {[
            ["55%", "34%"],
            ["42%", "61%"],
            ["63%", "28%"],
          ].map(([a, b], i) => (
            <div key={i} className="flex items-start gap-3">
              <Skeleton className="size-9 shrink-0 rounded-full" />
              <span className="flex min-w-0 flex-1 flex-col gap-2 pt-1">
                <Skeleton className="h-3 rounded-full" style={{ width: a }} />
                <Skeleton className="h-3 rounded-full" style={{ width: b }} />
              </span>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
