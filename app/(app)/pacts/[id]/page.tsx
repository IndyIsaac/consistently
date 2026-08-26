import { notFound } from "next/navigation";
import { Channel } from "@/components/Channel";
import { channelView } from "@/lib/channel-view";
import { getChannel, getPact, getSession } from "@/lib/session";

/**
 * Inside a group: a bot channel, not a chat. The bot streams every action as it
 * happens, and the only two things a member can do are take a photo and run a
 * slash command.
 *
 * Everything the screen draws is derived here, once, by `channelView` — the
 * same function the client calls again after every action — so the first paint
 * carries real standings rather than a shimmer, and there is no second
 * implementation of "where does this member stand".
 */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pact = await getPact(id);
  return { title: pact ? `${pact.name} · Consistently` : "Consistently" };
}

export default async function PactPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ show?: string }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const [pact, session] = await Promise.all([getPact(id), getSession()]);
  if (!pact) notFound();

  const items = await getChannel(pact.id, session.user.walletAddress);

  return (
    <Channel
      view={channelView(pact, session.now)}
      items={items}
      viewerWallet={session.user.walletAddress}
      showInvite={query.show === "invite"}
      needsStake={pact.viewerStatus === "invited"}
    />
  );
}
