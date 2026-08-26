import { notFound } from "next/navigation";
import { Channel } from "@/components/Channel";
import { channelView } from "@/lib/channel-view";
// MOCK: swap for GET /api/pacts/[id]/view and GET /api/pacts/[id]/feed.
// See lib/mock-session.ts.
import { getChannel, getPact, getSession, MOCK_NOW } from "@/lib/mock-session";

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

export default async function PactPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [pact, { user }] = await Promise.all([getPact(id), getSession()]);
  if (!pact) notFound();

  const items = await getChannel(pact.id, user.walletAddress);

  return (
    <Channel
      view={channelView(pact, MOCK_NOW)}
      items={items}
      viewerWallet={user.walletAddress}
    />
  );
}
