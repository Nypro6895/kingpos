import "server-only";
import { createHash } from "node:crypto";
import { normalizeExploreGpsPoint } from "@/lib/location/explore-gps-area-data";
import { reverseAreaWithCensus } from "@/lib/location/providers/census-area-reverse";
import { reverseAreaWithMapTiler } from "@/lib/location/providers/maptiler-area-reverse";
import type { ExploreGpsAreaErrorKind, ExploreGpsAreaResponse } from "@/types/explore-gps-area";

function failed(errorKind: ExploreGpsAreaErrorKind): ExploreGpsAreaResponse {
  const messages: Record<ExploreGpsAreaErrorKind, string> = {
    invalid: "A valid GPS position is required.",
    unsupported: "We couldn't identify a supported area. Choose a city, state or ZIP.",
    unavailable: "Area lookup is unavailable. Choose a city, state or ZIP.",
    timeout: "Area lookup took too long. Try again or choose a city, state or ZIP.",
    network: "Area lookup couldn't connect. Try again or choose a city, state or ZIP.",
    rate_limited: "Area lookup is busy. Try again shortly or choose a city, state or ZIP.",
    cancelled: "Area lookup was cancelled.",
  };
  return { area: null, error: messages[errorKind], errorKind };
}

export function createExploreGpsAreaResolver(options: {
  fetcher?: typeof fetch;
  now?: () => number;
  getMapTilerKey?: () => string;
  maxConcurrent?: number;
  maxRequestsPerMinute?: number;
  cacheSize?: number;
  successTtlMs?: number;
  failureTtlMs?: number;
  censusTimeoutMs?: number;
  mapTilerTimeoutMs?: number;
} = {}) {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now;
  const cache = new Map<string, { result: ExploreGpsAreaResponse; expiresAt: number }>();
  const pending = new Map<string, Promise<ExploreGpsAreaResponse>>();
  const requests: number[] = [];
  const maxConcurrent = options.maxConcurrent ?? 4;
  const maxRequestsPerMinute = options.maxRequestsPerMinute ?? 45;
  const cacheSize = options.cacheSize ?? 256;

  return async function resolve(input: unknown, signal?: AbortSignal): Promise<ExploreGpsAreaResponse> {
    const point = normalizeExploreGpsPoint(input);
    if (!point) return failed("invalid");
    if (signal?.aborted) return failed("cancelled");
    const apiKey = (options.getMapTilerKey?.() ?? process.env.MAPTILER_API_KEY ?? "").trim();
    // Hash exact inputs. Rounding GPS into a cell could assign the wrong side of a border.
    // This bounded ephemeral cache is never written to accounts, disk or Next's fetch cache.
    const key = createHash("sha256").update(`${point.latitude},${point.longitude}|${apiKey}`).digest("hex");
    const cached = cache.get(key);
    if (cached && cached.expiresAt > now()) return structuredClone(cached.result);
    if (cached) cache.delete(key);
    let task = pending.get(key);
    if (!task) {
      while (requests.length && requests[0] <= now() - 60_000) requests.shift();
      if (pending.size >= maxConcurrent || requests.length >= maxRequestsPerMinute) return failed("rate_limited");
      requests.push(now());
      task = (async (): Promise<ExploreGpsAreaResponse> => {
        if (apiKey) {
          const primary = await reverseAreaWithMapTiler(point, apiKey, fetcher, options.mapTilerTimeoutMs);
          if (primary.area) return { area: primary.area, error: null, errorKind: null };
        }
        // Official US polygon lookup also works when no commercial provider key exists.
        const fallback = await reverseAreaWithCensus(point, fetcher, options.censusTimeoutMs);
        return fallback.area ? { area: fallback.area, error: null, errorKind: null }
          : failed(fallback.errorKind ?? "unavailable");
      })().catch(() => failed("network"));
      pending.set(key, task);
      const completed = task;
      void completed.then(result => {
        const ttl = result.area ? options.successTtlMs ?? 10 * 60_000 : options.failureTtlMs ?? 20_000;
        cache.set(key, { result, expiresAt: now() + ttl });
        while (cache.size > cacheSize) cache.delete(cache.keys().next().value!);
      }).finally(() => pending.delete(key));
    }
    if (!signal) return structuredClone(await task);
    // A cancelled caller must not poison the shared lookup for another caller.
    return new Promise(resolve => {
      const aborted = () => { signal.removeEventListener("abort", aborted); resolve(failed("cancelled")); };
      signal.addEventListener("abort", aborted, { once: true });
      if (signal.aborted) { aborted(); return; }
      void task!.then(result => {
        signal.removeEventListener("abort", aborted);
        resolve(structuredClone(result));
      });
    });
  };
}

export const resolveExploreGpsArea = createExploreGpsAreaResolver();
