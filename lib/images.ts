/* ---------------------------------------------------------------------------
 * Which images the product can actually show.
 *
 * "Is it an image" was the wrong question. `file.type.startsWith("image/")`
 * says yes to `image/heic`, which is what every iPhone shoots by default -- so
 * the upload succeeded, the URL went into the database, and then no browser
 * except Safari could draw it. The avatar fell back to initials and the member
 * was told nothing at all. A stored photo that cannot be displayed is worse
 * than a refused one: the refusal can be acted on.
 *
 * The other half is the opposite mistake. Some browsers hand over a file with
 * an empty `type`, and a plain prefix test refuses those -- so a perfectly good
 * JPEG came back "Images only."
 *
 * So the question is "can a browser draw this", the answer is an allowlist, and
 * a file with no type is judged by its extension rather than turned away.
 * ------------------------------------------------------------------------- */

/** Types every current browser can render. */
export const DISPLAYABLE_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
];

/**
 * What the file inputs advertise.
 *
 * Not `image/*`. Naming the types is what makes iOS hand over a JPEG instead of
 * the HEIC it holds -- the conversion happens in the picker, before anything
 * reaches us, which is the only place it can happen without a decoder.
 */
export const IMAGE_ACCEPT = DISPLAYABLE_IMAGE_TYPES.join(",");

const BY_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
};

/** Formats a browser will not draw, named so the refusal can say which. */
const UNDISPLAYABLE: Record<string, string> = {
  "image/heic": "HEIC",
  "image/heif": "HEIF",
  heic: "HEIC",
  heif: "HEIF",
};

/**
 * A lookup that cannot answer with something nobody put there.
 *
 * Both tables below are keyed by a filename extension, which the member
 * chooses. A plain `map[key]` walks the prototype chain, and one key survives
 * `toLowerCase()`: a file called `photo.constructor` returned
 * `Object.prototype.constructor` -- truthy -- so the refusal handed back to the
 * member read "function Object() { [native code] } photos cannot be shown in a
 * browser". Nothing was exploitable beyond the nonsense, but it is a lookup
 * answering for a key that was never in the table.
 */
function look(table: Record<string, string>, key: string): string | undefined {
  return Object.hasOwn(table, key) ? table[key] : undefined;
}

export type ImageVerdict =
  | { ok: true; contentType: string }
  | { ok: false; reason: string };

/**
 * Decide whether this file can be stored and later shown.
 *
 * `type` is what the browser claimed; `name` is the fallback when it claimed
 * nothing. The returned contentType is what should be stored, so a file judged
 * by its extension is served with the type it actually is.
 */
export function judgeImage(file: { type: string; name: string }): ImageVerdict {
  const claimed = file.type.trim().toLowerCase();
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";

  /**
   * Nothing useful was claimed.
   *
   * Empty is the obvious case, but `application/octet-stream` is the common
   * one: it is what a browser sends for a file it cannot identify, and what a
   * blank type becomes on its way through a multipart body. Both mean the same
   * thing -- ask the extension instead.
   */
  const unknown = claimed === "" || claimed === "application/octet-stream";

  // One lookup, not two: when the claim is unknown the extension is all there
  // is, and when it is known the extension is not consulted at all.
  const unsupported = look(UNDISPLAYABLE, unknown ? ext : claimed);
  if (unsupported) {
    return {
      ok: false,
      reason: `${unsupported} photos cannot be shown in a browser. On an iPhone: Settings, Camera, Formats, Most Compatible -- or pick a screenshot instead.`,
    };
  }

  if (DISPLAYABLE_IMAGE_TYPES.includes(claimed)) {
    return { ok: true, contentType: claimed };
  }

  // No type, or a type nothing recognises: the extension is the only other
  // thing we know, and it is what the member actually chose.
  const byExt = look(BY_EXTENSION, ext);
  if (unknown && byExt) return { ok: true, contentType: byExt };

  return { ok: false, reason: "That is not an image we can show. Try a JPEG or a PNG." };
}
