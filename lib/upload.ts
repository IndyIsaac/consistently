/* ---------------------------------------------------------------------------
 * Putting an image somewhere every other device can read it.
 *
 * Three callers: the two reference slots on a rule, the avatar on a profile,
 * and the camera in the channel. Every one of those photos is looked at by
 * somebody who is not the person who took it -- another member on another
 * phone, or a projector -- which is the whole reason this is a round trip to
 * blob storage and not `URL.createObjectURL`. An object URL resolves only in
 * the tab that made it and dies with it, so a `blob:` string written to the
 * database is a broken image everywhere it matters and on a reload.
 *
 * It lived in three copies before this file, which is how the check-in photo
 * ended up as the one that never got wired up.
 * ------------------------------------------------------------------------- */

import { getAccessToken } from "@privy-io/react-auth";

/**
 * Uploads one image and returns the URL every device can fetch it from.
 *
 * Throws with the route's own sentence, which the caller is expected to show
 * rather than swallow: the commonest failure by far is a 503 because
 * BLOB_READ_WRITE_TOKEN is unset, and "Photo upload is not configured" is
 * something a person can act on where a silent no-op is not.
 */
export async function upload(file: File): Promise<string> {
  /**
   * The bearer, not just the cookie.
   *
   * /api/uploads calls requireUser, and this sent no Authorization header --
   * so it stood entirely on `privy-token`, whose access token has an expiry
   * that privyIdFromCookie verifies. Once that aged out the route answered
   * 401 "Not signed in", and since this is the FIRST call a check-in makes,
   * it failed before the session request was ever attempted.
   *
   * lib/channel-client.ts had the identical bug. Onboarding and ProfileForm
   * never did, which is why those two kept working throughout.
   */
  const token = await getAccessToken().catch(() => null);

  const form = new FormData();
  form.append("file", file);
  // No content-type: the browser has to set the multipart boundary itself.
  const res = await fetch("/api/uploads", {
    method: "POST",
    headers: token ? { authorization: `Bearer ${token}` } : undefined,
    body: form,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? "Upload failed.");
  return body.url as string;
}
