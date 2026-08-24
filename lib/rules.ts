import { z } from "zod";

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const RuleConfigSchema = z.object({
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
});

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

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
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

  if (rule.minDurationMins !== null) {
    const mins = (session.endedAt.getTime() - session.startedAt.getTime()) / 60_000;
    if (mins < rule.minDurationMins) return false;
  }
  return true;
}

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

export function hasFailed(
  sessions: SessionRecord[],
  rule: RuleConfig,
  timezone: string,
): boolean {
  const done = countValidDays(sessions, rule, timezone);
  const missed = Math.max(0, rule.cadence - done);
  return missed > rule.failsWhenMissedExceeds;
}
