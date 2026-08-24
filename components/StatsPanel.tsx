"use client";

import type { LeaderRow } from "@/lib/stats";

export function StatsPanel({
  rows,
  viewerMemberId,
}: {
  rows: LeaderRow[];
  viewerMemberId: string | null;
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-neutral-500">Nobody has checked in yet.</p>;
  }

  return (
    <ul className="flex flex-col gap-2">
      {rows.map((row) => {
        const done = row.daysDone >= row.required;
        return (
          <li
            key={row.memberId}
            className={`flex items-center justify-between rounded-xl px-3 py-2 ${
              row.memberId === viewerMemberId ? "bg-neutral-100" : ""
            }`}
          >
            <span className="text-sm font-medium">{row.displayName}</span>
            <span className="flex items-center gap-3 text-sm tabular-nums">
              <span className={done ? "text-emerald-600" : "text-neutral-500"}>
                {row.daysDone}/{row.required}
              </span>
              {row.currentStreak > 0 && (
                <span className="text-xs text-neutral-400">🔥 {row.currentStreak}</span>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
