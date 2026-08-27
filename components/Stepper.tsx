"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Minus, Plus } from "lucide-react";

/* ---------------------------------------------------------------------------
 * A number, and the two things you can do to it.
 *
 * The browser's own spinners are two grey chevrons stacked in a 10px column,
 * in a value that appears nowhere else in the palette, and on the phone this
 * product is used on they are close to untappable. This is the same control at
 * the size of a thumb.
 *
 * The figure stays a real input, so a "runs for 52 weeks" is one keystroke
 * rather than fifty-one taps, and holding a button repeats -- slowly at first,
 * then faster, which is what makes a wide range bearable without a second
 * control for coarse movement.
 *
 * Nothing here is coloured. A stepper at its limit greys the button rather
 * than reddening it: red and green belong to money, and a boundary is not an
 * error.
 * ------------------------------------------------------------------------- */

/** Long enough not to fire on a tap, short enough not to feel stuck. */
const HOLD_DELAY_MS = 400;
const HOLD_FAST_MS = 60;
const HOLD_RAMP_AFTER = 8;
const HOLD_SLOW_MS = 140;

export function Stepper({
  value,
  onChange,
  min,
  max = Infinity,
  step = 1,
  suffix,
  ariaLabel,
}: {
  value: number;
  onChange: (next: number) => void;
  min: number;
  max?: number;
  step?: number;
  /** Drawn inside the field, e.g. "min". Never part of the editable value. */
  suffix?: string;
  ariaLabel: string;
}) {
  // What the field shows while it is being typed in. Null means "show `value`",
  // which is what lets a half-typed or briefly-empty field exist without
  // writing a schema-invalid number to the caller.
  const [typing, setTyping] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clamp = useCallback(
    (n: number) => Math.min(max, Math.max(min, n)),
    [min, max],
  );

  const stop = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  // A held button whose component unmounts would otherwise keep firing.
  useEffect(() => stop, [stop]);

  const atMin = value <= min;
  const atMax = value >= max;

  const nudge = (direction: 1 | -1) => {
    const next = clamp(value + direction * step);
    if (next !== value) onChange(next);
  };

  /**
   * Press and hold. The ramp reads as intent: one tap is one step, a held
   * button walks, and a held button that is clearly going somewhere runs.
   */
  const hold = (direction: 1 | -1) => {
    let count = 0;
    let current = value;

    const tick = () => {
      const next = clamp(current + direction * step);
      if (next === current) return stop();
      current = next;
      count += 1;
      onChange(next);
      timer.current = setTimeout(tick, count > HOLD_RAMP_AFTER ? HOLD_FAST_MS : HOLD_SLOW_MS);
    };

    stop();
    timer.current = setTimeout(tick, HOLD_DELAY_MS);
  };

  function commit(raw: string) {
    setTyping(null);
    const n = Number(raw);
    // A cleared or nonsense field keeps the last good value rather than
    // writing 0 -- which for `cadence` is not a valid RuleConfig at all.
    if (raw.trim() === "" || !Number.isFinite(n)) return;
    onChange(clamp(Math.round(n)));
  }

  return (
    <div className="inline-flex h-11 items-center rounded-full bg-surface">
      <Button
        label={`Decrease ${ariaLabel}`}
        disabled={atMin}
        onPress={() => nudge(-1)}
        onHold={() => hold(-1)}
        onRelease={stop}
      >
        <Minus className="size-4" aria-hidden="true" strokeWidth={2} />
      </Button>

      <div className="flex min-w-[3.25rem] items-baseline justify-center gap-1 px-1">
        <input
          type="number"
          inputMode="numeric"
          aria-label={ariaLabel}
          value={typing ?? value}
          min={min}
          max={Number.isFinite(max) ? max : undefined}
          onChange={(e) => setTyping(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.currentTarget.blur();
            }
          }}
          onFocus={(e) => e.currentTarget.select()}
          // Sized to its content so the suffix sits against the figure rather
          // than floating at the end of a fixed-width box.
          style={{ width: `${Math.max(1, String(typing ?? value).length)}ch` }}
          className="figure bg-transparent text-center text-[15px] text-ink"
        />
        {suffix && <span className="text-[13px] text-grey-on-surface">{suffix}</span>}
      </div>

      <Button
        label={`Increase ${ariaLabel}`}
        disabled={atMax}
        onPress={() => nudge(1)}
        onHold={() => hold(1)}
        onRelease={stop}
      >
        <Plus className="size-4" aria-hidden="true" strokeWidth={2} />
      </Button>
    </div>
  );
}

function Button({
  label,
  disabled,
  onPress,
  onHold,
  onRelease,
  children,
}: {
  label: string;
  disabled: boolean;
  onPress: () => void;
  onHold: () => void;
  onRelease: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onPress}
      onPointerDown={(e) => {
        // Keeps focus where it was: these sit inside the row's <label>, and a
        // press that stole focus into the field would select it under the
        // thumb on every tap.
        e.preventDefault();
        if (!disabled) onHold();
      }}
      onPointerUp={onRelease}
      onPointerLeave={onRelease}
      onPointerCancel={onRelease}
      className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-ink transition-colors hover:bg-ink/[0.07] disabled:text-grey-on-surface/40 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}
