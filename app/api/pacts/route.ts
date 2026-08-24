import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import { RuleConfigSchema } from "@/lib/rules";
import { createVault } from "@/lib/vault";
import { fetchUsdRate, toUsdcAtomic } from "@/lib/fx";
import { z } from "zod";

const BodySchema = z.object({
  name: z.string().min(1).max(80),
  ruleConfig: RuleConfigSchema,
  stakeAmount: z.number().positive(),
  stakeCurrency: z.string().length(3),
  timezone: z.string().default("Asia/Bangkok"),
  createdByPrivyId: z.string(),
  walletAddress: z.string(),
  displayName: z.string().min(1).max(40),
});

export async function POST(req: NextRequest) {
  const parsed = BodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const b = parsed.data;

  try {
    const usdRate = await fetchUsdRate(b.stakeCurrency);
    const stakeUsdc = toUsdcAtomic(b.stakeAmount, usdRate);
    const vault = createVault();

    const user = await prisma.user.upsert({
      where: { privyId: b.createdByPrivyId },
      update: { walletAddress: b.walletAddress, displayName: b.displayName },
      create: {
        privyId: b.createdByPrivyId,
        walletAddress: b.walletAddress,
        displayName: b.displayName,
      },
    });

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

export async function GET() {
  const pacts = await prisma.pact.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { memberships: { include: { user: true } } },
  });
  return NextResponse.json(
    pacts.map((p) => ({
      id: p.id,
      name: p.name,
      inviteToken: p.inviteToken,
      createdById: p.createdById,
      ruleConfig: p.ruleConfig,
      timezone: p.timezone,
      stakeAmount: p.stakeAmount,
      stakeCurrency: p.stakeCurrency,
      fxRateToUsd: p.fxRateToUsd,
      fxFetchedAt: p.fxFetchedAt,
      stakeUsdc: p.stakeUsdc.toString(),
      vaultAddress: p.vaultAddress,
      status: p.status,
      startsAt: p.startsAt,
      endsAt: p.endsAt,
      createdAt: p.createdAt,
      memberships: p.memberships.map((m) => ({
        id: m.id,
        pactId: m.pactId,
        userId: m.userId,
        status: m.status,
        stakedAt: m.stakedAt,
        stakeTxSig: m.stakeTxSig,
        payoutMint: m.payoutMint,
        payoutTxSig: m.payoutTxSig,
        user: {
          id: m.user.id,
          privyId: m.user.privyId,
          walletAddress: m.user.walletAddress,
          displayName: m.user.displayName,
          createdAt: m.user.createdAt,
        },
      })),
    })),
  );
}
