import type { ExploreFeedDiscoveryOptions } from "@/lib/explore-feed-discovery";
import type { ExploreFeedPage } from "@/types/explore";
import { classifyExploreSearchError } from "@/lib/explore-search-rpc";

export function exploreFeedErrorMessage(error: unknown) {
  switch (classifyExploreSearchError(error)) {
    case "timeout": return "Discovery took too long. Please try again.";
    case "network": return "Couldn't connect to Discovery. Check your connection and try again.";
    case "cursor": return "This Discovery session expired. Refresh to continue.";
    default: return "Discovery is temporarily unavailable. Please try again later.";
  }
}

export async function requestExploreFeed<T>(body: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; abort(); }, 15000);
  try {
    const response = await fetch("/api/explore/feed", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body), signal: controller.signal, cache: "no-store",
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw Object.assign(new Error(typeof body.error === "string" ? body.error : "Discovery is temporarily unavailable."), { code: body.errorKind === "timeout" ? "57014" : body.errorKind === "cursor" ? "22023" : undefined, errorKind: body.errorKind });
    }
    return await response.json() as T;
  } catch (error) {
    if (timedOut) throw new Error("Discovery took too long. Please try again.");
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

export function fetchExploreFeedPage(cursor: string | null, discovery: ExploreFeedDiscoveryOptions, signal: AbortSignal) {
  return requestExploreFeed<ExploreFeedPage>({ mode: "page", cursor, discovery }, signal);
}
