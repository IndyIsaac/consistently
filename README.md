# Consistently

A crew agrees a rule and each member stakes real money on keeping it. Whoever breaks the rule
forfeits their stake to the people who kept it, automatically, without anyone having to ask.

Built for the DFlow × Superteam Thailand Buildathon, against the brief *"build what happens after
the swap."* The swap is not the product. It is what makes the product reachable by four people in a
gym group who hold no USDC and have no SOL to pay a fee with.

**Live at https://web-production-8764a.up.railway.app**, on Solana mainnet.

| | |
|---|---|
| What it is, and deliberately is not | [`PRODUCT.md`](PRODUCT.md) |
| What it looks like, and why | [`DESIGN.md`](DESIGN.md) |
| How it fits together, and what is not done | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) |
| Who can take the money, stated exactly | [`docs/security/escrow-protocol.md`](docs/security/escrow-protocol.md) |

## The platform

A pact is a rule, a stake, a cadence and a crew. Gym five days a week, thirty minutes minimum,
฿1,000 on the line. Every member stakes into the pact's vault before it starts, and it starts only
when everyone has. Members check in and out with photos in a bot channel that streams every action
and takes exactly two inputs: a photo, or a slash command.

At the end of a period the pact settles. Whoever kept the rule splits the stakes of whoever did
not, paid out in the token each winner chose when they joined. There is no ledger to keep, nobody
to chase, and no way for the money to go anywhere but to the people who earned it.

## Why this needs DFlow

Your bank will not let you fine your friend. Moving money between private individuals as a penalty
requires being a licensed money transmitter, and no card processor permits it, which is why every
other accountability app keeps the money itself, pays a charity, or gives up and keeps a ledger.
Crypto rails are the only ones that let a forfeited stake go straight to the people who earned it.

DFlow is what makes those rails survivable for people who are not in crypto. It is load-bearing at
both ends:

| Moment | What DFlow does | Why it matters |
|---|---|---|
| Joining | `GET /order` routes **any** Solana token into USDC | Nobody has to buy the right coin first. Members bring what they hold. |
| Joining | `destinationWallet` delivers the output into the pact vault | Convert and deposit in one transaction. A token is never sold without the stake arriving. |
| Joining | `sponsor` pays the network fee | A gym group of six has no SOL between them. Without this, onboarding is dead. |
| Joining | The route creates the vault's token account, sponsor-funded | A brand-new vault needs no setup and never needs SOL. |
| Settling | `GET /order` again, once **per winner**, into the token each chose | One settlement becomes N swaps rather than one. |
| Settling | `platformFeeBps` + `feeAccount` | The revenue model, using DFlow's own monetisation feature. |

`lib/dflow.ts` is the client, `lib/stake.ts` the way in, `lib/settlement.ts` the way out. Three
things to know if you read them:

- **There is no exact-out.** `swapMode=ExactOut` is accepted and silently ignored, so "exactly this
  much USDC" is approximated by pricing the reverse direction and over-sending by a headroom.
  Measured on SOL/USDC at 100bps that headroom has to be about 3%. The surplus is not kept:
  settlement sweeps the vault's real balance, so it returns to the crew.
- **An order's blockhash lives about a minute.** So the stake sheet shows a quote-only price, which
  carries no blockhash and can sit on screen, and builds the real order on the tap.
- **USDC never touches DFlow.** DFlow cannot route a mint to itself, so a USDC stake in, or a USDC
  payout out, is a plain SPL transfer. If a USDC stake prices and a SOL stake says *"Could not price
  that route"*, the quote API is down, not the route.

## Running it

```bash
npm install && npm run dev
```

**No environment variables are required to see the app.** With none set it renders a built-in
demo, from the landing page to inside a crew. `.env.example` names every key and says what each is
for. To move real money you need a database, a Privy app, a funded sponsor wallet, a vault
encryption key and a paid Solana RPC. Then:

```bash
npm run preflight   # every dependency, checked with a live call, spending nothing
npm test            # vitest
npm run typecheck   # tsc, after `npx next typegen` in a fresh checkout
npm run build
```

## License

MIT. See [`LICENSE`](LICENSE).
