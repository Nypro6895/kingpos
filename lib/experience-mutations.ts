export type ExperienceChange = "none" | "data" | "scope";

// POST is also used for searches, batched reads and delivery telemetry. Those
// requests do not invalidate an authorized page or the user's browsing cache.
const PASSIVE_POST = new Set([
  "/api/explore/search", "/api/explore/feed", "/api/explore/area",
  "/api/explore/advertising", "/api/public-booking/inspiration-times",
  "/api/pos/windows-download", "/api/campaigns/delivery",
]);

/** A cache hint, never an authorization decision. Server authorization remains mandatory. */
export function classifyExperienceResponse(pathname: string, method: string, request: Headers, response: Headers): ExperienceChange {
  const explicit = response.get("x-reylumi-experience-change");
  if (explicit === "scope" || explicit === "data") return explicit;
  if (pathname.startsWith("/api/auth/")) return "none";
  if (request.has("Next-Action")) {
    // Next 16.2 signals an action's cookie/path/tag/refresh invalidation with
    // 1 (static + dynamic) or 2 (dynamic). Merely calling an action is not a write.
    // Mutations of retained data must revalidate their path/tag, or return the
    // explicit response hint above. Read actions have neither signal.
    const revalidated = response.get("x-action-revalidated");
    return revalidated === "1" || revalidated === "2" ? "data" : "none";
  }
  if (method === "POST" && PASSIVE_POST.has(pathname)) return "none";
  return ["POST", "PATCH", "PUT", "DELETE"].includes(method) ? "data" : "none";
}

export function experienceMutationTags(pathname: string): string[] | undefined {
  if (pathname === "/api/notifications" || pathname.startsWith("/api/notifications/")) return ["notification-center"];
  if (pathname.startsWith("/api/market/")) return ["market", "catalog", "settings"];
  // Server Actions use the current page URL, not their defining module. When
  // tags cannot be established, invalidate only the request's account scope.
  return undefined;
}
