# Consistently

A group agrees a rule and each member stakes real money on keeping it. Whoever breaks the
rule forfeits their stake to the people who kept it, automatically, without anyone having to
ask.

See `PRODUCT.md` for what it is and `DESIGN.md` for what it looks like.

## How DFlow powers this

Your bank will not let you fine your friend. Moving money between private
individuals as a penalty requires being a licensed money transmitter, and no
card processor permits it — which is why every other accountability app either
keeps the money itself, pays a charity, or gives up and keeps a ledger. Crypto
rails are not the awkward choice here. They are the only ones that let a
forfeited stake go straight to the people who earned it.

DFlow is what makes that survivable for people who are not in crypto. It is
load-bearing at both ends:

| Moment | What DFlow does | Why it is load-bearing |
|---|---|---|
| Joining | `GET /order` routes **any** Solana token into USDC | Removes "go and buy the right coin first", which is the step that kills a signup. Members bring what they hold. |
| Joining | `destinationWallet` delivers the output into the pact vault | Convert *and* deposit in one indivisible transaction. There is no state where a member's token was sold but the stake never arrived. |
| Joining | `sponsor` pays the fee | A gym group of six will have no SOL between them. Without this, onboarding is dead. |
| Joining | the route creates the vault's token account, sponsor-funded | A brand-new pact vault needs no setup and never needs SOL. |
| Settling | `GET /order` again, once **per winner**, into the token each of them chose | One settlement becomes N swaps rather than one. |
| Settling | `platformFeeBps` + `feeAccount` | The revenue model, and DFlow's own monetisation feature. |

`lib/dflow.ts` is the client, `lib/stake.ts` is the way in and `lib/settlement.ts`
is the way out. Two facts worth knowing if you read them:

- **There is no exact-out.** `swapMode=ExactOut` is accepted and silently
  ignored, so "give me exactly ฿1,000 of USDC" has to be approximated by
  pricing the reverse direction and over-sending by a headroom. Measured on
  SOL/USDC at 100bps, that headroom has to be about 3% or the worst-case output
  lands *below* the stake — on the deepest pair on the chain. The surplus is not
  kept: settlement sweeps the vault's real balance, so it comes back to the crew.
- **The order's blockhash lives about a minute.** So the stake sheet shows a
  quote-only price, which carries no blockhash and can sit on screen, and builds
  the real order on the tap. Nothing between the tap and the chain asks a
  question.

## Running it

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

**No environment variables are required to see the app.** With none set it renders the
demo below, all the way from the landing page to the channel. Set `DATABASE_URL` and
`NEXT_PUBLIC_PRIVY_APP_ID` (with `PRIVY_APP_SECRET`) and the same screens read Postgres
instead. `.env.example` names every key and says what it is for.

## Real data, and the demo behind it

`lib/session.ts` is the seam. It falls back to the demo whenever it cannot name a
viewer — which covers no database, no Privy app, and simply not being signed in, with
one branch and one answer. `lib/channel-client.ts` is the same seam on the client.

| Reads | Real | Fallback |
|---|---|---|
| `getSession` / `getPact` | `lib/queries.ts` over Prisma | `lib/mock-session.ts` |
| the channel's writes | the API routes | the mock's in-memory maps |

The demo is `lib/mock-session.ts` — a signed-in user with two pacts, four and two
members, mid-week, in Thai baht. It is the builder's own situation. Nothing in it
invents a shape: crew rows are produced by the real `leaderboard()` over real
`SessionRecord`s, and the types are now `lib/view.ts`, which the real queries satisfy
too. Deleting the file breaks only the `if (!LIVE)` branches.

Two things `lib/queries.ts` has to get right that are easy to miss:

- **Sessions are windowed to the evaluation period** before `countValidDays` or
  `hasFailed` see them. Both document that precondition. An unwindowed list means
  every member's lifetime count exceeds the cadence, so after week two nobody ever
  fails again — and nothing errors.
- **The dashboard converts before it sums.** Each pact carries its own currency and
  its own locked rate, so totalling them raw adds baht to pounds and prints the
  result as one or the other.

The mock clock is frozen (`MOCK_NOW`) so the screens compose the same way every time: a
Friday morning, the first day of the week on which a five-a-week member can already be
finished (Nat) and another can already be out of reach (Dave).

**Inside a group the mock runs one real second to the minute.** A check-in is recorded at the
real clock, so with real minutes the second half of the demo would mean standing there for
thirty of them. Compressed, an early check-out is refused by the same arithmetic against the
same rule and thirty seconds later the same check-out is accepted. The route it stands in for
uses wall time; only `lib/mock-session.ts` knows about the compression.

## Sign-in, and the wallet gate

Privy, email and a six-digit code. No password, therefore no 2FA. Signing in creates an
embedded Solana wallet; nobody is asked to know what a wallet is.

`components/FrontDoor.tsx` takes an `Auth` rather than knowing which mechanism is behind
it, so the demo path and the real one drive the same four states. **With no app id set,
the provider is not mounted and the door runs its own timings: any six digits are
accepted.**

Then `/welcome`, which is the only screen that says what the product is — the landing
page is one line on purpose — and which **holds the door shut until the wallet holds
something.** The gate is split by what each half costs:

| Where | Checks | Cost |
|---|---|---|
| `proxy.ts` | is a `privy-token` cookie present | nothing |
| `app/(app)/layout.tsx` | does it verify, and is `walletFundedAt` stamped | one indexed query |
| `GET /api/wallet/balance` | does the wallet hold SOL **or any SPL token** | one RPC call, once per account ever |

`walletFundedAt` is stamped once and never re-checked, because funding is a one-way door.
The SPL half matters: somebody funded in USDC from an exchange has zero lamports and can
still stake, because the sponsor pays the fee.

Next 16 renamed `middleware` to `proxy`, and its docs are explicit that it runs separately
from render code — hence cookie presence there and the real check in the layout.

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

**The invite QR encodes `/?invite=<token>`, which is the sign-in.** `proxy.ts` catches that
parameter on any path, moves it into a cookie and strips it from the URL — a server
component cannot set a cookie, and the token has to survive sign-in and the whole of
onboarding. `/welcome` then names the pact rather than asking a stranger to send crypto to
an unexplained address, and `/join` redeems it into the channel.

## Known limitations

- **Authentication is partial.** Every route that moves money or reads across pacts
  verifies the caller's Privy token (`lib/auth.ts`). The check-in, feed, reaction and
  exemption routes still take the wallet from the request body and believe it. That is
  the first thing to close with any spare time.
- **Custody.** Stakes sit in a per-pact vault whose key is held server-side, encrypted
  (`lib/vault.ts`). A non-custodial escrow program is the production answer; writing,
  testing and auditing a Solana program was not a thing this window had room for.
- **A member staking a non-USDC token overpays** by the slippage headroom (~3%). It is
  not kept — settlement sweeps the vault's actual balance, so the surplus returns to
  whoever kept the rule rather than accreting.
- **The stake guard is structural, not exact.** `finaliseStake` checks that what it is
  asked to co-sign has the shape of an order we built — two signers, our sponsor as fee
  payer, only the programs a DFlow route touches, this pact's vault present — rather than
  comparing message bytes, which would need somewhere to keep them between requests. What
  gets through is a donation to a crew, not a theft.
- **A period is settled by `/settle`, not by a clock.** There is no scheduler.
- Solana only. Tokens on other chains and balances on centralised exchanges are unreachable.
- Members bring their own crypto. There is no fiat on-ramp.
- **Privy's cookies are `Secure`.** A browser will accept them on `http://localhost` and
  will not on `http://192.168.x.x`, so the second-phone half of a demo has to run against
  an HTTPS deployment.

## Checks

```bash
npx tsc --noEmit
npx vitest run
```
