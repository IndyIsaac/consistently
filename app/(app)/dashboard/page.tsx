import { CrewTable, type CrewRowData } from "@/components/CrewTable";
import { FieldLabel, Panel } from "@/components/Panel";
import { PactCard } from "@/components/PactCard";
import { formatMoney } from "@/lib/money";
import { getSession } from "@/lib/session";
import type { PactView } from "@/lib/view";
import { isTodayDone, spell, standingLine, weekDayMarks } from "@/lib/pact-view";
import { cn } from "@/lib/utils";

export const metadata = { title: "Dashboard · Consistently" };

function crewRows(pact: PactView, now: Date): CrewRowData[] {
  return pact.crew.map((member, i) => {
    const marks = weekDayMarks(member.sessions, pact.ruleConfig, pact.timezone, now);

    return {
      id: member.memberId,
      rank: i + 1,
      name: member.isViewer ? "You" : member.displayName,
      initials: member.initials,
      // The forfeit is the sharper fact, so it wins the one grey line it gets.
      subline:
        member.forfeitedToDate > 0 ? (
          <>
            Lost{" "}
            <span className="font-semibold text-owed">
              {formatMoney(member.forfeitedToDate, pact.stakeCurrency)}
            </span>
            . {spell(member.forfeitedPeriods)}{" "}
            {member.forfeitedPeriods === 1 ? "week" : "weeks"}.
          </>
        ) : (
          standingLine(member.daysDone, member.required, isTodayDone(marks))
        ),
      figure: (
        <>
          {member.daysDone}
          {/* The viewer's row is inset in `surface`, which #737373 does not clear
              4.5:1 against. Same role, the value that ground needs. */}
          <span
            className={cn(
              "font-normal",
              member.isViewer ? "text-grey-on-surface" : "text-grey-on-ground",
            )}
          >
            {" "}
            of {member.required}
          </span>
        </>
      ),
      isViewer: member.isViewer,
    };
  });
}

export default async function DashboardPage() {
  const { now, currency, pacts } = await getSession();

  const earned = pacts.reduce((sum, p) => sum + p.viewerEarned, 0);
  const lost = pacts.reduce((sum, p) => sum + p.viewerLost, 0);
  const net = earned - lost;
  const onThisWeek = pacts.reduce((sum, p) => sum + p.stakeAmount, 0);
  const settled = Math.max(...pacts.map((p) => p.settledPeriods));

  return (
    <div className="mx-auto w-full max-w-[54rem] px-5 pt-10 sm:px-8 sm:pt-14">
      <h1 className="text-[clamp(2rem,7vw,3rem)] leading-[1.03] font-extrabold tracking-[-0.035em] text-balance text-ink">
        {net === 0 ? (
          "You are square."
        ) : (
          <>
            You are{" "}
            <span className={cn("figure", net > 0 ? "text-earned" : "text-owed")}>
              {formatMoney(net, currency)}
            </span>{" "}
            {net > 0 ? "up" : "down"}.
          </>
        )}
      </h1>

      <p className="mt-4 max-w-[38ch] text-[15px] leading-relaxed text-grey-on-ground">
        {spell(settled)} weeks settled across {spell(pacts.length).toLowerCase()} crews.{" "}
        {formatMoney(onThisWeek, currency)} rides on this one.
      </p>

      <div className="mt-9 grid grid-cols-2 border-y border-hairline">
        <div className="py-5 pr-5">
          <FieldLabel>Earned</FieldLabel>
          <p className="figure mt-2 text-[clamp(1.75rem,6vw,2.25rem)] leading-none font-extrabold text-earned">
            {formatMoney(earned, currency)}
          </p>
        </div>
        <div className="border-l border-hairline py-5 pl-5">
          <FieldLabel>Lost</FieldLabel>
          <p className="figure mt-2 text-[clamp(1.75rem,6vw,2.25rem)] leading-none font-extrabold text-owed">
            {formatMoney(lost, currency)}
          </p>
        </div>
      </div>

      <p className="mt-4 text-[13px] text-grey-on-ground">
        Nobody was asked for any of it.
      </p>

      <div className="mt-10 grid items-start gap-4 lg:grid-cols-2">
        {pacts.map((pact) => (
          <PactCard key={pact.id} pact={pact} now={now} />
        ))}

        <Panel className="lg:col-span-2">
          <h2 className="text-[15px] font-bold tracking-[-0.015em] text-ink">Everyone</h2>
          <p className="mt-1 text-[13px] text-grey-on-ground">
            Both crews, as they stand this morning.
          </p>

          <div className="mt-6 grid gap-8 lg:grid-cols-2 lg:gap-x-10">
            {pacts.map((pact, i) => (
              <section
                key={pact.id}
                className={cn(i > 0 && "border-t border-hairline pt-7 lg:border-t-0 lg:pt-0")}
              >
                <FieldLabel>{pact.name}</FieldLabel>
                <CrewTable className="mt-1" rows={crewRows(pact, now)} />
              </section>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}
