import "server-only";
import type { ExploreGpsAreaErrorKind } from "@/types/explore-gps-area";

export type AreaProviderPayload = { payload: unknown; errorKind: ExploreGpsAreaErrorKind | null };
const MAX_RESPONSE_BYTES = 128 * 1024;

export async function requestAreaProvider(url: URL, fetcher: typeof fetch, timeoutMs: number): Promise<AreaProviderPayload> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(url, {
      cache: "no-store", signal: controller.signal,
      headers: { Accept: "application/json", "User-Agent": "ReyLUMI-AreaLookup/1.0 (+https://reylumi.com)" },
    });
    if (!response.ok) return { payload: null, errorKind: response.status === 429 ? "rate_limited" : "unavailable" };
    if (Number(response.headers.get("content-length")) > MAX_RESPONSE_BYTES) return { payload: null, errorKind: "unavailable" };
    if (!response.body) return { payload: null, errorKind: "unavailable" };
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let bytes = 0; let body = "";
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        return { payload: null, errorKind: "unavailable" };
      }
      body += decoder.decode(part.value, { stream: true });
    }
    body += decoder.decode();
    try { return { payload: JSON.parse(body), errorKind: null }; }
    catch { return { payload: null, errorKind: "unavailable" }; }
  } catch {
    // Do not expose upstream URLs (which may contain GPS or the server key).
    return { payload: null, errorKind: controller.signal.aborted ? "timeout" : "network" };
  } finally { clearTimeout(timer); }
}
