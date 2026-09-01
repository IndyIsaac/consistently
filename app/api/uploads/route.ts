import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { requireUser, UnauthorizedError } from "@/lib/auth";
import { judgeImage } from "@/lib/images";

/* A signed-in member puts an image somewhere every device can read it. Pact
 * reference photos, profile avatars and check-in photos all come through here
 * now -- there is no second path, and lib/upload.ts is the only caller.
 * Without BLOB_READ_WRITE_TOKEN this answers 503 rather than throwing, and a
 * check-in on a photo pact is refused rather than recorded blind. */

/**
 * Ten megabytes. Five turned away ordinary photographs: a 12-megapixel shot off
 * a recent phone is routinely six or seven, and being told the picture of
 * yourself is "too large" is the same dead end as it not working at all.
 */
const MAX_BYTES = 10_000_000;

export async function POST(req: NextRequest) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json({ error: "Photo upload is not configured." }, { status: 503 });
  }
  try {
    await requireUser(req);
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: 401 });
    }
    throw e;
  }

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file." }, { status: 400 });
  }
  /**
   * Not `startsWith("image/")`. That said yes to the HEIC every iPhone shoots,
   * which stored fine and then could not be drawn by any browser but Safari --
   * a photo that exists and never appears, with nothing said about it. It also
   * said no to a file whose type the browser left empty, which is an ordinary
   * JPEG. See lib/images.ts.
   */
  const verdict = judgeImage(file);
  if (!verdict.ok) {
    return NextResponse.json({ error: verdict.reason }, { status: 415 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `That image is too large. The limit is ${MAX_BYTES / 1_000_000}MB.` },
      { status: 413 },
    );
  }

  const blob = await put(`uploads/${crypto.randomUUID()}`, file, {
    access: "public",
    // The judged type, not the claimed one: a file with no type is identified
    // by its extension, and must be served as what it actually is.
    contentType: verdict.contentType,
  });
  return NextResponse.json({ url: blob.url });
}
