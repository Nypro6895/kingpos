import type { ExploreSearchInput, ExploreSearchResponse, ExploreSearchResult } from "@/types/explore";

/** Refresh public card data without changing the session's ranking or cursor. */
export function mergeExploreSearchMedia(current: ExploreSearchResult[], fresh: ExploreSearchResult[]) {
  const byId = new Map(fresh.map(row => [row.id, row]));
  return current.flatMap(row => {
    const update = byId.get(row.id);
    if (!update) return []; // Unpublished, deleted or blocked since the page was read.
    return [{ ...update, resultGroup: row.resultGroup, relevanceScore: row.relevanceScore,
      matchType: row.matchType, matchTier: row.matchTier, matchSource: row.matchSource,
      isReferenceMatch: row.isReferenceMatch, continuationCursor: row.continuationCursor,
      isPrimaryMatch: row.isPrimaryMatch ?? update.isPrimaryMatch,
      recommendationReason: row.recommendationReason !== undefined ? row.recommendationReason : update.recommendationReason,
      recommendationAreaLabel: row.recommendationAreaLabel !== undefined ? row.recommendationAreaLabel : update.recommendationAreaLabel,
      searchScope: row.searchScope, scopeLabel: row.scopeLabel }];
  });
}

export function exploreSearchRefreshInput(response: ExploreSearchResponse, ids: string[], coordinates?: { latitude: number; longitude: number } | null): ExploreSearchInput {
  return {
    target: "salons", query: response.query, displayQuery: response.displayQuery,
    contentQuery: response.contentQuery, queryKind: response.queryKind,
    category: response.category, location: response.location,
    locationSource: response.locationSource, locationOrigin: response.locationOrigin,
    locationPriority: response.locationPriority, filters: response.filters,
    latitude: coordinates?.latitude, longitude: coordinates?.longitude,
    scopePolicy: response.scope?.policy, sort: response.sort, intent: response.intent, pageSize: response.pageSize,
    cursor: response.sessionCursor ?? response.nextCursor, hydrateIds: ids,
  };
}
