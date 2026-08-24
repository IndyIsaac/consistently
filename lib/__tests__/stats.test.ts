// lib/__tests__/stats.test.ts
import { describe, it, expect } from "vitest";
import { currentStreak, longestStreak, leaderboard } from "@/lib/stats";
import type { RuleConfig } from "@/lib/rules";

const rule: RuleConfig = {
  cadence: 5, period: "week", sessionType: "checkin", minDurationMins: null,
  windowStart: "00:00", windowEnd: "23:59", proof: "photo",
  failsWhenMissedExceeds: 0, split: "equal", exemption: "majority", durationPeriods: 4,
};

const TZ = "UTC";
const day = (iso: string) => ({ startedAt: new Date(`${iso}T09:00:00.000Z`), endedAt: null });

describe("streaks", () => {
  it("counts consecutive days ending today", () => {
    const sessions = [day("2026-08-23"), day("2026-08-24"), day("2026-08-25")];
    expect(currentStreak(sessions, rule, TZ, new Date("2026-08-25T12:00:00.000Z"))).toBe(3);
  });

  it("still counts a streak that ended yesterday", () => {
    const sessions = [day("2026-08-23"), day("2026-08-24")];
    expect(currentStreak(sessions, rule, TZ, new Date("2026-08-25T12:00:00.000Z"))).toBe(2);
  });

  it("returns zero when the last session was two days ago", () => {
    const sessions = [day("2026-08-22"), day("2026-08-23")];
    expect(currentStreak(sessions, rule, TZ, new Date("2026-08-25T12:00:00.000Z"))).toBe(0);
  });

  it("finds the longest run anywhere in the history", () => {
    const sessions = [
      day("2026-08-01"), day("2026-08-02"), day("2026-08-03"), day("2026-08-04"),
      day("2026-08-10"), day("2026-08-11"),
    ];
    expect(longestStreak(sessions, rule, TZ)).toBe(4);
  });

  it("returns zero for no sessions", () => {
    expect(longestStreak([], rule, TZ)).toBe(0);
    expect(currentStreak([], rule, TZ, new Date())).toBe(0);
  });

  // Beyond the brief: every fixture above uses TZ = "UTC", so an implementation that
  // silently hardcodes "UTC" instead of using the `timezone` parameter would pass all
  // of them. This test uses Asia/Tokyo (UTC+9, no DST) with instants chosen so that the
  // Tokyo-local day differs from the raw UTC day: the session (2026-08-23T20:00Z) lands
  // on 2026-08-24 in Tokyo but 2026-08-23 in UTC, and "today" (2026-08-25T03:00Z) is
  // 2026-08-25 in both zones. Correctly zoned, the session is yesterday relative to
  // today (grace day, streak 1). A hardcoded-UTC implementation would see the session
  // as two days before today and return 0.
  it("zones by the given timezone, not a hardcoded UTC", () => {
    const sessions = [{ startedAt: new Date("2026-08-23T20:00:00.000Z"), endedAt: null }];
    const today = new Date("2026-08-25T03:00:00.000Z");
    expect(currentStreak(sessions, rule, "Asia/Tokyo", today)).toBe(1);
  });
});

describe("leaderboard", () => {
  it("sorts by days done, then by current streak", () => {
    const rows = leaderboard(
      [
        { memberId: "a", displayName: "Ana", sessions: [day("2026-08-24"), day("2026-08-25")] },
        { memberId: "b", displayName: "Ben", sessions: [day("2026-08-25")] },
        { memberId: "c", displayName: "Cal", sessions: [] },
      ],
      rule, TZ, new Date("2026-08-25T12:00:00.000Z"),
    );
    expect(rows.map((r) => r.memberId)).toEqual(["a", "b", "c"]);
    expect(rows[0].daysDone).toBe(2);
    expect(rows[0].required).toBe(5);
    expect(rows[2].currentStreak).toBe(0);
  });

  // Beyond the brief: the test above never ties on daysDone, so it can't exercise the
  // currentStreak tie-break -- an implementation that sorted by daysDone alone (ignoring
  // currentStreak entirely) would still pass it. Here both members have daysDone = 2;
  // "y" has a consecutive run (currentStreak 2) and "x" does not (currentStreak 1), so
  // only a correct tie-break puts y first.
  it("breaks a daysDone tie by current streak", () => {
    const today = new Date("2026-08-25T12:00:00.000Z");
    const rows = leaderboard(
      [
        { memberId: "x", displayName: "Xen", sessions: [day("2026-08-20"), day("2026-08-25")] },
        { memberId: "y", displayName: "Yui", sessions: [day("2026-08-24"), day("2026-08-25")] },
      ],
      rule, TZ, today,
    );
    expect(rows[0].daysDone).toBe(rows[1].daysDone);
    expect(rows.map((r) => r.memberId)).toEqual(["y", "x"]);
    expect(rows[0].currentStreak).toBe(2);
    expect(rows[1].currentStreak).toBe(1);
  });
});
