import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { USDC_MINT } from "@/lib/dflow";
import { getConnection } from "@/lib/solana";

/* ---------------------------------------------------------------------------
 * What a member actually holds, right now, on chain.
 *
 * Only the two mints that matter here: SOL, because that is what most people
 * arrive holding, and USDC, because that is what a stake becomes.
 *
 * Distinct from the funding check behind the gate, which asks a yes-or-no
 * question and stops asking once it has heard yes. "How much have I got" is a
 * different question and the screen asking it is looking at money, not a door.
 * ------------------------------------------------------------------------- */

export type Holdings = { sol: number; usdc: number };

/** Null when Solana could not be reached -- which is not a wallet of nothing. */
export async function readHoldings(address: string): Promise<Holdings | null> {
  let owner: PublicKey;
  try {
    owner = new PublicKey(address);
  } catch {
    return null;
  }

  const connection = getConnection();

  try {
    const usdcAta = getAssociatedTokenAddressSync(new PublicKey(USDC_MINT), owner);
    const [lamports, usdc] = await Promise.all([
      connection.getBalance(owner),
      // A wallet that has never held USDC has no account for it. Not an error,
      // a zero.
      connection
        .getTokenAccountBalance(usdcAta)
        .then((r) => r.value.amount)
        .catch(() => "0"),
    ]);

    return { sol: lamports / 1e9, usdc: Number(usdc) / 1e6 };
  } catch {
    return null;
  }
}
