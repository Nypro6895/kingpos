"use client";

import { ExploreDiscoveryFeed } from "@/app/explore/explore-discovery-feed";
import type { ExploreFeedDiscoveryOptions } from "@/lib/explore-feed-discovery";
import type { PostCommentViewer } from "@/types/post-comments";

export function ExploreSearchRecommendations({
  discovery,
  sessionKey,
  viewer,
  excludeKeys = [],
}: {
  discovery: ExploreFeedDiscoveryOptions;
  sessionKey: string;
  viewer: PostCommentViewer;
  excludeKeys?: string[];
}) {
  return (
    <section className="grid gap-3" aria-label="Search recommendations" data-testid="explore-search-recommendations">
      <ExploreDiscoveryFeed
        discovery={discovery}
        sessionKey={sessionKey}
        viewer={viewer}
        excludeKeys={excludeKeys}
        firstHeading="Recommended for you"
        allowRestore={false}
        feedId="explore-search-recommendations-feed"
      />
    </section>
  );
}
