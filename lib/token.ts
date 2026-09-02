import { getAccessToken } from "@privy-io/react-auth";

/* ---------------------------------------------------------------------------
 * The bearer, asked for in the one way that cannot take a screen down with it.
 *
 * `getAccessToken` is Privy's standalone function, not the hook, so it reads a
 * global the PrivyProvider installs. app/providers.tsx mounts that provider
 * only when NEXT_PUBLIC_PRIVY_APP_ID is exactly 25 characters -- deliberately,
 * because Privy throws during render on anything else. Every other path, the
 * zero-env demo included, renders the whole app with no provider at all.
 *
 * Without one this THROWS, synchronously: "No global PrivyClient instance
 * found." Every caller wrote `getAccessToken().catch(() => null)`, and a
 * `.catch` is attached to a promise that a synchronous throw never returns --
 * so the rejection they were guarding against was not the failure they got.
 *
 * It cost the check-in button. `upload()` is the first call a check-in makes,
 * and this line is the first thing in it, so the throw landed before any
 * request was made: no POST to /api/uploads, nothing in the server logs, and a
 * member told "a check-in without a photo is not a check-in" with the raw
 * Privy sentence stapled to the front of it.
 *
 * A missing token is not an error worth propagating anyway. Every route this
 * is sent to also accepts the `privy-token` cookie, so the honest answer to
 * "can you get me a bearer" is null and let the request go on the cookie.
 * ------------------------------------------------------------------------- */

export async function bearer(): Promise<string | null> {
  try {
    return await getAccessToken();
  } catch {
    // No provider, or Privy refused to mint one. The cookie is the fallback,
    // and the route will say so itself if that is not enough.
    return null;
  }
}

/** The Authorization header, or nothing at all, ready to spread into `headers`. */
export async function authHeader(): Promise<Record<string, string>> {
  const token = await bearer();
  return token ? { authorization: `Bearer ${token}` } : {};
}
