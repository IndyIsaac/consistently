export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const WSOL_MINT = "So11111111111111111111111111111111111111112";

/** The tokens a winner may be paid in. An allowlist, not free text: settlement
 *  builds a real DFlow order per winner, and an unroutable mint there is a
 *  payout that silently never lands. */
export const PAYOUT_MINTS = [
  { mint: USDC_MINT, label: "USDC", decimals: 6 },
  { mint: WSOL_MINT, label: "SOL", decimals: 9 },
] as const;

export function isSupportedPayoutMint(mint: string): boolean {
  return PAYOUT_MINTS.some((m) => m.mint === mint);
}

const BASE_URL = process.env.DFLOW_TRADE_API_URL ?? "https://dev-quote-api.dflow.net";

export type RouteLeg = {
  venue: string;
  marketKey: string;
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  inputMintDecimals: number;
  outputMintDecimals: number;
};

export type OrderResponse = {
  inputMint: string;
  inAmount: string;
  outputMint: string;
  outAmount: string;
  otherAmountThreshold: string;
  minOutAmount: string;
  slippageBps: number;
  priceImpactPct: string;
  contextSlot: number;
  executionMode: "sync" | "async";
  routePlan?: RouteLeg[];
  platformFee: { amount: string; feeBps: number; mode: string } | null;
  transaction?: string;
  lastValidBlockHeight?: number;
  computeUnitLimit?: number;
  prioritizationFeeLamports?: number;
};

export type OrderParams = {
  inputMint: string;
  outputMint: string;
  amount: bigint;
  userPublicKey: string;
  destinationWallet?: string;
  sponsor?: string;
  sponsorExec?: boolean;
  slippageBps?: number | "auto";
  platformFeeBps?: number;
  feeAccount?: string;
};

export class DFlowError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(`DFlow ${status} ${code}: ${message}`);
    this.name = "DFlowError";
  }
}

// Shared shape for the underlying /order call: everything OrderParams has,
// but userPublicKey is optional so getQuote (quote-only, no wallet) can share it.
type CallParams = Omit<OrderParams, "userPublicKey"> & { userPublicKey?: string };

/** Long enough for a real route to be found, short enough to still be an app. */
const ORDER_TIMEOUT_MS = 12_000;

async function callOrder(params: CallParams): Promise<OrderResponse> {
  const q = new URLSearchParams({
    inputMint: params.inputMint,
    outputMint: params.outputMint,
    amount: params.amount.toString(),
    slippageBps: String(params.slippageBps ?? "auto"),
    dynamicComputeUnitLimit: "true",
  });

  if (params.userPublicKey) q.set("userPublicKey", params.userPublicKey);
  if (params.destinationWallet) q.set("destinationWallet", params.destinationWallet);
  if (params.sponsor) {
    q.set("sponsor", params.sponsor);
    q.set("sponsorExec", String(params.sponsorExec ?? false));
  }
  if (params.platformFeeBps && params.feeAccount) {
    q.set("platformFeeBps", String(params.platformFeeBps));
    q.set("platformFeeMode", "outputMint");
    q.set("feeAccount", params.feeAccount);
  }

  const headers: Record<string, string> = {};
  if (process.env.DFLOW_API_KEY) headers["x-api-key"] = process.env.DFLOW_API_KEY;

  /**
   * Bounded, because at the other end of this is a member watching a button.
   *
   * Every quote and every stake comes through here. With no signal a router
   * that was slow rather than down held the route's connection open with no
   * upper bound, and the stake sheet showed nothing at all -- no price, no
   * refusal, no end to it. A DFlowError is something the UI already knows how
   * to say.
   */
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}/order?${q.toString()}`, {
      headers,
      signal: AbortSignal.timeout(ORDER_TIMEOUT_MS),
    });
  } catch (e) {
    throw new DFlowError(
      "unreachable",
      e instanceof Error && e.name === "TimeoutError"
        ? "The router did not answer in time. Try again."
        : "Could not reach the router.",
      504,
    );
  }

  const text = await res.text();

  let body: any;
  try {
    body = JSON.parse(text);
  } catch {
    // Non-JSON body (e.g. a gateway's plain-text/HTML 429, 502, 504) — never
    // let a raw SyntaxError escape past the DFlowError contract.
    throw new DFlowError("unknown", text || res.statusText || "request failed", res.status);
  }

  if (!res.ok) {
    throw new DFlowError(body?.code ?? "unknown", body?.msg ?? "request failed", res.status);
  }
  return body as OrderResponse;
}

export function getQuote(params: {
  inputMint: string;
  outputMint: string;
  amount: bigint;
  slippageBps?: number | "auto";
}): Promise<OrderResponse> {
  return callOrder(params);
}

export function buildOrder(params: OrderParams): Promise<OrderResponse> {
  return callOrder(params);
}
