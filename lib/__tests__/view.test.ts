import { describe, it, expect } from "vitest";
import { initialsOf } from "@/lib/view";

describe("initialsOf", () => {
  it("takes the first letter of the first two words", () => {
    expect(initialsOf("Nat Suwannarat")).toBe("NS");
  });

  it("takes two letters from a one-word name, not one", () => {
    // Avatars sit in a row. A lone "I" beside "NS" reads as a fault.
    expect(initialsOf("Indy")).toBe("IN");
  });

  it("ignores a third name", () => {
    expect(initialsOf("Pim Chai Yaphum")).toBe("PC");
  });

  it("copes with extra whitespace", () => {
    expect(initialsOf("  Dave   Whitfield ")).toBe("DW");
  });

  it("handles a single letter without padding it", () => {
    expect(initialsOf("X")).toBe("X");
  });

  it("does not throw on an empty name", () => {
    expect(initialsOf("   ")).toBe("?");
  });
});
