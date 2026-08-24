import { Connection, Keypair, VersionedTransaction } from "@solana/web3.js";
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

export async function submitAndConfirm(
  tx: VersionedTransaction,
  lastValidBlockHeight: number,
): Promise<string> {
  const connection = getConnection();
  const signature = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    maxRetries: 3,
  });
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  const { value } = await connection.confirmTransaction(
    { signature, blockhash, lastValidBlockHeight },
    "confirmed",
  );
  if (value.err) throw new Error(`Transaction failed: ${JSON.stringify(value.err)}`);
  return signature;
}
