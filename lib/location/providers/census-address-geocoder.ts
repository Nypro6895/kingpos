import "server-only";
import { requestAreaProvider } from "@/lib/location/area-provider-request";
import { censusStreetAddress, parseCensusAddressMatch, type CensusAddressResult } from "@/lib/location/census-address-match";
import { normalizePublicSalonAddress } from "@/lib/location/address";
import type { PublicSalonAddressInput } from "@/types/location";

export async function geocodeDirectoryAddressWithCensus(input: PublicSalonAddressInput, fetcher: typeof fetch = fetch, timeoutMs = 5000): Promise<CensusAddressResult> {
  const street = censusStreetAddress(input); const address = normalizePublicSalonAddress(input);
  if (!street) return { match: null, reason: "unsupported_address" };
  const url = new URL("https://geocoding.geo.census.gov/geocoder/locations/address");
  url.searchParams.set("street", street); url.searchParams.set("city", address.city!);
  url.searchParams.set("state", address.state!); url.searchParams.set("zip", address.postalCode!.slice(0, 5));
  url.searchParams.set("benchmark", "Public_AR_Current"); url.searchParams.set("format", "json");
  const response = await requestAreaProvider(url, fetcher, timeoutMs);
  return response.errorKind ? { match: null, reason: response.errorKind } : parseCensusAddressMatch(input, response.payload);
}
