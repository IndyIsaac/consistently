import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { requireUser, UnauthorizedError } from "@/lib/auth";

/* A signed-in member puts an image somewhere every device can read it. Pact
 * reference photos, profile avatars and check-in photos all come through here
 * now -- there is no second path, and lib/upload.ts is the only caller.
 * Without BLOB_READ_WRITE_TOKEN this answers 503 rather than throwing, and a
 * check-in on a photo pact is refused rather than recorded blind. */

const MAX_BYTES = 5_000_000;

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
  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ error: "Images only." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "That image is too large." }, { status: 413 });
  }

  const blob = await put(`uploads/${crypto.randomUUID()}`, file, {
    access: "public",
    contentType: file.type,
  });
  return NextResponse.json({ url: blob.url });
}
