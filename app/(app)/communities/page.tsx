import { CommunityBrowser } from "@/components/CommunityBrowser";
import { COMMUNITIES } from "@/lib/communities";

export const metadata = { title: "Communities · Consistently" };

/**
 * Where a rule is found rather than handed to you.
 *
 * The invite flow is untouched and still the way into a private crew: this is a
 * shelf of communities that have agreed to be discoverable. The data is a
 * fixture in lib/communities.ts — no Prisma model, no route, nothing to
 * migrate — so it can be browsed with no database configured, which is the same
 * promise the rest of the product makes.
 */
export default function CommunitiesPage() {
  return <CommunityBrowser communities={COMMUNITIES} />;
}
