import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Avatar, AvatarFallback, AvatarGroup } from "@/components/ui/avatar";
import { DashedRule, Panel } from "@/components/Panel";
import { formatMoney } from "@/lib/money";
// MOCK: swap for the real memberships query. See lib/mock-session.ts.
import { getSession, type MockPact } from "@/lib/mock-session";
import { ordinal, ruleSentence, spell } from "@/lib/pact-view";

export const metadata = { title: "Groups · Consistently" };

/** Name, the crew's faces, where you stand, what is at stake — in that order. */
function GroupRow({ pact }: { pact: MockPact }) {
  const rank = pact.crew.findIndex((m) => m.isViewer);
  const me = pact.crew[rank];

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
              {me ? (
                <>
                  <p className="figure text-[15px] font-semibold text-ink">
                    {me.daysDone}
                    <span className="font-normal text-grey-on-ground"> of {me.required}</span>
                  </p>
                  <p className="mt-0.5 text-[13px] text-grey-on-ground">
                    this week · {ordinal(rank + 1)} of {pact.crew.length}
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

  return (
    <div className="mx-auto w-full max-w-[54rem] px-5 pt-10 sm:px-8 sm:pt-14">
      <h1 className="text-[clamp(2rem,7vw,3rem)] leading-[1.03] font-extrabold tracking-[-0.035em] text-ink">
        {pacts.length === 0 ? "No crews." : `${spell(pacts.length)} crews.`}
      </h1>

      <p className="mt-4 max-w-[38ch] text-[15px] leading-relaxed text-grey-on-ground">
        {pacts.length === 0
          ? "Nothing agreed, nothing at stake. A pact starts with a rule and a number."
          : `${formatMoney(onThisWeek, currency)} rides on this week.`}
      </p>

      {pacts.length === 0 ? (
        <Panel className="mt-10">
          <p className="text-[15px] text-ink">You are not in a crew yet.</p>
          <p className="mt-2 text-[14px] text-grey-on-ground">
            Someone sends you a link, you agree the rule, you stake. That is the whole of it.
          </p>
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
