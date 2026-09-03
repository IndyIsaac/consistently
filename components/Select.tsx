"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";
import { Select as SelectPrimitive } from "radix-ui";
import { FIELD } from "@/components/Panel";
import { cn } from "@/lib/utils";

/* ---------------------------------------------------------------------------
 * A select.
 *
 * The native <select> is a pill we can dress; the menu it opens is the OS's,
 * and no amount of CSS reaches it. So the trigger stays the same field as
 * every other input, and the list is ours: a 22px card, hairline, the panel
 * shadow, rows the height of the field. Call sites still pass <option>s and
 * onChange — the native contract, a product menu.
 * ------------------------------------------------------------------------- */

type Option = {
  value: string;
  label: React.ReactNode;
  disabled?: boolean;
};

function optionsFrom(children: React.ReactNode): Option[] {
  return React.Children.toArray(children).flatMap((child) => {
    if (!React.isValidElement<{
      value?: string | number;
      disabled?: boolean;
      children?: React.ReactNode;
    }>(child) || child.type !== "option") {
      return [];
    }
    const value = child.props.value;
    return [
      {
        value: value == null ? "" : String(value),
        label: child.props.children,
        disabled: child.props.disabled,
      },
    ];
  });
}

export function Select({
  className,
  children,
  value,
  defaultValue,
  onChange,
  disabled,
  name,
  id,
  required,
  "aria-label": ariaLabel,
}: React.ComponentProps<"select">) {
  const options = optionsFrom(children);
  const current = value == null ? undefined : String(value);
  const initial = defaultValue == null ? undefined : String(defaultValue);

  return (
    <SelectPrimitive.Root
      value={current}
      defaultValue={initial}
      disabled={disabled}
      name={name}
      required={required}
      onValueChange={(next) => {
        onChange?.({
          target: { value: next },
          currentTarget: { value: next },
        } as React.ChangeEvent<HTMLSelectElement>);
      }}
    >
      <span className="relative inline-flex min-w-0 items-center">
        <SelectPrimitive.Trigger
          id={id}
          aria-label={ariaLabel}
          className={cn(
            FIELD,
            "inline-flex w-full min-w-0 items-center justify-between gap-6 pr-12 text-left outline-none",
            "disabled:cursor-not-allowed disabled:opacity-50",
            className,
          )}
        >
          <SelectPrimitive.Value />
        </SelectPrimitive.Trigger>
        <ChevronDown
          aria-hidden="true"
          strokeWidth={2}
          className="pointer-events-none absolute right-5 size-4 text-grey-on-surface"
        />
      </span>

      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={8}
          className="z-50 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-[22px] border border-hairline bg-panel p-1.5 shadow-panel"
        >
          <SelectPrimitive.Viewport>
            {options.map((option) => (
              <SelectPrimitive.Item
                key={option.value}
                value={option.value}
                disabled={option.disabled}
                className={cn(
                  "relative flex h-11 cursor-pointer items-center rounded-full px-4 text-[14px] text-ink outline-none select-none",
                  "data-[disabled]:cursor-not-allowed data-[disabled]:opacity-40",
                  "data-[highlighted]:bg-surface",
                  "data-[state=checked]:bg-ink data-[state=checked]:text-ground",
                )}
              >
                <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
