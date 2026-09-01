"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity,
  Apple,
  BookOpen,
  ChevronRight,
  Dumbbell,
  Footprints,
  Moon,
  Swords,
  type LucideIcon,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarGroup } from "@/components/ui/avatar";
import { DashedRule, Panel } from "@/components/Panel";
import {
  CATEGORIES,
  activeCount,
  categoryLabel,
  communityPot,
  coverFor,
  filterByCategory,
  type Community,
  type CommunityCategory,
} from "@/lib/communities";
import { formatMoney } from "@/lib/money";
import { spell } from "@/lib/pact-view";
import { cn } from "@/lib/utils";

/* ---------------------------------------------------------------------------
 * The shelf.
 *
 * Every crew in this product is reached with a QR code somebody hands you, and
 * that stays true — this browses rules that have already agreed to be found. It
 * is a directory, not a feed: nothing here is ranked, promoted or scored, and
 * the order is the order the file lists them in.
 *
 * Drawn in the group row's own shapes (app/(app)/groups/page.tsx), because a
 * community someone has not joined and a crew they are in should not look like
 * two different products.
 * ------------------------------------------------------------------------- */

/** One icon per category. The only place the two are married. */
const ICONS: Record<CommunityCategory, LucideIcon> = {
  gym: Dumbbell,
  running: Footprints,
  "martial-arts": Swords,
  pilates: Activity,
  sleep: Moon,
  nutrition: Apple,
  study: BookOpen,
};

/** The filter row. `null` is everything, and it is where the page opens. */
function CategoryFilter({
  active,
  onPick,
}: {
  active: CommunityCategory | null;
  onPick: (category: CommunityCategory | null) => void;
}) {
  const pill =
    "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-4 text-[13px] font-semibold transition-colors";

  return (
    // Scrolls sideways on a phone rather than wrapping to a second row: a
    // filter that changes height when you tap it moves the grid under the
    // thumb that tapped it.
    <div
      role="group"
      aria-label="Filter by category"
      className="-mx-5 mt-8 flex gap-2 overflow-x-auto px-5 pb-1 sm:-mx-8 sm:px-8 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      <button
        type="button"
        aria-pressed={active === null}
        onClick={() => onPick(null)}
        className={cn(
          pill,
          active === null
            ? "bg-ink text-ground"
            : "border border-hairline bg-panel text-ink hover:border-ink/40",
        )}
      >
        Everything
      </button>

      {CATEGORIES.map(({ key, label }) => {
        const Icon = ICONS[key];
        const on = active === key;
        return (
          <button
            key={key}
            type="button"
            data-category={key}
            aria-pressed={on}
            onClick={() => onPick(on ? null : key)}
            // Selected, the pill takes its own category's colour; unselected it
            // stays a hairline like everything else. The colour marks the one
            // that is on rather than decorating all seven at once.
            style={
              on
                ? { backgroundColor: "var(--cat-bg)", color: "var(--cat-fg)" }
                : undefined
            }
            className={cn(
              pill,
              on ? "font-semibold" : "border border-hairline bg-panel text-ink hover:border-ink/40",
            )}
          >
            <Icon className="size-3.5" aria-hidden="true" strokeWidth={2} />
            {label}
          </button>
        );
      })}
    </div>
  );
}

/** Name, what it is, who is in it, and what is riding on it — in that order. */
function CommunityRow({ community }: { community: Community }) {
  const Icon = ICONS[community.category];
  const open = community.challenges.filter((c) => c.status === "open").length;

  return (
    <li>
      <Link
        href={`/communities/${community.slug}`}
        className="group relative block overflow-hidden rounded-[22px] border border-hairline bg-panel shadow-panel transition-[border-color,box-shadow] duration-200 hover:border-ink/30 hover:shadow-panel-hover"
      >
        {/* Full-bleed to the card's own radius. The picture is what makes a
            directory scannable at arm's length; everything under it is the
            record, and stays monochrome. */}
        <div className="relative h-32 w-full overflow-hidden bg-surface sm:h-36">
          {/* eslint-disable-next-line @next/next/no-img-element -- a local
              file under public/, already sized; next/image would add a loader
              round-trip for a fixed-dimension asset. */}
          <img
            src={coverFor(community)}
            alt=""
            loading="lazy"
            className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
          />
        </div>

        <div className="p-6">
        <ChevronRight
          className="absolute top-[10.5rem] right-6 size-5 text-grey-on-ground transition-transform duration-200 group-hover:translate-x-0.5 sm:top-[11.5rem]"
          aria-hidden="true"
        />

        <div data-category={community.category} className="flex items-start gap-3.5 pr-9">
          <span
            aria-hidden="true"
            style={{ backgroundColor: "var(--cat-bg)", color: "var(--cat-fg)" }}
            className="mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-full"
          >
            <Icon className="size-4.5" strokeWidth={1.75} />
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-[17px] font-bold tracking-[-0.02em] text-ink">
              {community.name}
            </h2>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-grey-on-ground">
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

        <p className="mt-4 max-w-[46ch] text-[14px] leading-relaxed text-grey-on-ground">
          {community.blurb}
        </p>

        <DashedRule className="mt-5" />

        <div className="mt-5 flex items-end justify-between gap-6">
          <div className="flex items-end gap-7">
            <div>
              <p className="figure text-[15px] font-semibold text-ink">{community.members}</p>
              <p className="mt-0.5 text-[13px] text-grey-on-ground">members</p>
            </div>
            <div>
              <p className="figure text-[15px] font-semibold text-ink">
                {activeCount(community)}
              </p>
              <p className="mt-0.5 text-[13px] text-grey-on-ground">
                {/* "Two open" is the only number a stranger can act on. A
                    community with none is running, not empty, and says so. */}
                {open > 0 ? `running · ${open} open` : "running"}
              </p>
            </div>
          </div>

          <div className="flex items-end gap-5">
            <AvatarGroup className="hidden shrink-0 sm:flex">
              {community.crew.map((initials) => (
                <Avatar key={initials} className="size-8">
                  <AvatarFallback className="bg-surface text-[11px] font-semibold tracking-[0.02em] text-grey-on-surface">
                    {initials}
                  </AvatarFallback>
                </Avatar>
              ))}
            </AvatarGroup>

            <div className="text-right">
              <p className="figure text-[15px] font-semibold text-ink">
                {formatMoney(communityPot(community), community.currency)}
              </p>
              <p className="mt-0.5 text-[13px] text-grey-on-ground">at stake</p>
            </div>
          </div>
        </div>
        </div>
      </Link>
    </li>
  );
}

export function CommunityBrowser({ communities }: { communities: Community[] }) {
  const [category, setCategory] = useState<CommunityCategory | null>(null);
  const shown = useMemo(() => filterByCategory(communities, category), [communities, category]);

  return (
    <div className="mx-auto w-full max-w-[54rem] px-5 pt-10 sm:px-8 sm:pt-14">
      <h1 className="text-[clamp(2rem,7vw,3rem)] leading-[1.03] font-extrabold tracking-[-0.035em] text-ink">
        {spell(communities.length)} communities.
      </h1>
      <p className="mt-4 max-w-[42ch] text-[15px] leading-relaxed text-grey-on-ground">
        Rules already running, open to anyone who will put money on them. You are staking against
        the people in them, not against the house.
      </p>

      <CategoryFilter active={category} onPick={setCategory} />

      {shown.length === 0 ? (
        <Panel className="mt-8">
          <p className="text-[15px] text-ink">Nothing here yet.</p>
          <p className="mt-2 max-w-[46ch] text-[14px] leading-relaxed text-grey-on-ground">
            No community has agreed a rule in this category. Starting one is the same three
            screens as any other crew.
          </p>
        </Panel>
      ) : (
        <ul className="mt-8 flex flex-col gap-4">
          {shown.map((community) => (
            <CommunityRow key={community.slug} community={community} />
          ))}
        </ul>
      )}
    </div>
  );
}
