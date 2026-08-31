import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

/* ---------------------------------------------------------------------------
 * npm run new-wallet
 *
 * Prints a fresh Solana keypair for SPONSOR_SECRET_KEY. It is generated here
 * and nowhere else -- not sent anywhere, not written to disk. Copy the secret
 * into .env, send SOL to the address, and close the terminal.
 *
 * This wallet pays the network fee for every stake and every payout in the
 * product. It never holds a member's stake: that goes to a per-pact vault.
 * ------------------------------------------------------------------------- */

const kp = Keypair.generate();

console.log("");
console.log("  Address (send SOL here, ~0.1 covers a demo)");
console.log(`  ${kp.publicKey.toBase58()}`);
console.log("");
console.log("  SPONSOR_SECRET_KEY (paste into .env, never commit)");
console.log(`  ${bs58.encode(kp.secretKey)}`);
console.log("");
