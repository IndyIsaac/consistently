"use client";

import { ChevronDown } from "lucide-react";
import { FIELD } from "@/components/Panel";

/* ---------------------------------------------------------------------------
 * A select, with the browser's arrow replaced.
 *
 * The native one is drawn by the OS at a fixed inset from the padding box,
 * which on a full-radius pill lands it inside the curve -- and no amount of
 * padding moves it, because the padding is what it is inset from. So it is
 * turned off and a chevron is placed where the rest of the product puts one.
 *
 * The same lucide chevron every other disclosure in the app uses, at the same
 * `grey-on-surface` the suffixes use, so a select reads as one of the family
 * rather than as whatever Chrome felt like drawing.
 * ------------------------------------------------------------------------- */

export function Select({
  className,
  children,
  ...props
}: React.ComponentProps<"select">) {
  return (
    <span className="relative inline-flex min-w-0 items-center">
      <select
        {...props}
        // `pr-12` reserves the chevron's column; `appearance-none` is what
        // stops the browser drawing a second one underneath it.
        className={`${FIELD} w-full appearance-none pr-12 ${className ?? ""}`}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        strokeWidth={2}
        // `right-5` matches FIELD's `px-5`, so the chevron is inset from the
        // pill's edge by exactly what the text is on the other side.
        className="pointer-events-none absolute right-5 size-4 text-grey-on-surface"
      />
    </span>
  );
}
