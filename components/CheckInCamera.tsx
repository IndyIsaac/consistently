"use client";

import { useRef, useState } from "react";
import { Camera } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The camera. Half of what a member can do in a group, and the only way a
 * session opens or closes.
 *
 * `capture="environment"` opens the rear camera directly on a phone, which is
 * the whole point — proof is a photo taken at the gym, not a file picked from a
 * library. On a desktop the same input falls back to a file dialog, which is
 * how the demo runs on a laptop.
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
        capture="environment"
        className="hidden"
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
