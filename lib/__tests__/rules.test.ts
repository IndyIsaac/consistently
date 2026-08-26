import { describe, it, expect } from "vitest";
import { ZodError } from "zod";
import { periodDayKeys } from "@/lib/pact-view";
import {
  RuleConfigSchema,
  isValidSession,
  countValidDays,
  hasFailed,
  cadenceOutlook,
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

  it("safeParse never throws on a malformed windowStart, even though the cross-field refine also inspects it", () => {
    // The field-level .regex(TIME_RE) check is non-aborting in zod 4: the object-level
    // .refine() still runs and receives the raw invalid string. toMinutes (used by the
    // refine) throws on malformed input — that throw must not escape the refine and
    // break safeParse's no-throw contract.
    let result: ReturnType<typeof RuleConfigSchema.safeParse> | undefined;
    expect(() => {
      result = RuleConfigSchema.safeParse({ ...gym, windowStart: "garbage" });
    }).not.toThrow();
    expect(result?.success).toBe(false);
  });

  it("parse throws a ZodError (not a raw Error) for a malformed windowStart", () => {
    // Asserting merely "it throws" would have passed even when parse threw a raw Error
    // instead of a ZodError — the exact regression this pins.
    let caught: unknown;
    try {
      RuleConfigSchema.parse({ ...gym, windowStart: "garbage" });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ZodError);
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

describe("cadence outlook", () => {
  // Thursday of a five-a-week week: Thu, Fri, Sat, Sun still available.
  it("is neutral while the cadence is still reachable", () => {
    const o = cadenceOutlook(3, 4, gym);
    expect(o).toEqual({ daysNeeded: 2, daysAvailable: 4, met: false, outOfReach: false });
  });

  it("still counts a perfect run as possible when needed equals available", () => {
    // The boundary from the possible side. Four days left and four to go is a
    // week with no slack in it, but it is not yet a forfeit -- calling it one
    // here would tell someone they had lost ฿1,000 they could still keep.
    expect(cadenceOutlook(1, 4, gym).outOfReach).toBe(false);
  });

  it("flips to out of reach the moment one more day is needed than remains", () => {
    // ...and the other side of the same boundary, one day later: the same
    // member, one day gone, nothing done. This is the flip the bot announces.
    const o = cadenceOutlook(1, 3, gym);
    expect(o.daysNeeded).toBe(4);
    expect(o.daysAvailable).toBe(3);
    expect(o.outOfReach).toBe(true);
  });

  it("is out of reach with no days left and days still owed", () => {
    expect(cadenceOutlook(4, 0, gym)).toEqual({
      daysNeeded: 1,
      daysAvailable: 0,
      met: false,
      outOfReach: true,
    });
  });

  it("is met, and never out of reach, once the cadence is covered", () => {
    const o = cadenceOutlook(5, 3, gym);
    expect(o.met).toBe(true);
    expect(o.daysNeeded).toBe(0);
    expect(o.outOfReach).toBe(false);
  });

  it("stays met with no days left, rather than reading as a forfeit", () => {
    // Sunday night, cadence covered. Zero available and zero needed must not
    // trip the `needed > available` test.
    const o = cadenceOutlook(5, 0, gym);
    expect(o.met).toBe(true);
    expect(o.outOfReach).toBe(false);
  });

  it("counts overshooting the cadence as met", () => {
    expect(cadenceOutlook(7, 0, gym).met).toBe(true);
  });

  it("owes fewer days when the rule forgives a miss, so the flip comes later", () => {
    // failsWhenMissedExceeds: 1 forgives one missed day, so only four of the
    // five are actually owed. Reading `cadence` alone would call this out of
    // reach a day early.
    const forgiving: RuleConfig = { ...gym, failsWhenMissedExceeds: 1 };
    expect(cadenceOutlook(1, 3, forgiving)).toEqual({
      daysNeeded: 3,
      daysAvailable: 3,
      met: false,
      outOfReach: false,
    });
    expect(cadenceOutlook(1, 2, forgiving).outOfReach).toBe(true);
  });

  it("is met from the start when the rule forgives every day of the cadence", () => {
    expect(cadenceOutlook(0, 0, { ...gym, failsWhenMissedExceeds: 5 }).met).toBe(true);
  });

  it("clamps negative counts instead of answering nonsense", () => {
    expect(cadenceOutlook(-3, -2, gym)).toEqual({
      daysNeeded: 5,
      daysAvailable: 0,
      met: false,
      outOfReach: true,
    });
  });
});

describe("periodDayKeys", () => {
  const weekly: RuleConfig = { ...gym, period: "week" };
  const daily: RuleConfig = { ...gym, period: "day" };
  const friday = new Date("2026-08-28T02:12:00.000Z"); // Fri 28 Aug, 09:12 Bangkok

  it("returns the crew-local week, Monday first, for a weekly rule", () => {
    const keys = periodDayKeys(weekly, "Asia/Bangkok", friday);
    expect(keys).toHaveLength(7);
    expect(keys[0]).toBe("2026-08-24");
    expect(keys[6]).toBe("2026-08-30");
  });

  it("returns just today for a daily rule", () => {
    expect(periodDayKeys(daily, "Asia/Bangkok", friday)).toEqual(["2026-08-28"]);
  });

  it("keys to the crew's timezone, not the server's", () => {
    // 23:50 UTC on the 27th is already the 28th in Bangkok.
    const lateUtc = new Date("2026-08-27T17:30:00.000Z");
    expect(periodDayKeys(daily, "Asia/Bangkok", lateUtc)).toEqual(["2026-08-28"]);
  });
});
