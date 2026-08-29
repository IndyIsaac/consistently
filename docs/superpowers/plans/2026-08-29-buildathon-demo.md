# Buildathon Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a working mainnet demo of Consistently for the DFlow × Superteam Thailand Buildathon, submittable by 2026-08-31 23:59 ICT.

**Architecture:** Five lanes with exclusive file ownership working in one shared worktree. Four lanes touch product surfaces already scaffolded in the repo (stake sheet, create form, settings, check-in camera); one lane is prose; one is deployment. Exactly one Prisma migration exists in the whole plan and Lane C owns it.

**Tech Stack:** Next.js 16.3.2 (App Router), React 19.2.8, Prisma 6 over Postgres, Privy (auth + embedded Solana wallets), `@solana/web3.js`, DFlow order API, Vercel Blob, Tailwind 4, vitest.

**Spec:** `docs/superpowers/specs/2026-08-28-buildathon-design.md`

**Worktree:** `/Users/nambouchara/orca/workspaces/dflow/buildathon-demo` on branch `namearth5005/buildathon-demo`

## Global Constraints

- **Deadline: 2026-08-31, 23:59 ICT.** Demo Day 2026-09-03. Cut scope, never verification.
- **Voice (PRODUCT.md):** dry, deadpan, faintly savage. No exclamation marks, no cheerleading, no motivational copy. State the record; do not editorialise.
- **Terminology (PRODUCT.md):** the commitment is a **pact**, the group is a **crew**, a completed check-in period is a **session**, money at risk is a **stake** — never a fine or a bet.
- **Money formatting:** always `formatMoney` from `lib/money.ts`. Never abbreviate to `1k`.
- **No automated proof verification.** Reference photos are for humans to compare. No image scoring, no automated pass/fail. This is a deliberate exclusion in PRODUCT.md, not a gap.
- **No free-text chat.** The channel is a feed of slash commands, photos and bot messages.
- **Form controls:** every field is the 44px pill `FIELD` from `components/Panel.tsx`. Cards are `Panel`. Never nest a `Panel` in a `Panel`.
- **File ownership is exclusive.** If your lane needs a file another lane owns, stop and report it rather than editing it.
- **Every task ends green** on `npm test`, `npm run typecheck`, `npm run lint`. Paste the output; never claim a pass you did not see.

## File Structure

| File | Owner | Responsibility |
|---|---|---|
| `components/StakeSheet.tsx` | A | Payout-token picker added to the existing stake flow |
| `app/api/pacts/[id]/stake/route.ts` | A | Accept and persist `payoutMint` on the finalise step |
| `lib/settlement.ts` | A | Name the payout token in the settlement feed line |
| `lib/rules.ts` | B | `RuleConfigSchema` gains three optional reference fields |
| `app/api/uploads/route.ts` | B | **Create.** Blob upload endpoint, shared by references and avatars |
| `components/RuleEditor.tsx` | B | Reference photo + description inputs |
| `components/NewPact.tsx` | B | Wires the reference step; sets USDC as default currency |
| `components/CheckInCamera.tsx` | B | Shows the reference alongside the viewfinder |
| `components/Channel.tsx` | B | Passes the reference through to the camera (preflight ruling 3) |
| `lib/stake.ts` | A | `finaliseStake` gains `payoutMint` and writes it (ruling 7) |
| `prisma/schema.prisma` | C | The one migration: `User.bio`, `avatarUrl`, `socials`, `email` |
| `app/api/me/route.ts` | C | PATCH branch for profile edits |
| `app/(app)/settings/page.tsx` | C | Real settings page replacing the PLACEHOLDER |
| `components/ProfileForm.tsx` | C | **Create.** Name, avatar, bio, socials |
| `components/LinkedAccounts.tsx` | C | **Create.** Privy email linking |
| `components/AppHeader.tsx` | C | Theme toggle moves here |
| `components/AppearanceSetting.tsx` | C | **Delete.** |
| `docs/security/escrow-protocol.md` | D | **Create.** Custody today, v2 protocol, threat model |
| `README.md` | E | Deploy notes, Solscan links, link to D's document |

---

## Lane A — Currency & payouts

### Task 1 (Lane A): Persist the member's chosen payout token

**Files:**
- Modify: `app/api/pacts/[id]/stake/route.ts:29-38` (BodySchema), and the finalise handler
- Test: `lib/__tests__/stake.test.ts`

**Interfaces:**
- Consumes: `Membership.payoutMint` (exists, defaults to the USDC mint)
- Produces: the finalise step accepts `payoutMint?: string` and writes it to the membership row

- [ ] **Step 1: Read the finalise branch** of `app/api/pacts/[id]/stake/route.ts` end to end before editing. It is a `z.discriminatedUnion("step", ...)`; you are extending the third member only.

- [ ] **Step 2: Write the failing test**

```ts
// lib/__tests__/stake.test.ts
import { describe, it, expect } from "vitest";
import { PAYOUT_MINTS, isSupportedPayoutMint } from "@/lib/dflow";

describe("payout mints", () => {
  it("accepts USDC and SOL", () => {
    expect(isSupportedPayoutMint("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v")).toBe(true);
    expect(isSupportedPayoutMint("So11111111111111111111111111111111111111112")).toBe(true);
  });

  it("refuses a mint that is not on the list, so settlement cannot route into junk", () => {
    expect(isSupportedPayoutMint("notamint")).toBe(false);
  });

  it("lists USDC first — it is the default and the pot's own unit", () => {
    expect(PAYOUT_MINTS[0].label).toBe("USDC");
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npm test -- lib/__tests__/stake.test.ts`
Expected: FAIL — `PAYOUT_MINTS` is not exported from `lib/dflow.ts`.

- [ ] **Step 4: Add the allowlist to `lib/dflow.ts`**

```ts
/** The tokens a winner may be paid in. An allowlist, not free text: settlement
 *  builds a real DFlow order per winner, and an unroutable mint there is a
 *  payout that silently never lands. */
export const PAYOUT_MINTS = [
  { mint: USDC_MINT, label: "USDC", decimals: 6 },
  { mint: WSOL_MINT, label: "SOL", decimals: 9 },
] as const;

export function isSupportedPayoutMint(mint: string): boolean {
  return PAYOUT_MINTS.some((m) => m.mint === mint);
}
```

- [ ] **Step 5: Run the test and watch it pass**

Run: `npm test -- lib/__tests__/stake.test.ts`
Expected: PASS

- [ ] **Step 6: Extend the submit step's schema and thread it to the write**

**Corrected 2026-08-29 (Ruling 7).** The plan originally said the membership is
marked `staked` inside `route.ts`. It is not: the `step === "submit"` branch calls
`finaliseStake(...)` and returns, and the `prisma.membership.update` that flips the
status lives in `finaliseStake` in `lib/stake.ts`. The schema member is `submit`,
not `finalise`. **Lane A owns `lib/stake.ts` for this change** — no other task
writes it (Task 12 only reads it).

In `app/api/pacts/[id]/stake/route.ts`, add to the `step: "submit"` object:

```ts
payoutMint: z.string().min(32).max(44).optional(),
```

Thread it through the call, then in `lib/stake.ts` widen `finaliseStake`'s params:

```ts
export async function finaliseStake(params: {
  pactId: string;
  userWallet: string;
  signedTxB64: string;
  lastValidBlockHeight: number;
  kind: "swap" | "transfer";
  /** The token this member wants their share paid out in. Optional: an older
   *  client sends nothing and the column keeps its USDC default. */
  payoutMint?: string;
}): Promise<{ signature: string; dryRun?: DryRun }> {
```

and add to the existing `data: { ... }` of the membership update that sets
`status: "staked"`:

```ts
// Validated against the allowlist rather than trusted: settlement builds a real
// order per winner, and an unroutable mint is a payout that never arrives.
// Written in the same update as the status flip on purpose -- a second write
// that can fail on its own would leave a staked member silently holding the
// default mint, and nobody finds out until settlement pays the wrong token.
...(params.payoutMint && isSupportedPayoutMint(params.payoutMint)
  ? { payoutMint: params.payoutMint }
  : {}),
```

- [ ] **Step 7: Verify**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all green. Paste the output.

- [ ] **Step 8: Commit**

```bash
git add lib/dflow.ts "app/api/pacts/[id]/stake/route.ts" lib/__tests__/stake.test.ts
git commit -m "feat: a member says which token they want to be paid in"
```

### Task 2 (Lane A): The picker in the stake sheet

**Files:**
- Modify: `components/StakeSheet.tsx` (the `MINTS` const at :23, and the sheet body)

**Interfaces:**
- Consumes: `PAYOUT_MINTS`, `isSupportedPayoutMint` from Task 1
- Produces: the finalise POST body carries `payoutMint`

- [ ] **Step 1: Invoke the `impeccable` skill** before touching the UI. This project already uses it (`.impeccable/config.json`). Ask it for a review pass on the stake sheet once the control is in.

- [ ] **Step 2: Add payout state** next to the existing `token` state:

```tsx
const [payout, setPayout] = useState(PAYOUT_MINTS[0]);
```

- [ ] **Step 3: Add the control** below the existing input-token row, using the shared `Select`:

```tsx
<div className="mt-4">
  <FieldLabel>Paid out in</FieldLabel>
  <Select
    className="mt-2"
    value={payout.mint}
    onChange={(e) =>
      setPayout(PAYOUT_MINTS.find((m) => m.mint === e.target.value) ?? PAYOUT_MINTS[0])
    }
  >
    {PAYOUT_MINTS.map((m) => (
      <option key={m.mint} value={m.mint}>{m.label}</option>
    ))}
  </Select>
  <p className="mt-2 text-[13px] text-grey-on-ground">
    If the crew forfeits to you, this is what arrives.
  </p>
</div>
```

- [ ] **Step 4: Send it** — add `payoutMint: payout.mint` to the finalise POST body.

- [ ] **Step 5: Prove it round-trips**

Run: `npm run dev`, stake in the demo, then confirm the row:
```bash
npx prisma studio   # or: psql "$DATABASE_URL" -c 'select "payoutMint" from "Membership";'
```
Expected: the chosen mint is stored, not the default.

- [ ] **Step 6: Verify and commit**

```bash
npm test && npm run typecheck && npm run lint
git add components/StakeSheet.tsx
git commit -m "feat: choose the token your winnings arrive in"
```

### Task 3 (Lane A): Name the token in the settlement line

**Files:**
- Modify: `lib/settlement.ts:280`, `:311-322` (payout construction and the feed line)
- Test: `lib/__tests__/settlement.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it("names the token each winner was paid in, because that is the DFlow story", () => {
  const line = settlementLine({
    winners: [
      { displayName: "Nam", amountUsdc: 1_500_000n, payoutMint: "So11111111111111111111111111111111111111112" },
      { displayName: "Indy", amountUsdc: 1_500_000n, payoutMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" },
    ],
  });
  expect(line).toContain("Nam");
  expect(line).toContain("SOL");
  expect(line).toContain("Indy");
  expect(line).toContain("USDC");
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- lib/__tests__/settlement.test.ts`
Expected: FAIL — `settlementLine` is not exported.

- [ ] **Step 3: Implement `settlementLine` in `lib/settlement.ts`**, deadpan per the voice constraint — names and tokens, no congratulation. It needs two imports the file does not yet have: `PAYOUT_MINTS` from `@/lib/dflow` (extend the existing import) and `formatMoney` from `@/lib/money`.

```ts
/** One line for the feed. States who got what, in what. No congratulation. */
export function settlementLine(s: {
  winners: { displayName: string; amountUsdc: bigint; payoutMint: string }[];
}): string {
  if (s.winners.length === 0) return "Nobody missed. Nothing moved.";
  const label = (mint: string) =>
    PAYOUT_MINTS.find((m) => m.mint === mint)?.label ?? "USDC";
  return s.winners
    .map((w) => `${w.displayName} took ${formatMoney(Number(w.amountUsdc) / 1e6, "USDC")} in ${label(w.payoutMint)}`)
    .join(". ") + ".";
}
```

- [ ] **Step 4: Run and watch it pass**

Run: `npm test -- lib/__tests__/settlement.test.ts`
Expected: PASS

- [ ] **Step 5: Use it** where the settlement feed item body is built.

- [ ] **Step 6: Verify and commit**

```bash
npm test && npm run typecheck && npm run lint
git add lib/settlement.ts lib/__tests__/settlement.test.ts
git commit -m "feat: the settlement line says which token each winner took"
```

- [ ] **Step 7: Invoke `superpowers:verification-before-completion`** before reporting Lane A done.

---

## Lane B — Reference photos

### Task 4 (Lane B): The upload endpoint

**Files:**
- Create: `app/api/uploads/route.ts`
- Test: none (thin wrapper over `@vercel/blob`; covered by B2's round-trip)

**Interfaces:**
- Produces: `POST /api/uploads` with a `FormData` field `file`, returns `{ url: string }`

- [ ] **Step 1: Write the route**

```ts
import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { requireUser, UnauthorizedError } from "@/lib/auth";

/* A signed-in member puts an image somewhere every device can read it. Used by
 * pact reference photos and by profile avatars; check-in photos keep their own
 * path. Without BLOB_READ_WRITE_TOKEN this answers 503 rather than throwing --
 * a demo on one laptop can run without it, a demo on four phones cannot. */

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
```

- [ ] **Step 2: Verify and commit**

```bash
npm run typecheck && npm run lint
git add app/api/uploads/route.ts
git commit -m "feat: one place to put an image that every device can read"
```

### Task 5 (Lane B): Reference fields on the rule config

**Files:**
- Modify: `lib/rules.ts:14-45` (`RuleConfigSchema`)
- Test: `lib/__tests__/rules.test.ts`

**Interfaces:**
- Produces: `RuleConfig.checkInReferenceUrl`, `.checkOutReferenceUrl`, `.proofDescription` — all optional

- [ ] **Step 1: Write the failing test**

```ts
it("keeps the reference photos and description on the parsed config", () => {
  // Asserts on the OUTPUT, not merely that parse did not throw: zod strips
  // unknown keys, so a .not.toThrow() assertion here passes before the fields
  // exist and never fails first. Read the values back or the test is theatre.
  const parsed = RuleConfigSchema.parse({
    ...gym,
    checkInReferenceUrl: "https://blob.example/in.jpg",
    checkOutReferenceUrl: "https://blob.example/out.jpg",
    proofDescription: "Full body in the mirror, gym floor visible behind you.",
  });
  expect(parsed.checkInReferenceUrl).toBe("https://blob.example/in.jpg");
  expect(parsed.checkOutReferenceUrl).toBe("https://blob.example/out.jpg");
  expect(parsed.proofDescription).toBe("Full body in the mirror, gym floor visible behind you.");
});

it("still accepts a config with no references — they are optional, and old pacts have none", () => {
  expect(() => RuleConfigSchema.parse(gym)).not.toThrow();
});

it("rejects a proof description longer than 280 characters", () => {
  expect(() =>
    RuleConfigSchema.parse({ ...gym, proofDescription: "x".repeat(281) }),
  ).toThrow();
});
```

- [ ] **Step 2: Run it and watch the first test fail**

Run: `npm test -- lib/__tests__/rules.test.ts`
Expected: FAIL — `parsed.checkInReferenceUrl` is `undefined` because zod strips keys the schema does not declare. If this test passes before Step 3, stop: the assertion is wrong, not the schema.

- [ ] **Step 3: Add the fields** to `RuleConfigSchema`'s object, before the `.refine`:

```ts
/** What a good check-in looks like, set by the creator. Shown next to the
 *  camera so a member frames the same shot. Nothing compares them: the crew
 *  does, which is PRODUCT.md's trust-based design, unchanged. */
checkInReferenceUrl: z.string().url().optional(),
checkOutReferenceUrl: z.string().url().optional(),
proofDescription: z.string().max(280).optional(),
```

- [ ] **Step 4: Run and watch all three pass**

Run: `npm test -- lib/__tests__/rules.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/rules.ts lib/__tests__/rules.test.ts
git commit -m "feat: a pact can carry what a good check-in looks like"
```

### Task 6 (Lane B): The creator sets the references, and USDC becomes the default

**Files:**
- Modify: `components/RuleEditor.tsx`, `components/NewPact.tsx`

- [ ] **Step 1: Invoke the `impeccable` skill** for the create-form pass.

- [ ] **Step 2: Add a reference row to `RuleEditor.tsx`**

```tsx
// Above the component: one uploader, used by both slots.
async function upload(file: File): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/api/uploads", { method: "POST", body: form });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? "Upload failed.");
  return body.url as string;
}

function ReferenceSlot({
  label, url, onUrl, onError,
}: {
  label: string;
  url?: string;
  onUrl: (url: string) => void;
  onError: (msg: string) => void;
}) {
  return (
    <label className="flex cursor-pointer flex-col items-center gap-2">
      {url ? (
        <img src={url} alt="" className="size-20 rounded-2xl object-cover" />
      ) : (
        <span className="flex size-20 items-center justify-center rounded-2xl bg-surface text-[12px] text-grey-on-surface">
          Add
        </span>
      )}
      <span className="text-[12px] text-grey-on-ground">{label}</span>
      <input
        type="file"
        accept="image/*"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          try {
            onUrl(await upload(file));
          } catch (err) {
            onError(err instanceof Error ? err.message : "Upload failed.");
          }
          e.target.value = "";
        }}
      />
    </label>
  );
}
```

Then in the editor body, below the existing proof field:

```tsx
<div className="mt-6">
  <FieldLabel>What a good one looks like</FieldLabel>
  <p className="mt-2 text-[13px] text-grey-on-ground">
    Optional. The crew compares against it. Nothing checks it for you.
  </p>

  <div className="mt-4 flex gap-5">
    <ReferenceSlot
      label="Check in"
      url={rule.checkInReferenceUrl}
      onUrl={(url) => onChange({ ...rule, checkInReferenceUrl: url })}
      onError={setUploadError}
    />
    {rule.sessionType === "checkin_checkout" && (
      <ReferenceSlot
        label="Check out"
        url={rule.checkOutReferenceUrl}
        onUrl={(url) => onChange({ ...rule, checkOutReferenceUrl: url })}
        onError={setUploadError}
      />
    )}
  </div>

  <input
    className={`${FIELD} mt-4 w-full`}
    maxLength={280}
    placeholder="Full body in the mirror, gym floor behind you"
    value={rule.proofDescription ?? ""}
    onChange={(e) => onChange({ ...rule, proofDescription: e.target.value || undefined })}
  />

  {uploadError && (
    <p role="alert" className="mt-2 text-[13px] text-ink">{uploadError}</p>
  )}
</div>
```

A 503 from `/api/uploads` surfaces as `Photo upload is not configured.` and the description stays usable — that is the degraded path when the Blob token has not arrived.

- [ ] **Step 3: Change the default currency** in `components/NewPact.tsx` so `USDC` is preselected. This is Lane A's one-line dependency and it is made here, not there.

- [ ] **Step 4: Prove the round-trip** — create a pact with references, reload, confirm the URLs are on `ruleConfig`:

```bash
psql "$DATABASE_URL" -c 'select "ruleConfig" from "Pact" order by "createdAt" desc limit 1;'
```

- [ ] **Step 5: Verify and commit**

```bash
npm test && npm run typecheck && npm run lint
git add components/RuleEditor.tsx components/NewPact.tsx
git commit -m "feat: the creator sets the shot, and the default is USDC"
```

### Task 7 (Lane B): The member sees the reference while checking in

> **SUPERSEDED IN PART — Ruling 14, 2026-08-29.** Steps 1 and 2 below (widening
> `CheckInCamera`'s props and rendering the reference inside it) are **not** to be
> implemented. The brief's JSX assumed block flow, but `Channel.tsx:482` composes the
> camera and the command input as siblings in a horizontal flex pill, so the snippet
> would have become a third item in that row rather than stacking above the button —
> and a 280-character `proofDescription` would render in a ~140px column.
>
> Instead: render the reference block in `Channel.tsx` itself, full-width, between the
> existing "Checked in." status pill (`Channel.tsx:466-471`, which is the precedent for
> exactly this) and the composer pill. `CheckInCamera.tsx` is **unchanged** — it gains no
> props, because nothing would read them. This task's ownership is `components/Channel.tsx`
> alone.

**Files:**
- Modify: `components/CheckInCamera.tsx:22-27` (props), and the channel composer that renders it

**Interfaces:**
- Consumes: `RuleConfig.checkInReferenceUrl` / `.checkOutReferenceUrl` / `.proofDescription` from B2
- Produces: `CheckInCamera` accepts `referenceUrl?: string` and `description?: string`

- [ ] **Step 1: Widen the props**

```tsx
export function CheckInCamera({
  label,
  onCapture,
  referenceUrl,
  description,
}: {
  label: string;
  onCapture: (file: File) => Promise<void> | void;
  /** What the creator said a good one looks like. Absent on older pacts. */
  referenceUrl?: string;
  description?: string;
}) {
```

- [ ] **Step 2: Render the reference** above the button, only when present

```tsx
{(referenceUrl || description) && (
  <div className="mb-3 flex items-center gap-3">
    {referenceUrl && (
      <img
        src={referenceUrl}
        alt="What the creator said a good one looks like"
        className="size-12 shrink-0 rounded-xl object-cover"
      />
    )}
    {description && (
      <p className="text-[13px] leading-snug text-grey-on-ground">{description}</p>
    )}
  </div>
)}
```

Absent references render nothing and never block capture — older pacts have none.

- [ ] **Step 3: Pass it through** from the channel composer.

- [ ] **Step 4: Verify on two devices.** Take a photo on a phone, confirm the reference renders on a laptop too. This is the multi-device requirement that makes Blob load-bearing.

- [ ] **Step 5: Verify and commit**

```bash
npm test && npm run typecheck && npm run lint
git add components/CheckInCamera.tsx components/Channel.tsx
git commit -m "feat: the shot you are copying, next to the camera"
```

- [ ] **Step 6: Invoke `superpowers:verification-before-completion`** before reporting Lane B done.

---

## Lane C — Profile, appearance & recovery

### Task 8 (Lane C): The one migration

**Files:**
- Modify: `prisma/schema.prisma` (the `User` model)

**Interfaces:**
- Produces: `User.bio`, `User.avatarUrl`, `User.socials`, `User.email`

- [ ] **Step 1: Add the fields** to `model User`:

```prisma
  bio           String?
  avatarUrl     String?
  /// { "x": "...", "github": "...", "instagram": "...", "telegram": "..." }
  /// Json rather than four columns: the set is presentational and will change.
  socials       Json?
  /// Linked after the fact, so a wallet-only account has a way back in.
  email         String?      @unique
```

- [ ] **Step 2: Migrate**

```bash
npx prisma migrate dev --name user-profile-and-email
```
Expected: migration applies, client regenerates.

- [ ] **Step 3: Verify and commit**

```bash
npm run typecheck && npm test
git add prisma/
git commit -m "feat: a user can have a face, a sentence and a way back in"
```

### Task 9 (Lane C): The theme toggle moves to the nav bar

**Files:**
- Modify: `components/AppHeader.tsx`
- Delete: `components/AppearanceSetting.tsx`
- Modify: `components/ThemeToggle.tsx`, `components/BottomNav.tsx` (stale comments only)

- [ ] **Step 1: Put `ThemeToggle` in `AppHeader`**, to the left of the avatar, inside the existing flex row.

- [ ] **Step 2: Delete `components/AppearanceSetting.tsx`** and remove its import and `Panel` from `app/(app)/settings/page.tsx`.

- [ ] **Step 3: Correct the stale comments.** `ThemeToggle.tsx` and `BottomNav.tsx` both assert the theme deliberately does not live in the bar. It does now. Record the reversal rather than leaving source that contradicts itself.

- [ ] **Step 4: Verify and commit**

```bash
npm run typecheck && npm run lint && npm test
git add components/ app/
git commit -m "feat: the theme switch moves to the bar it was kept out of"
```

### Task 10 (Lane C): The profile form

**Files:**
- Create: `components/ProfileForm.tsx`
- Modify: `app/api/me/route.ts` (add a PATCH), `app/(app)/settings/page.tsx`

**Interfaces:**
- Consumes: `POST /api/uploads` from Task 4, `User` fields from C1
- Produces: `PATCH /api/me` accepting `{ displayName?, bio?, avatarUrl?, socials? }`

- [ ] **Step 1: Add the PATCH branch** to `app/api/me/route.ts`. Follow the existing POST's shape — verified Privy id, zod body, never trust the wallet address from the body:

```ts
const PatchSchema = z.object({
  displayName: z.string().min(1).max(40).optional(),
  bio: z.string().max(280).optional(),
  avatarUrl: z.string().url().optional(),
  socials: z.record(z.string(), z.string().max(200)).optional(),
});

export async function PATCH(req: NextRequest) {
  if (!PRIVY_CONFIGURED) {
    return NextResponse.json({ error: "Sign-in is not configured" }, { status: 503 });
  }
  const privyId = await privyIdFromRequest(req);
  if (!privyId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const parsed = PatchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Nothing valid to update." }, { status: 400 });
  }

  // walletAddress is deliberately absent: it is write-on-create only, for the
  // reason given above the POST handler.
  const user = await prisma.user.update({ where: { privyId }, data: parsed.data });
  return NextResponse.json({
    displayName: user.displayName,
    bio: user.bio,
    avatarUrl: user.avatarUrl,
    socials: user.socials,
  });
}
```

- [ ] **Step 2: Invoke the `impeccable` skill** for the settings page pass.

- [ ] **Step 3: Build `components/ProfileForm.tsx`**

```tsx
"use client";

import { useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { FIELD, FieldLabel } from "@/components/Panel";

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
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

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
        displayName: form.displayName,
        bio: form.bio || undefined,
        avatarUrl: form.avatarUrl || undefined,
        socials: form.socials,
      }),
    });
    if (res.ok) {
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

      <input
        className={`${FIELD} mt-4 w-full`}
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

      {error && <p role="alert" className="mt-3 text-[13px] text-ink">{error}</p>}
    </>
  );
}
```

Avatar upload reuses `upload()` from Task 6 — lift it to `lib/upload.ts` if both lanes have landed, otherwise duplicate the six lines rather than editing a file Lane B owns. **No GitHub stats panel** — cut by the spec.

- [ ] **Step 4: Replace the PLACEHOLDER block** in `app/(app)/settings/page.tsx` (the `Profile photo, linked socials` / `Not built yet.` panel) with `ProfileForm`, and delete the `/** PLACEHOLDER. */` comment.

- [ ] **Step 5: Verify and commit**

```bash
npm test && npm run typecheck && npm run lint
git add components/ProfileForm.tsx app/api/me/route.ts "app/(app)/settings/page.tsx"
git commit -m "feat: a name you picked, a face, a sentence and your links"
```

### Task 11 (Lane C): Email linking for recovery

**Files:**
- Create: `components/LinkedAccounts.tsx`
- Modify: `app/(app)/settings/page.tsx`, `app/api/me/route.ts`

- [ ] **Step 1: Build `LinkedAccounts.tsx`**

```tsx
"use client";

import { useState } from "react";
import { usePrivy, useLinkAccount } from "@privy-io/react-auth";
import { DashedRule, FieldLabel } from "@/components/Panel";

/** The wallet is the account. This is the second way back to it. */
export function LinkedAccounts({ walletAddress, email }: {
  walletAddress: string;
  email: string | null;
}) {
  const { getAccessToken } = usePrivy();
  const [linked, setLinked] = useState(email);
  const [error, setError] = useState<string | null>(null);

  const { linkEmail } = useLinkAccount({
    onSuccess: async ({ linkedAccount }) => {
      if (linkedAccount.type !== "email") return;
      const token = await getAccessToken();
      const res = await fetch("/api/me", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ email: linkedAccount.address }),
      });
      if (res.ok) setLinked(linkedAccount.address);
      else {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Could not link that email.");
      }
    },
  });

  const short = `${walletAddress.slice(0, 4)}…${walletAddress.slice(-4)}`;

  return (
    <>
      <FieldLabel>Linked accounts</FieldLabel>

      <div className="mt-4 flex items-center justify-between gap-6">
        <span className="text-[15px] text-ink">Wallet</span>
        <span className="figure text-[13px] text-grey-on-ground">{short}</span>
      </div>

      <DashedRule className="mt-4" />

      <div className="mt-4 flex items-center justify-between gap-6">
        <span className="text-[15px] text-ink">Email</span>
        {linked ? (
          <span className="text-[13px] text-grey-on-ground">{linked}</span>
        ) : (
          <button
            type="button"
            onClick={linkEmail}
            className="rounded-full border border-hairline px-4 py-2 text-[13px] text-ink transition-colors hover:bg-surface"
          >
            Link one
          </button>
        )}
      </div>

      {error && <p role="alert" className="mt-3 text-[13px] text-ink">{error}</p>}
    </>
  );
}
```

- [ ] **Step 2: Persist the email.** On Privy's link callback, PATCH `/api/me` with the address. Add `email` to `PatchSchema` as `z.string().email().optional()`. Handle the `@unique` collision with 409 and the copy `That email is already linked to another account.`

- [ ] **Step 3: Say what it buys**, plainly and without alarm:

```tsx
<p className="mt-2 text-[13px] text-grey-on-ground">
  Lose the wallet and this is how you get back in. Nothing is sent to it.
</p>
```

- [ ] **Step 4: Verify end to end** — sign in with Phantom, link an email, sign out, confirm the row carries both.

- [ ] **Step 5: Verify and commit**

```bash
npm test && npm run typecheck && npm run lint
git add components/LinkedAccounts.tsx "app/(app)/settings/page.tsx" app/api/me/route.ts
git commit -m "feat: an email on the account, so a lost wallet is not a lost crew"
```

- [ ] **Step 6: Invoke `superpowers:verification-before-completion`** before reporting Lane C done.

---

## Lane D — Escrow protocol (prose only, no code)

### Task 12 (Lane D): Write `docs/security/escrow-protocol.md`

**Files:**
- Create: `docs/security/escrow-protocol.md`

**Reading required before writing:** `lib/vault.ts` (all of it), `lib/stake.ts:80-140` (`assertIsOurStakeTx`), `lib/settlement.ts:300-330`, `PRODUCT.md` "Capabilities and Constraints", `docs/superpowers/specs/2026-08-24-pact-design.md` §7.

- [ ] **Step 1: Section 1 — what v1 does today.** One `Keypair` per pact; secret encrypted AES-256-GCM under `VAULT_ENCRYPTION_KEY`, stored in `Pact.vaultSecretEnc`. State the exposure exactly: **anyone holding both the database and the encryption key can move any vault.** No euphemism, no "industry-standard encryption" framing.

- [ ] **Step 2: Section 2 — the v2 protocol.** PDA-per-pact so no human holds the pot. Instructions `initialize`, `deposit`, `settle`, `refund`. For each: who signs, what is checked on chain, what it cannot do. State explicitly what the sponsor **cannot** sign.

- [ ] **Step 3: Section 3 — threat model.** A table: threat, what v1 does, what v2 does, who must be trusted. Include the existing sponsor guard (`assertIsOurStakeTx`) and its documented gap — someone can get the sponsor to pay for a different DFlow swap that still delivers into the vault. That is a donation to the crew costing one fee, and it is already written down in `lib/stake.ts`. Do not overstate it.

- [ ] **Step 4: Section 4 — why v1 is the honest answer for this window.** Tie to the brief's own words ("creative ideas matter more than perfect code") and to the deadline. Say what would have to be true to ship v2.

- [ ] **Step 5: Adversarial read.** Re-read as a hostile judge. If you can find a weakness that is not already named in the document, add it. The document's value is that it finds its own holes first.

- [ ] **Step 6: Commit**

```bash
git add docs/security/escrow-protocol.md
git commit -m "docs: who can move the money, and who cannot"
```

---

## Lane E — Deploy & mainnet readiness

### Task 13 (Lane E): Railway with Postgres

- [ ] **Step 1: Invoke the `railway:use-railway` skill.** Do not hand-roll the CLI.

- [ ] **Step 2: Create the project and a Postgres service.** Set the release command to `npx prisma migrate deploy`.

- [ ] **Step 3: Set the environment.** Every key in `.env.example`, plus:
  - `SOLANA_RPC_URL` — a Helius or QuickNode key, **not** the public endpoint
  - `BLOB_READ_WRITE_TOKEN` — Vercel Blob
  - `STAKE_DRY_RUN` — **unset**, per the mainnet decision
  - `DFLOW_API_KEY` — if held

- [ ] **Step 4: Generate a domain** and confirm the landing page renders.

- [ ] **Step 5: Commit any config**

```bash
git add railway.json 2>/dev/null || true
git commit -m "feat: somewhere for judges to point a phone at" --allow-empty
```

### Task 14 (Lane E): Green preflight against production

- [ ] **Step 1: Fund the sponsor wallet.** `73qXTekqgjrdgXogdnwmxS1EudX21NHGzkzBqoaP5K25`, ~0.1 SOL. **Human action — blocks everything below.**

- [ ] **Step 2: Run preflight against the deployed env**

Run: `npm run preflight`
Expected: every line `ok`. If Sponsor wallet or Solana RPC is not ok, stop — the demo cannot run.

- [ ] **Step 3: Rehearse the signing chain without spending**

Run: `STAKE_DRY_RUN=1 npm run rehearse`
Expected: the route prices, the member signs, the sponsor co-signs, the guard passes, the simulation succeeds.

### Task 15 (Lane E): One real mainnet cycle, recorded

- [ ] **Step 1: Seed a pact** with a ~$1–2 stake. Use `npm run seed` as the starting point.

- [ ] **Step 2: Run the full cycle on mainnet** — join, stake, check in, `/settle`.

- [ ] **Step 3: Capture the signatures.** Record the Solscan URL for the stake transaction and for each settlement payout.

- [ ] **Step 3a: Close Task 2's deferred verification (Ruling 10).** Task 2 could not prove the
  payout-token round-trip: `finaliseStake` needs a real signed Solana transaction, and seeded
  members carry placeholder wallet strings (`seed-wallet-*`), not keypairs. This cycle is the
  first time a real wallet signs, so it is the first time the check is possible. Before staking,
  choose a NON-DEFAULT payout token (SOL, not USDC) in the stake sheet. After the stake confirms:

```bash
psql "$DATABASE_URL" -c 'select "payoutMint", status from "Membership" order by "stakedAt" desc limit 1;'
```

  Expected: `payoutMint` is the wSOL mint `So11111111111111111111111111111111111111112`, NOT the
  USDC default. If it is USDC, the write path is broken and Lane A is not done — stop and report.
  Then confirm settlement actually paid that member in SOL.

- [ ] **Step 4: Put them in `README.md`** under a new heading, with the plain statement of what each transaction is. This is the fallback if venue wifi fails on the 3rd, and it is the evidence for the submission form.

- [ ] **Step 5: Add the link to Lane D's document** from `README.md`. Lane E places it; Lane D does not edit this file.

- [ ] **Step 6: Commit**

```bash
git add README.md
git commit -m "docs: the transactions that prove it, and where the money is held"
```

- [ ] **Step 7: Invoke `superpowers:verification-before-completion`** before reporting Lane E done.

---

## Cut order

From spec §8. If the clock beats the plan, cut in this order and say so out loud:

1. **C3's socials and bio** — least demo value. Keep the name and avatar.
2. **B3/B4 reference photos** — riskiest, because they depend on a Blob token not yet held. Degrade to description-only (no upload) before cutting entirely.
3. Nothing else. C2 is ~30 minutes and ships regardless. D is prose and does not compete for the same hours. **E is not cuttable** — without it there is no demo.

Never cut from §7 verification to save time.

---

## Task 17 (Lane A): The stake guard does not check the amount

**Added 2026-08-29 by Ruling 11.** Not in the original plan. Found by Task 12's adversarial
pass while writing the escrow document, and verified independently by the controller.

**The bug.** `assertIsOurStakeTx` (`lib/stake.ts:112`) validates a stake transaction
structurally — two signers, sponsor as fee payer, the vault among the accounts, programs on an
allowlist — and never checks how much it delivers. `finaliseStake` then signs, submits, and
writes `status: "staked"` with no comparison against `pact.stakeUsdc` and no vault balance
read. On the USDC transfer path an authenticated member can hand-build a structurally identical
`transferChecked` of one atomic unit and be recorded as fully staked.

**Why it costs real money.** `settlePact` pays every winner their principal back —
`lib/settlement.ts:258`, `const principal = pact.stakeUsdc` — while the pot is the vault's
*actual* balance. An under-staker who keeps the rule is paid a full stake out of the other
members' money. If the vault cannot cover every winner's principal, payouts run in sequence
until it is empty and the rest fail on chain, so the shortfall lands on whoever the loop
reaches last. That is nobody's decision, which is the part that makes it unacceptable.

This is member-against-crew, not operator-against-crew. It is the inverse of the donation gap
the existing comment names, and it is not covered by it.

**Files:**
- Modify: `lib/stake.ts` (`finaliseStake`, and `assertIsOurStakeTx`'s doc comment)
- Test: `lib/__tests__/stake.test.ts`

- [ ] **Step 1: Choose the check, and say why in a comment.** Two options; the second is
  recommended. (a) Assert inside the guard that the transaction delivers at least
  `pact.stakeUsdc` into the vault — hard, because the swap path's output is not statically
  knowable from the transaction and address-lookup tables make instruction parsing fiddly.
  (b) Read the vault's USDC balance immediately before and after confirmation and require the
  rise to be at least `pact.stakeUsdc`. Works identically for the swap and transfer paths and
  needs no instruction parsing.

- [ ] **Step 2: Write the failing test** covering an under-delivering stake: the membership
  must NOT be written `staked`, and the caller must get a `StakeGuardError` they can read.

- [ ] **Step 3: Run it and watch it fail.** `npm test -- lib/__tests__/stake.test.ts`

- [ ] **Step 4: Implement.** Under `DRY_RUN` nothing broadcasts, so the balance cannot rise —
  the check must be skipped there, and the skip must be commented as deliberate.

- [ ] **Step 5: Run and watch it pass.**

- [ ] **Step 6: Correct the guard's doc comment.** It currently names only the over-delivery
  ("donation") gap. Say what the guard does and does not check now.

- [ ] **Step 7: Report the residual honestly.** A balance-delta check races with a concurrent
  stake into the same vault: a second member's deposit landing inside the window could mask an
  under-delivery. Say so in the report; the escrow document will record it rather than pretend
  it is closed.

- [ ] **Step 8: Verify and commit**

```bash
npm test && npm run typecheck && npm run lint
git add lib/stake.ts lib/__tests__/stake.test.ts
git commit -m "fix: a stake that does not arrive is not a stake"
```

---

## Integration

### Task 16 (Lane F): Merge, review, submit

- [ ] **Step 1: Full green on the branch**

```bash
npm test && npm run typecheck && npm run lint && npm run preflight
```

- [ ] **Step 2: Invoke `superpowers:requesting-code-review`** across the whole branch diff.

- [ ] **Step 3: Walk the 4-minute demo script** from the spec §6, on the deployed URL, on a phone. Time it. If it runs over, cut from the dashboard beat at 3:40, never from the two DFlow moments.

- [ ] **Step 4: Submit** before 2026-08-31 23:59 ICT. Registering for Demo Day is **not** a submission — the form is separate.
