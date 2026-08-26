"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, QrCode } from "lucide-react";
import type { FeedItemDto } from "@/app/api/pacts/[id]/feed/route";
import { CheckInCamera } from "@/components/CheckInCamera";
import { CommandInput } from "@/components/CommandInput";
import { DayMarkers } from "@/components/DayMarkers";
import { ExemptionVote } from "@/components/ExemptionVote";
import { Feed } from "@/components/Feed";
import { InviteQr } from "@/components/InviteQr";
import { StakeSheet } from "@/components/StakeSheet";
import { Avatar, AvatarFallback, AvatarGroup } from "@/components/ui/avatar";
import {
  cadenceMetLine,
  crewReply,
  exemptNeedsReasonReply,
  helpReply,
  inviteReply,
  outOfReachVerdict,
  outlookLine,
  stakeReply,
  statusReply,
  unknownCommandReply,
} from "@/lib/bot";
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
//   getChannel       -> GET  /api/pacts/[id]/feed?viewer=<wallet>
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
}: {
  view: ChannelView;
  items: FeedItemDto[];
  viewerWallet: string;
  /** Opens the code straight away -- the beat after a crew is created. */
  showInvite?: boolean;
  /** The viewer has joined but not paid. Nothing else is theirs to do yet. */
  needsStake?: boolean;
}) {
  const [view, setView] = useState(initialView);
  const [items, setItems] = useState(initialItems);
  const [replies, setReplies] = useState<FeedItemDto[]>([]);
  const [session, setSession] = useState<{ sessionId: string; startedAt: number } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [qrOpen, setQrOpen] = useState(showInvite);
  const [pinned, setPinned] = useState(false);

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
    requestAnimationFrame(() => foot.current?.scrollIntoView({ behavior: "smooth", block: "end" }));
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
    // MOCK: a real check-in uploads to blob storage first and posts the URL it
    // gets back. An object URL is the same string in the same field.
    const photoUrl = URL.createObjectURL(file);

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
        throw e;
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
    await toggleReaction(view.pactId, itemId, emoji, viewerWallet);
  }

  async function run(command: string) {
    const [name, ...rest] = command.split(/\s+/);
    const argument = rest.join(" ").trim();

    switch (name.toLowerCase()) {
      case "help":
        say(helpReply());
        break;
      case "status":
        say(statusReply(view.bot));
        break;
      case "crew":
        say(crewReply(view.bot));
        break;
      case "stake":
        say(stakeReply(view.bot));
        break;
      case "invite":
        setQrOpen(true);
        say(inviteReply());
        break;
      case "exempt":
        if (argument.length === 0) {
          say(exemptNeedsReasonReply());
          break;
        }
        await requestExemption({
          pactId: view.pactId,
          userWallet: viewerWallet,
          periodKey: view.periodKey,
          reason: argument,
        });
        await refresh();
        break;
      default:
        say(unknownCommandReply(name.toLowerCase()));
    }
    scrollToFoot();
  }

  async function vote(approve: boolean) {
    const exemption = view.exemption;
    if (!exemption) return;
    await castVote({
      pactId: view.pactId,
      exemptionId: exemption.id,
      userWallet: viewerWallet,
      approve,
    });
    await refresh();
    scrollToFoot();
  }

  const me = view.viewer;

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
            {me && (
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

          {me && (
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
        <div className="sticky bottom-0 z-20 -mx-5 -mb-28 sm:-mx-8">
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
              <StakeSheet pactId={view.pactId} stakeLabel={view.stake} />
            ) : (
              <div className="flex items-center gap-2 rounded-full border border-hairline bg-panel p-1.5 shadow-panel">
                <CheckInCamera label={session ? "Check out" : "Check in"} onCapture={capture} />
                <div className="min-w-0 flex-1">
                  <CommandInput onSubmit={run} />
                </div>
              </div>
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
