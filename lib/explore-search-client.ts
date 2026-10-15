import type { ExploreSearchInput, ExploreSearchResponse } from "@/types/explore";

export async function fetchExploreSearchPage(input: ExploreSearchInput, signal: AbortSignal): Promise<ExploreSearchResponse> {
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 15000);
  try {
  const response = await fetch("/api/explore/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify(input),
    signal: controller.signal,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw Object.assign(new Error(typeof body.error === "string" ? body.error : response.status === 504 ? "Search timed out." : "Salon search is temporarily unavailable."), {
      code: body.errorKind === "cursor" ? "22023" : body.errorKind === "timeout" || response.status === 504 ? "57014" : undefined,
      errorKind: body.errorKind,
    });
  }
  return await response.json() as ExploreSearchResponse;
  } catch (error) {
    if (timedOut) throw new Error("Search took too long. Please try again.");
    throw error;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
  }
}
