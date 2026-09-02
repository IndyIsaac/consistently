import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getSession } from "@/lib/mock-session";

describe("demo crew faces", () => {
  it("gives each person one face and does not reuse it on anyone else", async () => {
    const session = await getSession();
    const byUser = new Map<string, string>();

    for (const pact of session.pacts) {
      for (const member of pact.crew) {
        expect(member.avatarUrl, `${member.displayName} has no face`).toBeTruthy();
        const seen = byUser.get(member.userId);
        if (seen) expect(seen).toBe(member.avatarUrl);
        else byUser.set(member.userId, member.avatarUrl!);
      }
    }

    const urls = [...byUser.values()];
    expect(new Set(urls).size).toBe(urls.length);

    for (const url of urls) {
      expect(existsSync(`public${url}`), `missing ${url}`).toBe(true);
    }
  });
});
