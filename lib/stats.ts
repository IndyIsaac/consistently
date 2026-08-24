import { dayKeyFor, isValidSession, type RuleConfig, type SessionRecord } from "@/lib/rules";

export type LeaderRow = {
  memberId: string;
  displayName: string;
  daysDone: number;
  required: number;
  currentStreak: number;
  longestStreak: number;
};

function validDayKeys(
  sessions: SessionRecord[],
  rule: RuleConfig,
  timezone: string,
): string[] {
  const keys = new Set<string>();
  for (const s of sessions) {
    if (isValidSession(s, rule, timezone)) keys.add(dayKeyFor(s.startedAt, timezone));
  }
  return [...keys].sort();
}

/**
 * Steps a bare calendar day key (e.g. "2026-08-25") back one day. Day keys carry no
 * timezone information -- they are already the crew's local calendar date, produced by
 * `dayKeyFor` -- so stepping them with UTC arithmetic is safe and introduces no DST
 * hazard. Do not reintroduce timezone conversion here.
 */
function prevDayKey(key: string): string {
  const d = new Date(`${key}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * A streak survives one day of grace: it counts if the last valid day was today or
 * yesterday, so checking in tomorrow morning does not read as a broken streak.
 */
export function currentStreak(
  sessions: SessionRecord[],
  rule: RuleConfig,
  timezone: string,
  today: Date,
): number {
  const keys = validDayKeys(sessions, rule, timezone);
  if (keys.length === 0) return 0;

  const todayKey = dayKeyFor(today, timezone);
  const yesterdayKey = prevDayKey(todayKey);
  const last = keys[keys.length - 1];
  if (last !== todayKey && last !== yesterdayKey) return 0;

  const set = new Set(keys);
  let streak = 0;
  let cursor = last;
  while (set.has(cursor)) {
    streak += 1;
    cursor = prevDayKey(cursor);
  }
  return streak;
}

export function longestStreak(
  sessions: SessionRecord[],
  rule: RuleConfig,
  timezone: string,
): number {
  const keys = validDayKeys(sessions, rule, timezone);
  let best = 0;
  let run = 0;
  let previous: string | null = null;

  for (const key of keys) {
    run = previous !== null && prevDayKey(key) === previous ? run + 1 : 1;
    previous = key;
    if (run > best) best = run;
  }
  return best;
}

export function leaderboard(
  entries: { memberId: string; displayName: string; sessions: SessionRecord[] }[],
  rule: RuleConfig,
  timezone: string,
  today: Date,
): LeaderRow[] {
  return entries
    .map((e) => ({
      memberId: e.memberId,
      displayName: e.displayName,
      daysDone: validDayKeys(e.sessions, rule, timezone).length,
      required: rule.cadence,
      currentStreak: currentStreak(e.sessions, rule, timezone, today),
      longestStreak: longestStreak(e.sessions, rule, timezone),
    }))
    .sort((a, b) => b.daysDone - a.daysDone || b.currentStreak - a.currentStreak);
}
