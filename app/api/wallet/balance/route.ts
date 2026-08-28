import { NextRequest, NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { requireUser, UnauthorizedError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { DRY_RUN, getConnection } from "@/lib/solana";

/* ---------------------------------------------------------------------------
 * GET /api/wallet/balance -- the only thing that opens the gate.
 *
 * A wallet counts as funded when it holds anything at all: native SOL, or any
 * SPL token. Checking lamports alone would leave out the commonest case there
 * is -- somebody sending USDC from an exchange, whose wallet has a token
 * balance and zero SOL. They can still stake, because the sponsor pays the fee.
 *
 * The result is stamped on the user row rather than kept in a cookie. Funding
 * is a one-way door, so once `walletFundedAt` is set nothing asks the RPC about
 * this account again -- one balance call per person, for the life of the
 * account, and it survives them switching device.
 * ------------------------------------------------------------------------- */

export async function GET(req: NextRequest) {
  let user;
  try {
    user = await requireUser(req);
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: 401 });
    }
    throw e;
  }

  if (user.walletFundedAt) {
    return NextResponse.json({ funded: true, lamports: null, tokens: null, rehearsal: DRY_RUN });
  }

  /**
   * A gate that blocks a rehearsal contradicts what STAKE_DRY_RUN is for: the
   * point of that flag is to walk the whole product without money, and the
   * first wall is a screen demanding some.
   *
   * So under the flag the screen still appears -- it is a demo beat and worth
   * seeing -- but offers a way through, clearly labelled. `?rehearse=1` is what
   * that button calls; a real deployment never sets the flag, so the parameter
   * does nothing there.
   */
  if (DRY_RUN && req.nextUrl.searchParams.get("rehearse") === "1") {
    await prisma.user.update({
      where: { id: user.id },
      data: { walletFundedAt: new Date() },
    });
    return NextResponse.json({ funded: true, lamports: 0, tokens: 0, rehearsal: true });
  }

  let owner: PublicKey;
  try {
    owner = new PublicKey(user.walletAddress);
  } catch {
    return NextResponse.json({ error: "This account has no usable wallet." }, { status: 422 });
  }

  const connection = getConnection();

  let lamports: number;
  let tokens: number;
  try {
    // Both token programs: a Token-2022 mint is invisible to a TOKEN_PROGRAM_ID
    // query, and somebody funded only in one would sit at the gate forever.
    const [sol, classic, token2022] = await Promise.all([
      connection.getBalance(owner),
      connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID }),
      connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_2022_PROGRAM_ID }),
    ]);

    lamports = sol;
    tokens = [...classic.value, ...token2022.value].filter(
      (a) => Number(a.account.data.parsed?.info?.tokenAmount?.amount ?? 0) > 0,
    ).length;
  } catch {
    // An RPC that is rate-limiting or down must not read as "not funded" --
    // the caller polls, and a wrong negative just means one more poll.
    return NextResponse.json({ error: "Could not reach Solana. Trying again." }, { status: 503 });
  }

  const funded = lamports > 0 || tokens > 0;
  if (funded) {
    await prisma.user.update({
      where: { id: user.id },
      data: { walletFundedAt: new Date() },
    });
  }

  return NextResponse.json({ funded, lamports, tokens, rehearsal: DRY_RUN });
}
