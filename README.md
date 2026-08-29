# Consistently

A crew agrees a rule and each member stakes real money on keeping it. Whoever breaks the rule
forfeits their stake to the people who kept it, automatically, without anyone having to ask.

Built for the DFlow × Superteam Thailand Buildathon, against the brief *"build what happens after
the swap."* The swap is not the product here. It is what makes the product reachable by four people
in a gym group who hold no USDC and have no SOL to pay a fee with.

**Live at https://web-production-8764a.up.railway.app**, on Solana mainnet. Nothing has moved
across it yet, and the reason is in [What is not done](#what-is-not-done), which is the section to
read first.

| | |
|---|---|
| What it is, and deliberately is not | [`PRODUCT.md`](PRODUCT.md) |
| What it looks like, and why | [`DESIGN.md`](DESIGN.md) |
| How it fits together, with diagrams | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) |
| Who can take the money, stated exactly | [`docs/security/escrow-protocol.md`](docs/security/escrow-protocol.md) |

## Why this needs DFlow

Your bank will not let you fine your friend. Moving money between private individuals as a penalty
requires being a licensed money transmitter, and no card processor permits it, which is why every
other accountability app keeps the money itself, pays a charity, or gives up and keeps a ledger.
Crypto rails are the only ones that let a forfeited stake go straight to the people who earned it.

DFlow is load-bearing at both ends:

| Moment | What DFlow does |
|---|---|
| Joining | `GET /order` routes **any** Solana token into USDC, so nobody buys the right coin first |
| Joining | `destinationWallet` delivers into the vault in the same transaction, so a token is never sold without the stake arriving |
| Joining | `sponsor` pays the fee, because a gym group of six has no SOL between them |
| Settling | `GET /order` again, once **per winner**, into the token each of them chose |

`lib/dflow.ts` is the client, `lib/stake.ts` the way in, `lib/settlement.ts` the way out. Two
things to know: there is **no exact-out** (`swapMode=ExactOut` is accepted and ignored), so a stake
is priced in reverse and over-sent by ~3%, and the surplus returns to the crew at settlement; and
**an order's blockhash lives about a minute**, so the stake sheet shows a quote-only price and
builds the real order on the tap.

A winner who takes USDC is paid by a plain SPL transfer, because DFlow cannot route a mint to
itself. **The second DFlow moment only exists if a winner picked something other than the default.**

## Two holes we found in our own code

Both were found by writing [the custody document](docs/security/escrow-protocol.md), not by testing.
Neither was in code any planned task had been asked to touch. Both are fixed.

**The stake guard checked shape and never amount.** `assertIsOurStakeTx` verified that a
transaction looked like an order we built (two signers, our sponsor as fee payer, this vault
present, only DFlow's programs) and never read how much USDC it delivered. A member could
hand-build that shape carrying one atomic unit and be recorded fully staked, then be paid a whole
principal out of the money the rest of the crew put in.

The amount is now taken from the transaction that *landed*, not the one we were asked to sign:
`finaliseStake` broadcasts, waits for confirmation, and asks the chain what that signature moved
via `getTransaction`'s token balances (`deliveredToVault`). Every way of not knowing ends in a
refusal rather than a default. The obvious version reads the vault balance either side of the
broadcast and takes the rise; that was written first and replaced, because any USDC landing in the
window counts, including the attacker's own.

**A non-member could deliver a full stake and get a 500.** The membership was first read at the
`update` that records the stake, which happens after the broadcast, so a caller with no row put
money in a vault and got back a Prisma `P2025` rendered as *"That did not go through"* to somebody
whose transaction had just confirmed. A member told their stake failed stakes again and pays twice.
The membership is now read before the sponsor signs and before anything is sent.

## What is here

- **A payout token per member.** Chosen when staking, written in the same update that flips the
  membership to `staked`. `PAYOUT_MINTS` is an allowlist, not free text: an unroutable mint is a
  payout that silently never lands.
- **Reference photos.** The creator uploads what a good check-in looks like; it sits above the
  camera so everyone frames the same shot. Nothing compares them. The crew does.
- **One upload endpoint.** `POST /api/uploads`, images under 5MB, verified caller. Without
  `BLOB_READ_WRITE_TOKEN` it answers 503 and a photo check-in is refused rather than recorded blind.
- **A profile.** Name, avatar, one sentence, four links. `PATCH /api/me` reads the caller from a
  verified token and can only write their own row.
- **A GitHub contribution calendar** for anyone who fills in a handle. The 21st.dev original
  encodes activity as a green ramp; `DESIGN.md` reserves colour for money, so it was rebuilt on
  `var(--ink)` at rising opacity, the treatment the product's own day markers use.
- **Email linked to a wallet.** The wallet is the account; this is the second way back to it.
- **The theme toggle moved into the nav bar.** A control reached for on every screen has no
  business behind a tap into Settings.

## Running it

```bash
npm install && npm run dev
```

**No environment variables are required to see the app.** With none set it renders the demo, all
the way from the landing page to the channel. Set `DATABASE_URL` and `NEXT_PUBLIC_PRIVY_APP_ID`
(with `PRIVY_APP_SECRET`) and the same screens read Postgres. `.env.example` names every key.

The deployment runs on Railway with its own Postgres, empty on purpose: a judge arrives signed out
and makes their own pact rather than walking into a furnished one. `STAKE_DRY_RUN` is unset there,
so it is real mainnet.

## Real data, and the demo behind it

`lib/session.ts` is the seam. It falls back to the demo whenever it cannot name a viewer, which
covers no database, no Privy app, and simply not being signed in, with one branch and one answer.

| Reads | Real | Fallback |
|---|---|---|
| `getSession` / `getPact` | `lib/queries.ts` over Prisma | `lib/mock-session.ts` |
| the channel's writes | the API routes | the mock's in-memory maps |

The demo is a signed-in user with two pacts, mid-week, in Thai baht: the builder's own situation.
Nothing in it invents a shape, because crew rows come from the real `leaderboard()` over real
`SessionRecord`s. Its clock is frozen so the screens compose identically every time, and inside a
group one real second stands for a minute, so an early check-out can be refused and then accepted
thirty seconds later instead of thirty minutes.

Two things `lib/queries.ts` has to get right: **sessions are windowed to the evaluation period**
before `hasFailed` sees them (an unwindowed list means nobody ever fails after week two, silently),
and **the dashboard converts before it sums**, because each pact carries its own currency and its
own locked rate.

## Sign-in, and the wallet gate

Privy, email and a six-digit code, or Phantom. No password, therefore no 2FA. `FrontDoor.tsx` takes
an `Auth` rather than knowing which mechanism is behind it, so the demo and the real path drive the
same four states. With no app id set the provider is not mounted and any six digits are accepted.

Then `/welcome`, the only screen that says what the product is, which **holds the door shut until
the wallet holds something.** The gate is split by what each half costs:

| Where | Checks | Cost |
|---|---|---|
| `proxy.ts` | is a `privy-token` cookie present | nothing |
| `app/(app)/layout.tsx` | does it verify, and is `walletFundedAt` stamped | one indexed query |
| `GET /api/wallet/balance` | does the wallet hold SOL **or any SPL token** | one RPC call, once per account ever |

`walletFundedAt` is stamped once and never re-checked, because funding is a one-way door. The SPL
half matters: somebody funded in USDC from an exchange has zero lamports and can still stake,
because the sponsor pays the fee. Both token programs are queried, since a Token-2022 balance is
invisible to a `TOKEN_PROGRAM_ID` lookup.

**Two doors, one integration.** Privy is not a wallet, it is the thing that makes one, which is what
lets the app take both. Phantom users connect and sign; nothing is created or custodied for them.
Everyone else gets an embedded wallet and is never asked what a wallet is. `createOnLogin` is
`users-without-wallets` so the two do not collide, and the stake is signed by the wallet whose
address the server recorded rather than `wallets[0]`, because a member with both has two in no
guaranteed order.

## The group channel

A bot channel, not a chat. A member can take a photo or run a slash command, and `/help` lists the
seven there are. Every sentence the bot says is built in `lib/bot.ts` so it cannot drift into two
voices.

Checking out before the rule's minimum is **refused when it is attempted**, not judged later at
settlement. The moment a member's cadence becomes arithmetically unreachable, the bot says so.

The invite QR encodes `/?invite=<token>`, which is the sign-in. `proxy.ts` catches that parameter
on any path, moves it into a cookie and strips the URL, because a server component cannot set a
cookie and the token has to survive sign-in and onboarding.

### `/settle`, and `/settle force`

There is no scheduler. A period is closed when a member closes it.

`/settle` closes the most recent finished, unsettled period. `/settle force` closes one that is
still running, which is the only thing force is for: a week cannot be waited out in front of a
room. Forcing marks everyone unfinished as having missed, and the settlement row is the mutex, so
it does not come back.

Nothing but the exact word turns it on. A typo, a near miss or an extra word all come back as not
understood rather than falling through to an ordinary settle: being wrong in that direction costs
one retyped command, and being wrong in the other costs a pact. Server-side it is
`force: z.boolean()` compared `=== true`, so no environment variable or route default can set it.

## Themes, and the preview

Light and dark, from the header toggle. The choice lives in `localStorage`; with nothing kept the
system preference decides, settled before first paint so the page never flashes the wrong ground.
**The landing is deliberately the inverse of the app** — that flip of value is what makes signing in
read as arrival. Every colour is a role defined twice in `app/globals.css` and nowhere else.

`/preview` renders the running app inside a phone frame, live and navigable, so proportions can be
judged and the demo recorded without a screen recorder's chrome. It is a development surface:
nothing links to it, and deleting `app/preview/` removes all of it.

## What is not done

The first two are the ones that matter for judging.

- **No transaction has been executed on mainnet.** The sponsor wallet is unfunded, so there are no
  transaction links here and nobody has watched a stake land in a vault. Everything below the
  browser has been exercised against live mainnet state by simulation only, under `STAKE_DRY_RUN=1`.
- **The demo script has not been walked end to end.** It is derived from reading the code, not from
  a rehearsal. The most useful thing anyone can do before Demo Day is walk it once, on mainnet,
  with two phones.
- **Authentication is partial.** Routes that move money verify the caller's Privy token. The
  check-in, feed, reaction and exemption routes still take the wallet from the request body and
  believe it, so the inputs to a settlement verdict are forgeable. That is the one finding an
  on-chain escrow would not fix.
- **Custody.** Stakes sit in a per-pact vault whose key is held server-side, encrypted. We can take
  the money. The custody document says so in its first sentence, then says exactly how.
- **An honest stake can be stranded.** If attribution never resolves, the transaction has confirmed,
  the USDC is in the vault and the membership is unwritten. The signature goes back to the client,
  but there is no reconciliation table and no admin route, so being shown is not being fixed.
- **A period a crew skips can never be settled from the channel**, and those stakes stay in the
  vault. Documented rather than unpicked two days before submission.
- **There is no leave and no refund.** `MemberStatus.left` is read in six places and written in none.
- **Solana only**, and members bring their own crypto. There is no fiat on-ramp.
- **Photo upload, RPC and the rule drafter are unconfigured on the deployment.**
  `BLOB_READ_WRITE_TOKEN` unset means `/api/uploads` answers 503 and the UI says so;
  `SOLANA_RPC_URL` unset means the public endpoint, which rate-limits and drops confirmations under
  load; `ANTHROPIC_API_KEY` unset means the rule drafter falls back to manual fields.
- **Privy's cookies are `Secure`**, so a browser accepts them on `http://localhost` and not on
  `http://192.168.x.x`. The second-phone half of a demo has to run against HTTPS.

## Checks

```bash
npm test          # vitest
npm run typecheck # tsc --noEmit
npm run lint      # eslint
npm run build     # the one that catches what tsc does not
```

The build is in that list because type declarations can lie about runtime exports:
`@privy-io/react-auth` declares `PrivyErrorCode` and does not ship it, so typecheck passed and the
production build did not.

A fresh worktree needs `npx next typegen` before `npm run typecheck` passes, because
`tsconfig.json` includes `.next/types/**/*.ts` and `.next` is gitignored.
