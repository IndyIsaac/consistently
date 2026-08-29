"use client";

import { useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { TriangleAlert } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { FIELD, FieldLabel } from "@/components/Panel";
import { upload } from "@/lib/upload";
import { cn } from "@/lib/utils";
import { initialsOf } from "@/lib/view";

const SOCIALS = [
  { key: "x", label: "X" },
  { key: "github", label: "GitHub" },
  { key: "instagram", label: "Instagram" },
  { key: "telegram", label: "Telegram" },
] as const;

/** Name, face, one sentence, and where else you are. No GitHub stats: the crew
 *  is a gym group and a study pair, and a contributions graph tells them
 *  nothing about whether you turned up. */
export function ProfileForm({ initial }: {
  initial: {
    displayName: string;
    bio: string | null;
    avatarUrl: string | null;
    socials: Record<string, string> | null;
  };
}) {
  const { getAccessToken } = usePrivy();
  const [form, setForm] = useState({
    displayName: initial.displayName,
    bio: initial.bio ?? "",
    avatarUrl: initial.avatarUrl ?? "",
    socials: initial.socials ?? {},
  });

  // Two independent banners for two independent controls: uploading a photo
  // and saving the form fail on their own schedules, and a photo that failed
  // to upload has nothing to do with whether the last save succeeded.
  const [avatarState, setAvatarState] = useState<"idle" | "uploading">("idle");
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function onAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setAvatarState("uploading");
    try {
      const url = await upload(file);
      setForm((f) => ({ ...f, avatarUrl: url }));
      // A successful upload clears any error the last attempt left behind --
      // this is the one control the banner below belongs to, so nothing else
      // needs to touch it.
      setAvatarError(null);
    } catch (err) {
      setAvatarError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setAvatarState("idle");
    }
  }

  async function save() {
    setState("saving");
    const token = await getAccessToken();
    const res = await fetch("/api/me", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        // Clearing the name back to nothing is not a name to save under, so
        // an empty field omits the key -- the same "leave it as it was" that
        // every other untouched field on this form gets by not being sent.
        displayName: form.displayName || undefined,
        // bio and avatarUrl are `null`, not `undefined`, when cleared: the
        // server drops an absent key (JSON.stringify does not even send it),
        // which would leave the old value in place instead of clearing it.
        // See the comment above PatchSchema in app/api/me/route.ts.
        bio: form.bio || null,
        avatarUrl: form.avatarUrl || null,
        socials: form.socials,
      }),
    });
    if (res.ok) {
      const body = await res.json();
      // The response is what the database actually holds, not what the form
      // happened to have typed into it -- an omitted key (a blanked name, for
      // instance) means the server left the old value in place, and the form
      // needs to say so too. Trusting local state here is exactly how a
      // "Saved" badge ends up next to a value nobody saved.
      setForm({
        displayName: body.displayName,
        bio: body.bio ?? "",
        avatarUrl: body.avatarUrl ?? "",
        socials: (body.socials as Record<string, string> | null) ?? {},
      });
      // Same reasoning as onAvatarChange: a save that goes on to succeed
      // retires whatever error the previous attempt left on screen.
      setError(null);
      setState("saved");
    } else {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Could not save.");
      setState("error");
    }
  }

  return (
    <>
      <FieldLabel>Profile</FieldLabel>

      {/* Avatar and "Change photo" share one label, and so one tap target: the
          64px photo alone already clears the 44px floor FIELD's own comment
          sets for this being a phone product, and joining the caption to it
          means there is no dead strip between two half-sized targets. */}
      <label
        className={cn(
          "mt-4 flex cursor-pointer items-center gap-4",
          avatarState === "uploading" && "cursor-not-allowed opacity-60",
        )}
      >
        <Avatar className="size-16">
          {form.avatarUrl && <AvatarImage src={form.avatarUrl} alt="" />}
          <AvatarFallback className="text-[15px] font-semibold tracking-[0.02em] text-grey-on-surface">
            {initialsOf(form.displayName)}
          </AvatarFallback>
        </Avatar>
        <span className="text-[13px] font-medium text-ink underline decoration-hairline underline-offset-4">
          {avatarState === "uploading" ? "Uploading" : "Change photo"}
        </span>
        <input
          type="file"
          accept="image/*"
          className="sr-only"
          disabled={avatarState === "uploading"}
          onChange={onAvatarChange}
        />
      </label>

      {avatarError && (
        <p role="alert" className="mt-2 flex items-start gap-2 text-[13px] text-ink">
          <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
          {avatarError}
        </p>
      )}

      <input
        className={`${FIELD} mt-5 w-full`}
        maxLength={40}
        value={form.displayName}
        onChange={(e) => setForm({ ...form, displayName: e.target.value })}
        placeholder="What the crew calls you"
      />

      <input
        className={`${FIELD} mt-3 w-full`}
        maxLength={280}
        value={form.bio}
        onChange={(e) => setForm({ ...form, bio: e.target.value })}
        placeholder="One line"
      />

      {SOCIALS.map((s) => (
        <input
          key={s.key}
          className={`${FIELD} mt-3 w-full`}
          maxLength={200}
          value={form.socials[s.key] ?? ""}
          onChange={(e) =>
            setForm({ ...form, socials: { ...form.socials, [s.key]: e.target.value } })
          }
          placeholder={s.label}
        />
      ))}

      <button
        type="button"
        onClick={save}
        disabled={state === "saving"}
        className="mt-5 h-11 rounded-full bg-ink px-6 text-[14px] font-semibold text-ground transition-opacity hover:opacity-85 disabled:opacity-55"
      >
        {state === "saving" ? "Saving" : state === "saved" ? "Saved" : "Save"}
      </button>

      {error && (
        <p role="alert" className="mt-3 flex items-start gap-2 text-[13px] text-ink">
          <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}
    </>
  );
}
