"use client";

import { useState } from "react";
import { Smile } from "lucide-react";
import type { FeedItemDto } from "@/app/api/pacts/[id]/feed/route";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

/* ---------------------------------------------------------------------------
 * The channel.
 *
 * A bot channel, not a chat: the only things in it are the bot's running
 * commentary and members' photo check-ins. There is no composer here and there
 * never will be — see PRODUCT.md's "no free-text chat", which this component
 * exists to honour rather than to work around.
 *
 * It takes the feed in the order `GET /api/pacts/[id]/feed` returns it, newest
 * first, and turns it the right way up: a channel reads downwards and the
 * newest thing sits at the bottom.
 *
 * Rows are uniform by design — a mark, a sentence, a time. The mark is a square
 * for the bot and a circle for a person, which is the whole of the distinction
 * a reader needs at a glance. The body already names whoever acted ("Nat
 * checked in."), so the row never names them twice.
 * ------------------------------------------------------------------------- */

const QUICK = ["💪", "🔥", "👏", "😂"];

/** Prisma `FeedItemType`s a member posted. Everything else is the bot talking. */
const MEMBER_TYPES = new Set(["checkin", "checkout", "exemption_request"]);

/**
 * Two letters, from a full name or from a single one — the same pair the crew
 * table and the header draw, so one person is not "DW" in one place and "D" in
 * another. `FeedItemDto` carries a name and no initials, which is the API's
 * shape and not something to widen for a fallback.
 */
function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const letters =
    parts.length > 1 ? `${parts[0][0]}${parts[parts.length - 1][0]}` : parts[0].slice(0, 2);
  return letters.toUpperCase();
}

/**
 * The bot's mark: the full stop from the wordmark, in a filled square. Square,
 * because every avatar in the product is a circle and the reader should never
 * have to work out whether a line came from a person.
 */
function BotMark() {
  return (
    <span
      aria-hidden="true"
      className="flex size-9 shrink-0 items-center justify-center rounded-[11px] bg-ink"
    >
      <span className="size-[5px] rounded-full bg-ground" />
    </span>
  );
}

function dayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "short",
  });
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function Feed({
  items,
  onReact,
}: {
  items: FeedItemDto[];
  onReact: (itemId: string, emoji: string) => void;
}) {
  const [picking, setPicking] = useState<string | null>(null);

  // Newest last. `items` arrives newest first, straight from the route.
  const rows = [...items].reverse();

  return (
    <ol className="flex flex-col">
      {rows.map((item, i) => {
        const previous = rows[i - 1];
        const fromMember = MEMBER_TYPES.has(item.type) && item.authorName !== null;
        const newDay = !previous || dayLabel(previous.createdAt) !== dayLabel(item.createdAt);

        // Consecutive lines from the same voice within a quarter of an hour read
        // as one turn, so only the first of them carries a mark.
        const sameVoice =
          !newDay &&
          previous !== undefined &&
          previous.authorName === item.authorName &&
          MEMBER_TYPES.has(previous.type) === fromMember &&
          new Date(item.createdAt).getTime() - new Date(previous.createdAt).getTime() < 900_000;

        return (
          <li key={item.id}>
            {newDay && (
              <div className={cn("flex items-center gap-3 pb-5", i === 0 ? "pt-1" : "pt-8")}>
                <span className="h-px flex-1 bg-hairline" />
                <span className="text-[11px] font-medium tracking-[0.12em] text-grey-on-ground uppercase">
                  {/* Server and browser can sit in different zones; the browser's
                      reading is the true one. */}
                  <span suppressHydrationWarning>{dayLabel(item.createdAt)}</span>
                </span>
                <span className="h-px flex-1 bg-hairline" />
              </div>
            )}

            <div
              className={cn(
                "group relative grid grid-cols-[2.25rem_minmax(0,1fr)] gap-x-3.5 rounded-2xl px-2 py-1.5 transition-colors hover:bg-surface/70 sm:-mx-2",
                sameVoice ? "mt-0.5" : newDay || i === 0 ? "mt-0" : "mt-3",
              )}
            >
              {sameVoice ? (
                <span aria-hidden="true" />
              ) : fromMember ? (
                <Avatar className="size-9">
                  <AvatarFallback className="bg-surface text-[12px] font-semibold tracking-[0.02em] text-grey-on-surface">
                    {initialsFor(item.authorName!)}
                  </AvatarFallback>
                </Avatar>
              ) : (
                <BotMark />
              )}

              <div className="min-w-0 pt-[0.35rem]">
                <p className="text-[15px] leading-[1.55] whitespace-pre-line text-ink">
                  {item.body}
                  <time
                    dateTime={item.createdAt}
                    suppressHydrationWarning
                    className="figure ml-2 align-baseline text-[11px] whitespace-nowrap text-grey-on-ground tabular-nums"
                  >
                    {timeLabel(item.createdAt)}
                  </time>
                </p>

                {item.photoUrl && (
                  /* eslint-disable-next-line @next/next/no-img-element --
                     a check-in taken this second is a blob: URL from the camera,
                     which next/image cannot optimise or even resolve. */
                  <img
                    src={item.photoUrl}
                    alt={
                      item.authorName
                        ? `Photo posted by ${item.authorName}`
                        : "Photo posted to the channel"
                    }
                    className="mt-2.5 aspect-[4/5] w-full max-w-[15rem] rounded-[18px] border border-hairline object-cover"
                  />
                )}

                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {item.reactions.map((r) => (
                    <button
                      key={r.emoji}
                      type="button"
                      onClick={() => onReact(item.id, r.emoji)}
                      aria-pressed={r.mine}
                      className={cn(
                        "figure inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[12px] transition-colors",
                        r.mine
                          ? "border-ink bg-ink text-ground"
                          : "border-hairline bg-panel text-grey-on-ground hover:border-ink/40",
                      )}
                    >
                      <span aria-hidden="true">{r.emoji}</span>
                      {r.count}
                      <span className="sr-only">
                        {r.mine ? "Remove your reaction" : "React"} {r.emoji}
                      </span>
                    </button>
                  ))}

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      aria-label={picking === item.id ? "Close reactions" : "Add a reaction"}
                      aria-expanded={picking === item.id}
                      onClick={() => setPicking(picking === item.id ? null : item.id)}
                      className={cn(
                        "inline-flex size-7 items-center justify-center rounded-full border border-hairline text-grey-on-ground transition-[opacity,color,border-color] hover:border-ink/40 hover:text-ink focus-visible:opacity-100",
                        picking === item.id
                          ? "border-ink/40 text-ink opacity-100"
                          : "opacity-60 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100",
                      )}
                    >
                      <Smile className="size-3.5" aria-hidden="true" strokeWidth={1.75} />
                    </button>

                    {picking === item.id &&
                      QUICK.filter((e) => !item.reactions.some((r) => r.emoji === e)).map((e) => (
                        <button
                          key={e}
                          type="button"
                          onClick={() => {
                            onReact(item.id, e);
                            setPicking(null);
                          }}
                          className="inline-flex size-7 items-center justify-center rounded-full border border-hairline bg-panel text-[13px] transition-colors hover:border-ink/40"
                        >
                          <span aria-hidden="true">{e}</span>
                          <span className="sr-only">React {e}</span>
                        </button>
                      ))}
                  </div>
                </div>
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
