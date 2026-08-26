"use client";

import { TriangleAlert } from "lucide-react";
import type { RuleConfig } from "@/lib/rules";

/* ---------------------------------------------------------------------------
 * The rule, as seven fields.
 *
 * Underneath the plain-English draft rather than instead of it: the draft gets
 * it right most of the time and this is where a crew fixes the rest. Every
 * parameter here is one the engine in lib/rules.ts actually evaluates, and
 * there are no others -- the spec fixes the schema and new parameters do not
 * get added.
 *
 * Colour is money only, per DESIGN.md, so the one validation message is set in
 * ink with a mark beside it rather than in red.
 * ------------------------------------------------------------------------- */

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-4 py-3">
      <span className="text-[14px] text-grey-on-ground">{label}</span>
      {children}
    </label>
  );
}

const field =
  "rounded-xl border border-hairline bg-ground px-3 py-2 text-[14px] text-ink outline-none transition-colors focus:border-ink";

/**
 * Parses a number input's raw string, falling back to `fallback` unless the result is an
 * integer within [min, max]. Rejects non-numbers, decimals, and out-of-range values (not just
 * NaN/Infinity) so a cleared field never writes 0 -- or any other schema-invalid number -- into
 * RuleConfig; the field simply keeps its previous value until the user types something valid.
 */
function parseNumber(raw: string, fallback: number, min: number, max: number = Infinity): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
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
    <div className="divide-y divide-hairline">
      <Row label="Times per week">
        <input
          type="number"
          min={1}
          max={7}
          className={`${field} w-20 text-right`}
          value={value.cadence}
          onChange={(e) => set("cadence", parseNumber(e.target.value, value.cadence, 1, 7))}
        />
      </Row>

      <Row label="Proof">
        <select
          className={field}
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
            className={`${field} w-20 text-right`}
            value={value.minDurationMins ?? 30}
            onChange={(e) =>
              set("minDurationMins", parseNumber(e.target.value, value.minDurationMins ?? 30, 1))
            }
          />
        </Row>
      )}

      <div>
        <Row label="Allowed between">
          <span className="flex items-center gap-2">
            <input
              type="time"
              className={field}
              value={value.windowStart}
              onChange={(e) => set("windowStart", e.target.value)}
            />
            <span className="text-[13px] text-grey-on-ground">and</span>
            <input
              type="time"
              className={field}
              value={value.windowEnd}
              onChange={(e) => set("windowEnd", e.target.value)}
            />
          </span>
        </Row>
        {windowInvalid && (
          <p
            role="alert"
            className="flex items-start justify-end gap-2 pb-3 text-[13px] text-ink"
          >
            <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
            The start has to come before the end.
          </p>
        )}
      </div>

      <Row label="Misses allowed">
        <input
          type="number"
          min={0}
          className={`${field} w-20 text-right`}
          value={value.failsWhenMissedExceeds}
          onChange={(e) =>
            set(
              "failsWhenMissedExceeds",
              parseNumber(e.target.value, value.failsWhenMissedExceeds, 0),
            )
          }
        />
      </Row>

      <Row label="Runs for (weeks)">
        <input
          type="number"
          min={1}
          max={52}
          className={`${field} w-20 text-right`}
          value={value.durationPeriods}
          onChange={(e) =>
            set("durationPeriods", parseNumber(e.target.value, value.durationPeriods, 1, 52))
          }
        />
      </Row>

      <Row label="Crew can grant exemptions">
        <input
          type="checkbox"
          className="size-4 accent-ink"
          checked={value.exemption === "majority"}
          onChange={(e) => set("exemption", e.target.checked ? "majority" : "none")}
        />
      </Row>
    </div>
  );
}
