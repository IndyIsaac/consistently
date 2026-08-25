"use client";

import { motion, useReducedMotion } from "motion/react";
import type { DayMark } from "@/lib/pact-view";
import { cn } from "@/lib/utils";

const FULL_DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

const STATE_WORDS: Record<DayMark["state"], string> = {
  done: "done",
  today: "today, not yet done",
  ghost: "nothing recorded",
};

/**
 * The streak row — filled ink circle with a white check for a day that was done,
 * an ink outline for today, a hairline ghost for everything else. It is the
 * product's most repeated shape, so it lives in one place and is reused whole.
 *
 * The check draws itself on first paint, which is the one piece of motion
 * DESIGN.md asks of this component. It is skipped entirely under
 * `prefers-reduced-motion`.
 */
export function DayMarkers({ days, className }: { days: DayMark[]; className?: string }) {
  const reduceMotion = useReducedMotion();

  // Seven fixed circles have to survive a 320px screen without overflowing and
  // must not sprawl across a wide card, so they step up with the viewport and
  // the row itself is capped.
  return (
    <ul className={cn("flex max-w-[26rem] items-start justify-between", className)}>
      {days.map((day, i) => (
        <li key={day.key} className="flex flex-col items-center gap-2">
          <span
            className={cn(
              "flex size-7 items-center justify-center rounded-full min-[360px]:size-8 min-[400px]:size-9 sm:size-10",
              day.state === "done" && "bg-ink",
              day.state === "today" && "border-2 border-ink",
              day.state === "ghost" && "border border-hairline",
            )}
          >
            {day.state === "done" && (
              <svg
                viewBox="0 0 20 20"
                fill="none"
                aria-hidden="true"
                className="h-[52%] w-[52%]"
              >
                <motion.path
                  d="M4.6 10.2 8.2 13.8 15.4 6.4"
                  stroke="currentColor"
                  className="text-ground"
                  strokeWidth={2.2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  // Constant across server and client — see Arrival.tsx.
                  initial={{ pathLength: 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{
                    delay: reduceMotion ? 0 : 0.1 + i * 0.055,
                    duration: reduceMotion ? 0 : 0.34,
                    ease: [0.16, 1, 0.3, 1],
                  }}
                />
              </svg>
            )}
          </span>

          <span
            className={cn(
              "text-[11px] uppercase tracking-[0.12em]",
              day.isToday ? "font-semibold text-ink" : "text-grey-on-white",
            )}
            aria-hidden="true"
          >
            {day.label}
          </span>

          <span className="sr-only">
            {FULL_DAYS[i]}: {STATE_WORDS[day.state]}
          </span>
        </li>
      ))}
    </ul>
  );
}
