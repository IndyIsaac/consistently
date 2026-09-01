import Link from "next/link";
import { ChevronRight, Plus } from "lucide-react";
import { Avatar, AvatarFallback, AvatarGroup } from "@/components/ui/avatar";
import { DashedRule, Panel } from "@/components/Panel";
import { fundingLine, fundingStanding } from "@/lib/channel-view";
import { formatMoney } from "@/lib/money";
import { getSession } from "@/lib/session";
import type { PactView } from "@/lib/view";
import { ordinal, ruleSentence, spell } from "@/lib/pact-view";

export const metadata = { title: "Groups · Consistently" };

/** Name, the crew's faces, where you stand, what is at stake — in that order. */
function GroupRow({ pact }: { pact: PactView }) {
  const rank = pact.crew.findIndex((m) => m.isViewer);
  const me = pact.crew[rank];
  const funding = fundingStanding(pact.status, pact.crew);

  return (
    <li>
      <Link
        href={`/pacts/${pact.id}`}
        className="group relative block rounded-[22px] border border-hairline bg-panel p-6 shadow-panel transition-[border-color,box-shadow] duration-200 hover:border-ink/30 hover:shadow-panel-hover sm:py-5"
      >
        <ChevronRight
          className="absolute top-6 right-6 size-5 text-grey-on-ground transition-transform duration-200 group-hover:translate-x-0.5 sm:top-1/2 sm:-translate-y-1/2 sm:group-hover:translate-x-0.5"
          aria-hidden="true"
        />

        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:gap-7 sm:pr-9">
          <div className="min-w-0 pr-9 sm:flex-1 sm:pr-0">
            <h2 className="truncate text-[17px] font-bold tracking-[-0.02em] text-ink">
              {pact.name}
            </h2>
            <p className="mt-1 text-[13px] text-grey-on-ground">
              {ruleSentence(pact.ruleConfig)}
            </p>
          </div>

          <AvatarGroup className="shrink-0">
            {pact.crew.map((member) => (
              <Avatar key={member.memberId} className="size-9">
                <AvatarFallback className="bg-surface text-[12px] font-semibold tracking-[0.02em] text-grey-on-surface">
                  {member.initials}
                </AvatarFallback>
              </Avatar>
            ))}
          </AvatarGroup>

          <DashedRule className="sm:hidden" />

          <div className="flex items-end justify-between gap-6 sm:justify-end sm:gap-9">
            <div className="sm:w-[8.5rem] sm:text-right">
              {/* A member who has joined but not paid has no standing. "0 of 5"
                  would read as being behind, which is a different thing and
                  lets them believe they are in when they are not. */}
              {pact.viewerStatus === "invited" ? (
                <>
                  <p className="text-[15px] font-semibold text-ink">Not staked</p>
                  <p className="mt-0.5 text-[13px] text-grey-on-ground">
                    the crew is waiting
                  </p>
                </>
              ) : me ? (
                <>
                  <p className="figure text-[15px] font-semibold text-ink">
                    {me.daysDone}
                    <span className="font-normal text-grey-on-ground"> of {me.required}</span>
                  </p>
                  {/* "this week" is a claim, and it is false until everybody
                      has staked -- `startsAt` is null and no week has begun.
                      So is the placing: it ranks a member against people who
                      can neither win nor forfeit yet, on days nobody is being
                      judged for. */}
                  <p className="mt-0.5 text-[13px] text-grey-on-ground">
                    {funding
                      ? fundingLine(funding)
                      : `this week · ${ordinal(rank + 1)} of ${pact.crew.length}`}
                  </p>
                </>
              ) : (
                <p className="text-[13px] text-grey-on-ground">Not staked</p>
              )}
            </div>

            <div className="text-right sm:w-[6.5rem]">
              <p className="figure text-[15px] font-semibold text-ink">
                {formatMoney(pact.stakeAmount, pact.stakeCurrency)}
              </p>
              <p className="mt-0.5 text-[13px] text-grey-on-ground">a {pact.ruleConfig.period}</p>
            </div>
          </div>
        </div>
      </Link>
    </li>
  );
}

export default async function GroupsPage() {
  const { currency, pacts } = await getSession();
  const onThisWeek = pacts.reduce((sum, p) => sum + p.stakeAmount, 0);
  const owing = pacts.filter((p) => p.viewerStatus === "invited");

  return (
    <div className="mx-auto w-full max-w-[54rem] px-5 pt-10 sm:px-8 sm:pt-14">
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <h1 className="text-[clamp(2rem,7vw,3rem)] leading-[1.03] font-extrabold tracking-[-0.035em] text-ink">
            {pacts.length === 0 ? "No crews." : `${spell(pacts.length)} crews.`}
          </h1>

          <p className="mt-4 max-w-[38ch] text-[15px] leading-relaxed text-grey-on-ground">
            {pacts.length === 0
              ? "Nothing agreed, nothing at stake. A pact starts with a rule and a number."
              : owing.length > 0
                ? `${formatMoney(
                    owing.reduce((sum, p) => sum + p.stakeAmount, 0),
                    currency,
                  )} to put in before ${owing.length === 1 ? "a crew" : "two crews"} can start.`
                : `${formatMoney(onThisWeek, currency)} rides on this week.`}
          </p>
        </div>

        {/* The same pill as the channel's Invite, on the opposite side of the
            headline. A third bottom-nav tab would mean rewriting the limelight,
            which is hardcoded to two. */}
        <Link
          href="/pacts/new"
          className="inline-flex h-10 shrink-0 items-center gap-2 rounded-full border border-hairline bg-panel pr-4 pl-3.5 text-[14px] font-semibold text-ink transition-colors hover:border-ink/40"
        >
          <Plus className="size-4" aria-hidden="true" strokeWidth={2} />
          New
        </Link>
      </div>

      {pacts.length === 0 ? (
        <Panel className="mt-10">
          <p className="text-[15px] text-ink">You are not in a crew yet.</p>
          <p className="mt-2 max-w-[46ch] text-[14px] leading-relaxed text-grey-on-ground">
            Either someone sends you a code to scan, or you agree the rule and send
            the code round yourself.
          </p>
          <Link
            href="/pacts/new"
            className="mt-6 inline-flex items-center justify-center rounded-full bg-ink px-7 py-3 text-[12px] tracking-[0.24em] text-ground uppercase transition-opacity hover:opacity-85"
          >
            Start a crew
          </Link>
        </Panel>
      ) : (
        <ul className="mt-10 flex flex-col gap-4">
          {pacts.map((pact) => (
            <GroupRow key={pact.id} pact={pact} />
          ))}
        </ul>
      )}
    </div>
  );
}
