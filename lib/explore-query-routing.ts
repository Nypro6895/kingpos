import "server-only";
import { cleanExploreQueryText, exploreQueryAreaLabel, exploreQueryNailStylePhrase, exploreQueryStateCode, exploreQueryStreetAddress, parseExploreQueryArea, parseExploreQueryIntent, type ExploreQueryTarget } from "@/lib/explore-query-intent";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ExploreSearchQueryKind } from "@/types/explore";

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
  target: "salons"; queryKind: ExploreSearchQueryKind; query: string; contentQuery: string; displayQuery: string;
  locationPriority: boolean;
  category: string; location: string; locationSource: LocationSource;
  locationOrigin: "manual" | "query" | "context" | "none";
  latitude: number | null; longitude: number | null; scopePolicy: "fixed" | "expandable";
  nearMe: boolean; requiresGps: boolean; areaAmbiguous: boolean;
  areaCandidates: ExploreQueryAreaCandidate[]; locationConflict: boolean; lookupFailed: boolean;
  queryLocationHint?: string;
  addressStatus?: "resolved" | "ambiguous" | "unmatched";
  addressQuery?: string;
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
  const anywhere = input.locationSource === "none";
  const typedLocation = anywhere ? "" : cleanExploreQueryText(input.location);
  const manual = typedLocation && (!input.locationSource || input.locationSource === "manual") ? typedLocation : "";
  const contextLocation = anywhere ? "" : manual ? cleanExploreQueryText(options.fallbackLocation) : typedLocation || cleanExploreQueryText(options.fallbackLocation);
  const contextSource = input.locationSource && input.locationSource !== "manual" ? input.locationSource : options.fallbackSource ?? "none";
  const contextArea = parseExploreQueryArea(manual || contextLocation);
  const preferredState = contextArea?.stateCode || (anywhere ? "" : exploreQueryStateCode(input.contextState));
  let parsed = parseExploreQueryIntent(input.query ?? "", { target: input.target });
  async function publicLookup(name: string, args: Record<string, unknown>): Promise<{ data: Record<string, unknown>; failed: boolean }> {
    try {
      const client = options.rpc ? null : createSupabaseServerClient();
      const runner = options.rpc ?? (client ? async (name: string, args: Record<string, unknown>) => {
        const request = client.rpc(name, args);
        return await (options.signal ? request.abortSignal(options.signal) : request) as RpcResult;
      } : null);
      if (!runner) return { data: {}, failed: true };
      const result = await runner(name, args);
      if (options.signal?.aborted) throw new DOMException("Request aborted", "AbortError");
      const data = result.error ? {} : record(result.data);
      return { data, failed: Boolean(result.error) || data.version !== 1 || !Array.isArray(data.areaCandidates) };
    } catch (error) {
      if (options.signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) throw error;
      return { data: {}, failed: true };
    }
  }
  let lookup: Record<string, unknown> = {}, lookupFailed = false;
  if (parsed.displayQuery && (parsed.query || parsed.cityQuery)) {
    const result = await publicLookup("get_public_explore_query_entities", {
      p_query: parsed.query || null, p_original_query: parsed.displayQuery || null,
      p_city_query: parsed.cityQuery || null, p_preferred_state: preferredState || null,
      p_state_constraint: parsed.locationArea?.kind === "city" ? parsed.locationArea.stateCode : null, p_limit: 8,
    });
    lookup = result.data; lookupFailed = result.failed;
  }
  let candidates = areaCandidates(lookup.areaCandidates);
  let areaAmbiguous = candidates.length > 1 || lookup.moreAreaCandidates === true;
  const preferred = preferredState ? candidates.find(candidate => candidate.stateCode === preferredState) : null;
  const verifiedArea = candidates.length === 1 ? candidates[0] : preferred ?? null;
  const confirmedCity = candidates.length > 0;
  const clearCityLiteral = confirmedCity && !parsed.locationHint && !parsed.salonCue && !parsed.explicitName;
  // A verified complete brand takes priority over a tentative service/area split.
  // A verified explicit area, or a generic service followed by a verified city,
  // keeps its geographic meaning even when the whole phrase is a salon name.
  const possibleNameArea = !parsed.directArea || parsed.locationArea?.kind === "city" && !confirmedCity;
  const preserveArea = (parsed.explicitLocation || parsed.categoryOnly) && Boolean(parsed.locationArea || confirmedCity);
  if (lookup.exactOriginalSalonName === true && !clearCityLiteral && !preserveArea && possibleNameArea && parsed.locationHint) {
    parsed = parseExploreQueryIntent(parsed.displayQuery, { target: "salons", ignoreArea: true });
    candidates = []; areaAmbiguous = false;
  } else if (parsed.tentativeArea && !confirmedCity && !lookupFailed) parsed = parseExploreQueryIntent(parsed.displayQuery, { target: input.target, ignoreArea: true });
  const exactBrand = lookup.exactOriginalSalonName === true && (!parsed.locationHint || parsed.tentativeArea && !confirmedCity) || lookup.exactSalonName === true;
  // Broad service words stay category requests even when a public salon shares
  // that generic name. Quoted/named requests can still target that exact brand.
  const broadService = parsed.categoryOnly;
  // Literal styles remain content searches even if a salon happens to share the
  // phrase. Their exact salon names still participate in the search ranking.
  const literalStyle = !parsed.explicitName && exploreQueryNailStylePhrase(parsed.query);
  const brand = !broadService && !literalStyle && exactBrand && (parsed.salonCue || parsed.explicitName || !confirmedCity && !parsed.directArea);
  if (brand) parsed = { ...parsed, queryKind: "name", contentQuery: parsed.query, categoryHint: "", cityQuery: "" };
  // Specific styles and services retain their keyword constraints; generic
  // service words alone browse the category, with or without a chosen area.
  else if (!lookupFailed && parsed.categoryOnly) parsed = { ...parsed, query: "", contentQuery: "" };
  let queryLocation = parsed.addressHint || parsed.locationHint;
  if (parsed.locationArea) queryLocation = exploreQueryAreaLabel(parsed.locationArea);
  else if (!parsed.addressHint && queryLocation && confirmedCity) queryLocation = verifiedArea?.label ?? parsed.locationHint;
  else if (!queryLocation && parsed.cityQuery && confirmedCity && !brand) {
    queryLocation = verifiedArea?.label ?? parsed.query;
    parsed = { ...parsed, query: "", contentQuery: "", queryKind: "service" };
  }
  // Resolve street inputs only from stored public salon addresses. A manual
  // city still wins a conflicting query address, as it does a query city.
  const manualAddress = exploreQueryStreetAddress(manual);
  const contextAddress = exploreQueryStreetAddress(contextLocation);
  const addressQuery = manual ? manualAddress : parsed.addressHint || (!queryLocation ? contextAddress : "");
  let addressStatus: ExploreQueryRouting["addressStatus"];
  if (addressQuery) {
    const result = await publicLookup("get_public_explore_address_area", {
      p_address: addressQuery, p_preferred_state: preferredState || null, p_limit: 8,
    });
    lookupFailed ||= result.failed;
    candidates = areaCandidates(result.data.areaCandidates);
    areaAmbiguous = candidates.length > 1 || result.data.moreAreaCandidates === true;
    addressStatus = areaAmbiguous ? "ambiguous" : candidates.length === 1 ? "resolved" : "unmatched";
  }
  const rawLatitude = anywhere ? null : coordinate(input.latitude, 90), rawLongitude = anywhere ? null : coordinate(input.longitude, 180);
  const rawGps = rawLatitude !== null && rawLongitude !== null;
  const locationOrigin = manual ? "manual" : queryLocation ? "query" : contextLocation || rawGps ? "context" : "none";
  const location = manualAddress || manual || queryLocation || contextAddress || contextLocation;
  const latitude = locationOrigin === "manual" || locationOrigin === "query" || addressQuery ? null : rawLatitude;
  const longitude = locationOrigin === "manual" || locationOrigin === "query" || addressQuery ? null : rawLongitude;
  const hasGps = latitude !== null && longitude !== null;
  const selectedCategory = cleanExploreQueryText(input.category);
  return {
    target: "salons", queryKind: parsed.queryKind, query: parsed.query, contentQuery: parsed.contentQuery, displayQuery: parsed.displayQuery,
    locationPriority: Boolean(location || hasGps || parsed.nearMe),
    category: selectedCategory && selectedCategory.toLowerCase() !== "all" ? selectedCategory : parsed.categoryHint,
    location, locationOrigin, locationSource: locationOrigin === "manual" || locationOrigin === "query" ? "manual" : contextLocation ? contextSource : hasGps ? "gps" : "none",
    latitude: hasGps ? latitude : null, longitude: hasGps ? longitude : null,
    scopePolicy: input.scopePolicy ?? (locationOrigin === "manual" || locationOrigin === "query" || addressQuery ? "fixed" : "expandable"),
    nearMe: parsed.nearMe, requiresGps: parsed.nearMe && !location && !hasGps,
    areaAmbiguous, areaCandidates: candidates, queryLocationHint: queryLocation,
    locationConflict: Boolean(manual && queryLocation && manual.toLowerCase() !== queryLocation.toLowerCase()), lookupFailed,
    ...(addressQuery ? { addressQuery, addressStatus } : {}),
  };
}
