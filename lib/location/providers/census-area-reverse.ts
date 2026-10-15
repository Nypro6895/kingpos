import "server-only";
import { requestAreaProvider } from "@/lib/location/area-provider-request";
import { parseCensusGpsArea } from "@/lib/location/explore-gps-area-data";
import type { ExploreGpsArea, ExploreGpsAreaErrorKind, ExploreGpsPoint } from "@/types/explore-gps-area";

export async function reverseAreaWithCensus(point: ExploreGpsPoint, fetcher: typeof fetch = fetch, timeoutMs = 3500): Promise<{ area: ExploreGpsArea | null; errorKind: ExploreGpsAreaErrorKind | null }> {
  const url = new URL("https://geocoding.geo.census.gov/geocoder/geographies/coordinates");
  url.searchParams.set("x", String(point.longitude));
  url.searchParams.set("y", String(point.latitude));
  url.searchParams.set("benchmark", "Public_AR_Current");
  url.searchParams.set("vintage", "Current_Current");
  // Request containing administrative polygons only; do not use centroid proximity.
  url.searchParams.set("layers", "States,Incorporated Places,Census Designated Places");
  url.searchParams.set("format", "json");
  const result = await requestAreaProvider(url, fetcher, timeoutMs);
  const area = result.errorKind ? null : parseCensusGpsArea(result.payload);
  return { area, errorKind: result.errorKind ?? (area ? null : "unsupported") };
}
