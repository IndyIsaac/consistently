# Pact — Design Spec

**Date:** 2026-08-24
**Competition:** DFlow × Superteam Thailand Buildathon
**Submission deadline:** 2026-08-31, 23:59 ICT
**Builder:** solo
**Working name:** Pact (provisional)

---

## 1. What it is

A group commitment app. A group of people agree a rule, each stakes real money, and
whoever breaks the rule loses their stake to the people who kept it. Settlement is
automatic — nobody ever has to chase a friend for money.

One sentence: *your bank will not let you fine your friend. This does.*

## 2. Why it exists

This is a real behaviour the builder already runs twice, manually:

- **Five-day fitness.** A Telegram group of friends and colleagues. Check in and check
  out with photos, five days a week, minimum 30 minutes. Miss it and you owe 1,000 baht,
  split between everyone who turned up.
- **CFA study.** Two people sitting the same exam in November. Two hours a day, six days
  a week, photo proof, 1,000 baht penalty.

Both work. Both fail at the same point: **collection.**

Nobody wants to deposit up front, because at the start of the week everyone is certain
they won't fail. So the money is collected afterwards — which means chasing a friend for
a debt. That is socially corrosive and it is the reason these arrangements decay. The
point of the penalty is that it is a consequence, not a debt between two people.

The product is not the rule. **The product is automatic collection.**

## 3. Why this needs crypto, and specifically DFlow

The obvious build is a credit card and a database. It does not work.

To charge one friend's card and pay the money into another friend's bank account, you
must be a licensed money transmitter. No payment processor will let you do this. Moving
money between private individuals as a penalty is precisely what the payments system is
built to prevent.

Crypto rails are not the awkward choice here. They are the only ones that work.

### DFlow integration points

| Moment | DFlow feature | Why it is load-bearing |
|---|---|---|
| Joining a pact | `/order` — stake in **any** Solana token, routed to USDC | Removes "go and buy the right coin first", the step that kills signups. Members hold whatever they hold. |
| Joining a pact | `destinationWallet` — output lands directly in the pact vault | Convert *and* deposit in one indivisible transaction. No state where a member's token was sold but the stake never arrived. |
| Joining a pact | `sponsor` — gasless | Members do not need SOL. A gym group of six will have none. Without this, onboarding is dead. |
| Settlement | `/order` — each winner paid out in **their** chosen token | One settlement becomes N swaps, not one. Genuinely multiplies flow. |
| Settlement | `platformFeeBps` + `feeAccount` | Real revenue model. DFlow's own monetisation feature. |

DFlow is the settlement engine, not decoration. The stake conversion cannot be done
without a router, because at the moment of joining nobody knows what a member's token
will be worth at settlement.

## 4. Core loop

1. **Create.** One person describes the pact in plain English. An LLM turns it into a
   rule config, which they can then edit.
2. **Invite.** Share a link. Members open it, sign in, connect or create a wallet.
3. **Stake.** Each member deposits the stake in whatever token they hold. DFlow converts
   it to USDC. Gas is sponsored.
4. **Start.** The pact does not begin until every member has staked. The bot announces
   who has and who has not.
5. **Check in.** Members take a photo in-app to open a session and another to close it.
6. **Judge.** At the end of each period, members who did not meet the rule are marked
   failed. A failed member may request an exemption; a simple majority of the crew can
   grant it.
7. **Settle.** The stakes of failed members are split equally between members who passed.
   Each recipient chooses the token they want to be paid in.
8. **Continue.** Members who wish to carry on must re-stake for the next period.

## 5. Rule schema

Every example the builder raised fits one shape.

| Parameter | Type | Example |
|---|---|---|
| `cadence` | count per period | 5 times per week |
| `period` | week / day | week |
| `sessionType` | `checkin` \| `checkin_checkout` | checkin_checkout |
| `minDurationMins` | integer \| null | 30 |
| `windowStart` / `windowEnd` | local time | 05:00 / 23:00 |
| `proof` | `photo` \| `self_attest` | photo |
| `stakeAmount` | decimal | 1000 |
| `stakeCurrency` | ISO code | THB |
| `failsWhen` | missed count threshold | more than 0 missed |
| `split` | `equal` | equal |
| `exemption` | `majority` \| `none` | majority |
| `duration` | periods | 4 weeks |

Coverage check:

| Use case | Config |
|---|---|
| Five-day fitness | 5/week, checkin_checkout, 30 min, photo |
| CFA study | 6/week, checkin_checkout, 120 min, photo |
| Wake up early | 1/day, checkin, window 05:00–07:00, photo |
| Run club (30 people) | 1/week, checkin, photo |
| Not vaping | 1/day, self_attest |

### Edge cases

- **Sessions crossing midnight.** A session belongs to the day it *started*. Check in at
  23:50, check out at 00:30 — counts for the starting day. Prevents boundary gaming.
- **Unclosed sessions.** A session with no check-out by the end of the window does not
  count.
- **Late joiners.** Cannot join a pact once it has started. They join the next period.
- **Leaving.** A member may leave, effective at the end of the current period. Leaving
  mid-period forfeits the stake. Free instant exit would make the commitment meaningless.

## 6. Stake currency and FX

Members choose the currency the pact is denominated in — THB, GBP, USD, whatever.

- Stake is displayed in that currency throughout.
- The FX rate is fetched once and **locked at pact creation**, so the target does not
  drift mid-period.
- The pot is held in USDC so member balances are not exposed to token volatility.
- FX source: a free public rates API. Rate and timestamp stored on the pact record.

## 7. Custody and escrow

Members deposit up front. The builder has confirmed deposit-up-front is acceptable UX.

**v1 (hackathon):** each pact gets a vault wallet. The private key is held server-side,
encrypted. This is custody, it is a known trade-off, and it will be **disclosed plainly
in the README** rather than glossed over.

**v2 (production):** an on-chain escrow program so no human holds the pot. Out of scope
for this window — writing, testing and auditing a Solana program is days we do not have,
and no judge will see the difference.

## 8. Proof and verification

**Deliberately trust-based. No automated verification.**

Photos are timestamped and visible to the whole crew. Nobody checks them but the crew.

This is a product decision, not a shortcut. Anyone who fakes a gym photo to dodge 1,000
baht has already lost, and the group can see the evidence. The app does not need to be
uncheatable — it needs cheating to be harder and more socially visible than complying.
Building real verification would consume the entire build window and solve a problem that
does not exist among friends.

## 9. The feed

Not a chat. A feed.

- Check-in and check-out photos, newest first, with timestamps.
- Bot posts: who has staked and who has not, streaks, settlement results, exemption
  requests and outcomes, weekly summaries.
- Members can react to posts with emoji. No free-text messaging.

Rationale: chat means real-time sockets, message history and presence — two days minimum
— and it buries the check-ins under conversation. A feed gives the same social pressure
for a fraction of the work and displays the proof better. Groups will keep chatting in
Telegram regardless.

## 10. Stats

Cheap to compute, and the reason people return:

- Current streak and longest streak per member
- Days completed this period vs required
- Total paid out and total received, per member, all-time
- Crew leaderboard for the period

## 11. Scope

### Ships

- Create a pact from plain English (LLM → rule config, editable)
- Rule config editor
- Join by link, sign in, wallet provisioning
- Stake in any Solana token → USDC, gasless
- In-app camera capture for check-in / check-out
- Feed with bot posts and emoji reactions
- Streaks, stats, crew leaderboard
- Exemption request and crew vote
- Automatic settlement with payout token choice
- Re-stake to continue
- Responsive: works on phone and desktop

### Does not ship

| Cut | Reason |
|---|---|
| Real-time chat | Feed covers it |
| Telegram / SMS integration | The existing Telegram group appears in the *video* as proof the behaviour is real, not in the product |
| Push notifications | Never appears in a demo |
| Automated proof verification | Trust-based by design |
| On-chain escrow program | v2 |
| Multiple concurrent pacts per user | One pact per user in v1 |
| Fiat on-ramp | Members bring their own tokens. Card top-up is a documented follow-up |

## 12. Stack

| Layer | Choice | Note |
|---|---|---|
| Framework | Next.js + TypeScript | Deployed to Vercel |
| Wallet | Privy | Embedded wallets via email — members do not need to know what a wallet is |
| Chain | Solana mainnet | DFlow dev endpoint quotes mainnet; there is no devnet path |
| Trading | DFlow `/order` | Dev endpoint, no API key, CORS confirmed open, 60 req/min |
| Database | Postgres | Pacts, members, sessions, feed, settlements |
| Photo storage | Object storage | Timestamped, crew-scoped |
| LLM | Anthropic API | Rule config generation from natural language |
| FX | Public rates API | Locked at pact creation |

### Verified facts (tested 2026-08-24)

- `GET /order` on `dev-quote-api.dflow.net` returns mainnet quotes and a signable
  base64 `VersionedTransaction`. No API key.
- CORS is **open** (`access-control-allow-origin: *`), contradicting DFlow's own FAQ.
  No proxy needed.
- Rate limit on dev: 60 requests per minute (`x-ratelimit-limit` header).
- Quote WebSocket stream works on dev with no key, per-slot updates.
- Token coverage: 4,605,594 mints. Solana only — no other chains, no CEX liquidity.
- Production API key: [form](https://forms.gle/eX3cghbMF8VBB9qa9), 2–5 day turnaround.

## 13. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Wallet integration eats days | High | Privy embedded wallets, spike it first, before anything else |
| Sponsored swaps need both signatures | Medium | Sponsor wallet co-signs server-side; test early |
| Dev endpoint rate limit during demo | Medium | Cache quotes; apply for production key regardless |
| Scope creep on the rule engine | High | Fixed schema in section 5. New parameters do not get added |
| Mainnet demo needs real funds | Medium | Budget ~$30 of USDC/SOL. Keep stakes small enough to repeat live |
| Custody disclosure | Low | Stated plainly in README |

## 14. Demo plan

Four minutes, live, on stage.

1. **The hook (30s).** The real Telegram group on screen. Four months of photos, a
   handwritten ledger, and someone who still owes 3,000 baht. "This works. The only part
   that doesn't is getting paid."
2. **Create (30s).** Type the pact in plain English. Watch it become a rule.
3. **Join and stake (60s).** A second phone joins by link, stakes in a token that isn't
   USDC, pays no gas. Show the DFlow conversion.
4. **Check in (30s).** Take a photo. It lands in the feed.
5. **Fail and settle (60s).** Pre-seeded pact reaches its deadline. Someone missed.
   Settlement fires. Money moves. Nobody had a conversation about it.
6. **Close (30s).** The exemption vote, and what it costs to run.

Fallback recording of a successful settlement, in case the venue network fails.

## 15. Open questions

- Product name. "Pact" is provisional. "Crew" for the group.
- Platform fee: what rate, and do we charge it at all in v1?
- Does the LLM rule builder survive if it demos badly? It is the most impressive 20
  seconds and also the most fragile.
