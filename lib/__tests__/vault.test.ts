import { randomBytes } from "node:crypto";
import { describe, it, expect } from "vitest";
import { createVault, loadVault, encryptSecret, decryptSecret } from "@/lib/vault";

describe("vault", () => {
  it("round-trips an encrypted secret", () => {
    const secret = new Uint8Array(64).fill(7);
    const enc = encryptSecret(secret);
    expect(enc).not.toContain(Buffer.from(secret).toString("base64"));
    expect(Array.from(decryptSecret(enc))).toEqual(Array.from(secret));
  });

  it("creates a vault whose encrypted secret loads back to the same public key", () => {
    const v = createVault();
    const kp = loadVault(v.secretEnc);
    expect(kp.publicKey.toBase58()).toBe(v.publicKey);
  });

  it("produces a different ciphertext each time for the same secret", () => {
    const secret = new Uint8Array(64).fill(1);
    expect(encryptSecret(secret)).not.toBe(encryptSecret(secret));
  });

  it("throws when the ciphertext has been tampered with", () => {
    const secret = new Uint8Array(64).fill(9);
    const enc = encryptSecret(secret);
    const [iv, tag, ctB64] = enc.split(".");
    const tampered = Buffer.from(ctB64, "base64");
    tampered[0] ^= 0xff;
    const tamperedEnc = [iv, tag, tampered.toString("base64")].join(".");
    expect(() => decryptSecret(tamperedEnc)).toThrow();
  });

  it("throws when decrypted with a different encryption key", () => {
    const secret = new Uint8Array(64).fill(5);
    const enc = encryptSecret(secret);
    const original = process.env.VAULT_ENCRYPTION_KEY;
    process.env.VAULT_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    try {
      expect(() => decryptSecret(enc)).toThrow();
    } finally {
      process.env.VAULT_ENCRYPTION_KEY = original;
    }
  });
});
