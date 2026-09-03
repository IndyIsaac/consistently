"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Popover } from "radix-ui";
import { FIELD } from "@/components/Panel";
import { cn } from "@/lib/utils";

/* ---------------------------------------------------------------------------
 * A time. The native <input type="time"> is a pill we can dress; the clock it
 * opens is the OS's. Same problem the select had. The value is still HH:MM —
 * that is what the rule stores — and the menu is ours.
 * ------------------------------------------------------------------------- */

const HOURS = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] as const;
const STEPS = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55] as const;

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function parse(value: string): { h: number; m: number } {
  const [hs = "0", ms = "0"] = value.split(":");
  return {
    h: Math.min(23, Math.max(0, Number(hs) || 0)),
    m: Math.min(59, Math.max(0, Number(ms) || 0)),
  };
}

function hour12(h: number) {
  return h % 12 === 0 ? 12 : h % 12;
}

function periodOf(h: number): "AM" | "PM" {
  return h < 12 ? "AM" : "PM";
}

function toValue(h12: number, m: number, period: "AM" | "PM") {
  let h = h12 % 12;
  if (period === "PM") h += 12;
  return `${pad(h)}:${pad(m)}`;
}

function format(value: string) {
  const { h, m } = parse(value);
  return `${hour12(h)}:${pad(m)} ${periodOf(h)}`;
}

function Column<T extends string | number>({
  items,
  value,
  open,
  format: fmt,
  onPick,
}: {
  items: readonly T[];
  value: T;
  open: boolean;
  format?: (v: T) => string;
  onPick: (v: T) => void;
}) {
  const active = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const node = active.current;
    const list = node?.parentElement;
    if (!open || !node || !list) return;
    list.scrollTop = node.offsetTop - list.clientHeight / 2 + node.clientHeight / 2;
  }, [open, value]);

  return (
    <div className="flex max-h-56 w-[4.25rem] flex-col overflow-y-auto">
      {items.map((item) => {
        const on = item === value;
        return (
          <button
            key={String(item)}
            ref={on ? active : undefined}
            type="button"
            onClick={() => onPick(item)}
            className={cn(
              "figure flex h-11 shrink-0 items-center justify-center rounded-full text-[14px]",
              on ? "bg-ink text-ground" : "text-ink hover:bg-surface",
            )}
          >
            {fmt ? fmt(item) : String(item)}
          </button>
        );
      })}
    </div>
  );
}

export function TimeField({
  value,
  onChange,
  "aria-label": ariaLabel,
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  "aria-label": string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const { h, m } = parse(value);
  const minutes = STEPS.includes(m as (typeof STEPS)[number])
    ? STEPS
    : [...STEPS, m].sort((a, b) => a - b);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <span className="relative inline-flex min-w-0 flex-1 items-center">
        <Popover.Trigger
          aria-label={ariaLabel}
          className={cn(
            FIELD,
            "figure inline-flex w-full min-w-0 items-center justify-between pr-12 text-left outline-none",
            className,
          )}
        >
          {format(value)}
        </Popover.Trigger>
        <ChevronDown
          aria-hidden="true"
          strokeWidth={2}
          className="pointer-events-none absolute right-5 size-4 text-grey-on-surface"
        />
      </span>

      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={8}
          className="z-50 flex gap-1 overflow-hidden rounded-[22px] border border-hairline bg-panel p-1.5 shadow-panel outline-none"
        >
          <Column
            items={HOURS}
            value={hour12(h)}
            open={open}
            onPick={(next) => onChange(toValue(next, m, periodOf(h)))}
          />
          <Column
            items={minutes}
            value={m}
            open={open}
            format={pad}
            onPick={(next) => onChange(toValue(hour12(h), next, periodOf(h)))}
          />
          <Column
            items={["AM", "PM"] as const}
            value={periodOf(h)}
            open={open}
            onPick={(next) => onChange(toValue(hour12(h), m, next))}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
