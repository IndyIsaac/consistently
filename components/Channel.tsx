"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { getAccessToken } from "@privy-io/react-auth";
import { isTimeout } from "@/lib/utils";
import { ArrowLeft, QrCode } from "lucide-react";
import type { FeedItemDto } from "@/app/api/pacts/[id]/feed/route";
import { CheckInCamera } from "@/components/CheckInCamera";
import { CommandInput } from "@/components/CommandInput";
import { DayMarkers } from "@/components/DayMarkers";
import { ExemptionVote } from "@/components/ExemptionVote";
import { Feed } from "@/components/Feed";
import { InviteQr } from "@/components/InviteQr";
import { PhotoChallenge } from "@/components/PhotoChallenge";
import { StakeSheet } from "@/components/StakeSheet";
import { Avatar, AvatarFallback, AvatarGroup } from "@/components/ui/avatar";
import {
  cadenceMetLine,
  crewReply,
  exemptNeedsReasonReply,
  helpReply,
  inviteReply,
  outOfReachVerdict,
  parseSettle,
  photoUploadRefusalLine,
  photoUploadSkippedLine,
  settledLine,
  settleFailedLine,
  settleUnknownArgumentReply,
  settlingForcedLine,
  settlingLine,
  outlookLine,
  stakeReply,
  fundingReply,
  statusReply,
  unknownCommandReply,
} from "@/lib/bot";
import {
  appealFiledLine,
  challengeAlreadyOpenReply,
  challengeNeedsMemberReply,
  challengeOpenedLine,
  challengeSelfReply,
  challengeUnknownMemberReply,
  challengeVerdictLine,
  type ChallengeStage,
} from "@/lib/challenge-photo";
import {
  channelView,
  dayJustClosed,
  withReactionToggled,
  type ChannelView,
} from "@/lib/channel-view";
// The transport. Each of these is the route it names when a database and a
// Privy app are configured, and the in-memory demo when they are not -- the
// branch is in lib/channel-client.ts and nothing here knows which it got.
//
//   getPact          -> GET  /api/pacts/[id]/view
//   getChannel       -> GET  /api/pacts/[id]/feed
//   openSession      -> POST /api/pacts/[id]/sessions     { action: "open" }
//   closeSession     -> POST /api/pacts/[id]/sessions     { action: "close" }
//   toggleReaction   -> POST /api/feed/[itemId]/react
//   requestExemption -> POST /api/pacts/[id]/exemptions   { action: "request" }
//   castVote         -> POST /api/pacts/[id]/exemptions   { action: "vote" }
import {
  castVote,
  ChannelError,
  closeSession,
  getChannel,
  getPact,
  now as channelNow,
  openSession,
  requestExemption,
  toggleReaction,
} from "@/lib/channel-client";
import { upload } from "@/lib/upload";
import { cn } from "@/lib/utils";

/* ---------------------------------------------------------------------------
 * The group: a bot channel, not a chat.
 *
 * Two things a member can do, and they are the only two: take a photo, and run
 * a command. Everything else on this screen is the bot stating the record.
 *
 * The bot's answers to commands are held here rather than written to the feed.
 * A command is a question one member asked, and the crew does not need "Indy
 * ran /help" in their transcript. The check-ins, the verdicts and the
 * exemptions do belong to everyone, and those go through the API.
 * ------------------------------------------------------------------------- */

/** Ids the bot's answers to *you* carry. Everything else came from the feed. */
const REPLY_PREFIX = "reply_";

export function Channel({
  view: initialView,
  items: initialItems,
  viewerWallet,
  showInvite = false,
  needsStake = false,
  // Renamed on the way in: `openSession` is also the action that starts one.
  openSession: serverSession = null,
}: {
  view: ChannelView;
  items: FeedItemDto[];
  viewerWallet: string;
  /** Opens the code straight away -- the beat after a crew is created. */
  showInvite?: boolean;
  /** The viewer has joined but not paid. Nothing else is theirs to do yet. */
  needsStake?: boolean;
  /**
   * The viewer's session that is still open on the server, if any.
   *
   * Without this the state below started at null on every mount, and the server
   * knew about a session the screen did not. Leaving the page did it -- the
   * Groups link this component renders itself, a reload, or a phone discarding
   * a backgrounded tab, which is exactly what happens across a thirty-minute
   * gym rule.
   *
   * The button then read "Check in" again. Pressing it hit the open-session
   * guard, which refuses without offering a way out: check-out is keyed by
   * sessionId and the client no longer had one. So the row never got an
   * endedAt, the day never counted on a checkin_checkout rule -- the default --
   * and because that guard's lookup is not scoped to a day, the orphan blocked
   * every check-in for the rest of the pact. One tap on a nav link forfeited
   * the stake.
   */
  openSession?: { sessionId: string; startedAt: number } | null;
}) {
  const [view, setView] = useState(initialView);
  const [items, setItems] = useState(initialItems);
  const [replies, setReplies] = useState<FeedItemDto[]>([]);
  const [session, setSession] = useState<{ sessionId: string; startedAt: number } | null>(
    serverSession,
  );
  const [elapsed, setElapsed] = useState(0);
  const [qrOpen, setQrOpen] = useState(showInvite);
  const [pinned, setPinned] = useState(false);

  /**
   * The photo under challenge, if there is one.
   *
   * Local state and not the API: there is no `Challenge` table yet, and adding
   * one to prisma/schema.prisma while a second branch is open on the same
   * repository is how two people end up with two different migrations for the
   * same idea. The arithmetic that decides it is already real and already
   * tested in lib/challenge-photo.ts — this holds the row until there is
   * somewhere to put it.
   */
  const [challenge, setChallenge] = useState<{
    accusedName: string;
    challengerName: string;
    subject: string;
    photoUrl: string | null;
    stage: ChallengeStage;
    against: number;
    forPhoto: number;
    needed: number;
    eligible: number;
    /** The viewer has already cast their one vote. */
    voted: boolean;
    accusedIsViewer: boolean;
  } | null>(null);

  const foot = useRef<HTMLDivElement>(null);
  const headEnd = useRef<HTMLDivElement>(null);
  // `refresh` has to see the latest view without being rebuilt every time the
  // view changes, or the poll below would tear itself down on every tick.
  const viewRef = useRef(view);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  const say = useCallback((body: string) => {
    setReplies((rows) => [
      {
        id: `${REPLY_PREFIX}${crypto.randomUUID()}`,
        type: "bot",
        body,
        photoUrl: null,
        authorName: null,
        createdAt: channelNow().toISOString(),
        reactions: [],
      },
      ...rows,
    ]);
  }, []);

  /** The feed and the bot's answers as one column, in the feed's own order. */
  const shown = useMemo(
    () => [...replies, ...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [replies, items],
  );

  const scrollToFoot = useCallback(() => {
    /**
     * `nearest`, not `end`.
     *
     * The foot is a 1px div at the bottom of the content and there is no
     * scroll container around the feed, so this moves the window. `end`
     * aligns it to the bottom of the viewport whether or not it needs to --
     * and on a channel with three lines in it, where the foot is already on
     * screen, that is a smooth scroll to nowhere the member asked to go. It
     * reads as the page throwing itself to the top after every command.
     *
     * `nearest` does nothing when the target is already visible, and the
     * minimum when it is not, which is the whole of what this wants.
     */
    requestAnimationFrame(() =>
      foot.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }),
    );
  }, []);

  /**
   * Re-reads the pact and the channel, and says whatever the arithmetic has
   * decided since the last look: a cadence covered, or a cadence gone.
   *
   * This is the point of the whole screen. A member finds out that five is out
   * of reach at the moment it is, in the channel, rather than days later when
   * ฿1,000 moves without warning.
   */
  const refresh = useCallback(async (): Promise<ChannelView> => {
    const [pact, feed] = await Promise.all([
      getPact(viewRef.current.pactId),
      getChannel(viewRef.current.pactId, viewerWallet),
    ]);
    setItems(feed);
    if (!pact) return viewRef.current;

    const before = viewRef.current;
    const now = channelNow();
    const after = channelView(pact, now);

    for (const member of after.crew) {
      const was = before.crew.find((m) => m.memberId === member.memberId);
      if (!was) continue;

      if (!was.outlook.outOfReach && member.outlook.outOfReach) {
        say(
          outOfReachVerdict({
            name: member.isViewer ? null : member.firstName,
            cadence: after.rule.cadence,
            dayClosed: dayJustClosed(after.timezone, now),
            stake: after.stake,
            settlesOn: after.settlesOn,
          }),
        );
      } else if (!was.outlook.met && member.outlook.met) {
        say(cadenceMetLine(member.firstName, after.rule.cadence));
      }
    }

    viewRef.current = after;
    setView(after);
    return after;
  }, [say, viewerWallet]);

  // The clock keeps moving whether or not anyone touches the screen, and a day
  // ending is the commonest way a cadence goes out of reach. A real build
  // subscribes; this looks.
  useEffect(() => {
    const id = setInterval(() => void refresh(), 5_000);
    return () => clearInterval(id);
  }, [refresh]);

  // How long the open session has run, on the clock the check-out is measured
  // against. It says elapsed and not remaining: the rule is enforced at the
  // moment of the attempt, and a countdown would be the app doing the enforcing.
  useEffect(() => {
    if (!session) return;
    const id = setInterval(
      () => setElapsed(Math.max(0, Math.floor((channelNow().getTime() - session.startedAt) / 60_000))),
      1_000,
    );
    return () => clearInterval(id);
  }, [session]);

  // The compact bar exists only once the pact's own head has gone off the top.
  useEffect(() => {
    const mark = headEnd.current;
    if (!mark) return;
    const observer = new IntersectionObserver(([entry]) => setPinned(!entry.isIntersecting), {
      rootMargin: "-72px 0px 0px 0px",
    });
    observer.observe(mark);
    return () => observer.disconnect();
  }, []);

  async function capture(file: File) {
    /**
     * The photo goes to blob storage before anything is recorded, and the URL
     * that comes back is what is stored.
     *
     * This used to be `URL.createObjectURL(file)`, which is a string that
     * resolves only in the tab that made it. It was written to Postgres and
     * rendered to the whole crew, so the member who took the photo saw it and
     * every other member -- and the projector, and that member after one
     * reload -- saw a broken image. The one photo in the product that the crew
     * actually judges each other on was the one that never left the device.
     */
    let photoUrl: string | null;
    try {
      photoUrl = await upload(file);
    } catch (e) {
      const reason = e instanceof Error ? e.message : "Upload failed.";
      /**
       * What to do about a photo that did not go up depends on what the pact
       * asked for, and only on that.
       *
       * On a `photo` pact the photo is the proof. Recording the session anyway
       * would count a day towards the cadence with nothing behind it for the
       * crew to look at or dispute -- and money moves on that count. So the
       * check-in does not happen, and the member is told why while they are
       * still standing there and can try again.
       *
       * On a `self_attest` pact the photo was never the evidence, so losing it
       * costs the crew nothing and trapping the member would be gratuitous.
       */
      if (view.rule.proof === "photo") {
        // Which side of the session this was decides what is true afterwards:
        // on the way in nothing exists, on the way out the session is still
        // open and the member is still checked in.
        say(photoUploadRefusalLine(reason, session ? "out" : "in"));
        scrollToFoot();
        return;
      }
      say(photoUploadSkippedLine(reason));
      photoUrl = null;
    }

    try {
      if (session) {
        await closeSession({
          pactId: view.pactId,
          sessionId: session.sessionId,
          photoUrl,
        });
        setSession(null);
        const after = await refresh();
        if (after.viewer) say(outlookLine(after.viewer.outlook));
      } else {
        const { sessionId } = await openSession({
          pactId: view.pactId,
          userWallet: viewerWallet,
          photoUrl,
        });
        setElapsed(0);
        setSession({ sessionId, startedAt: channelNow().getTime() });
        await refresh();
      }
    } catch (e) {
      if (e instanceof ChannelError) {
        // The refusal. The session stays open and the bot says how much longer.
        say(e.message);
      } else {
        /**
         * Anything else is a bug, not a refusal -- but rethrowing put it in an
         * unhandled rejection, because this is awaited by CheckInCamera inside
         * a try/finally with no catch. The member watched the button un-busy
         * and got no sentence, which is exactly what "the check-in button does
         * nothing" looked like from the outside.
         *
         * The console keeps the real error for whoever is looking; the member
         * gets told something happened either way.
         */
        console.error("[check-in] unexpected failure", e);
        say("Something went wrong there. Try that again.");
      }
    }
    scrollToFoot();
  }

  async function react(itemId: string, emoji: string) {
    if (itemId.startsWith(REPLY_PREFIX)) {
      setReplies((rows) =>
        rows.map((row) => (row.id === itemId ? withReactionToggled(row, emoji) : row)),
      );
      return;
    }
    // Shown at once, then written. The same pure toggle runs on both sides, so
    // the optimistic row and the stored one cannot disagree.
    setItems((rows) => rows.map((row) => (row.id === itemId ? withReactionToggled(row, emoji) : row)));

    const stuck = await attempt(
      () => toggleReaction(view.pactId, itemId, emoji),
      "That reaction did not stick. Try again.",
    );

    // The toggle is its own inverse, so undoing it is applying it again. Left
    // alone the optimistic row simply vanished at the next five-second
    // refresh, with nothing said -- the two sides disagreeing quietly, which
    // is the one thing the comment above promises cannot happen.
    if (!stuck) {
      setItems((rows) => rows.map((row) => (row.id === itemId ? withReactionToggled(row, emoji) : row)));
    }
  }

  /**
   * Run a channel mutation and say whatever it refuses with.
   *
   * lib/channel-client.ts goes to real trouble to guarantee that every failure
   * leaves it as a ChannelError carrying a sentence somebody wrote for this
   * moment -- the server's own guard, "Your sign-in expired", "No connection".
   * Three of its four callers then dropped the promise on the floor.
   * CommandInput, ExemptionVote and Feed all take `() => void` handlers, so a
   * rejection went nowhere at all: React error boundaries do not catch
   * rejected promises and this app registers no `unhandledrejection` listener.
   *
   * What that looked like from a chair: type `/exempt broke my ankle`, watch
   * the field clear, and read nothing. The refusal existed the whole time.
   */
  async function attempt(work: () => Promise<unknown>, whenBroken: string): Promise<boolean> {
    try {
      await work();
      return true;
    } catch (e) {
      if (e instanceof ChannelError) {
        say(e.message);
      } else {
        console.error("[channel] unexpected failure", e);
        say(whenBroken);
      }
      return false;
    }
  }

  async function run(command: string) {
    const [name, ...rest] = command.split(/\s+/);
    const argument = rest.join(" ").trim();

    switch (name.toLowerCase()) {
      case "help":
        say(helpReply());
        break;
      case "status":
        // The week is not the answer to "where am I" when the week has not
        // begun. Whoever has not staked yet is.
        say(
          view.funding
            ? fundingReply(view.funding.staked, view.funding.of)
            : statusReply(view.bot),
        );
        break;
      case "crew":
        say(crewReply(view.bot));
        break;
      case "stake":
        say(stakeReply(view.bot));
        break;
      case "settle": {
        // The parse is in lib/bot.ts and not inlined here, because it is the
        // only thing standing between a mistyped command and a pact settled a
        // week early. Anything it does not recognise is corrected rather than
        // treated as a plain /settle.
        const settling = parseSettle(argument);
        if (!settling) {
          say(settleUnknownArgumentReply(argument));
          break;
        }
        void settle(settling.force);
        break;
      }
      case "invite":
        setQrOpen(true);
        say(inviteReply());
        break;
      case "exempt":
        if (argument.length === 0) {
          say(exemptNeedsReasonReply());
          break;
        }
        if (
          await attempt(
            () =>
              requestExemption({
                pactId: view.pactId,
                userWallet: viewerWallet,
                periodKey: view.periodKey,
                reason: argument,
              }),
            "That did not reach the crew. Try again.",
          )
        ) {
          await refresh();
        }
        break;
      // `challenge_photo` is accepted because it is what the mechanism gets
      // called out loud; `challenge` is what /help lists, so the field's own
      // completion teaches the shorter one.
      case "challenge":
      case "challenge_photo":
        openChallenge(argument);
        break;
      default:
        say(unknownCommandReply(name.toLowerCase()));
    }
    scrollToFoot();
  }

  /**
   * Closes the period. Safe to run twice -- who failed comes out of the
   * sessions, not out of who typed it, and the settlement row is the mutex.
   *
   * `force` closes a period that has not ended yet, which marks everyone who
   * has not finished by now as having missed and cannot be taken back. It is
   * said out loud before the request rather than after it, so the member reads
   * what it does while it is still doing it.
   */
  async function settle(force: boolean) {
    say(force ? settlingForcedLine() : settlingLine());
    try {
      /**
       * The bearer, and the last call in the app that was without one.
       *
       * lib/channel-client.ts and lib/upload.ts were both fixed for exactly
       * this: the privy-token cookie carries an access token with an expiry,
       * and once it ages out every route answers 401. The client SDK holds a
       * fresh token the whole time and nothing here was asking for it -- so a
       * pact left open long enough could not be settled, which is the one
       * action in this product that moves the money.
       */
      const token = await getAccessToken().catch(() => null);
      const res = await fetch(`/api/pacts/${view.pactId}/settle`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ force }),
        // Generous: a settlement is several transfers, each confirmed. Long
        // enough not to abandon a real one, bounded so it cannot hang for good.
        signal: AbortSignal.timeout(180_000),
      });
      const body = await res.json().catch(() => ({}));

      /**
       * 202 is `res.ok`, and it is not a settlement.
       *
       * The route answers it when a payout has already been broadcast and the
       * run aborted part-way -- the pact half settled, some members written
       * and some not, and a signature in the body for reconciling. Falling
       * through to the success branch read `failedCount` off a body that has
       * none, so `failed` defaulted to 0, and settledLine's first branch
       * announced "Everyone made it. Nobody paid a thing." to a crew whose
       * week had just come apart mid-payout.
       *
       * components/StakeSheet.tsx has checked for this since it was written.
       * This call site is the one that did not.
       */
      if (res.status === 202) {
        say(
          settleFailedLine(
            typeof body.error === "string"
              ? body.error
              : "A payout is in flight. Run it again to pick up where it stopped.",
          ),
        );
        await refresh();
        return;
      }

      if (!res.ok) {
        say(settleFailedLine(typeof body.error === "string" ? body.error : "Try again."));
        return;
      }
      // `failedCount` for the misses, `payouts.length` for the winners --
      // payouts *are* the winners, which is why counting them as misses
      // announced three in a crew of four where one missed. The winner count
      // is what stops the bot promising a payout when there is nobody to pay.
      say(
        settledLine({
          failed: body.failedCount ?? 0,
          winners: body.payouts?.length ?? 0,
          potUsdc: body.potUsdc ?? "0",
        }),
      );
      await refresh();
    } catch (e) {
      /**
       * A timeout is not a failed settlement, and must not be reported as one.
       *
       * By this point payouts may already be broadcast -- which is the whole
       * reason the route answers 202 and the branch above refuses to call that
       * a clean week. "Could not reach the settlement" invites running it
       * again, and StakeSheet argues the same thing about the stake it sends.
       */
      console.error("settle failed:", e);
      say(
        settleFailedLine(
          isTimeout(e)
            ? "We lost the connection before this finished. Check the pact before running it again."
            : "Could not reach the settlement.",
        ),
      );
    }
    scrollToFoot();
  }

  /**
   * `/challenge <member>` — puts one member's latest photo to the rest of the
   * crew. Every refusal is a sentence the member can act on, and none of them
   * opens a poll: an accusation that half-happened is worse than one that did
   * not, because the crew still sees the name.
   */
  function openChallenge(argument: string) {
    const crew = view.crew.map((m) => m.firstName);
    const typed = argument.trim();

    if (typed.length === 0) {
      say(challengeNeedsMemberReply(crew.filter((n) => n !== view.viewer?.firstName)));
      return;
    }
    if (challenge && challenge.stage === "open") {
      say(challengeAlreadyOpenReply(challenge.accusedName));
      return;
    }

    const target = view.crew.find(
      (m) =>
        m.firstName.toLowerCase() === typed.toLowerCase() ||
        m.displayName.toLowerCase() === typed.toLowerCase(),
    );
    if (!target) {
      say(challengeUnknownMemberReply(typed, crew));
      return;
    }
    if (target.isViewer) {
      say(challengeSelfReply());
      return;
    }

    // Everyone staked except the accused has a say; a simple majority carries
    // it. The same arithmetic lib/challenge-photo.ts does over real rows.
    const eligible = Math.max(1, view.crew.length - 1);
    const needed = Math.floor(eligible / 2) + 1;

    setChallenge({
      accusedName: target.firstName,
      challengerName: view.viewer?.firstName ?? "You",
      subject: "The last check-in photo.",
      // The most recent photo in the transcript is the one being argued about.
      photoUrl: items.filter((i) => i.photoUrl).at(-1)?.photoUrl ?? null,
      stage: "open",
      against: 0,
      forPhoto: 0,
      needed,
      eligible,
      voted: false,
      accusedIsViewer: false,
    });
    say(challengeOpenedLine(view.viewer?.firstName ?? "You", target.firstName));
  }

  /** One vote each, and the verdict is announced the moment it closes. */
  function voteChallenge(against: boolean) {
    setChallenge((current) => {
      if (!current || current.stage !== "open" || current.voted) return current;

      const nextAgainst = current.against + (against ? 1 : 0);
      const nextFor = current.forPhoto + (against ? 0 : 1);
      const stage: ChallengeStage =
        nextAgainst >= current.needed
          ? "upheld"
          : nextFor >= current.needed
            ? "dismissed"
            : "open";

      if (stage !== "open") {
        say(
          challengeVerdictLine({
            accused: current.accusedName,
            upheld: stage === "upheld",
            against: nextAgainst,
            eligible: current.eligible,
          }),
        );
      }
      return { ...current, against: nextAgainst, forPhoto: nextFor, stage, voted: true };
    });
    scrollToFoot();
  }

  /** The accused sends it to a person. Nothing settles until they answer. */
  function appealChallenge() {
    setChallenge((current) => (current ? { ...current, stage: "appealed" } : current));
    if (challenge) say(appealFiledLine(challenge.accusedName));
    scrollToFoot();
  }

  async function vote(approve: boolean) {
    const exemption = view.exemption;
    if (!exemption) return;
    if (
      await attempt(
        () =>
          castVote({
            pactId: view.pactId,
            exemptionId: exemption.id,
            userWallet: viewerWallet,
            approve,
          }),
        "That vote did not reach the crew. Try again.",
      )
    ) {
      await refresh();
    }
    scrollToFoot();
  }

  const me = view.viewer;
  // Whichever side of the session is next is the one the reference belongs to:
  // the check-in shot before a session exists, the check-out shot to close one
  // already open. Both are optional -- every pact from before this existed has
  // neither, and the block below renders nothing rather than an empty pill.
  const referenceUrl = session ? view.rule.checkOutReferenceUrl : view.rule.checkInReferenceUrl;
  const referenceDescription = view.rule.proofDescription;

  return (
    <>
      {/* Identity, standing and the code, once the head is gone. It carries a
          negative margin equal to its height so it never occupies a row of its
          own: pinning it must not move the page under the reader. */}
      <div
        className={cn(
          "sticky top-[var(--app-header-h)] z-20 -mb-13 h-13 border-b bg-ground transition-[opacity,transform,border-color] duration-300",
          pinned
            ? "translate-y-0 border-hairline opacity-100"
            : "pointer-events-none -translate-y-1.5 border-transparent opacity-0",
        )}
        aria-hidden={!pinned}
      >
        <div className="mx-auto flex h-full w-full max-w-[46rem] items-center gap-3 px-5 sm:px-8">
          <p className="min-w-0 flex-1 truncate text-[14px] font-bold tracking-[-0.015em] text-ink">
            {view.name}
            {me && !view.funding && (
              <span className="figure ml-2 font-normal text-grey-on-ground">
                {me.daysDone} of {me.required}
              </span>
            )}
          </p>
          <button
            type="button"
            onClick={() => setQrOpen(true)}
            aria-label="Show the invite code"
            tabIndex={pinned ? 0 : -1}
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-full border border-hairline text-ink transition-colors hover:border-ink/40"
          >
            <QrCode className="size-4.5" aria-hidden="true" strokeWidth={1.75} />
          </button>
        </div>
      </div>

      <div className="mx-auto w-full max-w-[46rem] px-5 sm:px-8">
        <div className="pt-7 sm:pt-9">
          <Link
            href="/groups"
            className="inline-flex items-center gap-1.5 rounded-sm text-[13px] text-grey-on-ground transition-colors hover:text-ink"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            Groups
          </Link>

          <div className="mt-5 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-[clamp(1.75rem,6vw,2.5rem)] leading-[1.05] font-extrabold tracking-[-0.035em] text-ink">
                {view.name}
              </h1>
              <p className="mt-2.5 text-[15px] text-grey-on-ground">{view.ruleSentence}</p>
            </div>

            <button
              type="button"
              onClick={() => setQrOpen(true)}
              className="inline-flex h-10 shrink-0 items-center gap-2 rounded-full border border-hairline bg-panel pr-4 pl-3.5 text-[14px] font-semibold text-ink transition-colors hover:border-ink/40"
            >
              <QrCode className="size-4" aria-hidden="true" strokeWidth={1.75} />
              Invite
            </button>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-3">
            <AvatarGroup>
              {view.crew.map((member) => (
                <Avatar key={member.memberId} className="size-9">
                  <AvatarFallback className="bg-surface text-[12px] font-semibold tracking-[0.02em] text-grey-on-surface">
                    {member.initials}
                  </AvatarFallback>
                </Avatar>
              ))}
            </AvatarGroup>
            <span className="figure text-[13px] text-grey-on-ground">
              {view.stake} each · {view.pot} on the week · settles {view.settlesOn}
            </span>
          </div>

          {/* The money is in an account with an address, and the address is
              public. Saying so here, next to the figures it belongs to, is the
              cheapest honest answer to "where has my money gone" -- and the
              only one that does not require taking our word for it. No copy
              button: nobody sends here by hand, the stake flow does, so the
              link is the whole affordance. */}
          <p className="mt-3 text-[13px] leading-relaxed text-grey-on-ground">
            Every stake sits in the crew&rsquo;s vault until it settles.{" "}
            <a
              href={`https://solscan.io/account/${view.vaultAddress}`}
              target="_blank"
              rel="noopener noreferrer"
              className="figure rounded-sm text-ink underline decoration-hairline underline-offset-4 transition-colors hover:decoration-ink"
            >
              {`${view.vaultAddress.slice(0, 4)}…${view.vaultAddress.slice(-4)}`}
            </a>
          </p>

          {/* The most important fact on a pact that has not started, and the
              one the screen used to omit entirely. A crew runs only once
              everybody has staked -- lib/stake.ts is explicit that nobody
              should be exposed to a rule the rest have not paid for -- so
              until then the week below is a week nobody is being judged on.
              The member who has paid deserves to know what they are waiting
              for; the one who has not deserves to know they are the hold-up. */}
          {view.funding && (
            <p className="mt-7 max-w-[40ch] text-[15px] leading-relaxed text-ink">
              <span className="figure font-semibold">
                {view.funding.staked} of {view.funding.of}
              </span>{" "}
              staked. It starts when everyone has
              {view.funding.staked === view.funding.of ? " arrived" : ""}.
            </p>
          )}

          {/* A standing in a period that has not started. `startsAt` is null
              until everybody has staked, so this counted down a week nobody was
              in and marked seven days "nothing recorded" against a rule not yet
              running -- directly under a line saying it had not started. While
              the crew is still paying, the waiting line above is the whole of
              what there is to say. */}
          {me && !view.funding && (
            <div className="mt-9">
              <p className="figure text-[2.75rem] leading-[0.95] font-extrabold text-ink">
                {me.daysDone}
                <span className="text-grey-on-ground"> of {me.required}</span>
              </p>
              <p className="mt-2.5 text-[14px] text-grey-on-ground">{outlookLine(me.outlook)}</p>
              <DayMarkers days={me.marks} className="mt-7" />
            </div>
          )}
        </div>

        <div ref={headEnd} className="mt-10 h-px w-full bg-hairline" />

        <div className="pt-2 pb-8">
          <Feed items={shown} onReact={react} />

          {view.exemption && (
            <div className="mt-7">
              <ExemptionVote
                requesterName={view.exemption.requesterName}
                reason={view.exemption.reason}
                approvals={view.exemption.approvals}
                needed={view.exemption.needed}
                canVote={view.exemption.canVote}
                onVote={vote}
              />
            </div>
          )}

          {challenge && (
            <div className="mt-7">
              <PhotoChallenge
                accusedName={challenge.accusedName}
                challengerName={challenge.challengerName}
                subject={challenge.subject}
                photoUrl={challenge.photoUrl}
                stage={challenge.stage}
                against={challenge.against}
                forPhoto={challenge.forPhoto}
                needed={challenge.needed}
                eligible={challenge.eligible}
                canVote={!challenge.voted}
                canAppeal={challenge.stage === "upheld" && challenge.accusedIsViewer}
                onVote={voteChallenge}
                onAppeal={appealChallenge}
              />
            </div>
          )}

          <div ref={foot} className="h-px" />
        </div>

        {/* The composer: a camera and a slash command. There is no third thing.
            It sits on its own band of ground rather than floating over the
            transcript — a sentence half-legible behind a control is worse than
            no sentence, and the bottom of this screen is where the money lives.
            The band runs to the foot of the viewport so the nav's pill has
            something to sit on too, and its negative bottom margin takes back
            the 7rem the app shell reserves for that pill — the band is already
            reserving it. */}
        {/* Above BottomNav, which is fixed at z-40 with a pointer-events-auto
            pill 240px wide and centred. At this width that pill lands over the
            Check in button, and a tap on it hit the nav instead -- no picker,
            no error, nothing. The composer is the thing being used; it wins. */}
        <div className="sticky bottom-0 z-50 -mx-5 -mb-28 sm:-mx-8">
          <div
            aria-hidden="true"
            className="pointer-events-none h-10"
            style={{ backgroundImage: "linear-gradient(to bottom, transparent, var(--ground))" }}
          />
          <div className="bg-ground px-5 pb-[calc(7rem+env(safe-area-inset-bottom))] sm:px-8">
            {session && (
              <p className="figure mx-auto mb-2 w-fit rounded-full border border-hairline bg-panel px-4 py-1.5 text-[12px] text-grey-on-ground shadow-panel">
                <span className="font-semibold text-ink">Checked in.</span> {elapsed}{" "}
                {elapsed === 1 ? "minute" : "minutes"} so far
              </p>
            )}
            {/* Before the stake there is nothing to check in to, so the
                composer is replaced rather than disabled: a camera you may not
                use is a worse answer than the one thing you can do. */}
            {needsStake ? (
              <StakeSheet
                pactId={view.pactId}
                stakeLabel={view.stake}
                viewerWallet={viewerWallet}
              />
            ) : (
              <>
                {/* What a good one looks like, above the control that takes it --
                    state first, then the instruction, then the camera it instructs.
                    Short instructions stay a tight pill like the status line above;
                    a full 280-character one runs out of room to stay short and wraps
                    across the same width as the composer below it. */}
                {(referenceUrl || referenceDescription) && (
                  <div
                    className={cn(
                      "mx-auto mb-2 flex w-fit items-center gap-2.5 rounded-full border border-hairline bg-panel py-1.5 shadow-panel",
                      // Snug against the thumbnail on one side and roomy for text on
                      // the other -- without a thumbnail there's nothing to sit snug
                      // against, so it falls back to the status pill's even padding.
                      referenceUrl ? "pl-1.5 pr-4" : "px-4",
                    )}
                  >
                    {referenceUrl && (
                      <img
                        src={referenceUrl}
                        alt="What the creator said a good one looks like"
                        className="size-9 shrink-0 rounded-full object-cover"
                      />
                    )}
                    {referenceDescription && (
                      <p className="text-[13px] leading-snug text-grey-on-ground">
                        {referenceDescription}
                      </p>
                    )}
                  </div>
                )}
                <div className="flex items-center gap-2 rounded-full border border-hairline bg-panel p-1.5 shadow-panel">
                  {/* Nothing to check into yet. A session recorded against a
                      pact that has not started counts towards a period nobody
                      is being judged on, and offering the button says the
                      opposite of what the line above it says. The commands
                      stay -- /invite is exactly what this member needs. */}
                  {!view.funding && (
                    <CheckInCamera label={session ? "Check out" : "Check in"} onCapture={capture} />
                  )}
                  <div className="min-w-0 flex-1">
                    <CommandInput onSubmit={run} />
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        <InviteQr
          pactName={view.name}
          inviteToken={view.inviteToken}
          open={qrOpen}
          onClose={() => setQrOpen(false)}
        />
      </div>
    </>
  );
}
