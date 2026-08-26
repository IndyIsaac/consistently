"use client";

import { cn } from "@/lib/utils";

/**
 * The one thing the group decides rather than the software. Real life
 * interferes — food poisoning, a funeral, a delayed flight — and a simple
 * majority of the crew can let someone off. It is the mechanism that stops the
 * rule being a tyrant, so it is stated plainly and never nudged either way.
 *
 * No colour: DESIGN.md admits red and green against money and nothing else, so
 * the tally is drawn in the day-marker's own shapes instead — a filled ink
 * circle for a yes, a hairline ghost for a vote still missing.
 */
export function ExemptionVote({
  requesterName,
  reason,
  approvals,
  needed,
  canVote,
  onVote,
}: {
  requesterName: string;
  reason: string;
  approvals: number;
  needed: number;
  canVote: boolean;
  onVote: (approve: boolean) => void;
}) {
  return (
    <div className="rounded-[20px] border border-hairline bg-surface p-5">
      <p className="text-[11px] font-medium tracking-[0.12em] text-grey-on-surface uppercase">
        Exemption
      </p>

      <p className="mt-3 text-[15px] leading-[1.55] text-ink">
        <span className="font-semibold">{requesterName}</span> is asking to be let off.
      </p>
      <p className="mt-1.5 max-w-[46ch] border-l border-hairline pl-3 text-[14px] leading-relaxed text-grey-on-surface">
        {reason}
      </p>

      <div className="mt-4 flex items-center gap-2.5">
        <span className="flex items-center gap-1.5" aria-hidden="true">
          {Array.from({ length: needed }, (_, i) => (
            <span
              key={i}
              className={cn(
                "size-2.5 rounded-full",
                i < approvals ? "bg-ink" : "border border-hairline bg-transparent",
              )}
            />
          ))}
        </span>
        <span className="figure text-[13px] text-grey-on-surface">
          {approvals} of {needed} needed
        </span>
      </div>

      {canVote && (
        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onVote(true)}
            className="inline-flex h-10 items-center rounded-full bg-ink px-5 text-[14px] font-semibold text-ground transition-opacity hover:opacity-85"
          >
            Let them off
          </button>
          <button
            type="button"
            onClick={() => onVote(false)}
            className="inline-flex h-10 items-center rounded-full border border-hairline bg-panel px-5 text-[14px] font-semibold text-ink transition-colors hover:border-ink/40"
          >
            They still owe
          </button>
        </div>
      )}
    </div>
  );
}
