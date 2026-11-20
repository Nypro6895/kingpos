import type { ExploreHomeContent, ExploreSearchResponse } from "@/types/explore";

/** Reuse the bounded canonical search; never infer a ZIP from display labels. */
export function scopeExploreHomeContent(content: ExploreHomeContent, response: ExploreSearchResponse): ExploreHomeContent {
  if (!response.location.trim()) return content;
  const seen = new Set<string>();
  const salons = response.error ? [] : response.results.filter(salon => {
    if (salon.resultGroup === "reference" || (salon.searchScope !== "A" && salon.searchScope !== "exact") || seen.has(salon.id)) return false;
    seen.add(salon.id);
    return true;
  }).slice(0, 6).map((salon, index) => ({
    ...salon, createdAt: null, updatedAt: null, publicDiscoveryPublishedAt: null,
    homeRank: index + 1, homeSection: "recommended" as const,
  }));
  return {
    error: response.error,
    // Scoped photos arrive independently through the existing regional feed.
    inspiration: { error: null, hasMore: false, items: [], nextCursor: null },
    recommendedSalons: salons, newSalons: [], popularServices: [],
  };
}
