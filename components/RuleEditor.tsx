"use client";

import { useState } from "react";
import { TriangleAlert } from "lucide-react";
import { FIELD, FieldLabel } from "@/components/Panel";
import { Select } from "@/components/Select";
import { Stepper } from "@/components/Stepper";
import type { RuleConfig } from "@/lib/rules";
import { upload } from "@/lib/upload";

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

/**
 * One reference photo -- what a good check-in or check-out looks like. Set
 * once by the creator, shown to every member so they frame the same shot.
 * Nothing here verifies anything: PRODUCT.md rules out automated proof
 * checking on purpose, and this is a picture for a human to compare against,
 * not an input to any check.
 */
function ReferenceSlot({
  label, url, onUrl, onError,
}: {
  label: string;
  url?: string;
  onUrl: (url: string) => void;
  onError: (msg: string) => void;
}) {
  return (
    <label className="flex cursor-pointer flex-col items-center gap-2">
      {url ? (
        <img src={url} alt="" className="size-20 rounded-2xl object-cover" />
      ) : (
        <span className="flex size-20 items-center justify-center rounded-2xl bg-surface text-[12px] text-grey-on-surface">
          Add
        </span>
      )}
      <span className="text-[12px] text-grey-on-ground">{label}</span>
      <input
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          try {
            onUrl(await upload(file));
          } catch (err) {
            onError(err instanceof Error ? err.message : "Upload failed.");
          }
          e.target.value = "";
        }}
      />
    </label>
  );
}

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

  const [uploadError, setUploadError] = useState<string | null>(null);

  // Switching sessionType must never leave stale conditional state behind. minDurationMins
  // is cleared to null for "checkin" (where it's irrelevant), and given a sane default when
  // switching into "checkin_checkout" if it isn't already set. checkOutReferenceUrl gets the
  // same treatment: the check-out slot only renders for "checkin_checkout", so a URL left
  // over from before a switch to "checkin" would ride into the database invisibly, with no
  // slot left in the UI to show or clear it.
  const setSessionType = (next: RuleConfig["sessionType"]) => {
    onChange({
      ...value,
      sessionType: next,
      minDurationMins: next === "checkin_checkout" ? (value.minDurationMins ?? 30) : null,
      checkOutReferenceUrl: next === "checkin_checkout" ? value.checkOutReferenceUrl : undefined,
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
        <Select
          value={value.sessionType}
          onChange={(e) => setSessionType(e.target.value as RuleConfig["sessionType"])}
        >
          <option value="checkin">Check in only</option>
          <option value="checkin_checkout">Check in and out</option>
        </Select>
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

      {/* How proof is captured (session type, minimum session) is decided
          above; this is what it should look like once captured. A section of
          its own, not a Row -- it carries a label, two photos and a text
          field rather than one control, so it takes `py-6` in place of a
          Row's `py-3` to give that heavier content room without losing the
          symmetric divide-y rhythm every other section keeps. */}
      <div className="py-6">
        <FieldLabel>What a good one looks like</FieldLabel>
        <p className="mt-2 text-[13px] text-grey-on-ground">
          Optional. The crew compares against it. Nothing checks it for you.
        </p>

        <div className="mt-4 flex gap-5">
          <ReferenceSlot
            label="Check in"
            url={value.checkInReferenceUrl}
            // A successful upload here also clears any error left by the check-out slot:
            // uploadError is one banner shared by both, so it should read as "the last
            // upload attempt failed", not "the check-in slot has a problem".
            onUrl={(url) => {
              setUploadError(null);
              set("checkInReferenceUrl", url);
            }}
            onError={setUploadError}
          />
          {value.sessionType === "checkin_checkout" && (
            <ReferenceSlot
              label="Check out"
              url={value.checkOutReferenceUrl}
              onUrl={(url) => {
                setUploadError(null);
                set("checkOutReferenceUrl", url);
              }}
              onError={setUploadError}
            />
          )}
        </div>

        <input
          className={`${FIELD} mt-4 w-full`}
          maxLength={280}
          placeholder="Full body in the mirror, gym floor behind you"
          value={value.proofDescription ?? ""}
          onChange={(e) => set("proofDescription", e.target.value || undefined)}
        />

        {uploadError && (
          <p role="alert" className="mt-2 flex items-start gap-2 text-[13px] text-ink">
            <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
            {uploadError}
          </p>
        )}
      </div>

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
