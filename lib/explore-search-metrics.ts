import type { ExploreSearchInput, ExploreSearchResponse } from "@/types/explore";

/** Finite operational dimensions; search text, coordinates and identity are never logged. */
export function exploreSearchMetric(input: ExploreSearchInput, result: ExploreSearchResponse, durationMs: number) {
  const outcome = result.errorKind ?? (result.error ? "query" : result.requiresGps ? "needs_location"
    : result.target === "posts" ? "content_search" : result.results.length ? "matches" : "empty");
  return {
    event: "explore_search",
    durationMs: Math.max(0, Math.round(Number.isFinite(durationMs) ? durationMs : 0)),
    outcome,
    target: result.target === "posts" ? "posts" : "salons",
    locationSource: ["manual", "gps", "activity", "saved", "none"].includes(result.locationSource ?? "") ? result.locationSource : "none",
    scope: result.scope?.policy === "fixed" ? "fixed" : "expandable",
    stage: ["A", "B", "C"].includes(result.scope?.stage ?? "") ? result.scope?.stage : "none",
    requestedSort: ["relevance", "trusted", "bookable", "closest", "newest"].includes(input.sort ?? "") ? input.sort : "relevance",
    appliedSort: ["relevance", "trusted", "bookable", "closest", "newest"].includes(result.appliedSort ?? "") ? result.appliedSort : "relevance",
    rankingBasis: ["indexed_scope", "unified_indexed_scope", "local_quality_indexed_lanes"].includes(result.rankingBasis ?? "") ? result.rankingBasis : "candidate_pool",
    hasKeyword: Boolean(input.query?.trim()),
    requestKind: input.hydrateIds ? "refresh" : input.cursor ? "page" : "initial",
    continuation: Boolean(input.cursor),
    resultCount: Math.min(20, Math.max(0, result.results.length)),
    hasMore: Boolean(result.hasMore),
  };
}
