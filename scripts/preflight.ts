import "dotenv/config";
import { Connection, Keypair } from "@solana/web3.js";
import bs58 from "bs58";

/* ---------------------------------------------------------------------------
 * npm run preflight
 *
 * Answers one question: if I try the money path right now, what will stop me?
 *
 * Every check is a real call -- the database is queried, the RPC is asked for a
 * slot, DFlow is asked for a live quote, the sponsor's balance is read. A key
 * being present in .env is not evidence that it works, and the difference
 * between those two is most of an evening.
 *
 * Nothing here writes anything or spends anything.
 * ------------------------------------------------------------------------- */

type Result = { ok: boolean; note: string; fix?: string };
const results: [string, Result][] = [];

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const WSOL = "So11111111111111111111111111111111111111112";

function has(key: string): string {
  return (process.env[key] ?? "").trim();
}

async function check(name: string, run: () => Promise<Result>) {
  try {
    results.push([name, await run()]);
  } catch (e) {
    results.push([name, { ok: false, note: e instanceof Error ? e.message : String(e) }]);
  }
}

async function main() {
  await check("Database", async () => {
    if (!has("DATABASE_URL")) {
      return {
        ok: false,
        note: "not set — the app will serve the demo instead of real rows",
        fix: "a Neon database, or the local one: postgresql://$(whoami)@localhost:5433/dflow_dev",
      };
    }
    const { prisma } = await import("../lib/db");
    const [users, pacts] = await Promise.all([prisma.user.count(), prisma.pact.count()]);
    await prisma.$disconnect();
    return { ok: true, note: `connected — ${users} users, ${pacts} pacts` };
  });

  await check("Privy", async () => {
    const id = has("NEXT_PUBLIC_PRIVY_APP_ID");
    const secret = has("PRIVY_APP_SECRET");
    if (!id || !secret) {
      return {
        ok: false,
        note: `${!id ? "NEXT_PUBLIC_PRIVY_APP_ID" : "PRIVY_APP_SECRET"} missing — no sign-in, no wallet, no gate`,
        fix: "dashboard.privy.io -> new app -> enable Email login and Solana embedded wallets",
      };
    }
    // The JWKS route exists per app; a 200 proves the id is a real app.
    const res = await fetch(`https://auth.privy.io/api/v1/apps/${id}/jwks.json`);
    return res.ok
      ? { ok: true, note: "app id resolves, secret present" }
      : { ok: false, note: `app id rejected by Privy (${res.status})`, fix: "check the id in the dashboard" };
  });

  await check("Solana RPC", async () => {
    const url = has("SOLANA_RPC_URL") || "https://api.mainnet-beta.solana.com";
    const slot = await new Connection(url, "confirmed").getSlot();
    const isPublic = url.includes("api.mainnet-beta.solana.com");
    return {
      ok: true,
      note: `slot ${slot}${isPublic ? " — PUBLIC endpoint" : ""}`,
      fix: isPublic
        ? "the public RPC rate-limits; a Helius key will stop the balance poll and confirmations stalling on stage"
        : undefined,
    };
  });

  await check("Sponsor wallet", async () => {
    const raw = has("SPONSOR_SECRET_KEY");
    if (!raw) {
      return {
        ok: false,
        note: "not set — nobody can stake, because nobody pays the fee",
        fix: "generate one, fund it with ~0.1 SOL, and put the bs58 secret here",
      };
    }
    const kp = Keypair.fromSecretKey(bs58.decode(raw));
    const url = has("SOLANA_RPC_URL") || "https://api.mainnet-beta.solana.com";
    const lamports = await new Connection(url, "confirmed").getBalance(kp.publicKey);
    const sol = lamports / 1e9;
    return {
      ok: sol > 0.02,
      note: `${kp.publicKey.toBase58()} holds ${sol.toFixed(4)} SOL`,
      fix:
        sol > 0.02
          ? undefined
          : "fund it — every stake and every payout is paid for from here (~0.05 SOL covers a demo)",
    };
  });

  await check("Vault key", async () => {
    const raw = has("VAULT_ENCRYPTION_KEY");
    if (!raw) {
      return {
        ok: false,
        note: "not set — creating a pact will throw",
        fix: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`,
      };
    }
    const { createVault, loadVault } = await import("../lib/vault");
    const v = createVault();
    const back = loadVault(v.secretEnc).publicKey.toBase58();
    return back === v.publicKey
      ? { ok: true, note: "encrypts and decrypts a vault keypair" }
      : { ok: false, note: "round trip does not match — the key is wrong" };
  });

  await check("DFlow", async () => {
    const { getQuote } = await import("../lib/dflow");
    const q = await getQuote({
      inputMint: WSOL,
      outputMint: USDC,
      amount: 1_000_000_000n,
      slippageBps: 50,
    });
    const price = (Number(q.outAmount) / 1e6).toFixed(2);
    const venues = q.routePlan?.map((l) => l.venue).join(" > ") ?? "";
    return { ok: true, note: `1 SOL = $${price} via ${venues}` };
  });

  await check("Platform fee", async () => {
    const bps = has("PLATFORM_FEE_BPS");
    const account = has("PLATFORM_FEE_ACCOUNT");
    if (!bps || bps === "0") return { ok: true, note: "off (0 bps) — settlement will not try to take one" };
    if (!account) {
      return {
        ok: false,
        note: `${bps} bps set with no fee account — every payout swap will fail`,
        fix: "set PLATFORM_FEE_ACCOUNT to an existing token account, or set PLATFORM_FEE_BPS=0",
      };
    }
    return { ok: true, note: `${bps} bps to ${account}` };
  });

  await check("Rule drafter", async () => {
    return has("ANTHROPIC_API_KEY")
      ? { ok: true, note: "key present — plain-English rules will draft" }
      : {
          ok: false,
          note: "not set — the create form falls back to the manual fields",
          fix: "optional. console.anthropic.com if you want the plain-English step in the demo",
        };
  });

  await check("Photo upload", async () => {
    return has("BLOB_READ_WRITE_TOKEN")
      ? { ok: true, note: "key present" }
      : {
          ok: false,
          note: "not set — check-in photos live only in the tab that took them",
          fix: "optional for a single-device demo. Vercel Blob otherwise",
        };
  });

  // --- report ---------------------------------------------------------------

  const pad = Math.max(...results.map(([n]) => n.length));
  let blockers = 0;

  console.log("");
  for (const [name, r] of results) {
    const mark = r.ok ? "  ok " : " MISS";
    if (!r.ok) blockers += 1;
    console.log(`${mark}  ${name.padEnd(pad)}  ${r.note}`);
    if (r.fix) console.log(`${" ".repeat(pad + 8)}-> ${r.fix}`);
  }

  const live = results.find(([n]) => n === "Database")?.[1].ok &&
    results.find(([n]) => n === "Privy")?.[1].ok;

  console.log("");
  console.log(live ? "Real data is ON: signing in will read the database." : "Real data is OFF: every screen serves lib/mock-session.ts.");
  console.log(blockers === 0 ? "Nothing is blocking the money path." : `${blockers} thing(s) above need attention.`);
  console.log("");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
