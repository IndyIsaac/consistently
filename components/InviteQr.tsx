"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, Copy, X } from "lucide-react";
import { CodePlate } from "@/components/CodePlate";

/* ---------------------------------------------------------------------------
 * The invite.
 *
 * Someone opens the group, holds up the code, and the rest of the room scans
 * it. DESIGN.md calls this the demo's best physical moment, which sets the two
 * requirements: one tap from inside the channel, and large and high-contrast
 * enough to read from the back of a room.
 *
 * The plate treatment — white in either theme, so a scanner will take it — is
 * in components/CodePlate.tsx, which the wallet address on /welcome shares.
 *
 * The URL is read from `window.location.origin` rather than an env var so the
 * code points wherever the app is actually being served from — a laptop on the
 * room's wifi, a tunnel, a deploy — without anyone rebuilding it.
 *
 * It renders through a portal to `document.body`. The app's arrival animation
 * leaves a `filter` on `<main>`, and a filtered ancestor becomes the containing
 * block for `position: fixed` — an overlay left inside it would be pinned to
 * the page rather than to the viewport.
 * ------------------------------------------------------------------------- */

/** Nothing to subscribe to: `mounted` only ever changes once, at hydration. */
function subscribeNothing() {
  return () => {};
}

export function InviteQr({
  pactName,
  inviteToken,
  open,
  onClose,
}: {
  pactName: string;
  inviteToken: string;
  open: boolean;
  onClose: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const [copied, setCopied] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);

  // False through the server render and the first client render, true after.
  // There is no `document` to portal into before that, and the origin the code
  // has to encode is not knowable either.
  const mounted = useSyncExternalStore(subscribeNothing, () => true, () => false);
  const url = mounted
    ? `${window.location.origin}/?invite=${encodeURIComponent(inviteToken)}`
    : "";

  useEffect(() => {
    if (!open) return;
    returnTo.current = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    // The room is looking at this; nothing behind it should scroll.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
      returnTo.current?.focus();
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // No clipboard permission. The link is on screen and selectable.
    }
  }

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center px-5 py-8"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.2 }}
        >
          <button
            type="button"
            aria-label="Close the invite"
            tabIndex={-1}
            onClick={onClose}
            /* The scrim is `ink` in both themes, so it is always the value the
               ground is not: a dark wash under a white panel, a bone one under
               a near-black panel. Either way the panel is the only thing in
               focus, which is the point when a room is looking at it. */
            className="absolute inset-0 cursor-default bg-ink/55 backdrop-blur-md"
          />

          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={`Invite to ${pactName}`}
            className="relative flex w-full max-w-[24rem] flex-col items-center rounded-[28px] border border-hairline bg-panel px-6 pt-6 pb-7 shadow-nav"
            initial={{ opacity: 0, scale: 0.94, y: 14, filter: "blur(10px)" }}
            animate={{ opacity: 1, scale: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, scale: 0.97, y: 8, filter: "blur(6px)" }}
            transition={
              reduceMotion ? { duration: 0 } : { duration: 0.42, ease: [0.16, 1, 0.3, 1] }
            }
          >
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="absolute top-4 right-4 inline-flex size-9 items-center justify-center rounded-full text-grey-on-ground transition-colors hover:bg-surface hover:text-ink"
            >
              <X className="size-4.5" aria-hidden="true" strokeWidth={1.75} />
            </button>

            {/* No label over the name. A screen filled by a QR code does not
                need a word telling the room it is an invitation. */}
            <h2 className="max-w-[18ch] px-9 text-center text-[1.5rem] leading-[1.1] font-extrabold tracking-[-0.03em] text-ink">
              {pactName}
            </h2>

            <CodePlate value={url} title={`Join ${pactName}`} className="mt-6" />

            <p className="mt-5 max-w-[26ch] text-center text-[14px] leading-relaxed text-grey-on-ground">
              Hold it up. Scanning it opens the sign-in with this invite attached.
            </p>

            <p className="figure mt-3 w-full truncate text-center text-[12px] text-grey-on-ground select-all">
              {url}
            </p>

            <button
              type="button"
              onClick={copy}
              className="mt-5 inline-flex h-11 items-center justify-center gap-2 rounded-full bg-ink px-6 text-[14px] font-semibold text-ground transition-opacity hover:opacity-85"
            >
              {copied ? (
                <Check className="size-4" aria-hidden="true" strokeWidth={2.25} />
              ) : (
                <Copy className="size-4" aria-hidden="true" strokeWidth={2} />
              )}
              {copied ? "Copied" : "Copy the link"}
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
