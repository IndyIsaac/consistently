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
  /** The vault's USDC balance; null when it holds no account for the mint. */
  vaultBalance: null as bigint | null,
  /** What the broadcast delivers into the vault, which is the whole point. */
  delivers: 0n,
  /** Rehearsal mode. A getter on the export, so a test can flip it per case. */
  dryRun: false,
  /** When set, the vault stops being readable the moment the broadcast lands. */
  blindAfterBroadcast: false,
}));

const db = vi.hoisted(() => ({
  pact: { findUniqueOrThrow: vi.fn(), update: vi.fn() },
  user: { findUniqueOrThrow: vi.fn() },
  membership: { findMany: vi.fn(), update: vi.fn() },
  feedItem: { create: vi.fn() },
}));

vi.mock("@/lib/db", () => ({ prisma: db }));

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
      chain.vaultBalance = chain.blindAfterBroadcast
        ? null
        : (chain.vaultBalance ?? 0n) + chain.delivers;
      return "sig-under-test";
    },
    getConnection: () =>
      ({
        getTokenAccountBalance: async () => {
          // A vault that has never held USDC has no account for it, and the RPC
          // says so by failing rather than by answering zero.
          if (chain.vaultBalance === null) throw new Error("could not find account");
          return { value: { amount: chain.vaultBalance.toString() } };
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

describe("finaliseStake, on what actually arrived", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chain.sponsor = sponsor;
    chain.vaultBalance = null;
    chain.delivers = 0n;
    chain.dryRun = false;
    chain.blindAfterBroadcast = false;

    db.pact.findUniqueOrThrow.mockResolvedValue({
      id: "p1",
      stakeUsdc: STAKE,
      vaultAddress: vault.publicKey.toBase58(),
    });
    db.user.findUniqueOrThrow.mockResolvedValue({ id: "u1", displayName: "Dave" });
    db.membership.findMany.mockResolvedValue([]);
  });

  it("refuses a structurally perfect transaction carrying one atomic unit", async () => {
    const tx = handBuiltTransfer(1n);
    chain.delivers = 1n;

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
    chain.delivers = 1n;
    await expect(stake(handBuiltTransfer(1n))).rejects.toThrow();
    expect(db.membership.update).not.toHaveBeenCalled();
  });

  it("takes the first stake into a vault that has never held USDC", async () => {
    chain.delivers = STAKE;
    await expect(stake(handBuiltTransfer(STAKE))).resolves.toMatchObject({
      signature: "sig-under-test",
    });
    expect(db.membership.update).toHaveBeenCalledOnce();
  });

  it("does not apply the check to a rehearsal, which broadcasts nothing", async () => {
    // Deliberate, and asserted so it stays deliberate. Under STAKE_DRY_RUN the
    // transaction is simulated rather than sent, so the vault's balance cannot
    // rise and a delivery check would refuse every rehearsal there has ever
    // been. Anyone tempted to "fix" the skip has to delete this test first.
    chain.dryRun = true;
    chain.delivers = 0n;

    await expect(stake(handBuiltTransfer(STAKE))).resolves.toMatchObject({
      dryRun: { simulated: true, ok: true },
    });
    expect(db.membership.update).toHaveBeenCalledOnce();
  });

  it("does not call an unreadable vault a refusal", async () => {
    // The transaction confirmed and only the reading failed. Answering the
    // member "that did not go through" invites them to stake a second time, so
    // this goes back as the class the route already returns with the signature
    // attached and an instruction not to retry.
    chain.blindAfterBroadcast = true;
    chain.delivers = STAKE;

    await expect(stake(handBuiltTransfer(STAKE))).rejects.toMatchObject({
      name: "SubmitError",
      signature: "sig-under-test",
    });
    expect(db.membership.update).not.toHaveBeenCalled();
  });

  it("measures the rise and not the total, so a funded vault is no free pass", async () => {
    // Four members have already staked. The vault is full of money that is not
    // this member's, and reading the balance alone would call that a stake.
    chain.vaultBalance = STAKE * 4n;
    chain.delivers = 1n;

    await expect(stake(handBuiltTransfer(1n))).rejects.toThrow(StakeGuardError);
    expect(db.membership.update).not.toHaveBeenCalled();
  });
});
