import { NextRequest, NextResponse } from "next/server";
import { searchExploreSalons } from "@/lib/explore-search";
import { exploreSearchMetric } from "@/lib/explore-search-metrics";
import type { ExploreSearchInput } from "@/types/explore";
import { cleanExploreQueryText, normalizeExploreSearchFilters } from "@/lib/explore-query-intent";

export async function POST(request: NextRequest) {
  const started = performance.now();
  // Search sessions are viewer-bound. Never cache another account's results at the edge.
  const headers = { "Cache-Control": "private, no-store" };
  try {
    const body = await request.text();
    if (body.length > 8192) return NextResponse.json({ error: "Search request is too large." }, { status: 400, headers });
    const value: unknown = JSON.parse(body);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid search request");
    const data = value as ExploreSearchInput;
    if (data.hydrateIds !== undefined && (!Array.isArray(data.hydrateIds) || data.hydrateIds.length > 100
      || data.hydrateIds.some(id => typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)))) throw new Error("Invalid media hydration request");
    const input: ExploreSearchInput = {
      target: data.target === "posts" || data.target === "salons" ? data.target : "auto",
      contentQuery: cleanExploreQueryText(data.contentQuery),
      displayQuery: cleanExploreQueryText(data.displayQuery),
      queryKind: data.queryKind === "style" || data.queryKind === "name" ? data.queryKind : "service",
      locationPriority: data.locationPriority === true,
      locationOrigin: ["manual", "query", "context", "none"].includes(data.locationOrigin ?? "") ? data.locationOrigin : undefined,
      filters: normalizeExploreSearchFilters(data.filters),
      locationSource: ["gps", "manual", "activity", "saved", "workspace", "none"].includes(data.locationSource ?? "") ? data.locationSource : undefined,
      query: typeof data.query === "string" ? data.query.slice(0, 160) : "",
      location: typeof data.location === "string" ? data.location.slice(0, 160) : "",
      category: typeof data.category === "string" ? data.category.slice(0, 80) : "",
      latitude: data.latitude,
      longitude: data.longitude,
      page: data.page,
      pageSize: data.pageSize,
      cursor: data.cursor && typeof data.cursor === "object" && !Array.isArray(data.cursor) ? data.cursor : null,
      hydrateIds: data.hydrateIds ? [...new Set(data.hydrateIds)] : undefined,
      scopePolicy: data.scopePolicy === "fixed" || data.scopePolicy === "expandable" ? data.scopePolicy : undefined,
      sort: data.sort,
      intent: data.intent,
    };
    const result = await searchExploreSalons(input, { signal: request.signal });
    if (request.signal.aborted) return new NextResponse(null, { status: 499, headers });
    const durationMs = performance.now() - started;
    console.info(JSON.stringify(exploreSearchMetric(input, result, durationMs)));
    return NextResponse.json(result, { headers: { ...headers, "Server-Timing": `explore;dur=${durationMs.toFixed(1)}` } });
  } catch (error) {
    if (request.signal.aborted) return new NextResponse(null, { status: 499, headers });
    console.warn("Explore request rejected", { name: error instanceof Error ? error.name : "Unknown" });
    return NextResponse.json({ error: "Invalid search request." }, { status: 400, headers });
  }
}
