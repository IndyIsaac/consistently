"use client";

import type { RuleConfig } from "@/lib/rules";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-4 py-2">
      <span className="text-sm text-neutral-600">{label}</span>
      {children}
    </label>
  );
}

const input = "rounded-lg border border-neutral-300 px-2 py-1 text-sm";

/**
 * Parses a number input's raw string, falling back to `fallback` when the value doesn't
 * parse to a finite number (e.g. an emptied field, or an in-progress "-" while typing).
 * Keeps NaN/Infinity out of RuleConfig so every onChange stays a valid shape.
 */
function parseNumber(raw: string, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export function RuleEditor({
  value,
  onChange,
}: {
  value: RuleConfig;
  onChange: (next: RuleConfig) => void;
}) {
  const set = <K extends keyof RuleConfig>(k: K, v: RuleConfig[K]) =>
    onChange({ ...value, [k]: v });

  // Switching sessionType must never leave minDurationMins stale: it's cleared to null
  // for "checkin" (where it's irrelevant), and given a sane default when switching into
  // "checkin_checkout" if it isn't already set.
  const setSessionType = (next: RuleConfig["sessionType"]) => {
    onChange({
      ...value,
      sessionType: next,
      minDurationMins: next === "checkin_checkout" ? (value.minDurationMins ?? 30) : null,
    });
  };

  const windowInvalid = value.windowStart >= value.windowEnd;

  return (
    <div className="divide-y divide-neutral-100">
      <Row label="Times per week">
        <input
          type="number"
          min={1}
          max={7}
          className={input}
          value={value.cadence}
          onChange={(e) => set("cadence", parseNumber(e.target.value, value.cadence))}
        />
      </Row>

      <Row label="Proof">
        <select
          className={input}
          value={value.sessionType}
          onChange={(e) => setSessionType(e.target.value as RuleConfig["sessionType"])}
        >
          <option value="checkin">Check in only</option>
          <option value="checkin_checkout">Check in and out</option>
        </select>
      </Row>

      {value.sessionType === "checkin_checkout" && (
        <Row label="Minimum minutes">
          <input
            type="number"
            min={1}
            className={input}
            value={value.minDurationMins ?? 30}
            onChange={(e) =>
              set("minDurationMins", parseNumber(e.target.value, value.minDurationMins ?? 30))
            }
          />
        </Row>
      )}

      <div>
        <Row label="Allowed between">
          <span className="flex items-center gap-2">
            <input
              type="time"
              className={input}
              value={value.windowStart}
              onChange={(e) => set("windowStart", e.target.value)}
            />
            <span className="text-sm text-neutral-400">and</span>
            <input
              type="time"
              className={input}
              value={value.windowEnd}
              onChange={(e) => set("windowEnd", e.target.value)}
            />
          </span>
        </Row>
        {windowInvalid && (
          <p className="pb-2 text-right text-xs text-red-600">
            Start time must be before end time.
          </p>
        )}
      </div>

      <Row label="Misses allowed">
        <input
          type="number"
          min={0}
          className={input}
          value={value.failsWhenMissedExceeds}
          onChange={(e) =>
            set("failsWhenMissedExceeds", parseNumber(e.target.value, value.failsWhenMissedExceeds))
          }
        />
      </Row>

      <Row label="Runs for (weeks)">
        <input
          type="number"
          min={1}
          max={52}
          className={input}
          value={value.durationPeriods}
          onChange={(e) =>
            set("durationPeriods", parseNumber(e.target.value, value.durationPeriods))
          }
        />
      </Row>

      <Row label="Crew can grant exemptions">
        <input
          type="checkbox"
          checked={value.exemption === "majority"}
          onChange={(e) => set("exemption", e.target.checked ? "majority" : "none")}
        />
      </Row>
    </div>
  );
}
