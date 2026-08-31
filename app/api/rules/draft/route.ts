import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { RuleConfigSchema, type RuleConfig } from "@/lib/rules";

/* ---------------------------------------------------------------------------
 * Plain English -> a rule.
 *
 * "Gym five days a week, thirty minutes minimum, photo in and out, a thousand
 * baht if you miss" is how one of these actually gets agreed, in a group chat,
 * in one message. Making somebody translate that into seven form fields before
 * anything can happen is the version of this product nobody would use.
 *
 * The draft is a starting point, never the final word: app/(app)/pacts/new
 * shows what it made and opens the same fields underneath, so a wrong guess
 * costs one edit rather than a re-type. The schema is the app's own
 * `RuleConfigSchema`, so the model cannot invent a parameter the rule engine
 * does not evaluate.
 * ------------------------------------------------------------------------- */

const DraftSchema = z.object({
  name: z.string().describe("Short name for the pact, two to five words"),
  ruleConfig: RuleConfigSchema,
  stakeAmount: z.number().positive().describe("The amount each member puts up, as a number"),
  stakeCurrency: z.string().describe("A currency code the app can write, e.g. USDC, THB, GBP, USD"),
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
- If the description mentions a minimum duration, or "check in and check out", use sessionType checkin_checkout. Otherwise use checkin.
- If no time window is stated, use windowStart 00:00 and windowEnd 23:59.
- If a deadline is stated ("before 7am"), set windowEnd to it and windowStart to 00:00. windowStart must always be strictly before windowEnd; wrapping windows are not supported.
- If photos or proof are mentioned, proof is photo. If the rule cannot be photographed (not vaping, sleeping on time), use self_attest.
- failsWhenMissedExceeds is 0 unless the description explicitly allows misses.
- Infer currency from context: baht is THB, quid or pounds is GBP, dollars is USD. Default to USD.
- durationPeriods defaults to 4 unless a length is stated.
- The name states what the crew is doing. No exclamation marks, no slogans.`;

export async function draftRule(description: string): Promise<Draft> {
  const client = new Anthropic();

  const response = await client.messages.parse({
    model: "claude-opus-5",
    max_tokens: 16_000,
    system: SYSTEM,
    thinking: { type: "adaptive" },
    messages: [{ role: "user", content: description }],
    output_config: { format: zodOutputFormat(DraftSchema) },
  });

  if (!response.parsed_output) {
    throw new Error("Could not read a rule out of that description.");
  }
  return response.parsed_output as Draft;
}

export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    // The manual form is the fallback and it is always there, so this is a
    // degradation rather than a failure. The client says so in one line.
    return NextResponse.json({ error: "Rule drafting is not configured." }, { status: 503 });
  }

  const body = (await req.json().catch(() => ({}))) as { description?: unknown };
  if (typeof body.description !== "string" || body.description.trim().length < 10) {
    return NextResponse.json(
      { error: "Say a little more about the rule." },
      { status: 400 },
    );
  }

  try {
    return NextResponse.json(await draftRule(body.description));
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not draft that rule." },
      { status: 502 },
    );
  }
}
