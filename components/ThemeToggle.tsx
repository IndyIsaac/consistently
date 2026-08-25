"use client";

import { motion, useReducedMotion } from "motion/react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/components/ThemeProvider";
import { cn } from "@/lib/utils";

const TRACK = 64;
const PAD = 4;
const KNOB = 24;
const TRAVEL = TRACK - PAD * 2 - KNOB;

/**
 * The pill of DESIGN.md: a dark track, a moon in a filled light knob at one end,
 * a sun in `muted` at the other, the knob sliding between them.
 *
 * The knob rides under the two icons rather than carrying one, so an icon simply
 * darkens as the knob arrives beneath it. One moving part, and the end the knob
 * is not at still shows you what you would be switching to.
 *
 * Built by hand against the reference in the builder's 21st.dev list
 * (`ayushmxxn/theme-toggle`), whose install is behind an API key this machine
 * does not hold. That one keeps its state in `useState`, animates on a CSS
 * duration and hardcodes zinc; this one drives the real theme, moves on
 * `motion/react` and reads the palette.
 */
export function ThemeToggle({ className, id }: { className?: string; id?: string }) {
  const { theme, ready, toggle } = useTheme();
  const reduceMotion = useReducedMotion();
  const isDark = theme === "dark";

  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={isDark}
      onClick={toggle}
      className={cn(
        "relative flex h-8 w-16 shrink-0 items-center rounded-full bg-toggle-track p-1",
        // On the dark ground the track is darker than the card it sits on, so it
        // reads as an inset. The ring draws the edge without moving the box.
        "dark:ring-1 dark:ring-hairline dark:ring-inset",
        className,
      )}
    >
      <span className="sr-only">Dark mode</span>

      <motion.span
        aria-hidden="true"
        className="absolute top-1 left-1 size-6 rounded-full bg-toggle-knob"
        initial={false}
        animate={{ x: isDark ? 0 : TRAVEL }}
        transition={
          ready && !reduceMotion
            ? { type: "spring", stiffness: 520, damping: 40, mass: 0.6 }
            : // Before the client has read the stored choice there is nothing to
              // travel from, so the knob is placed rather than moved.
              { duration: 0 }
        }
      />

      <span
        aria-hidden="true"
        className="relative z-10 flex w-full items-center justify-between"
      >
        <span className="flex size-6 items-center justify-center">
          <Moon
            className={cn(
              "size-4 transition-colors duration-200",
              isDark ? "text-toggle-track" : "text-toggle-idle",
            )}
            strokeWidth={1.5}
          />
        </span>
        <span className="flex size-6 items-center justify-center">
          <Sun
            className={cn(
              "size-4 transition-colors duration-200",
              isDark ? "text-toggle-idle" : "text-toggle-track",
            )}
            strokeWidth={1.5}
          />
        </span>
      </span>
    </button>
  );
}
