import { normalizeExploreFeedDiscoveryOptions, type ExploreFeedDiscoveryOptions } from "@/lib/explore-feed-discovery";
import { normalizeExploreSearchFilters } from "@/lib/explore-query-intent";
import type { ExploreSearchInput, ExploreSearchResponse } from "@/types/explore";

export type ExploreSearchSort = NonNullable<ExploreSearchInput["sort"]>;
export type ExploreSearchCoordinates = { latitude: number; longitude: number };
export type ExploreCommittedGpsContext = {
  response: ExploreSearchResponse;
  coordinates: ExploreSearchCoordinates;
};

const SEARCH_SORTS: ExploreSearchSort[] = ["relevance", "trusted", "bookable", "closest"];
const SORT_LABELS: Record<ExploreSearchSort, string> = {
  relevance: "best matches",
  trusted: "trusted salons first",
  bookable: "salons accepting bookings first",
  closest: "nearest salons first",
};
const text = (value: unknown) => typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
const sort = (value: unknown): ExploreSearchSort | null => SEARCH_SORTS.includes(value as ExploreSearchSort) ? value as ExploreSearchSort : null;

/** The applied server order also applies to continuation pages; never re-sort a page. */
export function getExploreSearchSortState(response: ExploreSearchResponse) {
  const requestedSort = sort(response.sort) ?? "relevance";
  // Older responses do not certify a non-default ordering. Keep their sequence.
  const appliedSort = sort(response.appliedSort) ?? "relevance";
  return {
    requestedSort,
    appliedSort,
    fallbackMessage: requestedSort !== appliedSort && !response.error
      ? `Showing ${SORT_LABELS[appliedSort]} for this search.`
      : null,
  };
}

/** Only the GPS point belonging to this completed response may shape its feed. */
export function getExploreCommittedSearchCoordinates(
  response: ExploreSearchResponse,
  context?: ExploreCommittedGpsContext | null,
) {
  if (!context || context.response !== response || response.locationSource !== "gps"
    || response.locationOrigin === "manual" || response.locationOrigin === "query") return null;
  const { latitude, longitude } = context.coordinates;
  return Number.isFinite(latitude) && Math.abs(latitude) <= 90 && Number.isFinite(longitude) && Math.abs(longitude) <= 180
    ? { latitude, longitude }
    : null;
}

/** A complete committed filter signature, independent of form drafts and cursor position. */
export function buildExploreCommittedSearchContext(response: ExploreSearchResponse, options: {
  viewerId?: string | null;
  gpsContext?: ExploreCommittedGpsContext | null;
  intent?: "discover" | "latest";
  filters?: Pick<ExploreFeedDiscoveryOptions, "maxPrice" | "bookableOnly" | "newOnly" | "trendingOnly">;
} = {}) {
  const coordinates = getExploreCommittedSearchCoordinates(response, options.gpsContext);
  const location = text(response.location);
  const locationSource = response.locationSource ?? (location ? "manual" : "none");
  const locationOrigin = response.locationOrigin ?? (locationSource === "manual" ? "manual" : location ? "context" : "none");
  const scopePolicy = response.scope?.policy ?? (locationOrigin === "manual" || locationOrigin === "query" ? "fixed" : "expandable");
  const sortState = getExploreSearchSortState(response);
  const filters = normalizeExploreSearchFilters({ ...response.filters, ...options.filters });
  const discovery = normalizeExploreFeedDiscoveryOptions({
    query: text(response.contentQuery),
    category: text(response.category),
    location,
    latitude: coordinates?.latitude,
    longitude: coordinates?.longitude,
    strictLocation: scopePolicy === "fixed",
    intent: options.intent,
    maxPrice: filters.maxPrice,
    bookableOnly: filters.bookableOnly,
    newOnly: filters.newOnly,
    trendingOnly: filters.trendingOnly,
  })!;
  const signature = JSON.stringify({
    version: 3,
    searchVersion: response.searchVersion ?? null,
    target: response.target ?? "salons",
    query: text(response.query),
    displayQuery: text(response.displayQuery ?? response.query),
    contentQuery: text(response.contentQuery),
    queryKind: response.queryKind ?? null,
    locationPriority: response.locationPriority === true,
    filters,
    locationSource,
    locationOrigin,
    scopePolicy,
    viewerId: options.viewerId ?? null,
    requestedSort: sortState.requestedSort,
    appliedSort: sortState.appliedSort,
    discovery,
  });
  return {
    ...sortState,
    displayQuery: text(response.displayQuery ?? response.query),
    category: text(response.category),
    location,
    coordinates,
    scopePolicy,
    discovery,
    filters,
    sessionKey: "committed-search:" + signature,
  };
}
