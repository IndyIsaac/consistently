import { describe, expect, it } from "vitest";
import { cookieLifetime } from "@/app/api/session/route";

/* ---------------------------------------------------------------------------
 * How long the fallback cookie lives.
 *
 * `Max-Age`, never `Expires`, is the whole point: a relative lifetime is not
 * compared against the browser's clock, so a machine running fast cannot be
 * handed a cookie that is already expired. That is the failure this route
 * exists to route around, seen in Railway's HTTP logs as /dashboard bouncing
 * to / four times with no cookie on any of them.
 * ------------------------------------------------------------------------- */

/** A JWT whose payload says it expires `inSeconds` from `now`. Unsigned: this
 *  function reads a token the caller has already verified. */
function tokenExpiringIn(inSeconds: number, now: number): string {
  const exp = Math.floor(now / 1000) + inSeconds;
  const payload = Buffer.from(JSON.stringify({ exp })).toString("base64url");
  return `header.${payload}.signature`;
}

const NOW = Date.UTC(2026, 7, 31, 12, 0, 0);

describe("how long the fallback cookie lives", () => {
  it("lives as long as the token has left", () => {
    expect(cookieLifetime(tokenExpiringIn(600, NOW), NOW)).toBe(600);
  });

  it("never outlives an hour, however long the token claims", () => {
    expect(cookieLifetime(tokenExpiringIn(60 * 60 * 24, NOW), NOW)).toBe(3600);
  });

  it("is nothing for a token that has already expired", () => {
    // The route refuses rather than setting a cookie born dead -- which is the
    // exact bug it exists to route around.
    expect(cookieLifetime(tokenExpiringIn(-120, NOW), NOW)).toBe(0);
  });

  it("falls back to an hour when the payload cannot be read", () => {
    // A carrier, not an authority: every route re-verifies the token inside
    // it, so an over-long cookie ends in a redirect and not in access.
    expect(cookieLifetime("not-a-jwt", NOW)).toBe(3600);
    expect(cookieLifetime("a.!!!not-base64!!!.c", NOW)).toBe(3600);
  });
});
