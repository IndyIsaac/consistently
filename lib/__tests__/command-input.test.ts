import { describe, expect, it } from "vitest";
import { enterTakesSuggestion } from "@/lib/bot";

/* ---------------------------------------------------------------------------
 * What Enter does when the command list is open.
 *
 * The list opens on focus, which is the discovery mechanism and is deliberate.
 * The consequence was not: with nothing typed, every command matches, the
 * highlight sits on the first of them, and Enter ran it. A member who tapped
 * the field and pressed Enter -- to dismiss it, or by habit -- silently ran
 * /status and got an answer to a question they had not asked.
 *
 * The submit button already refused an empty field. Only this path did not.
 * ------------------------------------------------------------------------- */

describe("whether Enter takes the highlighted command", () => {
  it("does not, on an empty field", () => {
    expect(enterTakesSuggestion("", "status")).toBe(false);
  });

  it("does not, on a field of only spaces", () => {
    expect(enterTakesSuggestion("   ", "status")).toBe(false);
  });

  it("completes a prefix to the command it is highlighting", () => {
    expect(enterTakesSuggestion("hel", "help")).toBe(true);
  });

  it("does not, when what is typed is already that command", () => {
    // Enter runs it instead, via the form.
    expect(enterTakesSuggestion("help", "help")).toBe(false);
  });

  it("does not, when there is nothing highlighted", () => {
    expect(enterTakesSuggestion("zzz", undefined)).toBe(false);
  });
});
