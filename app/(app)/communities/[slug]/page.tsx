import { notFound } from "next/navigation";
import { CommunityDetail } from "@/components/CommunityDetail";
import { COMMUNITIES, communityBySlug } from "@/lib/communities";

/**
 * One community: what it is, what is running inside it, and the mechanism that
 * decides whether a photo counted.
 *
 * Static — the fixture is a module constant, so every slug is known at build
 * time and none of these pages needs a request to render.
 */
export function generateStaticParams() {
  return COMMUNITIES.map((c) => ({ slug: c.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const community = communityBySlug(slug);
  return { title: community ? `${community.name} · Consistently` : "Consistently" };
}

export default async function CommunityPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const community = communityBySlug(slug);
  if (!community) notFound();

  return <CommunityDetail community={community} />;
}
