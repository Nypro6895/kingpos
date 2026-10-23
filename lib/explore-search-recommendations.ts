import { normalizeExploreFeedDiscoveryOptions, type ExploreFeedDiscoveryOptions } from "@/lib/explore-feed-discovery";
import type { ExploreSearchResponse, ExploreSearchResult } from "@/types/explore";

export function isExplorePrimarySearchResult(result: ExploreSearchResult) {
  return result.isPrimaryMatch ?? (!result.isReferenceMatch && result.resultGroup !== "reference");
}

/** Keep every suggestion in the server's order under one simple heading. */
export function groupExploreSearchRecommendations(results: ExploreSearchResult[], selectedArea = "") {
  return results.length ? [{ key: `suggestions:${selectedArea.trim()}`, title: "Suggestions", results }] : [];
}

/** A fresh category browse keeps the selected area without carrying a failed keyword. */
export function exploreSearchOnwardLink(response: Pick<ExploreSearchResponse, "category" | "location" | "recommendationCategory">) {
  const category = response.category.trim() || response.recommendationCategory?.trim() || "";
  const params = new URLSearchParams({ type: "salons" });
  if (category) params.set("category", category);
  if (response.location.trim()) {
    params.set("location", response.location);
    params.set("locationSource", "manual");
    params.set("scope", "fixed");
  }
  const label = category.toLowerCase() === "nails" ? "Browse nail salons" : category ? `Browse ${category.toLowerCase()} salons` : response.location ? "Browse salons in this area" : "Browse Explore";
  return { href: category || response.location ? `/explore?${params}` : "/explore", label };
}

export type ExploreSearchRecommendationOptions = {
  coordinates?: { latitude: number; longitude: number } | null;
  viewerId?: string | null;
  filters?: Pick<ExploreFeedDiscoveryOptions, "maxPrice" | "bookableOnly" | "newOnly" | "trendingOnly">;
};

/** Suggestions belong only to a completed first search with no matching rows. */
export function shouldShowExploreSearchRecommendations(
  response: ExploreSearchResponse,
  state: { searchMode: boolean; isSearching: boolean },
) {
  if (!state.searchMode || state.isSearching || response.target === "posts" || response.page !== 1
    || response.error || response.errorKind || response.lookupFailed || response.requiresGps
    || response.hasMore || response.nextCursor || response.totalCount > 0
    || !Array.isArray(response.results) || response.results.length) return false;
  return Boolean(response.sections
    && [response.sections.bestMatches, response.sections.nearby, response.sections.recommended]
      .every(rows => Array.isArray(rows) && rows.length === 0));
}

/** A distinct bounded discovery session; the matching search remains unchanged. */
export function buildExploreSearchRecommendations(response: ExploreSearchResponse, options: ExploreSearchRecommendationOptions = {}) {
  const manualArea = response.locationOrigin === "manual" || response.locationOrigin === "query" || response.locationSource === "manual";
  const contextualArea = response.locationOrigin === "context" || ["gps", "activity", "saved", "workspace"].includes(response.locationSource ?? "");
  const gpsContext = !manualArea && response.locationSource === "gps";
  const coordinates = gpsContext ? options.coordinates : null;
  const validCoordinates = Boolean(coordinates && Number.isFinite(coordinates.latitude) && Math.abs(coordinates.latitude) <= 90
    && Number.isFinite(coordinates.longitude) && Math.abs(coordinates.longitude) <= 180);
  const strictLocation = response.scope?.policy === "fixed"
    || !response.scope?.policy && Boolean(response.location.trim() && (manualArea || !contextualArea));
  const discovery = normalizeExploreFeedDiscoveryOptions({
    intent: "discover",
    query: response.contentQuery || response.query,
    category: response.category,
    location: response.location,
    strictLocation,
    latitude: validCoordinates ? coordinates!.latitude : null,
    longitude: validCoordinates ? coordinates!.longitude : null,
    maxPrice: options.filters?.maxPrice,
    bookableOnly: options.filters?.bookableOnly,
    newOnly: options.filters?.newOnly,
    trendingOnly: options.filters?.trendingOnly,
  })!;
  const sessionKey = "empty-search-recommendations:" + JSON.stringify({
    viewerId: options.viewerId ?? null,
    target: response.target ?? "salons",
    query: response.query,
    displayQuery: response.displayQuery ?? response.query,
    contentQuery: response.contentQuery ?? "",
    locationSource: response.locationSource ?? null,
    locationOrigin: response.locationOrigin ?? null,
    scopePolicy: response.scope?.policy ?? (strictLocation ? "fixed" : "expandable"),
    sort: response.sort ?? "relevance",
    appliedSort: response.appliedSort ?? null,
    discovery,
  });
  return { discovery, sessionKey };
}
