"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import { useSignTransaction, useWallets } from "@privy-io/react-auth/solana";
import { TriangleAlert } from "lucide-react";

/* ---------------------------------------------------------------------------
 * Putting the money in, from the member's side.
 *
 * The price on screen is a quote-only call -- no wallet, no transaction, no
 * blockhash -- so it can sit here for as long as somebody wants to read it.
 * The order that actually gets signed is built on the tap, because DFlow's
 * order carries a blockhash good for about a minute and a flow that builds
 * first and asks second is a flow whose transaction dies while it is being
 * read.
 *
 * From tap to chain there is nothing to answer: build, sign, co-sign, submit.
 * Every question in that stretch costs part of the sixty seconds.
 * ------------------------------------------------------------------------- */

const MINTS = [
  { mint: "So11111111111111111111111111111111111111112", label: "SOL", decimals: 9 },
  { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", label: "USDC", decimals: 6 },
];

/** Atomic units to a readable figure. Trailing zeroes are noise on a price. */
function amount(atomic: string, decimals: number): string {
  const n = Number(atomic) / 10 ** decimals;
  return n.toLocaleString("en-US", { maximumFractionDigits: decimals === 6 ? 2 : 4 });
}

function b64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

function bytesToB64(bytes: Uint8Array): string {
  // Chunked rather than a spread: a five-venue route is comfortably big enough
  // to blow the argument limit on String.fromCharCode.
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

type Quote = { kind: "swap" | "transfer"; inAmount: string; venues: string[] };

export function StakeSheet({ pactId, stakeLabel }: { pactId: string; stakeLabel: string }) {
  const router = useRouter();
  const { getAccessToken } = usePrivy();
  const { wallets } = useWallets();
  const { signTransaction } = useSignTransaction();

  const [token, setToken] = useState(MINTS[0]);
  const [priced, setPriced] = useState<{ mint: string; quote: Quote } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const post = useCallback(
    async (body: unknown) => {
      const authToken = await getAccessToken();
      const res = await fetch(`/api/pacts/${pactId}/stake`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(authToken ? { authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify(body),
      });
      return { res, body: await res.json().catch(() => ({})) };
    },
    [pactId, getAccessToken],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { res, body } = await post({ step: "quote", inputMint: token.mint });
      if (cancelled) return;
      if (res.ok) setPriced({ mint: token.mint, quote: body as Quote });
      else setError(typeof body.error === "string" ? body.error : null);
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [token, post]);

  // Derived rather than cleared on every token change: a price for the token
  // that is no longer selected is worse than saying nothing yet.
  const quote = priced?.mint === token.mint ? priced.quote : null;

  async function stake() {
    const wallet = wallets[0];
    if (!wallet) {
      setError("No wallet is connected.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const built = await post({ step: "build", inputMint: token.mint });
      if (!built.res.ok) {
        setError(built.body.error ?? "Could not build that stake.");
        return;
      }

      const { signedTransaction } = await signTransaction({
        transaction: b64ToBytes(built.body.transactionB64),
        wallet,
      });

      const done = await post({
        step: "submit",
        signedTx: bytesToB64(signedTransaction),
        lastValidBlockHeight: built.body.lastValidBlockHeight,
        kind: built.body.kind,
      });

      if (done.res.status === 202) {
        // Already broadcast. Retrying would stake twice, so this stops here and
        // says so -- the signature is in the response for reconciling.
        setError(done.body.error ?? "Sent, but unconfirmed. Do not try again yet.");
        return;
      }
      if (!done.res.ok) {
        setError(done.body.error ?? "That did not go through.");
        return;
      }
      router.refresh();
    } catch {
      setError("That did not go through.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-[22px] border border-hairline bg-panel p-5 shadow-panel">
      <div className="flex items-baseline justify-between gap-4">
        <p className="text-[15px] font-semibold text-ink">{stakeLabel} to join</p>
        <div className="flex gap-1.5">
          {MINTS.map((m) => (
            <button
              key={m.mint}
              type="button"
              onClick={() => setToken(m)}
              className={`rounded-full border px-3 py-1 text-[12px] tracking-[0.08em] transition-colors ${
                m.mint === token.mint
                  ? "border-ink bg-ink text-ground"
                  : "border-hairline text-grey-on-ground hover:border-ink/40"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <p className="figure mt-3 text-[14px] leading-relaxed text-grey-on-ground">
        {quote === null ? (
          "Pricing it."
        ) : quote.kind === "transfer" ? (
          `${amount(quote.inAmount, token.decimals)} USDC, sent straight to the crew's vault.`
        ) : (
          <>
            About {amount(quote.inAmount, token.decimals)} {token.label}, converted to USDC and
            delivered to the crew&rsquo;s vault in one transaction
            {quote.venues.length > 0 && (
              <>
                {" "}
                {/* The route is the point: this is the swap the product begins
                    at the end of, and hiding it would hide the mechanism. */}
                via <span className="text-ink">{quote.venues.join(" → ")}</span>
              </>
            )}
            .
          </>
        )}
      </p>

      {error && (
        <p role="alert" className="mt-3 flex items-start gap-2 text-[13px] leading-relaxed text-ink">
          <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}

      <button
        type="button"
        disabled={busy || quote === null}
        onClick={stake}
        className="mt-4 w-full rounded-full bg-ink py-3 text-[12px] tracking-[0.24em] text-ground uppercase transition-opacity hover:opacity-85 disabled:cursor-not-allowed disabled:bg-transparent disabled:text-grey-on-ground disabled:ring-1 disabled:ring-hairline disabled:hover:opacity-100"
      >
        {busy ? "Staking" : "Stake"}
      </button>

      <p className="mt-3 text-center text-[12px] leading-relaxed text-grey-on-ground">
        You will not need SOL for the fee. That part is covered.
      </p>
    </div>
  );
}
