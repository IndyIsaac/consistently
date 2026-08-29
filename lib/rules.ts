import { z } from "zod";

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Converts a "HH:MM" string to minutes-since-midnight. Throws on anything not matching TIME_RE. */
function toMinutes(hhmm: string): number {
  const match = TIME_RE.exec(hhmm);
  if (!match) {
    throw new Error(`Invalid time "${hhmm}": expected 24-hour "HH:MM"`);
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

export const RuleConfigSchema = z
  .object({
    cadence: z.number().int().min(1).max(7),
    period: z.enum(["week", "day"]),
    sessionType: z.enum(["checkin", "checkin_checkout"]),
    minDurationMins: z.number().int().min(1).nullable(),
    windowStart: z.string().regex(TIME_RE),
    windowEnd: z.string().regex(TIME_RE),
    proof: z.enum(["photo", "self_attest"]),
    failsWhenMissedExceeds: z.number().int().min(0),
    split: z.literal("equal"),
    exemption: z.enum(["majority", "none"]),
    durationPeriods: z.number().int().min(1).max(52),
    /** What a good check-in looks like, set by the creator. Shown next to the
     *  camera so a member frames the same shot. Nothing compares them: the crew
     *  does, which is PRODUCT.md's trust-based design, unchanged. */
    checkInReferenceUrl: z.string().url().optional(),
    checkOutReferenceUrl: z.string().url().optional(),
    proofDescription: z.string().max(280).optional(),
  })
  .refine(
    (data) => {
      // toMinutes throws on a string that doesn't match TIME_RE. The field-level
      // .regex(TIME_RE) checks above are non-aborting in zod 4 -- this refine still runs
      // and receives the raw invalid string. That regex has already recorded the real
      // issue, so this refine declines to add a second one rather than propagating a
      // raw Error and breaking safeParse's no-throw contract.
      try {
        return toMinutes(data.windowStart) < toMinutes(data.windowEnd);
      } catch {
        return true;
      }
    },
    {
      message:
        "windowStart must be strictly before windowEnd; wrapping windows (e.g. 22:00-02:00) are not supported",
      path: ["windowEnd"],
    },
  );

export type RuleConfig = z.infer<typeof RuleConfigSchema>;

export type SessionRecord = { startedAt: Date; endedAt: Date | null };

/** Parts of a Date rendered in a specific IANA timezone. */
function zoned(d: Date, timezone: string): { key: string; minutes: number } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
  const hour = parts.hour === "24" ? "00" : parts.hour;
  return {
    key: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(hour) * 60 + Number(parts.minute),
  };
}

/** A session belongs to the day it STARTED, in the crew's timezone. */
export function dayKeyFor(startedAt: Date, timezone: string): string {
  return zoned(startedAt, timezone).key;
}

export function isValidSession(
  session: SessionRecord,
  rule: RuleConfig,
  timezone: string,
): boolean {
  const start = zoned(session.startedAt, timezone);
  const windowStart = toMinutes(rule.windowStart);
  const windowEnd = toMinutes(rule.windowEnd);

  if (start.minutes < windowStart || start.minutes > windowEnd) return false;

  if (rule.sessionType === "checkin") return true;

  if (!session.endedAt) return false;

  if (session.endedAt.getTime() < session.startedAt.getTime()) return false;

  if (rule.minDurationMins !== null) {
    const mins = (session.endedAt.getTime() - session.startedAt.getTime()) / 60_000;
    if (mins < rule.minDurationMins) return false;
  }
  return true;
}

/**
 * Counts distinct local-day keys (per `dayKeyFor`) among the valid sessions in `sessions`.
 *
 * Precondition: `sessions` must already be filtered by the caller to a single evaluation
 * period (per `rule.period`) in the crew's timezone. This function does not window by
 * `rule.period` or `rule.durationPeriods` — those fields are metadata for the caller's
 * period selection, not inputs consumed here.
 */
export function countValidDays(
  sessions: SessionRecord[],
  rule: RuleConfig,
  timezone: string,
): number {
  const days = new Set<string>();
  for (const s of sessions) {
    if (isValidSession(s, rule, timezone)) days.add(dayKeyFor(s.startedAt, timezone));
  }
  return days.size;
}

/**
 * Determines whether the member failed the rule, given sessions from a single evaluation
 * period.
 *
 * Precondition: `sessions` must already be filtered by the caller to a single evaluation
 * period (per `rule.period`) in the crew's timezone — same precondition as `countValidDays`,
 * whose result this is built on. `rule.period` and `rule.durationPeriods` are not read here;
 * they describe how the caller should carve up a member's history into periods before calling.
 */
export function hasFailed(
  sessions: SessionRecord[],
  rule: RuleConfig,
  timezone: string,
): boolean {
  const done = countValidDays(sessions, rule, timezone);
  const missed = Math.max(0, rule.cadence - done);
  return missed > rule.failsWhenMissedExceeds;
}

/**
 * Where a member stands part-way through a period: what is still owed, what is
 * still available, and whether those two numbers can still meet.
 *
 * `hasFailed` above answers the settlement question — did they break the rule —
 * and it can only answer it once the period is over. This answers the question
 * during the period, which is the one a member actually asks: is this still
 * reachable. The moment it is not, the crew is told, rather than finding out
 * days later when the money moves.
 */
export type CadenceOutlook = {
  /** Days still to be done. Zero once nothing more is owed. */
  daysNeeded: number;
  /** Days still available in the period, counting today while today is still open. */
  daysAvailable: number;
  /** Nothing more is owed: the cadence is already covered. */
  met: boolean;
  /** The cadence can no longer be reached, however the rest of the period goes. */
  outOfReach: boolean;
};

/**
 * Pure arithmetic over three numbers. It does not read a clock, a timezone or a
 * session list: the caller says how many days are banked and how many are still
 * available, both of which it already has to compute to draw anything.
 *
 * The days actually owed are `cadence` less the misses the rule forgives, so a
 * rule that tolerates one missed day is out of reach one day later than one that
 * tolerates none. Both inputs are clamped at zero — a caller that hands over a
 * negative day count gets the honest answer for zero rather than a nonsense one.
 *
 * The boundary is deliberate: needing exactly as many days as remain is still
 * possible (a perfect run), and only needing one more than remain is not.
 */
export function cadenceOutlook(
  daysDone: number,
  daysAvailable: number,
  rule: RuleConfig,
): CadenceOutlook {
  const owed = Math.max(0, rule.cadence - rule.failsWhenMissedExceeds);
  const daysNeeded = Math.max(0, owed - Math.max(0, daysDone));
  const available = Math.max(0, daysAvailable);

  return {
    daysNeeded,
    daysAvailable: available,
    met: daysNeeded === 0,
    outOfReach: daysNeeded > available,
  };
}
