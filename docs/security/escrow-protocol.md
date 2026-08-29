# Custody and escrow

**The short answer.** Today we can take the money. One server-held key encrypts every pact
vault's private key, and anyone holding both the database and that key can move any vault.
Nothing in this build prevents it. What follows is exactly what we hold, exactly what the
on-chain replacement would do instead, and exactly why the replacement is not in this
submission.

This document exists because custody is not something a demo can show. A four-minute demo
shows money moving. It cannot show who *could* have moved it.

Everything below is checkable against the files it cites. §3 row 6 is a hole we found while
writing this, in our own code, that lets a member of a crew stake less than they agreed. It is
here for the same reason the rest is.

---

## 1. What v1 does today

Every pact gets its own Solana keypair, generated at creation.

```
lib/vault.ts:29     createVault()  -> Keypair.generate()
prisma/schema.prisma:45   Pact.vaultAddress    the public key, plainly public
prisma/schema.prisma:46   Pact.vaultSecretEnc  the secret key, encrypted
```

The secret is encrypted with AES-256-GCM under `VAULT_ENCRYPTION_KEY` — a 32-byte value read
from the process environment (`lib/vault.ts:4-10`) — and stored as `iv.tag.ciphertext`, three
base64 fields joined by dots (`lib/vault.ts:12-18`). The ciphertext has never been sent to a
client and is not sent to one now; the route that used to return pact rows wholesale was
narrowed for this reason (`app/api/pacts/route.ts:83`).

Money leaves a vault in exactly one place. `settlePact` decrypts the pact's secret into process
memory (`lib/settlement.ts:296`) and signs the payout with it, alongside the sponsor as fee payer
(`lib/settlement.ts:336`).

### The exposure, stated exactly

**Anyone holding both the database and the encryption key can move any vault.**

Not "could theoretically". The two artefacts are sufficient: `Keypair.fromSecretKey` on the
decrypted bytes yields full signing authority over the vault, and the vault's USDC has no other
guardian. That set of people is us, plus anyone who compromises the host, plus our hosting
provider's operators.

Four further properties of the v1 design, none of them flattering:

- **One key, all vaults.** `VAULT_ENCRYPTION_KEY` is not derived per pact. Compromising it is not
  compromising one crew's money. It is compromising all of it.
- **No rotation path exists in this build.** There is no script that re-encrypts under a new key.
- **Losing the key freezes everything, permanently.** No copy is escrowed anywhere. The USDC stays
  visible on chain forever and reachable by nobody.
- **The sponsor/vault key separation is real in the code and worth nothing in practice.** The
  payout is signed by two distinct keys, the vault's and the sponsor's, and both are held by the
  same process. Two locks on one door.

### What v1 does not have at all

There is no refund. `settlePact` is the only function that moves USDC out of a vault, it runs only
on a finished period, and it runs only when a member calls `POST /api/pacts/[id]/settle`. A crew
that abandons a pact leaves its money reachable by us and by nobody else.

`MemberStatus.left` compounds this: it is read in six places — `lib/queries.ts:89` and `:235`,
`lib/settlement.ts:247`, `lib/stake.ts:465` and `:503`, `settle/route.ts:40` — and written in
none. There is no leave, and therefore no leave-and-get-your-stake-back.

---

## 2. The v2 protocol

A Solana program. One PDA per pact, holding the pot in a token account whose authority is the PDA
itself. No keypair exists for it — that is the entire point. There is nothing for us to hold, and
nothing for anyone to steal from us.

**Accounts**

| Account | Seeds | Holds |
|---|---|---|
| `Pact` | `["pact", pact_id]` | roster of member wallets, per-member funded flag, `stake_amount`, `rule_hash`, `settle_authority`, `fee_bps`, `fee_account`, `funding_deadline`, `refund_after`, per-period settled bitmap |
| Vault | ATA of the `Pact` PDA for the USDC mint | the pot |

`rule_hash` is a hash of the exact rule the crew agreed, written once and never changed. It is
worth being clear about what it buys: the program cannot evaluate a rule — it has no idea whether
anyone went to the gym. The hash is a commitment, checkable by any member off chain, that the rule
being settled against is the rule they joined under. It proves the terms. It proves nothing about
the verdict.

### `initialize`

**Signs:** the creator, from their own wallet. They pay the rent.

**Checked on chain:** the PDA is uninitialised; `stake_amount > 0`; the roster is non-empty and
free of duplicates; the mint is USDC; `funding_deadline` and `refund_after` are in the future and
`refund_after` is at least the pact's full duration away.

**Cannot:** change the roster, the stake, the rule hash, the fee, or either deadline afterwards.
There is no `set_authority` and no administrative escape hatch. Every parameter that decides where
money can go is fixed before any money arrives.

### `deposit`

**Signs:** the member, from their own wallet. The sponsor is fee payer and nothing else.

**Checked on chain:** the caller is on the roster; the caller is not already funded; the pact is
still in `Funding`; and the instruction moves exactly `stake_amount` from *the caller's own* USDC
account into the vault, by CPI, in this instruction.

**Cannot:** be called by us on a member's behalf — the signature is the member's. Cannot credit a
member for money the member did not send. Cannot credit a partial amount. Cannot move anything
out.

That last constraint costs the demo its best moment and there is no way around it. Today the DFlow
route delivers straight into the vault via `destinationWallet` (`lib/stake.ts:196`), so staking is
one signature from a member who holds neither USDC nor SOL. Under v2 the route has to deliver into
the member's own wallet first, and `deposit` then moves the stake into the vault — **two
transactions, both sponsored, and the money moves in the second one.**

The obvious way to keep it at one transaction does not survive being looked at. Let the route
deliver into the vault as it does now, have `deposit` compare the vault balance against an
`accounted_balance` field on the PDA, and credit the caller if the delta covers the stake. The
delta is not attributable: the chain does not know whose swap landed. Two members funding at once
means whoever calls `deposit` first is credited for the other's money. Deciding the attribution
off-chain puts the server back in the middle of it, which is the thing v2 exists to stop. So it is
two transactions, and the demo script has to say so.

### `settle`

**Signs:** `settle_authority` — us, the server.

**Checked on chain:** the pact is `Active`; the period's end has passed; the period's bit is not
already set; every destination is a wallet recorded in the roster at `initialize`, read from the
PDA and never from the instruction data; each winner receives at least their recorded principal;
the transfers sum to exactly the vault balance, less `fee_bps` to `fee_account`, both of which
were fixed at `initialize`; the period counter cannot exceed the pact's duration.

If the winner set is empty, `settle` transfers nothing, sets the period bit, and the balance
carries forward. That is v1's behaviour too, and it is the one case where the vault legitimately
retains funds.

**Cannot:** pay an address that is not on the roster — including ours. Cannot pay out more or less
than the vault holds. Cannot settle a period twice. Cannot settle a period that has not ended.
Cannot introduce a fee that was not agreed at creation.

**What it can still do, and this is the limit of the design:** declare that everyone except one
member broke the rule, and move the entire pot to that member. The program constrains *where* the
money can go. It does not know who deserved it. See §3, row 7.

### `refund`

**Signs:** any member, from their own wallet.

**Checked on chain:** either `now > refund_after`, or the pact is still `Funding` and
`now > funding_deadline`. Then the caller withdraws exactly their own recorded principal — plus
their pro-rata share of any balance the pact carried past its final period — to their own recorded
wallet.

**Cannot:** be called by `settle_authority`. Cannot be called early. Cannot return more than the
caller deposited. Cannot be blocked, delayed, or vetoed by us.

`refund` is the instruction that makes a dead server survivable, and that is the whole of its
claim. It is a liveness guarantee, not a correctness one. A server that lies about the verdict
lies before `refund_after`, and by the time the deadline passes the vault is empty and there is
nothing to refund. `refund` protects a crew against a server that stops. It does not protect them
against one that works.

It is still the thing v1 does not have in any form.

### What the sponsor cannot sign

The sponsor pays fees. That is its whole job in v2. It is not the vault authority, it is not
`settle_authority`, and it is not on any roster — so no combination of instructions lets a sponsor
signature move a member's money to the sponsor. **In v2 the sponsor's key is worth exactly the SOL
in it.**

In v1 the sponsor is likewise only the fee payer (`lib/stake.ts:407`, `lib/settlement.ts:336`),
which sounds like the same claim and is not, because the vault key sits in the same process.

---

## 3. Threat model

| # | Threat | v1 | v2 | Who must be trusted |
|---|---|---|---|---|
| 1 | We decide to take the pot | Nothing stops us. The vault key is ours. | The PDA has no key. `settle` can only pay roster members, only the exact balance, only once per period. | v1: us, entirely. v2: us for the verdict, nobody for the destinations. |
| 2 | Database is dumped — leaked backup, stolen read replica | Ciphertext only. No funds move. Vault addresses and balances were already public on chain. | Nothing custodial to leak. | Whoever holds `VAULT_ENCRYPTION_KEY`. |
| 3 | Host is compromised: key **and** database | Total. Every vault of every pact, drainable in one pass. | The attacker holds `settle_authority`. They can redirect a pot *between roster members*. They cannot send it to themselves unless they are already on a roster, and cannot touch a pact that has not reached its period end. The bound is only as good as the roster is long — in a two-person crew, "redirect between roster members" is one member taking all of it. | v1: our host. v2: our host, bounded loosely. |
| 4 | `VAULT_ENCRYPTION_KEY` is lost | Every vault frozen permanently. No second copy exists. | Irrelevant. `refund` is signed by members. | Our backup discipline. |
| 5 | Somebody posts transaction bytes for us to fee-pay | `assertIsOurStakeTx` (`lib/stake.ts:112`) requires two signers, the sponsor as fee payer at index 0, this pact's vault among the accounts, and only ComputeBudget + DFlow (or ComputeBudget + Token + ATA on the USDC path). | The swap now lands in the member's own wallet, so a substituted route is a donation to *them* rather than to the crew. The sponsor's exposure is the same either way: one fee per attempt. | Nobody's funds. Only the sponsor's SOL. |
| 6 | A member stakes *less* than the pact's stake | The same guard checks the transaction's shape and never its amount. A member can be recorded `staked` having sent one atomic unit. See below. | `deposit` moves exactly `stake_amount` or fails. | v1: every member, to be honest about their own stake. v2: nobody. |
| 7 | Somebody forges the *verdict* | Sessions and exemptions are posted with `body.userWallet` and believed (`sessions/route.ts:122`, `exemptions/route.ts:166`, `:176`). Whoever can post as another member can change who wins. | **Unchanged.** The program checks the transfer, not the truth of it. | The check-in route. In both designs. |
| 8 | A member disputes the result | The record is a JSON blob in our database. No independent evidence. | The verdict is a transaction: period, amounts, destinations, checkable against the on-chain roster and `rule_hash`. Proves what was claimed, not that it was true. | v1: our word. v2: still our word, but a permanent one. |
| 9 | Crew abandons the pact; nobody settles | Money sits in the vault. Only we can move it. There is no refund and no leave. | `refund` after `refund_after`. | v1: us. v2: nobody. |
| 10 | Payout is redirected to a wrong address | Settlement reads the destination from `Membership.user.walletAddress` (`lib/settlement.ts:325`). Whoever controls the database controls the destination. | The roster wallet is on chain, fixed at `initialize`, compared by the program. | v1: our database. v2: nobody. |
| 11 | We quietly take a cut | `PLATFORM_FEE_BPS` and `PLATFORM_FEE_ACCOUNT` are read from the environment **at payout time** (`lib/settlement.ts:329-330`) and applied to the swap leg. Default is `0`. A crew that staked under a 0% fee can be settled under a different one, and would see nothing. | `fee_bps` and `fee_account` are fixed at `initialize` and enforced by `settle`. | v1: us, again. v2: nobody. |
| 12 | Member keys | Members sign with Privy embedded wallets. Whoever controls the Privy app can act as any member. | **Unchanged**, and it bounds the whole design: a PDA no human controls, funded and refunded by wallets a third party controls, is a smaller improvement than "non-custodial" suggests. | Privy. In both designs. |
| 13 | `settlePact(..., { force: true })` bypasses the period-end check | Not reachable from the route — the handler never passes it. Server-side execution could settle a running period, which marks the crew failed, pays nobody, and burns the period's mutex. A stuck period, not a diverted payout. | `settle` rejects an unfinished period on chain. | Our code review. |
| 14 | `STAKE_DRY_RUN=1` in production | The whole path runs, both signatures verify against live state, only the broadcast is skipped. The membership is written `staked` with a signature of `dry-run:<timestamp>`. The app records money that did not move. Guarded by a deploy checklist and nothing else. | Same flag, same risk — a client-side rehearsal mode is orthogonal to custody. | Our deploy discipline. |

### Row 5, in full, because it is the one guard that already exists

`assertIsOurStakeTx` is structural, not a byte comparison — keeping the built message across a
serverless invocation would need a table this build does not have. What it deliberately does not
stop is written in its own doc comment:

> What it cannot stop: somebody getting the sponsor to pay for a *different* DFlow swap that still
> delivers into this vault. That is a donation to the crew, not a theft, and it costs us one
> transaction fee.

That is the correct characterisation and we are not going to inflate it. The bound: repeating it
costs one fee each time and drains the sponsor's SOL, which stops new stakes from being sponsored.
It is a denial of service against onboarding, priced in lamports. It is not a route to anybody's
stake.

### Row 6, in full, because we found it writing this document

The same guard is structural in a second way that its comment does not mention. It checks the
signer count, the fee payer, the presence of the vault, and the programs called. **It never checks
how much USDC the transaction delivers.**

`finaliseStake` (`lib/stake.ts:387`) takes the signed bytes from the client, runs the guard, adds
the sponsor's signature, submits, and writes the membership `staked`. No amount is compared against
`pact.stakeUsdc` at any point, and no balance is checked before the pact flips to `active`. On the
USDC path a member can hand-build a transaction with the same shape as ours — sponsor as fee payer,
the idempotent ATA creation, a `transferChecked` into the vault — for one atomic unit, and be
recorded as fully staked. The route's authentication is sound: the caller is read from their
verified token and never from the body. It is the amount that is taken on trust, not the identity —
along with `kind`, which the client also supplies, and which selects the allowlist the guard
applies.

The consequence is not symmetrical with the donation above. `settlePact` pays each winner
`pact.stakeUsdc` back plus a share (`lib/settlement.ts` note 2), while the pot is the vault's
*actual* balance. An under-staker who keeps the rule is therefore paid a full stake out of money
the rest of the crew put in. If the vault cannot cover every winner's principal, the payouts run
in sequence until it is empty and the remaining transfers fail on chain — so the shortfall lands
on whoever the loop reaches last, which is nobody's decision.

This is a member-against-crew hole rather than an operator-against-crew one, and it is the only
one in this document that a single added comparison would close: assert that the transaction
delivers at least `pact.stakeUsdc` into the vault, or read the vault balance after confirmation
and refuse to write `staked` if it did not rise by the stake. It is written down here first
because that is the order these things should happen in.

### Row 7, in full, because it is the one that survives v2

An on-chain escrow moves the question from *who holds the key* to *who decides who won*. It does
not answer the second question, and this build answers it badly: the check-in and exemption routes
take a wallet address out of the request body and believe it. `PRODUCT.md` already lists this
under known constraints. It means the inputs to the settlement verdict are forgeable by anyone who
can reach the API, and `settle` — v1's or v2's — faithfully executes whatever verdict those inputs
produce.

A program with a member quorum on the verdict, or a challenge window before the transfer executes,
would close it. Both cost the property the product is actually selling: *the money moves and
nobody ever mentions it.* An escrow that asks four people to co-sign the fact that Dave skipped
the gym has reintroduced the argument the product exists to delete. That trade has not been made
yet, and pretending otherwise would be the dishonest part.

---

## 4. Why v1 is the honest answer for this window

The organisers' brief:

> **Creative ideas matter more than perfect code. The goal is to build something people need and
> ship a working demo.**

Submission closes 2026-08-31. Demo Day is 2026-09-03.

Writing an Anchor program for this is perhaps two days. That is not the expensive part. The
expensive parts are a test suite that covers the settlement arithmetic against a real validator, a
deployment with a decided upgrade authority, and a review by someone who did not write it. A
program deployed on the 30th and holding a judge's money on the 3rd is not a stronger custody
story than this document. It is the same story with a longer changelog and less disclosure.

The upgrade authority is the part that makes this concrete. A program whose upgrade authority is a
key we hold is v1 wearing a different hat: we cannot sign a transfer, but we can replace the code
that decides what a transfer is. Making it immutable, or handing it to a multisig, is a decision
with consequences that outlast the buildathon, and it is not one to make on the 30th because the
deadline is on the 31st.

So the actual choice available in this window was between **a custodial vault, disclosed exactly**
and **an unreviewed program, trusted implicitly**. We took the first. It is the one that can be
argued for out loud.

### What would have to be true to ship v2

- The program written, and its settlement arithmetic tested against a local validator — including
  the empty-winner case, the carried balance, resumed settlement, and every rejection path in §2.
- The upgrade authority decided: immutable, or a multisig nobody on the team controls alone.
- An external review. Not a formal audit necessarily, but someone outside the team who has read a
  Solana program before.
- The stake becoming two transactions instead of one, and the demo rewritten to say so.
- Payouts in a member's chosen token moving *out* of the escrow: `settle` pays USDC to a recorded
  wallet, and the conversion becomes a second swap the member signs from their own wallet. The
  feature survives; it stops being atomic with the payout.
- `funding_deadline` and `refund_after` chosen per rule type — a product decision nobody has made.

### Where the line actually is

None of the above makes v1 acceptable indefinitely. It is defensible at the scale it is being
demonstrated at: one-to-two-dollar stakes, among people who have been told in plain words that
this is custodial. It is not defensible at ฿1,000 a week across crews who will never open this
file. The threshold is not a number we have picked yet, and picking it is v2's real deadline —
not the buildathon's.

---

**Files this document describes:** `lib/vault.ts`, `lib/stake.ts`, `lib/settlement.ts`,
`app/api/pacts/route.ts`, `app/api/pacts/[id]/settle/route.ts`,
`app/api/pacts/[id]/sessions/route.ts`, `app/api/pacts/[id]/exemptions/route.ts`,
`prisma/schema.prisma`. Every claim above is checkable against them.
