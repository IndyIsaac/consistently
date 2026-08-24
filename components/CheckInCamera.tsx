"use client";

import { useEffect, useRef, useState } from "react";

export function CheckInCamera({
  label,
  onCapture,
}: {
  label: string;
  onCapture: (file: File) => Promise<void> | void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Revoke the previous object URL whenever it's replaced or the component
  // unmounts, so repeated captures in one sitting don't leak blob URLs.
  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  async function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPreview(URL.createObjectURL(file));
    setBusy(true);
    try {
      await onCapture(file);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleChange}
      />
      {preview && (
        <img src={preview} alt="" className="h-40 w-40 rounded-xl object-cover" />
      )}
      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        className="rounded-full bg-black px-6 py-3 text-white disabled:opacity-50"
      >
        {busy ? "Uploading…" : label}
      </button>
    </div>
  );
}
