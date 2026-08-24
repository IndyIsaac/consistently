import { describe, it, expect } from "vitest";
import {
  RuleConfigSchema,
  isValidSession,
  countValidDays,
  hasFailed,
  dayKeyFor,
  type RuleConfig,
} from "@/lib/rules";

const gym: RuleConfig = {
  cadence: 5,
  period: "week",
  sessionType: "checkin_checkout",
  minDurationMins: 30,
  windowStart: "05:00",
  windowEnd: "23:00",
  proof: "photo",
  failsWhenMissedExceeds: 0,
  split: "equal",
  exemption: "majority",
  durationPeriods: 4,
};

describe("rule config schema", () => {
  it("accepts a valid gym config", () => {
    expect(() => RuleConfigSchema.parse(gym)).not.toThrow();
  });

  it("rejects cadence of zero", () => {
    expect(() => RuleConfigSchema.parse({ ...gym, cadence: 0 })).toThrow();
  });

  it("rejects a midnight-wrapping window instead of silently forfeiting every stake", () => {
    // windowStart: "22:00" / windowEnd: "02:00" as a plain interval (1320-120) matches
    // no start minute at all — every session would be rejected. Reject the config instead.
    expect(() =>
      RuleConfigSchema.parse({ ...gym, windowStart: "22:00", windowEnd: "02:00" }),
    ).toThrow();
  });
});

describe("dayKeyFor", () => {
  it("keys a session to the day it started, not the day it ended", () => {
    const startedAt = new Date("2026-08-25T16:50:00.000Z"); // 23:50 in Bangkok
    expect(dayKeyFor(startedAt, "Asia/Bangkok")).toBe("2026-08-25");
  });

  it("keys to the local day even when it is later than the UTC day", () => {
    // 17:30 UTC + 7h = 2026-08-26T00:30 Bangkok — UTC says the 25th, local says the 26th.
    const startedAt = new Date("2026-08-25T17:30:00.000Z");
    expect(dayKeyFor(startedAt, "Asia/Bangkok")).toBe("2026-08-26");
  });

  it("keys to the local day even when it is earlier than the UTC day", () => {
    // 03:00 UTC - 4h (America/New_York is EDT in August) = 2026-08-24T23:00 local —
    // UTC says the 25th, local says the 24th.
    const startedAt = new Date("2026-08-25T03:00:00.000Z");
    expect(dayKeyFor(startedAt, "America/New_York")).toBe("2026-08-24");
  });
});

describe("isValidSession", () => {
  it("accepts a 45 minute session inside the window", () => {
    const s = {
      startedAt: new Date("2026-08-25T02:00:00.000Z"), // 09:00 Bangkok
      endedAt: new Date("2026-08-25T02:45:00.000Z"),
    };
    expect(isValidSession(s, gym, "Asia/Bangkok")).toBe(true);
  });

  it("rejects a session shorter than the minimum", () => {
    const s = {
      startedAt: new Date("2026-08-25T02:00:00.000Z"),
      endedAt: new Date("2026-08-25T02:10:00.000Z"),
    };
    expect(isValidSession(s, gym, "Asia/Bangkok")).toBe(false);
  });

  it("rejects a session that was never closed", () => {
    const s = { startedAt: new Date("2026-08-25T02:00:00.000Z"), endedAt: null };
    expect(isValidSession(s, gym, "Asia/Bangkok")).toBe(false);
  });

  it("rejects a session started outside the window", () => {
    const s = {
      startedAt: new Date("2026-08-24T20:00:00.000Z"), // 03:00 Bangkok, before 05:00
      endedAt: new Date("2026-08-24T20:45:00.000Z"),
    };
    expect(isValidSession(s, gym, "Asia/Bangkok")).toBe(false);
  });

  it("accepts a checkin-only rule with no end time", () => {
    const wake: RuleConfig = {
      ...gym,
      cadence: 7,
      sessionType: "checkin",
      minDurationMins: null,
      windowStart: "05:00",
      windowEnd: "07:00",
    };
    const s = {
      startedAt: new Date("2026-08-24T23:30:00.000Z"), // 06:30 Bangkok
      endedAt: null,
    };
    expect(isValidSession(s, wake, "Asia/Bangkok")).toBe(true);
  });

  it("rejects a session that ends before it starts, even with no minimum duration", () => {
    const noMin: RuleConfig = { ...gym, minDurationMins: null };
    const s = {
      startedAt: new Date("2026-08-25T02:45:00.000Z"), // 09:45 Bangkok
      endedAt: new Date("2026-08-25T02:00:00.000Z"), // 09:00 Bangkok, before the start
    };
    expect(isValidSession(s, noMin, "Asia/Bangkok")).toBe(false);
  });

  it("throws instead of accepting everything when the rule's time strings are malformed", () => {
    // RuleConfig is a compile-time type; a value read from storage and cast can bypass
    // RuleConfigSchema entirely. toMinutes must not silently produce NaN comparisons.
    const bad = { ...gym, windowStart: "garbage" } as RuleConfig;
    const s = {
      startedAt: new Date("2026-08-25T02:00:00.000Z"),
      endedAt: new Date("2026-08-25T02:45:00.000Z"),
    };
    expect(() => isValidSession(s, bad, "Asia/Bangkok")).toThrow();
  });
});

describe("countValidDays", () => {
  it("counts two sessions on the same day as one day", () => {
    const sessions = [
      {
        startedAt: new Date("2026-08-25T02:00:00.000Z"),
        endedAt: new Date("2026-08-25T02:45:00.000Z"),
      },
      {
        startedAt: new Date("2026-08-25T10:00:00.000Z"),
        endedAt: new Date("2026-08-25T10:45:00.000Z"),
      },
    ];
    expect(countValidDays(sessions, gym, "Asia/Bangkok")).toBe(1);
  });

  it("counts two sessions that share a local day but straddle two UTC days as one day", () => {
    // The actual gaming vector: sessions on either side of the UTC date line, within the
    // same Bangkok calendar day (2026-08-26).
    const sessions = [
      {
        // 23:00 UTC Aug 25 = 06:00 Bangkok Aug 26
        startedAt: new Date("2026-08-25T23:00:00.000Z"),
        endedAt: new Date("2026-08-25T23:45:00.000Z"),
      },
      {
        // 03:00 UTC Aug 26 = 10:00 Bangkok Aug 26
        startedAt: new Date("2026-08-26T03:00:00.000Z"),
        endedAt: new Date("2026-08-26T03:45:00.000Z"),
      },
    ];
    expect(countValidDays(sessions, gym, "Asia/Bangkok")).toBe(1);
  });
});

describe("hasFailed", () => {
  it("fails when fewer than the cadence was met", () => {
    const sessions = Array.from({ length: 4 }, (_, i) => ({
      startedAt: new Date(`2026-08-2${4 + i}T02:00:00.000Z`),
      endedAt: new Date(`2026-08-2${4 + i}T02:45:00.000Z`),
    }));
    expect(hasFailed(sessions, gym, "Asia/Bangkok")).toBe(true);
  });

  it("passes when the cadence was met exactly", () => {
    const sessions = Array.from({ length: 5 }, (_, i) => ({
      startedAt: new Date(`2026-08-2${4 + i}T02:00:00.000Z`),
      endedAt: new Date(`2026-08-2${4 + i}T02:45:00.000Z`),
    }));
    expect(hasFailed(sessions, gym, "Asia/Bangkok")).toBe(false);
  });
});
