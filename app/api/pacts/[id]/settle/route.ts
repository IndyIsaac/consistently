import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, UnauthorizedError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { periodDayKeys } from "@/lib/pact-view";
import { RuleConfigSchema } from "@/lib/rules";
import { settlePact } from "@/lib/settlement";
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
 * ------------------------------------------------------------------------- */

const BodySchema = z.object({ periodKey: z.string().min(1).optional() });

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
    return NextResponse.json({ error: "periodKey must be a string" }, { status: 400 });
  }

  try {
    const pact = await prisma.pact.findUniqueOrThrow({ where: { id } });
    const rule = RuleConfigSchema.parse(pact.ruleConfig);

    // Defaults to the period the crew is currently in, which is what "settle
    // this one" means from inside the channel.
    const periodKey =
      parsed.data.periodKey ?? periodDayKeys(rule, pact.timezone, new Date())[0];

    return NextResponse.json(await settlePact(id, periodKey));
  } catch (e) {
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
