# Pact Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a group commitment app where friends stake real money on a shared rule, and the stakes of whoever breaks it are automatically redistributed to whoever kept it — settled through DFlow.

**Architecture:** Next.js App Router monolith on Vercel. Privy supplies email-login embedded Solana wallets. Each pact owns a server-held vault wallet. Members stake any Solana token; DFlow `/order` converts it to USDC and delivers it straight to the vault via `destinationWallet`, gas paid by a sponsor wallet. At settlement the vault swaps USDC out to each winner's chosen token. All rule evaluation is pure functions over a JSON rule config.

**Tech Stack:** TypeScript, Next.js 15 (App Router), Tailwind, Prisma + Postgres (Neon), Privy (`@privy-io/react-auth`), `@solana/web3.js`, Vercel Blob, Anthropic SDK, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-24-pact-design.md`

## Global Constraints

- **Deadline: 2026-08-31, 23:59 ICT.** Every task must leave the app runnable.
- **Solana mainnet only.** DFlow's dev endpoint quotes mainnet; there is no devnet path.
- **DFlow base URL:** `https://dev-quote-api.dflow.net`. No API key. Rate limit 60 req/min.
- **USDC mint:** `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` (6 decimals).
- **WSOL mint:** `So11111111111111111111111111111111111111112` (9 decimals).
- **All token amounts are `bigint` in atomic units.** Never `number`. Never floats.
- **Anthropic model:** `claude-opus-5`. Structured output via `client.messages.parse()` + `zodOutputFormat`.
- **CORS on DFlow dev is open** (`access-control-allow-origin: *`) — verified 2026-08-24. No proxy needed, but all DFlow calls still go through our API routes so the sponsor can co-sign.
- **Never commit `.env`.** Vault and sponsor secret keys live in env only.
- Run `npx vitest run` before every commit. All tests must pass.

---

## File Structure

| Path | Responsibility |
|---|---|
| `lib/dflow.ts` | DFlow Trading API client. Quote, build order, sponsored order. Pure HTTP. |
| `lib/solana.ts` | Connection, transaction deserialise/sign/submit, SPL transfer builder. |
| `lib/vault.ts` | Vault keypair generation, encryption at rest, loading for signing. |
| `lib/rules.ts` | Rule config schema (Zod), session validity, period evaluation. Pure. |
| `lib/stats.ts` | Streaks, completion counts, leaderboard. Pure. |
| `lib/settlement.ts` | Who failed, who passed, how the pot splits. Pure. |
| `lib/fx.ts` | Fiat rate lookup, locked at pact creation. |
| `lib/db.ts` | Prisma client singleton. |
| `prisma/schema.prisma` | Data model. |
| `app/api/pacts/route.ts` | Create / list pacts. |
| `app/api/pacts/[id]/stake/route.ts` | Build the stake transaction; co-sign and submit. |
| `app/api/pacts/[id]/sessions/route.ts` | Check in / check out. |
| `app/api/pacts/[id]/settle/route.ts` | Run settlement. |
| `app/api/pacts/[id]/exemptions/route.ts` | Request and vote on exemptions. |
| `app/api/rules/draft/route.ts` | Natural language → rule config. |
| `app/(app)/pacts/[id]/page.tsx` | Pact view: feed, stats, check-in button. |
| `app/(app)/new/page.tsx` | Pact creation. |
| `app/join/[token]/page.tsx` | Invite landing + stake. |
| `components/` | Feed, CheckInCamera, StatsPanel, RuleEditor, ExemptionVote. |

---

## Phase 0 — Serial foundation (Tasks 1–5)

**Do not parallelise these.** Every later task depends on the types and the proven transaction path. Task 5 is the highest-risk unknown in the project and must be completed by a human-reviewed run against mainnet before any fan-out.

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `tailwind.config.ts`, `app/layout.tsx`, `app/page.tsx`, `vitest.config.ts`, `.env.example`, `.gitignore`
- Test: `lib/__tests__/smoke.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: a running Next.js app, `npx vitest run` green, env var names fixed for all later tasks

- [ ] **Step 1: Scaffold Next.js**

```bash
npx create-next-app@latest . --typescript --tailwind --app --eslint --src-dir=false --import-alias="@/*" --use-npm --yes
```

- [ ] **Step 2: Install dependencies**

```bash
npm install @privy-io/react-auth @solana/web3.js @solana/spl-token bs58 @prisma/client zod @anthropic-ai/sdk @vercel/blob
npm install -D prisma vitest @vitejs/plugin-react vite-tsconfig-paths dotenv
```

- [ ] **Step 3: Create `vitest.config.ts`**

```typescript
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    setupFiles: ["dotenv/config"],
    testTimeout: 30_000,
  },
});
```

- [ ] **Step 4: Write `.env.example`**

```bash
DATABASE_URL="postgresql://user:pass@host/db?sslmode=require"
NEXT_PUBLIC_PRIVY_APP_ID=""
PRIVY_APP_SECRET=""
SOLANA_RPC_URL="https://api.mainnet-beta.solana.com"
DFLOW_TRADE_API_URL="https://dev-quote-api.dflow.net"
DFLOW_API_KEY=""
SPONSOR_SECRET_KEY=""
VAULT_ENCRYPTION_KEY=""
PLATFORM_FEE_BPS="0"
PLATFORM_FEE_ACCOUNT=""
ANTHROPIC_API_KEY=""
BLOB_READ_WRITE_TOKEN=""
```

- [ ] **Step 5: Write the smoke test**

```typescript
// lib/__tests__/smoke.test.ts
import { describe, it, expect } from "vitest";

describe("scaffold", () => {
  it("runs tests", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 6: Run it**

Run: `npx vitest run`
Expected: 1 passed

- [ ] **Step 7: Confirm the dev server boots**

Run: `npm run dev`
Expected: server listening on :3000, `/` renders without error. Stop it.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: scaffold next.js app with vitest"
```

---

### Task 2: DFlow client

**Files:**
- Create: `lib/dflow.ts`
- Test: `lib/__tests__/dflow.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `type OrderResponse = { inputMint: string; inAmount: string; outputMint: string; outAmount: string; otherAmountThreshold: string; minOutAmount: string; slippageBps: number; priceImpactPct: string; contextSlot: number; executionMode: "sync" | "async"; routePlan?: RouteLeg[]; platformFee: { amount: string; feeBps: number; mode: string } | null; transaction?: string; lastValidBlockHeight?: number; computeUnitLimit?: number; prioritizationFeeLamports?: number }`
  - `type RouteLeg = { venue: string; marketKey: string; inputMint: string; outputMint: string; inAmount: string; outAmount: string; inputMintDecimals: number; outputMintDecimals: number }`
  - `getQuote(params: { inputMint: string; outputMint: string; amount: bigint; slippageBps?: number | "auto" }): Promise<OrderResponse>`
  - `buildOrder(params: OrderParams): Promise<OrderResponse>` where
    `type OrderParams = { inputMint: string; outputMint: string; amount: bigint; userPublicKey: string; destinationWallet?: string; sponsor?: string; sponsorExec?: boolean; slippageBps?: number | "auto"; platformFeeBps?: number; feeAccount?: string }`
  - `USDC_MINT`, `WSOL_MINT` constants

- [ ] **Step 1: Write the failing test**

```typescript
// lib/__tests__/dflow.test.ts
import { describe, it, expect } from "vitest";
import { getQuote, buildOrder, USDC_MINT, WSOL_MINT } from "@/lib/dflow";

describe("dflow client", () => {
  it("quotes SOL to USDC against mainnet liquidity", async () => {
    const q = await getQuote({
      inputMint: WSOL_MINT,
      outputMint: USDC_MINT,
      amount: 1_000_000_000n,
      slippageBps: 50,
    });

    expect(q.inputMint).toBe(WSOL_MINT);
    expect(q.outputMint).toBe(USDC_MINT);
    expect(BigInt(q.outAmount)).toBeGreaterThan(0n);
    expect(q.routePlan?.length).toBeGreaterThan(0);
    expect(q.transaction).toBeUndefined();
  });

  it("returns a signable transaction when given a user public key", async () => {
    const o = await buildOrder({
      inputMint: WSOL_MINT,
      outputMint: USDC_MINT,
      amount: 10_000_000n,
      userPublicKey: "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9",
      slippageBps: 50,
    });

    expect(typeof o.transaction).toBe("string");
    expect(o.transaction!.length).toBeGreaterThan(100);
    expect(o.lastValidBlockHeight).toBeGreaterThan(0);
  });

  it("throws a readable error for an impossible route", async () => {
    await expect(
      getQuote({
        inputMint: USDC_MINT,
        outputMint: USDC_MINT,
        amount: 1_000_000n,
      }),
    ).rejects.toThrow(/dflow/i);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run lib/__tests__/dflow.test.ts`
Expected: FAIL — cannot resolve `@/lib/dflow`

- [ ] **Step 3: Implement `lib/dflow.ts`**

```typescript
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const WSOL_MINT = "So11111111111111111111111111111111111111112";

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
  userPublicKey?: string;
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

async function callOrder(params: OrderParams): Promise<OrderResponse> {
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

  const res = await fetch(`${BASE_URL}/order?${q.toString()}`, { headers });
  const body = await res.json();

  if (!res.ok) {
    throw new DFlowError(body?.code ?? "unknown", body?.msg ?? "request failed", res.status);
  }
  return body as OrderResponse;
}

export function getQuote(
  params: Pick<OrderParams, "inputMint" | "outputMint" | "amount" | "slippageBps">,
): Promise<OrderResponse> {
  return callOrder(params);
}

export function buildOrder(
  params: OrderParams & { userPublicKey: string },
): Promise<OrderResponse> {
  return callOrder(params);
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run lib/__tests__/dflow.test.ts`
Expected: 3 passed. If the third fails because same-mint returns 200, change the assertion to match the actual error code observed and note it in a comment.

- [ ] **Step 5: Commit**

```bash
git add lib/dflow.ts lib/__tests__/dflow.test.ts
git commit -m "feat: dflow trading api client with live mainnet tests"
```

---

### Task 3: Rule engine

**Files:**
- Create: `lib/rules.ts`
- Test: `lib/__tests__/rules.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `RuleConfigSchema` (Zod) and `type RuleConfig = z.infer<typeof RuleConfigSchema>`
  - `type SessionRecord = { startedAt: Date; endedAt: Date | null }`
  - `dayKeyFor(startedAt: Date, timezone: string): string` — `YYYY-MM-DD`, keyed to the day the session **started**
  - `isValidSession(session: SessionRecord, rule: RuleConfig, timezone: string): boolean`
  - `countValidDays(sessions: SessionRecord[], rule: RuleConfig, timezone: string): number`
  - `hasFailed(sessions: SessionRecord[], rule: RuleConfig, timezone: string): boolean`

- [ ] **Step 1: Write the failing test**

```typescript
// lib/__tests__/rules.test.ts
import { describe, it, expect } from "vitest";
import {
  RuleConfigSchema,
  isValidSession,
  countValidDays,
  hasFailed,
  dayKeyFor,
  type RuleConfig,
} from "@/lib/rules";

const gym: RuleConfig = {
  cadence: 5,
  period: "week",
  sessionType: "checkin_checkout",
  minDurationMins: 30,
  windowStart: "05:00",
  windowEnd: "23:00",
  proof: "photo",
  failsWhenMissedExceeds: 0,
  split: "equal",
  exemption: "majority",
  durationPeriods: 4,
};

describe("rule config schema", () => {
  it("accepts a valid gym config", () => {
    expect(() => RuleConfigSchema.parse(gym)).not.toThrow();
  });

  it("rejects cadence of zero", () => {
    expect(() => RuleConfigSchema.parse({ ...gym, cadence: 0 })).toThrow();
  });
});

describe("dayKeyFor", () => {
  it("keys a session to the day it started, not the day it ended", () => {
    const startedAt = new Date("2026-08-25T16:50:00.000Z"); // 23:50 in Bangkok
    expect(dayKeyFor(startedAt, "Asia/Bangkok")).toBe("2026-08-25");
  });
});

describe("isValidSession", () => {
  it("accepts a 45 minute session inside the window", () => {
    const s = {
      startedAt: new Date("2026-08-25T02:00:00.000Z"), // 09:00 Bangkok
      endedAt: new Date("2026-08-25T02:45:00.000Z"),
    };
    expect(isValidSession(s, gym, "Asia/Bangkok")).toBe(true);
  });

  it("rejects a session shorter than the minimum", () => {
    const s = {
      startedAt: new Date("2026-08-25T02:00:00.000Z"),
      endedAt: new Date("2026-08-25T02:10:00.000Z"),
    };
    expect(isValidSession(s, gym, "Asia/Bangkok")).toBe(false);
  });

  it("rejects a session that was never closed", () => {
    const s = { startedAt: new Date("2026-08-25T02:00:00.000Z"), endedAt: null };
    expect(isValidSession(s, gym, "Asia/Bangkok")).toBe(false);
  });

  it("rejects a session started outside the window", () => {
    const s = {
      startedAt: new Date("2026-08-24T20:00:00.000Z"), // 03:00 Bangkok, before 05:00
      endedAt: new Date("2026-08-24T20:45:00.000Z"),
    };
    expect(isValidSession(s, gym, "Asia/Bangkok")).toBe(false);
  });

  it("accepts a checkin-only rule with no end time", () => {
    const wake: RuleConfig = {
      ...gym,
      cadence: 7,
      sessionType: "checkin",
      minDurationMins: null,
      windowStart: "05:00",
      windowEnd: "07:00",
    };
    const s = {
      startedAt: new Date("2026-08-24T23:30:00.000Z"), // 06:30 Bangkok
      endedAt: null,
    };
    expect(isValidSession(s, wake, "Asia/Bangkok")).toBe(true);
  });
});

describe("countValidDays", () => {
  it("counts two sessions on the same day as one day", () => {
    const sessions = [
      {
        startedAt: new Date("2026-08-25T02:00:00.000Z"),
        endedAt: new Date("2026-08-25T02:45:00.000Z"),
      },
      {
        startedAt: new Date("2026-08-25T10:00:00.000Z"),
        endedAt: new Date("2026-08-25T10:45:00.000Z"),
      },
    ];
    expect(countValidDays(sessions, gym, "Asia/Bangkok")).toBe(1);
  });
});

describe("hasFailed", () => {
  it("fails when fewer than the cadence was met", () => {
    const sessions = Array.from({ length: 4 }, (_, i) => ({
      startedAt: new Date(`2026-08-2${4 + i}T02:00:00.000Z`),
      endedAt: new Date(`2026-08-2${4 + i}T02:45:00.000Z`),
    }));
    expect(hasFailed(sessions, gym, "Asia/Bangkok")).toBe(true);
  });

  it("passes when the cadence was met exactly", () => {
    const sessions = Array.from({ length: 5 }, (_, i) => ({
      startedAt: new Date(`2026-08-2${4 + i}T02:00:00.000Z`),
      endedAt: new Date(`2026-08-2${4 + i}T02:45:00.000Z`),
    }));
    expect(hasFailed(sessions, gym, "Asia/Bangkok")).toBe(false);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run lib/__tests__/rules.test.ts`
Expected: FAIL — cannot resolve `@/lib/rules`

- [ ] **Step 3: Implement `lib/rules.ts`**

```typescript
import { z } from "zod";

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const RuleConfigSchema = z.object({
  cadence: z.number().int().min(1).max(7),
  period: z.enum(["week", "day"]),
  sessionType: z.enum(["checkin", "checkin_checkout"]),
  minDurationMins: z.number().int().min(1).nullable(),
  windowStart: z.string().regex(TIME_RE),
  windowEnd: z.string().regex(TIME_RE),
  proof: z.enum(["photo", "self_attest"]),
  failsWhenMissedExceeds: z.number().int().min(0),
  split: z.literal("equal"),
  exemption: z.enum(["majority", "none"]),
  durationPeriods: z.number().int().min(1).max(52),
});

export type RuleConfig = z.infer<typeof RuleConfigSchema>;

export type SessionRecord = { startedAt: Date; endedAt: Date | null };

/** Parts of a Date rendered in a specific IANA timezone. */
function zoned(d: Date, timezone: string): { key: string; minutes: number } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
  const hour = parts.hour === "24" ? "00" : parts.hour;
  return {
    key: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(hour) * 60 + Number(parts.minute),
  };
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** A session belongs to the day it STARTED, in the crew's timezone. */
export function dayKeyFor(startedAt: Date, timezone: string): string {
  return zoned(startedAt, timezone).key;
}

export function isValidSession(
  session: SessionRecord,
  rule: RuleConfig,
  timezone: string,
): boolean {
  const start = zoned(session.startedAt, timezone);
  const windowStart = toMinutes(rule.windowStart);
  const windowEnd = toMinutes(rule.windowEnd);

  if (start.minutes < windowStart || start.minutes > windowEnd) return false;

  if (rule.sessionType === "checkin") return true;

  if (!session.endedAt) return false;

  if (rule.minDurationMins !== null) {
    const mins = (session.endedAt.getTime() - session.startedAt.getTime()) / 60_000;
    if (mins < rule.minDurationMins) return false;
  }
  return true;
}

export function countValidDays(
  sessions: SessionRecord[],
  rule: RuleConfig,
  timezone: string,
): number {
  const days = new Set<string>();
  for (const s of sessions) {
    if (isValidSession(s, rule, timezone)) days.add(dayKeyFor(s.startedAt, timezone));
  }
  return days.size;
}

export function hasFailed(
  sessions: SessionRecord[],
  rule: RuleConfig,
  timezone: string,
): boolean {
  const done = countValidDays(sessions, rule, timezone);
  const missed = Math.max(0, rule.cadence - done);
  return missed > rule.failsWhenMissedExceeds;
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run lib/__tests__/rules.test.ts`
Expected: all passed

- [ ] **Step 5: Commit**

```bash
git add lib/rules.ts lib/__tests__/rules.test.ts
git commit -m "feat: rule config schema and pure evaluation logic"
```

---

### Task 4: Data model

**Files:**
- Create: `prisma/schema.prisma`, `lib/db.ts`
- Test: `lib/__tests__/db.test.ts`

**Interfaces:**
- Consumes: `RuleConfig` from Task 3 (stored as `Json`)
- Produces: `prisma` client singleton exported from `lib/db.ts`; models `User`, `Pact`, `Membership`, `Session`, `FeedItem`, `Reaction`, `Exemption`, `Vote`, `Settlement`

- [ ] **Step 1: Write `prisma/schema.prisma`**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id            String       @id @default(cuid())
  privyId       String       @unique
  walletAddress String       @unique
  displayName   String
  createdAt     DateTime     @default(now())
  memberships   Membership[]
  reactions     Reaction[]
  votes         Vote[]
  createdPacts  Pact[]       @relation("PactCreator")
}

enum PactStatus {
  funding
  active
  settled
}

model Pact {
  id            String       @id @default(cuid())
  name          String
  inviteToken   String       @unique
  createdById   String
  createdBy     User         @relation("PactCreator", fields: [createdById], references: [id])
  ruleConfig    Json
  timezone      String       @default("Asia/Bangkok")
  stakeAmount   Decimal      @db.Decimal(18, 2)
  stakeCurrency String
  fxRateToUsd   Decimal      @db.Decimal(18, 8)
  fxFetchedAt   DateTime
  stakeUsdc     BigInt
  vaultAddress  String
  vaultSecretEnc String
  status        PactStatus   @default(funding)
  startsAt      DateTime?
  endsAt        DateTime?
  createdAt     DateTime     @default(now())
  memberships   Membership[]
  feedItems     FeedItem[]
  settlements   Settlement[]
}

enum MemberStatus {
  invited
  staked
  passed
  failed
  left
}

model Membership {
  id          String       @id @default(cuid())
  pactId      String
  pact        Pact         @relation(fields: [pactId], references: [id], onDelete: Cascade)
  userId      String
  user        User         @relation(fields: [userId], references: [id])
  status      MemberStatus @default(invited)
  stakedAt    DateTime?
  stakeTxSig  String?
  payoutMint  String       @default("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v")
  payoutTxSig String?
  sessions    Session[]
  exemptions  Exemption[]
  feedItems   FeedItem[]

  @@unique([pactId, userId])
}

model Session {
  id            String     @id @default(cuid())
  membershipId  String
  membership    Membership @relation(fields: [membershipId], references: [id], onDelete: Cascade)
  startedAt     DateTime
  endedAt       DateTime?
  startPhotoUrl String?
  endPhotoUrl   String?
  dayKey        String
  createdAt     DateTime   @default(now())

  @@index([membershipId, dayKey])
}

enum FeedItemType {
  checkin
  checkout
  bot
  exemption_request
  exemption_result
  settlement
}

model FeedItem {
  id           String       @id @default(cuid())
  pactId       String
  pact         Pact         @relation(fields: [pactId], references: [id], onDelete: Cascade)
  membershipId String?
  membership   Membership?  @relation(fields: [membershipId], references: [id])
  type         FeedItemType
  body         String
  photoUrl     String?
  createdAt    DateTime     @default(now())
  reactions    Reaction[]

  @@index([pactId, createdAt])
}

model Reaction {
  id         String   @id @default(cuid())
  feedItemId String
  feedItem   FeedItem @relation(fields: [feedItemId], references: [id], onDelete: Cascade)
  userId     String
  user       User     @relation(fields: [userId], references: [id])
  emoji      String

  @@unique([feedItemId, userId, emoji])
}

enum ExemptionStatus {
  pending
  granted
  denied
}

model Exemption {
  id           String          @id @default(cuid())
  membershipId String
  membership   Membership      @relation(fields: [membershipId], references: [id], onDelete: Cascade)
  periodKey    String
  reason       String
  status       ExemptionStatus @default(pending)
  createdAt    DateTime        @default(now())
  votes        Vote[]

  @@unique([membershipId, periodKey])
}

model Vote {
  id          String    @id @default(cuid())
  exemptionId String
  exemption   Exemption @relation(fields: [exemptionId], references: [id], onDelete: Cascade)
  userId      String
  user        User      @relation(fields: [userId], references: [id])
  approve     Boolean

  @@unique([exemptionId, userId])
}

model Settlement {
  id            String   @id @default(cuid())
  pactId        String
  pact          Pact     @relation(fields: [pactId], references: [id], onDelete: Cascade)
  periodKey     String
  totalPotUsdc  BigInt
  payouts       Json
  createdAt     DateTime @default(now())

  @@unique([pactId, periodKey])
}
```

- [ ] **Step 2: Write `lib/db.ts`**

```typescript
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
```

- [ ] **Step 3: Push the schema**

```bash
npx prisma db push
npx prisma generate
```

Expected: schema synced, client generated.

- [ ] **Step 4: Write the round-trip test**

```typescript
// lib/__tests__/db.test.ts
import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/db";

describe("data model", () => {
  it("creates a pact with a member and a session", async () => {
    const user = await prisma.user.create({
      data: {
        privyId: `test-${Date.now()}`,
        walletAddress: `wallet-${Date.now()}`,
        displayName: "Test",
      },
    });

    const pact = await prisma.pact.create({
      data: {
        name: "Five day fitness",
        inviteToken: `tok-${Date.now()}`,
        createdById: user.id,
        ruleConfig: { cadence: 5, period: "week" },
        stakeAmount: "1000",
        stakeCurrency: "THB",
        fxRateToUsd: "0.0285",
        fxFetchedAt: new Date(),
        stakeUsdc: 28_500_000n,
        vaultAddress: "vault-addr",
        vaultSecretEnc: "enc",
      },
    });

    const m = await prisma.membership.create({
      data: { pactId: pact.id, userId: user.id, status: "staked" },
    });

    const s = await prisma.session.create({
      data: { membershipId: m.id, startedAt: new Date(), dayKey: "2026-08-25" },
    });

    expect(pact.stakeUsdc).toBe(28_500_000n);
    expect(s.membershipId).toBe(m.id);

    await prisma.pact.delete({ where: { id: pact.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});
```

- [ ] **Step 5: Run it**

Run: `npx vitest run lib/__tests__/db.test.ts`
Expected: 1 passed

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma lib/db.ts lib/__tests__/db.test.ts
git commit -m "feat: prisma data model for pacts, members, sessions and settlement"
```

---

### Task 5: The transaction spike — user signs, sponsor co-signs, chain confirms

**This is the riskiest task in the project. It must be completed and verified against mainnet by a human before Phase 1 begins.**

**Files:**
- Create: `lib/solana.ts`, `lib/vault.ts`, `scripts/spike-sponsored-swap.ts`
- Test: `lib/__tests__/vault.test.ts`

**Interfaces:**
- Consumes: `buildOrder`, `USDC_MINT`, `WSOL_MINT` from Task 2
- Produces:
  - `getConnection(): Connection`
  - `deserializeTx(base64: string): VersionedTransaction`
  - `signWith(tx: VersionedTransaction, signers: Keypair[]): VersionedTransaction`
  - `submitAndConfirm(tx: VersionedTransaction, lastValidBlockHeight: number): Promise<string>`
  - `loadSponsor(): Keypair`
  - `createVault(): { publicKey: string; secretEnc: string }`
  - `loadVault(secretEnc: string): Keypair`
  - `encryptSecret(secret: Uint8Array): string` / `decryptSecret(enc: string): Uint8Array`

- [ ] **Step 1: Write the failing vault test**

```typescript
// lib/__tests__/vault.test.ts
import { describe, it, expect } from "vitest";
import { createVault, loadVault, encryptSecret, decryptSecret } from "@/lib/vault";

describe("vault", () => {
  it("round-trips an encrypted secret", () => {
    const secret = new Uint8Array(64).fill(7);
    const enc = encryptSecret(secret);
    expect(enc).not.toContain("7,7,7");
    expect(Array.from(decryptSecret(enc))).toEqual(Array.from(secret));
  });

  it("creates a vault whose encrypted secret loads back to the same public key", () => {
    const v = createVault();
    const kp = loadVault(v.secretEnc);
    expect(kp.publicKey.toBase58()).toBe(v.publicKey);
  });

  it("produces a different ciphertext each time for the same secret", () => {
    const secret = new Uint8Array(64).fill(1);
    expect(encryptSecret(secret)).not.toBe(encryptSecret(secret));
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run lib/__tests__/vault.test.ts`
Expected: FAIL — cannot resolve `@/lib/vault`

- [ ] **Step 3: Implement `lib/vault.ts`**

```typescript
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { Keypair } from "@solana/web3.js";

function key(): Buffer {
  const raw = process.env.VAULT_ENCRYPTION_KEY;
  if (!raw) throw new Error("VAULT_ENCRYPTION_KEY is not set");
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) throw new Error("VAULT_ENCRYPTION_KEY must be 32 bytes, base64 encoded");
  return buf;
}

export function encryptSecret(secret: Uint8Array): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(Buffer.from(secret)), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), ct.toString("base64")].join(".");
}

export function decryptSecret(enc: string): Uint8Array {
  const [ivB64, tagB64, ctB64] = enc.split(".");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return new Uint8Array(
    Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]),
  );
}

export function createVault(): { publicKey: string; secretEnc: string } {
  const kp = Keypair.generate();
  return { publicKey: kp.publicKey.toBase58(), secretEnc: encryptSecret(kp.secretKey) };
}

export function loadVault(secretEnc: string): Keypair {
  return Keypair.fromSecretKey(decryptSecret(secretEnc));
}
```

- [ ] **Step 4: Generate a key and run the tests**

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Put the output in `.env` as `VAULT_ENCRYPTION_KEY`.

Run: `npx vitest run lib/__tests__/vault.test.ts`
Expected: 3 passed

- [ ] **Step 5: Implement `lib/solana.ts`**

```typescript
import { Connection, Keypair, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";

export function getConnection(): Connection {
  return new Connection(
    process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com",
    "confirmed",
  );
}

export function deserializeTx(base64: string): VersionedTransaction {
  return VersionedTransaction.deserialize(Buffer.from(base64, "base64"));
}

export function serializeTx(tx: VersionedTransaction): string {
  return Buffer.from(tx.serialize()).toString("base64");
}

/** Adds signatures without clearing any already present. */
export function signWith(tx: VersionedTransaction, signers: Keypair[]): VersionedTransaction {
  tx.sign(signers);
  return tx;
}

export function loadSponsor(): Keypair {
  const raw = process.env.SPONSOR_SECRET_KEY;
  if (!raw) throw new Error("SPONSOR_SECRET_KEY is not set");
  return Keypair.fromSecretKey(bs58.decode(raw));
}

export async function submitAndConfirm(
  tx: VersionedTransaction,
  lastValidBlockHeight: number,
): Promise<string> {
  const connection = getConnection();
  const signature = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    maxRetries: 3,
  });
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  const { value } = await connection.confirmTransaction(
    { signature, blockhash, lastValidBlockHeight },
    "confirmed",
  );
  if (value.err) throw new Error(`Transaction failed: ${JSON.stringify(value.err)}`);
  return signature;
}
```

- [ ] **Step 6: Write the spike script**

```typescript
// scripts/spike-sponsored-swap.ts
import "dotenv/config";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { buildOrder, USDC_MINT, WSOL_MINT } from "../lib/dflow";
import { deserializeTx, signWith, submitAndConfirm, loadSponsor } from "../lib/solana";

async function main() {
  const user = Keypair.fromSecretKey(bs58.decode(process.env.TEST_USER_SECRET_KEY!));
  const sponsor = loadSponsor();
  const destination = process.env.TEST_DESTINATION_WALLET ?? user.publicKey.toBase58();

  console.log("user    ", user.publicKey.toBase58());
  console.log("sponsor ", sponsor.publicKey.toBase58());
  console.log("dest    ", destination);

  const order = await buildOrder({
    inputMint: WSOL_MINT,
    outputMint: USDC_MINT,
    amount: 5_000_000n, // 0.005 SOL
    userPublicKey: user.publicKey.toBase58(),
    destinationWallet: destination,
    sponsor: sponsor.publicKey.toBase58(),
    sponsorExec: false,
    slippageBps: 100,
  });

  console.log("quote   ", order.inAmount, "->", order.outAmount, "via", order.routePlan?.map((l) => l.venue).join(" > "));

  const tx = deserializeTx(order.transaction!);
  signWith(tx, [user, sponsor]);

  const sig = await submitAndConfirm(tx, order.lastValidBlockHeight!);
  console.log("CONFIRMED https://solscan.io/tx/" + sig);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 7: Fund the wallets and run the spike**

Fund the sponsor wallet with ~0.05 SOL and the test user wallet with ~0.02 SOL. Then:

```bash
npx tsx scripts/spike-sponsored-swap.ts
```

Expected: a printed Solscan link to a confirmed transaction where USDC landed in the destination wallet and the **sponsor** paid the fee. Verify on Solscan that the fee payer is the sponsor address.

**If this fails, stop and debug before continuing.** Everything downstream assumes this path works. Likely failure modes and what they mean:
- `sponsorExec` mismatch → the transaction expects the sponsor's token accounts; try `sponsorExec: true`.
- Signature verification failure → DFlow returned a transaction whose signer list does not include the sponsor; log `tx.message.staticAccountKeys[0]` to see who the fee payer actually is.
- Blockhash expired → the RPC is slow; use a paid RPC (Helius) via `SOLANA_RPC_URL`.

- [ ] **Step 8: Record the result**

Append a short note to `docs/superpowers/specs/2026-08-24-pact-design.md` under "Verified facts" recording the confirmed signature and whether `sponsorExec` was `true` or `false`. Later tasks must use the value that worked.

- [ ] **Step 9: Commit**

```bash
git add lib/solana.ts lib/vault.ts lib/__tests__/vault.test.ts scripts/spike-sponsored-swap.ts docs/
git commit -m "feat: solana signing, encrypted vaults, verified sponsored swap on mainnet"
```

---

## Phase 1 — Parallel (Tasks 6–14)

These nine tasks touch disjoint files and depend only on Phase 0. Dispatch them concurrently. Each must leave `npx vitest run` green.

---

### Task 6: FX rates and pact creation API

**Files:**
- Create: `lib/fx.ts`, `app/api/pacts/route.ts`
- Test: `lib/__tests__/fx.test.ts`

**Interfaces:**
- Consumes: `RuleConfigSchema` (Task 3), `prisma` (Task 4), `createVault` (Task 5)
- Produces:
  - `fetchUsdRate(currency: string): Promise<number>` — units of USD per 1 unit of `currency`
  - `toUsdcAtomic(amount: number, usdRate: number): bigint`
  - `POST /api/pacts` accepting `{ name, ruleConfig, stakeAmount, stakeCurrency, timezone, createdByPrivyId, walletAddress, displayName }` returning `{ id, inviteToken, vaultAddress, stakeUsdc }`

- [ ] **Step 1: Write the failing test**

```typescript
// lib/__tests__/fx.test.ts
import { describe, it, expect } from "vitest";
import { fetchUsdRate, toUsdcAtomic } from "@/lib/fx";

describe("fx", () => {
  it("returns 1 for USD", async () => {
    expect(await fetchUsdRate("USD")).toBe(1);
  });

  it("returns a plausible THB rate", async () => {
    const r = await fetchUsdRate("THB");
    expect(r).toBeGreaterThan(0.01);
    expect(r).toBeLessThan(0.1);
  });

  it("converts 1000 THB at 0.0285 to 28.5 USDC in atomic units", () => {
    expect(toUsdcAtomic(1000, 0.0285)).toBe(28_500_000n);
  });

  it("rounds to the nearest atomic unit", () => {
    expect(toUsdcAtomic(1, 0.0285123456)).toBe(28_512n);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run lib/__tests__/fx.test.ts`
Expected: FAIL — cannot resolve `@/lib/fx`

- [ ] **Step 3: Implement `lib/fx.ts`**

```typescript
export async function fetchUsdRate(currency: string): Promise<number> {
  const code = currency.toUpperCase();
  if (code === "USD" || code === "USDC") return 1;

  const res = await fetch(`https://api.frankfurter.app/latest?from=${code}&to=USD`);
  if (!res.ok) throw new Error(`FX lookup failed for ${code}: ${res.status}`);

  const body = (await res.json()) as { rates?: Record<string, number> };
  const rate = body.rates?.USD;
  if (typeof rate !== "number") throw new Error(`No USD rate returned for ${code}`);
  return rate;
}

/** USDC has 6 decimals. Rounds half-up to the nearest atomic unit. */
export function toUsdcAtomic(amount: number, usdRate: number): bigint {
  return BigInt(Math.round(amount * usdRate * 1_000_000));
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run lib/__tests__/fx.test.ts`
Expected: 4 passed

- [ ] **Step 5: Implement `app/api/pacts/route.ts`**

```typescript
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
}

export async function GET() {
  const pacts = await prisma.pact.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { memberships: { include: { user: true } } },
  });
  return NextResponse.json(
    pacts.map((p) => ({ ...p, stakeUsdc: p.stakeUsdc.toString() })),
  );
}
```

- [ ] **Step 6: Verify the route by hand**

Run `npm run dev`, then:

```bash
curl -s -X POST localhost:3000/api/pacts -H 'content-type: application/json' -d '{
  "name":"Five day fitness","stakeAmount":1000,"stakeCurrency":"THB",
  "createdByPrivyId":"did:privy:test1","walletAddress":"5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9",
  "displayName":"Indy",
  "ruleConfig":{"cadence":5,"period":"week","sessionType":"checkin_checkout","minDurationMins":30,
    "windowStart":"05:00","windowEnd":"23:00","proof":"photo","failsWhenMissedExceeds":0,
    "split":"equal","exemption":"majority","durationPeriods":4}
}'
```

Expected: JSON with `id`, `inviteToken`, a base58 `vaultAddress`, and `stakeUsdc` around `28500000`.

- [ ] **Step 7: Commit**

```bash
git add lib/fx.ts lib/__tests__/fx.test.ts app/api/pacts/route.ts
git commit -m "feat: fx rate locking and pact creation endpoint"
```

---

### Task 7: AI rule builder

**Files:**
- Create: `app/api/rules/draft/route.ts`
- Test: `app/api/rules/draft/__tests__/draft.test.ts`

**Interfaces:**
- Consumes: `RuleConfigSchema` (Task 3)
- Produces: `POST /api/rules/draft` accepting `{ description: string }` returning `{ name: string; ruleConfig: RuleConfig; stakeAmount: number; stakeCurrency: string }`

- [ ] **Step 1: Write the failing test**

```typescript
// app/api/rules/draft/__tests__/draft.test.ts
import { describe, it, expect } from "vitest";
import { draftRule } from "@/app/api/rules/draft/route";

describe("draftRule", () => {
  it("turns a gym description into a five-a-week photo rule", async () => {
    const r = await draftRule(
      "Me and four mates. Gym five days a week, at least 30 minutes, photo in and photo out. 1000 baht if you miss.",
    );
    expect(r.ruleConfig.cadence).toBe(5);
    expect(r.ruleConfig.period).toBe("week");
    expect(r.ruleConfig.sessionType).toBe("checkin_checkout");
    expect(r.ruleConfig.minDurationMins).toBe(30);
    expect(r.ruleConfig.proof).toBe("photo");
    expect(r.stakeAmount).toBe(1000);
    expect(r.stakeCurrency).toBe("THB");
  });

  it("turns a wake-up description into a daily check-in with a morning window", async () => {
    const r = await draftRule("Wake up before 7am every day or I owe my brother 20 quid.");
    expect(r.ruleConfig.sessionType).toBe("checkin");
    expect(r.ruleConfig.windowEnd <= "07:00").toBe(true);
    expect(r.stakeCurrency).toBe("GBP");
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run app/api/rules/draft`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `app/api/rules/draft/route.ts`**

```typescript
import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { RuleConfigSchema, type RuleConfig } from "@/lib/rules";

const DraftSchema = z.object({
  name: z.string().describe("Short name for the pact, 2-5 words"),
  ruleConfig: RuleConfigSchema,
  stakeAmount: z.number().positive().describe("The penalty amount as a number"),
  stakeCurrency: z.string().length(3).describe("ISO 4217 code, e.g. THB, GBP, USD"),
});

export type Draft = {
  name: string;
  ruleConfig: RuleConfig;
  stakeAmount: number;
  stakeCurrency: string;
};

const SYSTEM = `You turn a plain-English description of a group commitment into a structured rule config.

Rules for interpretation:
- "five days a week" means cadence 5, period week.
- If the description mentions a minimum duration or "check in and check out", use sessionType checkin_checkout. Otherwise use checkin.
- If no time window is stated, use windowStart 00:00 and windowEnd 23:59.
- If a deadline is stated ("before 7am"), set windowEnd to it and windowStart to 00:00.
- If photos or proof are mentioned, proof is photo. If the rule cannot be photographed (not vaping, sleeping on time), use self_attest.
- failsWhenMissedExceeds is 0 unless the description explicitly allows misses.
- Infer currency from context: baht is THB, quid or pounds is GBP, dollars is USD. Default to USD.
- durationPeriods defaults to 4 unless a length is stated.`;

export async function draftRule(description: string): Promise<Draft> {
  const client = new Anthropic();

  const response = await client.messages.parse({
    model: "claude-opus-5",
    max_tokens: 16000,
    system: SYSTEM,
    thinking: { type: "adaptive" },
    messages: [{ role: "user", content: description }],
    output_config: { format: zodOutputFormat(DraftSchema) },
  });

  if (!response.parsed_output) {
    throw new Error("Model did not return a parseable rule config");
  }
  return response.parsed_output as Draft;
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { description?: unknown };

  if (typeof body.description !== "string" || body.description.trim().length < 10) {
    return NextResponse.json(
      { error: "description must be at least 10 characters" },
      { status: 400 },
    );
  }

  try {
    return NextResponse.json(await draftRule(body.description));
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "draft failed" },
      { status: 502 },
    );
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run app/api/rules/draft`
Expected: 2 passed. If a field assertion fails because the model chose differently but sensibly, tighten the `SYSTEM` prompt rather than loosening the test — the demo depends on this being predictable.

- [ ] **Step 5: Commit**

```bash
git add app/api/rules/draft
git commit -m "feat: natural language to rule config via structured outputs"
```

---

### Task 8: Stake flow

**Files:**
- Create: `app/api/pacts/[id]/stake/route.ts`, `lib/stake.ts`
- Test: `lib/__tests__/stake.test.ts`

**Interfaces:**
- Consumes: `buildOrder`, `USDC_MINT` (Task 2), `prisma` (Task 4), `loadSponsor`, `deserializeTx`, `signWith`, `submitAndConfirm` (Task 5)
- Produces:
  - `buildStakeTransaction(params: { pactId: string; userWallet: string; inputMint: string }): Promise<{ transactionB64: string; lastValidBlockHeight: number; quote: { inAmount: string; outAmount: string; venues: string[] } }>`
  - `finaliseStake(params: { pactId: string; userWallet: string; signedTxB64: string; lastValidBlockHeight: number }): Promise<{ signature: string }>`
  - `POST /api/pacts/[id]/stake` with `{ step: "build", userWallet, inputMint }` or `{ step: "submit", userWallet, signedTx, lastValidBlockHeight }`

- [ ] **Step 1: Write the failing test**

```typescript
// lib/__tests__/stake.test.ts
import { describe, it, expect } from "vitest";
import { computeStakeInput } from "@/lib/stake";

describe("computeStakeInput", () => {
  it("returns a plain transfer when the member already holds USDC", () => {
    const r = computeStakeInput({
      inputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      stakeUsdc: 28_500_000n,
    });
    expect(r.kind).toBe("transfer");
    expect(r.amount).toBe(28_500_000n);
  });

  it("returns a swap when the member holds something else", () => {
    const r = computeStakeInput({
      inputMint: "So11111111111111111111111111111111111111112",
      stakeUsdc: 28_500_000n,
    });
    expect(r.kind).toBe("swap");
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run lib/__tests__/stake.test.ts`
Expected: FAIL — cannot resolve `@/lib/stake`

- [ ] **Step 3: Implement `lib/stake.ts`**

```typescript
import { prisma } from "@/lib/db";
import { buildOrder, getQuote, USDC_MINT } from "@/lib/dflow";
import { deserializeTx, loadSponsor, signWith, submitAndConfirm } from "@/lib/solana";

export function computeStakeInput(params: { inputMint: string; stakeUsdc: bigint }): {
  kind: "transfer" | "swap";
  amount: bigint;
} {
  return params.inputMint === USDC_MINT
    ? { kind: "transfer", amount: params.stakeUsdc }
    : { kind: "swap", amount: params.stakeUsdc };
}

/**
 * Works out how much of `inputMint` is worth the pact's USDC stake, then builds a
 * DFlow order that converts it and delivers the USDC straight into the pact vault.
 */
export async function buildStakeTransaction(params: {
  pactId: string;
  userWallet: string;
  inputMint: string;
}) {
  const pact = await prisma.pact.findUniqueOrThrow({ where: { id: params.pactId } });
  const sponsor = loadSponsor();

  // Price the reverse direction to size the input leg, then add 3% headroom so the
  // swap still clears the stake after slippage.
  const probe = await getQuote({
    inputMint: USDC_MINT,
    outputMint: params.inputMint,
    amount: pact.stakeUsdc,
    slippageBps: 100,
  });
  const inputAmount = (BigInt(probe.outAmount) * 103n) / 100n;

  const order = await buildOrder({
    inputMint: params.inputMint,
    outputMint: USDC_MINT,
    amount: inputAmount,
    userPublicKey: params.userWallet,
    destinationWallet: pact.vaultAddress,
    sponsor: sponsor.publicKey.toBase58(),
    sponsorExec: false,
    slippageBps: 100,
  });

  if (BigInt(order.minOutAmount) < pact.stakeUsdc) {
    throw new Error(
      `Route cannot guarantee the stake: worst case ${order.minOutAmount} < required ${pact.stakeUsdc}`,
    );
  }

  return {
    transactionB64: order.transaction!,
    lastValidBlockHeight: order.lastValidBlockHeight!,
    quote: {
      inAmount: order.inAmount,
      outAmount: order.outAmount,
      venues: order.routePlan?.map((l) => l.venue) ?? [],
    },
  };
}

export async function finaliseStake(params: {
  pactId: string;
  userWallet: string;
  signedTxB64: string;
  lastValidBlockHeight: number;
}) {
  const sponsor = loadSponsor();
  const tx = deserializeTx(params.signedTxB64);
  signWith(tx, [sponsor]);

  const signature = await submitAndConfirm(tx, params.lastValidBlockHeight);

  const user = await prisma.user.findUniqueOrThrow({
    where: { walletAddress: params.userWallet },
  });

  await prisma.membership.update({
    where: { pactId_userId: { pactId: params.pactId, userId: user.id } },
    data: { status: "staked", stakedAt: new Date(), stakeTxSig: signature },
  });

  await prisma.feedItem.create({
    data: {
      pactId: params.pactId,
      type: "bot",
      body: `${user.displayName} is in. Stake locked.`,
    },
  });

  // The pact starts only once everybody has staked.
  const members = await prisma.membership.findMany({ where: { pactId: params.pactId } });
  if (members.every((m) => m.status === "staked")) {
    await prisma.pact.update({
      where: { id: params.pactId },
      data: { status: "active", startsAt: new Date() },
    });
    await prisma.feedItem.create({
      data: { pactId: params.pactId, type: "bot", body: "Everyone's staked. The pact is live." },
    });
  }

  return { signature };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run lib/__tests__/stake.test.ts`
Expected: 2 passed

- [ ] **Step 5: Implement `app/api/pacts/[id]/stake/route.ts`**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { buildStakeTransaction, finaliseStake } from "@/lib/stake";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json();

  try {
    if (body.step === "build") {
      return NextResponse.json(
        await buildStakeTransaction({
          pactId: id,
          userWallet: body.userWallet,
          inputMint: body.inputMint,
        }),
      );
    }

    if (body.step === "submit") {
      return NextResponse.json(
        await finaliseStake({
          pactId: id,
          userWallet: body.userWallet,
          signedTxB64: body.signedTx,
          lastValidBlockHeight: body.lastValidBlockHeight,
        }),
      );
    }

    return NextResponse.json({ error: "step must be build or submit" }, { status: 400 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "stake failed" },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 6: Add re-staking for the next period**

A member who has settled — passed or failed — must put a fresh stake up to carry on.
Append to `lib/stake.ts`:

```typescript
/**
 * Resets a settled membership so the member can stake again for the next period.
 * Their existing stake is gone: winners were paid out, losers forfeited.
 */
export async function reopenForNextPeriod(params: { pactId: string; userWallet: string }) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { walletAddress: params.userWallet },
  });

  const membership = await prisma.membership.findUniqueOrThrow({
    where: { pactId_userId: { pactId: params.pactId, userId: user.id } },
  });

  if (membership.status === "left") throw new Error("You have left this pact");
  if (membership.status === "staked") throw new Error("You are already staked for this period");

  await prisma.membership.update({
    where: { id: membership.id },
    data: { status: "invited", stakedAt: null, stakeTxSig: null, payoutTxSig: null },
  });

  await prisma.pact.update({
    where: { id: params.pactId },
    data: { status: "funding", startsAt: null },
  });

  await prisma.feedItem.create({
    data: {
      pactId: params.pactId,
      membershipId: membership.id,
      type: "bot",
      body: `${user.displayName} is going again. Waiting on their stake.`,
    },
  });

  return { membershipId: membership.id };
}
```

Add the branch to `app/api/pacts/[id]/stake/route.ts`, before the `build` branch:

```typescript
    if (body.step === "reopen") {
      return NextResponse.json(
        await reopenForNextPeriod({ pactId: id, userWallet: body.userWallet }),
      );
    }
```

Import it alongside the others: `import { buildStakeTransaction, finaliseStake, reopenForNextPeriod } from "@/lib/stake";`

- [ ] **Step 7: Add the re-stake test**

Append to `lib/__tests__/stake.test.ts`:

```typescript
import { reopenForNextPeriod } from "@/lib/stake";
import { prisma } from "@/lib/db";
import { createVault } from "@/lib/vault";

describe("reopenForNextPeriod", () => {
  it("puts a passed member back into funding", async () => {
    const stamp = Date.now();
    const user = await prisma.user.create({
      data: { privyId: `p-${stamp}`, walletAddress: `w-${stamp}`, displayName: "R" },
    });
    const vault = createVault();
    const pact = await prisma.pact.create({
      data: {
        name: "T", inviteToken: `t-${stamp}`, createdById: user.id, ruleConfig: {},
        stakeAmount: "1000", stakeCurrency: "THB", fxRateToUsd: "0.0285",
        fxFetchedAt: new Date(), stakeUsdc: 28_500_000n, status: "settled",
        vaultAddress: vault.publicKey, vaultSecretEnc: vault.secretEnc,
        memberships: { create: { userId: user.id, status: "passed" } },
      },
    });

    await reopenForNextPeriod({ pactId: pact.id, userWallet: user.walletAddress });

    const after = await prisma.pact.findUniqueOrThrow({
      where: { id: pact.id },
      include: { memberships: true },
    });
    expect(after.status).toBe("funding");
    expect(after.memberships[0].status).toBe("invited");

    await prisma.pact.delete({ where: { id: pact.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });

  it("refuses to reopen a member who is already staked", async () => {
    const stamp = Date.now() + 1;
    const user = await prisma.user.create({
      data: { privyId: `p2-${stamp}`, walletAddress: `w2-${stamp}`, displayName: "R2" },
    });
    const vault = createVault();
    const pact = await prisma.pact.create({
      data: {
        name: "T", inviteToken: `t2-${stamp}`, createdById: user.id, ruleConfig: {},
        stakeAmount: "1000", stakeCurrency: "THB", fxRateToUsd: "0.0285",
        fxFetchedAt: new Date(), stakeUsdc: 28_500_000n,
        vaultAddress: vault.publicKey, vaultSecretEnc: vault.secretEnc,
        memberships: { create: { userId: user.id, status: "staked" } },
      },
    });

    await expect(
      reopenForNextPeriod({ pactId: pact.id, userWallet: user.walletAddress }),
    ).rejects.toThrow(/already staked/i);

    await prisma.pact.delete({ where: { id: pact.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });
});
```

Run: `npx vitest run lib/__tests__/stake.test.ts`
Expected: 4 passed

- [ ] **Step 8: Commit**

```bash
git add lib/stake.ts lib/__tests__/stake.test.ts app/api/pacts/\[id\]/stake
git commit -m "feat: stake any token into the pact vault via dflow, plus re-staking"
```

---

### Task 9: Check-in with camera

**Files:**
- Create: `app/api/pacts/[id]/sessions/route.ts`, `components/CheckInCamera.tsx`
- Test: `app/api/pacts/[id]/sessions/__tests__/sessions.test.ts`

**Interfaces:**
- Consumes: `dayKeyFor`, `RuleConfigSchema` (Task 3), `prisma` (Task 4)
- Produces:
  - `openSession(params: { pactId: string; userWallet: string; photoUrl: string | null }): Promise<{ sessionId: string }>`
  - `closeSession(params: { sessionId: string; photoUrl: string | null }): Promise<{ durationMins: number }>`
  - `<CheckInCamera onCapture={(file: File) => void} label={string} />`

- [ ] **Step 1: Write the failing test**

```typescript
// app/api/pacts/[id]/sessions/__tests__/sessions.test.ts
import { describe, it, expect } from "vitest";
import { openSession, closeSession } from "@/app/api/pacts/[id]/sessions/route";
import { prisma } from "@/lib/db";
import { createVault } from "@/lib/vault";

async function fixture() {
  const stamp = Date.now();
  const user = await prisma.user.create({
    data: { privyId: `p-${stamp}`, walletAddress: `w-${stamp}`, displayName: "Tester" },
  });
  const vault = createVault();
  const pact = await prisma.pact.create({
    data: {
      name: "T", inviteToken: `t-${stamp}`, createdById: user.id,
      ruleConfig: {
        cadence: 5, period: "week", sessionType: "checkin_checkout", minDurationMins: 30,
        windowStart: "00:00", windowEnd: "23:59", proof: "photo",
        failsWhenMissedExceeds: 0, split: "equal", exemption: "majority", durationPeriods: 4,
      },
      stakeAmount: "1000", stakeCurrency: "THB", fxRateToUsd: "0.0285",
      fxFetchedAt: new Date(), stakeUsdc: 28_500_000n,
      vaultAddress: vault.publicKey, vaultSecretEnc: vault.secretEnc,
      memberships: { create: { userId: user.id, status: "staked" } },
    },
  });
  return { user, pact };
}

describe("sessions", () => {
  it("opens a session and records the day it started", async () => {
    const { user, pact } = await fixture();
    const { sessionId } = await openSession({
      pactId: pact.id, userWallet: user.walletAddress, photoUrl: "https://x/1.jpg",
    });
    const s = await prisma.session.findUniqueOrThrow({ where: { id: sessionId } });
    expect(s.dayKey).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(s.endedAt).toBeNull();
    await prisma.pact.delete({ where: { id: pact.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });

  it("refuses to open a second session while one is open", async () => {
    const { user, pact } = await fixture();
    await openSession({ pactId: pact.id, userWallet: user.walletAddress, photoUrl: null });
    await expect(
      openSession({ pactId: pact.id, userWallet: user.walletAddress, photoUrl: null }),
    ).rejects.toThrow(/already open/i);
    await prisma.pact.delete({ where: { id: pact.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });

  it("closes a session and reports its duration", async () => {
    const { user, pact } = await fixture();
    const { sessionId } = await openSession({
      pactId: pact.id, userWallet: user.walletAddress, photoUrl: null,
    });
    await prisma.session.update({
      where: { id: sessionId },
      data: { startedAt: new Date(Date.now() - 45 * 60_000) },
    });
    const { durationMins } = await closeSession({ sessionId, photoUrl: null });
    expect(durationMins).toBeGreaterThanOrEqual(44);
    await prisma.pact.delete({ where: { id: pact.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run app/api/pacts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `app/api/pacts/[id]/sessions/route.ts`**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { dayKeyFor } from "@/lib/rules";

export async function openSession(params: {
  pactId: string;
  userWallet: string;
  photoUrl: string | null;
}): Promise<{ sessionId: string }> {
  const pact = await prisma.pact.findUniqueOrThrow({ where: { id: params.pactId } });
  const user = await prisma.user.findUniqueOrThrow({
    where: { walletAddress: params.userWallet },
  });
  const membership = await prisma.membership.findUniqueOrThrow({
    where: { pactId_userId: { pactId: pact.id, userId: user.id } },
  });

  const open = await prisma.session.findFirst({
    where: { membershipId: membership.id, endedAt: null },
  });
  if (open) throw new Error("A session is already open. Check out first.");

  const startedAt = new Date();
  const session = await prisma.session.create({
    data: {
      membershipId: membership.id,
      startedAt,
      dayKey: dayKeyFor(startedAt, pact.timezone),
      startPhotoUrl: params.photoUrl,
    },
  });

  await prisma.feedItem.create({
    data: {
      pactId: pact.id,
      membershipId: membership.id,
      type: "checkin",
      body: `${user.displayName} checked in`,
      photoUrl: params.photoUrl,
    },
  });

  return { sessionId: session.id };
}

export async function closeSession(params: {
  sessionId: string;
  photoUrl: string | null;
}): Promise<{ durationMins: number }> {
  const session = await prisma.session.findUniqueOrThrow({
    where: { id: params.sessionId },
    include: { membership: { include: { user: true, pact: true } } },
  });
  if (session.endedAt) throw new Error("Session is already closed.");

  const endedAt = new Date();
  const durationMins = Math.floor((endedAt.getTime() - session.startedAt.getTime()) / 60_000);

  await prisma.session.update({
    where: { id: session.id },
    data: { endedAt, endPhotoUrl: params.photoUrl },
  });

  await prisma.feedItem.create({
    data: {
      pactId: session.membership.pactId,
      membershipId: session.membershipId,
      type: "checkout",
      body: `${session.membership.user.displayName} checked out after ${durationMins} minutes`,
      photoUrl: params.photoUrl,
    },
  });

  return { durationMins };
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json();

  try {
    if (body.action === "open") {
      return NextResponse.json(
        await openSession({
          pactId: id,
          userWallet: body.userWallet,
          photoUrl: body.photoUrl ?? null,
        }),
      );
    }
    if (body.action === "close") {
      return NextResponse.json(
        await closeSession({ sessionId: body.sessionId, photoUrl: body.photoUrl ?? null }),
      );
    }
    return NextResponse.json({ error: "action must be open or close" }, { status: 400 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "session failed" },
      { status: 400 },
    );
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run app/api/pacts`
Expected: 3 passed

- [ ] **Step 5: Implement `components/CheckInCamera.tsx`**

The `capture` attribute opens the rear camera directly on mobile and falls back to a file picker on desktop. No `getUserMedia`, no permissions dance.

```tsx
"use client";

import { useRef, useState } from "react";

export function CheckInCamera({
  label,
  onCapture,
}: {
  label: string;
  onCapture: (file: File) => Promise<void> | void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPreview(URL.createObjectURL(file));
    setBusy(true);
    try {
      await onCapture(file);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleChange}
      />
      {preview && (
        <img src={preview} alt="" className="h-40 w-40 rounded-xl object-cover" />
      )}
      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        className="rounded-full bg-black px-6 py-3 text-white disabled:opacity-50"
      >
        {busy ? "Uploading…" : label}
      </button>
    </div>
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add app/api/pacts/\[id\]/sessions components/CheckInCamera.tsx
git commit -m "feat: photo check-in and check-out sessions"
```

---

### Task 10: Feed and reactions

**Files:**
- Create: `app/api/pacts/[id]/feed/route.ts`, `app/api/feed/[itemId]/react/route.ts`, `components/Feed.tsx`
- Test: `app/api/pacts/[id]/feed/__tests__/feed.test.ts`

**Interfaces:**
- Consumes: `prisma` (Task 4)
- Produces:
  - `GET /api/pacts/[id]/feed` returning `FeedItemDto[]` where
    `type FeedItemDto = { id: string; type: string; body: string; photoUrl: string | null; authorName: string | null; createdAt: string; reactions: { emoji: string; count: number; mine: boolean }[] }`
  - `POST /api/feed/[itemId]/react` with `{ userWallet, emoji }` — toggles
  - `<Feed items={FeedItemDto[]} onReact={(id, emoji) => void} />`

- [ ] **Step 1: Write the failing test**

```typescript
// app/api/pacts/[id]/feed/__tests__/feed.test.ts
import { describe, it, expect } from "vitest";
import { getFeed, toggleReaction } from "@/app/api/pacts/[id]/feed/route";
import { prisma } from "@/lib/db";
import { createVault } from "@/lib/vault";

async function fixture() {
  const stamp = Date.now();
  const user = await prisma.user.create({
    data: { privyId: `p-${stamp}`, walletAddress: `w-${stamp}`, displayName: "Tester" },
  });
  const vault = createVault();
  const pact = await prisma.pact.create({
    data: {
      name: "T", inviteToken: `t-${stamp}`, createdById: user.id, ruleConfig: {},
      stakeAmount: "1000", stakeCurrency: "THB", fxRateToUsd: "0.0285",
      fxFetchedAt: new Date(), stakeUsdc: 28_500_000n,
      vaultAddress: vault.publicKey, vaultSecretEnc: vault.secretEnc,
      memberships: { create: { userId: user.id, status: "staked" } },
      feedItems: { create: { type: "bot", body: "Pact created" } },
    },
    include: { feedItems: true },
  });
  return { user, pact };
}

describe("feed", () => {
  it("returns items newest first with zero reactions", async () => {
    const { user, pact } = await fixture();
    const items = await getFeed(pact.id, user.walletAddress);
    expect(items).toHaveLength(1);
    expect(items[0].body).toBe("Pact created");
    expect(items[0].reactions).toEqual([]);
    await prisma.pact.delete({ where: { id: pact.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });

  it("toggles a reaction on and back off", async () => {
    const { user, pact } = await fixture();
    const itemId = pact.feedItems[0].id;

    await toggleReaction(itemId, user.walletAddress, "💪");
    let items = await getFeed(pact.id, user.walletAddress);
    expect(items[0].reactions).toEqual([{ emoji: "💪", count: 1, mine: true }]);

    await toggleReaction(itemId, user.walletAddress, "💪");
    items = await getFeed(pact.id, user.walletAddress);
    expect(items[0].reactions).toEqual([]);

    await prisma.pact.delete({ where: { id: pact.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run app/api/pacts/\[id\]/feed`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `app/api/pacts/[id]/feed/route.ts`**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export type FeedItemDto = {
  id: string;
  type: string;
  body: string;
  photoUrl: string | null;
  authorName: string | null;
  createdAt: string;
  reactions: { emoji: string; count: number; mine: boolean }[];
};

export async function getFeed(pactId: string, viewerWallet: string): Promise<FeedItemDto[]> {
  const viewer = await prisma.user.findUnique({ where: { walletAddress: viewerWallet } });

  const items = await prisma.feedItem.findMany({
    where: { pactId },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      membership: { include: { user: true } },
      reactions: true,
    },
  });

  return items.map((item) => {
    const byEmoji = new Map<string, { count: number; mine: boolean }>();
    for (const r of item.reactions) {
      const entry = byEmoji.get(r.emoji) ?? { count: 0, mine: false };
      entry.count += 1;
      if (viewer && r.userId === viewer.id) entry.mine = true;
      byEmoji.set(r.emoji, entry);
    }
    return {
      id: item.id,
      type: item.type,
      body: item.body,
      photoUrl: item.photoUrl,
      authorName: item.membership?.user.displayName ?? null,
      createdAt: item.createdAt.toISOString(),
      reactions: [...byEmoji.entries()].map(([emoji, v]) => ({ emoji, ...v })),
    };
  });
}

export async function toggleReaction(itemId: string, userWallet: string, emoji: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { walletAddress: userWallet } });
  const key = { feedItemId_userId_emoji: { feedItemId: itemId, userId: user.id, emoji } };
  const existing = await prisma.reaction.findUnique({ where: key });

  if (existing) {
    await prisma.reaction.delete({ where: key });
    return { on: false };
  }
  await prisma.reaction.create({ data: { feedItemId: itemId, userId: user.id, emoji } });
  return { on: true };
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const viewer = req.nextUrl.searchParams.get("viewer") ?? "";
  return NextResponse.json(await getFeed(id, viewer));
}
```

- [ ] **Step 4: Implement `app/api/feed/[itemId]/react/route.ts`**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { toggleReaction } from "@/app/api/pacts/[id]/feed/route";

export async function POST(req: NextRequest, ctx: { params: Promise<{ itemId: string }> }) {
  const { itemId } = await ctx.params;
  const { userWallet, emoji } = await req.json();

  if (typeof emoji !== "string" || emoji.length > 8) {
    return NextResponse.json({ error: "invalid emoji" }, { status: 400 });
  }
  return NextResponse.json(await toggleReaction(itemId, userWallet, emoji));
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run app/api/pacts/\[id\]/feed`
Expected: 2 passed

- [ ] **Step 6: Implement `components/Feed.tsx`**

```tsx
"use client";

import type { FeedItemDto } from "@/app/api/pacts/[id]/feed/route";

const QUICK = ["💪", "🔥", "👏", "😂"];

export function Feed({
  items,
  onReact,
}: {
  items: FeedItemDto[];
  onReact: (itemId: string, emoji: string) => void;
}) {
  return (
    <ul className="flex flex-col gap-4">
      {items.map((item) => (
        <li key={item.id} className="rounded-2xl border border-neutral-200 p-4">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-sm">
              {item.authorName && <span className="font-medium">{item.authorName} </span>}
              <span className={item.type === "bot" ? "text-neutral-500" : ""}>{item.body}</span>
            </p>
            <time className="shrink-0 text-xs text-neutral-400">
              {new Date(item.createdAt).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </time>
          </div>

          {item.photoUrl && (
            <img src={item.photoUrl} alt="" className="mt-3 w-full rounded-xl object-cover" />
          )}

          <div className="mt-3 flex flex-wrap gap-1">
            {item.reactions.map((r) => (
              <button
                key={r.emoji}
                onClick={() => onReact(item.id, r.emoji)}
                className={`rounded-full px-2 py-1 text-xs ${
                  r.mine ? "bg-black text-white" : "bg-neutral-100"
                }`}
              >
                {r.emoji} {r.count}
              </button>
            ))}
            {QUICK.filter((e) => !item.reactions.some((r) => r.emoji === e)).map((e) => (
              <button
                key={e}
                onClick={() => onReact(item.id, e)}
                className="rounded-full px-2 py-1 text-xs opacity-30 hover:opacity-100"
              >
                {e}
              </button>
            ))}
          </div>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 7: Commit**

```bash
git add app/api/pacts/\[id\]/feed app/api/feed components/Feed.tsx
git commit -m "feat: pact feed with emoji reactions"
```

---

### Task 11: Stats and streaks

**Files:**
- Create: `lib/stats.ts`
- Test: `lib/__tests__/stats.test.ts`

**Interfaces:**
- Consumes: `RuleConfig`, `SessionRecord`, `isValidSession`, `dayKeyFor` (Task 3)
- Produces:
  - `currentStreak(sessions: SessionRecord[], rule: RuleConfig, timezone: string, today: Date): number`
  - `longestStreak(sessions: SessionRecord[], rule: RuleConfig, timezone: string): number`
  - `leaderboard(entries: { memberId: string; displayName: string; sessions: SessionRecord[] }[], rule: RuleConfig, timezone: string, today: Date): LeaderRow[]` where
    `type LeaderRow = { memberId: string; displayName: string; daysDone: number; required: number; currentStreak: number; longestStreak: number }`, sorted by `daysDone` descending then `currentStreak` descending

- [ ] **Step 1: Write the failing test**

```typescript
// lib/__tests__/stats.test.ts
import { describe, it, expect } from "vitest";
import { currentStreak, longestStreak, leaderboard } from "@/lib/stats";
import type { RuleConfig } from "@/lib/rules";

const rule: RuleConfig = {
  cadence: 5, period: "week", sessionType: "checkin", minDurationMins: null,
  windowStart: "00:00", windowEnd: "23:59", proof: "photo",
  failsWhenMissedExceeds: 0, split: "equal", exemption: "majority", durationPeriods: 4,
};

const TZ = "UTC";
const day = (iso: string) => ({ startedAt: new Date(`${iso}T09:00:00.000Z`), endedAt: null });

describe("streaks", () => {
  it("counts consecutive days ending today", () => {
    const sessions = [day("2026-08-23"), day("2026-08-24"), day("2026-08-25")];
    expect(currentStreak(sessions, rule, TZ, new Date("2026-08-25T12:00:00.000Z"))).toBe(3);
  });

  it("still counts a streak that ended yesterday", () => {
    const sessions = [day("2026-08-23"), day("2026-08-24")];
    expect(currentStreak(sessions, rule, TZ, new Date("2026-08-25T12:00:00.000Z"))).toBe(2);
  });

  it("returns zero when the last session was two days ago", () => {
    const sessions = [day("2026-08-22"), day("2026-08-23")];
    expect(currentStreak(sessions, rule, TZ, new Date("2026-08-25T12:00:00.000Z"))).toBe(0);
  });

  it("finds the longest run anywhere in the history", () => {
    const sessions = [
      day("2026-08-01"), day("2026-08-02"), day("2026-08-03"), day("2026-08-04"),
      day("2026-08-10"), day("2026-08-11"),
    ];
    expect(longestStreak(sessions, rule, TZ)).toBe(4);
  });

  it("returns zero for no sessions", () => {
    expect(longestStreak([], rule, TZ)).toBe(0);
    expect(currentStreak([], rule, TZ, new Date())).toBe(0);
  });
});

describe("leaderboard", () => {
  it("sorts by days done, then by current streak", () => {
    const rows = leaderboard(
      [
        { memberId: "a", displayName: "Ana", sessions: [day("2026-08-24"), day("2026-08-25")] },
        { memberId: "b", displayName: "Ben", sessions: [day("2026-08-25")] },
        { memberId: "c", displayName: "Cal", sessions: [] },
      ],
      rule, TZ, new Date("2026-08-25T12:00:00.000Z"),
    );
    expect(rows.map((r) => r.memberId)).toEqual(["a", "b", "c"]);
    expect(rows[0].daysDone).toBe(2);
    expect(rows[0].required).toBe(5);
    expect(rows[2].currentStreak).toBe(0);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run lib/__tests__/stats.test.ts`
Expected: FAIL — cannot resolve `@/lib/stats`

- [ ] **Step 3: Implement `lib/stats.ts`**

```typescript
import { dayKeyFor, isValidSession, type RuleConfig, type SessionRecord } from "@/lib/rules";

export type LeaderRow = {
  memberId: string;
  displayName: string;
  daysDone: number;
  required: number;
  currentStreak: number;
  longestStreak: number;
};

function validDayKeys(
  sessions: SessionRecord[],
  rule: RuleConfig,
  timezone: string,
): string[] {
  const keys = new Set<string>();
  for (const s of sessions) {
    if (isValidSession(s, rule, timezone)) keys.add(dayKeyFor(s.startedAt, timezone));
  }
  return [...keys].sort();
}

function prevDayKey(key: string): string {
  const d = new Date(`${key}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * A streak survives one day of grace: it counts if the last valid day was today or
 * yesterday, so checking in tomorrow morning does not read as a broken streak.
 */
export function currentStreak(
  sessions: SessionRecord[],
  rule: RuleConfig,
  timezone: string,
  today: Date,
): number {
  const keys = validDayKeys(sessions, rule, timezone);
  if (keys.length === 0) return 0;

  const todayKey = dayKeyFor(today, timezone);
  const yesterdayKey = prevDayKey(todayKey);
  const last = keys[keys.length - 1];
  if (last !== todayKey && last !== yesterdayKey) return 0;

  const set = new Set(keys);
  let streak = 0;
  let cursor = last;
  while (set.has(cursor)) {
    streak += 1;
    cursor = prevDayKey(cursor);
  }
  return streak;
}

export function longestStreak(
  sessions: SessionRecord[],
  rule: RuleConfig,
  timezone: string,
): number {
  const keys = validDayKeys(sessions, rule, timezone);
  let best = 0;
  let run = 0;
  let previous: string | null = null;

  for (const key of keys) {
    run = previous !== null && prevDayKey(key) === previous ? run + 1 : 1;
    previous = key;
    if (run > best) best = run;
  }
  return best;
}

export function leaderboard(
  entries: { memberId: string; displayName: string; sessions: SessionRecord[] }[],
  rule: RuleConfig,
  timezone: string,
  today: Date,
): LeaderRow[] {
  return entries
    .map((e) => ({
      memberId: e.memberId,
      displayName: e.displayName,
      daysDone: validDayKeys(e.sessions, rule, timezone).length,
      required: rule.cadence,
      currentStreak: currentStreak(e.sessions, rule, timezone, today),
      longestStreak: longestStreak(e.sessions, rule, timezone),
    }))
    .sort((a, b) => b.daysDone - a.daysDone || b.currentStreak - a.currentStreak);
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run lib/__tests__/stats.test.ts`
Expected: 6 passed

- [ ] **Step 5: Commit**

```bash
git add lib/stats.ts lib/__tests__/stats.test.ts
git commit -m "feat: streak and leaderboard calculations"
```

---

### Task 12: Exemption requests and votes

**Files:**
- Create: `app/api/pacts/[id]/exemptions/route.ts`, `components/ExemptionVote.tsx`
- Test: `app/api/pacts/[id]/exemptions/__tests__/exemptions.test.ts`

**Interfaces:**
- Consumes: `prisma` (Task 4)
- Produces:
  - `requestExemption(params: { pactId: string; userWallet: string; periodKey: string; reason: string }): Promise<{ exemptionId: string }>`
  - `castVote(params: { exemptionId: string; userWallet: string; approve: boolean }): Promise<{ status: "pending" | "granted" | "denied"; approvals: number; needed: number }>`
  - `<ExemptionVote exemption={...} onVote={(approve: boolean) => void} />`

- [ ] **Step 1: Write the failing test**

```typescript
// app/api/pacts/[id]/exemptions/__tests__/exemptions.test.ts
import { describe, it, expect } from "vitest";
import { requestExemption, castVote } from "@/app/api/pacts/[id]/exemptions/route";
import { prisma } from "@/lib/db";
import { createVault } from "@/lib/vault";

async function crew(size: number) {
  const stamp = Date.now() + Math.floor(Math.random() * 1000);
  const users = await Promise.all(
    Array.from({ length: size }, (_, i) =>
      prisma.user.create({
        data: {
          privyId: `p-${stamp}-${i}`,
          walletAddress: `w-${stamp}-${i}`,
          displayName: `M${i}`,
        },
      }),
    ),
  );
  const vault = createVault();
  const pact = await prisma.pact.create({
    data: {
      name: "T", inviteToken: `t-${stamp}`, createdById: users[0].id, ruleConfig: {},
      stakeAmount: "1000", stakeCurrency: "THB", fxRateToUsd: "0.0285",
      fxFetchedAt: new Date(), stakeUsdc: 28_500_000n,
      vaultAddress: vault.publicKey, vaultSecretEnc: vault.secretEnc,
      memberships: { create: users.map((u) => ({ userId: u.id, status: "staked" as const })) },
    },
  });
  const cleanup = async () => {
    await prisma.pact.delete({ where: { id: pact.id } });
    await prisma.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
  };
  return { users, pact, cleanup };
}

describe("exemptions", () => {
  it("grants when a majority of the other members approve", async () => {
    const { users, pact, cleanup } = await crew(5);
    const { exemptionId } = await requestExemption({
      pactId: pact.id, userWallet: users[0].walletAddress,
      periodKey: "2026-W35", reason: "Food poisoning",
    });

    let r = await castVote({ exemptionId, userWallet: users[1].walletAddress, approve: true });
    expect(r.status).toBe("pending");
    expect(r.needed).toBe(3); // majority of the 4 members who are not the requester

    await castVote({ exemptionId, userWallet: users[2].walletAddress, approve: true });
    r = await castVote({ exemptionId, userWallet: users[3].walletAddress, approve: true });
    expect(r.status).toBe("granted");

    await cleanup();
  });

  it("refuses a second exemption for the same period", async () => {
    const { users, pact, cleanup } = await crew(3);
    await requestExemption({
      pactId: pact.id, userWallet: users[0].walletAddress, periodKey: "2026-W35", reason: "a",
    });
    await expect(
      requestExemption({
        pactId: pact.id, userWallet: users[0].walletAddress, periodKey: "2026-W35", reason: "b",
      }),
    ).rejects.toThrow();
    await cleanup();
  });

  it("does not let the requester vote on their own exemption", async () => {
    const { users, pact, cleanup } = await crew(3);
    const { exemptionId } = await requestExemption({
      pactId: pact.id, userWallet: users[0].walletAddress, periodKey: "2026-W35", reason: "a",
    });
    await expect(
      castVote({ exemptionId, userWallet: users[0].walletAddress, approve: true }),
    ).rejects.toThrow(/own/i);
    await cleanup();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run app/api/pacts/\[id\]/exemptions`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `app/api/pacts/[id]/exemptions/route.ts`**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function requestExemption(params: {
  pactId: string;
  userWallet: string;
  periodKey: string;
  reason: string;
}): Promise<{ exemptionId: string }> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { walletAddress: params.userWallet },
  });
  const membership = await prisma.membership.findUniqueOrThrow({
    where: { pactId_userId: { pactId: params.pactId, userId: user.id } },
  });

  const exemption = await prisma.exemption.create({
    data: {
      membershipId: membership.id,
      periodKey: params.periodKey,
      reason: params.reason.slice(0, 280),
    },
  });

  await prisma.feedItem.create({
    data: {
      pactId: params.pactId,
      membershipId: membership.id,
      type: "exemption_request",
      body: `${user.displayName} is asking to be let off: "${params.reason.slice(0, 140)}"`,
    },
  });

  return { exemptionId: exemption.id };
}

export async function castVote(params: {
  exemptionId: string;
  userWallet: string;
  approve: boolean;
}) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { walletAddress: params.userWallet },
  });

  const exemption = await prisma.exemption.findUniqueOrThrow({
    where: { id: params.exemptionId },
    include: { membership: { include: { pact: true, user: true } }, votes: true },
  });

  if (exemption.membership.userId === user.id) {
    throw new Error("You cannot vote on your own exemption");
  }
  if (exemption.status !== "pending") {
    return {
      status: exemption.status,
      approvals: exemption.votes.filter((v) => v.approve).length,
      needed: 0,
    };
  }

  await prisma.vote.upsert({
    where: { exemptionId_userId: { exemptionId: exemption.id, userId: user.id } },
    update: { approve: params.approve },
    create: { exemptionId: exemption.id, userId: user.id, approve: params.approve },
  });

  const eligible = await prisma.membership.count({
    where: {
      pactId: exemption.membership.pactId,
      status: { in: ["staked", "passed", "failed"] },
      NOT: { id: exemption.membershipId },
    },
  });
  const needed = Math.floor(eligible / 2) + 1;

  const votes = await prisma.vote.findMany({ where: { exemptionId: exemption.id } });
  const approvals = votes.filter((v) => v.approve).length;
  const rejections = votes.length - approvals;

  let status: "pending" | "granted" | "denied" = "pending";
  if (approvals >= needed) status = "granted";
  else if (rejections >= needed) status = "denied";

  if (status !== "pending") {
    await prisma.exemption.update({ where: { id: exemption.id }, data: { status } });
    await prisma.feedItem.create({
      data: {
        pactId: exemption.membership.pactId,
        membershipId: exemption.membershipId,
        type: "exemption_result",
        body:
          status === "granted"
            ? `The crew let ${exemption.membership.user.displayName} off this one.`
            : `The crew said no. ${exemption.membership.user.displayName} still owes.`,
      },
    });
  }

  return { status, approvals, needed };
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json();

  try {
    if (body.action === "request") {
      return NextResponse.json(
        await requestExemption({
          pactId: id,
          userWallet: body.userWallet,
          periodKey: body.periodKey,
          reason: body.reason,
        }),
      );
    }
    if (body.action === "vote") {
      return NextResponse.json(
        await castVote({
          exemptionId: body.exemptionId,
          userWallet: body.userWallet,
          approve: Boolean(body.approve),
        }),
      );
    }
    return NextResponse.json({ error: "action must be request or vote" }, { status: 400 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "exemption failed" },
      { status: 400 },
    );
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run app/api/pacts/\[id\]/exemptions`
Expected: 3 passed

- [ ] **Step 5: Implement `components/ExemptionVote.tsx`**

```tsx
"use client";

export function ExemptionVote({
  requesterName,
  reason,
  approvals,
  needed,
  canVote,
  onVote,
}: {
  requesterName: string;
  reason: string;
  approvals: number;
  needed: number;
  canVote: boolean;
  onVote: (approve: boolean) => void;
}) {
  return (
    <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-4">
      <p className="text-sm">
        <span className="font-medium">{requesterName}</span> is asking to be let off.
      </p>
      <p className="mt-1 text-sm italic text-neutral-700">&ldquo;{reason}&rdquo;</p>
      <p className="mt-2 text-xs text-neutral-500">
        {approvals} of {needed} needed
      </p>
      {canVote && (
        <div className="mt-3 flex gap-2">
          <button
            onClick={() => onVote(true)}
            className="rounded-full bg-black px-4 py-2 text-sm text-white"
          >
            Let them off
          </button>
          <button
            onClick={() => onVote(false)}
            className="rounded-full border border-neutral-300 px-4 py-2 text-sm"
          >
            They still owe
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add app/api/pacts/\[id\]/exemptions components/ExemptionVote.tsx
git commit -m "feat: exemption requests decided by crew majority"
```

---

### Task 13: Settlement

**Files:**
- Create: `lib/settlement.ts`, `app/api/pacts/[id]/settle/route.ts`
- Test: `lib/__tests__/settlement.test.ts`

**Interfaces:**
- Consumes: `hasFailed` (Task 3), `prisma` (Task 4), `buildOrder`, `USDC_MINT` (Task 2), `loadVault` (Task 5), `loadSponsor`, `deserializeTx`, `signWith`, `submitAndConfirm` (Task 5)
- Produces:
  - `splitPot(params: { failedStakes: bigint[]; winnerIds: string[] }): { winnerId: string; amount: bigint }[]` — remainder goes to the first winner so nothing is lost to rounding
  - `settlePact(pactId: string, periodKey: string): Promise<{ payouts: { memberId: string; amount: string; signature: string | null }[] }>`

- [ ] **Step 1: Write the failing test**

```typescript
// lib/__tests__/settlement.test.ts
import { describe, it, expect } from "vitest";
import { splitPot } from "@/lib/settlement";

describe("splitPot", () => {
  it("splits one failed stake between three winners, remainder to the first", () => {
    const r = splitPot({ failedStakes: [28_500_000n], winnerIds: ["a", "b", "c"] });
    expect(r).toEqual([
      { winnerId: "a", amount: 9_500_000n },
      { winnerId: "b", amount: 9_500_000n },
      { winnerId: "c", amount: 9_500_000n },
    ]);
    expect(r.reduce((s, p) => s + p.amount, 0n)).toBe(28_500_000n);
  });

  it("gives the indivisible remainder to the first winner", () => {
    const r = splitPot({ failedStakes: [10n], winnerIds: ["a", "b", "c"] });
    expect(r.map((p) => p.amount)).toEqual([4n, 3n, 3n]);
    expect(r.reduce((s, p) => s + p.amount, 0n)).toBe(10n);
  });

  it("sums multiple failed stakes", () => {
    const r = splitPot({ failedStakes: [100n, 200n], winnerIds: ["a", "b"] });
    expect(r.map((p) => p.amount)).toEqual([150n, 150n]);
  });

  it("returns nothing when nobody failed", () => {
    expect(splitPot({ failedStakes: [], winnerIds: ["a", "b"] })).toEqual([]);
  });

  it("returns nothing when everybody failed", () => {
    expect(splitPot({ failedStakes: [100n], winnerIds: [] })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run lib/__tests__/settlement.test.ts`
Expected: FAIL — cannot resolve `@/lib/settlement`

- [ ] **Step 3: Implement `lib/settlement.ts`**

```typescript
import { prisma } from "@/lib/db";
import { hasFailed, RuleConfigSchema } from "@/lib/rules";
import { buildOrder, USDC_MINT } from "@/lib/dflow";
import {
  deserializeTx,
  loadSponsor,
  signWith,
  submitAndConfirm,
} from "@/lib/solana";
import { loadVault } from "@/lib/vault";

export function splitPot(params: {
  failedStakes: bigint[];
  winnerIds: string[];
}): { winnerId: string; amount: bigint }[] {
  const pot = params.failedStakes.reduce((s, v) => s + v, 0n);
  const n = BigInt(params.winnerIds.length);
  if (pot === 0n || n === 0n) return [];

  const share = pot / n;
  const remainder = pot - share * n;

  return params.winnerIds.map((winnerId, i) => ({
    winnerId,
    amount: i === 0 ? share + remainder : share,
  }));
}

export async function settlePact(pactId: string, periodKey: string) {
  const pact = await prisma.pact.findUniqueOrThrow({
    where: { id: pactId },
    include: {
      memberships: {
        include: { user: true, sessions: true, exemptions: true },
      },
    },
  });

  const rule = RuleConfigSchema.parse(pact.ruleConfig);
  const vault = loadVault(pact.vaultSecretEnc);
  const sponsor = loadSponsor();

  const failed: typeof pact.memberships = [];
  const winners: typeof pact.memberships = [];

  for (const m of pact.memberships) {
    if (m.status === "left" || m.status === "invited") continue;

    const excused = m.exemptions.some(
      (e) => e.periodKey === periodKey && e.status === "granted",
    );
    const broke = hasFailed(m.sessions, rule, pact.timezone);

    if (broke && !excused) failed.push(m);
    else winners.push(m);
  }

  const shares = splitPot({
    failedStakes: failed.map(() => pact.stakeUsdc),
    winnerIds: winners.map((w) => w.id),
  });

  const payouts: { memberId: string; amount: string; signature: string | null }[] = [];

  for (const share of shares) {
    const winner = winners.find((w) => w.id === share.winnerId)!;
    let signature: string | null = null;

    // Winners taking USDC need no swap; DFlow cannot route a mint to itself.
    if (winner.payoutMint !== USDC_MINT) {
      const order = await buildOrder({
        inputMint: USDC_MINT,
        outputMint: winner.payoutMint,
        amount: share.amount,
        userPublicKey: vault.publicKey.toBase58(),
        destinationWallet: winner.user.walletAddress,
        sponsor: sponsor.publicKey.toBase58(),
        sponsorExec: false,
        slippageBps: 100,
        platformFeeBps: Number(process.env.PLATFORM_FEE_BPS ?? 0) || undefined,
        feeAccount: process.env.PLATFORM_FEE_ACCOUNT || undefined,
      });

      const tx = deserializeTx(order.transaction!);
      signWith(tx, [vault, sponsor]);
      signature = await submitAndConfirm(tx, order.lastValidBlockHeight!);
    }

    await prisma.membership.update({
      where: { id: winner.id },
      data: { status: "passed", payoutTxSig: signature },
    });

    payouts.push({ memberId: winner.id, amount: share.amount.toString(), signature });
  }

  for (const m of failed) {
    await prisma.membership.update({ where: { id: m.id }, data: { status: "failed" } });
  }

  await prisma.settlement.create({
    data: {
      pactId,
      periodKey,
      totalPotUsdc: failed.reduce((s) => s + pact.stakeUsdc, 0n),
      payouts,
    },
  });

  await prisma.pact.update({ where: { id: pactId }, data: { status: "settled" } });

  const names = (list: typeof pact.memberships) =>
    list.map((m) => m.user.displayName).join(", ") || "nobody";

  await prisma.feedItem.create({
    data: {
      pactId,
      type: "settlement",
      body:
        failed.length === 0
          ? "Everyone made it. Nobody paid a thing."
          : `${names(failed)} missed. Their stakes went to ${names(winners)}. Settled automatically.`,
    },
  });

  return { payouts };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run lib/__tests__/settlement.test.ts`
Expected: 5 passed

- [ ] **Step 5: Implement `app/api/pacts/[id]/settle/route.ts`**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { settlePact } from "@/lib/settlement";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { periodKey } = await req.json();

  if (typeof periodKey !== "string" || !periodKey) {
    return NextResponse.json({ error: "periodKey is required" }, { status: 400 });
  }

  try {
    return NextResponse.json(await settlePact(id, periodKey));
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "settlement failed" },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 6: Commit**

```bash
git add lib/settlement.ts lib/__tests__/settlement.test.ts app/api/pacts/\[id\]/settle
git commit -m "feat: automatic settlement redistributing failed stakes through dflow"
```

---

### Task 14: Presentational components

Parallel with Tasks 6–13. Pure presentation, no data access — depends only on the types.

**Files:**
- Create: `components/StatsPanel.tsx`, `components/RuleEditor.tsx`

**Interfaces:**
- Consumes: `LeaderRow` (Task 11), `RuleConfig` (Task 3)
- Produces:
  - `<StatsPanel rows={LeaderRow[]} viewerMemberId={string | null} />`
  - `<RuleEditor value={RuleConfig} onChange={(next: RuleConfig) => void} />`

- [ ] **Step 1: Implement `components/StatsPanel.tsx`**

```tsx
"use client";

import type { LeaderRow } from "@/lib/stats";

export function StatsPanel({
  rows,
  viewerMemberId,
}: {
  rows: LeaderRow[];
  viewerMemberId: string | null;
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-neutral-500">Nobody has checked in yet.</p>;
  }

  return (
    <ul className="flex flex-col gap-2">
      {rows.map((row) => {
        const done = row.daysDone >= row.required;
        return (
          <li
            key={row.memberId}
            className={`flex items-center justify-between rounded-xl px-3 py-2 ${
              row.memberId === viewerMemberId ? "bg-neutral-100" : ""
            }`}
          >
            <span className="text-sm font-medium">{row.displayName}</span>
            <span className="flex items-center gap-3 text-sm tabular-nums">
              <span className={done ? "text-emerald-600" : "text-neutral-500"}>
                {row.daysDone}/{row.required}
              </span>
              {row.currentStreak > 0 && (
                <span className="text-xs text-neutral-400">🔥 {row.currentStreak}</span>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
```

- [ ] **Step 2: Implement `components/RuleEditor.tsx`**

```tsx
"use client";

import type { RuleConfig } from "@/lib/rules";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-4 py-2">
      <span className="text-sm text-neutral-600">{label}</span>
      {children}
    </label>
  );
}

const input = "rounded-lg border border-neutral-300 px-2 py-1 text-sm";

export function RuleEditor({
  value,
  onChange,
}: {
  value: RuleConfig;
  onChange: (next: RuleConfig) => void;
}) {
  const set = <K extends keyof RuleConfig>(k: K, v: RuleConfig[K]) =>
    onChange({ ...value, [k]: v });

  return (
    <div className="divide-y divide-neutral-100">
      <Row label="Times per week">
        <input
          type="number"
          min={1}
          max={7}
          className={input}
          value={value.cadence}
          onChange={(e) => set("cadence", Number(e.target.value))}
        />
      </Row>

      <Row label="Proof">
        <select
          className={input}
          value={value.sessionType}
          onChange={(e) => set("sessionType", e.target.value as RuleConfig["sessionType"])}
        >
          <option value="checkin">Check in only</option>
          <option value="checkin_checkout">Check in and out</option>
        </select>
      </Row>

      {value.sessionType === "checkin_checkout" && (
        <Row label="Minimum minutes">
          <input
            type="number"
            min={1}
            className={input}
            value={value.minDurationMins ?? 30}
            onChange={(e) => set("minDurationMins", Number(e.target.value))}
          />
        </Row>
      )}

      <Row label="Allowed between">
        <span className="flex items-center gap-2">
          <input
            type="time"
            className={input}
            value={value.windowStart}
            onChange={(e) => set("windowStart", e.target.value)}
          />
          <span className="text-sm text-neutral-400">and</span>
          <input
            type="time"
            className={input}
            value={value.windowEnd}
            onChange={(e) => set("windowEnd", e.target.value)}
          />
        </span>
      </Row>

      <Row label="Misses allowed">
        <input
          type="number"
          min={0}
          className={input}
          value={value.failsWhenMissedExceeds}
          onChange={(e) => set("failsWhenMissedExceeds", Number(e.target.value))}
        />
      </Row>

      <Row label="Runs for (weeks)">
        <input
          type="number"
          min={1}
          max={52}
          className={input}
          value={value.durationPeriods}
          onChange={(e) => set("durationPeriods", Number(e.target.value))}
        />
      </Row>

      <Row label="Crew can grant exemptions">
        <input
          type="checkbox"
          checked={value.exemption === "majority"}
          onChange={(e) => set("exemption", e.target.checked ? "majority" : "none")}
        />
      </Row>
    </div>
  );
}
```

- [ ] **Step 3: Confirm they compile**

Run: `npx tsc --noEmit`
Expected: no errors in `components/`

- [ ] **Step 4: Commit**

```bash
git add components/StatsPanel.tsx components/RuleEditor.tsx
git commit -m "feat: stats panel and rule editor components"
```

---

## Phase 2 — Serial integration (Task 15)

---

### Task 15: Wire the UI together, seed the demo, deploy

**Files:**
- Create: `app/providers.tsx`, `app/(app)/new/page.tsx`, `app/(app)/pacts/[id]/page.tsx`, `app/join/[token]/page.tsx`, `app/api/upload/route.ts`, `app/api/pacts/[id]/view/route.ts`, `scripts/seed-demo.ts`
- Modify: `app/layout.tsx`

**Interfaces:**
- Consumes: everything from Phase 0 and Phase 1
- Produces: a deployed, demoable app

- [ ] **Step 1: Add the Privy provider**

```tsx
// app/providers.tsx
"use client";

import { PrivyProvider } from "@privy-io/react-auth";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <PrivyProvider
      appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID!}
      config={{
        loginMethods: ["email"],
        embeddedWallets: { solana: { createOnLogin: "users-without-wallets" } },
        appearance: { walletChainType: "solana-only" },
      }}
    >
      {children}
    </PrivyProvider>
  );
}
```

Wrap `{children}` in `app/layout.tsx` with `<Providers>`.

- [ ] **Step 2: Add the photo upload route**

```typescript
// app/api/upload/route.ts
import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }
  if (file.size > 8 * 1024 * 1024) {
    return NextResponse.json({ error: "file too large" }, { status: 413 });
  }

  const blob = await put(`checkins/${crypto.randomUUID()}`, file, {
    access: "public",
    contentType: file.type,
  });

  return NextResponse.json({ url: blob.url });
}
```

- [ ] **Step 3: Build the join and stake page**

The critical piece: sign with Privy's **sign-only** hook, then hand the signed bytes to the server for the sponsor's signature.

```tsx
// app/join/[token]/page.tsx (excerpt — the stake handler)
"use client";

import { useSignTransaction, useWallets } from "@privy-io/react-auth/solana";

// inside the component:
const { signTransaction } = useSignTransaction();
const { wallets } = useWallets();

async function stake(pactId: string, inputMint: string) {
  const wallet = wallets[0];

  const built = await fetch(`/api/pacts/${pactId}/stake`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ step: "build", userWallet: wallet.address, inputMint }),
  }).then((r) => r.json());

  if (built.error) throw new Error(built.error);

  const { signedTransaction } = await signTransaction({
    transaction: Uint8Array.from(atob(built.transactionB64), (c) => c.charCodeAt(0)),
    wallet,
  });

  const signedTx = btoa(String.fromCharCode(...signedTransaction));

  const done = await fetch(`/api/pacts/${pactId}/stake`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      step: "submit",
      userWallet: wallet.address,
      signedTx,
      lastValidBlockHeight: built.lastValidBlockHeight,
    }),
  }).then((r) => r.json());

  if (done.error) throw new Error(done.error);
  return done.signature;
}
```

- [ ] **Step 4: Add the aggregated pact view endpoint**

One call feeds the whole pact page, so the client polls a single URL.

```typescript
// app/api/pacts/[id]/view/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { RuleConfigSchema } from "@/lib/rules";
import { leaderboard } from "@/lib/stats";
import { getFeed } from "@/app/api/pacts/[id]/feed/route";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const viewer = req.nextUrl.searchParams.get("viewer") ?? "";

  const pact = await prisma.pact.findUnique({
    where: { id },
    include: {
      memberships: { include: { user: true, sessions: true, exemptions: { include: { votes: true } } } },
    },
  });
  if (!pact) return NextResponse.json({ error: "not found" }, { status: 404 });

  const rule = RuleConfigSchema.parse(pact.ruleConfig);

  const rows = leaderboard(
    pact.memberships.map((m) => ({
      memberId: m.id,
      displayName: m.user.displayName,
      sessions: m.sessions,
    })),
    rule,
    pact.timezone,
    new Date(),
  );

  const me = pact.memberships.find((m) => m.user.walletAddress === viewer) ?? null;
  const openSession = me
    ? (await prisma.session.findFirst({ where: { membershipId: me.id, endedAt: null } }))?.id ?? null
    : null;

  const pending = pact.memberships
    .flatMap((m) => m.exemptions.map((e) => ({ e, m })))
    .filter(({ e }) => e.status === "pending")
    .map(({ e, m }) => ({
      id: e.id,
      requesterName: m.user.displayName,
      requesterMemberId: m.id,
      reason: e.reason,
      approvals: e.votes.filter((v) => v.approve).length,
      needed: Math.floor((pact.memberships.length - 1) / 2) + 1,
    }));

  return NextResponse.json({
    id: pact.id,
    name: pact.name,
    status: pact.status,
    stakeLabel: `${pact.stakeAmount} ${pact.stakeCurrency}`,
    inviteToken: pact.inviteToken,
    rule,
    rows,
    pendingExemptions: pending,
    viewerMemberId: me?.id ?? null,
    viewerOpenSessionId: openSession,
    unstaked: pact.memberships.filter((m) => m.status === "invited").map((m) => m.user.displayName),
    feed: await getFeed(id, viewer),
  });
}
```

- [ ] **Step 5: Build the pact page**

```tsx
// app/(app)/pacts/[id]/page.tsx
"use client";

import { use, useCallback, useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useWallets } from "@privy-io/react-auth/solana";
import { Feed } from "@/components/Feed";
import { StatsPanel } from "@/components/StatsPanel";
import { CheckInCamera } from "@/components/CheckInCamera";
import { ExemptionVote } from "@/components/ExemptionVote";

export default function PactPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { authenticated, login } = usePrivy();
  const { wallets } = useWallets();
  const wallet = wallets[0]?.address ?? "";
  const [data, setData] = useState<any>(null);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/pacts/${id}/view?viewer=${wallet}`);
    if (res.ok) setData(await res.json());
  }, [id, wallet]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  async function upload(file: File): Promise<string> {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/upload", { method: "POST", body: form });
    const { url } = await res.json();
    return url;
  }

  async function checkIn(file: File) {
    const photoUrl = await upload(file);
    await fetch(`/api/pacts/${id}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "open", userWallet: wallet, photoUrl }),
    });
    await refresh();
  }

  async function checkOut(file: File) {
    const photoUrl = await upload(file);
    await fetch(`/api/pacts/${id}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "close",
        sessionId: data.viewerOpenSessionId,
        photoUrl,
      }),
    });
    await refresh();
  }

  async function react(itemId: string, emoji: string) {
    await fetch(`/api/feed/${itemId}/react`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userWallet: wallet, emoji }),
    });
    await refresh();
  }

  async function vote(exemptionId: string, approve: boolean) {
    await fetch(`/api/pacts/${id}/exemptions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "vote", exemptionId, userWallet: wallet, approve }),
    });
    await refresh();
  }

  if (!authenticated) {
    return (
      <main className="mx-auto max-w-md p-6">
        <button onClick={login} className="rounded-full bg-black px-6 py-3 text-white">
          Sign in
        </button>
      </main>
    );
  }

  if (!data) return <main className="p-6 text-sm text-neutral-500">Loading…</main>;

  return (
    <main className="mx-auto flex max-w-md flex-col gap-6 p-6 pb-32">
      <header>
        <h1 className="text-2xl font-semibold">{data.name}</h1>
        <p className="text-sm text-neutral-500">
          {data.rule.cadence}× a week · {data.stakeLabel} on the line
        </p>
        {data.status === "funding" && data.unstaked.length > 0 && (
          <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm">
            Waiting on {data.unstaked.join(", ")} to stake.
          </p>
        )}
      </header>

      <StatsPanel rows={data.rows} viewerMemberId={data.viewerMemberId} />

      {data.pendingExemptions.map((ex: any) => (
        <ExemptionVote
          key={ex.id}
          requesterName={ex.requesterName}
          reason={ex.reason}
          approvals={ex.approvals}
          needed={ex.needed}
          canVote={ex.requesterMemberId !== data.viewerMemberId}
          onVote={(approve) => vote(ex.id, approve)}
        />
      ))}

      <Feed items={data.feed} onReact={react} />

      {data.status === "active" && data.viewerMemberId && (
        <div className="fixed inset-x-0 bottom-0 border-t border-neutral-200 bg-white p-4">
          <CheckInCamera
            label={data.viewerOpenSessionId ? "Check out" : "Check in"}
            onCapture={data.viewerOpenSessionId ? checkOut : checkIn}
          />
        </div>
      )}
    </main>
  );
}
```

- [ ] **Step 6: Build the create page**

```tsx
// app/(app)/new/page.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import { useWallets } from "@privy-io/react-auth/solana";
import { RuleEditor } from "@/components/RuleEditor";
import type { RuleConfig } from "@/lib/rules";

type Draft = {
  name: string;
  ruleConfig: RuleConfig;
  stakeAmount: number;
  stakeCurrency: string;
};

export default function NewPactPage() {
  const router = useRouter();
  const { user, authenticated, login } = usePrivy();
  const { wallets } = useWallets();
  const [description, setDescription] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/rules/draft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ description }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not read that");
      setDraft(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    if (!draft) return;
    setBusy(true);
    try {
      const res = await fetch("/api/pacts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...draft,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          createdByPrivyId: user!.id,
          walletAddress: wallets[0].address,
          displayName: user!.email?.address?.split("@")[0] ?? "Anon",
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(JSON.stringify(body.error));
      router.push(`/pacts/${body.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the pact");
      setBusy(false);
    }
  }

  if (!authenticated) {
    return (
      <main className="mx-auto max-w-md p-6">
        <button onClick={login} className="rounded-full bg-black px-6 py-3 text-white">
          Sign in
        </button>
      </main>
    );
  }

  return (
    <main className="mx-auto flex max-w-md flex-col gap-6 p-6">
      <h1 className="text-2xl font-semibold">Start a pact</h1>

      <textarea
        className="min-h-32 rounded-xl border border-neutral-300 p-3 text-sm"
        placeholder="Me and four mates. Gym five days a week, at least 30 minutes, photo in and photo out. 1000 baht if you miss."
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />

      <button
        onClick={generate}
        disabled={busy || description.trim().length < 10}
        className="rounded-full bg-black px-6 py-3 text-white disabled:opacity-40"
      >
        {busy ? "Reading…" : "Turn this into a pact"}
      </button>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {draft && (
        <section className="flex flex-col gap-4 rounded-2xl border border-neutral-200 p-4">
          <input
            className="text-lg font-medium outline-none"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />

          <RuleEditor
            value={draft.ruleConfig}
            onChange={(ruleConfig) => setDraft({ ...draft, ruleConfig })}
          />

          <label className="flex items-center justify-between gap-4 border-t border-neutral-100 pt-3">
            <span className="text-sm text-neutral-600">Stake each</span>
            <span className="flex gap-2">
              <input
                type="number"
                className="w-24 rounded-lg border border-neutral-300 px-2 py-1 text-sm"
                value={draft.stakeAmount}
                onChange={(e) => setDraft({ ...draft, stakeAmount: Number(e.target.value) })}
              />
              <input
                className="w-16 rounded-lg border border-neutral-300 px-2 py-1 text-sm uppercase"
                value={draft.stakeCurrency}
                onChange={(e) =>
                  setDraft({ ...draft, stakeCurrency: e.target.value.toUpperCase().slice(0, 3) })
                }
              />
            </span>
          </label>

          <button
            onClick={create}
            disabled={busy}
            className="rounded-full bg-black px-6 py-3 text-white disabled:opacity-40"
          >
            {busy ? "Creating…" : "Create and get the invite link"}
          </button>
        </section>
      )}
    </main>
  );
}
```

- [ ] **Step 7: Write the demo seed script**

```typescript
// scripts/seed-demo.ts
import "dotenv/config";
import { prisma } from "../lib/db";
import { createVault } from "../lib/vault";
import type { RuleConfig } from "../lib/rules";

const RULE: RuleConfig = {
  cadence: 5,
  period: "week",
  sessionType: "checkin_checkout",
  minDurationMins: 30,
  windowStart: "05:00",
  windowEnd: "23:00",
  proof: "photo",
  failsWhenMissedExceeds: 0,
  split: "equal",
  exemption: "majority",
  durationPeriods: 4,
};

// Members and how many of the five required days each actually did.
const CREW = [
  { name: "Indy", wallet: "SEED_WALLET_1", days: 5 },
  { name: "Nat", wallet: "SEED_WALLET_2", days: 5 },
  { name: "Boss", wallet: "SEED_WALLET_3", days: 5 },
  { name: "Dave", wallet: "SEED_WALLET_4", days: 3 },
];

const PHOTO = "https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=600";

/**
 * Seeds a pact that is one settlement away from resolving: everyone staked,
 * three members completed the week, Dave missed two days. Running settlement
 * on stage then has something real to do.
 */
async function main() {
  const stamp = Date.now();
  const vault = createVault();

  const users = [];
  for (const m of CREW) {
    users.push(
      await prisma.user.upsert({
        where: { walletAddress: m.wallet },
        update: { displayName: m.name },
        create: { privyId: `seed-${m.name}`, walletAddress: m.wallet, displayName: m.name },
      }),
    );
  }

  const pact = await prisma.pact.create({
    data: {
      name: "Five day fitness",
      inviteToken: `demo-${stamp}`,
      createdById: users[0].id,
      ruleConfig: RULE,
      timezone: "Asia/Bangkok",
      stakeAmount: "1000",
      stakeCurrency: "THB",
      fxRateToUsd: "0.0285",
      fxFetchedAt: new Date(),
      stakeUsdc: 28_500_000n,
      vaultAddress: vault.publicKey,
      vaultSecretEnc: vault.secretEnc,
      status: "active",
      startsAt: new Date(Date.now() - 6 * 86_400_000),
      memberships: {
        create: users.map((u) => ({
          userId: u.id,
          status: "staked" as const,
          stakedAt: new Date(Date.now() - 6 * 86_400_000),
        })),
      },
    },
    include: { memberships: true },
  });

  for (const [i, member] of pact.memberships.entries()) {
    const crew = CREW[i];
    for (let d = 0; d < crew.days; d++) {
      const startedAt = new Date(Date.now() - (5 - d) * 86_400_000 + 9 * 3_600_000);
      const endedAt = new Date(startedAt.getTime() + 45 * 60_000);
      const dayKey = startedAt.toISOString().slice(0, 10);

      await prisma.session.create({
        data: {
          membershipId: member.id,
          startedAt,
          endedAt,
          dayKey,
          startPhotoUrl: PHOTO,
          endPhotoUrl: PHOTO,
        },
      });

      await prisma.feedItem.create({
        data: {
          pactId: pact.id,
          membershipId: member.id,
          type: "checkout",
          body: `${crew.name} checked out after 45 minutes`,
          photoUrl: PHOTO,
          createdAt: endedAt,
        },
      });
    }
  }

  await prisma.feedItem.create({
    data: { pactId: pact.id, type: "bot", body: "Everyone's staked. The pact is live." },
  });

  console.log(`Seeded pact ${pact.id}`);
  console.log(`  Vault:  ${vault.publicKey}`);
  console.log(`  Open:   /pacts/${pact.id}`);
  console.log(`  Settle: curl -X POST localhost:3000/api/pacts/${pact.id}/settle \\`);
  console.log(`            -H 'content-type: application/json' -d '{"periodKey":"2026-W35"}'`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
```

Replace `SEED_WALLET_1..4` with four real Solana addresses you control before running it, so
settlement has somewhere to pay out to.

Run: `npx tsx scripts/seed-demo.ts`
Expected: a pact id and a settle command printed.

- [ ] **Step 8: Full test run**

Run: `npx vitest run`
Expected: every test green.

- [ ] **Step 9: Deploy**

```bash
npx vercel --prod
```

Set every variable from `.env.example` in the Vercel dashboard. Confirm the deployed URL loads, login works, and a pact can be created.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: wire ui, seed demo data, deploy to vercel"
```

---

## Schedule

| Day | Date | Work |
|---|---|---|
| 1 | Aug 25 | Tasks 1–5. **Gate: Task 5 must show a confirmed mainnet transaction before Phase 1.** |
| 2–3 | Aug 26–27 | Tasks 6–14 in parallel |
| 4 | Aug 28 | Task 15. Deployed and demoable end to end |
| 5 | Aug 29 | Polish. README with the DFlow paragraph and the custody disclosure |
| 6 | Aug 30 | Video, three rehearsals, fallback recording |
| 7 | Aug 31 | Submit before 23:59 ICT |

## Cut lines

If behind, cut in this order. Each cut leaves a working demo.

1. Emoji reactions (Task 10, step 6 onward)
2. Longest-streak and leaderboard display (keep the calculations, hide the panel)
3. The AI rule builder (Task 7) — fall back to the manual `RuleEditor`
4. Payout token choice — pay everyone in USDC, drop the settlement swap

**Never cut:** the stake flow (Task 8) or settlement (Task 13). They are the DFlow story and the demo has no point without them.
