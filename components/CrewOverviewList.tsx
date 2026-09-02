"use client";

import { useState } from "react";
import Link from "next/link";
import {
  AnimatePresence,
  motion,
  useReducedMotion,
} from "motion/react";
import {
  ArrowRight,
  BookOpen,
  Check,
  ChevronDown,
  Dumbbell,
  Flame,
  Footprints,
  Languages,
  PenLine,
  Swords,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarGroup, AvatarImage } from "@/components/ui/avatar";
import { CrewTable, type CrewRowData } from "@/components/CrewTable";
import { DayMarkers } from "@/components/DayMarkers";
import { DashedRule, FieldLabel } from "@/components/Panel";
import type { DayMark } from "@/lib/pact-view";
import { cn } from "@/lib/utils";

const ICONS: Record<CrewOverviewRow["icon"], LucideIcon> = {
  gym: Dumbbell,
  study: BookOpen,
  run: Footprints,
  sauna: Flame,
  fight: Swords,
  language: Languages,
  write: PenLine,
  crew: Users,
};

const STATUS: Record<CrewOverviewRow["status"], string> = {
  due: "Due",
  made: "Made",
  in: "In",
  missed: "Missed",
  stake: "Stake",
  wait: "Wait",
};

const TONE: Record<CrewOverviewRow["tone"], string> = {
  idle: "bg-surface text-ink",
  met: "bg-earned text-ground",
  pace: "bg-pace text-ground",
  behind: "bg-owed text-ground",
};

const ease = [0.16, 1, 0.3, 1] as const;

export type CrewOverviewRow = {
  id: string;
  href: string;
  index: string;
  name: string;
  icon: "gym" | "study" | "run" | "sauna" | "fight" | "language" | "write" | "crew";
  status: "due" | "made" | "in" | "missed" | "stake" | "wait";
  tone: "idle" | "met" | "pace" | "behind";
  figure: string;
  line: string;
  stake: string;
  todayDone: boolean;
  daysDone: number;
  required: number;
  streak: number;
  invited: boolean;
  marks: DayMark[];
  faces: { id: string; initials: string; avatarUrl: string | null }[];
  members: {
    id: string;
    rank: number;
    name: string;
    initials: string;
    avatarUrl: string | null;
    isViewer: boolean;
    daysDone: number;
    required: number;
    standing: string;
    lost: { amount: string; periods: string } | null;
  }[];
};

function memberRows(row: CrewOverviewRow): CrewRowData[] {
  return row.members.map((member) => ({
    id: member.id,
    rank: member.rank,
    name: member.name,
    initials: member.initials,
    avatarUrl: member.avatarUrl,
    isViewer: member.isViewer,
    subline: member.lost ? (
      <>
        Lost <span className="font-semibold text-owed">{member.lost.amount}</span>.{" "}
        {member.lost.periods}.
      </>
    ) : (
      member.standing
    ),
    figure: (
      <>
        {member.daysDone}
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
  }));
}

/**
 * Today: green disc and a tick if it is in, red disc and a cross if it is
 * not. Same shape as the day row; colour is the cadence, not the money.
 */
function TodayMark({ done, invited }: { done: boolean; invited: boolean }) {
  const word = invited ? "not started" : done ? "done" : "not done";
  return (
    <span className="inline-flex items-center justify-start">
      <span
        aria-hidden="true"
        className={cn(
          "flex size-5 items-center justify-center rounded-full",
          invited
            ? "border border-hairline"
            : done
              ? "bg-earned"
              : "bg-owed",
        )}
      >
        {!invited && done && (
          <Check className="size-3 text-ground" strokeWidth={2.6} />
        )}
        {!invited && !done && (
          <X className="size-3 text-ground" strokeWidth={2} />
        )}
      </span>
      <span className="sr-only">Today {word}</span>
    </span>
  );
}

function StatusPill({ status }: { status: CrewOverviewRow["status"] }) {
  const loud = status === "due" || status === "missed";
  return (
    <span
      className={cn(
        "inline-flex w-20 items-center justify-center rounded-full py-1 text-center text-[11px] font-medium tracking-[0.12em] uppercase",
        loud ? "bg-ink text-ground" : "border border-hairline text-grey-on-ground",
      )}
    >
      {STATUS[status]}
    </span>
  );
}

function ProgressTicks({ done, of }: { done: number; of: number }) {
  const n = Math.max(of, 1);
  return (
    <div className="flex items-center gap-0.5" aria-hidden="true">
      {Array.from({ length: n }, (_, i) => (
        <span
          key={i}
          className={cn(
            "h-1.5 w-2 rounded-full",
            i < done ? "bg-ink" : "bg-hairline",
          )}
        />
      ))}
    </div>
  );
}

export function CrewOverviewList({ rows }: { rows: CrewOverviewRow[] }) {
  const reduceMotion = useReducedMotion();
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <section className="mt-10 overflow-hidden rounded-[22px] border border-hairline bg-panel shadow-panel">
      <div className="hidden border-b border-hairline px-5 py-3 sm:grid sm:grid-cols-[2rem_minmax(0,1fr)_7.5rem_3.25rem_5.25rem_5.5rem_1.25rem] sm:items-center sm:gap-3 sm:px-6">
        <span aria-hidden="true" />
        <FieldLabel>Crew</FieldLabel>
        <FieldLabel>This week</FieldLabel>
        <FieldLabel>Today</FieldLabel>
        <FieldLabel>Status</FieldLabel>
        <FieldLabel className="text-right">Stake</FieldLabel>
        <span aria-hidden="true" />
      </div>

      <motion.ul
        initial="hidden"
        animate="visible"
        variants={{
          hidden: {},
          visible: {
            transition: reduceMotion
              ? {}
              : { staggerChildren: 0.04, delayChildren: 0.04 },
          },
        }}
      >
        {rows.map((row) => {
          const Icon = ICONS[row.icon];
          const open = openId === row.id;

          return (
            <motion.li
              key={row.id}
              variants={{
                hidden: reduceMotion ? { opacity: 1 } : { opacity: 0, y: 10 },
                visible: {
                  opacity: 1,
                  y: 0,
                  transition: { duration: reduceMotion ? 0 : 0.34, ease },
                },
              }}
              className="border-t border-hairline first:border-t-0"
            >
              <button
                type="button"
                aria-expanded={open}
                aria-controls={`crew-panel-${row.id}`}
                onClick={() => setOpenId(open ? null : row.id)}
                className={cn(
                  "grid w-full cursor-pointer items-center gap-x-3 px-5 py-3.5 text-left transition-colors",
                  "grid-cols-[2.5rem_minmax(0,1fr)_auto_auto_1.25rem]",
                  "sm:grid-cols-[2rem_minmax(0,1fr)_7.5rem_3.25rem_5.25rem_5.5rem_1.25rem] sm:gap-3 sm:px-6",
                  open ? "bg-surface" : "hover:bg-surface/70",
                )}
              >
                <span className="figure text-[13px] text-grey-on-ground">
                  {row.index}
                </span>

                <div className="flex min-w-0 items-center gap-3">
                  <span
                    className={cn(
                      "flex size-10 shrink-0 items-center justify-center rounded-full",
                      TONE[row.tone],
                    )}
                  >
                    <Icon className="size-4" aria-hidden="true" strokeWidth={1.75} />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-[15px] font-bold tracking-[-0.015em] text-ink">
                      {row.name}
                    </p>
                    <p className="mt-0.5 truncate text-[13px] text-grey-on-ground sm:hidden">
                      {row.figure}
                      {row.line ? ` · ${row.line}` : ""}
                    </p>
                    <div className="mt-1.5 sm:hidden">
                      <ProgressTicks done={row.daysDone} of={row.required} />
                    </div>
                  </div>
                </div>

                <div className="hidden min-w-0 sm:block">
                  <p className="figure truncate text-[15px] font-semibold text-ink">
                    {row.figure}
                  </p>
                  <div className="mt-1.5">
                    <ProgressTicks done={row.daysDone} of={row.required} />
                  </div>
                </div>

                <div className="col-start-3 row-start-1 self-center sm:col-auto sm:row-auto">
                  <TodayMark done={row.todayDone} invited={row.invited} />
                </div>

                <span className="hidden sm:inline-flex">
                  <StatusPill status={row.status} />
                </span>

                <p className="figure self-center text-right text-[15px] font-semibold text-ink">
                  {row.stake}
                </p>

                <ChevronDown
                  aria-hidden="true"
                  className={cn(
                    "size-4 justify-self-end text-grey-on-ground transition-transform duration-200",
                    open && "rotate-180",
                  )}
                />
              </button>

              <AnimatePresence initial={false}>
                {open && (
                  <motion.div
                    id={`crew-panel-${row.id}`}
                    initial={reduceMotion ? false : { height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={reduceMotion ? undefined : { height: 0, opacity: 0 }}
                    transition={{ duration: reduceMotion ? 0 : 0.34, ease }}
                    className="overflow-hidden bg-surface"
                  >
                    <div className="px-5 pt-1 pb-6 sm:px-6 sm:pl-[calc(2rem+0.75rem+2.5rem)]">
                      {row.invited ? (
                        <>
                          <p className="max-w-[40ch] text-[14px] leading-relaxed text-grey-on-ground">
                            Your stake is not in yet. The crew does not start
                            until it is.
                          </p>
                          <Link
                            href={row.href}
                            className="mt-4 inline-flex items-center gap-1.5 text-[13px] font-semibold text-ink"
                          >
                            Put it in
                            <ArrowRight className="size-3.5" aria-hidden="true" />
                          </Link>
                        </>
                      ) : (
                        <>
                          <div className="mb-5 flex items-center justify-between gap-3 sm:hidden">
                            <StatusPill status={row.status} />
                            <AvatarGroup className="shrink-0">
                              {row.faces.map((face) => (
                                <Avatar key={face.id} className="size-7">
                                  {face.avatarUrl && (
                                    <AvatarImage src={face.avatarUrl} alt="" />
                                  )}
                                  <AvatarFallback className="bg-panel text-[10px] font-semibold text-grey-on-ground">
                                    {face.initials}
                                  </AvatarFallback>
                                </Avatar>
                              ))}
                            </AvatarGroup>
                          </div>

                          <DayMarkers days={row.marks} />

                          <div className="mt-6 flex items-end justify-between gap-4">
                            <div>
                              <FieldLabel>Streak</FieldLabel>
                              <p className="figure mt-1.5 text-[15px] font-semibold text-ink">
                                {row.streak} {row.streak === 1 ? "day" : "days"}
                              </p>
                            </div>
                            <div className="hidden sm:block">
                              <AvatarGroup>
                                {row.faces.map((face) => (
                                  <Avatar key={face.id} className="size-8">
                                    {face.avatarUrl && (
                                      <AvatarImage src={face.avatarUrl} alt="" />
                                    )}
                                    <AvatarFallback className="bg-panel text-[11px] font-semibold text-grey-on-ground">
                                      {face.initials}
                                    </AvatarFallback>
                                  </Avatar>
                                ))}
                              </AvatarGroup>
                            </div>
                            <Link
                              href={row.href}
                              className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-ink"
                            >
                              Open
                              <ArrowRight className="size-3.5" aria-hidden="true" />
                            </Link>
                          </div>

                          <DashedRule className="mt-6" />
                          <FieldLabel className="mt-5">The crew</FieldLabel>
                          <CrewTable className="mt-1" rows={memberRows(row)} />
                        </>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.li>
          );
        })}
      </motion.ul>
    </section>
  );
}
