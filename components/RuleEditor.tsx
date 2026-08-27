"use client";

import { TriangleAlert } from "lucide-react";
import { FIELD } from "@/components/Panel";
import { Stepper } from "@/components/Stepper";
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
        <Stepper
          ariaLabel="times per week"
          value={value.cadence}
          min={1}
          max={7}
          onChange={(n) => set("cadence", n)}
        />
      </Row>

      <Row label="Proof">
        <select
          className={FIELD}
          value={value.sessionType}
          onChange={(e) => setSessionType(e.target.value as RuleConfig["sessionType"])}
        >
          <option value="checkin">Check in only</option>
          <option value="checkin_checkout">Check in and out</option>
        </select>
      </Row>

      {value.sessionType === "checkin_checkout" && (
        <Row label="Minimum session">
          <Stepper
            ariaLabel="minimum minutes"
            value={value.minDurationMins ?? 30}
            min={1}
            max={600}
            // Nobody agrees a thirty-one minute rule. Five is the grain these
            // are actually spoken in, and typing still reaches any number.
            step={5}
            suffix="min"
            onChange={(n) => set("minDurationMins", n)}
          />
        </Row>
      )}

      {/* The one two-part control, and the only row that does not fit beside
          its own label on a phone. It takes a line of its own rather than
          being squeezed: two time fields and the word between them are what a
          window is, and shrinking any of the three to make the row fit reads
          worse than giving it the width. */}
      <div>
        <div className="py-3">
          <span className="text-[14px] text-grey-on-ground">Allowed between</span>
          <div className="mt-3 flex items-center gap-2">
            <input
              type="time"
              aria-label="Earliest a session may start"
              className={`${FIELD} figure min-w-0 flex-1`}
              value={value.windowStart}
              onChange={(e) => set("windowStart", e.target.value)}
            />
            <span className="shrink-0 text-[13px] text-grey-on-ground">and</span>
            <input
              type="time"
              aria-label="Latest a session may start"
              className={`${FIELD} figure min-w-0 flex-1`}
              value={value.windowEnd}
              onChange={(e) => set("windowEnd", e.target.value)}
            />
          </div>
        </div>
        {windowInvalid && (
          <p
            role="alert"
            className="flex items-start gap-2 pb-3 text-[13px] text-ink"
          >
            <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
            The start has to come before the end.
          </p>
        )}
      </div>

      <Row label="Misses allowed">
        <Stepper
          ariaLabel="misses allowed"
          value={value.failsWhenMissedExceeds}
          min={0}
          max={value.cadence}
          onChange={(n) => set("failsWhenMissedExceeds", n)}
        />
      </Row>

      <Row label="Runs for">
        <Stepper
          ariaLabel="weeks it runs for"
          value={value.durationPeriods}
          min={1}
          max={52}
          suffix={value.durationPeriods === 1 ? "week" : "weeks"}
          onChange={(n) => set("durationPeriods", n)}
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
