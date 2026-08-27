import { cn } from "@/lib/utils";

/**
 * The card of DESIGN.md: a 1px hairline border, a 22px radius, 24px of padding
 * and no drop shadow beyond a whisper. It separates content; it does not
 * decorate it, and it is never nested inside another one.
 *
 * `panel` is the ground in light and a lift off it in dark — DESIGN.md keeps the
 * dark ground off pure black precisely so a card can sit above it.
 *
 * Deliberately not shadcn's `Card`, whose ring-and-14px-radius treatment belongs
 * to a different world. The shadcn primitives that *are* used here (Avatar,
 * Button) read the palette from `:root` in app/globals.css.
 */
export function Panel({
  className,
  ...props
}: React.ComponentProps<"section">) {
  return (
    <section
      className={cn(
        "rounded-[22px] border border-hairline bg-panel p-6 shadow-panel",
        className,
      )}
      {...props}
    />
  );
}

/** Labels: 11px, uppercase, 0.12em of tracking, grey. */
export function FieldLabel({
  className,
  ...props
}: React.ComponentProps<"p">) {
  return (
    <p
      className={cn(
        "text-[11px] font-medium uppercase tracking-[0.12em] text-grey-on-ground",
        className,
      )}
      {...props}
    />
  );
}

/** The soft break inside a card. Dashed at 1px, per DESIGN.md. */
export function DashedRule({ className }: { className?: string }) {
  return (
    <hr
      className={cn("border-0 border-t border-dashed border-hairline", className)}
    />
  );
}

/**
 * One control, one height.
 *
 * Every field in a form column -- text, select, time -- is the same 44px pill
 * as components/Stepper.tsx. Mixed heights read as a ragged edge down the
 * column before anyone can say why, and 44 is also the smallest square a thumb
 * reliably hits, which this being a phone product settles.
 *
 * Shared rather than declared per form, because the two that had their own
 * copy had already started to differ.
 */
export const FIELD =
  "h-11 rounded-full border border-hairline bg-ground px-4 text-[14px] text-ink outline-none transition-colors focus:border-ink";
