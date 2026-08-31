import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Onboarding } from "@/components/Onboarding";
import { prisma } from "@/lib/db";
import { ruleSentence } from "@/lib/pact-view";
import { formatMoney } from "@/lib/money";
import { RuleConfigSchema } from "@/lib/rules";
import { gate, LIVE } from "@/lib/session";
import { INVITE_COOKIE } from "@/proxy";

export const metadata = { title: "Welcome · Consistently" };

/**
 * The one screen between signing in and the app.
 *
 * It does two jobs. It says plainly what the thing is -- which nowhere before
 * this point does, because the landing page is deliberately one line -- and it
 * holds the door shut until the wallet can actually pay a stake.
 *
 * When a scanned invite is waiting, the pact it belongs to is named here.
 * Asking a stranger to send crypto to an address with no idea what it is for
 * is the highest place in the product to lose someone, and one sentence of
 * "this is what you are funding" is the whole fix.
 */
async function invitedPact() {
  if (!LIVE) return null;

  const token = (await cookies()).get(INVITE_COOKIE)?.value;
  if (!token) return null;

  const pact = await prisma.pact.findUnique({
    where: { inviteToken: token },
    select: { name: true, ruleConfig: true, stakeAmount: true, stakeCurrency: true },
  });
  if (!pact) return null;

  const rule = RuleConfigSchema.safeParse(pact.ruleConfig);
  return {
    name: pact.name,
    rule: rule.success ? ruleSentence(rule.data) : null,
    stake: formatMoney(pact.stakeAmount.toNumber(), pact.stakeCurrency),
  };
}

export default async function WelcomePage() {
  // Nothing to onboard into on a deployment with no database and no Privy app:
  // the whole app is the demo, and the demo is already furnished.
  if (!LIVE) redirect("/dashboard");

  const invite = await invitedPact();

  /**
   * Somebody already through the gate has no business watching it paint.
   *
   * This screen used to render for everyone and then throw the funded ones
   * out from an effect, which put the funding screen on the display for as
   * long as a round trip took and then yanked it. Deciding here means a
   * returning member never sees it at all.
   *
   * `gate()` reads the stamped column rather than an RPC, so this costs one
   * indexed query. It cannot answer for a first-time member -- no row exists
   * yet, and the address is only known in their browser -- which is what
   * components/Onboarding.tsx holds its own screen back for.
   */
  if ((await gate()) === "ok") redirect(invite ? "/join" : "/dashboard");

  return <Onboarding invite={invite} />;
}
