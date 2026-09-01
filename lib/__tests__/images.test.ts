import { describe, expect, it } from "vitest";
import { DISPLAYABLE_IMAGE_TYPES, IMAGE_ACCEPT, judgeImage } from "@/lib/images";

/* ---------------------------------------------------------------------------
 * Whether a browser will be able to draw the thing we just stored.
 *
 * The avatar reported as "not working" was an upload that succeeded: HEIC went
 * in, the URL was saved, and nothing outside Safari could render it.
 * ------------------------------------------------------------------------- */

const file = (type: string, name: string) => ({ type, name });

describe("judging an image by what a browser can draw", () => {
  it.each(DISPLAYABLE_IMAGE_TYPES)("accepts %s", (type) => {
    const v = judgeImage(file(type, "photo"));
    expect(v.ok && v.contentType).toBe(type);
  });

  it("names HEIC in the refusal, rather than a generic no", () => {
    const v = judgeImage(file("image/heic", "IMG_0001.HEIC"));
    expect(v.ok).toBe(false);
    expect(!v.ok && v.reason).toMatch(/HEIC/);
    // The refusal has to be actionable: it is the default on every iPhone.
    expect(!v.ok && v.reason).toMatch(/Most Compatible/);
  });

  it("recognises HEIC by extension when no type is claimed", () => {
    expect(judgeImage(file("", "IMG_0001.heic")).ok).toBe(false);
    expect(judgeImage(file("application/octet-stream", "IMG.HEIF")).ok).toBe(false);
  });

  it("takes a JPEG whose type the browser left blank", () => {
    const v = judgeImage(file("", "holiday.JPG"));
    expect(v.ok && v.contentType).toBe("image/jpeg");
  });

  it("takes one the browser called application/octet-stream", () => {
    // What a browser sends when it cannot identify a file, and what a blank
    // type becomes crossing a multipart body.
    const v = judgeImage(file("application/octet-stream", "shot.png"));
    expect(v.ok && v.contentType).toBe("image/png");
  });

  it("is case-insensitive about both halves", () => {
    expect(judgeImage(file("IMAGE/JPEG", "x")).ok).toBe(true);
    expect(judgeImage(file("", "X.PnG")).ok).toBe(true);
  });

  it("refuses a document, whatever it is called", () => {
    expect(judgeImage(file("application/pdf", "doc.pdf")).ok).toBe(false);
    expect(judgeImage(file("", "notes.pdf")).ok).toBe(false);
  });

  it("refuses a file with no extension and no type rather than guessing", () => {
    expect(judgeImage(file("", "mystery")).ok).toBe(false);
  });

  it("does not answer for a key nobody put in the table", () => {
    /**
     * The extension comes from a filename the member chose, and a plain object
     * lookup walks the prototype chain. `constructor` is the one such key that
     * survives lowercasing, and it used to come back truthy -- so the refusal
     * read "function Object() { [native code] } photos cannot be shown in a
     * browser". Refused either way; the sentence was nonsense.
     */
    const v = judgeImage(file("", "photo.constructor"));
    expect(v.ok).toBe(false);
    expect(!v.ok && v.reason).toBe("That is not an image we can show. Try a JPEG or a PNG.");
    for (const name of ["x.toString", "y.valueOf", "z.hasOwnProperty", "w.__proto__"]) {
      const r = judgeImage(file("", name));
      expect(r.ok).toBe(false);
      expect(!r.ok && r.reason).not.toMatch(/native code/);
    }
  });

  it("advertises the same list to the file picker", () => {
    // Naming the types is what makes iOS convert HEIC to JPEG in the picker,
    // which is the only place that conversion can happen without a decoder.
    for (const t of DISPLAYABLE_IMAGE_TYPES) expect(IMAGE_ACCEPT).toContain(t);
    expect(IMAGE_ACCEPT).not.toContain("image/*");
  });
});
