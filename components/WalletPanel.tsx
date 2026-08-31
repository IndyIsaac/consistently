"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { DashedRule, FieldLabel } from "@/components/Panel";
import { SignOut } from "@/components/SignOut";
import { formatMoney } from "@/lib/money";

/* ---------------------------------------------------------------------------
 * Where the money is.
 *
 * Two figures, and they are different in kind. What is in the wallet is the
 * member's and can leave whenever they like. What is in the crews is not: it
 * is staked, it is in a vault, and the only way it comes back is by keeping
 * the rule. Showing them as one total would flatter the balance and hide the
 * commitment, which is the opposite of what this product is for.
 *
 * Colour stays off both of them. DESIGN.md reserves red and green for money
 * that has already moved -- what you lost, what you won. A balance has not
 * moved and a stake has not resolved, so neither has earned a colour yet.
 * ------------------------------------------------------------------------- */

type Allocation = {
  pactId: string;
  name: string;
  stakeAmount: number;
  stakeCurrency: string;
  status: "invited" | "staked" | "passed" | "failed" | "left";
};

export function WalletPanel({
  address,
  allocations,
  currency,
  holdings,
}: {
  address: string;
  allocations: Allocation[];
  currency: string;
  /**
   * Read on the server, where the page was already awaiting a database query.
   * Fetching it from here instead would mean an effect whose only job is to
   * set state on mount, which React 19 rightly objects to and which would show
   * the reader a blank figure first for no benefit.
   */
  holdings: { sol: number; usdc: number } | null;
}) {
  const [copied, setCopied] = useState(false);

  const staked = allocations.filter((a) => a.status === "staked");
  const owing = allocations.filter((a) => a.status === "invited");

  async function copy() {
    await navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2_000);
  }

  return (
    <>
      <FieldLabel>Your money</FieldLabel>

      <div className="mt-4 grid grid-cols-2 gap-6">
        <div>
          <p className="text-[13px] text-grey-on-ground">In your wallet</p>
          {holdings === null ? (
            <p className="mt-1.5 text-[15px] text-grey-on-ground">Could not reach Solana.</p>
          ) : (
            <>
              <p className="figure mt-1.5 text-[clamp(1.5rem,5vw,2rem)] leading-none font-extrabold text-ink">
                {holdings.sol.toLocaleString("en-US", { maximumFractionDigits: 4 })}
                <span className="ml-1.5 text-[13px] font-normal text-grey-on-ground">SOL</span>
              </p>
              {holdings.usdc > 0 && (
                <p className="figure mt-1.5 text-[14px] text-grey-on-ground">
                  and {holdings.usdc.toLocaleString("en-US", { maximumFractionDigits: 2 })} USDC
                </p>
              )}
            </>
          )}
        </div>

        <div>
          <p className="text-[13px] text-grey-on-ground">Staked in crews</p>
          <p className="figure mt-1.5 text-[clamp(1.5rem,5vw,2rem)] leading-none font-extrabold text-ink">
            {formatMoney(
              staked.reduce((sum, a) => sum + a.stakeAmount, 0),
              currency,
            )}
          </p>
          <p className="mt-1.5 text-[14px] text-grey-on-ground">
            {staked.length === 0
              ? "Nothing riding yet."
              : `across ${staked.length} ${staked.length === 1 ? "crew" : "crews"}`}
          </p>
        </div>
      </div>

      {allocations.length > 0 && (
        <>
          <DashedRule className="mt-7" />
          <ul className="mt-2 divide-y divide-hairline">
            {allocations.map((a) => (
              <li key={a.pactId} className="flex items-baseline justify-between gap-4 py-3">
                <span className="min-w-0 truncate text-[14px] text-ink">{a.name}</span>
                <span className="flex shrink-0 items-baseline gap-3">
                  <span className="text-[13px] text-grey-on-ground">
                    {a.status === "staked"
                      ? "in the vault"
                      : a.status === "invited"
                        ? "not paid"
                        : a.status}
                  </span>
                  <span className="figure w-[5.5rem] text-right text-[14px] font-semibold text-ink">
                    {formatMoney(a.stakeAmount, a.stakeCurrency)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      {owing.length > 0 && (
        <p className="mt-4 text-[14px] leading-relaxed text-grey-on-ground">
          {formatMoney(
            owing.reduce((sum, a) => sum + a.stakeAmount, 0),
            currency,
          )}{" "}
          still to put in before {owing.length === 1 ? "that crew" : "those crews"} can start.
        </p>
      )}

      <DashedRule className="mt-7" />

      <p className="figure mt-5 text-[13px] leading-relaxed break-all text-grey-on-ground select-all">
        {address}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-2 rounded-full border border-hairline px-5 py-2.5 text-[13px] text-ink transition-colors hover:border-ink/40 hover:bg-surface"
        >
          {copied ? (
            <Check className="size-3.5" aria-hidden="true" />
          ) : (
            <Copy className="size-3.5" aria-hidden="true" />
          )}
          {copied ? "Copied" : "Copy address"}
        </button>
        <SignOut />
      </div>
    </>
  );
}
