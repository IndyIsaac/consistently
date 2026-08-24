import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { Keypair } from "@solana/web3.js";

function key(): Buffer {
  const raw = process.env.VAULT_ENCRYPTION_KEY;
  if (!raw) throw new Error("VAULT_ENCRYPTION_KEY is not set");
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) throw new Error("VAULT_ENCRYPTION_KEY must be 32 bytes, base64 encoded");
  return buf;
}

export function encryptSecret(secret: Uint8Array): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(Buffer.from(secret)), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), ct.toString("base64")].join(".");
}

export function decryptSecret(enc: string): Uint8Array {
  const [ivB64, tagB64, ctB64] = enc.split(".");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return new Uint8Array(
    Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]),
  );
}

export function createVault(): { publicKey: string; secretEnc: string } {
  const kp = Keypair.generate();
  return { publicKey: kp.publicKey.toBase58(), secretEnc: encryptSecret(kp.secretKey) };
}

export function loadVault(secretEnc: string): Keypair {
  return Keypair.fromSecretKey(decryptSecret(secretEnc));
}
