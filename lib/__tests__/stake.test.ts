import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  assertIsOurStakeTx,
  LIGHTHOUSE_PROGRAM_ID,
  computeStakeInput,
  DFLOW_PROGRAM_ID,
  finaliseStake,
  headroomFor,
  StakeGuardError,
  sizeInputLeg,
} from "@/lib/stake";
import { PAYOUT_MINTS, USDC_MINT, WSOL_MINT, isSupportedPayoutMint } from "@/lib/dflow";

/* ---------------------------------------------------------------------------
 * A chain with one interesting property: how much a broadcast puts into the
 * vault. `finaliseStake` is the only thing here that talks to the network or
 * the database, and both are stood in for so the amount can be dictated.
 * ------------------------------------------------------------------------- */

const chain = vi.hoisted(() => ({
  /** Set in `beforeEach`: the keypair `finaliseStake` co-signs with. */
  sponsor: null as Keypair | null,
  /** Rehearsal mode. A getter on the export, so a test can flip it per case. */
  dryRun: false,
  /** The vault whose rows in the confirmed transaction count as the stake. */
  vaultAddress: "",
  /** The vault's USDC row before and after; null means it had no such row. */
  vaultPre: null as bigint | null,
  vaultPost: null as bigint | null,
  /** A USDC row belonging to somebody who is not this vault. */
  strangerPost: null as bigint | null,
  /** Emit a USDC row that does not name its owner. `"undefined"` is how a
   *  pre-1.8 node omitted the field; `"null"` is the same absence spelled the
   *  other way, and a guard that only knows one spelling knows neither. */
  ownerless: null as null | "undefined" | "null",
  /** Which balance array the node does not send at all. A missing array is not
   *  an empty one: `[]` says the transaction touched no token accounts, absent
   *  says this node is not telling us which it touched. */
  omitBalances: null as null | "pre" | "post",
  /** Send the amounts in a form `BigInt` refuses, as a node with its own idea
   *  of the wire format would. */
  unparseableAmount: false,
  /** How many lookups answer "not here yet" before the transaction appears. */
  notFoundFor: 0,
  /** Whether the lookup errors outright rather than coming back empty. */
  lookupThrows: false,
  /** How many times the transaction was asked for. */
  lookupCalls: 0,
  /** How many times anything was put on chain. A refusal that arrives after
   *  this has moved off zero is an explanation, not a refusal. */
  broadcasts: 0,
}));

const db = vi.hoisted(() => ({
  pact: { findUniqueOrThrow: vi.fn(), update: vi.fn() },
  // `reopenForNextPeriod` reads this one. Nothing here calls it yet, so the
  // omission cost nothing -- it would have cost the next person to write that
  // test a confusing "cannot read findUniqueOrThrow of undefined".
  user: { findUniqueOrThrow: vi.fn() },
  membership: { findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn() },
  feedItem: { create: vi.fn() },
}));

vi.mock("@/lib/db", () => ({ prisma: db }));

/** One row of `pre`/`postTokenBalances`, as the RPC returns them. */
function usdcRow(owner: string | undefined | null, amount: bigint, accountIndex: number) {
  return {
    accountIndex,
    mint: USDC_MINT,
    owner,
    uiTokenAmount: {
      amount: chain.unparseableAmount ? "1.5" : amount.toString(),
      decimals: 6,
      uiAmount: Number(amount) / 1e6,
      uiAmountString: (Number(amount) / 1e6).toString(),
    },
  };
}

vi.mock("@/lib/solana", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/solana")>();
  return {
    ...actual,
    // A getter rather than a value: `finaliseStake` reads this at call time, and
    // the rehearsal case below needs it to say something different.
    get DRY_RUN() {
      return chain.dryRun;
    },
    loadSponsor: () => chain.sponsor,
    simulateOnly: async () => ({
      simulated: true as const,
      ok: true,
      error: null,
      unitsConsumed: 1,
      logs: [],
    }),
    submitAndConfirm: async () => {
      chain.broadcasts += 1;
      return "sig-under-test";
    },
    getConnection: () =>
      ({
        getTransaction: async () => {
          chain.lookupCalls += 1;
          if (chain.lookupThrows) throw new Error("rpc refused");
          // A node that has just confirmed a transaction can still be a beat
          // behind on serving it back, which reads as "not here" and not as an
          // error.
          if (chain.lookupCalls <= chain.notFoundFor) return null;

          const preTokenBalances = chain.vaultPre === null
            ? []
            : [usdcRow(chain.vaultAddress, chain.vaultPre, 1)];
          const postTokenBalances = [
            ...(chain.vaultPost === null ? [] : [usdcRow(chain.vaultAddress, chain.vaultPost, 1)]),
            ...(chain.strangerPost === null
              ? []
              : [usdcRow(stranger.publicKey.toBase58(), chain.strangerPost, 2)]),
            ...(chain.ownerless
              ? [usdcRow(chain.ownerless === "null" ? null : undefined, 1n, 3)]
              : []),
          ];

          return {
            meta: {
              preTokenBalances: chain.omitBalances === "pre" ? null : preTokenBalances,
              postTokenBalances: chain.omitBalances === "post" ? null : postTokenBalances,
            },
          };
        },
      }) as unknown as ReturnType<typeof actual.getConnection>,
  };
});

describe("computeStakeInput", () => {
  it("transfers when the member already holds USDC", () => {
    // DFlow cannot route a mint to itself -- lib/__tests__/dflow.test.ts
    // asserts that it errors -- so a USDC staker must never reach /order.
    const r = computeStakeInput({ inputMint: USDC_MINT, stakeUsdc: 28_500_000n });
    expect(r.kind).toBe("transfer");
    expect(r.amount).toBe(28_500_000n);
  });

  it("swaps when the member holds anything else", () => {
    expect(computeStakeInput({ inputMint: WSOL_MINT, stakeUsdc: 28_500_000n }).kind).toBe("swap");
  });
});

describe("headroomFor", () => {
  it("never goes below the floor on a deep pair", () => {
    // Measured on SOL/USDC at 100bps: without ~3% the worst-case output falls
    // below the stake and the order is refused. The floor is load-bearing.
    expect(headroomFor(0, 100)).toBeCloseTo(0.03, 6);
  });

  it("lets the floor cover a pair that is only slightly thin", () => {
    // 0.5% each way plus 1% slippage is 2%, which the floor already covers.
    expect(headroomFor(0.5, 100)).toBeCloseTo(0.03, 6);
  });

  it("exceeds the floor once the round trip costs more than it", () => {
    // The reverse probe under-reads a thin pair in both directions, so the
    // headroom covers the impact twice plus the slippage tolerance.
    expect(headroomFor(2, 100)).toBeGreaterThan(0.03);
    expect(headroomFor(3, 100)).toBeGreaterThan(headroomFor(2, 100));
  });

  it("treats a negative price impact as zero rather than shrinking the headroom", () => {
    expect(headroomFor(-1, 100)).toBeCloseTo(0.03, 6);
  });
});

describe("sizeInputLeg", () => {
  it("adds the headroom to the probe's output", () => {
    expect(sizeInputLeg(1_000_000n, 0.03)).toBe(1_030_000n);
  });

  it("rounds up, so rounding never leaves the stake short", () => {
    expect(sizeInputLeg(101n, 0.03)).toBe(105n);
  });
});

/* --- the sponsor guard ---------------------------------------------------
 * finaliseStake signs whatever it is handed with the sponsor key, and the
 * sponsor is the fee payer. Without this check anyone could post arbitrary
 * transaction bytes and have the sponsor pay for them.
 * ----------------------------------------------------------------------- */

const sponsor = Keypair.generate();
const user = Keypair.generate();
const vault = Keypair.generate();
/** Somebody who is not this vault, for proving whose rows get counted. */
const stranger = Keypair.generate();

/** A stand-in with the shape a real DFlow order has -- verified against one. */
function fakeOrder(opts: {
  feePayer?: PublicKey;
  programId?: PublicKey;
  includeVault?: boolean;
} = {}) {
  const keys = [
    { pubkey: user.publicKey, isSigner: true, isWritable: true },
    ...(opts.includeVault === false
      ? []
      : [{ pubkey: vault.publicKey, isSigner: false, isWritable: true }]),
  ];

  const message = new TransactionMessage({
    payerKey: opts.feePayer ?? sponsor.publicKey,
    recentBlockhash: PublicKey.default.toBase58(),
    instructions: [
      {
        programId: opts.programId ?? new PublicKey(DFLOW_PROGRAM_ID),
        keys,
        data: Buffer.alloc(0),
      },
    ],
  }).compileToV0Message();

  return new VersionedTransaction(message);
}

describe("assertIsOurStakeTx", () => {
  const ok = { sponsor: sponsor.publicKey, vault: vault.publicKey };

  it("accepts a transaction shaped like the order we asked for", () => {
    expect(() => assertIsOurStakeTx(fakeOrder(), ok)).not.toThrow();
  });

  it("refuses one whose fee payer is not our sponsor", () => {
    const stranger = Keypair.generate().publicKey;
    expect(() => assertIsOurStakeTx(fakeOrder({ feePayer: stranger }), ok)).toThrow(StakeGuardError);
  });

  it("refuses one that calls a program we never route through", () => {
    expect(() =>
      assertIsOurStakeTx(fakeOrder({ programId: SystemProgram.programId }), ok),
    ).toThrow(StakeGuardError);
  });

  /**
   * A real order from mainnet, refused on rehearsal 2026-08-31.
   *
   * DFlow appends a Lighthouse assertion to the swap -- the assertion protocol
   * wallets use against MEV and spoofed simulations. It cannot move a token;
   * all it can do is fail the transaction when the outcome is not what was
   * quoted. The allowlist was written from one live order that happened not to
   * carry one, so the first route that did was refused, and the member was
   * told the app does not route through it.
   *
   * Allowing it strictly narrows what a sponsored swap can get away with,
   * which is the one direction this guard should ever move in.
   */
  it("accepts the Lighthouse assertion DFlow appends to a real swap", () => {
    expect(() =>
      assertIsOurStakeTx(fakeOrder({ programId: new PublicKey(LIGHTHOUSE_PROGRAM_ID) }), ok),
    ).not.toThrow();
  });

  it("refuses one that does not touch this pact's vault", () => {
    expect(() => assertIsOurStakeTx(fakeOrder({ includeVault: false }), ok)).toThrow(
      StakeGuardError,
    );
  });

  it("refuses one signed by the wrong number of people", () => {
    // Only the sponsor signs: no member is putting anything in, so whatever
    // this is, it is not a stake.
    const message = new TransactionMessage({
      payerKey: sponsor.publicKey,
      recentBlockhash: PublicKey.default.toBase58(),
      instructions: [
        {
          programId: new PublicKey(DFLOW_PROGRAM_ID),
          keys: [{ pubkey: vault.publicKey, isSigner: false, isWritable: true }],
          data: Buffer.alloc(0),
        },
      ],
    }).compileToV0Message();

    expect(() => assertIsOurStakeTx(new VersionedTransaction(message), ok)).toThrow(
      StakeGuardError,
    );
  });
});

describe("payout mints", () => {
  it("accepts USDC and SOL", () => {
    expect(isSupportedPayoutMint("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v")).toBe(true);
    expect(isSupportedPayoutMint("So11111111111111111111111111111111111111112")).toBe(true);
  });

  it("refuses a mint that is not on the list, so settlement cannot route into junk", () => {
    expect(isSupportedPayoutMint("notamint")).toBe(false);
  });

  it("lists USDC first — it is the default and the pot's own unit", () => {
    expect(PAYOUT_MINTS[0].label).toBe("USDC");
  });
});

/* --- what actually arrived -----------------------------------------------
 * The guard above reads shape and never size. A member can hand-build a
 * transaction with exactly the shape it wants -- sponsor as fee payer, the
 * idempotent ATA creation, a transferChecked into the vault -- carrying one
 * atomic unit. Settlement pays every winner a whole principal back out of the
 * vault's actual balance, so a membership written `staked` on one unit is a
 * whole stake paid out of the rest of the crew's money.
 * ------------------------------------------------------------------------ */

const STAKE = 28_500_000n;

/** A transferChecked into the vault, shaped exactly like the one we build. */
function handBuiltTransfer(amount: bigint): VersionedTransaction {
  const mint = new PublicKey(USDC_MINT);
  const fromAta = getAssociatedTokenAddressSync(mint, user.publicKey);
  const toAta = getAssociatedTokenAddressSync(mint, vault.publicKey);

  const message = new TransactionMessage({
    payerKey: sponsor.publicKey,
    recentBlockhash: PublicKey.default.toBase58(),
    instructions: [
      createAssociatedTokenAccountIdempotentInstruction(
        sponsor.publicKey,
        toAta,
        vault.publicKey,
        mint,
      ),
      createTransferCheckedInstruction(fromAta, mint, toAta, user.publicKey, amount, 6),
    ],
  }).compileToV0Message();

  return new VersionedTransaction(message);
}

function stake(tx: VersionedTransaction) {
  return finaliseStake({
    pactId: "p1",
    userWallet: user.publicKey.toBase58(),
    signedTxB64: Buffer.from(tx.serialize()).toString("base64"),
    lastValidBlockHeight: 1,
    kind: "transfer",
  });
}

/**
 * What every `finaliseStake` case starts from: a live chain, a pact with a
 * stake to meet, and a caller who is on the crew's roster. Each test then sets
 * the one thing it is about and nothing else.
 *
 * Shared by both describes below rather than copied into each, because a reset
 * that drifts between two blocks is a test passing for a reason nobody chose.
 */
function primeStake() {
  vi.clearAllMocks();
  chain.sponsor = sponsor;
  chain.dryRun = false;
  chain.vaultAddress = vault.publicKey.toBase58();
  chain.vaultPre = null;
  chain.vaultPost = null;
  chain.strangerPost = null;
  chain.ownerless = null;
  chain.omitBalances = null;
  chain.unparseableAmount = false;
  chain.notFoundFor = 0;
  chain.lookupThrows = false;
  chain.lookupCalls = 0;
  chain.broadcasts = 0;

  db.pact.findUniqueOrThrow.mockResolvedValue({
    id: "p1",
    // A stake happens on a pact that is still funding, by a member who has not
    // paid yet. Both are guards now, so both belong in the fixture.
    status: "funding",
    stakeUsdc: STAKE,
    vaultAddress: vault.publicKey.toBase58(),
    stakeCurrency: "THB",
    fxRateToUsd: { toNumber: () => 0.0285 },
  });
  // Carries the user: `finaliseStake` reads the caller out of the membership
  // rather than looking the wallet up a second time.
  db.membership.findFirst.mockResolvedValue({
    id: "m1",
    status: "invited",
    user: { id: "u1", displayName: "Dave" },
  });
  db.membership.findMany.mockResolvedValue([]);
  // A default per test rather than none: `clearAllMocks` forgets the calls and
  // keeps the implementations, so a case that makes this one throw would go on
  // throwing in every case after it.
  db.membership.update.mockResolvedValue(undefined);
}

describe("finaliseStake, on what actually arrived", () => {
  beforeEach(primeStake);

  it("refuses a structurally perfect transaction carrying one atomic unit", async () => {
    const tx = handBuiltTransfer(1n);
    chain.vaultPost = 1n;

    // The structural guard is satisfied -- sponsor pays, the vault is in the
    // accounts, both programs are on the transfer allowlist. Only the size of
    // it is wrong, and nothing above this line was ever going to notice.
    expect(() =>
      assertIsOurStakeTx(tx, {
        sponsor: sponsor.publicKey,
        vault: vault.publicKey,
        kind: "transfer",
      }),
    ).not.toThrow();

    await expect(stake(tx)).rejects.toThrow(StakeGuardError);
  });

  it("leaves the membership unwritten when the stake did not arrive", async () => {
    chain.vaultPost = 1n;
    await expect(stake(handBuiltTransfer(1n))).rejects.toThrow();
    expect(db.membership.update).not.toHaveBeenCalled();
  });

  it("tells the member the shortfall in the crew's own currency", async () => {
    chain.vaultPost = 1n;
    // A stake of one atomic unit is ฿0.000035 and reads as nothing, which is
    // what it is. Raw atomic units would read as a number and not as money.
    await expect(stake(handBuiltTransfer(1n))).rejects.toThrow(
      /put ฿0 into the vault and the stake is ฿1,000/,
    );
  });

  it("refuses a member who has already staked, before anything is broadcast", async () => {
    /**
     * A second stake is not recoverable by settling: each winner is returned
     * one principal, so the duplicate lands in the pot and is split among the
     * crew as though it had been forfeited. The member who paid twice funds
     * everyone else's week.
     *
     * `reopen` has always refused this; `submit` did not, so the only thing
     * stopping it was a disabled button -- and StakeSheet re-enables that
     * before router.refresh lands, the 202 branch returns to a live one, and
     * two tabs need no bug at all.
     */
    db.membership.findFirst.mockResolvedValue({
      id: "m1",
      status: "staked",
      user: { id: "u1", displayName: "Dave" },
    });

    await expect(stake(handBuiltTransfer(STAKE))).rejects.toThrow(
      "You are already staked for this period. Nothing was sent.",
    );
    // The point of refusing early: nothing was co-signed and nothing was sent.
    expect(chain.broadcasts).toBe(0);
  });

  it("refuses a stake into a pact that has already started", async () => {
    // The vault's settlement is already decided, and there is no operator path
    // in this build to send money back out of it.
    db.pact.findUniqueOrThrow.mockResolvedValue({
      id: "p1",
      status: "active",
      stakeUsdc: STAKE,
      vaultAddress: vault.publicKey.toBase58(),
      stakeCurrency: "THB",
      fxRateToUsd: { toNumber: () => 0.0285 },
    });

    await expect(stake(handBuiltTransfer(STAKE))).rejects.toThrow(
      "This pact has already started. Nothing was sent.",
    );
    expect(chain.broadcasts).toBe(0);
  });

  it("does not move startsAt when the pact is already running", async () => {
    // Every period key derives from startsAt, so moving it would make the weeks
    // already lived unsettleable.
    db.pact.findUniqueOrThrow.mockResolvedValue({
      id: "p1",
      status: "active",
      stakeUsdc: STAKE,
      vaultAddress: vault.publicKey.toBase58(),
      stakeCurrency: "THB",
      fxRateToUsd: { toNumber: () => 0.0285 },
    });
    db.membership.findMany.mockResolvedValue([{ status: "staked" }]);

    await expect(stake(handBuiltTransfer(STAKE))).rejects.toThrow();
    expect(db.pact.update).not.toHaveBeenCalled();
  });

  it("takes the first stake into a vault that has never held USDC", async () => {
    // No pre-row at all: the account did not exist until this transaction made
    // it. A real zero, and the ordinary case for a crew's first stake.
    chain.vaultPre = null;
    chain.vaultPost = STAKE;

    await expect(stake(handBuiltTransfer(STAKE))).resolves.toMatchObject({
      signature: "sig-under-test",
    });
    expect(db.membership.update).toHaveBeenCalledOnce();
  });

  it("counts the rise and not the total, so a funded vault is no free pass", async () => {
    // Four members have already staked. The vault is full of money that is not
    // this member's, and reading the balance alone would call that a stake.
    chain.vaultPre = STAKE * 4n;
    chain.vaultPost = STAKE * 4n + 1n;

    await expect(stake(handBuiltTransfer(1n))).rejects.toThrow(StakeGuardError);
    expect(db.membership.update).not.toHaveBeenCalled();
  });

  it("does not count USDC that moved in the same transaction to somebody else", async () => {
    // The reason attribution is per signature rather than per window: money
    // landing alongside this member's is somebody else's row, and a check that
    // could not tell them apart would let one full stake cover several seats.
    chain.vaultPost = 1n;
    chain.strangerPost = STAKE * 10n;

    await expect(stake(handBuiltTransfer(1n))).rejects.toThrow(StakeGuardError);
    expect(db.membership.update).not.toHaveBeenCalled();
  });

  it("asks again when the node does not have the transaction yet", async () => {
    chain.notFoundFor = 1;
    chain.vaultPost = STAKE;

    await expect(stake(handBuiltTransfer(STAKE))).resolves.toMatchObject({
      signature: "sig-under-test",
    });
    expect(chain.lookupCalls).toBe(2);
  });

  it("fails closed when the transaction never becomes available", async () => {
    chain.notFoundFor = Number.MAX_SAFE_INTEGER;
    chain.vaultPost = STAKE;

    await expect(stake(handBuiltTransfer(STAKE))).rejects.toMatchObject({
      name: "SubmitError",
      signature: "sig-under-test",
    });
    expect(db.membership.update).not.toHaveBeenCalled();
  });

  it("fails closed when the lookup errors rather than coming back empty", async () => {
    // The first version of this check read a balance, could not tell a failed
    // read from an empty account, and called it zero -- which on a funded vault
    // waved through a one-unit stake. Nothing here is allowed to guess.
    chain.lookupThrows = true;
    chain.vaultPost = STAKE;

    await expect(stake(handBuiltTransfer(STAKE))).rejects.toMatchObject({
      name: "SubmitError",
      signature: "sig-under-test",
    });
    expect(db.membership.update).not.toHaveBeenCalled();
  });

  it("fails closed when a node omits the owner it would have to attribute by", async () => {
    // `owner` is optional on the RPC type. Missing it, every row misses, the
    // delta reads zero, and an honest staker is told their money never came.
    // Refusing to answer is the only honest thing left.
    chain.ownerless = "undefined";
    chain.vaultPost = STAKE;

    await expect(stake(handBuiltTransfer(STAKE))).rejects.toMatchObject({
      name: "SubmitError",
    });
    expect(db.membership.update).not.toHaveBeenCalled();
  });

  it("refuses when the node does not say what the vault held before", async () => {
    // The one this round exists for. Reading a missing `pre` as "the vault held
    // nothing" hands this one-unit transfer the vault's entire post balance --
    // four other members' stakes -- and records it as a full stake. That is the
    // original bug, one function deeper, reached by a node being terse rather
    // than by a member being clever.
    chain.omitBalances = "pre";
    chain.vaultPre = STAKE * 4n;
    chain.vaultPost = STAKE * 4n + 1n;

    await expect(stake(handBuiltTransfer(1n))).rejects.toMatchObject({
      name: "SubmitError",
      signature: "sig-under-test",
    });
    expect(db.membership.update).not.toHaveBeenCalled();
  });

  it("refuses when the node does not say what the vault held after", async () => {
    // The mirror, and it fails in the other direction: an absent `post` read as
    // empty makes an honest full stake look like nothing arrived, and the member
    // is told they are not staked in a sentence that is simply false. "We could
    // not read it" is a different answer from "you sent nothing", and only one
    // of them is true here.
    chain.vaultPre = null;
    chain.vaultPost = STAKE;
    chain.omitBalances = "post";

    await expect(stake(handBuiltTransfer(STAKE))).rejects.toMatchObject({
      name: "SubmitError",
      signature: "sig-under-test",
    });
    expect(db.membership.update).not.toHaveBeenCalled();
  });

  it("fails closed when a node spells the missing owner `null` rather than omitting it", async () => {
    // The delta here reads correctly by luck -- the unattributable row is not
    // the vault's. That is the point: a rule that refuses only when it can tell
    // which row it lost is not a rule. Any USDC row we cannot attribute might
    // have been the vault's, and `owner === undefined` cannot see this one.
    chain.ownerless = "null";
    chain.vaultPost = STAKE;

    await expect(stake(handBuiltTransfer(STAKE))).rejects.toMatchObject({
      name: "SubmitError",
    });
    expect(db.membership.update).not.toHaveBeenCalled();
  });

  it("fails closed when the amount comes back in a form it cannot parse", async () => {
    // Everything past the broadcast turns a bare Error into HTTP 500 and "That
    // did not go through", and a member told that stakes a second time and pays
    // twice. An amount we cannot read is one more way of not having established
    // one, so it leaves by the same door as the rest instead of throwing out
    // through a contract that says `bigint | null`.
    chain.unparseableAmount = true;
    chain.vaultPost = STAKE;

    await expect(stake(handBuiltTransfer(STAKE))).rejects.toMatchObject({
      name: "SubmitError",
      signature: "sig-under-test",
    });
    expect(db.membership.update).not.toHaveBeenCalled();
  });

  it("does not apply the check to a rehearsal, which broadcasts nothing", async () => {
    // Deliberate, and asserted so it stays deliberate. Under STAKE_DRY_RUN the
    // transaction is simulated rather than sent, so there is no confirmed
    // transaction to attribute and a delivery check would refuse every
    // rehearsal there has ever been. Anyone tempted to "fix" the skip has to
    // delete this test first.
    chain.dryRun = true;

    await expect(stake(handBuiltTransfer(STAKE))).resolves.toMatchObject({
      dryRun: { simulated: true, ok: true },
    });
    expect(db.membership.update).toHaveBeenCalledOnce();
    expect(chain.lookupCalls).toBe(0);
  });
});

/* --- who is asking --------------------------------------------------------
 * Everything above is about the size of what landed. This is about whether the
 * caller had any business sending it. `finaliseStake` used to read the
 * membership for the first time at the `update` that records the stake, which
 * is after the broadcast: a caller who was not on the roster delivered a full
 * stake into a crew's vault and got a `P2025` on a composite key naming no row.
 * A bare error past the broadcast is HTTP 500 and "That did not go through",
 * and a member told that stakes a second time -- the outcome the whole delivery
 * check above is arranged to avoid, reached through a door it never covered.
 * ------------------------------------------------------------------------ */

describe("finaliseStake, on who is asking", () => {
  beforeEach(() => {
    primeStake();
    db.membership.findFirst.mockResolvedValue(null);
    // What the missing row does at the far end, if anything ever reaches it:
    // Prisma throws P2025 when the key in `where` matches no row. Mocked so
    // these two fail the way the bug failed rather than the way a forgiving
    // stand-in would -- a refusal is only worth asserting against the error
    // that was actually there to escape.
    db.membership.update.mockRejectedValue(
      Object.assign(new Error("depends on records that were required but not found"), {
        code: "P2025",
      }),
    );
  });

  it("refuses a wallet with no membership on this pact, before anything is broadcast", async () => {
    chain.vaultPost = STAKE;

    // A full stake, honestly delivered, by somebody who is not in the crew.
    // The refusal has to be a refusal and not a post-mortem, so the assertion
    // that matters is the second one: nothing went out.
    await expect(stake(handBuiltTransfer(STAKE))).rejects.toThrow(StakeGuardError);
    expect(chain.broadcasts).toBe(0);
    expect(chain.lookupCalls).toBe(0);
    expect(db.membership.update).not.toHaveBeenCalled();
  });

  it("refuses a rehearsal by a non-member too, rather than simulating one", async () => {
    // Placement, asserted. A check sitting inside the broadcast branch would
    // let a rehearsal walk past it and reach the same `update` on the same
    // missing row -- a 500 with no transaction behind it, which is the demo
    // failing for a reason nobody watching could name.
    chain.dryRun = true;

    await expect(stake(handBuiltTransfer(STAKE))).rejects.toThrow(StakeGuardError);
    expect(db.membership.update).not.toHaveBeenCalled();
  });
});
