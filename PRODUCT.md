# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Small groups of friends or colleagues who already hold each other to a rule and are already
enforcing it badly. Two confirmed real instances, both run by the product's builder:

- **A five-day fitness group.** Friends and office colleagues. Gym five days a week, minimum
  thirty minutes, check in and check out with photos. Miss it and you owe ฿1,000, split between
  everyone who turned up.
- **A CFA study pair.** Two colleagues sitting the same exam in November. Two hours a day, six
  days a week, photo proof, ฿1,000 penalty.

Both currently run in a Telegram group with a hand-kept ledger, settled in cash. Group size is
not fixed: the same behaviour scales from a pair to a thirty-person run club.

## Product Purpose

A group agrees a rule and each member stakes real money on keeping it. Whoever breaks the rule
forfeits their stake to the people who kept it, automatically, without anyone having to ask.

The product is not motivation — these groups already have that. **The product is collection.**

Both real instances fail at the same point. Nobody wants to deposit up front, because at the
start of the week everyone is certain they won't fail. So the money is collected afterwards,
which means chasing a friend for a debt. That is socially corrosive, it decays over weeks, and
it turns a consequence into an argument. The builder's own words: *"I'm not trying to make money
off you, you're my friend for fuck's sake."*

Success is that the money moves and nobody ever mentions it.

## Positioning

Your bank will not let you fine your friend.

Moving money between private individuals as a penalty requires being a licensed money
transmitter; no card processor permits it. That is why every existing accountability app either
takes the money itself, pays out to a charity, or gives up and keeps a ledger. Crypto rails are
not the awkward choice here — they are the only ones that let a forfeited stake go directly to
the people who earned it.

## Operating Context

- Members check in and check out by taking a photo, usually at a gym, a desk, or a front door.
- Proof is looked at by the group, not by software. Someone who fakes a photo to dodge ฿1,000 is
  only cheating themselves, and the group can see the evidence.
- Real life interferes. Food poisoning, a funeral, a delayed flight. The group votes on whether
  to let someone off — this is the mechanism that stops the rule being a tyrant.
- The stake is denominated in the group's own currency (฿, £, $). The exchange rate is fixed when
  the pact is created so the target cannot drift mid-week.
- Members hold whatever crypto they hold. They are not expected to acquire a particular token
  first, and they do not need SOL to pay network fees.

## Product Shape

Confirmed by the builder. Deliberately simple; nothing here is to be elaborated without asking.

- **Sign in, then two tabs.**
- **Dashboard.** Everything across every group at once: the groups you're in, your streaks, money
  earned and money lost. This is the screen that answers "how am I doing" without opening anything.
- **Groups.** The list of groups you belong to; opening one enters it.
- **Inside a group — a bot channel, not a chat.** The bot streams every action as it happens. The
  only two things a member can do are: run a slash command, and submit a photo to check in or check
  out. `/help` lists the commands. There is no free-text messaging, which is consistent with the
  existing feed-not-chat decision.
- **The bot enforces in real time.** Attempting to check out before the group's minimum duration is
  refused at the moment it is attempted — *"you've got another 15 minutes"* — rather than silently
  recorded and judged later at settlement. Finding out immediately is the point.
- **Settings.** Profile name, profile photo, linked socials.

## Capabilities and Constraints

**Confirmed capabilities:** create a group commitment with a configurable rule; invite by link;
stake in any Solana token, converted and delivered in one transaction; photo check-in and
check-out; a feed of check-ins, milestones and results; streaks and a group leaderboard;
request an exemption and vote on it by simple majority; automatic settlement redistributing
forfeited stakes; re-stake to continue into the next period.

**Terminology:** the unit of commitment is a **pact**; the group is a **crew**; a completed
check-in period is a **session**; forfeited money is a **stake**, never a fine or a bet.

**Deliberate exclusions.** These are decisions, not gaps, and future work must not quietly
reverse them:

- **No automated proof verification.** Trust-based by design. Building image checking would
  consume the entire product and solve a problem that does not exist among friends.
- **No free-text chat.** The feed carries photos, system messages and emoji reactions. Chat
  would bury the proof under conversation.
- **Not gambling.** Money moves between members according to a rule they agreed in advance.
  Nobody wins from chance and the house takes nothing.

**Known constraints:**

- Solana only. Tokens on other chains and balances on centralised exchanges are unreachable.
- **No authentication in v1.** Requests name a wallet and are believed. This is a known, recorded
  limitation that must be disclosed rather than glossed.
- Stakes are custodied per-pact in a server-held encrypted vault for v1; a non-custodial escrow
  program is the production answer and is not built.
- Members bring their own crypto. There is no fiat on-ramp, and building one is out of scope.

## Brand Commitments

**Name: Consistently.** Chosen by the builder. It is the answer to "how did you do?" — and the
thing the product is actually selling is not a streak or a stake but the adverb.

**Voice: dry, deadpan, faintly savage.** The product states facts and lets them do the damage.
*"Dave owes ฿3,000 and has for five weeks."* No cheerleading, no confetti, no exclamation marks,
no motivational language. It is funny because it is true, and it is never cruel about the person
— only precise about the record.

Copy names people and numbers plainly. It does not congratulate, and it does not scold.

## Evidence on Hand

- Four months of a real five-day fitness group running in Telegram, with photo check-ins and a
  hand-kept ledger. This is genuine evidence the behaviour exists and that collection is where
  it breaks. It is the builder's own group.
- A second real instance: the CFA study pair, same structure.
- **No users beyond the builder's own groups. No testimonials, no metrics, no press, no
  customers.** Future work must not invent any.

## Product Principles

1. **Collection is the product.** Anything that makes money move without a conversation is core.
   Anything that adds a conversation is a defect.
2. **The group is the referee, not the software.** Proof is social, exemptions are voted, and the
   app never adjudicates what it cannot see.
3. **Never make anyone the debt collector.** The moment a member has to ask another member for
   money, the product has failed regardless of what the screen says.
4. **State the record, don't editorialise.** Numbers and names, plainly. The truth is sharp
   enough without help.
5. **Bring what you have.** No required token, no required balance for fees, no setup errand
   before the thing works.
