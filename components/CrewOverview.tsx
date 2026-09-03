import { CrewOverviewList, type CrewOverviewRow } from "@/components/CrewOverviewList";
import { formatMoney } from "@/lib/money";
import { fundingLine, fundingStanding } from "@/lib/channel-view";
import {
  daysLeft,
  isTodayDone,
  spell,
  standingLine,
  weekDayMarks,
  type DayMark,
} from "@/lib/pact-view";
import { cadenceOutlook } from "@/lib/rules";
import type { PactView } from "@/lib/view";

export type { CrewOverviewRow };

export type CrewIcon = CrewOverviewRow["icon"];
export type CrewStatus = CrewOverviewRow["status"];

function iconFor(name: string): CrewIcon {
  const n = name.toLowerCase();
  if (/\brun\b/.test(n)) return "run";
  if (/sauna|plunge/.test(n)) return "sauna";
  if (/box|fight/.test(n)) return "fight";
  if (/thai|spanish|class/.test(n)) return "language";
  if (/cfa|study|exam/.test(n)) return "study";
  if (/page|writ/.test(n)) return "write";
  if (/week|gym|lift/.test(n)) return "gym";
  return "crew";
}

function toRow(pact: PactView, now: Date, index: number): CrewOverviewRow {
  const me = pact.crew.find((m) => m.isViewer);
  const funding = fundingStanding(pact.status, pact.crew);
  const marks: DayMark[] = me
    ? weekDayMarks(me.sessions, pact.ruleConfig, pact.timezone, now)
    : [];
  const todayDone = isTodayDone(marks);
  const daysDone = me?.daysDone ?? 0;
  const required = me?.required ?? pact.ruleConfig.cadence;
  const outlook = cadenceOutlook(daysDone, daysLeft(marks), pact.ruleConfig);
  const made = pact.viewerStatus !== "invited" && !funding && outlook.met;

  let status: CrewStatus = "in";
  let tone: CrewOverviewRow["tone"] = "pace";
  let figure = `${daysDone} of ${required}`;
  let line = me ? standingLine(daysDone, required, todayDone) : "";

  if (pact.viewerStatus === "invited") {
    status = "stake";
    tone = "idle";
    figure = "Not staked";
    line = "the crew is waiting";
  } else if (funding) {
    status = "wait";
    tone = "idle";
    figure = fundingLine(funding);
    line = "waiting on the rest";
  } else if (made) {
    status = "made";
    tone = "met";
  } else if (outlook.outOfReach) {
    status = "missed";
    tone = "behind";
  } else {
    const tight =
      outlook.daysAvailable > 0 &&
      outlook.daysNeeded / outlook.daysAvailable >= 0.75;
    tone = tight ? "behind" : "pace";
    if (!todayDone) status = "due";
  }

  return {
    id: pact.id,
    href: `/pacts/${pact.id}`,
    index: String(index + 1).padStart(2, "0"),
    name: pact.name,
    icon: iconFor(pact.name),
    status,
    tone,
    figure,
    line,
    stake: formatMoney(pact.stakeAmount, pact.stakeCurrency),
    todayDone,
    daysDone,
    required,
    streak: me?.currentStreak ?? 0,
    invited: pact.viewerStatus === "invited",
    marks,
    faces: pact.crew.slice(0, 4).map((member) => ({
      id: member.memberId,
      initials: member.initials,
      avatarUrl: member.avatarUrl,
    })),
    members: pact.crew.map((member, i) => {
      const memberMarks = weekDayMarks(
        member.sessions,
        pact.ruleConfig,
        pact.timezone,
        now,
      );
      return {
        id: member.memberId,
        rank: i + 1,
        name: member.isViewer ? "You" : member.displayName,
        initials: member.initials,
        avatarUrl: member.avatarUrl,
        isViewer: member.isViewer,
        daysDone: member.daysDone,
        required: member.required,
        standing: standingLine(
          member.daysDone,
          member.required,
          isTodayDone(memberMarks),
        ),
        lost:
          member.forfeitedToDate > 0
            ? {
                amount: formatMoney(member.forfeitedToDate, pact.stakeCurrency),
                periods: `${spell(member.forfeitedPeriods)} ${
                  member.forfeitedPeriods === 1 ? "week" : "weeks"
                }`,
              }
            : null,
      };
    }),
  };
}

/**
 * The dashboard crew list. Structure from the 21st server table (index, icon,
 * status, progress, one open row). Motion from the stacked list / list item
 * (layout spring, capped stagger). Cadence colour sits on the icon and the
 * today mark; money stays earned/owed.
 */
export function CrewOverview({ pacts, now }: { pacts: PactView[]; now: Date }) {
  return <CrewOverviewList rows={pacts.map((pact, i) => toRow(pact, now, i))} />;
}
