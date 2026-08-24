import { describe, it, expect } from "vitest";
import { createVault, loadVault, encryptSecret, decryptSecret } from "@/lib/vault";

describe("vault", () => {
  it("round-trips an encrypted secret", () => {
    const secret = new Uint8Array(64).fill(7);
    const enc = encryptSecret(secret);
    expect(enc).not.toContain("7,7,7");
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
});
