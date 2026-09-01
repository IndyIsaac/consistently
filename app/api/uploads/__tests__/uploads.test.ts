import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/* ---------------------------------------------------------------------------
 * What the upload route accepts, which is what every photo in the product
 * depends on: the avatar, a rule's reference shots, and the check-in itself.
 * ------------------------------------------------------------------------- */

vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  requireUser: async () => ({ id: "u1", walletAddress: "w1", displayName: "T" }),
}));

const put = vi.fn(async () => ({ url: "https://blob.example/uploads/x" }));
beforeEach(() => put.mockClear());
vi.mock("@vercel/blob", () => ({ put: (...a: unknown[]) => put(...(a as [])) }));

beforeAll(() => {
  process.env.BLOB_READ_WRITE_TOKEN = "test-token";
});

const { POST } = await import("@/app/api/uploads/route");

function send(file: File) {
  const form = new FormData();
  form.append("file", file);
  return POST(new NextRequest("http://localhost/api/uploads", { method: "POST", body: form }));
}

/** A file of a given type and size, without allocating anything real. */
function fileOf(type: string, name = "photo", bytes = 1024) {
  return new File([new Uint8Array(bytes)], name, { type });
}

describe("what the upload route accepts", () => {
  it.each([
    ["image/jpeg", "a photo from any camera"],
    ["image/png", "a screenshot"],
    ["image/webp", "what modern phones and browsers produce"],
    ["image/gif", "still allowed; it is an image"],
  ])("accepts %s -- %s", async (type) => {
    const res = await send(fileOf(type));
    expect(res.status).toBe(200);
  });

  it("refuses something that is not an image", async () => {
    const res = await send(fileOf("application/pdf", "doc.pdf"));
    expect(res.status).toBe(415);
  });

  it("refuses a file too large to be worth sending", async () => {
    const res = await send(fileOf("image/jpeg", "big.jpg", 10_000_001));
    expect(res.status).toBe(413);
  });

  it("accepts a photograph off a recent phone", async () => {
    // Six megapixels of JPEG. The old five-megabyte ceiling turned these away.
    const res = await send(fileOf("image/jpeg", "IMG_0002.JPG", 6_500_000));
    expect(res.status).toBe(200);
  });

  /* --- the two that were the bug ---------------------------------------- */

  it("refuses an iPhone HEIC, and says what to do about it", async () => {
    /**
     * It used to be stored. `startsWith("image/")` says yes to HEIC, so the
     * upload succeeded, the URL went into the database, and then nothing but
     * Safari could draw it -- the avatar fell back to initials and nobody was
     * told why. A refusal that names the setting is worth more than a photo
     * that silently never appears.
     */
    const res = await send(fileOf("image/heic", "IMG_0001.HEIC"));
    expect(res.status).toBe(415);
    expect((await res.json()).error).toMatch(/HEIC/);
    expect(put).not.toHaveBeenCalled();
  });

  it("refuses HEIC recognised by its extension when the type does not survive the body", async () => {
    const res = await send(fileOf("", "IMG_0001.HEIC"));
    expect(res.status).toBe(415);
    expect((await res.json()).error).toMatch(/HEIC/);
  });

  it("still takes a JPEG whose type arrives as application/octet-stream", async () => {
    // The other half: a plain prefix test refused these as "Images only."
    const res = await send(fileOf("", "holiday.JPG"));
    expect(res.status).toBe(200);
  });

  it("stores an unidentified file as what its extension says it is", async () => {
    await send(fileOf("", "shot.png"));
    expect(put).toHaveBeenCalledWith(
      expect.stringContaining("uploads/"),
      expect.anything(),
      expect.objectContaining({ contentType: "image/png" }),
    );
  });
});
