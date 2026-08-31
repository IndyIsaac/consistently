"use client";

import { useId, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowUp } from "lucide-react";
import { COMMANDS, enterTakesSuggestion } from "@/lib/bot";
import { cn } from "@/lib/utils";

/* ---------------------------------------------------------------------------
 * The only thing a member can type.
 *
 * Not a message composer, and it cannot be made into one: the slash is painted
 * into the field rather than typed, so every keystroke that reaches this input
 * is already part of a command. Typing one anyway is swallowed. PRODUCT.md's
 * "no free-text chat" is a decision, and this is where it is enforced rather
 * than merely intended.
 *
 * The list above the field is the discovery mechanism — nobody should have to
 * know `/help` exists to find out what else does.
 * ------------------------------------------------------------------------- */

export function CommandInput({
  onSubmit,
  disabled = false,
}: {
  /** The command without its slash, e.g. `"exempt food poisoning"`. */
  onSubmit: (command: string) => void;
  disabled?: boolean;
}) {
  const reduceMotion = useReducedMotion();
  const [value, setValue] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  // Suggestions only while the command word itself is being typed. Once there
  // is an argument ("exempt food poisoning") the list has nothing left to say.
  const typingArgument = value.includes(" ");
  const matches = typingArgument
    ? []
    : COMMANDS.filter((c) => c.name.startsWith(value.trim().toLowerCase()));

  const showing = open && matches.length > 0;

  function type(next: string) {
    // A pasted or typed slash is dropped: the one in front of the field is the
    // only one there is.
    setValue(next.replace(/\//g, ""));
    setActive(0);
  }

  function submit(command: string) {
    const trimmed = command.trim();
    if (trimmed.length === 0) return;
    onSubmit(trimmed);
    setValue("");
    setOpen(false);
    inputRef.current?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (!showing) {
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        setOpen(true);
        e.preventDefault();
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % matches.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i - 1 + matches.length) % matches.length);
    } else if (e.key === "Tab") {
      e.preventDefault();
      type(matches[active].name);
    } else if (e.key === "Enter" && enterTakesSuggestion(value, matches[active]?.name)) {
      // Enter takes the highlighted suggestion unless what is typed is already
      // that command in full, in which case it runs it -- or unless nothing is
      // typed at all, in which case it takes nothing. The list is open from the
      // moment the field is focused, so an empty field matches every command
      // and highlights the first; Enter used to run it.
      e.preventDefault();
      submit(matches[active].name);
    }
  }

  return (
    <div className="relative">
      <AnimatePresence>
        {showing && (
          <motion.ul
            id={listId}
            role="listbox"
            aria-label="Commands"
            // Sized to the longest command rather than to the field: on a phone the
            // field is the narrow half of the composer, and a hint clipped to
            // "the code to hand r..." teaches nobody anything. It grows leftwards,
            // over the camera, and stops at the edge of the screen.
            className="absolute right-0 bottom-[calc(100%+0.6rem)] w-max max-w-[calc(100vw-2.5rem)] min-w-full overflow-hidden rounded-[20px] border border-hairline bg-panel p-1.5 shadow-nav"
            initial={{ opacity: 0, y: 8, filter: "blur(6px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: 6, filter: "blur(4px)" }}
            transition={
              reduceMotion ? { duration: 0 } : { duration: 0.24, ease: [0.16, 1, 0.3, 1] }
            }
          >
            {matches.map((command, i) => (
              <li key={command.name}>
                <button
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  // The input keeps the caret; the list is driven from it.
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => submit(command.name)}
                  className={cn(
                    "flex w-full items-baseline gap-3 rounded-[14px] px-3 py-2 text-left transition-colors",
                    i === active ? "bg-surface" : "bg-transparent",
                  )}
                >
                  <span className="text-[14px] font-semibold tracking-[-0.01em] text-ink">
                    /{command.name}
                  </span>
                  <span className="truncate text-[13px] text-grey-on-ground">{command.hint}</span>
                </button>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(value);
        }}
        className="flex h-12 items-center gap-1 rounded-full border border-hairline bg-panel pr-1.5 pl-4 transition-colors focus-within:border-ink/45"
      >
        <span
          aria-hidden="true"
          className="text-[16px] font-semibold text-grey-on-ground select-none"
        >
          /
        </span>
        <input
          ref={inputRef}
          value={value}
          disabled={disabled}
          role="combobox"
          aria-label="Run a command"
          aria-autocomplete="list"
          aria-expanded={showing}
          aria-controls={showing ? listId : undefined}
          placeholder="help"
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => type(e.target.value)}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
          className="min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-grey-on-ground disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={disabled || value.trim().length === 0}
          aria-label="Run"
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-ink text-ground transition-opacity hover:opacity-85 disabled:opacity-25"
        >
          <ArrowUp className="size-4.5" aria-hidden="true" strokeWidth={2.25} />
        </button>
      </form>
    </div>
  );
}
