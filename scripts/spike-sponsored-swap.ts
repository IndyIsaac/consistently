import "dotenv/config";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { buildOrder, USDC_MINT, WSOL_MINT } from "../lib/dflow";
import { deserializeTx, signWith, submitAndConfirm, loadSponsor } from "../lib/solana";

async function main() {
  if (process.env.CONFIRM_MAINNET_SPIKE !== "1") {
    throw new Error(
      "This script submits a real, sponsored swap on Solana mainnet, spending funds " +
        "from SPONSOR_SECRET_KEY and TEST_USER_SECRET_KEY. Set CONFIRM_MAINNET_SPIKE=1 " +
        "to run it deliberately.",
    );
  }

  const user = Keypair.fromSecretKey(bs58.decode(process.env.TEST_USER_SECRET_KEY!));
  const sponsor = loadSponsor();

  const destination = process.env.TEST_DESTINATION_WALLET;
  if (!destination || destination === user.publicKey.toBase58()) {
    throw new Error(
      "TEST_DESTINATION_WALLET must be set to an address different from the test " +
        "user's wallet. destinationWallet routing is the mechanism that gets a pact's " +
        "proceeds into its vault instead of back to the member -- if this spike swaps " +
        "into the user's own wallet, it proves nothing about that routing.",
    );
  }

  console.log("user    ", user.publicKey.toBase58());
  console.log("sponsor ", sponsor.publicKey.toBase58());
  console.log("dest    ", destination);

  const order = await buildOrder({
    inputMint: WSOL_MINT,
    outputMint: USDC_MINT,
    amount: 5_000_000n, // 0.005 SOL
    userPublicKey: user.publicKey.toBase58(),
    destinationWallet: destination,
    sponsor: sponsor.publicKey.toBase58(),
    sponsorExec: false,
    slippageBps: 100,
  });

  console.log("quote   ", order.inAmount, "->", order.outAmount, "via", order.routePlan?.map((l) => l.venue).join(" > "));

  const tx = deserializeTx(order.transaction!);
  signWith(tx, [user, sponsor]);

  const sig = await submitAndConfirm(tx, order.lastValidBlockHeight!);
  console.log("CONFIRMED https://solscan.io/tx/" + sig);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
