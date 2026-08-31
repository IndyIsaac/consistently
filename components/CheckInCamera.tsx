"use client";

import { useRef, useState } from "react";
import { Camera } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The camera. Half of what a member can do in a group, and the only way a
 * session opens or closes.
 *
 * It used to carry `capture="environment"`, which opens the rear camera
 * directly on a phone. The reasoning was that proof is a photo taken at the
 * gym, not a file picked from a library -- but `capture` does not add the
 * camera, it *removes* everything else: iOS goes straight to the viewfinder
 * with no way to reach a photo already taken. Somebody who shot it two minutes
 * ago, or on their other phone, simply could not check in.
 *
 * Without the attribute a phone offers the camera and the library together and
 * the member picks, which is the same camera plus a way out. A desktop gets a
 * file dialog either way.
 *
 * It no longer keeps a thumbnail of its own: the photo posts to the channel the
 * moment it is taken, and a second copy of it floating in the composer was one
 * preview too many. The caller owns the object URL and the channel row it lands
 * in.
 */
export function CheckInCamera({
  label,
  onCapture,
}: {
  label: string;
  onCapture: (file: File) => Promise<void> | void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      await onCapture(file);
    } finally {
      setBusy(false);
      // Let the same photo be chosen twice in a row -- without this, picking
      // the identical file fires no change event the second time.
      e.target.value = "";
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        /**
         * `sr-only`, not `hidden`.
         *
         * `hidden` is `display: none`, and WebKit will not open a file picker
         * for a `display: none` input that was clicked from script -- the call
         * returns and nothing happens. Chrome allows it, which is the only
         * reason this ever looked like it worked. On Safari, and on every
         * iPhone, the one button the whole product turns on did nothing.
         *
         * `sr-only` keeps the input rendered and out of sight, which is what
         * ProfileForm and RuleEditor both already do with their own file
         * inputs -- and why those two kept working.
         */
        className="sr-only"
        onChange={handleChange}
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        className={cn(
          "inline-flex h-12 shrink-0 items-center gap-2 rounded-full bg-ink pr-5 pl-4 text-[14px] font-semibold tracking-[-0.01em] whitespace-nowrap text-ground transition-opacity",
          busy ? "opacity-55" : "hover:opacity-85",
        )}
      >
        <Camera className="size-[18px]" aria-hidden="true" strokeWidth={2} />
        {busy ? "Posting" : label}
      </button>
    </>
  );
}
