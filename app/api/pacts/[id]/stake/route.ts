import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, UnauthorizedError } from "@/lib/auth";
import { DFlowError } from "@/lib/dflow";
import { SubmitError } from "@/lib/solana";
import {
  buildStakeTransaction,
  finaliseStake,
  reopenForNextPeriod,
  StakeGuardError,
} from "@/lib/stake";

/* ---------------------------------------------------------------------------
 * POST /api/pacts/[id]/stake
 *
 * Three steps, because the member's key is in their browser and the sponsor's
 * is here:
 *   build   -- price it, size the input leg, return unsigned bytes
 *   submit  -- check it is ours, add the sponsor signature, put it on chain
 *   reopen  -- put a settled member back into funding for the next period
 *
 * The caller is read from their verified token, never from the body: this route
 * spends the sponsor's SOL and writes a membership, and both should have a name
 * attached that the request cannot choose for itself.
 * ------------------------------------------------------------------------- */

const BodySchema = z.discriminatedUnion("step", [
  z.object({ step: z.literal("build"), inputMint: z.string().min(32).max(44) }),
  z.object({
    step: z.literal("submit"),
    signedTx: z.string().min(1),
    lastValidBlockHeight: z.number().int().positive(),
    kind: z.enum(["swap", "transfer"]),
  }),
  z.object({ step: z.literal("reopen") }),
]);

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  let user;
  try {
    user = await requireUser(req);
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: 401 });
    }
    throw e;
  }

  const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "step must be build, submit or reopen" }, { status: 400 });
  }
  const body = parsed.data;

  try {
    if (body.step === "build") {
      return NextResponse.json(
        await buildStakeTransaction({
          pactId: id,
          userWallet: user.walletAddress,
          inputMint: body.inputMint,
        }),
      );
    }

    if (body.step === "submit") {
      return NextResponse.json(
        await finaliseStake({
          pactId: id,
          userWallet: user.walletAddress,
          signedTxB64: body.signedTx,
          lastValidBlockHeight: body.lastValidBlockHeight,
          kind: body.kind,
        }),
      );
    }

    return NextResponse.json(
      await reopenForNextPeriod({ pactId: id, userWallet: user.walletAddress }),
    );
  } catch (e) {
    // A refusal the member is meant to read and act on.
    if (e instanceof StakeGuardError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }

    /**
     * Already broadcast. The caller must NOT retry: the transaction may still
     * land, and re-running the stake would put the money in twice. The
     * signature goes back so it can be checked against the chain instead.
     */
    if (e instanceof SubmitError) {
      return NextResponse.json(
        {
          error: "Sent, but we lost sight of it. Check before trying again.",
          signature: e.signature,
        },
        { status: 202 },
      );
    }

    if (e instanceof DFlowError) {
      return NextResponse.json({ error: "Could not price that route." }, { status: 502 });
    }

    console.error("stake failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "That did not go through." }, { status: 500 });
  }
}
