import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { INVITE_COOKIE, proxy } from "@/proxy";

/* ---------------------------------------------------------------------------
 * The scan, from the other device.
 *
 * Both of these were live on production and neither had a test. They only show
 * up across two machines -- one crew member on a laptop showing the QR, one on
 * a phone scanning it -- which is the one shape nothing in this suite covered.
 * ------------------------------------------------------------------------- */

const HOST = "https://consistently.example";

function scan(path: string, cookies: Record<string, string> = {}) {
  const req = new NextRequest(`${HOST}${path}`);
  for (const [k, v] of Object.entries(cookies)) req.cookies.set(k, v);
  return proxy(req);
}

describe("scanning an invite QR", () => {
  it("stashes the token and strips it from the URL", () => {
    const res = scan("/?invite=tok_abc");
    expect(res.cookies.get(INVITE_COOKIE)?.value).toBe("tok_abc");
    expect(res.headers.get("location")).not.toContain("invite=");
  });

  it("sends a signed-in scanner to /join, not the dashboard", () => {
    // The likeliest way anyone scans: already a member, phone in hand. Landing
    // on /dashboard leaves the token unredeemed until it expires.
    const res = scan("/?invite=tok_abc", { "privy-token": "session" });
    expect(res.headers.get("location")).toBe(`${HOST}/join`);
  });

  it("sends a signed-out scanner to the door, keeping the token", () => {
    const res = scan("/?invite=tok_abc");
    expect(new URL(res.headers.get("location")!).pathname).toBe("/");
    expect(res.cookies.get(INVITE_COOKIE)?.value).toBe("tok_abc");
  });
});
