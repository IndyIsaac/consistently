import { describe, it, expect } from "vitest";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  assertIsOurStakeTx,
  computeStakeInput,
  DFLOW_PROGRAM_ID,
  headroomFor,
  StakeGuardError,
  sizeInputLeg,
} from "@/lib/stake";
import { PAYOUT_MINTS, USDC_MINT, WSOL_MINT, isSupportedPayoutMint } from "@/lib/dflow";

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
