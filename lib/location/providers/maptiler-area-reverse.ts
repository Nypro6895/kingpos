import "server-only";
import { requestAreaProvider } from "@/lib/location/area-provider-request";
import { parseMapTilerGpsArea } from "@/lib/location/explore-gps-area-data";
import type { ExploreGpsArea, ExploreGpsAreaErrorKind, ExploreGpsPoint } from "@/types/explore-gps-area";

export async function reverseAreaWithMapTiler(point: ExploreGpsPoint, apiKey: string, fetcher: typeof fetch = fetch, timeoutMs = 1500): Promise<{ area: ExploreGpsArea | null; errorKind: ExploreGpsAreaErrorKind | null }> {
  const url = new URL(`https://api.maptiler.com/geocoding/${point.longitude},${point.latitude}.json`);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("language", "en");
  // No limit/types override: >1 switches this API to a nearest-neighbour search.
  const result = await requestAreaProvider(url, fetcher, timeoutMs);
  const area = result.errorKind ? null : parseMapTilerGpsArea(result.payload);
  return { area, errorKind: result.errorKind ?? (area ? null : "unsupported") };
}
