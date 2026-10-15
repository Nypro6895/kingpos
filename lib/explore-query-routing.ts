import "server-only";
import { cleanExploreQueryText, exploreQueryAreaLabel, exploreQueryStateCode, parseExploreQueryArea, parseExploreQueryIntent, type ExploreQueryTarget } from "@/lib/explore-query-intent";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type LocationSource = "manual" | "gps" | "activity" | "saved" | "workspace" | "none";
type RpcResult = { data: unknown; error: { code?: string | null } | null };
export type ExploreQueryEntityRpc = (name: string, args: Record<string, unknown>) => Promise<RpcResult>;
export type ExploreQueryAreaCandidate = { kind: "city"; label: string; city: string; stateCode: string | null };
export type ExploreQueryRoutingInput = {
  query?: string; category?: string; location?: string; locationSource?: LocationSource;
  latitude?: number | null; longitude?: number | null; contextState?: string;
  scopePolicy?: "fixed" | "expandable"; target?: ExploreQueryTarget;
};
export type ExploreQueryRouting = {
  target: "salons" | "posts"; query: string; contentQuery: string; displayQuery: string;
  category: string; location: string; locationSource: LocationSource;
  locationOrigin: "manual" | "query" | "context" | "none";
  latitude: number | null; longitude: number | null; scopePolicy: "fixed" | "expandable";
  nearMe: boolean; requiresGps: boolean; areaAmbiguous: boolean;
  areaCandidates: ExploreQueryAreaCandidate[]; locationConflict: boolean; lookupFailed: boolean;
  queryLocationHint?: string;
};
function coordinate(value: unknown, max: number) { return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= max ? value : null; }
function record(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function areaCandidates(value: unknown) {
  return (Array.isArray(value) ? value : []).slice(0, 8).flatMap(item => {
    const row = record(item), city = cleanExploreQueryText(row.city), label = cleanExploreQueryText(row.label);
    const stateCode = exploreQueryStateCode(row.stateCode);
    return row.kind === "city" && city && label ? [{ kind: "city" as const, city, label, stateCode: stateCode || null }] : [];
  });
}

/** Resolve only public, indexed entities. Context location is a fallback, not a manual override. */
export async function resolveExploreQueryRouting(input: ExploreQueryRoutingInput, options: {
  rpc?: ExploreQueryEntityRpc; signal?: AbortSignal; fallbackLocation?: string; fallbackSource?: LocationSource;
} = {}): Promise<ExploreQueryRouting> {
  if (options.signal?.aborted) throw new DOMException("Request aborted", "AbortError");
  const typedLocation = cleanExploreQueryText(input.location);
  const manual = typedLocation && (!input.locationSource || input.locationSource === "manual") ? typedLocation : "";
  const contextLocation = manual ? cleanExploreQueryText(options.fallbackLocation) : typedLocation || cleanExploreQueryText(options.fallbackLocation);
  const contextSource = input.locationSource && input.locationSource !== "manual" ? input.locationSource : options.fallbackSource ?? "none";
  const contextArea = parseExploreQueryArea(manual || contextLocation);
  const preferredState = contextArea?.stateCode || exploreQueryStateCode(input.contextState);
  let parsed = parseExploreQueryIntent(input.query ?? "", { target: input.target });
  let lookup: Record<string, unknown> = {}, lookupFailed = false;
  if (parsed.displayQuery && (parsed.query || parsed.cityQuery)) {
    try {
      const client = options.rpc ? null : createSupabaseServerClient();
      const runner = options.rpc ?? (client ? async (name: string, args: Record<string, unknown>) => {
        const request = client.rpc(name, args);
        return await (options.signal ? request.abortSignal(options.signal) : request) as RpcResult;
      } : null);
      if (!runner) lookupFailed = true;
      else {
        const result = await runner("get_public_explore_query_entities", {
          p_query: parsed.query || null, p_original_query: parsed.displayQuery || null,
          p_city_query: parsed.cityQuery || null, p_preferred_state: preferredState || null,
          p_state_constraint: parsed.locationArea?.kind === "city" ? parsed.locationArea.stateCode : null, p_limit: 8,
        });
        if (options.signal?.aborted) throw new DOMException("Request aborted", "AbortError");
        lookup = result.error ? {} : record(result.data);
        lookupFailed = Boolean(result.error) || lookup.version !== 1 || !Array.isArray(lookup.areaCandidates);
      }
    } catch (error) {
      if (options.signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) throw error;
      lookupFailed = true;
    }
  }
  let candidates = areaCandidates(lookup.areaCandidates);
  let areaAmbiguous = candidates.length > 1 || lookup.moreAreaCandidates === true;
  const preferred = preferredState ? candidates.find(candidate => candidate.stateCode === preferredState) : null;
  const verifiedArea = candidates.length === 1 ? candidates[0] : preferred ?? null;
  const confirmedCity = candidates.length > 0;
  const clearCityLiteral = confirmedCity && !parsed.locationHint && !parsed.salonCue && !parsed.explicitName;
  // A verified complete brand takes priority over a tentative service/area split.
  // Both checks share the same bounded metadata call; unknown cities keep the full text.
  const possibleNameArea = !parsed.directArea || parsed.locationArea?.kind === "city" && !confirmedCity;
  if (input.target !== "posts" && lookup.exactOriginalSalonName === true && !clearCityLiteral && possibleNameArea && (parsed.locationHint || parsed.nearMe)) {
    parsed = parseExploreQueryIntent(parsed.displayQuery, { target: "salons", ignoreArea: true });
    candidates = []; areaAmbiguous = false;
  } else if (parsed.tentativeArea && !confirmedCity && !lookupFailed) parsed = parseExploreQueryIntent(parsed.displayQuery, { target: input.target, ignoreArea: true });
  const exactBrand = lookup.exactOriginalSalonName === true && (!parsed.locationHint || parsed.tentativeArea && !confirmedCity) || lookup.exactSalonName === true;
  const brand = input.target !== "posts" && exactBrand && (!parsed.categoryOnly || parsed.explicitName || input.target === "salons") && (parsed.salonCue || parsed.explicitName || !confirmedCity && !parsed.directArea);
  if (brand) parsed = { ...parsed, target: "salons", contentQuery: "", categoryHint: "", cityQuery: "" };
  const directoryRequest = /\b(?:salons?|shops?|studios?|places?|book|booking|appointments?)\b/i.test(parsed.query);
  // Confirm exact business names before reducing broad service words to a category.
  // Specific styles and services must retain their keyword constraints.
  if (!brand && !lookupFailed && parsed.target === "salons" && parsed.categoryOnly) parsed = { ...parsed, query: "" };
  let queryLocation = parsed.locationHint;
  if (parsed.locationArea) queryLocation = exploreQueryAreaLabel(parsed.locationArea);
  else if (queryLocation && confirmedCity) queryLocation = verifiedArea?.label ?? parsed.locationHint;
  else if (!queryLocation && parsed.cityQuery && confirmedCity && !brand && input.target !== "posts") {
    queryLocation = verifiedArea?.label ?? parsed.query;
    parsed = { ...parsed, query: "", contentQuery: "" };
  }
  // Auto discovery is content-led after exact business names and areas are verified.
  // An explicit Salons tab or directory request retains the indexed salon search.
  if (input.target !== "salons" && input.target !== "posts" && !brand && !parsed.explicitName
    && !directoryRequest && !lookupFailed && (parsed.categoryHint || !parsed.query)) {
    const contentIntent = parseExploreQueryIntent(parsed.query, { target: "posts", ignoreArea: true });
    parsed = { ...parsed, target: "posts", contentQuery: parsed.categoryOnly || !parsed.query ? "" : contentIntent.contentQuery };
  }
  const rawLatitude = coordinate(input.latitude, 90), rawLongitude = coordinate(input.longitude, 180);
  const rawGps = rawLatitude !== null && rawLongitude !== null;
  const locationOrigin = manual ? "manual" : queryLocation ? "query" : contextLocation || rawGps ? "context" : "none";
  const location = manual || queryLocation || contextLocation;
  const latitude = locationOrigin === "manual" || locationOrigin === "query" ? null : rawLatitude;
  const longitude = locationOrigin === "manual" || locationOrigin === "query" ? null : rawLongitude;
  const hasGps = latitude !== null && longitude !== null;
  const selectedCategory = cleanExploreQueryText(input.category);
  return {
    target: parsed.target, query: parsed.query, contentQuery: parsed.contentQuery, displayQuery: parsed.displayQuery,
    category: selectedCategory && selectedCategory.toLowerCase() !== "all" ? selectedCategory : parsed.categoryHint,
    location, locationOrigin, locationSource: locationOrigin === "manual" || locationOrigin === "query" ? "manual" : contextLocation ? contextSource : hasGps ? "gps" : "none",
    latitude: hasGps ? latitude : null, longitude: hasGps ? longitude : null,
    scopePolicy: input.scopePolicy ?? (locationOrigin === "manual" || locationOrigin === "query" ? "fixed" : "expandable"),
    nearMe: parsed.nearMe, requiresGps: parsed.nearMe && !manual && !hasGps,
    areaAmbiguous, areaCandidates: candidates, queryLocationHint: queryLocation,
    locationConflict: Boolean(manual && queryLocation && manual.toLowerCase() !== queryLocation.toLowerCase()), lookupFailed,
  };
}
