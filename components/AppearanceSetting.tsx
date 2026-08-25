"use client";

import { FieldLabel } from "@/components/Panel";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useTheme } from "@/components/ThemeProvider";

const TOGGLE_ID = "dark-mode";

/**
 * The theme lives in Settings, not in the nav bar. The state line is rendered
 * blank until the client has read the stored choice, so the row keeps its height
 * and never claims the wrong thing for a frame.
 */
export function AppearanceSetting() {
  const { theme, isSystem, ready } = useTheme();

  const state = !ready
    ? " "
    : `${theme === "dark" ? "On" : "Off"}.${isSystem ? " Following the system." : ""}`;

  return (
    <>
      <FieldLabel>Appearance</FieldLabel>

      <div className="mt-4 flex items-center justify-between gap-6">
        <div className="min-w-0">
          <label
            htmlFor={TOGGLE_ID}
            className="block text-[15px] font-semibold tracking-[-0.01em] text-ink"
          >
            Dark mode
          </label>
          <p className="mt-0.5 text-[13px] text-grey-on-ground">{state}</p>
        </div>

        <ThemeToggle id={TOGGLE_ID} />
      </div>

      <p className="mt-4 text-[13px] text-grey-on-ground">
        The front door takes the opposite.
      </p>
    </>
  );
}
