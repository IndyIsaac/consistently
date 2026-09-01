"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import { useSignTransaction, useWallets } from "@privy-io/react-auth/solana";
import { FlaskConical, TriangleAlert } from "lucide-react";
import { FieldLabel } from "@/components/Panel";
import { Select } from "@/components/Select";
import { PAYOUT_MINTS } from "@/lib/dflow";
import { isTimeout } from "@/lib/utils";

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
  const written = n.toLocaleString("en-US", {
    maximumFractionDigits: decimals === 6 ? 2 : 4,
  });

  /**
   * A quote that rounds away is worse than a long one.
   *
   * Two fraction digits is right for a price and wrong for a small one: a
   * stake under a cent renders "0 USDC, sent straight to the crew's vault" on
   * the screen that asks somebody to hand over money. Whatever it costs, it
   * does not cost nothing, and the figure has to say so.
   */
  if (n > 0 && Number(written.replace(/,/g, "")) === 0) {
    return n.toLocaleString("en-US", { maximumSignificantDigits: 2 });
  }
  return written;
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

// `PAYOUT_MINTS` is declared `as const`, so indexing it for a default value
// narrows to that one element's literal type rather than the union -- this
// names the union so `setPayout` can hold any of the listed mints.
type PayoutMint = (typeof PAYOUT_MINTS)[number];

export function StakeSheet({
  pactId,
  stakeLabel,
  viewerWallet,
}: {
  pactId: string;
  stakeLabel: string;
  /** The address the server has on record. See the note by `wallet` below. */
  viewerWallet: string;
}) {
  const router = useRouter();
  const { getAccessToken } = usePrivy();
  const { wallets } = useWallets();
  const { signTransaction } = useSignTransaction();

  const [token, setToken] = useState(MINTS[0]);
  const [payout, setPayout] = useState<PayoutMint>(PAYOUT_MINTS[0]);
  const [priced, setPriced] = useState<{ mint: string; quote: Quote } | null>(null);
  const [busy, setBusy] = useState(false);
  const rehearsalRefresh = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (rehearsalRefresh.current) clearTimeout(rehearsalRefresh.current);
    },
    [],
  );
  const [error, setError] = useState<string | null>(null);
  const [rehearsed, setRehearsed] = useState(false);

  /**
   * Every request this screen makes, with an upper bound on the wait.
   *
   * Without one, a network that hangs rather than fails leaves this sheet in
   * whatever state it was mid-way through: "Pricing it." with a dead button, or
   * "Staking" with a disabled one. Neither has a retry and neither says
   * anything, so a reload is the only way out -- of the screen that asks for
   * money.
   *
   * The submit step gets a longer one on purpose. The server bounds its own
   * confirmation at ninety seconds (lib/solana.ts), and a client that gave up
   * first would leave a member who cannot tell whether their stake went
   * through -- which is exactly how somebody pays twice. This waits for the
   * server to finish being sure, then stops.
   */
  const post = useCallback(
    async (body: unknown, timeoutMs = 20_000) => {
      const authToken = await getAccessToken();
      const res = await fetch(`/api/pacts/${pactId}/stake`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(authToken ? { authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
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
      if (res.ok) {
        setPriced({ mint: token.mint, quote: body as Quote });
        setError(null);
        return;
      }
      /**
       * Never `null` on a failure. A 502 from a proxy is not JSON, so `body` is
       * `{}` and this used to set the error to nothing at all -- leaving the
       * copy on "Pricing it." and the Stake button greyed out with no sentence
       * anywhere on the screen and no way to try again.
       */
      setError(
        typeof body.error === "string" ? body.error : "Could not price that. Try again in a moment.",
      );
    })().catch((e) => {
      if (cancelled) return;
      // Swallowed entirely before this, which is the same dead screen arrived
      // at from the other direction -- a hung network rather than a refused one.
      console.error("stake quote failed:", e);
      setError(
        isTimeout(e)
          ? "That is taking too long. Check your connection and try again."
          : "Could not price that. Try again in a moment.",
      );
    });
    return () => {
      cancelled = true;
    };
  }, [token, post]);

  // Derived rather than cleared on every token change: a price for the token
  // that is no longer selected is worse than saying nothing yet.
  const quote = priced?.mint === token.mint ? priced.quote : null;

  async function stake() {
    /**
     * Not `wallets[0]`. A member who connected Phantom and also has an embedded
     * wallet has two, in no guaranteed order -- and the stake has to be signed
     * by the one the server wrote down, because that is the address the pact's
     * membership is keyed to. Signing with the other produces a transaction
     * that succeeds on chain and belongs to nobody.
     */
    const wallet = wallets.find((w) => w.address === viewerWallet);
    if (!wallet) {
      setError(
        wallets.length > 0
          ? "This crew is expecting a different wallet. Connect the one you joined with."
          : "No wallet is connected.",
      );
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

      const done = await post(
        {
          step: "submit",
          signedTx: bytesToB64(signedTransaction),
          lastValidBlockHeight: built.body.lastValidBlockHeight,
          kind: built.body.kind,
          payoutMint: payout.mint,
        },
        // Longer than the server's own ninety-second confirmation, so this
        // waits for it to finish being sure rather than giving up first.
        120_000,
      );

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
      // A rehearsal must never be mistaken for money moving. The server says
      // which it was; the sheet says so before it refreshes.
      if (done.body.dryRun) {
        setRehearsed(true);
        // Cleared on unmount: a refresh two and a half seconds after somebody
        // left this sheet is a page they are no longer looking at.
        rehearsalRefresh.current = setTimeout(() => router.refresh(), 2_500);
        return;
      }
      router.refresh();
    } catch (e) {
      /**
       * A timeout is not a refusal, and must not be described as one.
       *
       * "That did not go through" invites a second attempt, and by this point
       * the transaction may well have been broadcast -- the same hazard the 202
       * branch above exists to head off. A stake paid twice is not returned by
       * settling: each winner gets one principal back and the duplicate is
       * split among the crew as forfeited money.
       */
      console.error("stake failed:", e);
      setError(
        isTimeout(e)
          ? "We lost the connection before this was confirmed. Check the pact before trying again."
          : "That did not go through.",
      );
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

      <div className="mt-4">
        <FieldLabel>Paid out in</FieldLabel>
        <Select
          className="mt-2"
          value={payout.mint}
          onChange={(e) =>
            setPayout(PAYOUT_MINTS.find((m) => m.mint === e.target.value) ?? PAYOUT_MINTS[0])
          }
        >
          {PAYOUT_MINTS.map((m) => (
            <option key={m.mint} value={m.mint}>{m.label}</option>
          ))}
        </Select>
        <p className="mt-2 text-[13px] text-grey-on-ground">
          If the crew forfeits to you, this is what arrives.
        </p>
      </div>

      {rehearsed && (
        <p
          role="status"
          className="mt-3 flex items-start gap-2 rounded-2xl bg-surface px-3.5 py-2.5 text-[13px] leading-relaxed text-ink"
        >
          <FlaskConical className="mt-px size-3.5 shrink-0" aria-hidden="true" />
          <span>
            <b className="font-semibold">Rehearsal.</b> Both signatures checked out against the
            live network and the route would have gone through. Nothing moved &mdash; unset{" "}
            <code className="text-[12px]">STAKE_DRY_RUN</code> to stake for real.
          </span>
        </p>
      )}

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
