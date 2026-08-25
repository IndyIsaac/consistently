import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

export type CrewRowData = {
  id: string;
  /** Position in the crew. No podium, no crowns, no tiers. */
  rank: number;
  name: string;
  initials: string;
  /** One grey sub-line. One. */
  subline: React.ReactNode;
  /** Right-aligned figure. */
  figure: React.ReactNode;
  isViewer: boolean;
};

/**
 * The crew table of DESIGN.md: rank, avatar, name, one grey sub-line, a
 * right-aligned figure. Hairlines do the dividing; the viewer's own row is inset
 * in `surface` behind a 2px `ink` border, so it reads as the row you are.
 */
export function CrewTable({ rows, className }: { rows: CrewRowData[]; className?: string }) {
  return (
    <ul className={cn("flex flex-col", className)}>
      {rows.map((row, i) => {
        // A hairline divides two plain rows. The viewer's inset row carries its
        // own border, so no rule is drawn against either of its edges.
        const rule = i > 0 && !row.isViewer && !rows[i - 1].isViewer;

        return (
          <li
            key={row.id}
            className={cn(
              "grid grid-cols-[1.1rem_auto_minmax(0,1fr)_auto] items-center gap-x-3 py-3",
              rule && "border-t border-hairline",
              row.isViewer &&
                "my-1 rounded-2xl border-2 border-ink bg-surface px-3 py-3",
            )}
          >
            <span
              className={cn(
                "figure text-[13px]",
                row.isViewer ? "text-grey-on-surface" : "text-grey-on-white",
              )}
            >
              {row.rank}
            </span>

            <Avatar className="size-9">
              <AvatarFallback
                className={cn(
                  "text-[12px] font-semibold tracking-[0.02em]",
                  row.isViewer
                    ? "bg-ground text-grey-on-white"
                    : "bg-surface text-grey-on-surface",
                )}
              >
                {row.initials}
              </AvatarFallback>
            </Avatar>

            <div className="min-w-0">
              <p className="truncate text-[15px] font-semibold tracking-[-0.01em] text-ink">
                {row.name}
              </p>
              <p
                className={cn(
                  "truncate text-[13px]",
                  row.isViewer ? "text-grey-on-surface" : "text-grey-on-white",
                )}
              >
                {row.subline}
              </p>
            </div>

            <div className="figure justify-self-end text-right text-[15px] font-semibold text-ink">
              {row.figure}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
