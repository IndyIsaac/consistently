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
});

describe("dayKeyFor", () => {
  it("keys a session to the day it started, not the day it ended", () => {
    const startedAt = new Date("2026-08-25T16:50:00.000Z"); // 23:50 in Bangkok
    expect(dayKeyFor(startedAt, "Asia/Bangkok")).toBe("2026-08-25");
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
