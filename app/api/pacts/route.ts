import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { requireUser, UnauthorizedError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { RuleConfigSchema } from "@/lib/rules";
import { createVault } from "@/lib/vault";
import { fetchUsdRate, toUsdcAtomic } from "@/lib/fx";
import { z } from "zod";

/**
 * The caller is read from their verified Privy token, not from the body. A pact
 * mints a vault and locks an exchange rate, and neither should happen at the
 * word of an unauthenticated request.
 */
const BodySchema = z.object({
  name: z.string().min(1).max(80),
  ruleConfig: RuleConfigSchema,
  stakeAmount: z.number().positive(),
  stakeCurrency: z.string().length(3),
  timezone: z.string().default("Asia/Bangkok"),
});

export async function POST(req: NextRequest) {
  let user;
  try {
    user = await requireUser(req);
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: 401 });
    }
    throw e;
  }

  const parsed = BodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const b = parsed.data;

  try {
    const usdRate = await fetchUsdRate(b.stakeCurrency);
    const stakeUsdc = toUsdcAtomic(b.stakeAmount, usdRate);
    const vault = createVault();

    const pact = await prisma.pact.create({
      data: {
        name: b.name,
        inviteToken: randomBytes(9).toString("base64url"),
        createdById: user.id,
        ruleConfig: b.ruleConfig,
        timezone: b.timezone,
        stakeAmount: b.stakeAmount.toFixed(2),
        stakeCurrency: b.stakeCurrency.toUpperCase(),
        fxRateToUsd: usdRate.toFixed(8),
        fxFetchedAt: new Date(),
        stakeUsdc,
        vaultAddress: vault.publicKey,
        vaultSecretEnc: vault.secretEnc,
        memberships: { create: { userId: user.id } },
      },
    });

    return NextResponse.json({
      id: pact.id,
      inviteToken: pact.inviteToken,
      vaultAddress: pact.vaultAddress,
      stakeUsdc: pact.stakeUsdc.toString(),
    });
  } catch (err) {
    console.error("POST /api/pacts failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Failed to create pact" }, { status: 500 });
  }
}

/**
 * The caller's own pacts.
 *
 * This used to return the latest fifty pacts in the system to anyone who
 * asked, including every member's Privy id and wallet address and every pact's
 * vault address. That is not the disclosed "requests name a wallet and are
 * believed" limitation -- it is a different thing, and it is closed here.
 *
 * `vaultSecretEnc` has never left the server and does not now; `vaultAddress`
 * is public by nature -- it is where a member sends their stake.
 */
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

  const pacts = await prisma.pact.findMany({
    where: { memberships: { some: { userId: user.id } } },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { memberships: { include: { user: true } } },
  });

  return NextResponse.json(
    pacts.map((p) => ({
      id: p.id,
      name: p.name,
      inviteToken: p.inviteToken,
      ruleConfig: p.ruleConfig,
      timezone: p.timezone,
      stakeAmount: p.stakeAmount,
      stakeCurrency: p.stakeCurrency,
      stakeUsdc: p.stakeUsdc.toString(),
      vaultAddress: p.vaultAddress,
      status: p.status,
      startsAt: p.startsAt,
      endsAt: p.endsAt,
      createdAt: p.createdAt,
      memberships: p.memberships.map((m) => ({
        id: m.id,
        userId: m.userId,
        status: m.status,
        stakedAt: m.stakedAt,
        payoutMint: m.payoutMint,
        // The crew's names, and nothing that identifies them off this platform.
        user: { id: m.user.id, displayName: m.user.displayName },
      })),
    })),
  );
}
