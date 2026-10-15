import { normalizeExploreFeedDiscoveryOptions, discoveryItemIdentity, type ExploreFeedDiscoveryOptions } from "@/lib/explore-feed-discovery";
import type { ExploreFeedItem } from "@/types/explore";

export type ExploreRecommendationStage = { discovery: ExploreFeedDiscoveryOptions; label: string; description: string };

/** Broaden a separate discovery stream; the original search and its counts never change. */
export function buildExploreRecommendationPlan(input: ExploreFeedDiscoveryOptions): ExploreRecommendationStage[] {
  const exact = normalizeExploreFeedDiscoveryOptions(input) ?? {};
  const area = exact.location?.trim();
  const category = exact.category && exact.category !== "All" ? exact.category : "";
  const nearby = { ...exact, query: "", maxPrice: null, bookableOnly: false, newOnly: false, trendingOnly: false, intent: "discover" as const };
  const wider = { ...nearby, strictLocation: false };
  const candidates: ExploreRecommendationStage[] = [
    { discovery: exact, label: "", description: "" },
    { discovery: nearby, label: "Recommended for you", description: area && exact.strictLocation ? `More ${category ? category.toLowerCase() + " " : ""}inspiration in ${area}.` : "More inspiration related to your search. Check each place for its location." },
    { discovery: wider, label: "More places to discover", description: area ? `Ideas from other areas, beyond ${area}.` : "More ideas to explore." },
    { discovery: { ...wider, category: "" }, label: "Explore something new", description: "Discover more beauty ideas and places." },
  ];
  const seen = new Set<string>();
  return candidates.filter(stage => {
    const normalized = normalizeExploreFeedDiscoveryOptions(stage.discovery)!;
    const key = JSON.stringify({ ...normalized, category: normalized.category?.toLowerCase() === "all" ? "" : normalized.category?.toLowerCase() });
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function exploreRecommendationKeys(item: ExploreFeedItem): string[] {
  return [discoveryItemIdentity(item), item.contentKey, item.feedKey,
    item.contentType === "salon_recommendation" && item.salon ? "salon:" + item.salon.id : null,
  ].filter((key): key is string => Boolean(key));
}
