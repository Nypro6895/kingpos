import { normalizeExploreSearchFilters } from "@/lib/explore-query-intent";
import type { ExploreSearchFilters } from "@/types/explore";

export const EXPLORE_FILTER_KEYS = ["shape", "length", "color", "finish", "tone", "season", "maxPrice", "bookableOnly", "newOnly", "trendingOnly"] as const;

export function readExploreFilterParams(params: URLSearchParams): ExploreSearchFilters {
  return normalizeExploreSearchFilters(Object.fromEntries(EXPLORE_FILTER_KEYS.flatMap(key => {
    const value = params.get(key);
    if (value === null || value.trim() === "") return [];
    return [[key, key === "maxPrice" ? Number(value) : key.endsWith("Only") ? value === "true" : value]];
  })));
}

/** Filters do not change the selected area, typed query or server sort. */
export function exploreFilterParams(current: URLSearchParams, category: string, input: ExploreSearchFilters) {
  const params = new URLSearchParams(current), filters = normalizeExploreSearchFilters(input);
  for (const key of [...EXPLORE_FILTER_KEYS, "page", "cursor", "browse"]) params.delete(key);
  params.set("category", category || "All");
  params.set("type", "salons");
  for (const key of EXPLORE_FILTER_KEYS) {
    const value = filters[key];
    if (value !== undefined && value !== false) params.set(key, String(value));
  }
  return params;
}

export function exploreFilterCount(category: string, filters: ExploreSearchFilters) {
  return Number(Boolean(category && category !== "All")) + Object.values(normalizeExploreSearchFilters(filters)).filter(value => value !== false && value !== undefined).length;
}
