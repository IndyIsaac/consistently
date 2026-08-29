# Consistently

A crew agrees a rule and each member stakes real money on keeping it. Whoever breaks the rule
forfeits their stake to the people who kept it, automatically, without anyone having to ask.

Built for the DFlow × Superteam Thailand Buildathon, against the brief *"build what happens
after the swap."* The swap is not the product here. It is the thing that makes the product
reachable by four people in a gym group who hold no USDC and have no SOL to pay a fee with.

**Live at https://web-production-8764a.up.railway.app**, on Solana mainnet. Nothing has moved
across it yet, and the reason is in [What is not done](#what-is-not-done), which is the section
to read first.

| | |
|---|---|
| What it is, and what it deliberately is not | [`PRODUCT.md`](PRODUCT.md) |
| What it looks like, and why | [`DESIGN.md`](DESIGN.md) |
| How it fits together, with diagrams | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) |
| Who can take the money, stated exactly | [`docs/security/escrow-protocol.md`](docs/security/escrow-protocol.md) |

## Why this needs DFlow

Your bank will not let you fine your friend. Moving money between private individuals as a
penalty requires being a licensed money transmitter, and no card processor permits it — which is
why every other accountability app either keeps the money itself, pays a charity, or gives up and
keeps a ledger. Crypto rails are not the awkward choice here. They are the only ones that let a
forfeited stake go straight to the people who earned it.

DFlow is what makes that survivable for people who are not in crypto. It is load-bearing at both
ends:

| Moment | What DFlow does | Why it is load-bearing |
|---|---|---|
| Joining | `GET /order` routes **any** Solana token into USDC | Removes "go and buy the right coin first", which is the step that kills a signup. Members bring what they hold. |
| Joining | `destinationWallet` delivers the output into the pact vault | Convert *and* deposit in one indivisible transaction. There is no state where a member's token was sold but the stake never arrived. |
| Joining | `sponsor` pays the fee | A gym group of six will have no SOL between them. Without this, onboarding is dead. |
| Joining | the route creates the vault's token account, sponsor-funded | A brand-new pact vault needs no setup and never needs SOL. |
| Settling | `GET /order` again, once **per winner**, into the token each of them chose | One settlement becomes N swaps rather than one. |
| Settling | `platformFeeBps` + `feeAccount` | The revenue model, and DFlow's own monetisation feature. |

`lib/dflow.ts` is the client, `lib/stake.ts` is the way in and `lib/settlement.ts` is the way
out. Two facts worth knowing if you read them:

- **There is no exact-out.** `swapMode=ExactOut` is accepted and silently ignored, so "give me
  exactly ฿1,000 of USDC" has to be approximated by pricing the reverse direction and over-sending
  by a headroom. Measured on SOL/USDC at 100bps, that headroom has to be about 3% or the worst-case
  output lands *below* the stake — on the deepest pair on the chain. The surplus is not kept:
  settlement sweeps the vault's real balance, so it comes back to the crew.
- **The order's blockhash lives about a minute.** So the stake sheet shows a quote-only price,
  which carries no blockhash and can sit on screen, and builds the real order on the tap. Nothing
  between the tap and the chain asks a question.

A winner who takes USDC is paid by a plain SPL transfer, because DFlow cannot route a mint to
itself. The second DFlow moment therefore only exists if a winner picked something other than the
default. That is a fact about the demo as much as about the code.

## Two holes we found in our own code

Both were found by writing [`docs/security/escrow-protocol.md`](docs/security/escrow-protocol.md),
not by testing. Neither was in code any task on this plan had been asked to touch. Both were fixed
before submission and the document keeps the account of them, including what the fixes do not do.

**The stake guard checked shape and never amount.** `assertIsOurStakeTx` verified that what it was
being asked to co-sign looked like an order we had built — two signers, our sponsor as fee payer,
this pact's vault present, only the programs a DFlow route touches — and never once read how much
USDC the transaction delivered. On the USDC path a member could hand-build that exact shape
carrying one atomic unit and be recorded fully staked. Settlement pays each winner a whole
principal out of the vault's *actual* balance, so an under-staker who kept the rule would have been
paid a full stake out of the money the rest of the crew put in, and the shortfall would have landed
on whoever the payout loop reached last.

The guard is still structural, because the swap path's delivered output is not knowable from the
bytes at all. The amount is no longer taken from the transaction we are asked to sign. It is taken
from the transaction that landed: `finaliseStake` broadcasts, waits for confirmation, and asks the
chain what that signature and only that signature moved, from `getTransaction`'s
`preTokenBalances` and `postTokenBalances` (`deliveredToVault`). Every way of not knowing ends in
a refusal rather than in a default — an erroring node, a transaction not served back, an absent
balance array, a USDC row that does not name its owner, an amount that does not parse. The obvious
version of this check reads the vault balance either side of the broadcast and takes the rise; that
was written first and replaced, because any USDC landing in that window counts, including the
attacker's own.

**A non-member could deliver a full stake and be answered with a 500.** `finaliseStake` read the
membership for the first time at the `update` that records the stake, which happens after the
broadcast. A caller with no row on the pact could therefore put their money into a crew's vault
and get back a Prisma `P2025` on a key naming nothing, which the route turns into HTTP 500 and
*"That did not go through"* — said to somebody whose transaction had just confirmed. A member told
their stake failed stakes again and pays twice. The membership is now read first, before the
sponsor signs and before anything is sent, and a caller with no row is told *"You are not in this
crew. Nothing was sent."* Nothing is broadcast, so no stranger's USDC reaches a vault this build
has no operator path to empty.

## What is here

Seven things landed after the first version of this file was written.

**A payout token per member.** A winner chooses at the moment they stake which token their share
arrives in, and settlement builds a real DFlow order per winner rather than one for the pot.
`PAYOUT_MINTS` in `lib/dflow.ts` is an allowlist rather than free text: an unroutable mint there
is a payout that silently never lands. The choice is written in the same Prisma update that flips
the membership to `staked`, because a second write that can fail on its own leaves a staked member
holding the default and nobody finds out until settlement pays the wrong token.

**Reference photos.** The creator uploads what a good check-in looks like, and that photo and a
280-character description sit above the camera when a member checks in, so everyone frames the same
shot. Nothing compares them. The crew does, which is `PRODUCT.md`'s trust-based design unchanged.
Check-out gets its own reference on pacts that have a check-out.

**One upload endpoint.** `POST /api/uploads` takes images under 5MB from a verified caller and
returns a URL. Reference photos, avatars and check-in photos all go through it and there is no
second path. Without `BLOB_READ_WRITE_TOKEN` it answers 503 rather than throwing, and a check-in
on a photo pact is refused rather than recorded blind — a session that banks a day against the
cadence with no photo behind it is the one thing the crew cannot check.

**A profile.** Name, avatar, one sentence, and four links. `PATCH /api/me` takes only the fields
the form offers; the caller is read from a verified Privy token and can only write their own row.

**A GitHub contribution calendar**, in Settings, for anyone who fills in their GitHub handle. The
component came from 21st.dev and encodes activity as a five-step green ramp; `DESIGN.md` reserves
green and red for money, "not status, not streaks, not navigation", so it was rebuilt on `var(--ink)`
at rising opacity, the same treatment the product's own day markers use. Deleting the two colour
tables also deleted the dark-mode branch, the `isDark` state and a `MutationObserver` watching for a
`.dark` class this app never sets.

**Email linked to a wallet.** The wallet is the account; this is the second way back to it. Privy's
own link flow, then `PATCH /api/me`, with the `@unique` column and Privy's own error code both
refusing an address already attached to somebody else.

**The theme toggle moved into the nav bar.** A control reached for on every screen has no business
waiting behind a tap into Settings, so `AppearanceSetting.tsx` is gone and `AppHeader` carries it.

## Running it

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

**No environment variables are required to see the app.** With none set it renders the demo below,
all the way from the landing page to the channel. Set `DATABASE_URL` and `NEXT_PUBLIC_PRIVY_APP_ID`
(with `PRIVY_APP_SECRET`) and the same screens read Postgres instead. `.env.example` names every
key and says what it is for.

The deployment runs on Railway with its own Postgres, which is empty on purpose: a judge arrives
signed out and makes their own pact rather than walking into somebody else's furnished one.
`STAKE_DRY_RUN` is unset there, so it is real mainnet.

## Real data, and the demo behind it

`lib/session.ts` is the seam. It falls back to the demo whenever it cannot name a viewer — which
covers no database, no Privy app, and simply not being signed in, with one branch and one answer.
`lib/channel-client.ts` is the same seam on the client.

| Reads | Real | Fallback |
|---|---|---|
| `getSession` / `getPact` | `lib/queries.ts` over Prisma | `lib/mock-session.ts` |
| the channel's writes | the API routes | the mock's in-memory maps |

The demo is `lib/mock-session.ts` — a signed-in user with two pacts, four and two members,
mid-week, in Thai baht. It is the builder's own situation. Nothing in it invents a shape: crew rows
are produced by the real `leaderboard()` over real `SessionRecord`s, and the types are `lib/view.ts`,
which the real queries satisfy too. Deleting the file breaks only the `if (!LIVE)` branches.

Two things `lib/queries.ts` has to get right that are easy to miss:

- **Sessions are windowed to the evaluation period** before `countValidDays` or `hasFailed` see
  them. Both document that precondition. An unwindowed list means every member's lifetime count
  exceeds the cadence, so after week two nobody ever fails again — and nothing errors.
- **The dashboard converts before it sums.** Each pact carries its own currency and its own locked
  rate, so totalling them raw adds baht to pounds and prints the result as one or the other.

The mock clock is frozen (`MOCK_NOW`) so the screens compose the same way every time: a Friday
morning, the first day of the week on which a five-a-week member can already be finished (Nat) and
another can already be out of reach (Dave).

**Inside a group the mock runs one real second to the minute.** A check-in is recorded at the real
clock, so with real minutes the second half of the demo would mean standing there for thirty of
them. Compressed, an early check-out is refused by the same arithmetic against the same rule and
thirty seconds later the same check-out is accepted. The route it stands in for uses wall time;
only `lib/mock-session.ts` knows about the compression.

## Sign-in, and the wallet gate

Privy, email and a six-digit code. No password, therefore no 2FA. Signing in creates an embedded
Solana wallet; nobody is asked to know what a wallet is.

`components/FrontDoor.tsx` takes an `Auth` rather than knowing which mechanism is behind it, so the
demo path and the real one drive the same four states. **With no app id set, the provider is not
mounted and the door runs its own timings: any six digits are accepted.**

Then `/welcome`, which is the only screen that says what the product is — the landing page is one
line on purpose — and which **holds the door shut until the wallet holds something.** The gate is
split by what each half costs:

| Where | Checks | Cost |
|---|---|---|
| `proxy.ts` | is a `privy-token` cookie present | nothing |
| `app/(app)/layout.tsx` | does it verify, and is `walletFundedAt` stamped | one indexed query |
| `GET /api/wallet/balance` | does the wallet hold SOL **or any SPL token** | one RPC call, once per account ever |

`walletFundedAt` is stamped once and never re-checked, because funding is a one-way door. The SPL
half matters: somebody funded in USDC from an exchange has zero lamports and can still stake,
because the sponsor pays the fee. Both token programs are queried, since a Token-2022 balance is
invisible to a `TOKEN_PROGRAM_ID` lookup and its owner would sit at the gate forever.

Next 16 renamed `middleware` to `proxy`, and its docs are explicit that it runs separately from
render code — hence cookie presence there and the real check in the layout.

**Two doors, one integration.** Privy is not a wallet — it is the thing that makes one, which is
what lets the app take both. Somebody who already has Phantom connects and signs with it, and
nothing is created or custodied for them. Somebody who has never held a token gets an embedded
wallet during the email sign-in and is never asked what a wallet is. That second case is
`PRODUCT.md`'s actual user; the first is the crew this was built for, who turn out to have Phantom
already.

`createOnLogin` is `users-without-wallets`, which is what stops the two colliding: a member who
arrives with Phantom is not handed a second, empty wallet to fund separately. And the stake is
signed by the wallet whose address the server recorded, not `wallets[0]` — a member with both has
two, in no guaranteed order, and signing with the wrong one produces a transaction that succeeds on
chain and belongs to nobody.

**A malformed app id used to 500 the landing page.** Privy throws during render on an id that is
not exactly 25 characters, and a React error boundary cannot help, because the throw is in the
server pass. `app/providers.tsx` mirrors that rule and checks before mounting, so a half-pasted
string degrades to the demo instead of a stack trace.

## The group channel

A bot channel, not a chat. The bot streams every action; a member can do exactly two things, take a
photo and run a slash command, and `/help` lists the seven commands there are. There is no message
composer and there is not going to be one. Every sentence the bot says is built in `lib/bot.ts` and
nowhere else, so it cannot drift into two voices.

Checking out before the rule's minimum is **refused at the moment it is attempted** rather than
recorded and judged at settlement — `closeSession` in `app/api/pacts/[id]/sessions/route.ts` throws
a `SessionGuardError` the caller sees as a 400. The moment a member's cadence becomes
arithmetically unreachable, the bot says so in the channel; the arithmetic is `cadenceOutlook` in
`lib/rules.ts` and the sentence is `outOfReachVerdict` in `lib/bot.ts`.

**The invite QR encodes `/?invite=<token>`, which is the sign-in.** `proxy.ts` catches that
parameter on any path, moves it into a cookie and strips it from the URL — a server component
cannot set a cookie, and the token has to survive sign-in and the whole of onboarding. `/welcome`
then names the pact rather than asking a stranger to send crypto to an unexplained address, and
`/join` redeems it into the channel.

### `/settle`, and `/settle force`

There is no scheduler. A period is closed when a member says it is closed.

`/settle` closes the most recent period that has actually finished and has not been settled
(`periodToSettle`). `/settle force` closes the period that is still running, which is the only
thing force is for: a week cannot be waited out in front of a room, and without it no period could
be closed in a four-minute demo. Forcing marks everyone who has not finished as having missed, and
the settlement row is the mutex, so it does not come back. `/help` says so, and the bot says so
again before it runs.

The gate is `parseSettle` in `lib/bot.ts`, and nothing but the exact word turns it on. A typo, a
near miss, an extra word and anything else all come back as not understood rather than falling
through to an ordinary settle — being wrong in that direction costs a member one retyped command,
and being wrong in the other costs them the pact. Server-side it is `force: z.boolean()` compared
`=== true`, so `"yes"`, `"false"` and `1` are all refused; no environment variable, retry or route
default sets it.

## Themes

Light and dark, switched from the toggle in the header on every screen. The choice is kept in
`localStorage`; with nothing kept, the system preference decides. A small script in
`app/layout.tsx` settles it before the first paint, so the page never flashes the wrong ground.

**The landing is deliberately the inverse of the app.** Light app, black front door; dark app, bone
front door. That flip of value — alongside the flip from mono to the app's grotesque — is what makes
signing in read as arrival, and it is the reason dark mode exists here at all. It is not a bug.

Every colour is a role defined twice in `app/globals.css`, once per theme, and nowhere else. The
money colours change between them: `#B42318` on the dark ground is 1.8:1, so dark uses `#F97066`
(7.02:1) and `#47CD89` (9.65:1).

## The device preview

`/preview` renders the running app inside a Galaxy S25 Ultra or an iPhone 16 Pro, live and
navigable, so proportions can be judged and the demo recorded without a screen recorder's chrome.
There is a light/dark switch beside the device switch.

**It is a development surface, not product.** Nothing links to it, it is not indexed, and deleting
`app/preview/` removes all of it.

## What is not done

The first two are the ones that matter for judging.

- **No transaction has been executed on mainnet.** The sponsor wallet is unfunded, so there are no
  transaction links in this repository and nobody has watched a stake land in a vault or a payout
  leave one. Everything below the browser has been exercised against live mainnet state by
  simulation only, under `STAKE_DRY_RUN=1`, which prices the route, signs with the member's wallet
  and the sponsor's, verifies both signatures and stops before the broadcast.
- **The demo script has not been walked end to end.** It is derived from reading `isValidSession`,
  `hasFailed`, `splitPot` and the payout branch, not from a rehearsal. The single most useful thing
  anyone can do before Demo Day is walk it once, on mainnet, with two phones.
- **Authentication is partial.** Every route that moves money or reads across pacts verifies the
  caller's Privy token (`lib/auth.ts`). The check-in, feed, reaction and exemption routes still take
  the wallet from the request body and believe it. That means the inputs to the settlement verdict
  are forgeable by anyone who can reach the API, which is row 7 of the threat model and the one
  finding an on-chain escrow would not fix.
- **Custody.** Stakes sit in a per-pact vault whose key is held server-side, encrypted
  (`lib/vault.ts`). We can take the money. The custody document says so in its first sentence and
  then says exactly how, what the on-chain replacement would do instead, and why it is not in this
  submission.
- **An honest stake can be stranded.** If the delivery check above never resolves, the transaction
  has confirmed, the USDC is in the vault and the membership is unwritten. The signature goes back
  to the client so a person can be shown what happened; there is no reconciliation table and no
  admin route, so being shown is not the same as being fixed.
- **A member staking a non-USDC token overpays** by the slippage headroom (~3%). It is not kept:
  settlement sweeps the vault's actual balance, so the surplus returns to whoever kept the rule.
- **A period a crew skips settling can never be settled from the channel**, and those stakes stay
  in the vault. That is a side effect of the floor that keeps `/settle` from sizing an old period
  against a vault holding the current one's money, and it is documented rather than unpicked two
  days before submission.
- **There is no leave and no refund.** `MemberStatus.left` is read in six places and written in
  none.
- Solana only. Tokens on other chains and balances on centralised exchanges are unreachable.
- Members bring their own crypto. There is no fiat on-ramp.
- **Photo upload is not configured on the deployment.** `BLOB_READ_WRITE_TOKEN` is unset, so
  `/api/uploads` answers 503 and the UI says so. `SOLANA_RPC_URL`, `DFLOW_API_KEY` and
  `ANTHROPIC_API_KEY` are also unset there; the first means the public endpoint, which rate-limits
  and drops confirmations under load, and the last means the rule drafter falls back to the manual
  fields.
- **Privy's cookies are `Secure`.** A browser will accept them on `http://localhost` and will not
  on `http://192.168.x.x`, so the second-phone half of a demo has to run against an HTTPS
  deployment.

## Checks

```bash
npm test          # vitest
npm run typecheck # tsc --noEmit
npm run lint      # eslint
npm run build     # the one that catches what tsc does not
```

The build is in that list because a package's type declarations can lie about what it actually
exports at runtime. `@privy-io/react-auth` declares `PrivyErrorCode` and does not ship it;
typecheck passed and the production build did not.

A fresh worktree needs `npx next typegen` before `npm run typecheck` will pass, because
`tsconfig.json` includes `.next/types/**/*.ts` and `.next` is gitignored.
