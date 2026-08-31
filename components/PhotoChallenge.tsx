"use client";

import { useState } from "react";
import { Gavel, ShieldQuestion } from "lucide-react";
import type { ChallengeStage } from "@/lib/challenge-photo";
import { cn } from "@/lib/utils";

/* ---------------------------------------------------------------------------
 * A photo, questioned.
 *
 * The second thing the group decides rather than the software, and the harsher
 * of the two: an exemption asks the crew for a favour, this accuses somebody of
 * lying. It is drawn in the same shapes as components/ExemptionVote.tsx so the
 * two read as one mechanism, and stated just as flatly — the product never
 * editorialises about a member, only about the record.
 *
 * No colour, on purpose. DESIGN.md admits red and green against money and
 * nothing else, and a void check-in is not money until settlement. The tally is
 * the day-marker's own shape instead: a filled ink dot for a vote cast, a
 * hairline ghost for one still missing.
 * ------------------------------------------------------------------------- */

export type PhotoChallengeProps = {
  accusedName: string;
  challengerName: string;
  /** What the photo was meant to prove. "Wednesday's check-in." */
  subject: string;
  photoUrl: string | null;
  stage: ChallengeStage;
  against: number;
  forPhoto: number;
  needed: number;
  eligible: number;
  /** The viewer is in the electorate and has not voted yet. */
  canVote: boolean;
  /** The viewer is the accused, and the stage still allows an appeal. */
  canAppeal: boolean;
  onVote?: (against: boolean) => void;
  onAppeal?: (reason: string) => void;
};

/** Filled for votes cast, ghosted for the ones a verdict still waits on. */
function Tally({ cast, needed }: { cast: number; needed: number }) {
  return (
    <span className="flex items-center gap-1.5" aria-hidden="true">
      {Array.from({ length: needed }, (_, i) => (
        <span
          key={i}
          className={cn(
            "size-2.5 rounded-full",
            i < cast ? "bg-ink" : "border border-hairline bg-transparent",
          )}
        />
      ))}
    </span>
  );
}

/** One line of state, in the bot's voice. Never an adjective about the person. */
function verdictLine(props: PhotoChallengeProps): string {
  switch (props.stage) {
    case "upheld":
      return `${props.against} of ${props.eligible} say it does not count. The check-in is void.`;
    case "dismissed":
      return "The crew did not agree. The check-in stands.";
    case "appealed":
      return "Appealed. The period is frozen until somebody reviews it.";
    case "under_review":
      return "A human has it. The period stays frozen.";
    case "overturned":
      return "Review done. The check-in is restored.";
    case "final":
      return "Review done. The crew was right. The check-in stays void.";
    default:
      return `${props.against} of ${props.needed} needed to void it.`;
  }
}

export function PhotoChallenge(props: PhotoChallengeProps) {
  const [appealing, setAppealing] = useState(false);
  const [reason, setReason] = useState("");

  const open = props.stage === "open";
  const waiting = props.stage === "appealed" || props.stage === "under_review";

  return (
    <div className="rounded-[20px] border border-hairline bg-surface p-5">
      <div className="flex items-center gap-2">
        <Gavel className="size-3.5 text-grey-on-surface" aria-hidden="true" strokeWidth={2} />
        <p className="text-[11px] font-medium tracking-[0.12em] text-grey-on-surface uppercase">
          Photo challenged
        </p>
      </div>

      <p className="mt-3 text-[15px] leading-[1.55] text-ink">
        <span className="font-semibold">{props.challengerName}</span> says{" "}
        <span className="font-semibold">{props.accusedName}</span>&rsquo;s photo does not count.
      </p>
      <p className="mt-1 text-[13px] text-grey-on-surface">{props.subject}</p>

      {props.photoUrl && (
        /* A member's own upload at an arbitrary remote host; next/image would
           need every one of them in remotePatterns, and this is the same call
           components/Feed.tsx already makes for exactly this reason. */
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={props.photoUrl}
          alt={`${props.accusedName}'s ${props.subject.toLowerCase()}`}
          className="mt-4 aspect-[4/3] w-full max-w-[18rem] rounded-[14px] border border-hairline object-cover"
        />
      )}

      <div className="mt-4 flex items-center gap-2.5">
        {open ? (
          <>
            <Tally cast={props.against} needed={props.needed} />
            <span className="figure text-[13px] text-grey-on-surface">{verdictLine(props)}</span>
          </>
        ) : (
          <span className="text-[13px] leading-relaxed text-grey-on-surface">
            {verdictLine(props)}
          </span>
        )}
      </div>

      {open && props.canVote && (
        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => props.onVote?.(true)}
            className="inline-flex h-10 items-center rounded-full bg-ink px-5 text-[14px] font-semibold text-ground transition-opacity hover:opacity-85"
          >
            It does not count
          </button>
          <button
            type="button"
            onClick={() => props.onVote?.(false)}
            className="inline-flex h-10 items-center rounded-full border border-hairline bg-panel px-5 text-[14px] font-semibold text-ink transition-colors hover:border-ink/40"
          >
            It stands
          </button>
        </div>
      )}

      {/* The way out of a verdict the crew got wrong. Only the accused sees it,
          and only while the challenge is upheld and unappealed. */}
      {props.canAppeal && !appealing && (
        <button
          type="button"
          onClick={() => setAppealing(true)}
          className="mt-5 inline-flex h-10 items-center gap-2 rounded-full border border-hairline bg-panel px-5 text-[14px] font-semibold text-ink transition-colors hover:border-ink/40"
        >
          <ShieldQuestion className="size-4" aria-hidden="true" strokeWidth={2} />
          Appeal to a human
        </button>
      )}

      {props.canAppeal && appealing && (
        <form
          className="mt-5"
          onSubmit={(e) => {
            e.preventDefault();
            const trimmed = reason.trim();
            if (trimmed.length === 0) return;
            props.onAppeal?.(trimmed);
            setAppealing(false);
            setReason("");
          }}
        >
          <label
            htmlFor="appeal-reason"
            className="text-[11px] font-medium tracking-[0.12em] text-grey-on-surface uppercase"
          >
            What the crew missed
          </label>
          <textarea
            id="appeal-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            maxLength={280}
            placeholder="The clock is in the mirror, not the wall."
            className="mt-2 w-full resize-none rounded-[14px] bg-panel px-4 py-3 text-[14px] text-ink transition-colors placeholder:text-grey-on-surface"
          />
          <p className="mt-2 text-[13px] leading-relaxed text-grey-on-surface">
            One appeal, and a person reads it. Nothing settles until they answer.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={reason.trim().length === 0}
              className="inline-flex h-10 items-center rounded-full bg-ink px-5 text-[14px] font-semibold text-ground transition-opacity hover:opacity-85 disabled:opacity-25"
            >
              Send it up
            </button>
            <button
              type="button"
              onClick={() => setAppealing(false)}
              className="inline-flex h-10 items-center rounded-full border border-hairline bg-panel px-5 text-[14px] font-semibold text-ink transition-colors hover:border-ink/40"
            >
              Leave it
            </button>
          </div>
        </form>
      )}

      {waiting && (
        <p className="mt-4 border-l border-hairline pl-3 text-[13px] leading-relaxed text-grey-on-surface">
          Nobody can run /settle on this period while a review is open. That is the point of it.
        </p>
      )}
    </div>
  );
}
