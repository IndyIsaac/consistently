import { dayKeyFor, isValidSession, type RuleConfig, type SessionRecord } from "@/lib/rules";

/**
 * View helpers shared by every screen that draws a pact. Pure functions over the
 * same shapes the API routes return, so nothing here has to change when the mock
 * session is deleted and real rows arrive.
 */

/**
 * One cell of the day-marker row — the product's most repeated shape.
 *
 * DESIGN.md defines exactly three states, and there is deliberately no fourth for
 * "a past day with nothing on it". Under a `cadence` -times-a-week rule no single
 * day was ever owed, so an empty past day is not a miss; it is simply unrecorded,
 * and it ghosts like an unreached one. The standing line carries the judgement.
 */
export type DayMark = {
  /** The crew-local calendar date, e.g. "2026-08-27". */
  key: string;
  /** Single-letter column head, Monday first. */
  label: string;
  state: "done" | "today" | "ghost";
  isToday: boolean;
};

const DAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"];

/**
 * Steps a bare calendar day key by `n` days. Day keys carry no timezone — they
 * are already the crew's local date, produced by `dayKeyFor` — so UTC arithmetic
 * on them is safe and DST-free. Same reasoning as `prevDayKey` in lib/stats.ts.
 */
function addDays(key: string, n: number): string {
  const d = new Date(`${key}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * The day keys of the evaluation period containing `now`.
 *
 * `countValidDays` and `hasFailed` both document the same precondition: the
 * caller must window a member's sessions to a single period before calling
 * them, because neither reads `rule.period` itself. This is that window, and
 * it exists so there is exactly one implementation of it -- an unwindowed call
 * counts a member's whole history, which after two weeks means nobody can ever
 * fail again and the product quietly stops working.
 */
export function periodDayKeys(rule: RuleConfig, timezone: string, now: Date): string[] {
  return rule.period === "day" ? [dayKeyFor(now, timezone)] : weekDayKeys(timezone, now);
}

/**
 * The key of the period `n` periods before the one `periodKey` names.
 *
 * Plain day arithmetic on the key for both cadences, because a period key
 * already is a day: a daily period is its own day, and a weekly one is always
 * the Monday `weekDayKeys` produced -- and a Monday minus seven days is the
 * previous Monday in every timezone and across every DST boundary, which is
 * the property `addDays` above exists to have.
 */
export function periodKeyBefore(rule: RuleConfig, periodKey: string, n = 1): string {
  return addDays(periodKey, rule.period === "day" ? -n : -7 * n);
}

/** The seven day keys of the week beginning `monday`. */
function weekFrom(monday: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/** The seven day keys of the crew-local week containing `now`, Monday first. */
export function weekDayKeys(timezone: string, now: Date): string[] {
  const todayKey = dayKeyFor(now, timezone);
  const dayOfWeek = new Date(`${todayKey}T00:00:00.000Z`).getUTCDay(); // 0 = Sunday
  return weekFrom(addDays(todayKey, dayOfWeek === 0 ? -6 : 1 - dayOfWeek));
}

/**
 * The day keys of the period a period key names -- the same window
 * `periodDayKeys` produces, addressed by key rather than by a clock.
 *
 * This is the one to reach for when the period being worked on is not the
 * period it happens to be now. `settlePact` used `periodDayKeys(rule, tz, now)`
 * to window the sessions it judged, which was indistinguishable from correct
 * for as long as the only period anyone could settle was the current one.
 *
 * Precondition: `periodKey` is the *first* key of its period, which is what
 * `periodDayKeys(...)[0]` and `periodKeyBefore` both produce -- a Monday for a
 * weekly rule. Handed a Wednesday it returns the seven days from that
 * Wednesday, which is not any crew's week.
 */
export function periodDayKeysFrom(rule: RuleConfig, periodKey: string): string[] {
  return rule.period === "day" ? [periodKey] : weekFrom(periodKey);
}

/**
 * Whether `periodKey` really is the first day of a period -- the precondition
 * above, which `periodDayKeysFrom` cannot check for itself without also having
 * to decide what to do about a key that fails it.
 *
 * Every producer inside the product satisfies it. A request body does not:
 * `periodKey` arrives as a string, so this is the only thing standing between
 * a member naming a Wednesday and a Wednesday-to-Tuesday window -- which is no
 * crew's week -- being judged, paid out of, and marked failed against.
 *
 * The round trip through `toISOString` is not belt and braces. `Date` rolls a
 * date that does not exist forward rather than refusing it, and 2026-02-30
 * rolls to March the second, which is a Monday: a check that only asked
 * `getUTCDay()` would take it and settle a week nobody named. It also catches
 * the key that is not a date at all, which `addDays` turns into a RangeError
 * from the middle of a settlement.
 */
export function isPeriodStartKey(rule: RuleConfig, periodKey: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(periodKey)) return false;
  const day = new Date(`${periodKey}T00:00:00.000Z`);
  if (Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== periodKey) return false;
  return rule.period === "day" || day.getUTCDay() === 1; // 1 = Monday
}

export function weekDayMarks(
  sessions: SessionRecord[],
  rule: RuleConfig,
  timezone: string,
  now: Date,
): DayMark[] {
  const todayKey = dayKeyFor(now, timezone);
  const done = new Set(
    sessions
      .filter((s) => isValidSession(s, rule, timezone))
      .map((s) => dayKeyFor(s.startedAt, timezone)),
  );

  return weekDayKeys(timezone, now).map((key, i) => ({
    key,
    label: DAY_LABELS[i],
    state: done.has(key) ? "done" : key === todayKey ? "today" : "ghost",
    isToday: key === todayKey,
  }));
}

export function isTodayDone(marks: DayMark[]): boolean {
  return marks.some((m) => m.isToday && m.state === "done");
}

const COUNT_WORDS = ["None", "One", "Two", "Three", "Four", "Five", "Six", "Seven"];

/** Spells small counts, which read better than digits inside a sentence. */
export function spell(n: number): string {
  return COUNT_WORDS[n] ?? String(n);
}

export function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

function sentenceCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** The rule in three flat clauses: how often, how long, what counts as proof. */
export function ruleSentence(rule: RuleConfig): string {
  const cadence = `${spell(rule.cadence).toLowerCase()} ${
    rule.cadence === 1 ? "day" : "days"
  } a ${rule.period}`;

  const mins = rule.minDurationMins;
  const duration =
    mins === null
      ? null
      : mins % 60 === 0
        ? `${spell(mins / 60).toLowerCase()} ${mins === 60 ? "hour" : "hours"}`
        : `${mins} minutes`;

  const proof = rule.proof === "photo" ? "photo proof" : "taken on your word";

  return [cadence, duration, proof]
    .filter((part): part is string => part !== null)
    .map(sentenceCase)
    .join(". ")
    .concat(".");
}

/** Days still available in the crew-local week, counting today. */
export function daysLeft(marks: DayMark[]): number {
  const todayIndex = marks.findIndex((m) => m.isToday);
  if (todayIndex < 0) return 0;
  return marks.length - todayIndex - (isTodayDone(marks) ? 1 : 0);
}

/**
 * The record, stated. It does not congratulate and it does not scold — it says
 * what is left and whether today has happened.
 */
export function standingLine(daysDone: number, required: number, todayDone: boolean): string {
  const short = required - daysDone;
  if (short <= 0) return "Made. The rest is yours.";
  if (todayDone) return `${spell(short)} to go.`;
  return `${spell(short)} to go. Today is not done.`;
}

const WEEKDAYS = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];

/**
 * The weekday a bare day key falls on. Day keys carry no timezone — they are
 * already the crew's local calendar date — so this reads the key itself rather
 * than converting anything. Same reasoning as `addDays` above.
 */
export function weekdayName(dayKey: string): string {
  return WEEKDAYS[new Date(`${dayKey}T00:00:00.000Z`).getUTCDay()];
}
