import { DashedRule, FieldLabel, Panel } from "@/components/Panel";
import { DayMarkers } from "@/components/DayMarkers";
import { formatMoney } from "@/lib/money";
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
};

export type PactCardPact = {
  id: string;
  name: string;
  ruleConfig: RuleConfig;
  timezone: string;
  stakeAmount: number;
  stakeCurrency: string;
  crew: PactCardMember[];
};

/** Your week in one pact: where you are, the day markers, what rides on it. */
export function PactCard({ pact, now }: { pact: PactCardPact; now: Date }) {
  const rank = pact.crew.findIndex((m) => m.isViewer);
  const me = pact.crew[rank];
  if (!me) return null;

  const marks = weekDayMarks(me.sessions, pact.ruleConfig, pact.timezone, now);
  const todayDone = isTodayDone(marks);

  return (
    <Panel>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="truncate text-[15px] font-bold tracking-[-0.015em] text-ink">
          {pact.name}
        </h2>
        <span className="shrink-0 text-[13px] text-grey-on-ground">
          {ordinal(rank + 1)} of {pact.crew.length}
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
