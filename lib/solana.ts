import {
  Connection,
  Keypair,
  type RpcResponseAndContext,
  type SignatureResult,
  VersionedTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";

export function getConnection(): Connection {
  return new Connection(
    process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com",
    "confirmed",
  );
}

export function deserializeTx(base64: string): VersionedTransaction {
  return VersionedTransaction.deserialize(Buffer.from(base64, "base64"));
}

export function serializeTx(tx: VersionedTransaction): string {
  return Buffer.from(tx.serialize()).toString("base64");
}

/** Adds signatures without clearing any already present. */
export function signWith(tx: VersionedTransaction, signers: Keypair[]): VersionedTransaction {
  tx.sign(signers);
  return tx;
}

export function loadSponsor(): Keypair {
  const raw = process.env.SPONSOR_SECRET_KEY;
  if (!raw) throw new Error("SPONSOR_SECRET_KEY is not set");
  return Keypair.fromSecretKey(bs58.decode(raw));
}

const CONFIRMATION_TIMEOUT_MS = 90_000;

/**
 * A failure (or confirmation timeout) that occurs after `sendRawTransaction` has
 * already returned. The transaction is on the network at that point and may still
 * land -- callers must check `signature` against chain state before retrying,
 * since retrying the caller's swap logic here would re-execute it.
 */
export class SubmitError extends Error {
  constructor(
    message: string,
    public readonly signature: string,
  ) {
    super(message);
    this.name = "SubmitError";
  }
}

export async function submitAndConfirm(
  tx: VersionedTransaction,
  lastValidBlockHeight: number,
): Promise<string> {
  const connection = getConnection();
  const signature = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    maxRetries: 3,
  });

  // Everything below this point is already broadcast. Every failure from here
  // must carry `signature` so a caller can check whether it landed instead of
  // blindly retrying -- see SubmitError above.
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new Error(`Confirmation timed out after ${CONFIRMATION_TIMEOUT_MS}ms`)),
    CONFIRMATION_TIMEOUT_MS,
  );

  let confirmation: RpcResponseAndContext<SignatureResult>;
  try {
    confirmation = await connection.confirmTransaction(
      {
        signature,
        // The blockhash actually embedded in this transaction -- the one
        // `lastValidBlockHeight` was computed against by the order response --
        // not a freshly fetched one, which would pair a stale height with an
        // unrelated blockhash.
        blockhash: tx.message.recentBlockhash,
        lastValidBlockHeight,
        abortSignal: controller.signal,
      },
      "confirmed",
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new SubmitError(message, signature);
  } finally {
    clearTimeout(timeout);
  }

  if (confirmation.value.err) {
    throw new SubmitError(
      `Transaction failed: ${JSON.stringify(confirmation.value.err)}`,
      signature,
    );
  }
  return signature;
}

/* ---------------------------------------------------------------------------
 * Rehearsal.
 *
 * `STAKE_DRY_RUN=1` runs the entire money path except the last step: the order
 * is priced, the transaction built, the member signs it, the sponsor co-signs,
 * the guard checks it -- and then it is simulated against live mainnet state
 * rather than broadcast.
 *
 * `sigVerify: true` is the point. The simulator checks every signature before
 * it runs anything, which makes this the cheapest possible test of the one
 * thing that cannot be verified by reading code: whether a wallet's signing
 * round-trip leaves the sponsor's signature slot intact for the server to
 * fill. If that is broken, this fails here, for nothing, at a desk.
 *
 * What it does not prove: that the member has the funds. A simulation on an
 * empty wallet fails on balance, which is a pass for every question this mode
 * is asking.
 * ------------------------------------------------------------------------- */

/** A signature that cannot be mistaken for one. Never appears with money behind it. */
export const DRY_RUN_SIGNATURE_PREFIX = "dry-run:";

export const DRY_RUN = process.env.STAKE_DRY_RUN === "1";

export type DryRun = {
  simulated: true;
  /** False when the simulator refused it -- signatures, or the instructions themselves. */
  ok: boolean;
  /** Present when it failed. Balance errors here are expected on an unfunded wallet. */
  error: string | null;
  unitsConsumed: number | null;
  logs: string[];
};

export async function simulateOnly(tx: VersionedTransaction): Promise<DryRun> {
  const { value } = await getConnection().simulateTransaction(tx, {
    // Verifies every signature before running a single instruction. Without
    // this the simulation would happily run an unsigned transaction and tell
    // us nothing about the half we came to check.
    sigVerify: true,
    replaceRecentBlockhash: false,
    commitment: "confirmed",
  });

  return {
    simulated: true,
    ok: value.err === null,
    error: value.err === null ? null : JSON.stringify(value.err),
    unitsConsumed: value.unitsConsumed ?? null,
    logs: value.logs ?? [],
  };
}
