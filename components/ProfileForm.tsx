"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import { TriangleAlert } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { DashedRule, FIELD, FieldLabel } from "@/components/Panel";
import { GithubMark, InstagramMark, TelegramMark, XMark } from "@/components/SocialMarks";
import { upload } from "@/lib/upload";
import { cn } from "@/lib/utils";
import { initialsOf } from "@/lib/view";
import { IMAGE_ACCEPT } from "@/lib/images";

const SOCIALS = [
  { key: "x", label: "X", Mark: XMark },
  { key: "github", label: "GitHub", Mark: GithubMark },
  { key: "instagram", label: "Instagram", Mark: InstagramMark },
  { key: "telegram", label: "Telegram", Mark: TelegramMark },
] as const;

/**
 * FieldLabel's look on a real `<label>`. FieldLabel renders a `<p>`, which
 * cannot be associated with an input and is not phrasing content, so it
 * cannot sit inside one either. Six unlabelled pills was the whole problem
 * here: identical until filled, and unidentifiable once they were.
 */
const SUB_LABEL = "block text-[11px] font-medium uppercase tracking-[0.12em] text-grey-on-ground";

/** Name, face, one sentence, and where else you are.
 *
 *  GitHub stats were cut here on the original call: the crew is a gym group
 *  and a study pair, and a contributions graph tells them nothing about
 *  whether you turned up. Reversed 2026-08-29 -- the product owner asked for
 *  this exact 21st.dev calendar component by name and supplied its source.
 *  Settings now renders it (components/ui/retro-space-shooter-git-hub-calendar.tsx)
 *  for anyone with a non-empty `github` value below; the reasoning above
 *  stands as the record of why it was cut in the first place, not as a rule
 *  still in force. */
/**
 * The shape Onboarding hands a wallet sign-in: first four, ellipsis, last
 * four. Matching the shape rather than re-deriving it from the address keeps
 * this from needing the wallet, which this component never receives.
 */
function isAddressStandIn(name: string) {
  return /^.{4}\u2026.{4}$/.test(name);
}

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
    // Not `initial.displayName`. Onboarding gives a wallet sign-in
    // `oNZv…xk1Y` as a stand-in name, and seeding the field with it puts a
    // truncated address -- ellipsis character and all -- in front of someone
    // being asked what the crew calls them. Worse, Save would then persist
    // that string as their actual name. Blank invites a real one, and an
    // empty field omits the key on save, so the stand-in survives untouched
    // until they type something better.
    displayName: isAddressStandIn(initial.displayName) ? "" : initial.displayName,
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
  const router = useRouter();

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
    /**
     * Wrapped, like onAvatarChange above it and for the same reason.
     *
     * Without this a throw -- a phone that lost signal mid-request, a token
     * refresh that failed, a body that came back as something other than JSON
     * -- left `state` on "saving" for good. The button stays disabled and
     * reading "Saving", the banner below stays empty because nothing set an
     * error, and the only way out is a reload that loses whatever was typed.
     * The failure was real and the screen said nothing about it.
     */
    setState("saving");
    try {
      await attemptSave();
    } catch (err) {
      console.error("profile save failed:", err);
      setError(err instanceof Error ? err.message : "Could not save.");
      setState("error");
    }
  }

  async function attemptSave() {
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
      /**
       * The header and the card above this form are server-rendered, so they
       * keep showing whatever the last render read from the database. Without
       * this a member saved a photo, watched the preview in this form change,
       * and saw their initials everywhere else until they reloaded -- which
       * looks exactly like the save not working.
       */
      router.refresh();
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
          accept={IMAGE_ACCEPT}
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

      <div className="mt-6">
        <label htmlFor="profile-name" className={SUB_LABEL}>
          Name
        </label>
        <input
          id="profile-name"
          className={`${FIELD} mt-2 w-full`}
          maxLength={40}
          value={form.displayName}
          onChange={(e) => setForm({ ...form, displayName: e.target.value })}
          placeholder="What the crew calls you"
        />
      </div>

      <div className="mt-4">
        <label htmlFor="profile-bio" className={SUB_LABEL}>
          One line
        </label>
        <input
          id="profile-bio"
          className={`${FIELD} mt-2 w-full`}
          maxLength={280}
          value={form.bio}
          onChange={(e) => setForm({ ...form, bio: e.target.value })}
          placeholder="Ten words on what you are here for"
        />
      </div>

      <DashedRule className="mt-6" />

      {/* Two up, each marked by its own logo. Four full-width pills read as a
          ladder and cost twice the height for fields secondary to the two
          above; the mark identifies the field far faster than a word does,
          and unlike a placeholder it survives the field being filled. */}
      <div className="mt-6 grid grid-cols-2 gap-3">
        {SOCIALS.map((s) => (
          <div key={s.key} className={cn(FIELD, "flex items-center gap-2.5 px-4")}>
            <s.Mark className="size-[15px] shrink-0 text-grey-on-ground" />
            <input
              aria-label={s.label}
              className="w-full min-w-0 bg-transparent text-[14px] text-ink outline-none placeholder:text-grey-on-ground"
              maxLength={200}
              value={form.socials[s.key] ?? ""}
              onChange={(e) =>
                setForm({ ...form, socials: { ...form.socials, [s.key]: e.target.value } })
              }
              placeholder="username"
            />
          </div>
        ))}
      </div>

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
