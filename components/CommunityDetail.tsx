"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Activity,
  Apple,
  ArrowLeft,
  BookOpen,
  BookOpenCheck,
  Camera,
  Dumbbell,
  Footprints,
  Moon,
  Swords,
  type LucideIcon,
} from "lucide-react";
import { PhotoChallenge } from "@/components/PhotoChallenge";
import { Avatar, AvatarFallback, AvatarGroup } from "@/components/ui/avatar";
import { DashedRule, FieldLabel, Panel } from "@/components/Panel";
import type { ChallengeStage } from "@/lib/challenge-photo";
import {
  categoryLabel,
  checkInPhotoFor,
  communityPot,
  coverFor,
  type Challenge,
  type Community,
  type CommunityCategory,
} from "@/lib/communities";
import { formatMoney } from "@/lib/money";

/* ---------------------------------------------------------------------------
 * One community, and what is running inside it.
 *
 * The join here is a fixture: it moves local state and no money. The real path
 * is components/StakeSheet.tsx, which prices a DFlow order, has the member sign
 * it and has the sponsor pay the fee — none of which can happen for a crew that
 * exists only in lib/communities.ts. The button says what it would cost and
 * stops there, deliberately, rather than pretending to a transaction.
 * ------------------------------------------------------------------------- */

const ICONS: Record<CommunityCategory, LucideIcon> = {
  gym: Dumbbell,
  running: Footprints,
  "martial-arts": Swords,
  pilates: Activity,
  sleep: Moon,
  nutrition: Apple,
  study: BookOpen,
};

/** What a challenge's state is called on the row, in the product's register. */
function statusLine(challenge: Challenge): string {
  switch (challenge.status) {
    case "open":
      return challenge.startsIn ? `Starts ${challenge.startsIn}` : "Open";
    case "running":
      return "Running";
    case "full":
      return "Closed";
  }
}

function ChallengeRow({
  challenge,
  joined,
  onJoin,
}: {
  challenge: Challenge;
  joined: boolean;
  onJoin: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const stake = formatMoney(challenge.stakeAmount, challenge.stakeCurrency);

  return (
    <li className="rounded-[22px] border border-hairline bg-panel p-6 shadow-panel">
      <div className="flex items-start justify-between gap-5">
        <div className="min-w-0">
          <h3 className="text-[16px] font-bold tracking-[-0.02em] text-ink">{challenge.name}</h3>
          <p className="mt-1 text-[13px] text-grey-on-ground">
            {challenge.cadence} · {statusLine(challenge)}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="figure text-[17px] font-semibold text-ink">{stake}</p>
          <p className="mt-0.5 text-[13px] text-grey-on-ground">to enter</p>
        </div>
      </div>

      <p className="mt-4 max-w-[52ch] text-[14px] leading-relaxed text-grey-on-ground">
        {challenge.rule}
      </p>

      <DashedRule className="mt-5" />

      <div className="mt-5 flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-end gap-7">
          <div>
            <p className="figure text-[15px] font-semibold text-ink">{challenge.members}</p>
            <p className="mt-0.5 text-[13px] text-grey-on-ground">in</p>
          </div>
          <div>
            <p className="figure text-[15px] font-semibold text-ink">
              {formatMoney(challenge.pot, challenge.stakeCurrency)}
            </p>
            <p className="mt-0.5 text-[13px] text-grey-on-ground">in the pot</p>
          </div>
          <div className="flex items-center gap-1.5 pb-0.5 text-grey-on-ground">
            <Camera className="size-3.5" aria-hidden="true" strokeWidth={2} />
            <span className="text-[13px]">
              {challenge.proof === "photo" ? "Photo proof" : "Own word"}
            </span>
          </div>
        </div>

        {joined ? (
          <p className="text-[14px] font-semibold text-ink">
            In. {challenge.startsIn ? `Starts ${challenge.startsIn}.` : "Running."}
          </p>
        ) : challenge.status === "open" ? (
          <button
            type="button"
            onClick={() => setConfirming((open) => !open)}
            aria-expanded={confirming}
            className="inline-flex h-10 items-center rounded-full bg-ink px-5 text-[14px] font-semibold text-ground transition-opacity hover:opacity-85"
          >
            Put in {stake}
          </button>
        ) : (
          <p className="text-[14px] text-grey-on-ground">
            {challenge.status === "running" ? "Started without you" : "Full"}
          </p>
        )}
      </div>

      {/* The confirm. It states what leaves the wallet and what it buys before
          anything is pressed — the same order StakeSheet states it in. */}
      {confirming && !joined && (
        <div className="mt-5 rounded-[18px] border border-hairline bg-surface p-5">
          <FieldLabel className="text-grey-on-surface">What this does</FieldLabel>
          <p className="mt-2.5 max-w-[48ch] text-[14px] leading-relaxed text-ink">
            {stake} leaves your wallet and sits in the pact&rsquo;s vault until the period ends.
            Keep the rule and you get it back with a share of whatever the crew forfeits. Break it
            and it goes to the people who did not.
          </p>
          <p className="mt-3 text-[13px] leading-relaxed text-grey-on-surface">
            Nothing is charged in this demo. The real path prices a route, has you sign it, and the
            sponsor pays the network fee.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                onJoin();
                setConfirming(false);
              }}
              className="inline-flex h-10 items-center rounded-full bg-ink px-5 text-[14px] font-semibold text-ground transition-opacity hover:opacity-85"
            >
              Stake {stake}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="inline-flex h-10 items-center rounded-full border border-hairline bg-panel px-5 text-[14px] font-semibold text-ink transition-colors hover:border-ink/40"
            >
              Not yet
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

/**
 * The poll, wired to local state so the whole arc can be walked on stage:
 * two votes void the photo, the accused appeals, a human answers.
 *
 * The crew here is five, so four people have a say and three of them carry it.
 */
function ChallengeDemo({ category }: { category: CommunityCategory }) {
  const ELIGIBLE = 4;
  const NEEDED = 3;

  const [stage, setStage] = useState<ChallengeStage>("open");
  const [against, setAgainst] = useState(2);
  const [forPhoto, setForPhoto] = useState(0);
  const [voted, setVoted] = useState(false);

  function vote(isAgainst: boolean) {
    const nextAgainst = against + (isAgainst ? 1 : 0);
    const nextFor = forPhoto + (isAgainst ? 0 : 1);
    setAgainst(nextAgainst);
    setForPhoto(nextFor);
    setVoted(true);
    if (nextAgainst >= NEEDED) setStage("upheld");
    else if (nextFor >= NEEDED) setStage("dismissed");
  }

  function reset() {
    setStage("open");
    setAgainst(2);
    setForPhoto(0);
    setVoted(false);
  }

  return (
    <div>
      <PhotoChallenge
        accusedName="Dave"
        challengerName="Nat"
        subject="Wednesday's check-in."
        photoUrl={checkInPhotoFor(category)}
        stage={stage}
        against={against}
        forPhoto={forPhoto}
        needed={NEEDED}
        eligible={ELIGIBLE}
        canVote={!voted}
        canAppeal={stage === "upheld"}
        onVote={vote}
        onAppeal={() => setStage("appealed")}
      />

      {/* The human's side of the appeal. Not a member's control — it stands in
          for the reviewer's queue so the last two states can be shown. */}
      {(stage === "appealed" || stage === "under_review") && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-[18px] border border-dashed border-hairline p-4">
          <BookOpenCheck className="size-4 text-grey-on-ground" aria-hidden="true" strokeWidth={2} />
          <span className="mr-1 text-[13px] text-grey-on-ground">Reviewer, for the demo:</span>
          <button
            type="button"
            onClick={() => setStage("overturned")}
            className="inline-flex h-9 items-center rounded-full border border-hairline bg-panel px-4 text-[13px] font-semibold text-ink transition-colors hover:border-ink/40"
          >
            Restore the check-in
          </button>
          <button
            type="button"
            onClick={() => setStage("final")}
            className="inline-flex h-9 items-center rounded-full border border-hairline bg-panel px-4 text-[13px] font-semibold text-ink transition-colors hover:border-ink/40"
          >
            Crew was right
          </button>
        </div>
      )}

      {stage !== "open" && (
        <button
          type="button"
          onClick={reset}
          className="mt-3 text-[13px] text-grey-on-ground underline transition-colors hover:text-ink"
        >
          Run it again
        </button>
      )}
    </div>
  );
}

export function CommunityDetail({ community }: { community: Community }) {
  const Icon = ICONS[community.category];
  const [joined, setJoined] = useState<Set<string>>(new Set());

  return (
    <div className="mx-auto w-full max-w-[54rem] px-5 pt-8 sm:px-8 sm:pt-12">
      <Link
        href="/communities"
        className="inline-flex items-center gap-1.5 text-[14px] text-grey-on-ground transition-colors hover:text-ink"
      >
        <ArrowLeft className="size-4" aria-hidden="true" strokeWidth={2} />
        Communities
      </Link>

      {/* eslint-disable-next-line @next/next/no-img-element -- a local file
          under public/, already sized. */}
      <img
        src={coverFor(community)}
        alt=""
        className="mt-6 h-44 w-full rounded-[22px] border border-hairline object-cover sm:h-56"
      />

      <div data-category={community.category} className="mt-7 flex items-start gap-4">
        <span
          aria-hidden="true"
          style={{ backgroundColor: "var(--cat-bg)", color: "var(--cat-fg)" }}
          className="inline-flex size-12 shrink-0 items-center justify-center rounded-full"
        >
          <Icon className="size-6" strokeWidth={1.75} />
        </span>
        <div className="min-w-0">
          <h1 className="text-[clamp(1.75rem,6vw,2.5rem)] leading-[1.05] font-extrabold tracking-[-0.035em] text-ink">
            {community.name}
          </h1>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[14px] text-grey-on-ground">
            <span
              style={{ color: "var(--cat-fg)" }}
              className="text-[11px] font-semibold tracking-[0.1em] uppercase"
            >
              {categoryLabel(community.category)}
            </span>
            <span aria-hidden="true" className="text-hairline">
              ·
            </span>
            {community.location}
          </p>
        </div>
      </div>

      <p className="mt-5 max-w-[52ch] text-[15px] leading-relaxed text-grey-on-ground">
        {community.blurb}
      </p>

      <Panel className="mt-7">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="flex items-end gap-9">
            <div>
              <p className="figure text-[26px] leading-none font-extrabold tracking-[-0.03em] text-ink">
                {community.members}
              </p>
              <p className="mt-1.5 text-[13px] text-grey-on-ground">members</p>
            </div>
            <div>
              <p className="figure text-[26px] leading-none font-extrabold tracking-[-0.03em] text-ink">
                {community.challenges.length}
              </p>
              <p className="mt-1.5 text-[13px] text-grey-on-ground">
                {community.challenges.length === 1 ? "challenge" : "challenges"}
              </p>
            </div>
            <div>
              <p className="figure text-[26px] leading-none font-extrabold tracking-[-0.03em] text-ink">
                {formatMoney(communityPot(community), community.currency)}
              </p>
              <p className="mt-1.5 text-[13px] text-grey-on-ground">at stake</p>
            </div>
          </div>

          <AvatarGroup className="shrink-0">
            {community.crew.map((initials) => (
              <Avatar key={initials} className="size-9">
                <AvatarFallback className="bg-surface text-[12px] font-semibold tracking-[0.02em] text-grey-on-surface">
                  {initials}
                </AvatarFallback>
              </Avatar>
            ))}
          </AvatarGroup>
        </div>
      </Panel>

      <h2 className="mt-12 text-[20px] font-bold tracking-[-0.025em] text-ink">
        What is running
      </h2>
      <ul className="mt-5 flex flex-col gap-4">
        {community.challenges.map((challenge) => (
          <ChallengeRow
            key={challenge.id}
            challenge={challenge}
            joined={joined.has(challenge.id)}
            onJoin={() => setJoined((set) => new Set(set).add(challenge.id))}
          />
        ))}
      </ul>

      <h2 className="mt-12 text-[20px] font-bold tracking-[-0.025em] text-ink">
        How the crew polices it
      </h2>
      <p className="mt-3 max-w-[52ch] text-[15px] leading-relaxed text-grey-on-ground">
        Nothing checks a photo automatically and nothing will. Anyone in the crew can run{" "}
        <span className="font-semibold text-ink">/challenge</span> on a check-in they do not
        believe, and a majority of everyone else decides. Lose it and you can send it to a person.
      </p>

      <div className="mt-5">
        <ChallengeDemo category={community.category} />
      </div>
    </div>
  );
}
