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
| `app/(app)/pacts/[id]/page.tsx` | `GET /api/pacts/[id]/view` and `GET /api/pacts/[id]/feed` |
| `components/Channel.tsx` | the sessions, feed, reaction and exemption routes |

Nothing in it invents a shape: crew rows extend `LeaderRow` from `lib/stats.ts` and are
produced by the real `leaderboard()` over real `SessionRecord`s; the pact and user carry the
Prisma column names from `prisma/schema.prisma`.

The mock clock is frozen (`MOCK_NOW`) so the screens compose the same way every time: a
Friday morning, the first day of the week on which a five-a-week member can already be
finished (Nat) and another can already be out of reach (Dave).

**Inside a group the mock runs one real second to the minute.** A check-in is recorded at the
real clock, so with real minutes the second half of the demo would mean standing there for
thirty of them. Compressed, an early check-out is refused by the same arithmetic against the
same rule and thirty seconds later the same check-out is accepted. The route it stands in for
uses wall time; only `lib/mock-session.ts` knows about the compression.

## Sign-in

Privy, email and a six-digit code. No password, therefore no 2FA.

`NEXT_PUBLIC_PRIVY_APP_ID` is read at build time. **With no app id set the flow keeps its real
shape but runs its own timings and hands you the mock session: any six digits are accepted.**
Set the app id and the guard in `components/FrontDoor.tsx` is where the real
`useLoginWithEmail()` calls go.

**The Google button is not wired and will not be.** It is rendered visibly unavailable —
disabled, dashed, labelled `NOT WIRED` — rather than live, on purpose: a dead button someone
presses on stage is worse than no button.

## Themes

Light and dark, switched from Settings. The choice is kept in `localStorage`; with nothing
kept, the system preference decides. A small script in `app/layout.tsx` settles it before the
first paint, so the page never flashes the wrong ground.

**The landing is deliberately the inverse of the app.** Light app, black front door; dark app,
bone front door. That flip of value — alongside the flip from mono to the app's grotesque — is
what makes signing in read as arrival, and it is the reason dark mode exists here at all. It
is not a bug.

Every colour is a role defined twice in `app/globals.css`, once per theme, and nowhere else.
The money colours change between them: `#B42318` on the dark ground is 1.8:1, so dark uses
`#F97066` (7.0:1) and `#47CD89` (9.7:1).

## The device preview

`/preview` renders the running app inside a Galaxy S25 Ultra or an iPhone 16 Pro, live and
navigable, so proportions can be judged and the demo recorded without a screen recorder's
chrome. There is a light/dark switch beside the device switch.

**It is a development surface, not product.** Nothing links to it, it is not indexed, and
deleting `app/preview/` removes all of it.

## The group channel

A bot channel, not a chat. The bot streams every action; a member can do exactly two things,
take a photo and run a slash command, and `/help` lists the six commands there are. There is
no message composer and there is not going to be one.

Checking out before the rule's minimum is **refused at the moment it is attempted** rather
than recorded and judged at settlement — `closeSession` in
`app/api/pacts/[id]/sessions/route.ts` throws a `SessionGuardError` the caller sees as a 400.
The moment a member's cadence becomes arithmetically unreachable, the bot says so in the
channel; the arithmetic is `cadenceOutlook` in `lib/rules.ts` and the sentence is
`outOfReachVerdict` in `lib/bot.ts`, which is where every word the bot says lives.

**The invite QR encodes `/?invite=<token>`, which is the sign-in.** The token rides in the URL
and nothing consumes it yet: joining from a scan is the next task, not this one.

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
