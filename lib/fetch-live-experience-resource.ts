import { ExperienceResourceAccessError, type ExperienceResourceFetcher } from "./experience-resource-cache";
import { liveResourceRequestUrl, mergeLiveResource, type LiveResourceResponse, type LiveResourceSnapshot } from "./experience-live-resource";
import { fetchBoundedGet } from "./bounded-get";

export function fetchLiveExperienceResource<T extends object>(url: string, scope: string): ExperienceResourceFetcher<LiveResourceSnapshot<T>> {
  return async ({ signal, etag, cached }) => {
    const response = await fetchBoundedGet(liveResourceRequestUrl(url, scope, cached), {
      signal, cache: "no-store", credentials: "same-origin",
      headers: etag ? { "If-None-Match": etag } : {},
    }, { timeoutMs: 6_000, totalTimeoutMs: 12_250, maxAttempts: 2 });
    if ([401, 403, 409].includes(response.status)) throw new ExperienceResourceAccessError(response.status);
    if (response.status === 304) {
      if (!cached) throw new Error("A complete snapshot is required.");
      return { notModified: true };
    }
    if (!response.ok) throw new Error("The view is temporarily unavailable.");
    const result = await response.json() as LiveResourceResponse<T>;
    if (!result || typeof result.revision !== "string" || !/^[a-f0-9]{64}$/.test(result.revision)
      || typeof result.updatedAt !== "string" || !Number.isFinite(Date.parse(result.updatedAt))
      || typeof result.partial !== "boolean" || !result.sections || !result.data
      || typeof result.sections !== "object" || typeof result.data !== "object"
      || Array.isArray(result.sections) || Array.isArray(result.data)
      || Object.values(result.sections).some(value => typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value))) {
      throw new Error("The view response is invalid.");
    }
    return { data: mergeLiveResource(cached, result), etag: response.headers.get("etag") ?? undefined };
  };
}
