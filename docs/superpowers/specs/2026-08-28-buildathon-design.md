# Buildathon Submission — Design Spec

**Date:** 2026-08-28
**Competition:** DFlow × Superteam Thailand Buildathon
**Submission deadline:** 2026-08-31, 23:59 ICT (~3.5 days from this spec)
**Demo Day:** 2026-09-03, 13:30–16:00, Bangkok. Finalists confirmed 2026-09-01.
**Team:** Nam Bouchara, Indy Isaac (event permits 1–4)
**Branch:** `namearth5005/buildathon-demo` off `feat/wallets-and-groups`

---

## 1. What the organisers asked for

From the official event page (https://luma.com/9pxt4y29), verbatim:

> **"Build what happens after the swap."**
>
> **"Creative ideas matter more than perfect code. The goal is to build something people
> need and ship a working demo."**

Format: **4 minutes of demo, 3 minutes of judge Q&A.** Prize 1,000 USDC. The framing
across event materials is that a DFlow-powered trade should become an essential part of a
broader experience — explicitly *not* another standalone swap screen.

Three consequences drive every decision below.

1. **A working demo is the deliverable.** Not a program, not a whitepaper.
2. **Four minutes is the binding constraint**, not the three and a half days. Six features
   is more than four minutes holds, so features are ranked by screen time earned.
3. **Three minutes of Q&A is a deliverable too.** It is where custody gets asked about,
   and it is answered with a document, not with code.

Consistently is already aimed at this brief: the swap *is* the deposit, and the entire
product is what happens after it.

## 2. Decisions taken

| Decision | Choice | Why |
|---|---|---|
| Solana escrow | **Written protocol + threat model. No program.** | "Creative ideas matter more than perfect code." `PRODUCT.md` and the 2026-08-24 spec already scope on-chain escrow to v2 and disclose v1 custody plainly. Judges get a real answer in the Q&A without spending the window on Anchor. |
| Demo money | **Real mainnet, ~$1–2 stakes** | Real signatures on Solscan are the most convincing thing available in four minutes, and "is this actually on chain?" is the obvious first question. |
| GitHub stats panel | **Cut** | Requested in the 2026-08-27 review call. Fails "something people need" — the users are a gym crew and a CFA study pair — and costs demo time it cannot repay. Bio, avatar and socials ship; GitHub survives as one linkable social. |
| Reference photos | **Reference for humans, not automated validation** | `PRODUCT.md` lists "no automated proof verification" as a deliberate exclusion, not a gap. The creator sets the example shot; the crew judges against it. |
| Theme toggle in nav bar | **Ship it** | Reverses a decision documented in `AppearanceSetting.tsx` and `BottomNav.tsx`. Requested explicitly; cost is ~30 minutes. Noted as a reversal so future work knows it was deliberate. |

## 3. Lanes and file ownership

One shared worktree. Parallel safety comes from **exclusive file ownership**, not from
separate checkouts — five checkouts would cost more in merges than they save in conflicts,
at this deadline.

| Lane | Owns exclusively | Migration | Parallel from |
|---|---|---|---|
| **A. Currency & payouts** | `components/StakeSheet.tsx`, `lib/settlement.ts`, `lib/fx.ts`, `app/api/pacts/[id]/settle/route.ts` | none | start |
| **B. Reference photos** | `components/NewPact.tsx`, `components/RuleEditor.tsx`, `components/CheckInCamera.tsx`, `lib/rules.ts` | none | start |
| **C. Profile, appearance & recovery** | `app/(app)/settings/page.tsx`, `components/AppHeader.tsx`, `components/AppearanceSetting.tsx`, `prisma/schema.prisma`, `app/api/me/route.ts` | **the only one** | start |
| **D. Escrow protocol** | `docs/security/escrow-protocol.md` | none | start |
| **E. Deploy & mainnet readiness** | Railway config, `.env`, `README.md` | none | start |

Lane E owns `README.md` outright. Lane D does not edit it — it hands E a one-line link to
`docs/security/escrow-protocol.md` and E places it.

**Why C is one lane and not three.** The theme-toggle move, the profile build-out and the
email linking all touch `User` and the Settings page. Splitting them puts two agents on one
Prisma migration, which is the failure mode that costs a night. One lane, one migration,
one owner.

**The single cross-lane collision.** Lane A wants USDC as the default currency on the
create form; that form is `NewPact.tsx`, owned by B. **B makes that change.** A does not
open the file.

## 4. Data model

**One migration, owned by Lane C**, on `User`:

```prisma
bio       String?
avatarUrl String?
socials   Json?
email     String?  @unique
```

`socials` is a Json map of platform to handle or URL — `{ "x": "...", "github": "...",
"instagram": "...", "telegram": "..." }` — rather than four nullable columns, because the
set is presentational and will change.

**Reference photos need no migration.** They extend `RuleConfigSchema` (zod, `lib/rules.ts`)
inside the existing `Pact.ruleConfig` Json column:

```ts
checkInReferenceUrl:  z.string().url().optional(),
checkOutReferenceUrl: z.string().url().optional(),
proofDescription:     z.string().max(280).optional(),
```

This is what lets B and C run concurrently.

**Payout tokens need no migration.** `Membership.payoutMint` already exists and already
defaults to the USDC mint; `lib/settlement.ts` already reads it per winner. Lane A is
building the UI over plumbing that is already there.

## 5. Lane specs

### Lane A — Currency & payouts

The highest brief-alignment item on the list: this is the second of the two DFlow moments,
and the one that shows the aggregator doing something a plain transfer cannot.

- A member chooses the token they want to be **paid out in** when they stake. Written to
  `Membership.payoutMint`.
- Settlement already routes one `GET /order` per winner into that member's chosen mint.
  Surface it: the settlement feed item names the token each winner received.
- Show the live quote in the picker so the choice is legible — reuse `getQuote`, which
  carries no blockhash and can sit on screen (see `README.md`, "the order's blockhash lives
  about a minute").
- Stake currency stays the pact's own (฿, £, $) with `fxRateToUsd` frozen at creation. USDC
  becomes the **default selection** on the create form — that change is made by Lane B.

**Done when:** a member can pick a payout token, the choice persists, settlement pays in it,
and the feed says so.

### Lane B — Reference photos

- New optional step in pact creation: the creator uploads a **check-in reference photo**, a
  **check-out reference photo**, and a one-line description of what counts as proof.
- Uploads go to Vercel Blob (`BLOB_READ_WRITE_TOKEN`). Multi-device is required — judges
  join from their own phones — so photos must not live only in the tab that took them.
- `CheckInCamera.tsx` shows the reference alongside the viewfinder while a member frames
  their shot.
- The bot surfaces the description in `/help`.
- **Not validation.** No image comparison, no scoring, no automated pass/fail. The crew
  looks at the photos. This is `PRODUCT.md`'s trust-based design, unchanged.
- Also owns: USDC as default currency on the create form (Lane A's one-line dependency).

**Done when:** a creator can set references, a member sees them while checking in, and both
survive a page load on a different device.

### Lane C — Profile, appearance & recovery

- **Theme toggle moves into `AppHeader`.** The ask was "move", not "duplicate": the
  toggle appears in the nav bar and the Appearance row is **removed** from Settings.
  `AppearanceSetting.tsx` is deleted rather than left orphaned. Update the comments in
  `ThemeToggle.tsx` and `BottomNav.tsx` that assert the theme deliberately does not live in
  the bar, so the reversal is recorded rather than contradicted by its own source.
- **Profile build-out.** `app/(app)/settings/page.tsx` is currently commented
  `/** PLACEHOLDER. */`. Ship: editable display name, avatar upload (Blob), bio,
  and social links. **No GitHub stats panel.**
- **Email ↔ wallet linking.** Privy `useLinkAccount` / `linkEmail`. Store on `User.email`.
  The Settings panel states plainly what linking buys: a way back into the account if the
  Phantom wallet is lost. This is the account-recovery ask from the review call.
- Owns the one migration.

**Done when:** a signed-in member can set name, avatar, bio and socials; link an email to a
Phantom-created account; and toggle the theme from the nav bar.

### Lane D — Escrow protocol (document only, no code)

`docs/security/escrow-protocol.md`, written to be read aloud in a three-minute Q&A.

1. **What v1 does today, stated plainly.** One `Keypair` per pact; its secret encrypted
   AES-256-GCM under `VAULT_ENCRYPTION_KEY` and stored in `Pact.vaultSecretEnc`
   (`lib/vault.ts`). Name the exposure exactly: anyone holding both the database and the
   encryption key can move any vault. No euphemism.
2. **The v2 protocol.** PDA-per-pact so no human holds the pot. Instruction set —
   `initialize`, `deposit`, `settle`, `refund`. Who holds authority, and specifically what
   the sponsor **cannot** sign. How settlement math is constrained on-chain so a compromised
   server cannot redirect a payout.
3. **Threat model.** For each design: what it stops, what it does not, and who has to be
   trusted. Include the existing `assertIsOurStakeTx` sponsor guard in `lib/stake.ts` and
   what it deliberately does not prevent (a donation into the vault, costing one fee).
4. **Why v1 is the honest answer for this window**, tied to the brief's own words and to the
   deadline.

**Done when:** a reader who is hostile can find the weakness before we tell them, and finds
it already written down.

### Lane E — Deploy & mainnet readiness

- Railway project with Postgres. `prisma migrate deploy` in the release step.
- Env parity with `.env.example`, plus the three that are currently missing.
- `STAKE_DRY_RUN` **unset** in production.
- Public URL, so the join-by-QR moment works from a judge's own phone
  (`DESIGN.md:139` already identifies this as the demo's best physical beat).
- Get `npm run preflight` to all-green against production.
- One real mainnet cycle — join, stake, check in, settle — captured with Solscan links in
  the README before the 31st.

**Done when:** preflight is green on the deployed URL and a real settlement exists on chain.

## 6. Demo script — 4 minutes

Written now, because it is the actual constraint and it determines what the lanes must
make visible.

| Time | Beat |
|---|---|
| 0:00–0:30 | The problem. Chasing a friend for ฿1,000. Real Telegram screenshots from the builder's own four-month group. |
| 0:30–1:10 | Create a pact: rule, stake, reference photo. Invite QR on screen. |
| 1:10–2:10 | **A judge scans and joins from their own phone.** Onboarding → stake in whatever they hold → **DFlow converts and delivers into the vault in one transaction, sponsor pays the fee.** First DFlow moment. |
| 2:10–2:50 | Photo check-in against the reference. Bot refuses an early check-out in real time. |
| 2:50–3:40 | `/settle`. Forfeited stake redistributes — **each winner paid in the token they chose.** Second DFlow moment. |
| 3:40–4:00 | Dashboard: what you are up, what you are down. |

Custody is **not** demoed. It is answered in Q&A from Lane D's document.

## 7. Verification

Every lane lands green before it is considered done:

```
npm test          # vitest
npm run typecheck # tsc --noEmit
npm run lint      # eslint
```

Lane E additionally owns `npm run preflight` all-green. `npm run rehearse` proves the
signing chain end to end without spending, and is run before any real money moves.

No lane claims completion without pasting the output. Evidence before assertions.

## 8. Cut order if time runs out

1. Bio and socials (Lane C's tail) — cut first, least demo value.
2. Reference photos (Lane B) — riskiest, because it depends on a Blob token we do not yet
   hold. If the token does not arrive, cut to description-only with no upload.
3. Everything else holds.

The theme toggle is ~30 minutes and ships regardless. Lane D is prose and does not compete
for the same hours. Lane E is not cuttable — without it there is no demo.

## 9. Risks

| Risk | Mitigation |
|---|---|
| **Sponsor wallet is empty** (`73qXTekqgjrdgXogdnwmxS1EudX21NHGzkzBqoaP5K25`, 0.0000 SOL). Nothing in the money path works. | Fund with ~0.1 SOL immediately. Blocks Lane E and the whole mainnet decision. |
| **Public RPC stalls on stage.** Fails under load, not in testing. | Helius or QuickNode key into `SOLANA_RPC_URL` before Demo Day. |
| **No Blob token** — photos do not survive leaving the tab, which breaks the multi-device demo. | Provision Vercel Blob. Fallback: description-only references. |
| Live demo depends on venue wifi and mainnet confirmation. | Recorded mainnet run with Solscan links as the fallback, per Lane E. |
| Submission form requirements unconfirmed (the review call mentioned a 2-minute video; the event page describes a 4-minute live demo). | Indy to confirm the form's actual asks. Both are probably true — video to submit, live to present. |

## 10. Human action items — start now, they have lead time

1. **Fund `73qXTekqgjrdgXogdnwmxS1EudX21NHGzkzBqoaP5K25` with ~0.1 SOL.** — Nam
2. Helius/QuickNode key → `SOLANA_RPC_URL`. — Nam
3. Vercel Blob token → `BLOB_READ_WRITE_TOKEN`. — Nam
4. Confirm submission form requirements. — Indy
5. Optional: `ANTHROPIC_API_KEY` for the plain-English rule drafter, which is a good demo
   beat but not load-bearing.
