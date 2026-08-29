import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, UnauthorizedError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { periodDayKeys } from "@/lib/pact-view";
import { RuleConfigSchema } from "@/lib/rules";
import { settlePact, SettlementError } from "@/lib/settlement";
import { SubmitError } from "@/lib/solana";

/* ---------------------------------------------------------------------------
 * POST /api/pacts/[id]/settle
 *
 * There is no scheduler. A period is settled when someone in the crew says the
 * period is over -- which is honest about what this build is, and which the
 * demo drives from the channel.
 *
 * Only members can call it, and it is idempotent by the unique index on
 * (pactId, periodKey): a second call resumes an interrupted run rather than
 * paying anyone twice.
 *
 * `force` closes a period that has not ended. It is here because there is no
 * scheduler and no way to wait a week in front of a room, and it is a boolean
 * in the body rather than a server flag because the member has to be the one
 * asking: see the note above the guard in lib/settlement.ts for what it costs.
 * ------------------------------------------------------------------------- */

const BodySchema = z.object({
  periodKey: z.string().min(1).optional(),
  /**
   * Strictly a boolean, and absent means false. Coercion here would make
   * `"false"`, `"no"` and `0` -- every shape a careless caller sends -- into a
   * forced settlement of a live pact.
   */
  force: z.boolean().optional(),
});

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

  const membership = await prisma.membership.findUnique({
    where: { pactId_userId: { pactId: id, userId: user.id } },
  });
  if (!membership || membership.status === "left") {
    return NextResponse.json({ error: "You are not in this crew." }, { status: 403 });
  }

  const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "periodKey must be a string and force a boolean" },
      { status: 400 },
    );
  }

  try {
    const pact = await prisma.pact.findUniqueOrThrow({ where: { id } });
    const rule = RuleConfigSchema.parse(pact.ruleConfig);

    // Defaults to the period the crew is currently in, which is what "settle
    // this one" means from inside the channel.
    const periodKey =
      parsed.data.periodKey ?? periodDayKeys(rule, pact.timezone, new Date())[0];

    return NextResponse.json(
      await settlePact(id, periodKey, new Date(), { force: parsed.data.force === true }),
    );
  } catch (e) {
    /**
     * A refusal the member is meant to read and act on -- "The week is not
     * over. 3 days left." -- and not a fault. As a 500 the channel replaced
     * that sentence with "Settlement did not finish", which is both wrong and
     * unactionable: nothing was wrong, and the thing to do about it is wait.
     */
    if (e instanceof SettlementError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }

    if (e instanceof SubmitError) {
      // Part-way through, and already broadcast. Calling again resumes: every
      // payout that carries a signature is skipped.
      return NextResponse.json(
        { error: "A payout is in flight. Run it again to pick up where it stopped.", signature: e.signature },
        { status: 202 },
      );
    }
    console.error("settle failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Settlement did not finish." }, { status: 500 });
  }
}
