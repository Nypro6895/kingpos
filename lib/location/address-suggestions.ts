import "server-only";
import { requestAreaProvider } from "@/lib/location/area-provider-request";
import { parseAddressSuggestions } from "@/lib/location/address-suggestions-data";

// Per-process bounds prevent a burst from creating unbounded provider work.
const requests: number[] = [];
let inFlight = 0;
export async function suggestAddresses(input: { query: string; mode: "address" | "area"; country?: string }) {
  const key = process.env.MAPTILER_API_KEY?.trim();
  if (!key) return { suggestions: [], available: false };
  const now = Date.now();
  while (requests.length && requests[0] < now - 60_000) requests.shift();
  if (inFlight >= 8 || requests.length >= 120) return { suggestions: [], available: false };
  requests.push(now); inFlight++;
  try {
    const url = new URL(`https://api.maptiler.com/geocoding/${encodeURIComponent(input.query)}.json`);
    url.searchParams.set("key", key);
    url.searchParams.set("autocomplete", "true");
    url.searchParams.set("limit", "6");
    url.searchParams.set("types", input.mode === "address" ? "address" : "municipality,postal_code,region,address");
    const country = input.mode === "area" ? "US" : input.country;
    if (/^[A-Za-z]{2}$/.test(country ?? "")) url.searchParams.set("country", country!.toLowerCase());
    const result = await requestAreaProvider(url, fetch, 3500);
    return { suggestions: parseAddressSuggestions(result.payload, input.mode), available: !result.errorKind };
  } finally { inFlight--; }
}
