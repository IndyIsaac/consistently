import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@privy-io/react-auth", () => ({
  getAccessToken: vi.fn(async () => "fresh-token"),
}));

/* ---------------------------------------------------------------------------
 * The transport behind every interactive thing in a channel: check in, check
 * out, react, and both sides of an exemption.
 *
 * Both of these were live. Together they made a channel that had been open
 * long enough for its token to age stop responding to any of those five
 * actions, and say nothing at all about it.
 * ------------------------------------------------------------------------- */

describe("the channel's transport", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.NEXT_PUBLIC_PRIVY_APP_ID = "test-app";
  });

  it("carries a bearer, so a stale cookie is not the only credential", async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(JSON.stringify({ sessionId: "s1" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { openSession } = await import("@/lib/channel-client");
    await openSession({ pactId: "p1", userWallet: "w1", photoUrl: null });

    const init = fetchMock.mock.calls[0]?.[1];
    const headers = init?.headers as Record<string, string> | undefined;
    expect(headers?.authorization).toBe("Bearer fresh-token");
  });

  it("surfaces a 401 as a sentence rather than throwing past every handler", async () => {
    // Channel.capture() rethrows anything that is not a ChannelError, and
    // CheckInCamera awaits it with no catch. A plain Error here is an
    // unhandled rejection: the button un-busies and the member is told
    // nothing, which is indistinguishable from a button that does nothing.
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(JSON.stringify({ error: "Session expired." }), { status: 401 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { openSession, ChannelError } = await import("@/lib/channel-client");
    await expect(
      openSession({ pactId: "p1", userWallet: "w1", photoUrl: null }),
    ).rejects.toBeInstanceOf(ChannelError);
  });
});
