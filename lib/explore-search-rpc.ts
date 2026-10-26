import type { ExploreSearchErrorKind } from "@/types/explore";

export function classifyExploreSearchError(error: unknown): ExploreSearchErrorKind {
  const detail = error && typeof error === "object" ? error as { code?: string; message?: string; name?: string; errorKind?: string } : {};
  if (["query", "timeout", "network", "cursor"].includes(detail.errorKind ?? "")) return detail.errorKind as ExploreSearchErrorKind;
  if (detail.code === "57014" || detail.name === "TimeoutError" || /timed? ?out|took too long/i.test(detail.message ?? "")) return "timeout";
  if (detail.code === "22023" && /cursor|session|expired/i.test(detail.message ?? "")) return "cursor";
  if (detail.name === "AbortError" || /fetch|network|connection|offline|load failed/i.test(detail.message ?? "")) return "network";
  return "query";
}

export function exploreSearchErrorMessage(kind: ExploreSearchErrorKind) {
  switch (kind) {
    case "timeout": return "Search took too long. Please try again.";
    case "network": return "Couldn't connect to search. Check your connection and try again.";
    case "cursor": return "This search session expired. Refresh your search to continue.";
    default: return "Salon search is temporarily unavailable. Please try again later.";
  }
}

export async function runExploreSearchRpc<T extends { error: { code?: string | null } | null }>(request: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  const first = await request();
  if (first.error?.code !== "57014" || signal?.aborted) return first;
  console.warn("Explore search retried after database timeout");
  return request();
}
