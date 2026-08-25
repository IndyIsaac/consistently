# Consistently

A group agrees a rule and each member stakes real money on keeping it. Whoever breaks the
rule forfeits their stake to the people who kept it, automatically, without anyone having to
ask.

See `PRODUCT.md` for what it is and `DESIGN.md` for what it looks like.

## Running it

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

**No environment variables are required to see the app.** There is no database call, no
Privy app id and no wallet on the path from the landing page to the dashboard.

## The dev mock session

Every signed-in screen reads `lib/mock-session.ts` — a signed-in user with two pacts, four
and two members, mid-week, in Thai baht. It is the builder's own situation.

To delete the mock, delete that file. Three call sites break, and each one is the exact place
a real query belongs:

| Call site | Replace with |
|---|---|
| `app/(app)/dashboard/page.tsx` | the signed-in user's pacts |
| `app/(app)/groups/page.tsx` | the signed-in user's memberships |
| `app/(app)/pacts/[id]/page.tsx` | `GET /api/pacts/[id]/view` |

Nothing in it invents a shape: crew rows extend `LeaderRow` from `lib/stats.ts` and are
produced by the real `leaderboard()` over real `SessionRecord`s; the pact and user carry the
Prisma column names from `prisma/schema.prisma`.

The mock clock is frozen (`MOCK_NOW`) so the screens compose the same way every time.

## Sign-in

Privy, email and a six-digit code. No password, therefore no 2FA.

`NEXT_PUBLIC_PRIVY_APP_ID` is read at build time. **With no app id set the flow keeps its real
shape but runs its own timings and hands you the mock session: any six digits are accepted.**
Set the app id and the guard in `components/FrontDoor.tsx` is where the real
`useLoginWithEmail()` calls go.

**The Google button is not wired and will not be.** It is rendered visibly unavailable —
disabled, dashed, labelled `NOT WIRED` — rather than live, on purpose: a dead button someone
presses on stage is worse than no button.

## Known limitations

- **No authentication in v1.** Requests name a wallet and are believed.
- Solana only. Tokens on other chains and balances on centralised exchanges are unreachable.
- Stakes are custodied per-pact in a server-held encrypted vault; a non-custodial escrow
  program is the production answer and is not built.
- Members bring their own crypto. There is no fiat on-ramp.

## Checks

```bash
npx tsc --noEmit
npx vitest run
```
