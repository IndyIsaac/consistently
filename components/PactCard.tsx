import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { DashedRule, FieldLabel, Panel } from "@/components/Panel";
import { DayMarkers } from "@/components/DayMarkers";
import { formatMoney } from "@/lib/money";
import { fundingStanding } from "@/lib/channel-view";
import { isTodayDone, ordinal, standingLine, weekDayMarks } from "@/lib/pact-view";
import type { RuleConfig, SessionRecord } from "@/lib/rules";
import type { LeaderRow } from "@/lib/stats";

/**
 * Structural props, not the mock's own types: this reads a pact the shape the
 * API returns, so deleting lib/mock-session.ts changes nothing here.
 */
export type PactCardMember = LeaderRow & {
  isViewer: boolean;
  sessions: SessionRecord[];
  /** `Membership.status` -- who has actually paid. */
  status: string;
};

export type PactCardPact = {
  id: string;
  name: string;
  ruleConfig: RuleConfig;
  timezone: string;
  stakeAmount: number;
  stakeCurrency: string;
  crew: PactCardMember[];
  /** Prisma `PactStatus`. A pact runs only once everybody has staked. */
  status: "funding" | "active" | "settled";
  /** Prisma `MemberStatus` for the viewer. `invited` means they have not paid. */
  viewerStatus: "invited" | "staked" | "passed" | "failed" | "left";
};

/** Your week in one pact: where you are, the day markers, what rides on it. */
export function PactCard({ pact, now }: { pact: PactCardPact; now: Date }) {
  const rank = pact.crew.findIndex((m) => m.isViewer);
  const me = pact.crew[rank];
  if (!me) return null;

  const funding = fundingStanding(pact.status, pact.crew);

  const marks = weekDayMarks(me.sessions, pact.ruleConfig, pact.timezone, now);
  const todayDone = isTodayDone(marks);

  /**
   * A member who has joined but not paid has no standing to draw. Showing them
   * "0 of 5" would read as being behind, which is a different thing entirely
   * and lets them believe they are in when they are not. What they have is one
   * outstanding action, so that is the whole card.
   */
  if (pact.viewerStatus === "invited") {
    return (
      <Link
        href={`/pacts/${pact.id}`}
        className="group block rounded-[22px] border border-hairline bg-panel p-6 shadow-panel transition-[border-color,box-shadow] duration-200 hover:border-ink/30 hover:shadow-panel-hover"
      >
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="truncate text-[15px] font-bold tracking-[-0.015em] text-ink">
            {pact.name}
          </h2>
          <span className="shrink-0 text-[13px] text-grey-on-ground">
            {pact.crew.length} {pact.crew.length === 1 ? "member" : "members"}
          </span>
        </div>

        <p className="figure mt-5 text-[3rem] leading-[0.95] font-extrabold text-ink">
          {formatMoney(pact.stakeAmount, pact.stakeCurrency)}
        </p>

        <p className="mt-2.5 max-w-[34ch] text-[14px] leading-relaxed text-grey-on-ground">
          Your stake is not in yet. The crew does not start until it is.
        </p>

        <DashedRule className="mt-7" />

        <span className="mt-4 inline-flex items-center gap-1.5 text-[13px] font-semibold text-ink">
          Put it in
          <ArrowRight
            className="size-3.5 transition-transform duration-200 group-hover:translate-x-0.5"
            aria-hidden="true"
          />
        </span>
      </Link>
    );
  }

  return (
    <Panel>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="truncate text-[15px] font-bold tracking-[-0.015em] text-ink">
          {pact.name}
        </h2>
        {/* A placing needs a contest, and there is not one until everybody
            has paid: nobody is judged on a week that has not begun, and the
            denominator counts members who can neither win nor forfeit yet.
            What the crew is waiting for is the only standing there is. */}
        <span className="shrink-0 text-[13px] text-grey-on-ground">
          {funding
            ? `${funding.staked} of ${funding.of} staked`
            : `${ordinal(rank + 1)} of ${pact.crew.length}`}
        </span>
      </div>

      <p className="figure mt-5 text-[3rem] leading-[0.95] font-extrabold text-ink">
        {me.daysDone}
        <span className="text-grey-on-ground"> of {me.required}</span>
      </p>

      <p className="mt-2.5 text-[14px] text-grey-on-ground">
        {standingLine(me.daysDone, me.required, todayDone)}
      </p>

      <DayMarkers days={marks} className="mt-7" />

      <DashedRule className="mt-7" />

      <div className="mt-4 flex items-end justify-between gap-4">
        <div>
          <FieldLabel>Streak</FieldLabel>
          <p className="figure mt-1.5 text-[15px] font-semibold text-ink">
            {me.currentStreak} {me.currentStreak === 1 ? "day" : "days"}
          </p>
        </div>
        <div className="text-right">
          <FieldLabel>On this week</FieldLabel>
          <p className="figure mt-1.5 text-[15px] font-semibold text-ink">
            {formatMoney(pact.stakeAmount, pact.stakeCurrency)}
          </p>
        </div>
      </div>
    </Panel>
  );
}
